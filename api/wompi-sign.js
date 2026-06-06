const crypto = require('crypto');
const { getOrderByReference } = require('./_orders');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const reference = req.query && req.query.reference ? String(req.query.reference).slice(0, 100) : '';
  if (!reference) return res.status(400).json({ error: 'missing reference' });
  const order = await getOrderByReference(reference);
  if (!order) return res.status(404).json({ error: 'order_not_found' });
  const expected = Number(order.subtotal != null ? order.subtotal : order.total);
  const amountInt = expected * 100;
  if (!Number.isFinite(amountInt) || amountInt <= 0) return res.status(400).json({ error: 'invalid order amount' });
  const key = process.env.WOMPI_PRIVATE_KEY;
  if (!key) return res.status(500).json({ error: 'WOMPI_PRIVATE_KEY not configured' });
  const signature = crypto.createHash('sha256').update(`${reference}${amountInt}COP${key}`).digest('hex');
  res.json({ signature, reference, amount_in_cents: amountInt });
};
