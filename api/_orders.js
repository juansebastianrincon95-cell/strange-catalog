const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { sendEvent } = require('./_capi');

const CUPONES = {
  GRACIAS5: { tipo: 'pct', val: 0.05 },
  BIENVENIDO20: { tipo: 'fijo', val: 20000 }
};

/* ── CÓDIGO DE BIENVENIDA ÚNICO POR SUSCRIPTOR ──
   BIENVENIDO20 era un código compartido: si alguien lo publicaba en un grupo, cada uso ajeno
   eran $20.000. Ahora cada suscriptor recibe BIENVENIDO20-XXXXX atado a SU fila en subscribers
   (un solo uso, 7 días); el genérico queda solo para los suscriptores previos al cambio. */
// Alfabeto sin ambigüedades (sin 0/O ni 1/I/L): el código se dicta por WhatsApp y se teclea
// en el celular — un carácter confundible es un cupón "que no funciona" y una venta en riesgo.
const CODE_ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function genWelcomeCode() {
  let suf = '';
  for (let i = 0; i < 5; i++) suf += CODE_ALFABETO[crypto.randomInt(CODE_ALFABETO.length)];
  return 'BIENVENIDO20-' + suf;
}

// ¿Es un código de bienvenida? El genérico (suscriptores viejos) o el único BIENVENIDO20-XXXXX.
// El rango 4-6 del sufijo deja margen si algún día cambia el largo sin tocar la validación.
function esCodigoBienvenida(code) {
  return /^BIENVENIDO20(-[A-Z0-9]{4,6})?$/.test(String(code || ''));
}

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
  let key = code ? String(code).trim().toUpperCase() : '';
  // El código único descuenta lo mismo que la entrada BIENVENIDO20; si de verdad existe,
  // no está usado y no venció lo decide calculateOrder contra la BD (aquí solo el monto).
  if (esCodigoBienvenida(key)) key = 'BIENVENIDO20';
  const c = key && CUPONES[key];
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
    const talla = it.talla != null && String(it.talla).trim() !== '' ? cleanText(String(it.talla), 16) : null;
    return { type, id, qty, talla };
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
    const label = it.type === 'liq' ? 'Liq' : (p.gender === 'h' ? 'Hombre' : p.gender === 'u' ? 'Unisex' : 'Mujer');
    return {
      label, id: it.id, type: it.type, brand: p.brand || null, qty: it.qty,
      precio: Number(p.price) * it.qty, unit_price: Number(p.price), talla: it.talla || null
    };
  });
}

