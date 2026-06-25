const { createClient } = require('@supabase/supabase-js');
const { sendEvent } = require('./_capi');
const { contentIdsDe, cartSig, decrementStock } = require('./_orders');
const { generarGuia } = require('./_coordinadora');
const { requireAdmin, renewIfActive } = require('./_admin_auth');
const crypto = require('crypto');

const ALLOWED_TABLES = ['products', 'liq_products', 'settings'];
const ALLOWED_ORDER_STATUS = ['pending', 'venta', 'no_venta'];

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
    const { data: updated, error } = await sb.from('orders')
      .update({ status })
      .eq('id', id).neq('status', status)
      .select('subtotal,total,tel,ciudad,nombre,reference,status,utm,items,session_id');
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
    }
    return res.json({ ok: true });
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
      .select('id,created_at,nombre,whatsapp,email,cumple,talla,genero,utm,source,session_id,welcome_issued_at')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, subscribers: rows || [] });
  }

  // Reactivar el cupón de bienvenida de un suscriptor: renueva welcome_issued_at = ahora,
  // dándole 7 días nuevos de BIENVENIDO20 ($20.000 OFF). La validación en _orders.js usa
  // welcome_issued_at para la vigencia, así que esto rehabilita el descuento de verdad.
  if (action === 'reissue_welcome') {
    if (!id) return res.status(400).json({ error: 'id required' });
    const { error } = await sb.from('subscribers')
      .update({ welcome_issued_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  if (action === 'list_orders') {
    const { data: rows, error } = await sb
      .from('orders')
      .select('id,created_at,fecha,nombre,cedula,tel,ciudad,barrio,direccion,pago,subtotal,envio,total,pares,items,status,reference,seccion,utm,combo,cupon,wa_status,temperatura,motivo_no_venta,nota,seguimiento,session_id,guia,tracking_url,transportadora,estado_envio,recaudo')
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
