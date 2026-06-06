const buckets = new Map();

function clientKey(req, scope) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
  return `${scope}:${ip}`;
}

function rateLimit(req, res, { scope = 'default', max = 60, windowMs = 60_000 } = {}) {
  const key = clientKey(req, scope);
  const now = Date.now();
  const cur = buckets.get(key);
  const bucket = cur && now - cur.ts < windowMs ? cur : { ts: now, count: 0 };
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count > max) {
    res.setHeader('Retry-After', Math.ceil((windowMs - (now - bucket.ts)) / 1000));
    res.status(429).json({ error: 'Too many requests' });
    return false;
  }
  return true;
}

module.exports = { rateLimit };