async function calculateOrder(input) {
  const sb = serviceClient();
  const items = await priceItems(sb, input.items);
  const subBruto = items.reduce((s, i) => s + i.precio, 0);
  const pares = items.reduce((s, i) => s + i.qty, 0);
  // COMBO: precio fijo del bundle, validado SERVER-SIDE contra settings.combos.
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
  // CUPÓN DE BIENVENIDA — el descuento SOLO existe atado a un suscriptor real, con dos variantes:
  //  · BIENVENIDO20-XXXXX (único): debe existir en subscribers, no estar usado (welcome_used_at
  //    null) y tener menos de 7 días desde welcome_issued_at. Inventarse uno válido es imposible.
  //  · BIENVENIDO20 (genérico, suscriptores previos al código único): mismas reglas, pero el
  //    suscriptor se identifica por el tel del pedido o su session_id. Antes, si no aparecía,
  //    se respetaba el cupón — ese fail-open convertía el código compartido en $20.000 para
  //    CUALQUIERA que lo viera en un grupo. Ahora sin suscriptor no hay descuento.
  if (cupon && esCodigoBienvenida(cupon) && desc > 0) {
    let valido = false;
    try {
      let s = null;
      if (cupon.includes('-')) {
        const { data: subs } = await sb.from('subscribers')
          .select('created_at,welcome_issued_at,welcome_used_at').eq('welcome_code', cupon).limit(1);
        s = subs && subs[0];
      } else {
        const d = input.customer || input;
        const dig = String(d.tel || d.celular || '').replace(/\D/g, '').slice(0, 20);
        const sid = String(input.session_id || '').replace(/[^\w-]/g, '').slice(0, 64);
        const ors = [];
        if (dig.length >= 7) {
          ors.push(`whatsapp.eq.${dig}`);
          // El pedido puede traer indicativo (57...) y el registro solo los 10 dígitos.
          if (dig.length > 10) ors.push(`whatsapp.eq.${dig.slice(-10)}`);
        }
        if (sid) ors.push(`session_id.eq.${sid}`);
        if (ors.length) {
          const { data: subs } = await sb.from('subscribers')
            .select('created_at,welcome_issued_at,welcome_used_at')
            .or(ors.join(',')).order('created_at', { ascending: false }).limit(1);
          s = subs && subs[0];
        }
      }
      // welcome_issued_at se renueva en cada entrega del código (re-registro incluido);
      // created_at queda como fallback para suscriptores previos a la columna.
      const t = s && Date.parse(s.welcome_issued_at || s.created_at);
      valido = !!(s && !s.welcome_used_at && t && (Date.now() - t) <= 7 * 24 * 60 * 60 * 1000);
    } catch (e) { /* si la BD falla no se regalan $20.000 a ciegas (fail-closed) */ }
    if (!valido) desc = 0;
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
    // Cupón usado: se guarda SOLO si el descuento se aplicó de verdad (desc > 0) → así la
    // columna 'cupon' significa "este pedido usó el descuento" (para el panel de suscriptores).
    cupon: calc.desc > 0 ? calc.cupon : null,
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
  // Modo prueba: marca el pedido en utm (jsonb, sin migración). Queda fuera de métricas, no
  // dispara Meta/CAPI/Telegram, y se puede borrar en bloque desde el panel.
  if (input.test === true) row.utm = Object.assign({}, row.utm || {}, { test: true });
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

// Firma del carrito (mismo contenido = misma compra). Ordena por type|id|talla|qty para comparar
// dos pedidos sin depender del orden. Se usa para deduplicar ventas/intentos de la misma sesión.
function cartSig(items) {
  if (!Array.isArray(items)) return '';
  return items
    .map(it => `${it.type || 'cat'}|${it.id}|${it.talla || ''}|${it.qty || 1}`)
    .sort()
    .join('~');
}

/* Mensaje al dueño por el bot de Telegram. OPCIONAL: solo actúa si existen las envs
   TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID (se activan cuando el usuario cree su bot).
   Nunca bloquea a quien lo llama: timeout corto y errores silenciados (devuelve false).
   parseMode ('HTML') sirve para mensajes con enlaces tocables (el parte de rescate);
   en ese caso se apaga el preview para que un wa.me no infle el chat con tarjetas. */
async function sendTelegram(text, { parseMode, timeoutMs = 2500 } = {}) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chat = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chat) { console.error('[TELEGRAM] sin TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID: no se envió nada'); return false; }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const body = { chat_id: chat, text };
    if (parseMode) { body.parse_mode = parseMode; body.disable_web_page_preview = true; }
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal
    });
    // Un 4xx/5xx (bot bloqueado, chat_id malo, rate limit) devolvía false sin dejar rastro.
    if (!r.ok) console.error('[TELEGRAM] rechazado por la API:', r.status, (await r.text().catch(() => '')).slice(0, 200));
    return r.ok;
  } catch (e) {
    console.error('[TELEGRAM] fallo de red o timeout de', timeoutMs + 'ms:', e && e.name);
    return false;
  } finally { clearTimeout(t); }
}

// Aviso de venta al vendedor: arma el texto y lo manda por el bot (nunca bloquea la confirmación).
async function notifyVentaTelegram(order) {
  const fmtCop = n => '$' + Number(n || 0).toLocaleString('es-CO');
  const lista = Array.isArray(order.items) ? order.items : [];
  const items = lista.map(it => `• ${it.label || 'Producto'} #${it.id} x${it.qty}${it.talla ? ' · T' + it.talla : ''}`).join('\n');
  // Link a la vista ?pedido= — el MISMO que recibe el vendedor por WhatsApp: abre el pedido
  // completo con las fotos de cada par. Sin esto el aviso era solo texto y había que entrar al
  // panel para saber qué par se vendió. Formato del código: 29x1,L5x2 (L = liquidación).
  // Formato: 29x1t40 (L = liquidación, t = talla). La talla va en el link para que la vista
  // muestre QUÉ TALLA alistar; el sufijo es opcional, los links viejos siguen funcionando.
  const code = lista.filter(it => it && it.id != null)
    .map(it => {
      const t = String(it.talla == null ? '' : it.talla).replace(/[^\w.]/g, '').slice(0, 6);
      return (it.type === 'liq' ? 'L' : '') + parseInt(it.id) + 'x' + (parseInt(it.qty) || 1) + (t ? 't' + t : '');
    })
    .join(',');
  const linkFotos = code ? `\n📸 Ver el pedido con fotos:\nhttps://strangesneakers.com/?pedido=${code}` : '';
  const dir = [order.direccion, order.barrio, order.ciudad].filter(Boolean).join(', ');
  const text = `💰 VENTA CONFIRMADA (${order.pago || 'online'})\n` +
    `${fmtCop(order.subtotal != null ? order.subtotal : order.total)} — ${order.nombre || ''}\n` +
    `📞 ${order.tel || ''}\n` +
    (dir ? `📍 ${dir}\n` : '') +
    (order.cedula ? `🪪 ${order.cedula}\n` : '') +
    `${items}${linkFotos}\nRef: ${order.reference || order.id}`;
  return sendTelegram(text);   // true/false: lo usa el botón de reenvío del panel para poder decir si salió
}

