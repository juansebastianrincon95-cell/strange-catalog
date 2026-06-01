const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { sendEvent } = require('./_capi');

const ALLOWED_TABLES = ['products', 'liq_products', 'settings'];
const ALLOWED_ORDER_STATUS = ['pending', 'venta', 'no_venta'];

function safeEq(a, b) {
  const ab = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !process.env.ADMIN_API_KEY || !safeEq(token, process.env.ADMIN_API_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' });
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { action, data, table, id } = req.body || {};

  if (!action) return res.status(400).json({ error: 'action required' });

  if (action === 'upsert_settings') {
    if (!data) return res.status(400).json({ error: 'data required' });
    const rows = Array.isArray(data) ? data : [data];
    const clean = rows.filter(r => r && typeof r.key === 'string' && typeof r.value === 'string');
    if (!clean.length) return res.status(400).json({ error: 'invalid settings data' });
    const { error } = await sb.from('settings').upsert(clean);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
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

  if (action === 'list_orders') {
    const { data: rows, error } = await sb
      .from('orders')
      .select('id,created_at,fecha,nombre,tel,ciudad,barrio,pago,total,pares,items,status,reference,seccion')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true, orders: rows || [] });
  }

  return res.status(400).json({ error: 'unknown action' });
};
