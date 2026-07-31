const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { rateLimit } = require('./_rate_limit');
const { anonClient, serviceClient, cleanText, createOrder, getOrderByReference, confirmPaidOrder, contentIdsDe, genWelcomeCode } = require('./_orders');
const { sendEvent } = require('./_capi');
const { createAddiApplication } = require('./_addi');
const { createScTransaction, getScInfo } = require('./_sistecredito');

// Comparación en tiempo constante para secretos de webhook (evita timing attacks).
function safeEq(a, b) {
  const ab = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

/* Lead por CAPI (FASE N8, plan Codex): misma señal que el px('Lead') del navegador pero
   server-side con teléfono/ciudad/nombre hasheados + fbp/fbc — Meta dedup por el MISMO
   eventId ({session_id}_lead). Solo pedidos reales con datos de contacto. Se AWAITEA en el
   handler (Codex #8: en serverless un fire-and-forget puede morir al responder); el catch
   garantiza que un fallo de Meta jamás rompa el checkout. */
function capiLead(order, req) {
  if (!order || order.status === 'abandoned' || !order.tel || !order.session_id) return Promise.resolve();
  if (order.utm && order.utm.test) return Promise.resolve();   // modo prueba: no enviar Lead a Meta
  const utm = order.utm || {};
  return sendEvent({
    eventName: 'Lead',
    value: order.subtotal != null ? order.subtotal : order.total,
    currency: 'COP',
    contentIds: contentIdsDe(order.items),
    phone: order.tel, city: order.ciudad, name: order.nombre,
    fbp: utm.fbp, fbc: utm.fbc,
    clientIp: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined,
    clientUserAgent: req.headers['user-agent'],
    eventId: String(order.session_id) + '_lead',
    actionSource: 'website',
    eventSourceUrl: 'https://strangesneakers.com/'
  }).catch(() => {});
}

const ALLOWED_ORIGINS = ['https://strangesneakers.com', 'https://www.strangesneakers.com'];
// Fallback si no se pudo asignar código único (p.ej. BD sin la columna aún): el genérico
// sigue existiendo para no dejar al suscriptor sin nada en la mano.
const CODIGO_BIENVENIDA = 'BIENVENIDO20';

function allowedOrigin(req, res) {
  const origin = (req.headers.origin || '').trim();
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Webhook-Secret, X-Bold-Signature');
  return ALLOWED_ORIGINS.includes(origin);
}

function sbForPrivateWrites() {
  return process.env.SUPABASE_SERVICE_KEY ? serviceClient() : anonClient();
}

async function handleSubscribe(req, res) {
  const d = req.body || {};
  const utm = (d.utm && typeof d.utm === 'object' && !Array.isArray(d.utm)) ? d.utm : null;
  const session_id = cleanText(d.session_id, 64);
  const sb = sbForPrivateWrites();

  // Lead por CAPI para suscriptores (Codex #8): popup/newsletter también son señal para Meta.
  // eventId con el MISMO sufijo que el px del navegador ({session}_news / {session}_subscribe)
  // → dedup. Solo con session_id; await + catch para no romper el registro.
  const capiSubLead = (eid, extra) => session_id
    ? sendEvent({ eventName: 'Lead', currency: 'COP',
        fbp: utm && utm.fbp, fbc: utm && utm.fbc,
        clientIp: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined,
        clientUserAgent: req.headers['user-agent'],
        eventId: String(session_id) + eid, actionSource: 'website',
        eventSourceUrl: 'https://strangesneakers.com/', ...extra }).catch(() => {})
    : Promise.resolve();

  const email = cleanText(d.email, 200) || '';
  if (d.source === 'footer' || (email && !d.whatsapp)) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'email invalido' });
    const { data: prev } = await sb.from('subscribers').select('id').eq('email', email).limit(1);
    if (!prev || !prev.length) {
      const { error } = await sb.from('subscribers').insert({ email, utm, session_id, source: 'footer' });
      if (error) return res.status(500).json({ error: error.message });
      await capiSubLead('_news', { email });
    }
    return res.status(201).json({ ok: true });
  }

  const nombre = cleanText(d.nombre, 200) || '';
  const whatsapp = d.whatsapp ? String(d.whatsapp).replace(/\D/g, '').slice(0, 20) : '';
  // Zero-party data (paso 2 del popup): talla y género llegan por clic en chips.
  const talla = d.talla != null ? cleanText(String(d.talla), 10) : null;
  const generoRaw = String(d.genero || '').toLowerCase();
  const genero = ['h', 'm', 'u'].includes(generoRaw) ? generoRaw : null;

  // update=1 → solo actualizar preferencias del suscriptor ya registrado (por WhatsApp o session).
  if (d.update) {
    const upd = {};
    if (talla) upd.talla = talla;
    if (genero) upd.genero = genero;
    if (!Object.keys(upd).length) return res.status(400).json({ error: 'nothing to update' });
    let q = sb.from('subscribers').update(upd);
    if (whatsapp.length >= 7) q = q.eq('whatsapp', whatsapp);
    else if (session_id) q = q.eq('session_id', session_id);
    else return res.status(400).json({ error: 'sin identificador' });
    const { error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (!nombre) return res.status(400).json({ error: 'nombre requerido' });
  if (whatsapp.length < 7) return res.status(400).json({ error: 'whatsapp invalido' });
  const cumple = cleanText(d.cumple, 20);   // compat: el popup ya no lo pide
  const { data: prev } = await sb.from('subscribers').select('id,welcome_code').eq('whatsapp', whatsapp).limit(1);
  let codigo = null;
  if (!prev || !prev.length) {
    // Código ÚNICO por suscriptor (BIENVENIDO20-XXXXX): el descuento vive atado a ESTA fila
    // (un solo uso, 7 días). Compartirlo en un grupo ya no regala $20.000 a desconocidos.
    // Reintento ante colisión del índice único — improbable (30^5 ≈ 24M combinaciones), pero
    // gratis de cubrir; cualquier otro error sí tumba el registro (mejor saberlo que callar).
    let err = null;
    for (let i = 0; i < 3 && !codigo; i++) {
      const cand = genWelcomeCode();
      const { error } = await sb.from('subscribers').insert({
        nombre, whatsapp, cumple, talla, genero, utm, session_id, source: 'popup_bienvenida',
        welcome_issued_at: new Date().toISOString(), welcome_code: cand
      });
      if (!error) codigo = cand;
      else if (/duplicate|unique/i.test(String(error.message))) err = error;   // colisión → otro código
      else return res.status(500).json({ error: error.message });
    }
    if (!codigo) return res.status(500).json({ error: err ? err.message : 'welcome_code' });
    await capiSubLead('_subscribe', { phone: whatsapp, name: nombre });
  } else {
    // Re-registro del mismo WhatsApp: se entrega el código de nuevo → renovar la vigencia
    // (el front también resetea ss_welcome_ts). Sin esto, el server quitaba el descuento
    // de un cupón que el front mostraba como válido (hallazgo Codex #2).
    // OJO: welcome_used_at NO se toca — si ya gastó su cupón, re-registrarse no lo revive
    // (para eso está "Reactivar" en el panel, decisión del admin).
    codigo = prev[0].welcome_code || null;
    const upd = { welcome_issued_at: new Date().toISOString(), session_id };
    if (codigo) {
      await sb.from('subscribers').update(upd).eq('id', prev[0].id);
    } else {
      // Suscriptor de la era del genérico: migración perezosa — se le asigna su código único
      // aquí y el popup ya le muestra el suyo. El genérico le sigue funcionando igual.
      for (let i = 0; i < 3 && !codigo; i++) {
        const cand = genWelcomeCode();
        const { error } = await sb.from('subscribers').update({ ...upd, welcome_code: cand }).eq('id', prev[0].id);
        if (!error) codigo = cand;
        else if (!/duplicate|unique/i.test(String(error.message))) break;   // error real → seguir sin código (el genérico lo cubre)
      }
      // Si no se pudo asignar código, al menos renovar la vigencia (comportamiento de siempre).
      if (!codigo) await sb.from('subscribers').update(upd).eq('id', prev[0].id);
    }
  }
  return res.status(201).json({ ok: true, codigo: codigo || CODIGO_BIENVENIDA });
}

async function handleBoldLink(req, res) {
  const key = process.env.BOLD_API_KEY;
  if (!key) return res.status(200).json({ error: 'bold_unavailable' });
  const reference = cleanText(req.body && req.body.reference, 100);
  if (!reference) return res.status(400).json({ error: 'reference requerida' });
  const order = await getOrderByReference(reference);
  if (!order) return res.status(404).json({ error: 'order_not_found' });
  const amount = Number(order.subtotal != null ? order.subtotal : order.total);
  if (!Number.isFinite(amount) || amount < 1000 || amount > 100_000_000) {
    return res.status(400).json({ error: 'amount fuera de rango' });
  }
  const description = cleanText(req.body && req.body.description, 100) || ('Pedido ' + reference);
  try {
    const r = await fetch('https://integrations.api.bold.co/online/link/v1', {
      method: 'POST',
      headers: { 'Authorization': 'x-api-key ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount_type: 'CLOSE',
        amount: { currency: 'COP', total_amount: amount, tip_amount: 0 },
        description,
        callback_url: 'https://strangesneakers.com/?bold=1'
      })
    });
    const j = await r.json().catch(() => ({}));
    const p = j.payload || j;
    if (!r.ok || !(p && p.url)) return res.status(502).json({ error: 'bold_error' });
    // Guardar el id del link en el pedido (utm jsonb, sin migración): es lo que permite a la
    // RECONCILIACIÓN preguntarle a Bold por este pago aunque el cliente nunca vuelva a la tienda.
    if (p.payment_link) {
      try {
        const sb = serviceClient();
        const utm = Object.assign({}, order.utm || {}, { bold_link: p.payment_link });
        await sb.from('orders').update({ utm }).eq('id', order.id);
      } catch {}
    }
    return res.status(200).json({ url: p.url, payment_link: p.payment_link, reference });
  } catch {
    return res.status(502).json({ error: 'bold_error' });
  }
}

