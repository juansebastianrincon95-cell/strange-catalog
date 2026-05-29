const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  const storeUrl = process.env.STORE_URL || `https://${req.headers.host}`;

  const [{ data: cats }, { data: liqs }, { data: settings }] = await Promise.all([
    sb.from('products').select('*').eq('sold', false),
    sb.from('liq_products').select('*').eq('sold', false),
    sb.from('settings').select('*')
  ]);

  const cfg = Object.fromEntries((settings || []).map(r => [r.key, r.value]));
  const brand = cfg.store_name || 'Strange Sneakers';

  const all = [
    ...(cats || []).map(p => ({
      id:           'cat_' + p.id,
      title:        (p.gender === 'h' ? 'Par Hombre' : 'Par Mujer') + ' — ' + brand,
      description:  brand + ' - Calzado de calidad',
      availability: 'in stock',
      condition:    'new',
      price:        (p.price_before || p.price) + ' COP',
      ...(p.price_before && p.price_before > p.price ? { sale_price: p.price + ' COP' } : {}),
      link:         storeUrl + '/?id=' + p.id,
      image_link:   p.img_url || '',
      brand:        brand,
      google_product_category: '187'
    })),
    ...(liqs || []).map(p => ({
      id:           'liq_' + p.id,
      title:        'Liquidación — ' + brand,
      description:  brand + ' - Precio especial',
      availability: 'in stock',
      condition:    'new',
      price:        (p.price_before || p.price) + ' COP',
      ...(p.price_before && p.price_before > p.price ? { sale_price: p.price + ' COP' } : {}),
      link:         storeUrl + '/?id=' + p.id,
      image_link:   p.img_url || '',
      brand:        brand,
      google_product_category: '187'
    }))
  ];

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ data: all });
};
