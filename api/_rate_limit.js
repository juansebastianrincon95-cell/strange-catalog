/* Rate limit con dos modos:
   1) GLOBAL (compartido entre instancias) si hay un store REST tipo Upstash / Vercel KV configurado
      (UPSTASH_REDIS_REST_URL+TOKEN  o  KV_REST_API_URL+TOKEN). Usa INCR + EXPIRE vía REST con fetch,
      sin dependencias npm.
   2) FALLBACK en memoria (Map por instancia) si no hay store o si el store falla. No es global pero
      sirve de freno básico y nunca rompe la petición. */

const buckets = new Map();

function clientKey(req, scope) {
  // x-real-ip lo pone Vercel con la IP real del cliente y NO es sobre-escribible por el cliente.
  // x-forwarded-for SÍ es falsificable (el cliente puede prepender valores), por eso va de fallback.
  const ip = String(
    req.headers['x-real-ip'] ||
    (req.headers['x-forwarded-for'] || '').split(',')[0] ||
    req.socket?.remoteAddress || 'unknown'
  ).trim() || 'unknown';
  return `${scope}:${ip}`;
}

function kvConfig() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim().replace(/\/+$/, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();
  return url && token ? { url, token } : null;
}

// Cuenta en memoria. Devuelve true si DENTRO del límite.
function memoryAllow(key, max, windowMs) {
  const now = Date.now();
  const cur = buckets.get(key);
  const bucket = cur && now - cur.ts < windowMs ? cur : { ts: now, count: 0 };
  bucket.count += 1;
  buckets.set(key, bucket);
  return { ok: bucket.count <= max, retryAfter: Math.ceil((windowMs - (now - bucket.ts)) / 1000) };
}

// Cuenta en el store REST (global). Lanza si el store no responde -> el caller cae a memoria.
async function kvAllow(cfg, key, max, windowMs) {
  const ttl = Math.ceil(windowMs / 1000);
  const headers = { Authorization: `Bearer ${cfg.token}` };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500); // el rate limit nunca debe colgar la request
  try {
    const r = await fetch(`${cfg.url}/incr/${encodeURIComponent(key)}`, { headers, signal: ctrl.signal });
    if (!r.ok) throw new Error('kv incr ' + r.status);
    const count = Number((await r.json()).result);
    if (count === 1) {
      // primer hit de la ventana -> fija expiración (best-effort)
      await fetch(`${cfg.url}/expire/${encodeURIComponent(key)}/${ttl}`, { headers, signal: ctrl.signal }).catch(() => {});
    }
    return { ok: count <= max, retryAfter: ttl };
  } finally {
    clearTimeout(timer);
  }
}

async function rateLimit(req, res, { scope = 'default', max = 60, windowMs = 60_000 } = {}) {
  const key = clientKey(req, scope);
  const cfg = kvConfig();
  let result;
  if (cfg) {
    try {
      result = await kvAllow(cfg, key, max, windowMs);
    } catch {
      result = memoryAllow(key, max, windowMs); // store caído -> freno en memoria
    }
  } else {
    result = memoryAllow(key, max, windowMs);
  }
  if (!result.ok) {
    res.setHeader('Retry-After', result.retryAfter);
    res.status(429).json({ error: 'Too many requests' });
    return false;
  }
  return true;
}

module.exports = { rateLimit };
