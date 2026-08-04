const { createClient } = require('@supabase/supabase-js');
const { sendEvent } = require('./_capi');
const { contentIdsDe, cartSig, decrementStock, marcarCuponBienvenidaUsado, notifyVentaTelegram, cleanText, createOrder, consumirDescuentos } = require('./_orders');
const { createAddiApplication, getAddiToken } = require('./_addi');
const { generarGuia } = require('./_coordinadora');
const { requireAdmin, renewIfActive } = require('./_admin_auth');
const crypto = require('crypto');

const ALLOWED_TABLES = ['products', 'liq_products', 'settings'];
const ALLOWED_ORDER_STATUS = ['pending', 'venta', 'no_venta'];

// Pipeline de entrega (contra entrega): la venta avanza por_despachar → enviado → entregado /
// devuelto. 'guia_generada' es un valor LEGADO que escribe la acción generar_guia (Coordinadora,
// dormida) — se acepta aquí para poder corregir a mano pedidos que ya lo tengan sin romper ese flujo.
const ALLOWED_ESTADO_ENVIO = ['por_despachar', 'guia_generada', 'enviado', 'entregado', 'devuelto'];

// Whitelist de columnas escribibles por tabla — evita mass-assignment (que el cliente
// inyecte columnas internas como id/created_at o campos arbitrarios en insert/update).
const ALLOWED_COLS = {
  // 'meta' (jsonb, migración 007): metacampos públicos + SEO por producto. ⚠️ products lo lee
  // cualquier visitante con la anon key → SOLO datos públicos (limpiarMeta lo sanea abajo).
  products: ['gender', 'brand', 'price', 'price_before', 'promo', 'sold', 'img_url', 'imgs_360', 'imgs', 'modelo', 'tallas', 'meta'],
  liq_products: ['price', 'price_before', 'sold', 'img_url', 'imgs_360', 'imgs', 'modelo', 'tallas', 'meta'],
  settings: ['key', 'value'],
};
function pickCols(table, data) {
  const allow = ALLOWED_COLS[table] || [];
  const out = {};
  for (const k of allow) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
  return out;
}

/* ── Saneo de la columna meta (jsonb público, migración 007) ──
   El panel ya recorta, pero el server NO confía en el cliente: aquí se reimponen la forma
   (objeto plano de clave→texto) y los límites estilo Shopify de meta.seo (título ≤70,
   descripción ≤160, handle como slug limpio) — así la BD nunca guarda un SEO fuera de norma
   ni estructuras anidadas arbitrarias que la ficha no sabe mostrar.
   Devuelve el objeto limpio o null (todo vacío = mejor null que un {} que "parece" tener datos).
   Lanza si la forma es inválida (el caller lo traduce a 400). */
function limpiarMeta(meta) {
  if (meta == null) return null;
  if (typeof meta !== 'object' || Array.isArray(meta)) throw new Error('meta debe ser un objeto {clave: valor}');
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    const key = String(k).trim().slice(0, 40);
    if (!key) continue;
    // La columna meta es PÚBLICA: products la lee cualquiera con la anon key (select *) — es el
    // mismo motivo por el que el costo tuvo que irse a product_costs. El aviso naranja del panel
    // protege contra el descuido de hoy; esto protege contra el de dentro de tres meses. Se
    // RECHAZA (no se ignora en silencio): quien lo teclee tiene que enterarse de por qué.
    if (/^(costo|coste|cost|margen|utilidad|ganancia|proveedor|supplier|interno|internal|nota|privado|cedula|c[eé]dula|tel|tel[eé]fono|whatsapp|email|correo)/i.test(key)) {
      throw new Error(`meta: la clave "${key}" parece un dato privado y meta es PÚBLICO (lo ve cualquier visitante)`);
    }
    if (key === 'seo') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;   // seo con forma rara → se ignora, no rompe
      const seo = {};
      if (typeof v.title === 'string' && v.title.trim()) seo.title = v.title.trim().slice(0, 70);
      if (typeof v.description === 'string' && v.description.trim()) seo.description = v.description.trim().slice(0, 160);
      if (typeof v.handle === 'string') {
        // Mismo slug que usa el front (router.js _slug): minúsculas sin tildes, solo a-z0-9 y guiones.
        const h = v.handle.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
        if (h) seo.handle = h;
      }
      if (Object.keys(seo).length) out.seo = seo;
      continue;
    }
    // Solo valores planos (texto/número/booleano): la ficha pinta pares clave→valor, y un
    // objeto anidado libre sería basura pública imposible de auditar.
    if (v == null || typeof v === 'object') continue;
    const val = String(v).trim().slice(0, 300);
    if (val) out[key] = val;
  }
  if (JSON.stringify(out).length > 6000) throw new Error('meta demasiado grande (máx ~6KB)');
  return Object.keys(out).length ? out : null;
}

/* ── Normalización al formato de Custom Audience de Meta (export_audiencia) ──
   Meta hashea al subir el archivo, pero solo matchea si el dato ya viene normalizado:
   todo en minúsculas y sin tildes, teléfono en internacional SIN '+' ni espacios
   (Colombia: 57 + 10 dígitos), ciudad sin espacios ni puntuación, país en ISO-2.
   Campo sin dato = se deja VACÍO (nunca la palabra "null"). */
