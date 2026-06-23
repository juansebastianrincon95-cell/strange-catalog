const https = require('https');
const crypto = require('crypto');
const { confirmPaidOrder } = require('./_orders');

// Comparación en tiempo constante (evita timing attacks al comparar el secreto del webhook).
function safeEq(a, b) {
  const ab = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

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

async function handleWebhook(req, res) {
  const secret = (process.env.WOMPI_WEBHOOK_SECRET || '').trim();
  const got = req.headers['x-webhook-secret'] || req.headers['x-wompi-signature'] || req.query.secret;
  if (!secret || !safeEq(got, secret)) return res.status(202).json({ ok: false, error: 'webhook_not_configured_or_invalid' });
  const payload = req.body || {};
  const tx = payload.data?.transaction || payload.transaction || payload.data || payload;
  if (tx.status === 'APPROVED' && tx.reference) {
    const out = await confirmPaidOrder({
      reference: tx.reference,
      amountInCents: tx.amount_in_cents,
      currency: tx.currency || 'COP',
      req,
      eventSourceUrl: 'https://strangesneakers.com/'
    });
    return res.json(out);
  }
  return res.json({ ok: true, ignored: true });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST' || (req.query && req.query.webhook === 'wompi')) {
    return handleWebhook(req, res);
  }

  const id = (req.query && req.query.id ? String(req.query.id) : '').trim();
  if (!/^[\w-]{1,80}$/.test(id)) {
    return res.status(400).json({ error: 'invalid transaction id' });
  }

  const r = await get(`https://production.wompi.co/v1/transactions/${id}`).catch(() => null);
  if (!r || r.status >= 300) return res.status(502).json({ error: 'wompi lookup failed' });

  const t = r.body && r.body.data;
  if (!t) return res.status(404).json({ error: 'transaction not found' });

  let confirmed = false;
  if (t.status === 'APPROVED' && t.reference) {
    const out = await confirmPaidOrder({
      reference: t.reference,
      amountInCents: t.amount_in_cents,
      currency: t.currency || 'COP',
      req,
      eventSourceUrl: 'https://strangesneakers.com/'
    }).catch(() => null);
    confirmed = !!(out && out.ok);
  }

  return res.json({
    id: t.id,
    status: t.status,
    reference: t.reference,
    amount_in_cents: t.amount_in_cents,
    currency: t.currency,
    confirmed
  });
};
