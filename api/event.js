const { createClient } = require('@supabase/supabase-js');
const { rateLimit } = require('./_rate_limit');

const ALLOWED_TYPES   = ['page_view', 'view_product', 'add_to_cart', 'initiate_checkout', 'lead', 'purchase'];
const ALLOWED_ORIGINS = ['https://catalogo.strangesneakers.com', 'https://strange-catalog.vercel.app'];

module.exports = async (req, res) => {
  const origin = (req.headers.origin || '').trim();
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  if (!rateLimit(req, res, { scope: 'events', max: 120, windowMs: 60_000 })) return;

  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { session_id, type, product_id, price, gender, utm_source, utm_medium, utm_campaign,
          utm_content, utm_term, campaign_id, adset_id, ad_id, landing, device, referrer } = req.body || {};
  if (!session_id || !ALLOWED_TYPES.includes(type)) return res.status(400).json({ error: 'invalid' });

  const t = (v, n) => (v ? String(v).slice(0, n) : null);
  // service_role: la policy de insert anónimo se eliminó (la anon key es pública y permitía
  // ensuciar datos saltándose esta API). Fallback a anon solo para instalaciones sin service key.
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY);
  await sb.from('events').insert({
    session_id:   String(session_id).slice(0, 64),
    type,
    product_id:   t(product_id, 32),
    price:        price ? Math.min(Math.max(0, parseInt(price)), 100_000_000) : null,
    gender:       ['h', 'm'].includes(gender) ? gender : null,
    utm_source:   t(utm_source, 100),
    utm_medium:   t(utm_medium, 100),
    utm_campaign: t(utm_campaign, 100),
    // Atribución completa por anuncio (FASE H): funnel por campaña/conjunto/anuncio + contexto.
    utm_content:  t(utm_content, 150),
    utm_term:     t(utm_term, 150),
    campaign_id:  t(campaign_id, 40),
    adset_id:     t(adset_id, 40),
    ad_id:        t(ad_id, 40),
    landing:      t(landing, 300),
    device:       ['movil', 'escritorio'].includes(device) ? device : null,
    referrer:     t(referrer, 300),
  });
  return res.json({ ok: true });
};
