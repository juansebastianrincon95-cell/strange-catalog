const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { sendEvent } = require('./_capi');

const CUPONES = {
  GRACIAS5: { tipo: 'pct', val: 0.05 },
  BIENVENIDO20: { tipo: 'fijo', val: 20000 }
};

function serviceClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

function anonClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
}

function cleanText(v, max) {
  return v == null ? null : String(v).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function calcFlete(pares) {
  return 25000 + Math.max(0, pares - 1) * 15000;
}

function cuponDesc(code, subtotal) {
  const c = code && CUPONES[String(code).trim().toUpperCase()];
  if (!c) return 0;
  return c.tipo === 'pct' ? Math.round(subtotal * c.val) : Math.min(c.val, subtotal);
}

function normalizeItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('items requeridos');
  return items.slice(0, 50).map(it => {
    const rawType = String(it.type || it.kind || '').toLowerCase();
    const type = rawType === 'liq' || rawType === 'liquidacion' || String(it.id || '').startsWith('L') ? 'liq' : 'cat';
    const id = parseInt(String(it.id || '').replace(/^L/i, ''), 10);
    const qty = Math.min(Math.max(parseInt(it.qty, 10) || 1, 1), 50);
    if (!Number.isFinite(id) || id <= 0) throw new Error('item inválido');
    return { type, id, qty };
  });
}

async function priceItems(sb, inputItems) {
  const items = normalizeItems(inputItems);
  const catIds = items.filter(i => i.type === 'cat').map(i => i.id);
  const liqIds = items.filter(i => i.type === 'liq').map(i => i.id);
  const [catsRes, liqsRes] = await Promise.all([
    catIds.length ? sb.from('products').select('id,gender,brand,price,sold').in('id', catIds) : Promise.resolve({ data: [] }),
    liqIds.length ? sb.from('liq_products').select('id,price,sold').in('id', liqIds) : Promise.resolve({ data: [] })
  ]);
  if (catsRes.error) throw new Error(catsRes.error.message);
  if (liqsRes.error) throw new Error(liqsRes.error.message);
  const cats = new Map((catsRes.data || []).map(p => [Number(p.id), p]));
  const liqs = new Map((liqsRes.data || []).map(p => [Number(p.id), p]));
  return items.map(it => {
    const p = it.type === 'liq' ? liqs.get(it.id) : cats.get(it.id);
    if (!p || p.sold) throw new Error('producto no disponible');
    const label = it.type === 'liq' ? 'Liq' : (p.gender === 'h' ? 'Hombre' : 'Mujer');
    return {
      label, id: it.id, type: it.type, brand: p.brand || null, qty: it.qty,
      precio: Number(p.price) * it.qty, unit_price: Number(p.price)
    };
  });
}

async function calculateOrder(input) {
  const sb = serviceClient();
  const items = await priceItems(sb, input.items);
  const subBruto = items.reduce((s, i) => s + i.precio, 0);
  const pares = items.reduce((s, i) => s + i.qty, 0);
  // COMBO mundialista: precio fijo del bundle, validado SERVER-SIDE contra settings.combos.
  // Solo aplica si el combo existe, está activo y el carrito trae EXACTAMENTE sus pares.
  // Si no matchea, se ignora en silencio y se cobra normal (anti-manipulación).
  let combo = null;
  const comboId = cleanText(input.combo, 30);
  if (comboId) {
    try {
      const { data: row } = await sb.from('settings').select('value').eq('key', 'combos').single();
      const lista = row && row.value ? JSON.parse(row.value) : [];
      const c = Array.isArray(lista) ? lista.find(x => x && x.id === comboId && x.activo !== false) : null;
      const precio = c ? parseInt(c.precio, 10) : NaN;
      if (c && parseInt(c.pares, 10) === pares && Number.isFinite(precio) && precio >= 1000) {
        combo = { id: c.id, precio };
      }
    } catch (e) { /* settings.combos ausente o corrupto → sin combo */ }
  }
  // Cupones NO acumulables con combo.
  const cupon = combo ? null : (input.cupon ? String(input.cupon).trim().toUpperCase() : null);
  let desc = combo ? 0 : cuponDesc(cupon, subBruto);
  // Vigencia BIENVENIDO20: 7 días desde el registro en el popup. Si encontramos al suscriptor
  // (por tel del pedido o session_id) y su registro es viejo, el cupón no aplica. Si NO lo
  // encontramos, se respeta (mejor un falso positivo que perder una venta por $20.000).
  if (cupon === 'BIENVENIDO20' && desc > 0) {
    try {
      const d = input.customer || input;
      const dig = String(d.tel || d.celular || '').replace(/\D/g, '').slice(0, 20);
      const sid = String(input.session_id || '').replace(/[^\w-]/g, '').slice(0, 64);
      const ors = [];
      if (dig.length >= 7) ors.push(`whatsapp.eq.${dig}`);
      if (sid) ors.push(`session_id.eq.${sid}`);
      if (ors.length) {
        const { data: subs } = await sb.from('subscribers').select('created_at')
          .or(ors.join(',')).order('created_at', { ascending: true }).limit(1);
        const t = subs && subs[0] && Date.parse(subs[0].created_at);
        if (t && (Date.now() - t) > 7 * 24 * 60 * 60 * 1000) desc = 0;
      }
    } catch (e) { /* ante la duda, no bloquear la venta */ }
  }
  const subtotal = combo ? combo.precio : (subBruto - desc);
  const pago = cleanText(input.pago || input.payment_method || 'pending', 50);
  const envio = pago === 'contra_entrega' ? calcFlete(pares) : 0;
  return { items, subBruto, desc, subtotal, envio, total: subtotal + envio, pares, pago, cupon, combo: combo ? combo.id : null };
}

