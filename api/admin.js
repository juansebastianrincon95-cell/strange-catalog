const { createClient } = require('@supabase/supabase-js');
const { sendEvent } = require('./_capi');
const { requireAdmin } = require('./_admin_auth');
const crypto = require('crypto');

const ALLOWED_TABLES = ['products', 'liq_products', 'settings'];
const ALLOWED_ORDER_STATUS = ['pending', 'venta', 'no_venta'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  if (!requireAdmin(req, res)) return;

  if (!process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { action, data, table, id } = req.body || {};

  if (!action) return res.status(400).json({ error: 'action required' });

  if (action === 'ping') return res.json({ ok: true });

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
    const { data: row, error } = await sb.from(table).insert(data).select('id').single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, id: row.id });
  }

  if (action === 'update_product') {
    if (!table || !ALLOWED_TABLES.includes(table)) return res.status(400).json({ error: 'invalid table' });
    if (!id) return res.status(400).json({ error: 'id required' });
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data required' });
    const { error } = await sb.from(table).update(data).eq('id', id);
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

    // Leer el pedido antes de actualizar (para CAPI y para no re-disparar si ya era venta)
    const { data: order } = await sb.from('orders')
      .select('subtotal,total,tel,ciudad,nombre,reference,status,utm')
      .eq('id', id).single();

    const { error } = await sb.from('orders').update({ status }).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });

    // Si pasa a 'venta' (y no lo era ya), enviar Purchase real a Meta vía CAPI.
    // event_id idempotente por pedido → dedup con cualquier Pixel previo.
    // Nota: IP/UA NO se envían aquí (serían los del vendedor, no del cliente); sí fbp/fbc del pedido.
    if (status === 'venta' && order && order.status !== 'venta') {
      const utm = order.utm || {};
      sendEvent({
        eventName: 'Purchase',
        value: order.subtotal != null ? order.subtotal : order.total,
        currency: 'COP',
        phone: order.tel, city: order.ciudad, name: order.nombre,
        fbp: utm.fbp, fbc: utm.fbc,
        eventId: 'order_' + id + '_purchase',
        actionSource: 'business_messaging'
      }).catch(() => {});
    }
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
    if (!Object.keys(upd).length) return res.status(400).json({ error: 'nothing to update' });
    const { error } = await sb.from('orders').update(upd).eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  if (action === 'list_orders') {
    const { data: rows, error } = await sb
      .from('orders')
      .select('id,created_at,fecha,nombre,cedula,tel,ciudad,barrio,direccion,pago,subtotal,envio,total,pares,items,status,reference,seccion,utm,wa_status,temperatura,motivo_no_venta,nota')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, orders: rows || [] });
  }

  return res.status(400).json({ error: 'unknown action' });
};
