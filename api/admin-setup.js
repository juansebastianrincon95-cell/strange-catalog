const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { safeEq, makeSession, cookieHeader, clearCookieHeader } = require('./_admin_auth');

const MAX_ATTEMPTS = 5;
const WINDOW_MS    = 15 * 60 * 1000; // 15 minutos

async function getRateLimit(sb, ipHash) {
  const key = `rl:setup:${ipHash}`;
  const { data } = await sb.from('settings').select('value').eq('key', key).single();
  if (!data) return { key, count: 0, ts: Date.now() };
  try {
    const v = JSON.parse(data.value);
    return { key, count: v.count || 0, ts: v.ts || 0 };
  } catch { return { key, count: 0, ts: Date.now() }; }
}

async function setRateLimit(sb, key, count, ts) {
  await sb.from('settings').upsert({ key, value: JSON.stringify({ count, ts }) });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  if (req.body && req.body.action === 'logout') {
    res.setHeader('Set-Cookie', clearCookieHeader());
    return res.json({ ok: true });
  }

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const rl = await getRateLimit(sb, ipHash);
  const now = Date.now();

  // Resetear ventana si expiró
  if (now - rl.ts > WINDOW_MS) { rl.count = 0; rl.ts = now; }

  if (rl.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - rl.ts)) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({ error: 'Demasiados intentos. Intenta de nuevo más tarde.' });
  }

  const { pin } = req.body || {};
  if (!process.env.ADMIN_SESSION_SECRET) {
    return res.status(500).json({ error: 'ADMIN_SESSION_SECRET not configured' });
  }
  if (!pin || !process.env.ADMIN_PIN || !safeEq(String(pin).trim(), process.env.ADMIN_PIN.trim())) {
    await setRateLimit(sb, rl.key, rl.count + 1, rl.ts);
    // Delay artificial para frenar brute force
    await new Promise(r => setTimeout(r, 1500));
    return res.status(401).json({ error: 'PIN incorrecto' });
  }

  // Login exitoso: limpiar contador
  await setRateLimit(sb, rl.key, 0, now);
  res.setHeader('Set-Cookie', cookieHeader(makeSession()));
  return res.json({ ok: true });
};