// Marca el cupón de bienvenida como USADO al confirmarse la venta (un solo uso). Se llama con
// el pedido ya en 'venta' (confirmPaidOrder y el marcado manual del panel — reissue_welcome lo
// desmarca si el admin quiere reactivarlo). El código único se resuelve directo por welcome_code;
// el genérico, por el mismo tel/session con el que calculateOrder validó el descuento.
// Nunca bloquea la venta: perder el candado una vez es mejor que tumbar una confirmación.
async function marcarCuponBienvenidaUsado(sb, order) {
  try {
    const cupon = String((order && order.cupon) || '').toUpperCase();
    if (!esCodigoBienvenida(cupon)) return;
    const upd = { welcome_used_at: new Date().toISOString() };
    if (cupon.includes('-')) {
      await sb.from('subscribers').update(upd).eq('welcome_code', cupon).is('welcome_used_at', null);
      return;
    }
    const dig = String(order.tel || '').replace(/\D/g, '').slice(0, 20);
    const sid = String(order.session_id || '').replace(/[^\w-]/g, '').slice(0, 64);
    const ors = [];
    if (dig.length >= 7) {
      ors.push(`whatsapp.eq.${dig}`);
      if (dig.length > 10) ors.push(`whatsapp.eq.${dig.slice(-10)}`);   // pedido con indicativo 57
    }
    if (sid) ors.push(`session_id.eq.${sid}`);
    if (!ors.length) return;
    const { data: subs } = await sb.from('subscribers').select('id')
      .or(ors.join(',')).order('created_at', { ascending: false }).limit(1);
    if (subs && subs[0]) await sb.from('subscribers').update(upd).eq('id', subs[0].id);
  } catch (e) { /* el candado nunca bloquea la venta */ }
}

// Descuenta stock por talla al confirmar una venta. Solo afecta productos con `tallas` como mapa
// {talla:stock} (rastreo activado); si es null/array (sin rastreo) no hace nada. Nunca rompe la venta.
async function decrementStock(sb, items) {
  for (const it of (Array.isArray(items) ? items : [])) {
    try {
      if (!it || it.talla == null || String(it.talla).trim() === '') continue;
      const table = it.type === 'liq' ? 'liq_products' : 'products';
      const { data: row } = await sb.from(table).select('tallas').eq('id', it.id).maybeSingle();
      const tallas = row && row.tallas;
      if (!tallas || typeof tallas !== 'object' || Array.isArray(tallas)) continue;
      const key = String(it.talla);
      if (!(key in tallas)) continue;
      const qty = Number(it.qty) || 1;
      const next = Math.max(0, (Number(tallas[key]) || 0) - qty);
      await sb.from(table).update({ tallas: Object.assign({}, tallas, { [key]: next }) }).eq('id', it.id);
    } catch (e) { /* el stock nunca bloquea la venta */ }
  }
}

/* `origen` deja por escrito CÓMO se confirmó la venta (webhook_addi, wompi_verify, cron…).
   Antes solo se escribía status='venta' y era imposible saber a posteriori si una venta la
   confirmó la pasarela o la marcó alguien a mano — el punto ciego que reportó el dueño. */
