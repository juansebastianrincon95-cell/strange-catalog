const crypto = require('crypto');

const COOKIE = 'ss_admin_session';
const MAX_AGE = 8 * 60 * 60; // 8 horas

function safeEq(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

function secret() {
  return (process.env.ADMIN_SESSION_SECRET || '').trim();
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex');
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(p => {
    const i = p.indexOf('=');
    if (i < 0) return null;
    return [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1).trim())];
  }).filter(Boolean));
}

function makeSession() {
  const payload = JSON.stringify({
    iat: Date.now(),
    exp: Date.now() + MAX_AGE * 1000,
    nonce: crypto.randomBytes(12).toString('hex')
  });
  const b64 = Buffer.from(payload).toString('base64url');
  return `${b64}.${sign(b64)}`;
}

function cookieHeader(value) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${secure}`;
}

function clearCookieHeader() {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

function validateSession(req) {
  const s = secret();
  if (!s) return false;
  const raw = parseCookies(req)[COOKIE];
  if (!raw || !raw.includes('.')) return false;
  const [b64, mac] = raw.split('.');
  if (!safeEq(mac, sign(b64))) return false;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    return payload.exp && Date.now() <= payload.exp;
  } catch {
    return false;
  }
}

function requireAdmin(req, res) {
  if (!validateSession(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

/* Expiración DESLIZANTE por inactividad: cada acción del admin renueva la cookie si ya pasó
   más de la mitad de su vida. Mientras el panel se use, la sesión no caduca; tras 8h sin
   actividad, vuelve a pedir PIN. (Renovar solo a media vida evita un Set-Cookie por request.) */
function renewIfActive(req, res) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw || !raw.includes('.')) return;
  try {
    const payload = JSON.parse(Buffer.from(raw.split('.')[0], 'base64url').toString('utf8'));
    if (payload.exp && payload.exp - Date.now() < (MAX_AGE * 1000) / 2) {
      res.setHeader('Set-Cookie', cookieHeader(makeSession()));
    }
  } catch {}
}

module.exports = { safeEq, makeSession, cookieHeader, clearCookieHeader, requireAdmin, validateSession, renewIfActive };
