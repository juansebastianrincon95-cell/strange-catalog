const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGINS = ['https://catalogo.strangesneakers.com', 'https://strange-catalog.vercel.app'];

// Devuelve cuántas veces se vio cada producto en los últimos 7 días (prueba social real).
// Lee de la tabla 'events' (RLS solo deja insertar a anon → se usa service_role para contar).
module.exports = async (req, res) => {
  const origin = (req.headers.origin || '').trim();
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=300');   // 5 min de cache: no martillar la BD
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).end();

  if (!process.env.SUPABASE_SERVICE_KEY) return res.json({ views: {} });

  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { data } = await sb.from('events')
      .select('product_id')
      .eq('type', 'view_product')
      .gte('created_at', since)
      .not('product_id', 'is', null)
      .limit(50000);

    const views = {};
    (data || []).forEach(e => { if (e.product_id) views[e.product_id] = (views[e.product_id] || 0) + 1; });
    return res.json({ views });
  } catch (e) {
    return res.json({ views: {} });   // falla suave: si algo sale mal, no rompe la tienda
  }
};
