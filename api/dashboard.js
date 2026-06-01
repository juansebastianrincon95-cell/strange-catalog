const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const requireApiKey = require('./_auth');

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

module.exports = async (req, res) => {
  try {
    if (!requireApiKey(req, res)) return;
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Rango opcional ?since=YYYY-MM-DD&until=YYYY-MM-DD (aplica a ventas Y a gasto Meta).
    const since = req.query && dateRe.test(req.query.since || '') ? req.query.since : null;
    const until = req.query && dateRe.test(req.query.until || '') ? req.query.until : null;

    // ── 1. FACTURACIÓN (lado catálogo / Supabase) ──────────────────────────
    const sbSvc = process.env.SUPABASE_SERVICE_KEY
      ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
      : null;

    let ventas = [];
    if (sbSvc) {
      let q = sbSvc.from('orders')
        .select('subtotal,total,created_at,status,pago,utm')
        .eq('status', 'venta');
      if (since) q = q.gte('created_at', since + 'T00:00:00');
      if (until) q = q.lte('created_at', until + 'T23:59:59');
      const { data } = await q;
      ventas = data || [];
    }
    const prodValue   = o => (o.subtotal != null ? o.subtotal : (o.total || 0));
    const facturacion = ventas.reduce((s, o) => s + prodValue(o), 0);  // solo producto, sin flete
    const compras     = ventas.length;
    const ticket_promedio = compras ? Math.round(facturacion / compras) : 0;

    // Agrupar facturación y compras por utm_campaign (para ROAS por campaña).
    const norm = s => String(s || '').trim().toLowerCase();
    const ventasPorCampana = {};   // key normalizada → {facturacion, compras, label}
    ventas.forEach(o => {
      const camp = (o.utm && (o.utm.utm_campaign)) || '(sin_campaña)';
      const k = norm(camp);
      if (!ventasPorCampana[k]) ventasPorCampana[k] = { facturacion: 0, compras: 0, label: camp };
      ventasPorCampana[k].facturacion += prodValue(o);
      ventasPorCampana[k].compras += 1;
    });

    // ── 2. INVERSIÓN (lado Meta Ads) ───────────────────────────────────────
    const TOKEN   = (process.env.META_USER_TOKEN || '').trim();
    const ACCOUNT = (process.env.META_AD_ACCOUNT_ID || '').trim();
    let inversion = null, meta_error = null, currency = null;

    if (TOKEN && ACCOUNT) {
      const range = since && until ? `&time_range={"since":"${since}","until":"${until}"}` : '';
      // insights de la cuenta = gasto agregado de todas las campañas en el rango
      const r = await graphGet(`${ACCOUNT}/insights?fields=spend,impressions,clicks${range}&access_token=${TOKEN}`);
      if (r && r.status >= 200 && r.status < 300 && r.body && Array.isArray(r.body.data) && r.body.data[0]) {
        inversion = Math.round(parseFloat(r.body.data[0].spend || 0));
      } else if (r && r.body && r.body.error) {
        meta_error = r.body.error.message || 'meta insights error';
      } else if (!since || !until) {
        // Sin rango, insights puede venir vacío → usar amount_spent lifetime de la cuenta
        const a = await graphGet(`${ACCOUNT}?fields=amount_spent,currency&access_token=${TOKEN}`);
        if (a && a.body && a.body.amount_spent != null) {
          inversion = Math.round(parseInt(a.body.amount_spent));  // viene en unidad menor → ya en COP entero
          currency = a.body.currency || null;
        }
      }
    } else {
      meta_error = 'META_USER_TOKEN or META_AD_ACCOUNT_ID not configured';
    }

    // ── 3. CRUCE: ROAS y CPA a nivel cuenta ────────────────────────────────
    const roas = (inversion && inversion > 0) ? +(facturacion / inversion).toFixed(2) : null;
    const cpa  = (inversion && compras > 0)   ? Math.round(inversion / compras)       : null;

    // ── 4. DESGLOSE POR CAMPAÑA (gasto Meta por campaña × ventas por utm_campaign) ──
    let campanas = [], campanas_error = null;
    if (TOKEN && ACCOUNT) {
      const range = since && until ? `&time_range={"since":"${since}","until":"${until}"}` : '';
      // insights por campaña: nombre + gasto en el rango (o lifetime si no hay rango)
      const ci = await graphGet(`${ACCOUNT}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks${range}&limit=200&access_token=${TOKEN}`);
      if (ci && ci.body && Array.isArray(ci.body.data)) {
        const spendByCamp = {};   // key normalizada del nombre de campaña → {spend, name}
        ci.body.data.forEach(row => {
          const k = norm(row.campaign_name);
          spendByCamp[k] = { spend: Math.round(parseFloat(row.spend || 0)), name: row.campaign_name, id: row.campaign_id };
        });
        // Unir: claves de gasto (Meta) ∪ claves de ventas (catálogo, por utm_campaign)
        const keys = new Set([...Object.keys(spendByCamp), ...Object.keys(ventasPorCampana)]);
        campanas = [...keys].map(k => {
          const s = spendByCamp[k] || {};
          const v = ventasPorCampana[k] || {};
          const inv = s.spend || 0;
          const fac = v.facturacion || 0;
          const cmp = v.compras || 0;
          return {
            campana:       s.name || v.label || k,
            campaign_id:   s.id || null,
            inversion:     inv,
            facturacion:   fac,
            compras:       cmp,
            roas:          inv > 0 ? +(fac / inv).toFixed(2) : null,
            cpa:           (inv > 0 && cmp > 0) ? Math.round(inv / cmp) : null
          };
        }).sort((a, b) => (b.roas || 0) - (a.roas || 0));   // mejor ROAS primero
      } else if (ci && ci.body && ci.body.error) {
        campanas_error = ci.body.error.message || 'meta campaign insights error';
      }
    }

    return res.json({
      periodo: since && until ? { since, until } : 'lifetime',
      moneda:  currency || 'COP',
      inversion_total:    inversion,          // gasto en Meta Ads (null si Meta no respondió)
      facturacion_total:  facturacion,        // ingreso de producto de ventas confirmadas
      compras_totales:    compras,
      ticket_promedio,
      roas_promedio:      roas,               // facturación ÷ inversión (a nivel cuenta)
      cpa_promedio:       cpa,                // inversión ÷ compras
      por_campana:        campanas,           // desglose: ROAS/CPA de cada campaña (mejor ROAS primero)
      nota: 'roas_promedio/cpa_promedio son a nivel cuenta. por_campana cruza el gasto de cada campaña en Meta con las ventas que traen ese utm_campaign. La atribución por campaña depende de que los anuncios pasen el utm_campaign correcto en la URL.',
      meta_error,           // null si ok; string si Meta no devolvió gasto agregado
      campanas_error        // null si ok; string si falló el desglose por campaña
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
