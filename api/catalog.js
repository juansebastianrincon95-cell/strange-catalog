const { createClient } = require('@supabase/supabase-js');
const requireApiKey = require('./_auth');

module.exports = async (req, res) => {
  if (!requireApiKey(req, res)) return;

  res.setHeader('Access-Control-Allow-Origin', '*');

  const sbAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const sbSvc  = process.env.SUPABASE_SERVICE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
    : null;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  const ordersQuery = sbSvc
    ? sbSvc.from('orders').select('id,fecha,total,subtotal,envio,pares,pago,ciudad,barrio,tel,nombre,utm,status,reference,session_id,items,created_at').order('created_at', { ascending: false }).limit(50)
    : Promise.resolve({ data: [] });

  const eventsQuery = sbSvc
    ? sbSvc.from('events').select('*').gte('created_at', sevenDaysAgo)
    : Promise.resolve({ data: [] });

  // Suscriptores (popup nombre/whatsapp/cumple + newsletter del footer email) → audiencia de remarketing.
  const subsQuery = sbSvc
    ? sbSvc.from('subscribers').select('nombre,whatsapp,email,cumple,utm,source,created_at').order('created_at', { ascending: false }).limit(500)
    : Promise.resolve({ data: [] });

  const [{ data: prods }, { data: liqs }, { data: settings }, { data: orders }, { data: evts }, subsRes] = await Promise.all([
    sbAnon.from('products').select('*'),
    sbAnon.from('liq_products').select('*'),
    sbAnon.from('settings').select('*'),
    ordersQuery,
    eventsQuery,
    subsQuery
  ]);
  const subs = (subsRes && subsRes.data) || [];   // [] si la migración aún no creó la tabla

  const cfg = Object.fromEntries((settings || []).map(r => [r.key, r.value]));

  const has360 = arr => { try { return JSON.parse(arr || '[]').length >= 2; } catch { return false; } };
  const stripPrivate = p => ({ ...p, imgs_360: undefined, has_360: has360(p.imgs_360) });

  const allOrders = orders || [];
  const now = Date.now();
  const thirtyDays = allOrders.filter(o => now - new Date(o.created_at) < 30 * 24 * 3600 * 1000);

  // Revenue real = solo pedidos 'venta', y solo el valor de PRODUCTO (subtotal, sin flete).
  // El flete (envio) no es ingreso del negocio, así que no debe inflar el ROAS.
  const prodValue    = o => (o.subtotal != null ? o.subtotal : (o.total || 0));
  const ventas       = allOrders.filter(o => o.status === 'venta');
  const ventas30     = ventas.filter(o => now - new Date(o.created_at) < 30 * 24 * 3600 * 1000);
  const revenueTotal = ventas.reduce((s, o) => s + prodValue(o), 0);
  const noVenta      = allOrders.filter(o => o.status === 'no_venta');
  // Carritos abandonados: llenaron datos pero no confirmaron el pedido → remarketing caliente.
  const abandonados  = allOrders.filter(o => o.status === 'abandoned');

  const cities = {}, pays = {};
  allOrders.forEach(o => {
    if (o.ciudad) { const k = o.ciudad.toLowerCase(); cities[k] = (cities[k] || 0) + 1; }
    if (o.pago)   pays[o.pago] = (pays[o.pago] || 0) + 1;
  });

  const avail = (prods || []).filter(p => !p.sold);

  // ── Behavioral analytics ─────────────────────────────────────
  const allEvts = evts || [];
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const oneDayAgo  = new Date(Date.now() - 24 * 3600 * 1000);

  // Agrupar eventos por sesión
  const sessions = {};
  allEvts.forEach(e => {
    if (!sessions[e.session_id]) sessions[e.session_id] = new Set();
    sessions[e.session_id].add(e.type);
  });
  const sessionList = Object.values(sessions);

  // Tasa de abandono
  const didCart     = sessionList.filter(s => s.has('add_to_cart'));
  const abandoned   = didCart.filter(s => !s.has('purchase'));

  // Sesiones abandonadas últimas 24h (session_ids únicos)
  const abandonedIds24h = new Set(
    allEvts
      .filter(e => e.type === 'add_to_cart' && new Date(e.created_at) >= oneDayAgo)
      .map(e => e.session_id)
      .filter(sid => !sessions[sid]?.has('purchase'))
  );

  // Fuentes de tráfico
  const sources = {};
  allEvts.filter(e => e.type === 'page_view' && e.utm_source)
    .forEach(e => { sources[e.utm_source] = (sources[e.utm_source] || 0) + 1; });

  // Productos más vistos
  const productViews = {};
  allEvts.filter(e => e.type === 'view_product' && e.product_id)
    .forEach(e => { productViews[e.product_id] = (productViews[e.product_id] || 0) + 1; });

  const behavior = {
    sessions_7d:            sessionList.length,
    sessions_today:         new Set(allEvts.filter(e => new Date(e.created_at) >= todayStart).map(e => e.session_id)).size,
    funnel_7d: {
      page_views:        allEvts.filter(e => e.type === 'page_view').length,
      product_views:     allEvts.filter(e => e.type === 'view_product').length,
      add_to_cart:       allEvts.filter(e => e.type === 'add_to_cart').length,
      checkout_started:  allEvts.filter(e => e.type === 'initiate_checkout').length,
      // 'leads' = clientes que abrieron WhatsApp (incluye 'purchase' viejo por compat).
      leads:             allEvts.filter(e => e.type === 'lead' || e.type === 'purchase').length,
      // 'purchases' = ventas REALES confirmadas (desde orders, no desde eventos del navegador).
      purchases:         ventas.length,
    },
    cart_abandonment_rate:  didCart.length ? +(abandoned.length / didCart.length).toFixed(2) : 0,
    abandoned_sessions_24h: abandonedIds24h.size,
    traffic_sources:        Object.entries(sources).sort((a, b) => b[1] - a[1]).slice(0, 5),
    top_viewed_products:    Object.entries(productViews).sort((a, b) => b[1] - a[1]).slice(0, 5)
                              .map(([id, views]) => ({ id, views })),
  };

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
      revenue_total:  revenueTotal,
      revenue_30_days: ventas30.reduce((s, o) => s + prodValue(o), 0),
      avg_order:      ventas.length ? Math.round(revenueTotal / ventas.length) : 0,
      top_cities:  Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 5),
      top_payment: Object.entries(pays).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
      recent:      allOrders
    },
    leads: {
      // 'pending' = pedidos reales sin clasificar (excluye abandonados, que tienen su propio bucket)
      pending:    allOrders.filter(o => o.status !== 'venta' && o.status !== 'no_venta' && o.status !== 'abandoned').length,
      venta:      ventas.length,
      no_venta:   noVenta.length,
      abandoned:  abandonados.length,
      // Interesados que NO compraron → audiencia de remarketing (subir a Meta Custom Audience).
      // Incluye contexto del operador: estado WhatsApp, temperatura, motivo y nota.
      no_venta_contacts: noVenta.map(o => ({
        nombre: o.nombre, tel: o.tel, ciudad: o.ciudad,
        subtotal: prodValue(o), items: o.items, utm: o.utm, fecha: o.fecha,
        wa_status: o.wa_status || null, temperatura: o.temperatura || null,
        motivo_no_venta: o.motivo_no_venta || null, nota: o.nota || null,
        seguimiento: o.seguimiento || null
      })),
      // Carritos abandonados: llenaron datos pero no confirmaron → remarketing más caliente aún
      abandoned_contacts: abandonados.map(o => ({
        nombre: o.nombre, tel: o.tel, ciudad: o.ciudad,
        subtotal: prodValue(o), items: o.items, utm: o.utm, fecha: o.fecha,
        wa_status: o.wa_status || null, temperatura: o.temperatura || null, nota: o.nota || null
      }))
    },
    // Suscriptores del popup de bienvenida ($20.000 OFF) → audiencia de remarketing / promos de cumpleaños.
    subscribers: {
      total:    subs.length,
      contacts: subs.map(s => ({
        nombre: s.nombre, whatsapp: s.whatsapp, email: s.email, cumple: s.cumple, source: s.source, utm: s.utm, fecha: s.created_at
      }))
    },
    behavior
  });
};