function boldAmount(p) {
  return p?.amount?.total_amount ?? p?.amount?.total ?? p?.total_amount ?? p?.amount;
}

async function handleBoldStatus(req, res) {
  const key = process.env.BOLD_API_KEY;
  if (!key) return res.status(200).json({ status: 'UNKNOWN' });
  const d = req.body || {};
  const link = d.payment_link ? String(d.payment_link).replace(/[^\w-]/g, '').slice(0, 80) : '';
  if (!link) return res.status(400).json({ error: 'missing payment_link' });
  let status = 'UNKNOWN', amount = null;
  try {
    const r = await fetch('https://integrations.api.bold.co/online/link/v1/' + encodeURIComponent(link),
      { headers: { 'Authorization': 'x-api-key ' + key } });
    const j = await r.json().catch(() => ({}));
    const p = j.payload || j;
    status = (p && p.status) || 'UNKNOWN';
    amount = boldAmount(p);
  } catch {}
  let confirmed = false;
  if (status === 'PAID' && d.reference) {
    const ord = await getOrderByReference(d.reference);
    if (!ord) return res.status(404).json({ error: 'order_not_found' });
    // BINDING: el link consultado DEBE ser el guardado en ESA orden. Sin esto, cualquiera con un
    // payment_link PAID (el suyo) + una reference ajena válida podría marcar venta de otra orden.
    const bound = ord.utm && ord.utm.bold_link ? String(ord.utm.bold_link).replace(/[^\w-]/g, '').slice(0, 80) : '';
    if (!bound || bound !== link) return res.status(403).json({ error: 'link_mismatch' });
    if (amount == null) amount = Number(ord.subtotal != null ? ord.subtotal : ord.total); // link CLOSE creado server-side con el monto de BD
    const out = await confirmPaidOrder({ reference: d.reference, amount, currency: 'COP', req, origen: 'webhook_bold' }).catch(() => null);
    confirmed = !!(out && out.ok);
  }
  return res.status(200).json({ status, confirmed });
}

