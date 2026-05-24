const { createClient } = require('@supabase/supabase-js');
const requireApiKey = require('./_auth');

module.exports = async (req, res) => {
  if (!requireApiKey(req, res)) return;

  res.setHeader('Access-Control-Allow-Origin', '*');

  const sb     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const sbAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  const [{ data: prods }, { data: liqs }, { data: settings }, { data: orders }] = await Promise.all([
    sbAnon.from('products').select('*'),
    sbAnon.from('liq_products').select('*'),
    sbAnon.from('settings').select('*'),
    sb.from('orders')
      .select('id,fecha,total,pares,pago,ciudad,status,items,created_at')
      .order('created_at', { ascending: false })
      .limit(50)
  ]);

  const cfg = Object.fromEntries((settings || []).map(r => [r.key, r.value]));

  const has360 = arr => { try { return JSON.parse(arr || '[]').length >= 2; } catch { return false; } };
  const stripPrivate = p => ({ ...p, imgs_360: undefined, has_360: has360(p.imgs_360) });

  const allOrders = orders || [];
  const now = Date.now();
  const thirtyDays = allOrders.filter(o => now - new Date(o.created_at) < 30 * 24 * 3600 * 1000);

  const cities = {}, pays = {};
  allOrders.forEach(o => {
    if (o.ciudad) { const k = o.ciudad.toLowerCase(); cities[k] = (cities[k] || 0) + 1; }
    if (o.pago)   pays[o.pago] = (pays[o.pago] || 0) + 1;
  });

  const avail = (prods || []).filter(p => !p.sold);

  res.json({
    store: {
      name:         cfg.store_name || 'Strange Sneakers',
      wa:           cfg.wa,
      promo_global: cfg.promo_global === 'true',
      banner_on:    cfg.banner_on === 'true',
      pixel_id:     cfg.pixel_id || null,
      wompi_pk:     cfg.wompi_pk || null
    },
    inventory: {
      total_products:    (prods || []).length,
      available_products: avail.length,
      sold_products:     (prods || []).filter(p => p.sold).length,
      men_available:     avail.filter(p => p.gender === 'h').length,
      women_available:   avail.filter(p => p.gender === 'm').length,
      total_liq:         (liqs || []).length,
      available_liq:     (liqs || []).filter(p => !p.sold).length
    },
    products:     (prods || []).map(stripPrivate),
    liq_products: (liqs  || []).map(stripPrivate),
    orders: {
      total:          allOrders.length,
      last_30_days:   thirtyDays.length,
      revenue_total:  allOrders.reduce((s, o) => s + (o.total || 0), 0),
      revenue_30_days: thirtyDays.reduce((s, o) => s + (o.total || 0), 0),
      avg_order:      allOrders.length
        ? Math.round(allOrders.reduce((s, o) => s + (o.total || 0), 0) / allOrders.length) : 0,
      top_cities:  Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 5),
      top_payment: Object.entries(pays).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      recent:      allOrders
    }
  });
};
