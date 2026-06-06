const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const { safeEq, validateSession } = require('./_admin_auth');

const GRAPH = 'graph.facebook.com';
const VER   = 'v21.0';

// Llamada GET a Graph API de Meta (mismo patrón que api/meta.js)
function graphGet(path) {
  return new Promise((resolve) => {
    https.get({ hostname: GRAPH, path: `/${VER}/${path}` }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    }).on('error', () => resolve(null));
  });
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const TZ = 'America/Bogota';

/* ── Helpers de fecha (espejo de los del front, FASE J) ───────────────────── */
const dayKeyOf = ts => { const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleDateString('en-CA', { timeZone: TZ }); };
const weekKeyOf = k => { // lunes de la semana del día k (YYYY-MM-DD)
  const [y, m, d] = k.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d), dow = new Date(t).getUTCDay();
  return new Date(t - ((dow + 6) % 7) * 86400000).toISOString().slice(0, 10);
};
const addDays = (k, n) => { const [y, m, d] = k.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => i === 1 ? x - 1 : +x)) - Date.UTC(...a.split('-').map((x, i) => i === 1 ? x - 1 : +x))) / 86400000);

/* ── Métricas contables de una lista de ventas (status='venta') ────────────
   Definiciones (P3, Codex): brutas = items precio×qty ANTES de descuento (fallback subtotal);
   netas = subtotal (producto post-descuento, la base del ROAS); envios = flete cobrado;
   total_cobrado = caja; margen = Σ (precio−costo)×qty para ítems con costo registrado. */
function resumenDe(ventas, costos) {
  let brutas = 0, netas = 0, envios = 0, cobrado = 0, margen = 0, margenItems = 0, totalItems = 0;
  ventas.forEach(o => {
    const sub = o.subtotal != null ? o.subtotal : (o.total || 0);
    netas += sub;
    envios += (o.envio || 0);
    cobrado += (o.total || 0);
    if (Array.isArray(o.items) && o.items.length) {
      let b = 0;
      o.items.forEach(it => {
        const precio = parseInt(it.precio) || 0, qty = parseInt(it.qty) || 1;
        b += precio * qty;
        totalItems++;
        const costo = costos[`${it.type === 'liq' ? 'liq' : 'cat'}:${parseInt(it.id)}`];
        if (costo != null) { margen += (precio - costo) * qty; margenItems++; }
      });
      brutas += b;
    } else {
      brutas += sub; // pedido viejo sin items detallados: brutas = netas
    }
  });
  const pedidos = ventas.length;
  return {
    ventas_brutas: brutas,
    descuentos: Math.max(0, brutas - netas),
    ventas_netas: netas,
    envios,
    total_cobrado: cobrado,
    pedidos,
    aov: pedidos ? Math.round(netas / pedidos) : 0,
    margen_estimado: margen,
    margen_cobertura: totalItems ? +(margenItems / totalItems).toFixed(2) : 0  // % de ítems con costo registrado
  };
}

