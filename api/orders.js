const { createClient } = require('@supabase/supabase-js');
const { rateLimit } = require('./_rate_limit');
const { anonClient, serviceClient, cleanText, createOrder, getOrderByReference, confirmPaidOrder, contentIdsDe } = require('./_orders');
const { sendEvent } = require('./_capi');

/* Lead por CAPI (FASE N8, plan Codex): misma señal que el px('Lead') del navegador pero
   server-side con teléfono/ciudad/nombre hasheados + fbp/fbc — Meta dedup por el MISMO
   eventId ({session_id}_lead). Solo pedidos reales con datos de contacto. Se AWAITEA en el
   handler (Codex #8: en serverless un fire-and-forget puede morir al responder); el catch
   garantiza que un fallo de Meta jamás rompa el checkout. */
function capiLead(order, req) {
  if (!order || order.status === 'abandoned' || !order.tel || !order.session_id) return Promise.resolve();
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

const ALLOWED_ORIGINS = ['https://strangesneakers.com', 'https://www.strangesneakers.com', 'https://catalogo.strangesneakers.com', 'https://strange-catalog.vercel.app'];
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
  const genero = generoRaw === 'h' || generoRaw === 'm' ? generoRaw : null;

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
  const { data: prev } = await sb.from('subscribers').select('id').eq('whatsapp', whatsapp).limit(1);
  if (!prev || !prev.length) {
    const { error } = await sb.from('subscribers').insert({
      nombre, whatsapp, cumple, talla, genero, utm, session_id, source: 'popup_bienvenida'
    });
    if (error) return res.status(500).json({ error: error.message });
    await capiSubLead('_subscribe', { phone: whatsapp, name: nombre });
  }
  return res.status(201).json({ ok: true, codigo: CODIGO_BIENVENIDA });
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
    const out = await confirmPaidOrder({ reference: d.reference, amount, currency: 'COP', req }).catch(() => null);
    confirmed = !!(out && out.ok);
  }
  return res.status(200).json({ status, confirmed });
}

async function handleBoldWebhook(req, res) {
  const secret = (process.env.BOLD_WEBHOOK_SECRET || '').trim();
  const got = req.headers['x-webhook-secret'] || req.headers['x-bold-signature'] || req.query.secret;
  if (!secret || got !== secret) return res.status(202).json({ ok: false, error: 'webhook_not_configured_or_invalid' });
  const d = req.body || {};
  const p = d.payload || d;
  if ((p.status || d.status) !== 'PAID' || !(p.reference || d.reference)) {
    return res.json({ ok: true, ignored: true });
  }
  const out = await confirmPaidOrder({ reference: p.reference || d.reference, amount: boldAmount(p), currency: 'COP', req });
  return res.json(out);
}

module.exports = async (req, res) => {
  const okOrigin = allowedOrigin(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  if (req.query && req.query.webhook === 'bold') return handleBoldWebhook(req, res);
  if (!okOrigin) return res.status(403).json({ error: 'Forbidden' });
  if (!rateLimit(req, res, { scope: 'orders', max: 40, windowMs: 60_000 })) return;

  try {
    const kind = req.body && req.body.kind;
    if (kind === 'subscriber') return handleSubscribe(req, res);
    if (kind === 'bold_link') return handleBoldLink(req, res);
    if (kind === 'bold_status') return handleBoldStatus(req, res);
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
