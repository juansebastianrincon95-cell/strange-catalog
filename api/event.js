const { createClient } = require('@supabase/supabase-js');

const ALLOWED_TYPES   = ['page_view', 'view_product', 'add_to_cart', 'initiate_checkout', 'lead', 'purchase'];
const ALLOWED_ORIGINS = ['https://catalogo.strangesneakers.com', 'https://strange-catalog.vercel.app'];

module.exports = async (req, res) => {
  const origin = (req.headers.origin || '').trim();
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { session_id, type, product_id, price, gender, utm_source, utm_medium, utm_campaign, referrer } = req.body || {};
  if (!session_id || !ALLOWED_TYPES.includes(type)) return res.status(400).json({ error: 'invalid' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  await sb.from('events').insert({
    session_id:   String(session_id).slice(0, 64),
    type,
    product_id:   product_id   ? String(product_id).slice(0, 32)   : null,
    price:        price        ? Math.min(Math.max(0, parseInt(price)), 100_000_000) : null,
    gender:       ['h', 'm'].includes(gender) ? gender : null,
    utm_source:   utm_source   ? String(utm_source).slice(0, 100)   : null,
    utm_medium:   utm_medium   ? String(utm_medium).slice(0, 100)   : null,
    utm_campaign: utm_campaign ? String(utm_campaign).slice(0, 100) : null,
    referrer:     referrer     ? String(referrer).slice(0, 300)     : null,
  });
  return res.json({ ok: true });
};
