const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const baseUrl = `https://${req.headers.host}`;

  const [{ data: prods }, { data: liqs }, { data: settings }] = await Promise.all([
    sb.from('products').select('*').eq('sold', false),
    sb.from('liq_products').select('*').eq('sold', false),
    sb.from('settings').select('*')
  ]);

  const cfg = Object.fromEntries((settings || []).map(r => [r.key, r.value]));
  const storeName = cfg.store_name || 'STRANGE';

  const toItem = (p, prefix) => ({
    id:           prefix + String(p.id),
    title:        (prefix === 'L' ? 'Liquidación — ' : 'Zapatilla — ') + storeName,
    description:  (prefix === 'L' ? 'Zapatilla en liquidación' : 'Zapatilla') + ' — ' + storeName,
    availability: 'in stock',
    condition:    'new',
    price:        p.price + ' COP',
    link:         `${baseUrl}/?id=${p.id}`,
    image_link:   p.img_url || '',
    brand:        storeName,
    google_product_category: '187'
  });

  const items = [
    ...(prods || []).map(p => toItem(p, '')),
    ...(liqs  || []).map(p => toItem(p, 'L'))
  ];

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ data: items });
};