const sinTildes = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
function metaPhone(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('57')) return d;   // ya venía con indicativo
  d = d.slice(-10);
  return d.length === 10 ? '57' + d : '';                // sin 10 dígitos no hay match posible
}
function metaNombre(n) {
  // SOLO letras y espacios: Meta ignora la puntuación al matchear, y sanear aquí también
  // neutraliza la inyección CSV (un nombre guardado como "=cmd|..." sería una fórmula viva
  // al abrir el archivo en Excel — el nombre lo escribe el CLIENTE, es dato hostil).
  const partes = sinTildes(n).toLowerCase().replace(/[^a-z\s]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return { fn: partes[0] || '', ln: partes.slice(1).join(' ') };   // fn = primer nombre, ln = el resto
}
const metaCiudad = c => sinTildes(c).toLowerCase().replace(/[^a-z0-9]/g, '');

// Marcas válidas del catálogo (mismo listado que sugerir_modelo y api/feed.js). Vive aquí arriba
// porque save_discount lo necesita para validar "Se aplica a → marcas".
const BRAND_LABELS_DTO = { adidas: 'Adidas', nike: 'Nike', reebok: 'Reebok', new_balance: 'New Balance', on_cloud: 'On Cloud', puma: 'Puma', lecoq_sportif: 'Le Coq Sportif', jordan: 'Jordan', lacoste: 'Lacoste', asics: 'Asics', onitsuka_tiger: 'Onitsuka Tiger', luxury: 'Luxury' };
// Email utilizable por Meta: forma básica de correo y primer carácter alfanumérico — un
// "email" que empiece por = + - @ no matchea nada en Meta y sí es inyección CSV en Excel.
const metaEmail = e => {
  const v = String(e || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(v) ? v : '';
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  if (!requireAdmin(req, res)) return;
  renewIfActive(req, res);   // actividad del admin = reinicia el reloj de inactividad (sesión deslizante)

  if (!process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { action, data, table, id } = req.body || {};

  if (!action) return res.status(400).json({ error: 'action required' });

  if (action === 'ping') return res.json({ ok: true });

  if (action === 'pixel_health') {
    // Compara el pixel del front (settings.pixel_id) con el del CAPI (env META_PIXEL_ID).
    // Solo devuelve los últimos 4 dígitos + si coinciden (no expone el pixel completo).
    const capi = (process.env.META_PIXEL_ID || '').trim();
    const { data: row } = await sb.from('settings').select('value').eq('key', 'pixel_id').maybeSingle();
    const front = ((row && row.value) || '').trim();
    const last4 = s => s ? String(s).slice(-4) : '';
    return res.json({
      ok: true,
      front_last4: last4(front), capi_last4: last4(capi),
      capi_configured: !!capi, match: !!front && !!capi && front === capi
    });
  }

  if (action === 'upsert_settings') {
    if (!data) return res.status(400).json({ error: 'data required' });
    const rows = Array.isArray(data) ? data : [data];
    const clean = rows.filter(r => r && typeof r.key === 'string' && typeof r.value === 'string');
    if (!clean.length) return res.status(400).json({ error: 'invalid settings data' });
    const { error } = await sb.from('settings').upsert(clean);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  if (action === 'upload_image') {
    const imageBase64 = data && data.imageBase64;
    if (!imageBase64 || typeof imageBase64 !== 'string') return res.status(400).json({ error: 'imageBase64 required' });
    if (imageBase64.length > 8_000_000) return res.status(413).json({ error: 'image too large' });
    const m = imageBase64.match(/^data:(image\/(?:webp|png|jpeg|jpg));base64,(.+)$/);
    if (!m) return res.status(400).json({ error: 'invalid image data' });
    const mime = m[1] === 'image/jpg' ? 'image/jpeg' : m[1];
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const bytes = Buffer.from(m[2], 'base64');
    const filename = `admin_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;
    const { error } = await sb.storage.from('product-images').upload(filename, bytes, { contentType: mime, upsert: false });
    if (error) return res.status(500).json({ error: error.message });
    const { data: pub } = sb.storage.from('product-images').getPublicUrl(filename);
    return res.json({ ok: true, url: pub.publicUrl });
  }

  // IA — SUGERIR MODELO: manda la foto principal del producto a Gemini (misma GEMINI_API_KEY
  // que ai-photo.js) y devuelve una PROPUESTA de nombre ("Nike Air Max 90 blanco/gris") para
  // los productos sin modelo, que en el feed de Meta caen a títulos genéricos duplicados.
  // Solo PROPONE: guardar pasa por update_product cuando el admin aprueba en el panel — un
  // modelo mal identificado guardado en automático sería un dato falso en el catálogo y en
  // los anuncios dinámicos. Vive aquí como action (y no como endpoint propio) porque el plan
  // de Vercel ya está en el límite de 12 funciones.
  if (action === 'sugerir_modelo') {
    if (!table || !['products', 'liq_products'].includes(table)) return res.status(400).json({ error: 'invalid table' });
    if (!id) return res.status(400).json({ error: 'id required' });
    const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
    if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY no configurada' });

    // liq_products no tiene columnas brand/gender → el select cambia por tabla
    const cols = table === 'products' ? 'id,img_url,brand,gender' : 'id,img_url';
    const { data: p, error: e1 } = await sb.from(table).select(cols).eq('id', id).single();
    if (e1 || !p) return res.status(404).json({ error: 'product_not_found' });
    if (!p.img_url) return res.status(400).json({ error: 'producto sin foto' });

    // La foto se baja de Storage y va inline: Gemini no lee URLs externas de forma confiable
    // y así la propuesta sale de EXACTAMENTE la foto que ve el cliente en el catálogo.
    const imgRes = await fetch(p.img_url).catch(() => null);
    if (!imgRes || !imgRes.ok) return res.status(502).json({ error: 'no se pudo bajar la foto del producto' });
    const mime = (imgRes.headers.get('content-type') || 'image/webp').split(';')[0];
    const b64 = Buffer.from(await imgRes.arrayBuffer()).toString('base64');

    // La marca ya registrada va como pista (reduce que alucine la marca); NO_IDENTIFICADO es la
    // salida honesta para que el panel no ofrezca una invención como propuesta.
    const BRAND_LABELS = { adidas: 'Adidas', nike: 'Nike', reebok: 'Reebok', new_balance: 'New Balance', on_cloud: 'On Cloud', puma: 'Puma', lecoq_sportif: 'Le Coq Sportif', jordan: 'Jordan', lacoste: 'Lacoste', asics: 'Asics', onitsuka_tiger: 'Onitsuka Tiger', luxury: 'Luxury' };
    const pista = p.brand && BRAND_LABELS[p.brand] ? ' La tienda lo tiene registrado como marca ' + BRAND_LABELS[p.brand] + '.' : '';
    const prompt = 'Identifica el tenis (sneaker) de la foto para el catálogo de una tienda en Colombia.' + pista +
      ' Responde UNA sola línea con el formato "Marca Modelo color/es" (ej: "Nike Air Max 90 blanco/gris"), en español, sin comillas ni punto final, máximo 60 caracteres.' +
      ' Si no reconoces el modelo con certeza razonable responde exactamente NO_IDENTIFICADO. Nunca inventes una referencia.';

    // Modelo de TEXTO con visión (el de ai-photo.js es el de generación de IMAGEN — aquí no aplica)
    const gRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }],
        generationConfig: { temperature: 0.2 }
      })
    }).catch(() => null);
    if (!gRes) return res.status(502).json({ error: 'Gemini no respondió' });
    if (gRes.status !== 200) {
      const detail = (await gRes.text().catch(() => '')).slice(0, 300);
      return res.status(502).json({ error: 'Gemini error', detail });
    }
    const gJson = await gRes.json().catch(() => null);
    const texto = (((((gJson || {}).candidates || [])[0] || {}).content || {}).parts || [])
      .map(pt => pt.text || '').join(' ').trim();
    // Limpieza defensiva: a veces envuelve en comillas/markdown aunque el prompt diga que no
    const sugerencia = texto.split('\n')[0].replace(/^["'`*\s]+|["'`*\s.]+$/g, '').slice(0, 120);
    if (!sugerencia || /NO_IDENTIFICADO/i.test(sugerencia)) return res.json({ ok: true, sugerencia: null });
    return res.json({ ok: true, sugerencia });
  }

  if (action === 'insert_product') {
    if (!table || !ALLOWED_TABLES.includes(table)) return res.status(400).json({ error: 'invalid table' });
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data required' });
    const clean = pickCols(table, data);
    if (!Object.keys(clean).length) return res.status(400).json({ error: 'no valid fields' });
    if ('meta' in clean) {   // meta es PÚBLICO por RLS → sanear siempre server-side
      try { clean.meta = limpiarMeta(clean.meta); }
      catch (e) { return res.status(400).json({ error: String(e.message || e) }); }
    }
    const { data: row, error } = await sb.from(table).insert(clean).select('id').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, id: row.id });
  }

  if (action === 'update_product') {
    if (!table || !ALLOWED_TABLES.includes(table)) return res.status(400).json({ error: 'invalid table' });
    if (!id) return res.status(400).json({ error: 'id required' });
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data required' });
    const clean = pickCols(table, data);
    if (!Object.keys(clean).length) return res.status(400).json({ error: 'no valid fields' });
    if ('meta' in clean) {   // meta es PÚBLICO por RLS → sanear siempre server-side
      try { clean.meta = limpiarMeta(clean.meta); }
      catch (e) { return res.status(400).json({ error: String(e.message || e) }); }
    }
    const { error } = await sb.from(table).update(clean).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  if (action === 'delete_product') {
    if (!table || !ALLOWED_TABLES.includes(table)) return res.status(400).json({ error: 'invalid table' });
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await sb.from(table).delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  if (action === 'update_order') {
    if (!id) return res.status(400).json({ error: 'id required' });
    const status = data && data.status;
    if (!ALLOWED_ORDER_STATUS.includes(status)) return res.status(400).json({ error: 'invalid status' });

    // Update CONDICIONAL (solo si el estado cambia) que DEVUELVE la fila → atómico: sin race,
    // sin re-disparo, y si la BD falla NO marcamos venta a ciegas (chequeamos el error).
    // Se deja constancia de que ESTA venta la marcó una persona en el panel, no la pasarela.
    // Sin esto era imposible saber después si una venta la confirmó el webhook o alguien a mano.
    const { data: prevRow } = await sb.from('orders').select('utm').eq('id', id).maybeSingle();
    const utmManual = status === 'venta'
      ? Object.assign({}, (prevRow && prevRow.utm) || {}, { confirmado_por: 'panel_manual', confirmado_at: new Date().toISOString() })
      : undefined;
    const { data: updated, error } = await sb.from('orders')
      .update(utmManual ? { status, utm: utmManual } : { status })
      .eq('id', id).neq('status', status)
      // pago/direccion/barrio/cedula/id: los pide el aviso de Telegram para llegar completo
      .select('id,subtotal,total,tel,ciudad,barrio,direccion,cedula,pago,nombre,reference,status,utm,items,session_id,cupon');
    if (error) return res.status(500).json({ error: error.message });
    const order = updated && updated[0];   // undefined si ya estaba en ese estado o no existe

    // LIMPIEZA DE HERMANOS: al marcar venta a mano, los otros intentos del MISMO carrito/sesión
    // (pending/abandoned) pasan a no_venta → no quedan en "por hacer" ni inflan métricas (evita el
    // doble conteo si además se confirmó por webhook). No bloquea la operación si falla.
    if (status === 'venta' && order && order.session_id) {
      try {
        const sig = cartSig(order.items);
        const { data: sib } = await sb.from('orders')
          .select('id,items').eq('session_id', order.session_id)
          .in('status', ['pending', 'abandoned']).neq('id', id).limit(50);
        const ids = (sib || []).filter(s => cartSig(s.items) === sig).map(s => s.id);
        if (ids.length) await sb.from('orders').update({ status: 'no_venta', motivo_no_venta: 'Intento previo — cerrado en otra venta' }).in('id', ids);
      } catch (e) { /* no bloquear el marcado de venta */ }
    }

    // Si pasó a 'venta' AHORA, enviar Purchase real a Meta vía CAPI.
    // eventId = MISMO que usan el webhook de pago y el Pixel del navegador
    // ({reference}_purchase) → Meta dedup aunque el Purchase llegue por los 3 caminos.
    // content_ids en formato del feed (cat_/liq_) para asociarlo al catálogo (FASE M).
    // Nota: IP/UA NO se envían aquí (serían los del vendedor, no del cliente); sí fbp/fbc del pedido.
    if (status === 'venta' && order && !(order.utm && order.utm.test)) {
      await decrementStock(sb, order.items).catch(() => {});   // descontar inventario por talla
      await marcarCuponBienvenidaUsado(sb, order).catch(() => {});   // venta manual (WhatsApp/contra entrega) también quema el cupón de bienvenida
      await consumirDescuentos(sb, order).catch(() => {});   // la venta manual también sube usos del motor (idempotente por pedido)
      const utm = order.utm || {};
      const value = Number(order.subtotal != null ? order.subtotal : order.total);
      if (Number.isFinite(value) && value > 0) {
        await sendEvent({
          eventName: 'Purchase',
          value,
          currency: 'COP',
          contentIds: contentIdsDe(order.items),
          phone: order.tel, city: order.ciudad, name: order.nombre,
          fbp: utm.fbp, fbc: utm.fbc,
          eventId: String(order.reference || id) + '_purchase',
          actionSource: 'business_messaging'
        }).catch(() => {});
      }
      // NO se avisa por Telegram en la venta manual, por decisión del negocio: el bot es SOLO
      // para pagos de pasarela, que ocurren sin que nadie esté mirando. Una venta que el
      // vendedor marca a mano ya la conoce, y avisarla convierte el canal en ruido.
    }
    return res.json({ ok: true });
  }

  /* SONDA DE SOLO LECTURA a la API de Paylink de Addi (la que usa el portal en Cobrar).
     El 71% de la plata de Addi entra por ahí y queda fuera del sistema. Si nuestras credenciales
     sirven en esa API, podríamos crear esos links desde el panel con solo cédula + valor —como en
     el portal— pero naciendo de nuestro lado, y detectar la aprobación desde el cron.
     NO crea solicitudes ni cobra a nadie: solo consulta un orderId que ya existe. */
  if (action === 'probar_paylink') {
    const orderId = cleanText((data || {}).orderId, 80);
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });
    let token;
    try { token = await getAddiToken(); }
    catch (e) { return res.json({ ok: false, paso: 'token', error: String(e && e.message || e) }); }
    const bases = ['https://pay-link-custom.addi.com', 'https://api.addi.com'];
    const out = [];
    for (const b of bases) {
      const url = b + '/v1/custom/pay-link?orderId=' + encodeURIComponent(orderId);
      try {
        const r = await fetch(url, { headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token } });
        out.push({ base: b, http: r.status, cuerpo: (await r.text().catch(() => '')).slice(0, 400) });
      } catch (e) { out.push({ base: b, error: String(e && e.message || e).slice(0, 120) }); }
    }
    return res.json({ ok: true, token: 'obtenido', resultados: out });
  }

  /* CREAR UN LINK DE PAGO ADDI DESDE EL PANEL.
     Antes esto se hacía en el portal de Addi (Cobrar → Paylink, que solo pide la cédula) y esas
     ventas nacían FUERA del sistema: no quedaban en la base, no salían en el panel, y Meta nunca
     recibía su Purchase — el 71% de la plata de Addi entraba así, invisible.
     Creado aquí, el pedido nace con referencia STR-, con sus productos y la dirección de envío, y
     el webhook que ya existe lo confirma solo (marca la venta, avisa por Telegram, manda el
     Purchase a Meta). Los precios los pone el SERVIDOR vía createOrder → calculateOrder: el panel
     manda ids y cantidades, nunca importes. */
  if (action === 'crear_link_addi') {
    const d = data || {};
    if (!process.env.ADDI_CLIENT_ID || !process.env.ADDI_CLIENT_SECRET) return res.status(400).json({ error: 'Addi no está configurado' });
    const email = cleanText(d.email, 120) || '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Addi exige un correo válido' });
    const cedula = String(d.cedula || '').replace(/\D/g, '');
    if (cedula.length < 5) return res.status(400).json({ error: 'Cédula requerida' });
    if (!Array.isArray(d.items) || !d.items.length) return res.status(400).json({ error: 'Agrega al menos un producto' });
    let order;
    try {
      order = await createOrder({
        items: d.items,
        pago: 'addi',
        nombre: cleanText(d.nombre, 200),
        cedula,
        tel: String(d.tel || '').replace(/\D/g, ''),
        ciudad: cleanText(d.ciudad, 100),
        barrio: cleanText(d.barrio, 100),
        direccion: cleanText(d.direccion, 300),
        utm: { origen: 'panel_link_addi', email },
        test: d.test === true
      });
    } catch (e) { return res.status(400).json({ error: e.message || 'No se pudo crear el pedido' }); }
    try {
      const { redirectUrl, applicationId } = await createAddiApplication(order, email);
      try {
        const utm = Object.assign({}, order.utm || {}, { addi_app: applicationId || null });
        await sb.from('orders').update({ utm }).eq('id', order.id);
      } catch (e) { /* la traza no bloquea el link */ }
      return res.json({ ok: true, url: redirectUrl, reference: order.reference, id: order.id, total: order.subtotal });
    } catch (e) {
      // El pedido queda 'pending' en la base a propósito: sirve de rastro de que se intentó.
      return res.status(502).json({ error: 'Addi rechazó la solicitud', detalle: String(e && e.message || e).slice(0, 120), reference: order.reference });
    }
  }

  /* Historial de avisos enviados (tabla notificaciones, migración 005). Sirve para responder
     "¿qué avisos llegaron?" y "¿este salió o falló?" sin depender del historial de Telegram,
     que la API del bot no permite leer. Filtros opcionales: reference, tipo, solo_fallidos. */
  if (action === 'list_notificaciones') {
    const d = data || {};
    let q = sb.from('notificaciones')
      .select('id,created_at,canal,tipo,order_id,reference,texto,ok,error')
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(d.limit) || 100, 500));
    if (d.reference) q = q.eq('reference', cleanText(d.reference, 100));
    if (d.tipo) q = q.eq('tipo', cleanText(d.tipo, 40));
    if (d.solo_fallidos) q = q.eq('ok', false);
    const { data: rows, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, notificaciones: rows || [] });
  }

  /* Reenviar A MANO el aviso de una venta a Telegram. Esto NO contradice la regla del canal
     (el bot avisa solo las ventas de pasarela, automáticamente): esto es un botón que aprieta
     el vendedor cuando quiere revisar el formato o recuperar un aviso que se perdió. Por eso
     no cuelga de ningún camino automático. Devuelve `enviado` para poder decir la verdad:
     sendTelegram silencia sus errores y sin las envs del bot no manda nada. */
  if (action === 'reenviar_telegram') {
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: order, error } = await sb.from('orders')
      .select('id,subtotal,total,tel,ciudad,barrio,direccion,cedula,pago,nombre,reference,status,items')
      .eq('id', id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!order) return res.status(404).json({ error: 'order_not_found' });
    const enviado = await notifyVentaTelegram(order, 'reenvio_manual').catch(() => false);
    return res.json({ ok: true, enviado: !!enviado });
  }

  // Borrar un pedido por id (para limpiar basura/pruebas viejas desde el panel Leads).
  if (action === 'delete_order') {
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await sb.from('orders').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  // ENVÍOS (Coordinadora): generar la guía de un pedido. Esqueleto — funciona en modo
  // simulación (env COORDINADORA_SIMULACION=1) o con la API real cuando se configure.
  if (action === 'generar_guia') {
    if (!id) return res.status(400).json({ error: 'id required' });
    const { data: order, error: e1 } = await sb.from('orders').select('*').eq('id', id).single();
    if (e1 || !order) return res.status(404).json({ error: 'order_not_found' });
    if (order.guia) return res.json({ ok: true, guia: order.guia, tracking_url: order.tracking_url, recaudo: order.recaudo, yaExistia: true });
    const r = await generarGuia(order);
    if (!r.ok) return res.status(400).json({ error: r.error });
    const { error: e2 } = await sb.from('orders').update({
      guia: r.guia, tracking_url: r.tracking_url, transportadora: r.transportadora,
      recaudo: r.recaudo, estado_envio: 'guia_generada'
    }).eq('id', id);
    if (e2) return res.status(500).json({ error: e2.message });
    return res.json({ ok: true, guia: r.guia, tracking_url: r.tracking_url, recaudo: r.recaudo, simulado: !!r.simulado });
  }

  // Borrar EN BLOQUE todos los pedidos marcados de prueba (utm.test = true). Se filtra en JS
  // (no con el operador jsonb en la query) para evitar sorpresas de sintaxis y ser a prueba de balas.
  if (action === 'delete_test_orders') {
    const { data: rows, error: selErr } = await sb.from('orders').select('id,utm');
    if (selErr) return res.status(500).json({ error: selErr.message });
    const ids = (rows || []).filter(o => o.utm && o.utm.test === true).map(o => o.id);
    if (!ids.length) return res.json({ ok: true, deleted: 0 });
    const { error } = await sb.from('orders').delete().in('id', ids);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, deleted: ids.length });
  }

  // Costos de adquisición (tabla product_costs, solo service_role — el costo NUNCA es público)
  if (action === 'list_costs') {
    const { data: rows, error } = await sb.from('product_costs').select('ptype,pid,costo');
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, costs: rows || [] });
  }
  if (action === 'upsert_cost') {
    const d = data || {};
    const ptype = ['cat', 'liq'].includes(d.ptype) ? d.ptype : null;
    const pid = parseInt(d.pid, 10);
    if (!ptype || !Number.isFinite(pid)) return res.status(400).json({ error: 'ptype/pid invalid' });
    if (d.costo == null || d.costo === '') {
      const { error } = await sb.from('product_costs').delete().match({ ptype, pid });
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, deleted: true });
    }
    const costo = parseInt(d.costo, 10);
    if (!Number.isFinite(costo) || costo < 0 || costo > 100_000_000) return res.status(400).json({ error: 'costo invalid' });
    const { error } = await sb.from('product_costs').upsert({ ptype, pid, costo });
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  // Campos de operador comercial (no tocan el status de venta): estado del contacto por
  // WhatsApp, temperatura del lead, motivo de no venta y nota interna del vendedor.
  if (action === 'update_order_meta') {
    if (!id) return res.status(400).json({ error: 'id required' });
    const d = data || {};
    const upd = {};
    if ('wa_status' in d) {
      if (d.wa_status !== null && !['sin_contactar', 'contactado', 'respondio', 'no_respondio'].includes(d.wa_status))
        return res.status(400).json({ error: 'invalid wa_status' });
      upd.wa_status = d.wa_status;
    }
    if ('temperatura' in d) {
      if (d.temperatura !== null && !['frio', 'tibio', 'caliente'].includes(d.temperatura))
        return res.status(400).json({ error: 'invalid temperatura' });
      upd.temperatura = d.temperatura;
    }
    if ('estado_envio' in d) {
      if (d.estado_envio !== null && !ALLOWED_ESTADO_ENVIO.includes(d.estado_envio))
        return res.status(400).json({ error: 'invalid estado_envio' });
      upd.estado_envio = d.estado_envio;
      // Sellos de fecha del pipeline: los pone el SERVIDOR (no el cliente) para que la hora sea
      // confiable. El último cambio manda: corregir un estado re-sella la fecha a propósito.
      // - enviado             → despachado_at = ahora (y se limpia el cierre si era corrección)
      // - entregado/devuelto  → entregado_at = ahora (fecha de cierre; en devuelto = cuando volvió)
      // - por_despachar/null  → se limpian ambos (marcha atrás = corrección, no hubo despacho)
      if (d.estado_envio === 'enviado') { upd.despachado_at = new Date().toISOString(); upd.entregado_at = null; }
      else if (d.estado_envio === 'entregado' || d.estado_envio === 'devuelto') upd.entregado_at = new Date().toISOString();
      else if (d.estado_envio === 'por_despachar' || d.estado_envio === null) { upd.despachado_at = null; upd.entregado_at = null; }
    }
    if ('motivo_no_venta' in d) upd.motivo_no_venta = d.motivo_no_venta == null ? null : String(d.motivo_no_venta).slice(0, 300);
    if ('nota' in d) upd.nota = d.nota == null ? null : String(d.nota).slice(0, 500);
    if ('seguimiento' in d) {
      if (d.seguimiento !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d.seguimiento))
        return res.status(400).json({ error: 'invalid seguimiento (YYYY-MM-DD)' });
      upd.seguimiento = d.seguimiento;
    }
    if (!Object.keys(upd).length) return res.status(400).json({ error: 'nothing to update' });
    const { error } = await sb.from('orders').update(upd).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  // Suscriptores del popup/newsletter — para la vista del admin y el export a Meta Custom Audience.
  if (action === 'list_subscribers') {
    const { data: rows, error } = await sb
      .from('subscribers')
      .select('id,created_at,nombre,whatsapp,email,cumple,talla,genero,utm,source,session_id,welcome_issued_at,welcome_code,welcome_used_at')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, subscribers: rows || [] });
  }

  // Reactivar el cupón de bienvenida de un suscriptor: renueva welcome_issued_at = ahora y
  // desmarca el uso (welcome_used_at = null) → 7 días nuevos y el código vuelve a valer aunque
  // ya se hubiera gastado. La validación en _orders.js mira ambas columnas, así que esto
  // rehabilita el descuento de verdad ($20.000 OFF).
  if (action === 'reissue_welcome') {
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await sb.from('subscribers')
      .update({ welcome_issued_at: new Date().toISOString(), welcome_used_at: null })
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  /* ── MOTOR DE DESCUENTOS (tabla discounts, migración 006) — CRUD del panel ──
     El panel solo administra las FILAS; quién descuenta cuánto lo decide siempre
     api/_orders.js server-side. Todo pasa por el requireAdmin de arriba. */
  if (action === 'list_discounts') {
    const { data: rows, error } = await sb.from('discounts').select('*')
      .order('created_at', { ascending: false }).limit(200);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, discounts: rows || [] });
  }

  if (action === 'save_discount') {
    const d = data || {};
    const upd = {};   // solo columnas whitelisted y validadas — jamás usos/created_at desde el cliente
    const err = m => res.status(400).json({ error: m });

    if ('codigo' in d) {
      // null/'' = automático. Con valor: 3-40 caracteres A-Z 0-9 _ - (el charset que el motor
      // acepta al consultar — un código fuera de esto sería imposible de canjear).
      const raw = d.codigo == null ? '' : String(d.codigo).trim().toUpperCase();
      if (!raw) upd.codigo = null;
      else {
        if (!/^[A-Z0-9_-]{3,40}$/.test(raw)) return err('Código: 3-40 caracteres, solo letras, números, guion y guion bajo');
        // Los códigos del sistema viejo NO se pueden pisar: BIENVENIDO20* y GRACIAS5 tienen su
        // propio camino (suscriptores) y una fila aquí los taparía o duplicaría el descuento.
        if (/^BIENVENIDO20(-|$)/.test(raw) || raw === 'GRACIAS5') return err('Ese código está reservado por el sistema de bienvenida');
        upd.codigo = raw;
      }
    }
    if ('nombre' in d) upd.nombre = cleanText(d.nombre, 80) || '';
    if ('tipo' in d) {
      if (!['pedido', 'producto', 'bogo', 'envio'].includes(d.tipo)) return err('tipo inválido');
      upd.tipo = d.tipo;
    }
    if ('valor_tipo' in d) {
      if (!['pct', 'fijo'].includes(d.valor_tipo)) return err('valor_tipo inválido');
      upd.valor_tipo = d.valor_tipo;
    }
    if ('valor' in d) {
      const v = parseInt(d.valor, 10);
      if (!Number.isFinite(v) || v < 0 || v > 100_000_000) return err('valor inválido');
      // Un % fuera de 1-100 descontaría más que el producto (el motor igual capea, pero
      // guardarlo sería un dato falso esperando hacer daño).
      if ((d.valor_tipo || upd.valor_tipo) === 'pct' && (v < 0 || v > 100)) return err('porcentaje: 0 a 100');
      upd.valor = v;
    }
    if ('aplica' in d) {
      // {ids:['cat_29','liq_5'], marcas:['nike']} — null = todos los productos
      if (d.aplica == null) upd.aplica = null;
      else {
        const ids = Array.isArray(d.aplica.ids) ? d.aplica.ids.map(s => String(s).trim().toLowerCase()).filter(s => /^(cat|liq)_\d+$/.test(s)).slice(0, 300) : [];
        // products.brand SIEMPRE es un slug de lista fija ('new_balance', 'on_cloud'…). Si aquí
        // se guardara el texto tal cual, escribir "New Balance" crearía un descuento que se ve
        // bien en el panel y NUNCA descuenta nada: falla en silencio, que es lo peor que puede
        // hacer un descuento. Se acepta el slug o el nombre visible, y una marca inexistente se
        // RECHAZA con el listado — mejor un error al crearlo que un cupón muerto en producción.
        const SLUGS = Object.keys(BRAND_LABELS_DTO);
        const porNombre = {};
        SLUGS.forEach(s => { porNombre[BRAND_LABELS_DTO[s].toLowerCase().replace(/\s+/g, ' ')] = s; });
        const marcas = [];
        if (Array.isArray(d.aplica.marcas)) {
          for (const raw of d.aplica.marcas.slice(0, 50)) {
            const t = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
            if (!t) continue;
            const slug = SLUGS.includes(t) ? t : (porNombre[t] || porNombre[t.replace(/_/g, ' ')] || null);
            if (!slug) return res.status(400).json({ error: `marca desconocida: "${raw}". Válidas: ${SLUGS.join(', ')}` });
            if (!marcas.includes(slug)) marcas.push(slug);
          }
        }
        upd.aplica = (ids.length || marcas.length) ? { ids, marcas } : null;
      }
    }
    if ('bogo' in d) {
      if (d.bogo == null) upd.bogo = null;
      else {
        const compra = parseInt(d.bogo.compra, 10), lleva = parseInt(d.bogo.lleva, 10);
        const pct = parseInt(d.bogo.pct, 10) || 100;
        if (!Number.isFinite(compra) || compra < 1 || compra > 20) return err('BOGO: "compra" debe ser 1 a 20');
        if (!Number.isFinite(lleva) || lleva < 1 || lleva > 20) return err('BOGO: "lleva" debe ser 1 a 20');
        if (pct < 1 || pct > 100) return err('BOGO: % de 1 a 100');
        upd.bogo = { compra, lleva, pct };
      }
    }
    const intONull = (v, campo, max) => {
      if (v == null || v === '') return null;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(campo + ' inválido');
      return n || null;   // 0 = sin límite/mínimo → null
    };
    try {
      if ('min_monto' in d) upd.min_monto = intONull(d.min_monto, 'min_monto', 100_000_000);
      if ('min_items' in d) upd.min_items = intONull(d.min_items, 'min_items', 100);
      if ('usos_max' in d) upd.usos_max = intONull(d.usos_max, 'usos_max', 1_000_000);
    } catch (e) { return err(e.message); }
    if ('uno_por_cliente' in d) upd.uno_por_cliente = !!d.uno_por_cliente;
    if ('combinable' in d) upd.combinable = !!d.combinable;
    const fechaONull = v => {
      if (v == null || v === '') return null;
      const t = Date.parse(v);
      return Number.isFinite(t) ? new Date(t).toISOString() : undefined;   // undefined = inválida
    };
    if ('desde' in d) { upd.desde = fechaONull(d.desde); if (upd.desde === undefined) return err('fecha "desde" inválida'); }
    if ('hasta' in d) { upd.hasta = fechaONull(d.hasta); if (upd.hasta === undefined) return err('fecha "hasta" inválida'); }
    if (upd.desde && upd.hasta && upd.hasta <= upd.desde) return err('"hasta" debe ser posterior a "desde"');
    if ('activo' in d) upd.activo = !!d.activo;
    if (!Object.keys(upd).length) return err('nothing to save');

    if (id) {
      const { error } = await sb.from('discounts').update(upd).eq('id', id);
      if (error) return res.status(500).json({ error: /duplicate|unique/i.test(error.message) ? 'Ya existe un descuento con ese código' : error.message });
      return res.json({ ok: true, id });
    }
    // Alta: exigir lo esencial para que la fila nazca coherente (el motor igual falla cerrado,
    // pero un descuento a medias en el panel solo confunde).
    if (!upd.tipo) return err('tipo requerido');
    if (upd.tipo !== 'envio' && !(parseInt(upd.valor, 10) > 0) && upd.tipo !== 'bogo') return err('valor requerido');
    if (upd.tipo === 'bogo' && !upd.bogo) return err('configura el BOGO (compra X, lleva Y)');
    const { data: row, error } = await sb.from('discounts').insert(upd).select('id').single();
    if (error) return res.status(500).json({ error: /duplicate|unique/i.test(error.message) ? 'Ya existe un descuento con ese código' : error.message });
    return res.json({ ok: true, id: row.id });
  }

  if (action === 'delete_discount') {
    if (!id) return res.status(400).json({ error: 'id required' });
    // Primero el registro de usos (sin FK): no dejar filas huérfanas que confundan auditorías.
    const { error: e1 } = await sb.from('discount_usos').delete().eq('discount_id', id);
    if (e1) return res.status(500).json({ error: e1.message });
    const { error } = await sb.from('discounts').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  /* EXPORTAR AUDIENCIA PARA META (Custom Audience → Lista de clientes).
     Devuelve un CSV con cabeceras email,phone,fn,ln,ct,country listo para subir en
     Audiencias → Crear audiencia personalizada → Lista de clientes.
     Filtros (data.tipo):
       'todos'            → todos los compradores (ventas reales)
       'rfm' + etiqueta   → un segmento RFM (Campeones, Leales, Perdidos, …)
       'dias' + min/max   → última compra hace entre min y max días
     Los perfiles y el RFM se REUSAN de api/dashboard.js (_clientes): el CSV contiene
     exactamente los mismos clientes que el panel cuenta en cada segmento — dos
     construcciones en paralelo darían audiencias que no cuadran con lo que se ve.
     Son datos personales: pasa por el MISMO requireAdmin que todas las acciones (arriba). */
  if (action === 'export_audiencia') {
    const d = data || {};
    const { perfilesDe, rfmDe, RFM_ETIQUETAS } = require('./dashboard')._clientes;
    const { data: vRows, error: vErr } = await sb.from('orders')
      .select('tel,cedula,nombre,ciudad,subtotal,total,created_at,utm,estado_envio')
      .eq('status', 'venta').order('created_at', { ascending: true }).limit(5000);
    if (vErr) return res.status(500).json({ error: vErr.message });
    // Mismas exclusiones que el dashboard: pruebas del admin (utm.test) y devoluciones fuera.
    const dia10 = t => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const ventas = (vRows || []).filter(o => !(o.utm && o.utm.test) && o.estado_envio !== 'devuelto');
    ventas.forEach(o => { o._dia = dia10(o.created_at); });
    const cli = rfmDe(perfilesDe(ventas, () => false), dia10(Date.now()));   // el rango del dashboard no aplica al export

    let sel = cli;
    if (d.tipo === 'rfm') {
      if (!RFM_ETIQUETAS.includes(d.etiqueta)) return res.status(400).json({ error: 'etiqueta RFM invalida' });
      sel = cli.filter(c => c.etiqueta === d.etiqueta);
    } else if (d.tipo === 'dias') {
      const min = Math.max(0, parseInt(d.min, 10) || 0);
      const max = parseInt(d.max, 10);
      if (!Number.isFinite(max) || max < min) return res.status(400).json({ error: 'rango de dias invalido (min/max)' });
      sel = cli.filter(c => c.r_dias >= min && c.r_dias <= max);
    }   // 'todos' u omitido → todos los compradores

    // Email: orders no guarda correo (solo utm.email de los links Addi creados en el panel) →
    // se rescata cruzando con subscribers por los últimos 10 dígitos del WhatsApp.
    const emailPorTel = {};
    ventas.forEach(o => {
      const e = o.utm && typeof o.utm.email === 'string' ? metaEmail(o.utm.email) : '';
      const t = String(o.tel || '').replace(/\D/g, '').slice(-10);
      if (t && e && !emailPorTel[t]) emailPorTel[t] = e;
    });
    const { data: subs } = await sb.from('subscribers').select('whatsapp,email').limit(5000);
    (subs || []).forEach(s => {
      const t = String(s.whatsapp || '').replace(/\D/g, '').slice(-10);
      const e = metaEmail(s.email);
      if (t && e && !emailPorTel[t]) emailPorTel[t] = e;
    });

    const filas = [], vistos = new Set();
    sel.forEach(c => {
      // Un cliente puede tener varios teléfonos (merge por cédula): una fila por teléfono
      // válido = más identificadores = mejor match rate en Meta. El email va con el principal.
      (c.tels && c.tels.length ? c.tels : [c.tel]).forEach((tel, i) => {
        const phone = metaPhone(tel);
        const email = i === 0 ? (emailPorTel[c.tel] || '') : '';
        if (!phone && !email) return;   // sin ningún identificador Meta no matchea nada
        const key = phone || 'e:' + email;
        if (vistos.has(key)) return;    // dedupe
        vistos.add(key);
        const { fn, ln } = metaNombre(c.nombre);
        filas.push([email, phone, fn, ln, metaCiudad(c.ciudad), 'co']);
      });
    });
    const esc = v => (/[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    const csv = ['email,phone,fn,ln,ct,country'].concat(filas.map(f => f.map(esc).join(','))).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('X-Clientes', String(filas.length));   // el front avisa si salió vacío
    return res.send(csv);
  }

  if (action === 'list_orders') {
    const { data: rows, error } = await sb
      .from('orders')
      .select('id,created_at,fecha,nombre,cedula,tel,ciudad,barrio,direccion,pago,subtotal,envio,total,pares,items,status,reference,seccion,utm,combo,cupon,wa_status,temperatura,motivo_no_venta,nota,seguimiento,session_id,guia,tracking_url,transportadora,estado_envio,recaudo,despachado_at,entregado_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, orders: rows || [] });
  }

  // Recorrido del cliente: eventos de las sesiones pedidas (batch), para "Interesado en"
  // y el timeline expandible de Suscriptores/Leads.
  if (action === 'session_activity') {
    const ids = Array.isArray(data && data.session_ids)
      ? data.session_ids.filter(s => typeof s === 'string' && s).map(s => s.slice(0, 64)).slice(0, 200)
      : [];
    if (!ids.length) return res.json({ ok: true, events: [] });
    const { data: rows, error } = await sb
      .from('events')
      .select('session_id,created_at,type,product_id,price,device,utm_source,utm_campaign,ad_id')
      .in('session_id', ids)
      .order('created_at', { ascending: false })
      .limit(4000);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, events: rows || [] });
  }

  return res.status(400).json({ error: 'unknown action' });
};

// Normalización Meta expuesta para pruebas locales (Vercel no lo usa; mismo patrón que _atrib).
module.exports._audiencia = { sinTildes, metaPhone, metaNombre, metaCiudad, metaEmail };
// Saneo de metacampos expuesto para pruebas locales (mismo patrón).
module.exports._metacampos = { limpiarMeta };