module.exports = async (req, res) => {
  try {
    // Auth dual: Bearer CATALOG_API_KEY (agente externo) O cookie de sesión admin (navegador).
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const okKey = token && process.env.CATALOG_API_KEY && safeEq(token, process.env.CATALOG_API_KEY);
    if (!okKey && !validateSession(req)) return res.status(401).json({ error: 'Unauthorized' });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    // Rango opcional ?since=YYYY-MM-DD&until=YYYY-MM-DD (aplica a ventas, events Y gasto Meta).
    const since = req.query && dateRe.test(req.query.since || '') ? req.query.since : null;
    const until = req.query && dateRe.test(req.query.until || '') ? req.query.until : null;
    const group = ['day', 'week', 'month'].includes((req.query || {}).group) ? req.query.group : 'day';

    const sbSvc = process.env.SUPABASE_SERVICE_KEY
      ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
      : null;

    // ── 1. VENTAS: rango actual + TODAS las históricas (clientes) + costos ──
    // Una sola query liviana de TODAS las ventas; el rango y la ventana anterior
    // se cortan en memoria (mismo dato, sin 3 round-trips).
    let todas = [];
    let costos = {};
    if (sbSvc) {
      const [v, c] = await Promise.all([
        sbSvc.from('orders')
          .select('id,subtotal,total,envio,created_at,pago,utm,items,tel,cedula')
          .eq('status', 'venta').order('created_at', { ascending: true }).limit(5000),
        sbSvc.from('product_costs').select('ptype,pid,costo')
      ]);
      todas = v.data || [];
      (c.data || []).forEach(r => { costos[`${r.ptype}:${r.pid}`] = r.costo; });
    }
    todas.forEach(o => { o._dia = dayKeyOf(o.created_at); });

    const enRango = o => (!since || o._dia >= since) && (!until || o._dia <= until);
    const ventas = todas.filter(enRango);

    // Ventana ANTERIOR del mismo tamaño (para Δ% en las tarjetas). Solo si hay rango completo.
    let ventasPrev = null, prevSince = null, prevUntil = null;
    if (since && until) {
      const L = diffDays(since, until) + 1;
      prevUntil = addDays(since, -1);
      prevSince = addDays(since, -L);
      ventasPrev = todas.filter(o => o._dia >= prevSince && o._dia <= prevUntil);
    }

    const resumen = resumenDe(ventas, costos);
    const resumen_prev = ventasPrev ? resumenDe(ventasPrev, costos) : null;

    // Compat con consumidores existentes (agente/skills):
    const facturacion = resumen.ventas_netas;
    const compras = resumen.pedidos;
    const ticket_promedio = resumen.aov;

    // ── 2. SERIE TEMPORAL (buckets CONTINUOS, vacíos = 0, hora Colombia) ────
    const bucketOf = k => group === 'week' ? weekKeyOf(k) : group === 'month' ? k.slice(0, 7) : k;
    const serieMap = {};
    ventas.forEach(o => {
      if (!o._dia) return;
      const b = bucketOf(o._dia);
      if (!serieMap[b]) serieMap[b] = { netas: 0, pedidos: 0 };
      serieMap[b].netas += (o.subtotal != null ? o.subtotal : (o.total || 0));
      serieMap[b].pedidos++;
    });
    const serie = [];
    const desde = since || (todas[0] ? todas[0]._dia : null);
    const hasta = until || dayKeyOf(Date.now());
    if (desde && hasta && desde <= hasta && diffDays(desde, hasta) <= 1100) {
      let k = group === 'week' ? weekKeyOf(desde) : desde;
      const fin = bucketOf(hasta);
      const seen = new Set();
      while (true) {
        const b = bucketOf(k);
        if (!seen.has(b)) {
          seen.add(b);
          const s = serieMap[b] || { netas: 0, pedidos: 0 };
          serie.push({ k: b, netas: s.netas, pedidos: s.pedidos, aov: s.pedidos ? Math.round(s.netas / s.pedidos) : 0 });
        }
        if (b >= fin) break;
        k = addDays(k, group === 'week' ? 7 : 1);
        if (group === 'month' && serie.length && bucketOf(k) === serie[serie.length - 1].k) k = addDays(k, 1);
        if (serie.length > 1200) break; // cinturón
      }
    }

    // ── 3. CLIENTES (clave tel + merge por cédula, espejo de buildClientes) ─
    const telKey = t => String(t || '').replace(/\D/g, '').slice(-10);
    const cedKey = c => { const k = String(c || '').replace(/\D/g, ''); return k.length >= 4 ? k : ''; };
    const perfiles = {};   // telKey → {fechas:[], netasRango, pedidosRango, ceds:{}}
    todas.forEach(o => {
      const k = telKey(o.tel); if (!k) return;
      if (!perfiles[k]) perfiles[k] = { fechas: [], netasR: 0, pedR: 0, ceds: {} };
      const p = perfiles[k];
      p.fechas.push(o._dia);
      const ck = cedKey(o.cedula); if (ck) p.ceds[ck] = 1;
      if (enRango(o)) { p.netasR += (o.subtotal != null ? o.subtotal : (o.total || 0)); p.pedR++; }
    });
    // merge transitivo por cédula
    const porCed = {}; const lista = [];
    Object.values(perfiles).forEach(p => {
      const dueno = Object.keys(p.ceds).map(k => porCed[k]).find(Boolean);
      if (dueno) {
        dueno.fechas.push(...p.fechas); dueno.netasR += p.netasR; dueno.pedR += p.pedR;
        Object.keys(p.ceds).forEach(k => { porCed[k] = dueno; });
      } else {
        Object.keys(p.ceds).forEach(k => { porCed[k] = p; });
        lista.push(p);
      }
    });
    let nuevos = 0, recurrentes = 0, ventasNuevos = 0, ventasRec = 0, pedidosRango = 0, gapSum = 0, gapN = 0;
    lista.forEach(p => {
      p.fechas.sort();
      if (p.fechas.length >= 2) {
        for (let i = 1; i < p.fechas.length; i++) { gapSum += diffDays(p.fechas[i - 1], p.fechas[i]); gapN++; }
      }
      if (!p.pedR) return;            // sin compra en el rango
      pedidosRango += p.pedR;
      const primera = p.fechas[0];
      const esNuevo = !since ? p.fechas.length === p.pedR : primera >= since;  // sin rango: nuevo = todas sus compras caen "en el rango" (lifetime)
      if (esNuevo) { nuevos++; ventasNuevos += p.netasR; } else { recurrentes++; ventasRec += p.netasR; }
    });
    const clientesRango = nuevos + recurrentes;
    const clientes = {
      nuevos, recurrentes,
      returning_rate: clientesRango ? +(recurrentes / clientesRango * 100).toFixed(1) : 0,
      ventas_nuevos: ventasNuevos,
      ventas_recurrentes: ventasRec,
      frecuencia_promedio: clientesRango ? +(pedidosRango / clientesRango).toFixed(2) : 0,
      dias_entre_compras: gapN ? Math.round(gapSum / gapN) : null
    };

    // ── 4. FUNNEL + PRODUCTOS (events del rango) ────────────────────────────
    let funnel = null;
    const prodStats = {};   // id numérico → {views, atc}
    if (sbSvc) {
      let qe = sbSvc.from('events').select('session_id,type,product_id,created_at').limit(20000);
      if (since) qe = qe.gte('created_at', since + 'T00:00:00');
      if (until) qe = qe.lte('created_at', until + 'T23:59:59');
      const { data: evs } = await qe;
      // Embudo por SESIONES ÚNICAS en cada paso (como Shopify): 1 sesión que vio 5 productos
      // cuenta 1 vez — así las tasas paso a paso nunca superan el 100%.
      const porPaso = { page_view: new Set(), view_product: new Set(), add_to_cart: new Set(), initiate_checkout: new Set(), lead: new Set() };
      (evs || []).forEach(e => {
        if (porPaso[e.type]) porPaso[e.type].add(e.session_id);
        const pid = parseInt(e.product_id);
        if (pid && (e.type === 'view_product' || e.type === 'add_to_cart')) {
          if (!prodStats[pid]) prodStats[pid] = { views: 0, atc: 0 };
          if (e.type === 'view_product') prodStats[pid].views++; else prodStats[pid].atc++;
        }
      });
      funnel = {
        sessions: porPaso.page_view.size,
        view_product: porPaso.view_product.size,
        add_to_cart: porPaso.add_to_cart.size,
        initiate_checkout: porPaso.initiate_checkout.size,
        leads: porPaso.lead.size,
        ventas: compras
      };
    }

    // Ranking de productos: ventas del rango (items) × comportamiento (events)
    const prodMap = {};
    ventas.forEach(o => (Array.isArray(o.items) ? o.items : []).forEach(it => {
      const id = parseInt(it.id); if (!id) return;
      const key = `${it.type === 'liq' ? 'liq' : 'cat'}:${id}`;
      if (!prodMap[key]) prodMap[key] = { id, type: it.type === 'liq' ? 'liq' : 'cat', label: it.label || ('#' + id), unidades: 0, ingresos: 0 };
      const qty = parseInt(it.qty) || 1;
      prodMap[key].unidades += qty;
      prodMap[key].ingresos += (parseInt(it.precio) || 0) * qty;
    }));
    const productos = Object.values(prodMap).map(p => {
      const st = prodStats[p.id] || { views: 0, atc: 0 };
      return {
        ...p, views: st.views, atc: st.atc,
        conv_view_cart: st.views ? +(st.atc / st.views * 100).toFixed(1) : null,
        conv_cart_venta: st.atc ? +(Math.min(1, p.unidades / st.atc) * 100).toFixed(1) : null
      };
    }).sort((a, b) => b.ingresos - a.ingresos).slice(0, 10);

    // ── 5. CAMPAÑAS: ventas por utm + gasto/CTR/CPC/CPM de Meta ────────────
    const norm = s => String(s || '').trim().toLowerCase();
    const ventasPorCampana = {};
    ventas.forEach(o => {
      const camp = (o.utm && (o.utm.utm_campaign)) || '(sin_campaña)';
      const k = norm(camp);
      if (!ventasPorCampana[k]) ventasPorCampana[k] = { facturacion: 0, compras: 0, label: camp };
      ventasPorCampana[k].facturacion += (o.subtotal != null ? o.subtotal : (o.total || 0));
      ventasPorCampana[k].compras += 1;
    });

    const TOKEN   = (process.env.META_USER_TOKEN || '').trim();
    const ACCOUNT = (process.env.META_AD_ACCOUNT_ID || '').trim();
    let inversion = null, meta_error = null, currency = null;

    if (TOKEN && ACCOUNT) {
      const range = since && until ? `&time_range={"since":"${since}","until":"${until}"}` : '';
      const r = await graphGet(`${ACCOUNT}/insights?fields=spend,impressions,clicks${range}&access_token=${TOKEN}`);
      if (r && r.status >= 200 && r.status < 300 && r.body && Array.isArray(r.body.data) && r.body.data[0]) {
        inversion = Math.round(parseFloat(r.body.data[0].spend || 0));
      } else if (r && r.body && r.body.error) {
        meta_error = r.body.error.message || 'meta insights error';
      } else if (!since || !until) {
        const a = await graphGet(`${ACCOUNT}?fields=amount_spent,currency&access_token=${TOKEN}`);
        if (a && a.body && a.body.amount_spent != null) {
          inversion = Math.round(parseInt(a.body.amount_spent));
          currency = a.body.currency || null;
        }
      }
    } else {
      meta_error = 'META_USER_TOKEN or META_AD_ACCOUNT_ID not configured';
    }

    const roas = (inversion && inversion > 0) ? +(facturacion / inversion).toFixed(2) : null;
    const cpa  = (inversion && compras > 0)   ? Math.round(inversion / compras)       : null;
    // ROAS de la ventana anterior (solo lado catálogo vs gasto del rango previo: requiere
    // otra llamada a Meta — para Δ de tarjetas usamos solo facturación/pedidos/aov/margen).

    let campanas = [], campanas_error = null;
    if (TOKEN && ACCOUNT) {
      const range = since && until ? `&time_range={"since":"${since}","until":"${until}"}` : '';
      const ci = await graphGet(`${ACCOUNT}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm${range}&limit=200&access_token=${TOKEN}`);
      if (ci && ci.body && Array.isArray(ci.body.data)) {
        const spendByCamp = {};
        ci.body.data.forEach(row => {
          spendByCamp[norm(row.campaign_name)] = {
            spend: Math.round(parseFloat(row.spend || 0)), name: row.campaign_name, id: row.campaign_id,
            impressions: parseInt(row.impressions) || 0, clicks: parseInt(row.clicks) || 0,
            ctr: row.ctr != null ? +parseFloat(row.ctr).toFixed(2) : null,
            cpc: row.cpc != null ? Math.round(parseFloat(row.cpc)) : null,
            cpm: row.cpm != null ? Math.round(parseFloat(row.cpm)) : null
          };
        });
        const keys = new Set([...Object.keys(spendByCamp), ...Object.keys(ventasPorCampana)]);
        campanas = [...keys].map(k => {
          const s = spendByCamp[k] || {};
          const v = ventasPorCampana[k] || {};
          const inv = s.spend || 0, fac = v.facturacion || 0, cmp = v.compras || 0;
          return {
            campana: s.name || v.label || k,
            campaign_id: s.id || null,
            inversion: inv, facturacion: fac, compras: cmp,
            roas: inv > 0 ? +(fac / inv).toFixed(2) : null,
            cpa: (inv > 0 && cmp > 0) ? Math.round(inv / cmp) : null,
            impressions: s.impressions || 0, clicks: s.clicks || 0,
            ctr: s.ctr != null ? s.ctr : null, cpc: s.cpc != null ? s.cpc : null, cpm: s.cpm != null ? s.cpm : null
          };
        }).sort((a, b) => (b.roas || 0) - (a.roas || 0));
      } else if (ci && ci.body && ci.body.error) {
        campanas_error = ci.body.error.message || 'meta campaign insights error';
      }
    }

    return res.json({
      periodo: since && until ? { since, until } : 'lifetime',
      periodo_prev: prevSince ? { since: prevSince, until: prevUntil } : null,
      group,
      moneda:  currency || 'COP',
      // ── compat (consumidores existentes) ──
      inversion_total:    inversion,
      facturacion_total:  facturacion,
      compras_totales:    compras,
      ticket_promedio,
      roas_promedio:      roas,
      cpa_promedio:       cpa,
      por_campana:        campanas,
      // ── analytics (FASE K) ──
      resumen,            // brutas/descuentos/netas/envios/total_cobrado/pedidos/aov/margen
      resumen_prev,       // misma estructura, ventana anterior (null si lifetime)
      serie,              // [{k, netas, pedidos, aov}] buckets continuos según group
      clientes,           // nuevos/recurrentes/returning_rate/ventas por grupo/frecuencia/días entre compras
      funnel,             // sessions/view_product/add_to_cart/initiate_checkout/leads/ventas
      productos,          // top 10 por ingresos con views/ATC/conversiones
      nota: 'Ventas netas (subtotal, post-descuento) es la base de ROAS. total_cobrado = caja (con envío). margen_estimado solo cubre ítems con costo registrado (ver margen_cobertura). Solo pedidos status=venta cuentan.',
      meta_error,
      campanas_error
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
