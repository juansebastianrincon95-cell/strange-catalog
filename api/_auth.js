const crypto = require('crypto');

function safeEq(a, b) {
  const ab = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

module.exports = function requireApiKey(req, res) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !process.env.CATALOG_API_KEY || !safeEq(token, process.env.CATALOG_API_KEY)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
};
