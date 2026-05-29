const crypto = require('crypto');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { amount, reference } = req.query;
  if (!amount || !reference) return res.status(400).json({ error: 'missing params' });
  const amountInt = parseInt(amount, 10);
  if (isNaN(amountInt) || amountInt <= 0) return res.status(400).json({ error: 'amount must be a positive integer' });
  const safeRef = String(reference).slice(0, 100);
  const key = process.env.WOMPI_PRIVATE_KEY;
  if (!key) return res.status(500).json({ error: 'WOMPI_PRIVATE_KEY not configured' });
  const signature = crypto.createHash('sha256').update(`${safeRef}${amountInt}COP${key}`).digest('hex');
  res.json({ signature, reference });
};
