module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { pin } = req.body || {};
  if (!pin || !process.env.ADMIN_PIN || pin.trim() !== process.env.ADMIN_PIN.trim()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.json({ key: process.env.ADMIN_API_KEY });
};
