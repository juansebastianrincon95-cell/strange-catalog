const crypto = require('crypto');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { amount, reference } = req.query;
  if (!amount || !reference) return res.status(400).json({ error: 'missing params' });
  const key = process.env.WOMPI_PRIVATE_KEY;
  if (!key) return res.status(500).json({ error: 'WOMPI_PRIVATE_KEY not configured' });
  const signature = crypto.createHash('sha256').update(`${reference}${amount}COP${key}`).digest('hex');
  res.json({ signature, reference });
};