async function handleBoldWebhook(req, res) {
  const secret = (process.env.BOLD_WEBHOOK_SECRET || '').trim();
  const got = req.headers['x-webhook-secret'] || req.headers['x-bold-signature'] || req.query.secret;
  if (!secret || !safeEq(got, secret)) return res.status(202).json({ ok: false, error: 'webhook_not_configured_or_invalid' });
  const d = req.body || {};
  // Bold envía eventos {type:'SALE_APPROVED', data:{amount, metadata:{reference}, ...}}.
  // Se acepta también el formato plano viejo {status:'PAID', reference} por compatibilidad.
  const data = d.data || d.payload || d;
  const type = String(d.type || data.status || d.status || '');
  if (!/SALE_APPROVED|PAID/i.test(type)) return res.json({ ok: true, ignored: true, type });
  let reference = String((data.metadata && data.metadata.reference) || data.reference || d.reference || '');
  let amount = boldAmount(data);
  if (!/^STR-/.test(reference)) {
    // Pago de un payment link: la referencia del evento es el id del link (LNK_...).
    // Consultar el link en Bold y sacar nuestra referencia de la descripción "Pedido STR-...".
    const linkId = (reference.match(/LNK_[\w-]+/) || String(data.payment_link || '').match(/LNK_[\w-]+/) || [])[0];
    const key = process.env.BOLD_API_KEY;
    if (linkId && key) {
      try {
        const r = await fetch('https://integrations.api.bold.co/online/link/v1/' + encodeURIComponent(linkId),
          { headers: { 'Authorization': 'x-api-key ' + key } });
        const j = await r.json().catch(() => ({}));
        const p = j.payload || j;
        if (String(p.status || '') !== 'PAID') return res.json({ ok: true, ignored: true, link_status: p.status || null });
        const m = String(p.description || '').match(/STR-\d+/);
        if (m) reference = m[0];
        if (amount == null) amount = boldAmount(p);
      } catch {}
    }
  }
  if (!/^STR-/.test(reference)) return res.json({ ok: true, ignored: true, no_ref: true });
  if (amount == null) { // mismo fallback: el link CLOSE se creó server-side con el monto del pedido
    const ord = await getOrderByReference(reference);
    if (ord) amount = Number(ord.subtotal != null ? ord.subtotal : ord.total);
  }
  const out = await confirmPaidOrder({ reference, amount, currency: 'COP', req, origen: 'webhook_bold_link' });
  return res.json(out);
}

