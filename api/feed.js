const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  // .trim() + sin "/" final: un env mal pegado (BOM/CRLF/slash) ya ensució los links del feed una vez.
  const storeUrl = (process.env.STORE_URL || `https://${req.headers.host}`).trim().replace(/\/+$/, '');

  const [{ data: cats }, { data: liqs }, { data: settings }] = await Promise.all([
    sb.from('products').select('*').eq('sold', false),
    sb.from('liq_products').select('*').eq('sold', false),
    sb.from('settings').select('*')
  ]);

  const cfg = Object.fromEntries((settings || []).map(r => [r.key, r.value]));
  const brand = cfg.store_name || 'Strange Sneakers';

  // Etiquetas legibles de marca para el feed de Meta
  const BRAND_LABELS = { adidas:'Adidas', nike:'Nike', reebok:'Reebok', new_balance:'New Balance', on_cloud:'On Cloud', puma:'Puma', lecoq_sportif:'Le Coq Sportif', jordan:'Jordan', lacoste:'Lacoste', asics:'Asics', luxury:'Luxury' };
  const brandLabel = b => BRAND_LABELS[b] || null;
  // Galería: fotos secundarias (columna imgs = JSON array) → additional_image_link (máx 10)
  const extraImgs = p => {
    try { const a = JSON.parse(p.imgs || '[]'); return Array.isArray(a) && a.length ? { additional_image_link: a.slice(0, 10) } : {}; }
    catch { return {}; }
  };

  const all = [
    ...(cats || []).map(p => {
      const bl = brandLabel(p.brand);                 // marca real del zapato (o null)
      const gen = p.gender === 'h' ? 'Hombre' : 'Mujer';
      return {
      id:           'cat_' + p.id,
      title:        p.modelo || ((bl ? bl + ' ' : '') + 'Par ' + gen + ' — ' + brand),
      description:  (bl ? bl + ' - ' : '') + brand + ' - Calzado de calidad',
      availability: 'in stock',
      condition:    'new',
      price:        (p.price_before || p.price) + ' COP',
      ...(p.price_before && p.price_before > p.price ? { sale_price: p.price + ' COP' } : {}),
      link:         storeUrl + '/?type=cat&id=' + p.id,
      image_link:   p.img_url || '',
      ...extraImgs(p),
      brand:        bl || brand,                       // marca real si existe; si no, la tienda
      google_product_category: '187'
    };}),
    ...(liqs || []).map(p => ({
      id:           'liq_' + p.id,
      title:        p.modelo ? p.modelo + ' — Liquidación' : ('Liquidación — ' + brand),
      description:  brand + ' - Precio especial',
      availability: 'in stock',
      condition:    'new',
      price:        (p.price_before || p.price) + ' COP',
      ...(p.price_before && p.price_before > p.price ? { sale_price: p.price + ' COP' } : {}),
      link:         storeUrl + '/?type=liq&id=' + p.id,
      image_link:   p.img_url || '',
      ...extraImgs(p),
      brand:        brand,
      google_product_category: '187'
    }))
  ];

  // ?format=csv → formato que Meta Commerce acepta como feed PROGRAMADO (JSON no es válido
  // para data sources con schedule; CSV sí). El JSON se mantiene como default (lo usan
  // el agente y otras integraciones).
  if ((req.query || {}).format === 'csv') {
    const cols = ['id','title','description','availability','condition','price','sale_price','link','image_link','additional_image_link','brand','google_product_category'];
    const esc = v => {
      if (v == null) return '';
      const s = Array.isArray(v) ? v.join(',') : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(',')];
    all.forEach(p => lines.push(cols.map(c => esc(p[c])).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.send(lines.join('\n'));
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ data: all });
};
