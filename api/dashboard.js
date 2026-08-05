const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const { safeEq, validateSession } = require('./_admin_auth');

const GRAPH = 'graph.facebook.com';
const VER   = 'v21.0';

// Llamada GET a Graph API de Meta (mismo patrón que api/meta.js)
function graphGet(path) {
  return new Promise((resolve) => {
    const req = https.get({ hostname: GRAPH, path: `/${VER}/${path}` }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', () => resolve(null));
    // Timeout: las llamadas Graph de analytics son lentas; abortar a los 8s → 'error' → resolve(null)
    req.setTimeout(8000, () => req.destroy(new Error('graph-timeout')));
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
        // OJO (hallazgo Codex #6): items[].precio YA es el TOTAL DE LÍNEA (price×qty,
        // ver _orders.js priceItems). NO volver a multiplicar por qty. Para el margen
        // se usa unit_price (o línea÷qty como fallback de pedidos viejos).
        const linea = parseInt(it.precio) || 0, qty = parseInt(it.qty) || 1;
        const unit = it.unit_price != null ? (parseInt(it.unit_price) || 0) : Math.round(linea / qty);
        b += linea;
        totalItems++;
        const costo = costos[`${it.type === 'liq' ? 'liq' : 'cat'}:${parseInt(it.id)}`];
        if (costo != null) { margen += (unit - costo) * qty; margenItems++; }
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

/* ── Atribución multi-toque (5 modelos Shopify, ventana 30 días) ───────────
   La ruta de toques se reconstruye con events.session_id (persistente por dispositivo)
   ordenados por fecha; toques consecutivos del mismo canal cuentan como uno (los events
   arrastran el ss_utm guardado, así que una revisita directa repite el canal anterior). */

// Canal de un toque: campaign_id manda (estable aunque renombren la campaña, mismo criterio
// que la sección CAMPAÑAS); utm como fallback; sin nada = tráfico directo.
// `resolver` (opcional) = Map norm(nombre de campaña) → campaign_id, armado con la respuesta de
// Meta. Sin él, la MISMA campaña salía en DOS filas según si ese anuncio llevaba {{campaign.id}}
// en la URL — y en Meta los parámetros se configuran por anuncio, así que pasa a diario.
function canalDe(o, resolver) {
  o = o || {};
  const cid = o.campaign_id && !/\{\{/.test(String(o.campaign_id)) ? String(o.campaign_id) : null;
  const src = String(o.utm_source || '').trim(), camp = String(o.utm_campaign || '').trim();
  if (cid) return { key: 'id:' + cid, canal: camp || ('campaña ' + cid), campaign_id: cid, directo: false };
  if (src || camp) {
    // Promoción a clave por id: si el nombre coincide con una campaña real de Meta, se unifica.
    const prom = resolver && camp ? resolver.get(camp.trim().toLowerCase()) : null;
    if (prom) return { key: 'id:' + prom, canal: camp, campaign_id: prom, directo: false };
    return { key: 'src:' + src.toLowerCase() + '|' + camp.toLowerCase(), canal: camp || src, campaign_id: null, directo: false };
  }
  return { key: 'directo', canal: 'Directo', campaign_id: null, directo: true };
}

/* ── RUTA DE TOQUES ── Tres estados de utm_fresh (migración 008), no dos:
     true  → CLIC REAL (la URL traía UTM/fbclid/gclid)
     false → revisita / tráfico directo
     null  → evento anterior a la migración: NO SE SABE
   ⚠️ El estado null es innegociable: tratarlo como false pondría TODO el histórico en "Directo"
   y el panel de atribución se iría a cero de un día para otro.
   · Modo MEDIDO (la sesión tiene algún utm_fresh no-null): un toque es un clic real, y un
     page_view sin señal cuenta como toque directo. El dedupe pasa a ser por cubeta de 30 min +
     canal, así dos clics reales a la misma campaña con horas de diferencia cuentan DOS veces
     (hoy se colapsan en uno y el modelo lineal reparte mal).
   · Modo LEGACY (todo null): exactamente el comportamiento de siempre. */
function rutaDeToques(evs, tVenta, ventanaMs, resolver) {
  const dentro = (evs || [])
    .map(e => ({ t: new Date(e.created_at).getTime(), e }))
    .filter(x => !isNaN(x.t) && x.t <= tVenta && x.t >= tVenta - ventanaMs)
    .sort((a, b) => a.t - b.t);
  if (!dentro.length) return { toques: [], medida: false };
  const medida = dentro.some(x => x.e.utm_fresh === true || x.e.utm_fresh === false);
  const toques = [];
  if (!medida) {
    // LEGACY: dedupe de consecutivos (el utm se arrastra desde localStorage, así que una
    // revisita repite el canal anterior y no es un toque nuevo).
    dentro.forEach(x => {
      const c = canalDe(x.e, resolver); c.t = x.t;
      if (!toques.length || toques[toques.length - 1].key !== c.key) toques.push(c);
    });
    return { toques, medida: false };
  }
  let ultima = null;
  dentro.forEach(x => {
    const fresh = x.e.utm_fresh;
    let c;
    if (fresh === true) c = canalDe(x.e, resolver);                       // clic real
    else if (fresh === false) { if (x.e.type !== 'page_view') return; c = canalDe(null); }  // directo
    else return;                                                          // null en sesión medida: se ignora
    c.t = x.t;
    // Cubeta de 30 min: dos eventos del mismo canal muy pegados son la misma visita, no dos clics.
    const cubeta = Math.floor(x.t / 1800000);
    if (ultima && ultima.key === c.key && ultima.cubeta === cubeta) return;
    ultima = { key: c.key, cubeta };
    toques.push(c);
  });
  return { toques, medida: true };
}

/* ── PUENTE DE IDENTIDAD (utm.attr, escrito por createOrder) ───────────────
   Los pedidos de Paylink/WhatsApp nacen en el panel sin session_id. api/_orders.js les hereda
   la sesión del mismo cliente (por teléfono/cédula/email) y la guarda en utm.attr. Aquí se
   consume: sin esto, el 71% de la facturación seguiría cayendo entero en "Directo". */
const sesionDe = o => o.session_id || (o.utm && o.utm.attr && o.utm.attr.session) || null;

// UTM efectivo del pedido. El propio SIEMPRE manda; el heredado es solo respaldo — nunca al revés,
// o un pedido con campaña propia quedaría atribuido a la campaña de una visita anterior.
function utmEfectivo(o) {
  const u = (o.utm && typeof o.utm === 'object' && !Array.isArray(o.utm)) ? o.utm : {};
  if (u.campaign_id || u.utm_campaign || u.utm_source) return u;
  const a = u.attr || {};
  if (a.utm && (a.utm.campaign_id || a.utm.utm_campaign || a.utm.utm_source)) {
    return Object.assign({}, a.utm, a.utm_first ? { utm_first: a.utm_first } : {});
  }
  return u;
}

// rutas = [{valor, toques:[canalDe(...)]}] → los 5 modelos de Shopify, mismas definiciones:
// el pct es sobre la facturación total atribuida; en cualquier_clic suma >100% a propósito
// (cada canal tocado recibe el 100% de la venta).
// `gastoPorId` (opcional) = Map campaign_id → inversión: añade inversion/roas/cpa a cada fila.
// Shopify muestra ventas atribuidas pero NO conoce tu gasto publicitario, así que no puede dar
// ROAS por modelo. Si Meta falla o da timeout, se pasa null y la salida es la de siempre.
function aplicarModelos(rutas, gastoPorId) {
  const acum = { ultimo_clic_no_directo: {}, ultimo_clic: {}, primer_clic: {}, cualquier_clic: {},
                 lineal: {}, decaimiento: {}, posicion: {} };
  const add = (m, t, fac, cmp) => {
    const b = m[t.key] = m[t.key] || { canal: t.canal, campaign_id: t.campaign_id, facturacion: 0, compras: 0 };
    b.facturacion += fac; b.compras += cmp;
  };
  let total = 0;
  rutas.forEach(r => {
    const t = r.toques;
    if (!t.length) return;
    total += r.valor;
    add(acum.ultimo_clic, t[t.length - 1], r.valor, 1);
    add(acum.primer_clic, t[0], r.valor, 1);
    // último clic no directo: se ignora el directo… salvo que TODA la ruta sea directa
    const noDir = t.filter(x => !x.directo);
    add(acum.ultimo_clic_no_directo, noDir.length ? noDir[noDir.length - 1] : t[t.length - 1], r.valor, 1);
    // cualquier clic: canales ÚNICOS de la ruta (no consecutivos), 100% a cada uno
    const vistos = new Set();
    t.forEach(x => { if (!vistos.has(x.key)) { vistos.add(x.key); add(acum.cualquier_clic, x, r.valor, 1); } });
    // lineal: reparto equitativo entre todos los clics (un canal repetido no consecutivo suma doble)
    t.forEach(x => add(acum.lineal, x, r.valor / t.length, 1 / t.length));

    /* ── DECAIMIENTO TEMPORAL (semivida 7 días) — Shopify NO lo tiene ──
       Reparte según lo CERCA que estuvo cada toque de la compra: quién CERRÓ la venta. En un
       ciclo de compra corto (impulso, móvil, contra entrega) 7 días es la semivida correcta. */
    const tv = r.tv || (t[t.length - 1] && t[t.length - 1].t) || 0;
    const pesos = t.map(x => Math.pow(0.5, Math.max(0, tv - (x.t || tv)) / (7 * 86400000)));
    const sumaP = pesos.reduce((s, p) => s + p, 0) || 1;
    t.forEach((x, i) => add(acum.decaimiento, x, r.valor * pesos[i] / sumaP, pesos[i] / sumaP));

    /* ── BASADO EN POSICIÓN 40/20/40 — Shopify NO lo tiene ──
       El más valioso aquí: con prospección + remarketing, el último clic hace que el remarketing
       parezca infinitamente rentable y la prospección muerta. El trafficker apaga la prospección
       y a las dos semanas el remarketing se seca por falta de audiencia. Este modelo rescata al
       toque que ABRIÓ la venta, y es lo que hace que roas_min sea una señal honesta. */
    if (t.length === 1) add(acum.posicion, t[0], r.valor, 1);
    else if (t.length === 2) { add(acum.posicion, t[0], r.valor * 0.5, 0.5); add(acum.posicion, t[1], r.valor * 0.5, 0.5); }
    else {
      add(acum.posicion, t[0], r.valor * 0.4, 0.4);
      add(acum.posicion, t[t.length - 1], r.valor * 0.4, 0.4);
      const medios = t.slice(1, -1);
      medios.forEach(x => add(acum.posicion, x, r.valor * 0.2 / medios.length, 0.2 / medios.length));
    }
  });
  const out = {};
  Object.keys(acum).forEach(m => {
    out[m] = Object.values(acum[m]).map(b => {
      const fac = Math.round(b.facturacion);
      const inv = (gastoPorId && b.campaign_id) ? (gastoPorId.get(String(b.campaign_id)) || 0) : 0;
      return {
        canal: b.canal, campaign_id: b.campaign_id,
        facturacion: fac,
        compras: +b.compras.toFixed(2),
        pct: total ? +(b.facturacion / total * 100).toFixed(1) : 0,
        // Solo se declara ROAS cuando de verdad hay gasto cruzado: 0 gasto → null, no infinito.
        inversion: inv || null,
        roas: inv > 0 ? +(fac / inv).toFixed(2) : null,
        cpa: (inv > 0 && b.compras > 0) ? Math.round(inv / b.compras) : null
      };
    }).sort((a, b) => b.facturacion - a.facturacion);
  });
  return out;
}

/* ── Perfiles de cliente (clave tel + merge transitivo por cédula) ─────────
   Base ÚNICA de "quién es un cliente": la usan la sección CLIENTES, el RFM, las cohortes
   y el export de audiencia de api/admin.js (vía module.exports._clientes). Dos construcciones
   en paralelo darían conteos distintos en pantallas distintas — por eso vive aquí una sola vez.
   Requiere que cada orden traiga o._dia (YYYY-MM-DD, hora Colombia) ya calculado. */
const telKeyDe = t => String(t || '').replace(/\D/g, '').slice(-10);
const cedKeyDe = c => { const k = String(c || '').replace(/\D/g, ''); return k.length >= 4 ? k : ''; };
function perfilesDe(ordenes, enRango) {
  const perfiles = {};   // telKey → perfil
  ordenes.forEach(o => {
    // Sin tel no hay perfil; sin _dia válido (created_at corrupto → '' o 'Invalid Date')
    // tampoco: una fecha rota aquí envenena RFM (r_dias NaN) y cohortes (mes '').
    const k = telKeyDe(o.tel); if (!k || !o._dia || o._dia.length !== 10) return;
    if (!perfiles[k]) perfiles[k] = { tel: k, tels: [k], nombre: '', ciudad: '', fechas: [], compras: [], netasR: 0, pedR: 0, ceds: {} };
    const p = perfiles[k];
    const neta = o.subtotal != null ? o.subtotal : (o.total || 0);
    p.fechas.push(o._dia);
    p.compras.push({ d: o._dia, v: neta });   // por compra: día + neto → M del RFM y LTV por mes de cohorte
    if (o.nombre) p.nombre = o.nombre;        // ordenes viene ascendente → gana el dato más reciente
    if (o.ciudad) p.ciudad = o.ciudad;
    const ck = cedKeyDe(o.cedula); if (ck) p.ceds[ck] = 1;
    if (enRango(o)) { p.netasR += neta; p.pedR++; }
  });
  // merge transitivo por cédula: el mismo cliente con OTRO teléfono pero la MISMA cédula = un perfil
  const porCed = {}; const lista = [];
  Object.values(perfiles).forEach(p => {
    const dueno = Object.keys(p.ceds).map(k => porCed[k]).find(Boolean);
    if (dueno) {
      dueno.fechas.push(...p.fechas); dueno.compras.push(...p.compras);
      dueno.netasR += p.netasR; dueno.pedR += p.pedR;
      if (!dueno.tels.includes(p.tel)) dueno.tels.push(p.tel);   // teléfonos extra → export de audiencia
      Object.keys(p.ceds).forEach(k => { porCed[k] = dueno; });
    } else {
      Object.keys(p.ceds).forEach(k => { porCed[k] = p; });
      lista.push(p);
    }
  });
  lista.forEach(p => { p.fechas.sort(); p.compras.sort((a, b) => (a.d < b.d ? -1 : 1)); });
  return lista;
}

/* ── RFM (informes de clientes de Shopify) ─────────────────────────────────
   R = días desde la última compra · F = nº de ventas · M = ventas netas de por vida (LTV).
   Puntaje 1-5 por QUINTILES DE RANGO sobre la base real de clientes (nada de umbrales a
   dedo): se ordena el valor y el puntaje sale de la posición; los empatados comparten
   puntaje (rank MÍNIMO del grupo). El rank mínimo — y no el promedio — importa con F:
   en una base típica la mayoría compró UNA vez; con rank promedio ese bloque mayoritario
   subía a F=3 y salía etiquetado "Leales"/"Campeones" con una sola compra (auditoría Ola 1).
   Con rank mínimo el valor más bajo SIEMPRE puntúa 1 → "Nuevos" (F=1) existe de verdad.
   Con menos de 5 clientes se degrada con elegancia: la escala 1-5 se reparte por posición
   (2 clientes → 1 y 5 · 3 → 1, 3 y 5); con 1 solo cliente todo es 3 (neutro, no "todo 5").
   R se puntúa INVERTIDO: menos días desde la última compra = mejor puntaje. */
function escala15(vals, invertido) {
  const n = vals.length;
  if (n <= 1) return () => 3;
  const orden = [...vals].sort((a, b) => a - b);
  return v => {
    const rank = orden.indexOf(v);   // rank mínimo de los empatados → mismo valor, mismo puntaje
    const s = n >= 5 ? Math.min(5, Math.floor(rank * 5 / n) + 1)
                     : Math.round(rank * 4 / (n - 1)) + 1;
    return invertido ? 6 - s : s;
  };
}

/* Etiquetas por el par (R,F) — REGLA EXACTA, evaluada en orden (la primera que aplica gana):
     Campeones   : R≥4 y F≥4 — compran mucho y hace poco
     Leales      : R≥3 y F≥3 — compran seguido y siguen activos (sin ser campeones)
     Nuevos      : R≥4 y F=1 — primera compra, muy reciente
     Potenciales : R≥3 y F≤2 — recientes con pocas compras (candidatos a la 2ª compra)
     En riesgo   : R=2 y F≥3 — eran buenos clientes y se están enfriando
     Dormidos    : R=2 y F≤2 — compraron poco y hace rato
     Perdidos    : R=1       — el quintil más viejo de recencia, sin importar F
   Cubre TODO el plano R×F (1..5 × 1..5): ningún cliente queda sin etiqueta. */
const RFM_ETIQUETAS = ['Campeones', 'Leales', 'Potenciales', 'Nuevos', 'En riesgo', 'Dormidos', 'Perdidos'];
function etiquetaRF(r, f) {
  if (r >= 4 && f >= 4) return 'Campeones';
  if (r >= 3 && f >= 3) return 'Leales';
  if (r >= 4 && f === 1) return 'Nuevos';
  if (r >= 3) return 'Potenciales';
  if (r === 2 && f >= 3) return 'En riesgo';
  if (r === 2) return 'Dormidos';
  return 'Perdidos';
}

// lista de perfilesDe() + día de hoy → cada cliente con sus valores crudos, puntajes y etiqueta.
function rfmDe(lista, hoy) {
  const cli = lista.filter(p => p.fechas.length).map(p => {
    const ult = p.fechas[p.fechas.length - 1];
    return {
      tel: p.tel, tels: p.tels, nombre: p.nombre || '', ciudad: p.ciudad || '',
      r_dias: Math.max(0, diffDays(ult, hoy)),
      f_ventas: p.compras.length,
      m_neto: p.compras.reduce((s, c) => s + c.v, 0),
      primera: p.fechas[0], ultima: ult
    };
  });
  const eR = escala15(cli.map(c => c.r_dias), true);
  const eF = escala15(cli.map(c => c.f_ventas), false);
  const eM = escala15(cli.map(c => c.m_neto), false);
  cli.forEach(c => {
    c.r = eR(c.r_dias); c.f = eF(c.f_ventas); c.m = eM(c.m_neto);
    c.puntaje = `${c.r}${c.f}${c.m}`;
    c.etiqueta = etiquetaRF(c.r, c.f);
  });
  return cli;
}

/* ── Cohortes por MES DE PRIMERA COMPRA (análisis de cohorte de Shopify) ───
   retencion[m] = % de la cohorte con ≥1 compra en el mes m contado desde su primer mes
   (m=0 SIEMPRE es 100 por construcción: la primera compra cae en su propio mes).
   ltv_acumulado[m] = ventas netas acumuladas POR CLIENTE hasta el mes m. */
function cohortesDe(lista, hoy) {
  const mIdx = k => { const [y, m] = k.split('-').map(Number); return y * 12 + (m - 1); };   // sirve para YYYY-MM y YYYY-MM-DD
  const hoyIdx = mIdx(hoy);
  const cohMap = {};
  lista.forEach(p => {
    if (!p.fechas.length) return;
    const mes = p.fechas[0].slice(0, 7);
    const c = cohMap[mes] = cohMap[mes] || { mes, clientes: 0, act: {}, rev: {} };
    c.clientes++;
    const base = mIdx(p.fechas[0]);
    const activos = new Set();
    p.compras.forEach(cp => {
      const off = mIdx(cp.d) - base;
      if (off < 0 || off > 36) return;   // cinturón: fechas corruptas o más de 3 años
      activos.add(off);
      c.rev[off] = (c.rev[off] || 0) + cp.v;
    });
    activos.forEach(off => { c.act[off] = (c.act[off] || 0) + 1; });   // cliente cuenta UNA vez por mes
  });
  return Object.values(cohMap).sort((a, b) => (a.mes < b.mes ? -1 : 1)).map(c => {
    // La matriz llega hasta HOY (los meses futuros no existen todavía), tope 36 columnas.
    const span = Math.max(0, Math.min(hoyIdx - mIdx(c.mes), 36));
    const retencion = [], ltv = [];
    let acum = 0;
    for (let m = 0; m <= span; m++) {
      retencion.push(+((c.act[m] || 0) / c.clientes * 100).toFixed(1));
      acum += c.rev[m] || 0;
      ltv.push(Math.round(acum / c.clientes));
    }
    return { mes: c.mes, clientes: c.clientes, retencion, ltv_acumulado: ltv };
  });
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
    let truncadoVentas = false, truncadoEvents = false;   // flags si pegamos los límites (Codex #6)
    if (sbSvc) {
      const [v, c] = await Promise.all([
        sbSvc.from('orders')
          .select('id,subtotal,total,envio,created_at,pago,utm,items,tel,cedula,nombre,ciudad,estado_envio,session_id')
          .eq('status', 'venta').order('created_at', { ascending: true }).limit(5000),
        sbSvc.from('product_costs').select('ptype,pid,costo')
      ]);
      // Fuera del dashboard: las pruebas del admin y las DEVOLUCIONES. Un paquete devuelto se
      // marcaba 'venta' igual, así que inflaba la facturación y el ROAS con plata que nunca
      // entró — crítico en contra entrega, donde el rechazo en puerta es del 10-25%.
      todas = (v.data || []).filter(o => !(o.utm && o.utm.test) && o.estado_envio !== 'devuelto');
      truncadoVentas = todas.length === 5000;
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
    // La construcción vive en perfilesDe() (arriba): la comparten esta sección, el RFM,
    // las cohortes y el export de audiencia de api/admin.js — un solo número de clientes.
    const lista = perfilesDe(todas, enRango);
    let nuevos = 0, recurrentes = 0, ventasNuevos = 0, ventasRec = 0, pedidosRango = 0, gapSum = 0, gapN = 0;
    lista.forEach(p => {
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

    // ── 3b. RFM + COHORTES — SIEMPRE sobre el histórico completo (`todas`), NO el rango:
    // el R de un cliente y la retención de una cohorte se miden a lo largo del tiempo;
    // cortarlos por el rango del dashboard los haría mentir (un Campeón de meses pasados
    // saldría "Perdido" en un rango de 7 días).
    const hoyK = dayKeyOf(Date.now());
    const rfmCli = rfmDe(lista, hoyK);
    const segMap = {};
    RFM_ETIQUETAS.forEach(e => { segMap[e] = { etiqueta: e, clientes: 0, facturacion: 0 }; });
    let facRfm = 0;
    rfmCli.forEach(c => { const s = segMap[c.etiqueta]; s.clientes++; s.facturacion += c.m_neto; facRfm += c.m_neto; });
    // Tope de la lista en el JSON: 500 clientes (mayor LTV primero). Si se corta se DICE
    // en lista_truncada — nada de truncar en silencio (el export CSV sí sale completo).
    const RFM_LISTA_MAX = 500;
    const rfmOrden = [...rfmCli].sort((a, b) => b.m_neto - a.m_neto);
    const rfm = {
      base: 'historico_completo',
      clientes: rfmCli.length,
      segmentos: RFM_ETIQUETAS.map(e => {
        const s = segMap[e];
        return {
          etiqueta: s.etiqueta, clientes: s.clientes, facturacion: s.facturacion,
          pct_clientes: rfmCli.length ? +(s.clientes / rfmCli.length * 100).toFixed(1) : 0,
          pct_facturacion: facRfm ? +(s.facturacion / facRfm * 100).toFixed(1) : 0
        };
      }),
      lista: rfmOrden.slice(0, RFM_LISTA_MAX),
      lista_truncada: rfmOrden.length > RFM_LISTA_MAX,
      lista_max: RFM_LISTA_MAX
    };
    const cohortes = cohortesDe(lista, hoyK);

    // ── 4. FUNNEL + PRODUCTOS (events del rango) ────────────────────────────
    let funnel = null;
    let visitantes = null;   // recurrencia de visitantes (incluye anónimos)
    const prodStats = {};   // id numérico → {views, atc}
    const sesVentas = new Set(ventas.map(sesionDe).filter(Boolean));
    const evVentas = {};     // session_id (de una venta) → events con utm, para la ruta de toques
    if (sbSvc) {
      let qe = sbSvc.from('events').select('session_id,type,product_id,created_at,utm_source,utm_medium,utm_campaign,utm_content,campaign_id,adset_id,ad_id,utm_fresh').limit(20000);
      if (since) qe = qe.gte('created_at', since + 'T00:00:00');
      if (until) qe = qe.lte('created_at', until + 'T23:59:59');
      const { data: evs } = await qe;
      truncadoEvents = (evs || []).length === 20000;
      // Embudo por SESIONES ÚNICAS y ENCADENADO (hallazgo Codex #6): el paso N solo cuenta
      // sesiones que también pasaron por TODOS los pasos anteriores → embudo siempre
      // decreciente y tasas ≤100%, aunque haya eventos parciales o datos viejos.
      const porPaso = { page_view: new Set(), view_product: new Set(), add_to_cart: new Set(), initiate_checkout: new Set(), reached_payment: new Set(), lead: new Set() };
      const diasPorSesion = {};   // session_id → Set de días distintos con actividad (recurrencia)
      (evs || []).forEach(e => {
        if (e.session_id && sesVentas.has(e.session_id)) (evVentas[e.session_id] = evVentas[e.session_id] || []).push(e);
        if (porPaso[e.type]) porPaso[e.type].add(e.session_id);
        if (e.session_id) (diasPorSesion[e.session_id] = diasPorSesion[e.session_id] || new Set()).add(dayKeyOf(e.created_at));
        // product_id: 'L34' = liquidación, '34' = catálogo (numéricos viejos se asumen cat)
        const m = /^(L?)(\d+)$/i.exec(String(e.product_id || ''));
        if (m && (e.type === 'view_product' || e.type === 'add_to_cart')) {
          const key = (m[1] ? 'liq' : 'cat') + ':' + parseInt(m[2]);
          if (!prodStats[key]) prodStats[key] = { views: 0, atc: 0 };
          if (e.type === 'view_product') prodStats[key].views++; else prodStats[key].atc++;
        }
      });
      let cadena = porPaso.page_view;
      const paso = s => { cadena = new Set([...s].filter(x => cadena.has(x))); return cadena.size; };
      // reached_payment existe desde 2026-06-07: en rangos sin ese evento el paso se omite
      // (null → el front lo oculta) para no romper la cadena de rangos históricos.
      const hayRP = porPaso.reached_payment.size > 0;
      funnel = {
        sessions: porPaso.page_view.size,
        view_product: paso(porPaso.view_product),
        add_to_cart: paso(porPaso.add_to_cart),
        initiate_checkout: paso(porPaso.initiate_checkout),
        reached_payment: hayRP ? paso(porPaso.reached_payment) : null,
        leads: paso(porPaso.lead),
        ventas: compras
      };
      // Visitantes recurrentes: sesiones con actividad en ≥2 días distintos del rango (incluye
      // anónimos). Detección por dispositivo/navegador (mismo session_id persistente).
      const hoyKey = dayKeyOf(Date.now());
      const totalVis = Object.keys(diasPorSesion).length;
      let recurrentes = 0, volvieronHoy = 0;
      for (const sid in diasPorSesion) {
        const dias = diasPorSesion[sid];
        if (dias.size >= 2) { recurrentes++; if (dias.has(hoyKey)) volvieronHoy++; }
      }
      visitantes = {
        total: totalVis,
        recurrentes,
        recurrentes_pct: totalVis ? +(recurrentes / totalVis * 100).toFixed(1) : 0,
        volvieron_hoy: volvieronHoy
      };
    }

    // ── 4b. ATRIBUCIÓN (5 modelos Shopify, ventana 30 días) ────────────────
    // Los toques de una venta de inicios del rango viven ANTES de `since` y no entran en la
    // query principal: query aparte acotada a since−30d y SOLO a las sesiones de las ventas
    // del rango (nunca la tabla entera — el .limit(20000) de arriba existe por algo).
    let atribParcial = false;   // rutas posiblemente incompletas por límites → se DECLARA en el JSON
    if (sbSvc && since && sesVentas.size) {
      const ids = [...sesVentas].slice(0, 500);   // cinturón: URLs de .in() acotadas
      if (sesVentas.size > ids.length) atribParcial = true;   // hay ventas cuyos toques previos no se consultaron
      const lotes = [];
      for (let i = 0; i < ids.length; i += 100) {
        lotes.push(sbSvc.from('events')
          .select('session_id,created_at,type,utm_source,utm_campaign,campaign_id,utm_fresh')
          .in('session_id', ids.slice(i, i + 100))
          .gte('created_at', addDays(since, -30) + 'T00:00:00')
          .lt('created_at', since + 'T00:00:00')
          // Si el lote pega el tope, conservar los toques MÁS CERCANOS a la venta (no filas al azar)
          .order('created_at', { ascending: false })
          .limit(5000));
      }
      (await Promise.all(lotes)).forEach(r => {
        const d = r.data || [];
        if (d.length === 5000) atribParcial = true;   // lote al tope: pueden faltar toques viejos
        d.forEach(e => { (evVentas[e.session_id] = evVentas[e.session_id] || []).push(e); });
      });
    }
    // Los toques DENTRO del rango salen de la query principal de events: si esa se truncó
    // (truncadoEvents), las rutas también pueden estar incompletas.
    if (truncadoEvents) atribParcial = true;

    // Ranking de productos: ventas del rango (items) × comportamiento (events)
    const prodMap = {};
    ventas.forEach(o => (Array.isArray(o.items) ? o.items : []).forEach(it => {
      const id = parseInt(it.id); if (!id) return;
      const key = `${it.type === 'liq' ? 'liq' : 'cat'}:${id}`;
      if (!prodMap[key]) prodMap[key] = { id, type: it.type === 'liq' ? 'liq' : 'cat', label: it.label || ('#' + id), unidades: 0, ingresos: 0 };
      prodMap[key].unidades += parseInt(it.qty) || 1;
      prodMap[key].ingresos += parseInt(it.precio) || 0;   // precio YA es total de línea (no ×qty)
    }));
    const productos = Object.values(prodMap).map(p => {
      const st = prodStats[`${p.type}:${p.id}`] || { views: 0, atc: 0 };
      return {
        ...p, views: st.views, atc: st.atc,
        conv_view_cart: st.views ? +(st.atc / st.views * 100).toFixed(1) : null,
        conv_cart_venta: st.atc ? +(Math.min(1, p.unidades / st.atc) * 100).toFixed(1) : null
      };
    }).sort((a, b) => b.ingresos - a.ingresos).slice(0, 10);

    // ── 5. CAMPAÑAS: ventas por utm + gasto/CTR/CPC/CPM de Meta ────────────
    const norm = s => String(s || '').trim().toLowerCase();
    // Cruce por campaign_id PRIMERO (hallazgo Codex #6): el id es estable aunque renombren
    // la campaña en Meta; el nombre (utm_campaign) queda como fallback para ventas viejas.
    const ventasPorId = {};      // campaign_id → {facturacion, compras, label}
    const ventasPorNombre = {};  // norm(utm_campaign) → idem
    ventas.forEach(o => {
      // utmEfectivo, no o.utm: así las ventas de Paylink que heredaron sesión dejan de caer
      // todas en '(sin_campaña)' con inversión 0 y por fin cruzan con el gasto de Meta.
      const u = utmEfectivo(o);
      const val = o.subtotal != null ? o.subtotal : (o.total || 0);
      const cid = u.campaign_id && !/\{\{/.test(String(u.campaign_id)) ? String(u.campaign_id) : null;
      const label = u.utm_campaign || '(sin_campaña)';
      const bucket = cid
        ? (ventasPorId[cid] = ventasPorId[cid] || { facturacion: 0, compras: 0, label })
        : (ventasPorNombre[norm(label)] = ventasPorNombre[norm(label)] || { facturacion: 0, compras: 0, label });
      bucket.facturacion += val;
      bucket.compras += 1;
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
        const fila = (s, v) => {
          const inv = s.spend || 0, fac = (v && v.facturacion) || 0, cmp = (v && v.compras) || 0;
          return {
            campana: s.name || (v && v.label) || '(sin nombre)',
            campaign_id: s.id || null,
            inversion: inv, facturacion: fac, compras: cmp,
            roas: inv > 0 ? +(fac / inv).toFixed(2) : null,
            cpa: (inv > 0 && cmp > 0) ? Math.round(inv / cmp) : null,
            impressions: s.impressions || 0, clicks: s.clicks || 0,
            ctr: s.ctr != null ? s.ctr : null, cpc: s.cpc != null ? s.cpc : null, cpm: s.cpm != null ? s.cpm : null
          };
        };
        const usadosId = new Set(), usadosNombre = new Set();
        campanas = ci.body.data.map(row => {
          const s = {
            spend: Math.round(parseFloat(row.spend || 0)), name: row.campaign_name, id: String(row.campaign_id || ''),
            impressions: parseInt(row.impressions) || 0, clicks: parseInt(row.clicks) || 0,
            ctr: row.ctr != null ? +parseFloat(row.ctr).toFixed(2) : null,
            cpc: row.cpc != null ? Math.round(parseFloat(row.cpc)) : null,
            cpm: row.cpm != null ? Math.round(parseFloat(row.cpm)) : null
          };
          // match por id primero; nombre normalizado como fallback (sin doble conteo)
          let v = null;
          if (s.id && ventasPorId[s.id]) { v = ventasPorId[s.id]; usadosId.add(s.id); }
          else if (ventasPorNombre[norm(s.name)]) { v = ventasPorNombre[norm(s.name)]; usadosNombre.add(norm(s.name)); }
          return fila(s, v);
        });
        // ventas que no matchearon con ninguna campaña de Meta (orgánico, ids viejos, otra cuenta)
        Object.entries(ventasPorId).forEach(([id, v]) => { if (!usadosId.has(id)) campanas.push(fila({ id }, v)); });
        Object.entries(ventasPorNombre).forEach(([k, v]) => { if (!usadosNombre.has(k)) campanas.push(fila({}, v)); });
        campanas.sort((a, b) => (b.roas || 0) - (a.roas || 0));
      } else if (ci && ci.body && ci.body.error) {
        campanas_error = ci.body.error.message || 'meta campaign insights error';
      }
    }

    // ROAS ATRIBUIDO (Codex, FASE M): SOLO campañas con gasto Y ventas cruzadas — mide tus
    // campañas del catálogo. Campañas con gasto y 0 ventas (otras marcas, pruebas, o que aún
    // no convierten) siguen visibles en la tabla con CTR/CPC/CPM pero NO entran aquí.
    const conCruce = campanas.filter(c => c.inversion > 0 && c.compras > 0);
    const invAtr = conCruce.reduce((s, c) => s + c.inversion, 0);
    const facAtr = conCruce.reduce((s, c) => s + c.facturacion, 0);
    const roas_atribuido = invAtr > 0 ? +(facAtr / invAtr).toFixed(2) : null;

    /* ── 5b. ATRIBUCIÓN (7 modelos, ventana 30 días) ───────────────────────
       Va DESPUÉS del bloque de campañas a propósito: necesita el catálogo de campañas de Meta
       para (a) unificar el canal —la misma campaña salía en dos filas según si el anuncio
       llevaba {{campaign.id}}— y (b) cruzar el gasto para dar ROAS por modelo, que es lo que
       Shopify no puede hacer (muestra ventas atribuidas pero no conoce tu inversión).
       Si Meta falla o da timeout, ambos mapas quedan vacíos y la salida es la de siempre. */
    const resolverCampana = new Map();
    const gastoPorId = new Map();
    campanas.forEach(c => {
      if (!c.campaign_id) return;
      if (c.campana) resolverCampana.set(String(c.campana).trim().toLowerCase(), String(c.campaign_id));
      if (c.inversion > 0) gastoPorId.set(String(c.campaign_id), c.inversion);
    });
    const rutas = [];
    let conRuta = 0, sinRuta = 0, rutasMedidas = 0;
    ventas.forEach(o => {
      const tv = new Date(o.created_at).getTime();
      const ses = sesionDe(o);            // propia, o la heredada por el puente de identidad
      // rutaDeToques decide solo entre modo MEDIDO (hay utm_fresh) y LEGACY (todo null).
      const rt = rutaDeToques((ses && evVentas[ses]) || [], tv, 30 * 86400000, resolverCampana);
      let toques = rt.toques;
      if (toques.length) { conRuta++; if (rt.medida) rutasMedidas++; }
      else {
        // Fallback (events podados, pedidos viejos): el utm del propio pedido — utm_first =
        // primer clic, el resto del utm = último. Solo canales reales: la ausencia de utm no
        // prueba que el primer toque fuera directo, solo que no hay dato.
        sinRuta++;
        toques = [];
        const ue = utmEfectivo(o);        // el utm propio, o el heredado del puente
        [canalDe(ue.utm_first, resolverCampana), canalDe(ue, resolverCampana)].filter(c => !c.directo)
          .forEach(c => { if (!toques.length || toques[toques.length - 1].key !== c.key) toques.push(c); });
        if (!toques.length) toques.push(canalDe(null));   // sin ningún dato = venta directa
        toques.forEach(c => { if (c.t == null) c.t = tv; });   // sin fecha real: se ancla a la venta
      }
      rutas.push({ valor: o.subtotal != null ? o.subtotal : (o.total || 0), tv, toques });
    });
    /* Cuántas ventas SIN session_id propio (las de Paylink/panel) lograron heredar una sesión.
       Se DECLARA en el JSON a propósito: "8 ventas de Paylink sin puente de identidad" es
       información accionable; un agujero silencioso no lo es. */
    const puente = { resueltos: 0, sin_puente: 0, por_via: {} };
    ventas.forEach(o => {
      if (o.session_id) return;                       // vino del checkout web: no aplica
      const a = (o.utm && o.utm.attr) || null;
      if (a && a.session) { puente.resueltos++; puente.por_via[a.via || 'otro'] = (puente.por_via[a.via || 'otro'] || 0) + 1; }
      else puente.sin_puente++;
    });
    const atribucion = { ventana_dias: 30, con_ruta: conRuta, sin_ruta: sinRuta, parcial: atribParcial, puente, calidad: { rutas_medidas: rutasMedidas, rutas_legacy: conRuta - rutasMedidas }, modelos: aplicarModelos(rutas, gastoPorId) };

    /* ROAS DE EQUILIBRIO desde TU margen real, no un número inventado: por debajo de este ROAS
       la campaña pierde plata. Solo se declara con cobertura de costos >= 30%; si no, null y el
       panel dice "registra costos para saberlo". Shopify enseña ROAS sin idea de tu margen. */
    const margenPct = resumen.ventas_netas ? resumen.margen_estimado / resumen.ventas_netas : 0;
    const breakeven = (resumen.margen_cobertura >= 0.3 && margenPct > 0) ? +(1 / margenPct).toFixed(2) : null;
    /* BANDA DE ROAS + VEREDICTO: qué dice CADA modelo sobre esta campaña.
       cualquier_clic se EXCLUYE: sus % suman >100% por diseño, así que agregarlo sería doble conteo. */
    const MODELOS_BANDA = ['ultimo_clic_no_directo', 'ultimo_clic', 'primer_clic', 'lineal', 'decaimiento', 'posicion'];
    campanas.forEach(c => {
      if (!c.campaign_id || !(c.inversion > 0)) return;
      const porModelo = {};
      MODELOS_BANDA.forEach(m => {
        const fila = (atribucion.modelos[m] || []).find(x => String(x.campaign_id) === String(c.campaign_id));
        if (fila) porModelo[m] = +(fila.facturacion / c.inversion).toFixed(2);
      });
      const vals = Object.values(porModelo);
      if (!vals.length) return;
      c.roas_por_modelo = porModelo;
      c.roas_min = Math.min(...vals);
      c.roas_max = Math.max(...vals);
      // Escalar solo si es rentable bajo TODOS los modelos; apagar solo si no lo es bajo NINGUNO.
      c.veredicto = breakeven == null ? 'observar'
        : c.roas_min > breakeven ? 'escalar'
        : c.roas_max < breakeven ? 'apagar' : 'observar';
    });


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
      roas_atribuido,                         // solo campañas del catálogo con gasto cruzado
      inversion_atribuida: invAtr || null,
      cpa_promedio:       cpa,
      por_campana:        campanas,
      truncado: (truncadoVentas || truncadoEvents) ? { ventas: truncadoVentas, events: truncadoEvents } : null,
      // ── analytics (FASE K) ──
      resumen,            // brutas/descuentos/netas/envios/total_cobrado/pedidos/aov/margen
      resumen_prev,       // misma estructura, ventana anterior (null si lifetime)
      serie,              // [{k, netas, pedidos, aov}] buckets continuos según group
      clientes,           // nuevos/recurrentes/returning_rate/ventas por grupo/frecuencia/días entre compras
      funnel,             // sessions/view_product/add_to_cart/initiate_checkout/leads/ventas
      visitantes,         // total/recurrentes/recurrentes_pct/volvieron_hoy (incluye anónimos)
      productos,          // top 10 por ingresos con views/ATC/conversiones
      atribucion,         // 7 modelos sobre la ruta de toques por sesión (ventana 30 días) + puente + calidad
      breakeven,          // ROAS de equilibrio derivado del margen real (null si la cobertura de costos < 30%)
      rfm,                // segmentos RFM + lista por cliente (tope declarado) — histórico completo
      cohortes,           // [{mes, clientes, retencion[], ltv_acumulado[]}] por mes de 1ª compra — histórico completo
      nota: 'Ventas netas (subtotal, post-descuento) es la base de ROAS. total_cobrado = caja (con envío). margen_estimado solo cubre ítems con costo registrado (ver margen_cobertura). Solo pedidos status=venta cuentan. El embudo es encadenado: cada paso cuenta sesiones que completaron todos los pasos anteriores. roas_atribuido cruza solo campañas con gasto Y ventas atribuidas (las de gasto sin ventas se ven en por_campana pero no entran); roas_promedio usa el gasto de TODA la cuenta Meta. atribucion aplica los 5 modelos de Shopify (ventana 30 días) sobre la ruta de toques reconstruida por session_id, repartiendo ventas netas; en cualquier_clic cada canal tocado recibe el 100% de la venta, por eso sus % suman más de 100 a propósito. rfm y cohortes se calculan SIEMPRE sobre el histórico completo (no el rango): puntajes 1-5 por quintiles sobre la base real de clientes, etiquetas derivadas del par (R,F); rfm.lista se corta en lista_max (ver lista_truncada). En cohortes, retencion[0] siempre es 100 y ltv_acumulado es por cliente.',
      meta_error,
      campanas_error
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// Núcleo puro de la atribución expuesto para pruebas locales (Vercel no lo usa).
module.exports._atrib = { canalDe, aplicarModelos, sesionDe, utmEfectivo, rutaDeToques };

// Núcleo puro de clientes (perfiles/RFM/cohortes): lo reusa api/admin.js (export_audiencia)
// para que el CSV contenga EXACTAMENTE los mismos clientes que cuenta el panel, y las pruebas.
module.exports._clientes = { perfilesDe, rfmDe, cohortesDe, escala15, etiquetaRF, RFM_ETIQUETAS };
