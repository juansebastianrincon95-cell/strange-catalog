const { createClient } = require('@supabase/supabase-js');
const { sendEvent } = require('./_capi');
const { contentIdsDe, cartSig, decrementStock, marcarCuponBienvenidaUsado, notifyVentaTelegram } = require('./_orders');
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
  products: ['gender', 'brand', 'price', 'price_before', 'promo', 'sold', 'img_url', 'imgs_360', 'imgs', 'modelo', 'tallas'],
  liq_products: ['price', 'price_before', 'sold', 'img_url', 'imgs_360', 'imgs', 'modelo', 'tallas'],
  settings: ['key', 'value'],
};
function pickCols(table, data) {
  const allow = ALLOWED_COLS[table] || [];
  const out = {};
  for (const k of allow) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
  return out;
}

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
    const enviado = await notifyVentaTelegram(order).catch(() => false);
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
