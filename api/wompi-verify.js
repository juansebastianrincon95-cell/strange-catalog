const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const { sendEvent } = require('./_capi');

// Consulta pública de transacción Wompi: permite verificar el estado real
// server-side en vez de confiar en el parámetro ?status= de la URL de retorno.
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const id = (req.query && req.query.id ? String(req.query.id) : '').trim();
  if (!/^[\w-]{1,80}$/.test(id)) {
    return res.status(400).json({ error: 'invalid transaction id' });
  }

  const r = await get(`https://production.wompi.co/v1/transactions/${id}`).catch(() => null);
  if (!r || r.status >= 300) return res.status(502).json({ error: 'wompi lookup failed' });

  const t = r.body && r.body.data;
  if (!t) return res.status(404).json({ error: 'transaction not found' });

  // Pago aprobado: marcar el pedido como 'venta' en la BD y enviar Purchase a Meta (CAPI).
  // Esto cierra el loop sin depender del navegador del cliente.
  if (t.status === 'APPROVED' && t.reference && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      const { data: order } = await sb.from('orders')
        .select('id,subtotal,total,tel,ciudad,nombre,status')
        .eq('reference', t.reference).single();
      if (order && order.status !== 'venta') {
        await sb.from('orders').update({ status: 'venta' }).eq('id', order.id);
        sendEvent({
          eventName: 'Purchase',
          value: order.subtotal != null ? order.subtotal : order.total,
          currency: t.currency || 'COP',
          phone: order.tel, city: order.ciudad, name: order.nombre,
          eventId: t.reference + '_purchase',   // mismo id que el Pixel del navegador → dedup
          actionSource: 'website'
        }).catch(() => {});
      }
    } catch (e) { /* no romper la respuesta de verificación */ }
  }

  return res.json({
    id:              t.id,
    status:          t.status,                 // APPROVED | DECLINED | VOIDED | ERROR | PENDING
    reference:       t.reference,
    amount_in_cents: t.amount_in_cents,
    currency:        t.currency
  });
};