async function confirmPaidOrder({ reference, amount, amountInCents, currency = 'COP', eventSourceUrl, req, origen = 'desconocido', extra = null }) {
  const sb = serviceClient();
  const order = await getOrderByReference(reference);
  if (!order) return { ok: false, error: 'order_not_found' };
  const expected = Number(order.subtotal != null ? order.subtotal : order.total);
  const paid = amountInCents != null ? Math.round(Number(amountInCents) / 100) : Math.round(Number(amount));
  if (currency && String(currency).toUpperCase() !== 'COP') return { ok: false, error: 'currency_mismatch' };
  if (!Number.isFinite(paid) || paid !== expected) return { ok: false, error: 'amount_mismatch', expected, paid };
  if (order.status !== 'venta') {
    // CANDADO ANTI DOBLE-VENTA: si ya hay otra venta del MISMO carrito en esta sesión (p.ej. el
    // cliente pagó por dos pasarelas), esto es un DUPLICADO → no crear 2ª venta ni 2º Purchase.
    // Fail-open: ante cualquier error de la consulta, seguimos y marcamos la venta (no perderla).
    if (order.session_id) {
      try {
        const sig = cartSig(order.items);
        const { data: prevVentas } = await sb.from('orders')
          .select('id,reference,items')
          .eq('session_id', order.session_id).eq('status', 'venta').neq('id', order.id).limit(20);
        const dup = (prevVentas || []).find(p => cartSig(p.items) === sig);
        if (dup) {
          await sb.from('orders').update({ status: 'no_venta', motivo_no_venta: 'Duplicado — ya pagado en ' + (dup.reference || dup.id) }).eq('id', order.id);
          return { ok: true, duplicate: true, order: { ...order, status: 'no_venta' } };
        }
      } catch (e) { /* fail-open */ }
    }
    // La procedencia se escribe EN EL MISMO update que el status: si se marca la venta, queda
    // registrado quién la marcó. utm es jsonb, así que no hace falta migración.
    const utmConf = Object.assign({}, order.utm || {}, {
      confirmado_por: origen,
      confirmado_at: new Date().toISOString()
    }, extra || {});
    const { error } = await sb.from('orders').update({ status: 'venta', utm: utmConf }).eq('id', order.id);
    if (error) return { ok: false, error: error.message };
    order.utm = utmConf;
    // LIMPIEZA DE HERMANOS: los intentos pendientes del MISMO carrito/sesión pasan a no_venta
    // (salen de "por hacer" y NO disparan rescate/remarketing). No bloquea la venta si falla.
    if (order.session_id) {
      try {
        const sig = cartSig(order.items);
        const { data: sib } = await sb.from('orders')
          .select('id,items').eq('session_id', order.session_id).eq('status', 'pending').neq('id', order.id).limit(50);
        const ids = (sib || []).filter(s => cartSig(s.items) === sig).map(s => s.id);
        if (ids.length) await sb.from('orders').update({ status: 'no_venta', motivo_no_venta: 'Intento previo — pago confirmado en ' + (order.reference || order.id) }).in('id', ids);
      } catch (e) { /* no bloquear la venta */ }
    }
    const utm = order.utm || {};
    // Pedido de prueba: queda marcado 'venta' (para completar el flujo) pero SIN enviar Purchase
    // a Meta/CAPI ni notificar por Telegram.
    if (utm.test) return { ok: true, order: { ...order, status: 'venta' } };
    await decrementStock(sb, order.items).catch(() => {});   // descontar inventario por talla (solo ventas reales)
    await marcarCuponBienvenidaUsado(sb, order).catch(() => {});   // el cupón de bienvenida se quema con la venta (un solo uso)
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
    // El aviso de Telegram YA NO muere en silencio: se guarda si salió o no y se loguea el fallo.
    // Antes, un timeout de 2.5s o un chat_id malo dejaban al dueño sin enterarse de una venta y
    // sin ninguna forma de saberlo después.
    const tgOk = await notifyVentaTelegram(order).catch(() => false);
    if (!tgOk) console.error('[TELEGRAM] aviso de venta NO enviado', order.reference || order.id, '· origen:', origen);
    try {
      await sb.from('orders').update({ utm: Object.assign({}, order.utm || {}, { telegram_ok: !!tgOk }) }).eq('id', order.id);
    } catch (e) { /* el registro del aviso nunca bloquea la venta */ }
  }
  return { ok: true, order: { ...order, status: 'venta' } };
}

module.exports = { anonClient, serviceClient, cleanText, calculateOrder, createOrder, getOrderByReference, confirmPaidOrder, contentIdsDe, cartSig, decrementStock, genWelcomeCode, esCodigoBienvenida, marcarCuponBienvenidaUsado, sendTelegram, notifyVentaTelegram };
