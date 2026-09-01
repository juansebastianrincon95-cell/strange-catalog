const { createClient } = require('@supabase/supabase-js');
const { sendEvent } = require('./_capi');
const { contentIdsDe, cartSig, decrementStock, marcarCuponBienvenidaUsado, notifyVentaTelegram, cleanText, createOrder, consumirDescuentos, confirmPaidOrder } = require('./_orders');
const { getScInfo } = require('./_sistecredito');
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
const BRAND_LABELS_DTO = { adidas: 'Adidas', nike: 'Nike', reebok: 'Reebok', new_balance: 'New Balance', on_cloud: 'On Cloud', puma: 'Puma', lecoq_sportif: 'Le Coq Sportif', jordan: 'Jordan', lacoste: 'Lacoste', asics: 'Asics', onitsuka_tiger: 'Onitsuka Tiger', converse: 'Converse', luxury: 'Luxury' };
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
    const BRAND_LABELS = { adidas: 'Adidas', nike: 'Nike', reebok: 'Reebok', new_balance: 'New Balance', on_cloud: 'On Cloud', puma: 'Puma', lecoq_sportif: 'Le Coq Sportif', jordan: 'Jordan', lacoste: 'Lacoste', asics: 'Asics', onitsuka_tiger: 'Onitsuka Tiger', converse: 'Converse', luxury: 'Luxury' };
    const pista = p.brand && BRAND_LABELS[p.brand] ? ' La tienda lo tiene registrado como marca ' + BRAND_LABELS[p.brand] + '.' : '';
    const prompt = 'Identifica el tenis (sneaker) de la foto para el catálogo de una tienda en Colombia.' + pista +
      ' Responde UNA sola línea con el formato "Marca Modelo color/es" (ej: "Nike Air Max 90 blanco/gris"), en español, sin comillas ni punto final, máximo 60 caracteres.' +
      ' Si no reconoces el modelo con certeza razonable responde exactamente NO_IDENTIFICADO. Nunca inventes una referencia.';

    // Modelo de TEXTO con visión (el de ai-photo.js es el de generación de IMAGEN — aquí no aplica).
    // Los nombres de modelo de Gemini cambian con el tiempo (mismo motivo que la lista MODELOS de
    // 'reactivar_cupones' más abajo): se prueban varios en orden y manda el primero que responda 200.
    const MODELOS_VISION = ['gemini-3.6-flash', 'gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-1.5-flash'];
    let gRes = null, ultimoErrorGemini = null;
    for (const modelo of MODELOS_VISION) {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: prompt }] }],
          generationConfig: { temperature: 0.2 }
        })
      }).catch(() => null);
      if (r && r.status === 200) { gRes = r; break; }
      ultimoErrorGemini = r ? (await r.text().catch(() => '')).slice(0, 300) : 'sin respuesta';
    }
    if (!gRes) return res.status(502).json({ error: 'Gemini error', detail: ultimoErrorGemini });
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
  /* ── CÓDIGOS ÚNICOS EN MASA ─────────────────────────────────────────────────
     N códigos irrepetibles de UN SOLO USO atados a un descuento ("500 para los influencers de
     agosto"). Shopify lo tiene SOLO en el plan Plus. Las reglas (vigencia, mínimos, piso, origen)
     siguen viviendo en `discounts`; aquí solo viven los TEXTOS — meter 5.000 filas casi idénticas
     en `discounts` habría sido el error.
     Alfabeto sin 0/O ni 1/I/L: el código se dicta por WhatsApp y se teclea en el celular. */
  if (action === 'generar_codigos') {
    const d = data || {};
    const did = parseInt(d.discount_id, 10);
    const n = Math.min(Math.max(parseInt(d.cantidad, 10) || 0, 1), 2000);
    const lote = cleanText(d.lote, 40) || null;
    if (!Number.isFinite(did)) return res.status(400).json({ error: 'discount_id requerido' });
    const { data: dd } = await sb.from('discounts').select('id,codigo').eq('id', did).single();
    if (!dd) return res.status(404).json({ error: 'ese descuento no existe' });
    if (dd.codigo) return res.status(400).json({ error: 'ese descuento ya tiene un código fijo: los lotes son para descuentos SIN código (crea uno automático)' });
    const ALF = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const gen = () => { let s = ''; for (let i = 0; i < 6; i++) s += ALF[crypto.randomInt(ALF.length)]; return (d.prefijo ? String(d.prefijo).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 12) + '-' : '') + s; };
    let creados = 0;
    // Por lotes con ON CONFLICT implícito: el índice único es el candado real anti-colisión
    // (31^6 ≈ 887M), y se reintenta hasta completar N. Mismo patrón que genWelcomeCode.
    for (let intento = 0; intento < 6 && creados < n; intento++) {
      const faltan = n - creados;
      const filas = Array.from({ length: faltan }, () => ({ discount_id: did, codigo: gen(), lote }));
      const { data: ins } = await sb.from('discount_codes').insert(filas).select('id');
      if (ins && ins.length) { creados += ins.length; continue; }
      // Colisión en el lote entero: reintentar de uno en uno para no perder los buenos
      for (const f of filas) {
        const { error } = await sb.from('discount_codes').insert(f);
        if (!error) creados++;
        if (creados >= n) break;
      }
    }
    return res.json({ ok: true, creados, lote });
  }

  if (action === 'list_codigos') {
    const did = parseInt((data || {}).discount_id, 10);
    if (!Number.isFinite(did)) return res.status(400).json({ error: 'discount_id requerido' });
    const { data: cs, error } = await sb.from('discount_codes').select('codigo,lote,usado_at,cliente')
      .eq('discount_id', did).order('created_at', { ascending: false }).limit(3000);
    if (error) return res.status(500).json({ error: error.message });
    const total = (cs || []).length, usados = (cs || []).filter(c => c.usado_at).length;
    if ((data || {}).csv) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="codigos.csv"');
      return res.status(200).send('codigo,lote,usado\n' + (cs || []).map(c => `${c.codigo},${c.lote || ''},${c.usado_at ? 'si' : 'no'}`).join('\n'));
    }
    return res.json({ ok: true, total, usados, disponibles: total - usados, codigos: (cs || []).slice(0, 200) });
  }

  /* ── REVISAR PENDIENTES EN LA PASARELA ──────────────────────────────────────
     El cron solo mira 30 días atrás; esto NO tiene límite de fecha y lo dispara el dueño cuando
     quiere. Le pregunta a Sistecrédito/Bold/Wompi el estado REAL de cada pedido colgado.
     · data.seco = true  → SOLO consulta y reporta. No escribe NADA. Es el modo con el que se
       responde "¿cuánto de esta plata colgada es venta de verdad?" sin tocar un peso.
     · Los pagados de MÁS de 7 días se confirman en modo SILENCIOSO: entran a la caja pero no se
       le manda a Meta un Purchase de hace semanas (le acreditaría la venta a una campaña actual
       que no la generó) ni un Telegram fuera de tiempo. Los recientes van por el camino normal.
     Addi NO tiene API de estado (ver api/_addi.js): solo se listan para revisarlos a mano. */
  if (action === 'revisar_pendientes') {
    const seco = !!(data && data.seco);
    const { data: pend, error: ePend } = await sb.from('orders').select('*')
      .eq('status', 'pending').in('pago', ['wompi', 'bold', 'sistecredito', 'addi'])
      .order('created_at', { ascending: false }).limit(200);
    if (ePend) return res.status(500).json({ error: ePend.message });
    const reales = (pend || []).filter(o => !(o.utm && o.utm.test));
    const filas = [];
    let pagados = 0, montoPagado = 0;
    for (const o of reales) {
      const dias = Math.round((Date.now() - new Date(o.created_at).getTime()) / 864e5);
      const monto = Number(o.subtotal != null ? o.subtotal : (o.total || 0));
      const base = { id: o.id, reference: o.reference, pago: o.pago, dias, monto, nombre: o.nombre, tel: o.tel };
      let estado = 'sin_id', detalle = null;
      try {
        if (o.pago === 'sistecredito') {
          const txn = o.utm && o.utm.sc_txn;
          if (!txn) estado = 'sin_id';
          else if (!process.env.SISTECREDITO_SUBSCRIPTION_KEY) { estado = 'error'; detalle = 'falta SISTECREDITO_SUBSCRIPTION_KEY'; }
          else {
            const sc = await getScInfo(txn);
            // Un 401/403 NO es "no pagó": es que no pudimos preguntar. Se marca como error para
            // que salte a la vista en vez de dar la venta por perdida en silencio.
            if (!sc.ok) { estado = 'error'; detalle = `Sistecrédito HTTP ${sc.http}`; }
            else { estado = sc.paid ? 'pagado' : 'no_pagado'; detalle = `Sistecrédito HTTP ${sc.http} · estado ${sc.raw === null ? 'sin dato' : sc.raw}`; }
          }
        } else if (o.pago === 'bold') {
          const link = o.utm && o.utm.bold_link;
          const key = (process.env.BOLD_API_KEY || '').trim();
          if (!link) estado = 'sin_id';
          else if (!key) { estado = 'error'; detalle = 'falta BOLD_API_KEY'; }
          else {
            const r = await fetch('https://integrations.api.bold.co/online/link/v1/' + encodeURIComponent(link),
              { headers: { Authorization: 'x-api-key ' + key } });
            const j = r.ok ? await r.json().catch(() => null) : null;
            const st = j && (j.payload || j).status;
            if (!r.ok) { estado = 'error'; detalle = `Bold HTTP ${r.status}`; }
            else { estado = st === 'PAID' ? 'pagado' : 'no_pagado'; detalle = `Bold HTTP ${r.status} · ${st || 'sin estado'}`; }
          }
        } else if (o.pago === 'addi') {
          // Addi no expone consulta de estado: queda para revisar a mano en su portal.
          estado = 'revisar_a_mano'; detalle = 'Addi no tiene API de consulta';
        } else {
          const key = (process.env.WOMPI_PRIVATE_KEY || '').trim();
          if (!key) { estado = 'error'; detalle = 'falta WOMPI_PRIVATE_KEY'; }
          else {
            const r = await fetch('https://production.wompi.co/v1/transactions?reference=' + encodeURIComponent(o.reference),
              { headers: { Authorization: 'Bearer ' + key } });
            const j = r.ok ? await r.json().catch(() => null) : null;
            if (!r.ok) { estado = 'error'; detalle = `Wompi HTTP ${r.status}`; }
            else {
              const txs = (j && Array.isArray(j.data)) ? j.data : [];
              estado = txs.some(t => t.status === 'APPROVED') ? 'pagado' : 'no_pagado';
              detalle = `Wompi HTTP ${r.status} · ${txs.length} transacción${txs.length === 1 ? '' : 'es'}${txs.length ? ' · ' + [...new Set(txs.map(t => t.status))].join('/') : ''}`;
            }
          }
        }
      } catch (e) { estado = 'error'; detalle = String(e.message || e).slice(0, 120); }

      if (estado === 'pagado') { pagados++; montoPagado += monto; }
      if (!seco) {
        if (estado === 'pagado') {
          // >7 días = rescate silencioso; reciente = confirmación normal (ahí la conversión sí es actual).
          const c = await confirmPaidOrder({
            reference: o.reference, amount: monto, currency: 'COP', req,
            origen: 'revision_manual', silencioso: dias > 7
          });
          base.aplicado = c.ok ? (c.silencioso ? 'venta_silenciosa' : 'venta') : ('error: ' + c.error);
        } else if (estado === 'no_pagado' || estado === 'error') {
          await sb.from('orders').update({
            utm: Object.assign({}, o.utm || {}, { ultima_revision: { at: new Date().toISOString(), resultado: detalle || estado } })
          }).eq('id', o.id).then(() => {}, () => {});
        } else if (estado === 'sin_id' || estado === 'revisar_a_mano') {
          if (!(o.utm && o.utm.needs_manual_review)) {
            await sb.from('orders').update({ utm: Object.assign({}, o.utm || {}, { needs_manual_review: true }) }).eq('id', o.id).then(() => {}, () => {});
          }
        }
      }
      filas.push(Object.assign(base, { estado, detalle }));
    }
    return res.json({ ok: true, seco, revisados: filas.length, pagados, monto_pagado: montoPagado, filas });
  }

  /* ── PROBAR PASARELAS ──
     Responde "¿de verdad estamos hablando con Wompi, Bold y Sistecrédito?" sin esperar a que haya
     un pedido pendiente. Se les pregunta por una referencia que NO existe: la respuesta correcta
     es 200 con lista vacía o 404 — ambas prueban que la credencial fue aceptada. Un 401/403 dice
     que la llave está mala, que es justo el fallo que antes se disfrazaba de "no pagado". */
  if (action === 'probar_pasarelas') {
    const PING = 'PING-NOEXISTE-' + Date.now();
    const out = [];
    /* Lo único que delata una llave mala es un 401/403. Un 404 (link inexistente) o incluso un
       500 son respuestas a una referencia que INVENTAMOS: prueban que el servidor nos atendió.
       Etiquetar un 500 como "sin respuesta" sería una falsa alarma — y las falsas alarmas hacen
       que se deje de mirar el chequeo. */
    const juzgar = (http) => !http ? 'sin respuesta'
                          : (http === 401 || http === 403) ? 'CREDENCIAL RECHAZADA'
                          : (http >= 200 && http < 500) ? 'conectado'
                          : 'conectado (contestó ' + http + ' a una referencia falsa)';

    // Wompi
    const wk = (process.env.WOMPI_PRIVATE_KEY || '').trim();
    if (!wk) out.push({ pasarela: 'Wompi', estado: 'sin llave', detalle: 'falta WOMPI_PRIVATE_KEY' });
    else try {
      const r = await fetch('https://production.wompi.co/v1/transactions?reference=' + PING, { headers: { Authorization: 'Bearer ' + wk } });
      const j = await r.json().catch(() => null);
      out.push({ pasarela: 'Wompi', http: r.status, estado: juzgar(r.status), detalle: j && Array.isArray(j.data) ? `respondió con ${j.data.length} transacciones` : 'respondió sin lista' });
    } catch (e) { out.push({ pasarela: 'Wompi', estado: 'sin respuesta', detalle: String(e.message || e).slice(0, 90) }); }

    // Bold
    const bk = (process.env.BOLD_API_KEY || '').trim();
    if (!bk) out.push({ pasarela: 'Bold', estado: 'sin llave', detalle: 'falta BOLD_API_KEY' });
    else try {
      const r = await fetch('https://integrations.api.bold.co/online/link/v1/' + PING, { headers: { Authorization: 'x-api-key ' + bk } });
      out.push({ pasarela: 'Bold', http: r.status, estado: juzgar(r.status), detalle: r.status === 404 ? 'link inexistente (respuesta esperada)' : 'respondió' });
    } catch (e) { out.push({ pasarela: 'Bold', estado: 'sin respuesta', detalle: String(e.message || e).slice(0, 90) }); }

    // Sistecrédito
    if (!process.env.SISTECREDITO_SUBSCRIPTION_KEY) out.push({ pasarela: 'Sistecrédito', estado: 'sin llave', detalle: 'falta SISTECREDITO_SUBSCRIPTION_KEY' });
    else try {
      const sc = await getScInfo(PING);
      out.push({ pasarela: 'Sistecrédito', http: sc.http, estado: juzgar(sc.http), detalle: 'transactionStatus: ' + (sc.raw === null ? 'sin dato (referencia inexistente)' : sc.raw) });
    } catch (e) { out.push({ pasarela: 'Sistecrédito', estado: 'sin respuesta', detalle: String(e.message || e).slice(0, 90) }); }

    // Addi no tiene API de consulta de estado: se documenta, no se inventa un check.
    out.push({ pasarela: 'Addi', estado: 'sin API', detalle: 'no expone consulta de estado — sus pedidos se revisan a mano en el portal' });

    return res.json({ ok: true, probado_con: PING, pasarelas: out });
  }

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

  /* ── AGENTE DE TAREAS ──
     Autonomía acordada con el dueño: ejecuta SOLO lo que no toca al cliente y deja los WhatsApp
     REDACTADOS EN COLA para que él los suelte. Nada sale a un cliente sin su clic — un mensaje
     mal escrito no se puede deshacer.
     Coste cero: la redacción usa Gemini (GEMINI_API_KEY, ya en producción por el IA Studio) en su
     capa gratuita, y si falla o no está, cae a las plantillas de siempre. El agente NUNCA depende
     de la IA para funcionar: la IA solo mejora el texto. */
  if (action === 'agente_tareas') {
    const seco = !!(data && data.seco);
    const hechas = [], cola = [];
    const AHORA = Date.now(), DIA = 86400000;
    const telKey = t => String(t || '').replace(/\D/g, '').slice(-10);
    const nombreCorto = n => String(n || '').trim().split(/\s+/)[0] || '';
    const hoyISO = new Date().toISOString().slice(0, 10);

    const { data: subs } = await sb.from('subscribers')
      .select('id,nombre,whatsapp,welcome_code,welcome_issued_at,welcome_used_at')
      .order('created_at', { ascending: false }).limit(1000);
    const { data: ords } = await sb.from('orders')
      .select('id,tel,status,nombre,items,utm,fecha,created_at,seguimiento,wa_status,temperatura').limit(2000);

    const reales = (ords || []).filter(o => !(o.utm && o.utm.test));
    const compraron = new Set(reales.filter(o => o.status === 'venta').map(o => telKey(o.tel)).filter(Boolean));

    // OJO: en items, `label` es el GÉNERO ("Mujer"/"Hombre"), no el nombre del producto. Lo que
    // sirve para hablarle al cliente es la MARCA y la TALLA. Decir "te interesaron los Hombre"
    // es exactamente el tipo de mensaje que quema la venta que intenta rescatar.
    const MARCAS = { adidas:'Adidas', nike:'Nike', reebok:'Reebok', new_balance:'New Balance', on_cloud:'On Cloud',
                     puma:'Puma', lecoq_sportif:'Le Coq Sportif', jordan:'Jordan', lacoste:'Lacoste',
                     asics:'Asics', onitsuka_tiger:'Onitsuka Tiger', converse:'Converse', luxury:'Luxury' };
    const productosDe = o => (Array.isArray(o.items) ? o.items : []).slice(0, 2).map(i => {
      const marca = MARCAS[i.brand] || (i.brand ? String(i.brand).replace(/_/g, ' ') : '');
      return marca ? (marca + (i.talla ? ' talla ' + i.talla : '')) : '';
    }).filter(Boolean).join(' y ');

    /* ── 1. LO QUE HACE SOLO: reactivar cupones vencidos de quien nunca compró ──
       Tope 10 y solo con WhatsApp: reactivar un cupón sin poder avisarle a nadie es un no-op. */
    const vencidos = (subs || []).filter(s =>
      s.welcome_issued_at && !s.welcome_used_at && telKey(s.whatsapp) &&
      !compraron.has(telKey(s.whatsapp)) &&
      (AHORA - new Date(s.welcome_issued_at).getTime()) > 7 * DIA
    ).slice(0, 10);
    if (vencidos.length && !seco) {
      const iso = new Date().toISOString();
      for (const s of vencidos) {
        await sb.from('subscribers').update({ welcome_issued_at: iso, welcome_used_at: null }).eq('id', s.id);
      }
    }
    if (vencidos.length) hechas.push({ tarea: 'Cupones de bienvenida reactivados (7 días nuevos)', n: vencidos.length, detalle: vencidos.slice(0, 5).map(s => s.nombre || s.whatsapp) });

    /* ── 2. CANDIDATOS A MENSAJE, por prioridad ──
       Una misma persona puede caer en varias listas (dejó el carrito Y se le vence el cupón).
       Se le escribe UNA vez, por el motivo más valioso: escribirle dos veces el mismo día es la
       forma más rápida de que te bloqueen. */
    /* El código que hay que DICTARLE al cliente. Los suscriptores viejos no tienen código único
       (welcome_code null): esos usan el genérico BIENVENIDO20, que el server valida
       identificándolos por su teléfono contra subscribers (api/_orders.js). Mandar el mensaje sin
       código dejaba al cliente sin saber qué escribir en el carrito — el cupón existía y no
       servía. */
    const codigoDe = s => s.welcome_code || 'BIENVENIDO20';

    const cand = [];
    const push = (prio, motivo, tel, nombre, contexto, extra) => {
      const t = telKey(tel); if (!t) return;
      cand.push(Object.assign({ prio, motivo, tel: t, nombre: nombre || '', contexto: contexto || '' }, extra || {}));
    };

    // (a) Pedido sin terminar — el más caliente: ya llenó datos y eligió cómo pagar
    reales.filter(o => o.status !== 'venta' && o.status !== 'no_venta' && o.status !== 'abandoned')
      .forEach(o => push(1, 'Pedido sin terminar', o.tel, o.nombre, productosDe(o)));

    // (b) Seguimiento con fecha cumplida — tú mismo te lo agendaste
    reales.filter(o => o.seguimiento && o.seguimiento <= hoyISO && o.status !== 'venta' && o.status !== 'no_venta')
      .forEach(o => push(2, 'Seguimiento agendado', o.tel, o.nombre, productosDe(o)));

    // (c) Carrito abandonado — dejó datos y se fue sin confirmar.
    //     Ventana de 7 días, no de 24h: con este volumen (5 abandonados en total, el más reciente
    //     de hace semanas) una ventana de un día deja la lista vacía siempre y no automatiza nada.
    reales.filter(o => o.status === 'abandoned' && (AHORA - new Date(o.fecha || o.created_at).getTime()) < 7 * DIA)
      .forEach(o => {
        const d = Math.floor((AHORA - new Date(o.fecha || o.created_at).getTime()) / DIA);
        push(3, d <= 1 ? 'Carrito abandonado hoy' : 'Carrito abandonado hace ' + d + ' días', o.tel, o.nombre, productosDe(o));
      });

    // (d) Cupón que vence en 1-3 días y nunca compró — la urgencia es real, no inventada
    (subs || []).forEach(s => {
      if (!s.welcome_issued_at || s.welcome_used_at) return;
      if (compraron.has(telKey(s.whatsapp))) return;
      const quedan = 7 - Math.floor((AHORA - new Date(s.welcome_issued_at).getTime()) / DIA);
      if (quedan >= 1 && quedan <= 3) {
        push(4, 'Cupón vence en ' + quedan + (quedan === 1 ? ' día' : ' días'), s.whatsapp, s.nombre, '', { dias: quedan, codigo: codigoDe(s) });
      }
    });

    // (e) Cupón que se acaba de reactivar arriba
    vencidos.forEach(s => push(5, 'Cupón reactivado', s.whatsapp, s.nombre, '', { codigo: codigoDe(s) }));

    // Dedup por teléfono: se queda el motivo de mayor prioridad (número menor)
    const porTel = new Map();
    cand.sort((a, b) => a.prio - b.prio).forEach(c => { if (!porTel.has(c.tel)) porTel.set(c.tel, c); });
    const elegidos = [...porTel.values()].slice(0, 40);

    /* ── 3. REDACCIÓN ── plantilla propia por motivo (siempre existe) y, si la IA responde, la mejora. */
    const plantillas = {
      1: c => (c.nombre ? '¡Hola ' + nombreCorto(c.nombre) + '! 👋' : '¡Hola! 👋') + ' Te escribo de Strange Sneakers.'
            + (c.contexto ? ' Vi que te interesaron unos ' + c.contexto + '.' : '')
            + '\n\n¿Te ayudo a completar tu pedido? 🙌 Pagando en línea el *envío es GRATIS*, o contra entrega pagas solo el envío hoy y los zapatos al recibir. ¿Te lo aparto?',
      2: c => (c.nombre ? '¡Hola ' + nombreCorto(c.nombre) + '! 👋' : '¡Hola! 👋') + ' Te escribo como quedamos.'
            + (c.contexto ? ' ¿Seguiste pensando en los ' + c.contexto + '?' : '')
            + '\n\nSi quieres te lo aparto hoy. Pagando en línea el envío es GRATIS 🙌',
      3: c => (c.nombre ? '¡Hola ' + nombreCorto(c.nombre) + '! 👋' : '¡Hola! 👋') + ' Vi que dejaste tu carrito a medias'
            + (c.contexto ? ' con unos ' + c.contexto : '') + ' 👟'
            + '\n\n¿Te ayudo a terminarlo? Pagando en línea el *envío es GRATIS*, o contra entrega pagas solo el envío hoy.',
      4: c => (c.nombre ? '¡Hola ' + nombreCorto(c.nombre) + '! 👋' : '¡Hola! 👋') + ' Te recuerdo que tu cupón de *$20.000 OFF*'
            + (c.codigo ? ' (' + c.codigo + ')' : '') + ' vence en ' + c.dias + (c.dias === 1 ? ' día' : ' días') + ' ⏳'
            + '\n\n¿Te muestro lo que tenemos en tu talla? Pagando en línea el envío es GRATIS.',
      5: c => (c.nombre ? '¡Hola ' + nombreCorto(c.nombre) + '! 👋' : '¡Hola! 👋') + ' Te reactivé tu cupón de *$20.000 OFF*'
            + (c.codigo ? ' (' + c.codigo + ')' : '') + ': vuelve a estar vigente por 7 días 🎁'
            + '\n\n¿Te muestro lo que acaba de entrar? Pagando en línea el envío es GRATIS.'
    };

    let redactados = null, modeloUsado = null, ultimoErrorIA = null;
    const GKEY = (process.env.GEMINI_API_KEY || '').trim();
    if (GKEY && elegidos.length) {
      const fichas = elegidos.map((c, i) =>
        (i + 1) + '. Nombre: ' + (nombreCorto(c.nombre) || '(sin nombre)')
        + ' | Situación: ' + c.motivo
        + ' | Le interesó: ' + (c.contexto || '(no se sabe)')
        + (c.codigo ? ' | Cupón: ' + c.codigo : '')
      ).join('\n');
      const prompt = 'Eres quien atiende el WhatsApp de Strange Sneakers, una tienda colombiana de sneakers. Escribe UN mensaje corto para cada persona de la lista, ajustado a SU situación.\n'
        + 'Reglas: tuteo colombiano, cálido y directo, máximo 45 palabras, máximo 2 emojis, sin decir "estimado", sin inventar descuentos ni plazos que no estén en la ficha. Si hay cupón, menciónalo. Menciona que pagando en línea el envío es gratis y que también hay contra entrega. Termina con una pregunta corta.\n'
        + 'Devuelve SOLO un JSON array de strings, un mensaje por persona, en el mismo orden. Sin texto adicional.\n\nPersonas:\n' + fichas;
      // Los nombres de modelo de Gemini cambian con el tiempo: se prueban varios y manda el
      // primero que conteste. Si ninguno responde, caen las plantillas y el agente igual sirve.
      const MODELOS = ['gemini-3.6-flash', 'gemini-2.0-flash', 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-1.5-flash'];
      const pedir = (modelo) => new Promise((resolve) => {
        const body = Buffer.from(JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }));
        const rq = require('https').request({
          hostname: 'generativelanguage.googleapis.com',
          path: '/v1beta/models/' + modelo + ':generateContent',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'x-goog-api-key': GKEY }
        }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } }); });
        rq.on('error', () => resolve(null));
        rq.setTimeout(25000, () => { rq.destroy(); resolve(null); });
        rq.end(body);
      });
      for (const modelo of MODELOS) {
        try {
          const gr = await pedir(modelo);
          const txt = gr && gr.candidates && gr.candidates[0] && gr.candidates[0].content
            && gr.candidates[0].content.parts && gr.candidates[0].content.parts[0]
            && gr.candidates[0].content.parts[0].text;
          if (txt) {
            const m = String(txt).match(/\[[\s\S]*\]/);
            if (m) {
              const arr = JSON.parse(m[0]);
              if (Array.isArray(arr) && arr.length) { redactados = arr; modeloUsado = modelo; break; }
            }
          }
          if (gr && gr.error) ultimoErrorIA = String(gr.error.message || '').slice(0, 120);
        } catch (e) { ultimoErrorIA = String(e.message || '').slice(0, 120); }
      }
    }

    elegidos.forEach((c, i) => {
      const ia = redactados && typeof redactados[i] === 'string' && redactados[i].trim();
      cola.push({
        tel: c.tel, nombre: c.nombre, motivo: c.motivo, ia: !!ia,
        mensaje: ia ? redactados[i].trim() : plantillas[c.prio](c)
      });
    });

    const resumen = {};
    cola.forEach(c => { resumen[c.motivo] = (resumen[c.motivo] || 0) + 1; });

    return res.json({
      ok: true, seco, hechas, cola, resumen,
      descartados_por_duplicado: cand.length - porTel.size,
      ia: redactados ? ('IA ' + modeloUsado)
        : (GKEY ? ('plantilla — la IA no respondió' + (ultimoErrorIA ? ': ' + ultimoErrorIA : ''))
                : 'plantilla (sin GEMINI_API_KEY)')
    });
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
        // generos/tipos/excluir_promo: filtros AND encima de la selección. ⚠️ Se OMITEN cuando no
        // hay nada marcado — guardar generos:['h','m','u'] "por defecto" rompería en silencio todo
        // descuento que cubra liquidación, porque liq_products no tiene género (queda null).
        const generos = Array.isArray(d.aplica.generos)
          ? d.aplica.generos.map(s => String(s).trim().toLowerCase()).filter(s => ['h', 'm', 'u'].includes(s)) : [];
        const tipos = Array.isArray(d.aplica.tipos)
          ? d.aplica.tipos.map(s => String(s).trim().toLowerCase()).filter(s => ['cat', 'liq'].includes(s)) : [];
        if (Array.isArray(d.aplica.generos) && d.aplica.generos.length && !generos.length) {
          return res.status(400).json({ error: 'género inválido: usa h (hombre), m (mujer) o u (unisex)' });
        }
        if (Array.isArray(d.aplica.tipos) && d.aplica.tipos.length && !tipos.length) {
          return res.status(400).json({ error: 'tipo inválido: usa cat (catálogo) o liq (liquidación)' });
        }
        const ap = {};
        if (ids.length) ap.ids = ids;
        if (marcas.length) ap.marcas = marcas;
        if (generos.length && generos.length < 3) ap.generos = generos;   // los 3 = sin filtro
        if (tipos.length && tipos.length < 2) ap.tipos = tipos;
        if (d.aplica.excluir_promo) ap.excluir_promo = true;
        upd.aplica = Object.keys(ap).length ? ap : null;
      }
    }
    // origen: el descuento solo vale si el cliente viene de cierta campaña de Meta. Shopify no
    // puede expresar esto. Se sanea a listas de texto corto; el motor lo VERIFICA contra events.
    if ('origen' in d) {
      if (d.origen == null) upd.origen = null;
      else {
        const lista = (v, n) => Array.isArray(v) ? v.map(s => String(s).trim().slice(0, 60)).filter(Boolean).slice(0, n) : [];
        const o = {};
        const c = lista(d.origen.campaigns, 20), s = lista(d.origen.sources, 10), l = lista(d.origen.campaign_like, 10);
        if (c.length) o.campaigns = c;
        if (s.length) o.sources = s.map(x => x.toLowerCase());
        if (l.length) o.campaign_like = l.map(x => x.toLowerCase());
        upd.origen = Object.keys(o).length ? o : null;
      }
    }
    // cliente: elegibilidad por historial con criterios ABSOLUTOS (no etiquetas RFM, que son
    // relativas a toda la base, cambian solas y ya dieron un fallo real).
    if ('cliente' in d) {
      if (d.cliente == null) upd.cliente = null;
      else {
        const num = (v, max) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 && n <= max ? n : null; };
        const c = {};
        const cm = num(d.cliente.compras_min, 999), cM = num(d.cliente.compras_max, 999);
        const dm = num(d.cliente.dias_desde_ultima_min, 3650), dM = num(d.cliente.dias_desde_ultima_max, 3650);
        if (cm != null) c.compras_min = cm;
        if (cM != null) c.compras_max = cM;
        if (dm != null) c.dias_desde_ultima_min = dm;
        if (dM != null) c.dias_desde_ultima_max = dM;
        if (cm != null && cM != null && cM < cm) return res.status(400).json({ error: 'compras_max menor que compras_min' });
        if (dm != null && dM != null && dM < dm) return res.status(400).json({ error: 'el rango de días está invertido' });
        upd.cliente = Object.keys(c).length ? c : null;
      }
    }
    if ('valor_alcance' in d) {
      const va = String(d.valor_alcance || 'pedido');
      if (!['pedido', 'articulo'].includes(va)) return res.status(400).json({ error: 'valor_alcance inválido' });
      upd.valor_alcance = va;
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