async function createOrder(input, defaultStatus = 'pending') {
  const sb = serviceClient();
  const calc = await calculateOrder(input);
  const reference = cleanText(input.reference, 100) || `STR-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const d = input.customer || input;
  const row = {
    fecha: cleanText(input.fecha, 50) || new Date().toISOString(),
    nombre: cleanText(d.nombre, 200),
    cedula: cleanText(d.cedula, 30),
    tel: cleanText(d.tel || d.celular, 30),
    ciudad: cleanText(d.ciudad, 100),
    barrio: cleanText(d.barrio, 100),
    direccion: cleanText(d.direccion, 300),
    pago: calc.pago,
    subtotal: calc.subtotal,
    envio: calc.envio,
    total: calc.total,
    pares: calc.pares,
    items: calc.items,
    // El cliente solo puede crear 'pending' o 'abandoned'. 'venta'/'no_venta' se marcan
    // únicamente server-side (confirmPaidOrder o panel admin) — evita ventas falsas inyectadas.
    status: (cleanText(input.status, 20) || defaultStatus) === 'abandoned' ? 'abandoned' : 'pending',
    combo: calc.combo,
    reference,
    utm: input.utm && typeof input.utm === 'object' && !Array.isArray(input.utm) ? input.utm : null,
    referrer: cleanText(input.referrer, 300),
    seccion: cleanText(input.seccion, 20),
    session_id: cleanText(input.session_id, 64)
  };
  if (row.status !== 'abandoned' && row.session_id) {
    await sb.from('orders').delete().eq('session_id', row.session_id).eq('status', 'abandoned');
  }
  const { data, error } = await sb.from('orders').insert(row).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

async function getOrderByReference(reference) {
  const sb = serviceClient();
  const { data, error } = await sb.from('orders').select('*').eq('reference', String(reference).slice(0, 100)).single();
  if (error) return null;
  return data;
}

// content_ids para Pixel/CAPI con el MISMO formato del feed de Meta (cat_34 / liq_34) —
// así Events Manager asocia cada Purchase a los productos del catálogo (FASE M).
function contentIdsDe(items) {
  if (!Array.isArray(items)) return [];
  return items.map(it => (it.type === 'liq' ? 'liq_' : 'cat_') + parseInt(it.id)).filter(s => !s.endsWith('_NaN'));
}

async function confirmPaidOrder({ reference, amount, amountInCents, currency = 'COP', eventSourceUrl, req }) {
  const sb = serviceClient();
  const order = await getOrderByReference(reference);
  if (!order) return { ok: false, error: 'order_not_found' };
  const expected = Number(order.subtotal != null ? order.subtotal : order.total);
  const paid = amountInCents != null ? Math.round(Number(amountInCents) / 100) : Math.round(Number(amount));
  if (currency && String(currency).toUpperCase() !== 'COP') return { ok: false, error: 'currency_mismatch' };
  if (!Number.isFinite(paid) || paid !== expected) return { ok: false, error: 'amount_mismatch', expected, paid };
  if (order.status !== 'venta') {
    const { error } = await sb.from('orders').update({ status: 'venta' }).eq('id', order.id);
    if (error) return { ok: false, error: error.message };
    const utm = order.utm || {};
    const clientIp = req ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined : undefined;
    // await (Codex #8): en serverless el fire-and-forget puede morir al responder.
    await sendEvent({
      eventName: 'Purchase',
      value: expected,
      currency: 'COP',
      contentIds: contentIdsDe(order.items),
      phone: order.tel, city: order.ciudad, name: order.nombre,
      fbp: utm.fbp, fbc: utm.fbc, clientIp, clientUserAgent: req && req.headers['user-agent'],
      eventId: String(order.reference || order.id) + '_purchase',
      actionSource: 'website',
      eventSourceUrl: eventSourceUrl || 'https://strangesneakers.com/'
    }).catch(() => {});
  }
  return { ok: true, order: { ...order, status: 'venta' } };
}

module.exports = { anonClient, serviceClient, cleanText, calculateOrder, createOrder, getOrderByReference, confirmPaidOrder, contentIdsDe };