/* ── ADDI (crédito BNPL) ── espejo del flujo de Bold. createAddiApplication vive en _addi.js. ── */
async function handleAddiLink(req, res) {
  if (!process.env.ADDI_CLIENT_ID || !process.env.ADDI_CLIENT_SECRET) return res.status(200).json({ error: 'addi_unavailable' });
  const reference = cleanText(req.body && req.body.reference, 100);
  if (!reference) return res.status(400).json({ error: 'reference requerida' });
  const order = await getOrderByReference(reference);
  if (!order) return res.status(404).json({ error: 'order_not_found' });
  const amount = Number(order.subtotal != null ? order.subtotal : order.total);
  if (!Number.isFinite(amount) || amount < 1000) return res.status(400).json({ error: 'amount fuera de rango' });
  const email = cleanText(req.body && req.body.email, 120);
  try {
    const { redirectUrl, applicationId } = await createAddiApplication(order, email);
    // Trazas en utm (jsonb, sin migración): applicationId si Addi lo dio + email para registro.
    try {
      const sb = serviceClient();
      const utm = Object.assign({}, order.utm || {}, { addi_app: applicationId || (order.utm && order.utm.addi_app) || null, email: email || (order.utm && order.utm.email) || null });
      await sb.from('orders').update({ utm }).eq('id', order.id);
    } catch {}
    return res.status(200).json({ url: redirectUrl, reference });
  } catch (e) {
    return res.status(502).json({ error: 'addi_error' });
  }
}

// Retorno del cliente (?addi=1): NO consultamos a Addi (su confirmación llega por webhook
// server-to-server). Solo reportamos si el pedido YA quedó marcado venta en BD.
async function handleAddiStatus(req, res) {
  const reference = cleanText(req.body && req.body.reference, 100);
  if (!reference) return res.status(400).json({ error: 'missing reference' });
  const order = await getOrderByReference(reference);
  return res.status(200).json({ confirmed: !!(order && order.status === 'venta'), status: order ? order.status : 'unknown' });
}

async function handleAddiWebhook(req, res) {
  // FAIL-CLOSED: exigir autenticación SIEMPRE. Acepta Basic auth (ADDI_WEBHOOK_USER/PASS) o un
  // secreto simple (ADDI_WEBHOOK_SECRET por header x-webhook-secret / x-addi-signature / ?secret).
  // Sin NINGUNA credencial configurada NO se procesa: un POST forjado {status:'APPROVED', orderId}
  // marcaría venta sin pago real (el monto sale del pedido server-side y pasaría la validación).
  const u = (process.env.ADDI_WEBHOOK_USER || '').trim();
  const p = (process.env.ADDI_WEBHOOK_PASS || '').trim();
  const sec = (process.env.ADDI_WEBHOOK_SECRET || '').trim();
  if (!((u && p) || sec)) return res.status(202).json({ ok: false, error: 'webhook_not_configured' });
  let authed = false;
  if (u && p) {
    const expected = 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
    if (safeEq(String(req.headers.authorization || ''), expected)) authed = true;
  }
  if (!authed && sec) {
    const got = req.headers['x-webhook-secret'] || req.headers['x-addi-signature'] || req.query.secret;
    if (safeEq(got, sec)) authed = true;
  }
  if (!authed) { console.error('[ADDI] webhook RECHAZADO (401): credenciales no coinciden'); return res.status(401).json({ ok: false, error: 'unauthorized' }); }
  const d = req.body || {};
  const data = d.data || d.payload || d;
  const reference = String(data.orderId || data.order_id || d.orderId || '');
  const status = String(data.status || d.status || '').toUpperCase();
  const aprobado = Number(data.approvedAmount != null ? data.approvedAmount : d.approvedAmount);
  // Addi documenta que reintenta cada 30 min durante 24h si no le respondemos como espera. Este log
  // es la única forma de ver desde afuera si está llegando, con qué referencia y en qué estado.
  console.log('[ADDI] webhook recibido · ref=' + (reference || '(sin)') + ' status=' + (status || '(sin)') +
              ' approvedAmount=' + (Number.isFinite(aprobado) ? aprobado : '(sin)'));
  // Addi exige responder 200 con EL MISMO objeto JSON que envió; cualquier otra cosa la cuenta
  // como fallo y reintenta. Antes devolvíamos {ok:true,...}, así que reintentaba indefinidamente.
  const eco = (extra) => res.status(200).json(Object.assign({}, d, extra || {}));
  if (!reference) return eco();
  if (status !== 'APPROVED') {
    // RECHAZO de crédito (sin cupo, etc.): antes se ignoraba y el pedido quedaba pending sin rastro.
    // Ahora se etiqueta (queda pending para recuperar por contra entrega; NO se marca venta).
    if (['REJECTED', 'DECLINED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'FAILED'].includes(status)) {
      try {
        const sb = serviceClient();
        const order = await getOrderByReference(reference);
        if (order && order.status !== 'venta') {
          const utm = Object.assign({}, order.utm || {}, { gateway_result: 'rejected', gateway: 'addi', gateway_status: status });
          await sb.from('orders').update({ utm }).eq('id', order.id);
        }
      } catch (e) { /* nunca romper el webhook */ }
    }
    return eco();
  }
  const order = await getOrderByReference(reference);
  if (!order) { console.error('[ADDI] APPROVED de una referencia que no existe en BD:', reference); return eco(); }
  const esperado = Number(order.subtotal != null ? order.subtotal : order.total);
  /* VALIDACIÓN REAL DEL MONTO. Antes se pasaba a confirmPaidOrder el monto del PROPIO pedido, así
     que la comparación era una tautología: siempre pasaba. Ahora, si Addi manda approvedAmount y
     NO coincide con lo que se cobró, no se marca venta y queda señalado para revisión manual.
     Si Addi no manda el campo, se sigue como antes (no se puede ser más estricto sin arriesgar
     tumbar ventas buenas), pero queda constancia de que no vino. */
  if (Number.isFinite(aprobado) && aprobado > 0 && Math.round(aprobado) !== Math.round(esperado)) {
    console.error('[ADDI] MONTO NO COINCIDE ref=' + reference + ' aprobado=' + aprobado + ' esperado=' + esperado + ' → NO se marca venta');
    try {
      const sb = serviceClient();
      const utm = Object.assign({}, order.utm || {}, {
        gateway_result: 'amount_mismatch', gateway: 'addi', gateway_status: status,
        approved_amount: aprobado, needs_manual_review: true
      });
      await sb.from('orders').update({ utm }).eq('id', order.id);
    } catch (e) { /* nunca romper el webhook */ }
    return eco();
  }
  const appId = data.applicationId || d.applicationId;
  const out = await confirmPaidOrder({
    reference, amount: esperado, currency: 'COP', req,
    origen: 'webhook_addi',
    extra: {
      gateway: 'addi', gateway_status: status,
      approved_amount: Number.isFinite(aprobado) ? aprobado : null,
      addi_app: appId || (order.utm && order.utm.addi_app) || null
    }
  });
  if (!out.ok) console.error('[ADDI] confirmPaidOrder falló ref=' + reference + ':', out.error);
  return eco();
}

/* ── SISTECRÉDITO (crédito BNPL) ── espejo de Addi. Helpers en _sistecredito.js. Tiene endpoint
   de estado (getInfoCredit) → confirmación por retorno + webhook + reconciliación. ── */
async function handleScLink(req, res) {
  if (!process.env.SISTECREDITO_SUBSCRIPTION_KEY || !process.env.SISTECREDITO_VENDOR_ID) return res.status(200).json({ error: 'sistecredito_unavailable' });
  const reference = cleanText(req.body && req.body.reference, 100);
  if (!reference) return res.status(400).json({ error: 'reference requerida' });
  const order = await getOrderByReference(reference);
  if (!order) return res.status(404).json({ error: 'order_not_found' });
  const amount = Number(order.subtotal != null ? order.subtotal : order.total);
  if (!Number.isFinite(amount) || amount < 1000) return res.status(400).json({ error: 'amount fuera de rango' });
  try {
    const { transactionId, redirectUrl } = await createScTransaction(order);
    try {
      const sb = serviceClient();
      const utm = Object.assign({}, order.utm || {}, { sc_txn: transactionId });
      await sb.from('orders').update({ utm }).eq('id', order.id);
    } catch {}
    return res.status(200).json({ url: redirectUrl, reference });
  } catch (e) {
    return res.status(502).json({ error: 'sistecredito_error' });
  }
}

// Retorno del cliente (?sistecredito=1): consulta el estado (getInfoCredit) y, si está pagado,
// marca la venta. amount = subtotal del pedido (lo fijamos server-side al crear la transacción).
async function handleScStatus(req, res) {
  const reference = cleanText(req.body && req.body.reference, 100);
  if (!reference) return res.status(400).json({ error: 'missing reference' });
  const order = await getOrderByReference(reference);
  if (!order) return res.status(404).json({ error: 'order_not_found' });
  if (order.status === 'venta') return res.status(200).json({ confirmed: true, status: 'venta' });
  const txn = order.utm && order.utm.sc_txn;
  if (!txn) return res.status(200).json({ confirmed: false, status: order.status });
  let paid = false;
  try { paid = (await getScInfo(txn)).paid; } catch {}
  if (paid) {
    const out = await confirmPaidOrder({ reference, amount: Number(order.subtotal != null ? order.subtotal : order.total), currency: 'COP', req, origen: 'webhook_sistecredito' });
    return res.status(200).json({ confirmed: !!out.ok, status: out.ok ? 'venta' : order.status });
  }
  return res.status(200).json({ confirmed: false, status: order.status });
}

// Webhook (responseUrl): Sistecrédito hace POST con OrderId (entero). En vez de confiar en el
// payload/JWT, re-consultamos getInfoCredit y confirmamos solo si está pagado (idempotente).
async function handleScWebhook(req, res) {
  const d = req.body || {};
  const oid = parseInt(d.OrderId || d.orderId || (d.data && d.data.OrderId), 10);
  if (!Number.isFinite(oid)) return res.json({ ok: true, ignored: true, no_ref: true });
  const sb = serviceClient();
  const { data: order } = await sb.from('orders').select('*').eq('id', oid).single();
  if (!order) return res.json({ ok: true, ignored: true, order_not_found: true });
  const txn = order.utm && order.utm.sc_txn;
  if (!txn) return res.json({ ok: true, ignored: true, no_txn: true });
  let paid = false;
  try { paid = (await getScInfo(txn)).paid; } catch {}
  if (!paid) return res.json({ ok: true, ignored: true, not_paid: true });
  const out = await confirmPaidOrder({ reference: order.reference, amount: Number(order.subtotal != null ? order.subtotal : order.total), currency: 'COP', req, origen: 'retorno_sistecredito' });
  return res.json(out);
}

/* ── RECONCILIACIÓN (cron cada 10 min) ── malla de seguridad bajo los webhooks: toma los
   pedidos Wompi/Bold pendientes con 5+ min de vida y les pregunta DIRECTO a las pasarelas;
   si el pago está aprobado, confirma la venta (idempotente: confirmPaidOrder valida monto y
   no re-marca). Así una venta pagada nunca queda invisible aunque el webhook falle y el
   cliente no vuelva a la tienda. */
async function reconciliarPendientes(req, res) {
  // Vercel Cron manda "Authorization: Bearer CRON_SECRET" automáticamente si la env existe.
  const cs = (process.env.CRON_SECRET || '').trim();
  if (!cs || String(req.headers.authorization || '') !== 'Bearer ' + cs) return res.status(401).json({ ok: false });   // fail-closed: sin CRON_SECRET, rechazar
  const sb = serviceClient();
  const desde = new Date(Date.now() - 7 * 864e5).toISOString();   // no mirar más de 7 días atrás
  const hasta = new Date(Date.now() - 5 * 60e3).toISOString();    // dejar 5 min al flujo normal
  const { data: pend } = await sb.from('orders').select('*')
    .eq('status', 'pending').in('pago', ['wompi', 'bold', 'sistecredito', 'addi'])
    .gte('created_at', desde).lte('created_at', hasta)
    .order('created_at', { ascending: false }).limit(20);
  const out = [];
  for (const o of (pend || [])) {
    try {
      if (o.pago === 'bold') {
        const link = o.utm && o.utm.bold_link;
        if (!link) { out.push(o.reference + ':sin_link'); continue; }
        const key = process.env.BOLD_API_KEY;
        if (!key) break;
        const r = await fetch('https://integrations.api.bold.co/online/link/v1/' + encodeURIComponent(link),
          { headers: { 'Authorization': 'x-api-key ' + key } });
        const j = await r.json().catch(() => ({}));
        const p = j.payload || j;
        if (String(p.status || '') === 'PAID') {
          // El GET del link no siempre expone el monto. Es seguro usar el del pedido: el link
          // es CLOSE (monto fijo) y lo creamos NOSOTROS server-side leyendo ese mismo monto de BD.
          let amt = boldAmount(p);
          if (amt == null) amt = Number(o.subtotal != null ? o.subtotal : o.total);
          const c = await confirmPaidOrder({ reference: o.reference, amount: amt, currency: 'COP', req, origen: 'cron_bold' });
          out.push(o.reference + ':' + (c.ok ? 'VENTA' : c.error + (c.paid != null ? '(paid=' + c.paid + ',exp=' + c.expected + ')' : '')));
        } else out.push(o.reference + ':' + (p.status || 'sin_estado'));
      } else if (o.pago === 'sistecredito') {
        const txn = o.utm && o.utm.sc_txn;
        if (!txn) { out.push(o.reference + ':sin_txn'); continue; }
        if (!process.env.SISTECREDITO_SUBSCRIPTION_KEY) break;
        let paid = false;
        try { paid = (await getScInfo(txn)).paid; } catch {}
        if (paid) {
          const c = await confirmPaidOrder({ reference: o.reference, amount: Number(o.subtotal != null ? o.subtotal : o.total), currency: 'COP', req, origen: 'cron_sistecredito' });
          out.push(o.reference + ':' + (c.ok ? 'VENTA' : c.error));
        } else out.push(o.reference + ':pendiente');
      } else if (o.pago === 'addi') {
        // Addi no tiene API de consulta de estado → no se puede auto-confirmar aquí. Tras 30 min sin
        // confirmación por webhook, marcar para revisión MANUAL (el panel lo resalta). NO marca venta.
        const ageMin = (Date.now() - new Date(o.created_at).getTime()) / 60000;
        if (ageMin >= 30 && !(o.utm && o.utm.needs_manual_review)) {
          const utm = Object.assign({}, o.utm || {}, { needs_manual_review: true });
          await sb.from('orders').update({ utm }).eq('id', o.id);
          out.push(o.reference + ':revisar_manual');
        } else out.push(o.reference + ':addi_pendiente');
      } else {
        const key = (process.env.WOMPI_PRIVATE_KEY || '').trim();
        if (!key) break;
        const r = await fetch('https://production.wompi.co/v1/transactions?reference=' + encodeURIComponent(o.reference),
          { headers: { 'Authorization': 'Bearer ' + key } });
        const j = await r.json().catch(() => ({}));
        const tx = (Array.isArray(j.data) ? j.data : []).find(t => t.status === 'APPROVED');
        if (tx) {
          const c = await confirmPaidOrder({ reference: o.reference, amountInCents: tx.amount_in_cents, currency: tx.currency, req, origen: 'cron_wompi' });
          out.push(o.reference + ':' + (c.ok ? 'VENTA' : c.error));
        } else out.push(o.reference + ':' + ((j.data && j.data[0] && j.data[0].status) || 'sin_tx'));
      }
    } catch { out.push((o.reference || o.id) + ':error'); }
  }
  return res.status(200).json({ ok: true, revisados: (pend || []).length, resultado: out });
}

module.exports = async (req, res) => {
  const okOrigin = allowedOrigin(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  // Cron de reconciliación (GET): por query o por el user-agent oficial de Vercel Cron.
  if (req.method === 'GET' && ((req.query && req.query.cron === 'reconciliar') || String(req.headers['user-agent'] || '').startsWith('vercel-cron'))) {
    return reconciliarPendientes(req, res);
  }
  if (req.method !== 'POST') return res.status(405).end();
  if (req.query && req.query.webhook === 'bold') return handleBoldWebhook(req, res);
  if (req.query && req.query.webhook === 'addi') return handleAddiWebhook(req, res);
  if (req.query && req.query.webhook === 'sistecredito') return handleScWebhook(req, res);
  if (!okOrigin) return res.status(403).json({ error: 'Forbidden' });
  if (!(await rateLimit(req, res, { scope: 'orders', max: 40, windowMs: 60_000 }))) return;

  try {
    const kind = req.body && req.body.kind;
    if (kind === 'subscriber') return handleSubscribe(req, res);
    if (kind === 'bold_link') return handleBoldLink(req, res);
    if (kind === 'bold_status') return handleBoldStatus(req, res);
    if (kind === 'addi_link') return handleAddiLink(req, res);
    if (kind === 'addi_status') return handleAddiStatus(req, res);
    if (kind === 'sistecredito_link') return handleScLink(req, res);
    if (kind === 'sistecredito_status') return handleScStatus(req, res);
    if (kind === 'create_order') {
      const order = await createOrder(req.body, req.body.status || 'pending');
      await capiLead(order, req);
      return res.status(201).json({ ok: true, order });
    }

    // Compatibilidad con el frontend anterior: si vienen items, recalcular siempre server-side.
    if (Array.isArray(req.body && req.body.items) && req.body.items.length) {
      const order = await createOrder(req.body, req.body.status || 'pending');
      await capiLead(order, req);
      return res.status(201).json({ ok: true, order });
    }

    // Fallback defensivo para registros sin items: no aceptar montos arbitrarios.
    const sb = process.env.SUPABASE_SERVICE_KEY
      ? serviceClient()
      : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const base = {
      fecha: cleanText(req.body.fecha, 50) || new Date().toISOString(),
      nombre: cleanText(req.body.nombre, 200),
      cedula: cleanText(req.body.cedula, 30),
      tel: cleanText(req.body.tel || req.body.celular, 30),
      ciudad: cleanText(req.body.ciudad, 100),
      barrio: cleanText(req.body.barrio, 100),
      direccion: cleanText(req.body.direccion, 300),
      pago: cleanText(req.body.pago, 50),
      subtotal: 0, envio: 0, total: 0, pares: 0, items: [],
      // Mismo whitelist que createOrder: el cliente nunca puede auto-marcar 'venta'/'no_venta'.
      status: cleanText(req.body.status, 20) === 'abandoned' ? 'abandoned' : 'pending',
      reference: cleanText(req.body.reference, 100),
      utm: req.body.utm && typeof req.body.utm === 'object' && !Array.isArray(req.body.utm) ? req.body.utm : null,
      referrer: cleanText(req.body.referrer, 300),
      seccion: cleanText(req.body.seccion, 20),
      session_id: cleanText(req.body.session_id, 64)
    };
    const { error } = await sb.from('orders').insert(base);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(201).json({ ok: true });
  } catch (e) {
    return res.status(400).json({ error: e.message || 'order_error' });
  }
};
