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

/* ── FLETE POR ZONAS (perfiles de envío estilo Shopify) ──
   settings.envio_zonas = [{nombre, ciudades:[...], base, extra, default}] — la zona con
   default:true cobra cuando la ciudad no matchea ninguna lista o viene vacía: NUNCA flete 0
   por no reconocer la ciudad (el flete es margen directo en contra entrega).
   settings.envio_gratis_desde = subtotal (post-descuento) desde el cual el flete es 0.
   Sin zonas / JSON roto / sin zona default → fórmula nacional histórica (25.000 + 15.000 por
   par extra): un settings dañado no puede romper un pedido en curso. */

// Ciudad normalizada para comparar: sin tildes, sin mayúsculas, sin espacios ni puntuación.
// "BOGOTÁ D.C.", "bogota dc" y "Bogotá" quedan comparables entre sí.
const normCiudad = s => String(s == null ? '' : s)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

function parseZonas(raw) {
  try {
    const lista = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(lista)) return null;
    // Solo zonas con tarifa base numérica utilizable; si la zona default no sobrevive el
    // filtro, TODO el esquema se descarta (mejor la fórmula vieja que una zona sin respaldo).
    const zonas = lista.filter(z => z && Number.isFinite(parseInt(z.base, 10)) && parseInt(z.base, 10) >= 0);
    return zonas.some(z => z.default) ? zonas : null;
  } catch (e) { return null; }
}

// Ciudad por PALABRAS (conserva los límites entre ellas): "Cali - Valle" → "cali valle".
const normCiudadFrase = s => String(s == null ? '' : s)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function zonaDeCiudad(zonas, ciudad) {
  const n = normCiudad(ciudad);
  const frase = ' ' + normCiudadFrase(ciudad) + ' ';
  if (n) {
    for (const z of zonas) {
      const cs = Array.isArray(z.ciudades) ? z.ciudades : [];
      // Igualdad compacta ("bogotadc" === "bogotadc") o PALABRA COMPLETA dentro de la frase:
      // los sufijos del formulario ("Bogotá D.C.", "Cali - Valle") caen en su ciudad, pero un
      // municipio que CONTIENE otro nombre ("Calima" ⊃ "cali") NO — el substring a secas
      // cobraba la zona equivocada (auditoría Ola 1). Mínimo 3 letras contra entradas basura.
      if (cs.some(c => {
        const nc = normCiudad(c);
        if (!nc || nc.length < 3) return false;
        return n === nc || frase.includes(' ' + normCiudadFrase(c) + ' ');
      })) return z;
    }
  }
  return zonas.find(z => z.default);   // parseZonas garantiza que existe
}

function calcFlete(pares, ciudad, subtotal, zonasRaw, gratisDesdeRaw) {
  // Envío gratis desde X: sobre el MISMO subtotal (post-descuento) que cobra calculateOrder
  const gratis = parseInt(gratisDesdeRaw, 10);
  if (Number.isFinite(gratis) && gratis > 0 && Number(subtotal) >= gratis) return 0;
  const zonas = parseZonas(zonasRaw);
  if (!zonas) return 25000 + Math.max(0, pares - 1) * 15000;   // fórmula nacional histórica (fallback)
  const z = zonaDeCiudad(zonas, ciudad);
  const base = Math.max(0, parseInt(z.base, 10) || 0);
  const extra = Math.max(0, parseInt(z.extra, 10) || 0);
  return base + Math.max(0, pares - 1) * extra;
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

/* ══ MOTOR DE DESCUENTOS (tabla discounts, migración 006) ══════════════════════
   Réplica de los 4 tipos de Shopify: 'pedido' (monto/% sobre el pedido), 'producto' (monto/%
   sobre productos concretos), 'bogo' (compra X y obtén Y) y 'envio' (envío gratis). Cada uno
   puede ser por CÓDIGO (el cliente lo teclea) o AUTOMÁTICO (codigo null: aplica solo), con
   mínimos, vigencia, tope de usos, 1-por-cliente y combinación opt-in.
   Principios de la casa:
   · TODO se valida AQUÍ, nunca en el navegador (el front solo pinta — espejo en carrito.js).
   · FAIL-CLOSED: BD caída, tabla ausente, JSON corrupto o fecha ilegible → CERO descuento.
   · El contador de usos sube SOLO al confirmar la venta (descuento_consumir, atómico en SQL),
     nunca al crear un 'pending' — nadie gasta usos de un código con pedidos que no paga.
   · Los legacy (BIENVENIDO20/GRACIAS5) y los combos NO pasan por aquí: mismo precio de siempre. */

// ¿El código pertenece al sistema viejo? Esos siguen su camino legacy intacto.
function esCuponLegacy(code) {
  return !!CUPONES[String(code || '').toUpperCase()] || esCodigoBienvenida(code);
}

// Clave de cliente en TODO el motor: últimos 10 dígitos del teléfono — la misma con la que el
// resto del sistema cruza pedidos, suscriptores y audiencias. Sin tel → '' (y el 1-por-cliente
// falla cerrado en modo orden).
function clienteKey(tel) {
  return String(tel || '').replace(/\D/g, '').slice(-10);
}

// ¿El descuento cubre este ítem? aplica = {ids:['cat_29','liq_5'], marcas:['nike']}.
// Sin filtro (null o listas vacías) cubre TODOS los productos. Con filtro, basta que el ítem
// esté en ids O que su marca esté en marcas (unión de selectores, como las colecciones de Shopify).
function descuentoAplicaItem(aplica, it) {
  if (!aplica || typeof aplica !== 'object' || Array.isArray(aplica)) return true;
  const ids = Array.isArray(aplica.ids) ? aplica.ids : [];
  const marcas = Array.isArray(aplica.marcas) ? aplica.marcas : [];
  if (!ids.length && !marcas.length) return true;
  const key = (it.type === 'liq' ? 'liq_' : 'cat_') + it.id;
  if (ids.includes(key)) return true;
  if (it.brand && marcas.includes(String(it.brand))) return true;
  return false;
}

/* Monto en pesos que descuenta `d` sobre estos ítems (precios YA puestos por el server en
   priceItems — jamás los del navegador). Siempre >= 0 y nunca mayor que su base: un solo
   descuento no puede dejar el subtotal negativo; el tope global lo pone resolverDescuentos. */
function montoDescuento(d, items, subBruto) {
  const valor = Math.max(0, parseInt(d.valor, 10) || 0);
  const pct = Math.min(valor, 100);   // un pct corrupto (>100) jamás descuenta más del 100%
  if (d.tipo === 'pedido') {
    return d.valor_tipo === 'pct' ? Math.round(subBruto * pct / 100) : Math.min(valor, subBruto);
  }
  if (d.tipo === 'producto') {
    const base = items.filter(it => descuentoAplicaItem(d.aplica, it)).reduce((s, it) => s + it.precio, 0);
    if (base <= 0) return 0;   // ningún producto del carrito está cubierto → no aplica
    return d.valor_tipo === 'pct' ? Math.round(base * pct / 100) : Math.min(valor, base);
  }
  if (d.tipo === 'bogo') {
    // Compra X y obtén Y: por cada grupo de (X+Y) unidades cubiertas, las Y MÁS BARATAS llevan
    // bogoPct% off (100 = gratis) — igual que Shopify, que descuenta siempre lo más barato.
    const b = d.bogo && typeof d.bogo === 'object' ? d.bogo : {};
    const compra = Math.max(1, parseInt(b.compra, 10) || 0);
    const lleva = Math.max(1, parseInt(b.lleva, 10) || 0);
    const bogoPct = Math.min(Math.max(parseInt(b.pct, 10) || 100, 1), 100);
    if (!parseInt(b.compra, 10) || !parseInt(b.lleva, 10)) return 0;   // config incompleta → fail-closed
    const unidades = [];
    for (const it of items) {
      if (!descuentoAplicaItem(d.aplica, it)) continue;
      for (let i = 0; i < it.qty; i++) unidades.push(it.unit_price);
    }
    const grupos = Math.floor(unidades.length / (compra + lleva));
    if (grupos <= 0) return 0;
    unidades.sort((a, c) => a - c);
    const gratis = unidades.slice(0, grupos * lleva);
    return Math.round(gratis.reduce((s, u) => s + u, 0) * bogoPct / 100);
  }
  return 0;   // 'envio' no descuenta producto: apaga el flete (lo maneja resolverDescuentos)
}

// Vigencia y estado de una fila. Devuelve null si está utilizable o el MOTIVO exacto si no —
// el motivo viaja al front para decirle al cliente POR QUÉ su código no valió.
function motivoNoUtilizable(d, now) {
  if (d.activo === false) return 'inactivo';
  if (d.desde != null) {
    const t = Date.parse(d.desde);
    if (!Number.isFinite(t)) return 'inactivo';        // fecha corrupta → fail-closed
    if (now < t) return 'aun_no_empieza';
  }
  if (d.hasta != null) {
    const t = Date.parse(d.hasta);
    if (!Number.isFinite(t)) return 'inactivo';
    if (now > t) return 'vencido';
  }
  const max = parseInt(d.usos_max, 10);
  if (Number.isFinite(max) && max > 0 && (parseInt(d.usos, 10) || 0) >= max) return 'agotado';
  return null;
}

/* Resuelve QUÉ descuentos aplican a este carrito. Entrada:
     codigo  — el código tecleado (null = solo automáticos). Los legacy NO llegan aquí.
     items   — ítems YA precificados por priceItems (precios del server).
     cliente — últimos 10 dígitos del tel ('' si aún no se conoce).
     modo    — 'orden' (crear pedido: 1-por-cliente SIN tel = fail-closed) |
               'consulta' (validar desde el carrito: sin tel se acepta provisional — la
               autoridad final es SIEMPRE calculateOrder al crear el pedido, que sí trae tel).
   Regla de combinación (por defecto NO se combinan): se aplican TODOS los combinables juntos,
   o el mejor NO-combinable solo — lo que más le descuente al cliente (como Shopify). El envío
   gratis corre en pista aparte: combinable acompaña a lo que sea; no-combinable solo si es lo único.
   Salida: { monto, envioGratis, aplicados:[{id,codigo,nombre,tipo,monto}], motivo, def, autos }.
   CUALQUIER error (tabla ausente, BD caída) → cero descuentos, motivo 'error' (fail-closed). */
async function resolverDescuentos(sb, { codigo, items, subBruto, pares, cliente, modo }) {
  const out = { monto: 0, envioGratis: false, aplicados: [], motivo: null, def: null, autos: [] };
  try {
    // El código entra a un filtro de PostgREST: solo A-Z 0-9 _ - (mismo charset que exige el
    // panel al crearlos). Cualquier otro carácter = imposible que exista → ni se consulta con él.
    const code = codigo ? String(codigo).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '') : '';
    const codeIntacto = code && code === String(codigo).trim().toUpperCase();
    let q = sb.from('discounts').select('*').eq('activo', true);
    q = codeIntacto ? q.or(`codigo.is.null,codigo.eq.${code}`) : q.is('codigo', null);
    const { data: rows, error } = await q.limit(100);
    if (error) throw new Error(error.message);
    if (codigo && !codeIntacto) out.motivo = 'no_existe';

    const now = Date.now();
    const candidatos = [];
    let filaCodigo = null;
    for (const d of rows || []) {
      const esElCodigo = codeIntacto && d.codigo && String(d.codigo).toUpperCase() === code;
      if (esElCodigo) filaCodigo = d;
      if (d.codigo && !esElCodigo) continue;   // otros códigos jamás aplican sin teclearse
      const m = motivoNoUtilizable(d, now);
      if (m) { if (esElCodigo) out.motivo = m; continue; }
      const minM = parseInt(d.min_monto, 10);
      if (Number.isFinite(minM) && minM > 0 && subBruto < minM) { if (esElCodigo) out.motivo = 'minimo_monto'; continue; }
      const minI = parseInt(d.min_items, 10);
      if (Number.isFinite(minI) && minI > 0 && pares < minI) { if (esElCodigo) out.motivo = 'minimo_items'; continue; }
      candidatos.push({ d, esElCodigo });
    }
    if (codigo && codeIntacto && !filaCodigo && !out.motivo) out.motivo = 'no_existe';

    // 1-POR-CLIENTE contra las ventas CONFIRMADAS (discount_usos). Sin teléfono:
    // en 'orden' se niega (fail-closed — es plata), en 'consulta' se acepta provisional.
    const conCandado = candidatos.filter(c => c.d.uno_por_cliente);
    if (conCandado.length) {
      if (cliente) {
        const ids = conCandado.map(c => c.d.id);
        const { data: usados, error: e2 } = await sb.from('discount_usos')
          .select('discount_id').eq('cliente', cliente).in('discount_id', ids).limit(100);
        if (e2) throw new Error(e2.message);   // no se puede verificar → fail-closed (catch de abajo)
        const ya = new Set((usados || []).map(u => Number(u.discount_id)));
        for (let i = candidatos.length - 1; i >= 0; i--) {
          if (candidatos[i].d.uno_por_cliente && ya.has(Number(candidatos[i].d.id))) {
            if (candidatos[i].esElCodigo) out.motivo = 'ya_usado';
            candidatos.splice(i, 1);
          }
        }
      } else if (modo === 'orden') {
        for (let i = candidatos.length - 1; i >= 0; i--) {
          if (candidatos[i].d.uno_por_cliente) candidatos.splice(i, 1);
        }
      }
    }

    // Montos de la pista de PRECIO (pedido/producto/bogo). monto 0 = no cubre nada del carrito.
    const precio = [], envios = [];
    for (const c of candidatos) {
      if (c.d.tipo === 'envio') { envios.push(c); continue; }
      c.monto = Math.min(montoDescuento(c.d, items, subBruto), subBruto);
      if (c.monto <= 0) { if (c.esElCodigo) out.motivo = 'no_aplica_productos'; continue; }
      precio.push(c);
    }

    // COMBINACIÓN: todos los combinables juntos VS el mejor no-combinable solo — gana el que
    // más descuenta (empate → el plan que contiene el código tecleado: respeta la intención).
    const combi = precio.filter(c => c.d.combinable);
    const solos = precio.filter(c => !c.d.combinable).sort((a, b) => b.monto - a.monto || (b.esElCodigo ? 1 : 0) - (a.esElCodigo ? 1 : 0));
    const sumCombi = Math.min(combi.reduce((s, c) => s + c.monto, 0), subBruto);
    const mejorSolo = solos[0] || null;
    let plan;
    if (!mejorSolo) plan = combi;
    else if (!combi.length) plan = [mejorSolo];
    else if (sumCombi > mejorSolo.monto) plan = combi;
    else if (sumCombi < mejorSolo.monto) plan = [mejorSolo];
    else plan = combi.some(c => c.esElCodigo) ? combi : [mejorSolo];
    out.monto = Math.min(plan.reduce((s, c) => s + c.monto, 0), subBruto);   // JAMÁS subtotal negativo

    // ENVÍO GRATIS: combinable acompaña a cualquier plan; no-combinable solo si no hay otro descuento.
    // Antes exigía `envios.length === 1`: con DOS envíos gratis vigentes no se aplicaba ninguno
    // (el cliente pagaba flete completo teniendo dos promos activas). El nº de filas de envío no
    // es asunto del cliente — basta con elegir una: la combinable si la hay, si no la primera,
    // y solo cuando no hay otro descuento en el plan (un no-combinable sigue siendo no-combinable).
    const envioOk = envios.find(c => c.d.combinable) || (!plan.length ? envios[0] : null);
    if (envioOk) { out.envioGratis = true; plan = plan.concat([envioOk]); }
    // El código tecleado era válido pero quedó fuera del plan (no combina con lo aplicado) → decirlo.
    if (codeIntacto && filaCodigo && !out.motivo && !plan.some(c => c.esElCodigo)) out.motivo = 'no_combinable';

    out.aplicados = plan.map(c => ({
      id: c.d.id, codigo: c.d.codigo || null, nombre: c.d.nombre || null,
      tipo: c.d.tipo, monto: c.monto || 0
    }));
    // Definiciones SANEADAS para el espejo del front (solo lo necesario para PINTAR; nunca
    // usos/límites de otros códigos ni la lista de códigos existentes).
    const sane = d => ({
      id: d.id, codigo: d.codigo || null, nombre: d.nombre || null, tipo: d.tipo,
      valor_tipo: d.valor_tipo, valor: d.valor, aplica: d.aplica || null, bogo: d.bogo || null,
      min_monto: d.min_monto || null, min_items: d.min_items || null, combinable: !!d.combinable
    });
    if (plan.some(c => c.esElCodigo)) { out.def = sane(filaCodigo); out.motivo = null; }
    out.autos = plan.filter(c => !c.d.codigo).map(c => sane(c.d));
  } catch (e) {
    // BD caída / tabla sin migrar / lo que sea: no se regala NADA a ciegas (fail-closed).
    return { monto: 0, envioGratis: false, aplicados: [], motivo: 'error', def: null, autos: [] };
  }
  return out;
}

/* Consume los usos de un pedido que ACABA de confirmarse como venta. Llama al RPC atómico
   descuento_consumir (migración 006): dedupe por (discount_id, order_id) — webhook + cron +
   panel pueden confirmar el mismo pedido y el uso cuenta UNA vez — e incremento sin carreras.
   Nunca bloquea la venta: perder un conteo es mejor que tumbar una confirmación pagada. */
async function consumirDescuentos(sb, order) {
  try {
    const lista = order && order.utm && Array.isArray(order.utm.descuentos) ? order.utm.descuentos : [];
    if (!lista.length) return;
    const cliente = clienteKey(order.tel);
    for (const d of lista) {
      const id = parseInt(d && d.id, 10);
      if (!Number.isFinite(id)) continue;
      try {
        const { error } = await sb.rpc('descuento_consumir', {
          p_discount_id: id, p_order_id: order.id,
          p_reference: order.reference || null, p_cliente: cliente || null
        });
        if (error) console.error('[DESCUENTOS] no se pudo consumir uso', id, order.reference || order.id, error.message);
      } catch (e) { console.error('[DESCUENTOS] no se pudo consumir uso', id, e && e.message); }
    }
  } catch (e) { /* el contador nunca bloquea la venta */ }
}

/* Validación PÚBLICA para el carrito (api/orders.js kind=validar_descuento). Solo CONSULTA:
   dice si el código vale y por qué no, y devuelve las definiciones saneadas para que el front
   pinte. La autoridad del cobro sigue siendo calculateOrder al crear el pedido. */
async function validarDescuentoPublico(input) {
  const sb = serviceClient();
  const items = await priceItems(sb, input.items);   // precios del server, jamás del navegador
  const subBruto = items.reduce((s, i) => s + i.precio, 0);
  const pares = items.reduce((s, i) => s + i.qty, 0);
  const codigoRaw = input.codigo ? String(input.codigo).trim().toUpperCase().slice(0, 40) : null;
  // Los códigos legacy NO pasan por el motor (los valida calculateOrder como siempre).
  const codigo = codigoRaw && !esCuponLegacy(codigoRaw) ? codigoRaw : null;
  const cliente = clienteKey(input.tel);
  const r = await resolverDescuentos(sb, { codigo, items, subBruto, pares, cliente, modo: 'consulta' });
  return {
    ok: true,
    valido: codigo ? !!r.def : null,      // null = no se preguntó por un código (solo automáticos)
    motivo: codigo && !r.def ? (r.motivo || 'no_existe') : null,
    monto: r.monto,
    envio_gratis: r.envioGratis,
    codigo: r.def,                        // definición saneada del código válido (para el espejo)
    autos: r.autos                        // automáticos que aplican a ESTE carrito
  };
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
  const comboId = cleanText(input.combo, 30);
  const pago = cleanText(input.pago || input.payment_method || 'pending', 50);
  // Settings que afectan el cobro (combos + zonas de envío + envío gratis) en UNA sola consulta
  // y EN PARALELO con los precios de los productos: no suma latencia, y los pagos que no la
  // necesitan (online sin combo → envío 0) siguen sin query extra a settings.
  const necesitaCfg = !!comboId || pago === 'contra_entrega';
  const [items, cfgRows] = await Promise.all([
    priceItems(sb, input.items),
    necesitaCfg
      ? Promise.resolve(sb.from('settings').select('key,value').in('key', ['combos', 'envio_zonas', 'envio_gratis_desde']))
          .then(r => (r && r.data) || [], () => [])
      : Promise.resolve([])
  ]);
  const cfg = Object.fromEntries(cfgRows.map(r => [r.key, r.value]));
  const subBruto = items.reduce((s, i) => s + i.precio, 0);
  const pares = items.reduce((s, i) => s + i.qty, 0);
  // COMBO: precio fijo del bundle, validado SERVER-SIDE contra settings.combos.
  // Solo aplica si el combo existe, está activo y el carrito trae EXACTAMENTE sus pares.
  // Si no matchea, se ignora en silencio y se cobra normal (anti-manipulación).
  let combo = null;
  if (comboId) {
    try {
      const lista = cfg.combos ? JSON.parse(cfg.combos) : [];
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
  /* ── MOTOR DE DESCUENTOS NUEVO (tabla discounts) ──
     Corre SOLO si no hay combo ni cupón legacy efectivo: los legacy nunca se combinan (regla de
     siempre) y el combo ya es un precio cerrado. `desc` que mande el navegador se ignora igual
     que los precios: el monto SIEMPRE nace aquí de la tabla + los precios del server. */
  let motor = null;
  let cuponEfectivo = desc > 0 ? cupon : null;   // columna orders.cupon = el código que DE VERDAD descontó
  if (!combo && desc === 0) {
    const d = input.customer || input;
    motor = await resolverDescuentos(sb, {
      codigo: cupon && !esCuponLegacy(cupon) ? cupon : null,   // un legacy inválido no entra al motor
      items, subBruto, pares,
      cliente: clienteKey(d.tel || d.celular),
      modo: 'orden'
    });
    desc = Math.min(motor.monto, subBruto);   // el motor ya capea, pero el tope se reafirma aquí
    const conCodigo = motor.aplicados.find(a => a.codigo);
    cuponEfectivo = conCodigo ? conCodigo.codigo : null;   // un código tecleado que NO aplicó jamás se guarda
  }
  const subtotal = combo ? combo.precio : (subBruto - desc);
  // El flete SIEMPRE se calcula AQUÍ con los settings del server: el `envio` que mande el
  // navegador se ignora (igual que los precios). Solo contra entrega cobra flete.
  // Un descuento tipo 'envio' del motor lo deja en 0 (envío gratis).
  const ciudad = cleanText((input.customer || input).ciudad, 100);
  const envio = pago !== 'contra_entrega' ? 0
    : (motor && motor.envioGratis ? 0 : calcFlete(pares, ciudad, subtotal, cfg.envio_zonas, cfg.envio_gratis_desde));
  return {
    items, subBruto, desc, subtotal, envio, total: subtotal + envio, pares, pago,
    cupon: cuponEfectivo, combo: combo ? combo.id : null,
    descuentos: motor ? motor.aplicados : []   // [{id,codigo,nombre,tipo,monto}] → utm.descuentos (consumo al confirmar)
  };
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
    // Cupón usado: calculateOrder ya devuelve SOLO el código que descontó de verdad (null si no
    // aplicó) → la columna 'cupon' sigue significando "este pedido usó el descuento". Incluye los
    // códigos tipo envío gratis del motor (descuentan flete, no producto: desc puede ser 0).
    cupon: calc.cupon || null,
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
  // Descuentos del motor aplicados a ESTE pedido (utm jsonb = sin migración de orders). Es lo
  // que consumirDescuentos lee al confirmar la venta para subir usos y sellar el 1-por-cliente.
  if (Array.isArray(calc.descuentos) && calc.descuentos.length) {
    row.utm = Object.assign({}, row.utm || {}, { descuentos: calc.descuentos });
  }
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
/* Deja constancia de CADA aviso en la tabla `notificaciones` (migración 005). Antes los mensajes
   se enviaban y se perdían: no había forma de responder "¿qué avisos llegaron?" ni "¿este salió?".
   Nunca rompe el envío — si el registro falla, se loguea y ya. */
async function logNotificacion(row) {
  try {
    const { error } = await serviceClient().from('notificaciones').insert(row);
    if (error) console.error('[NOTIF] no se pudo registrar el aviso:', error.message);
  } catch (e) { console.error('[NOTIF] no se pudo registrar el aviso:', e && e.message); }
}

async function sendTelegram(text, { parseMode, timeoutMs = 2500, tipo = null, order = null } = {}) {
  const meta = {
    canal: 'telegram', tipo, texto: text,
    order_id: (order && order.id) || null,
    reference: (order && order.reference) || null
  };
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chat = (process.env.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chat) {
    console.error('[TELEGRAM] sin TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID: no se envió nada');
    await logNotificacion({ ...meta, ok: false, error: 'sin token o chat_id' });
    return false;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let ok = false, err = null;
  try {
    const body = { chat_id: chat, text };
    if (parseMode) { body.parse_mode = parseMode; body.disable_web_page_preview = true; }
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal
    });
    ok = r.ok;
    // Un 4xx/5xx (bot bloqueado, chat_id malo, rate limit) devolvía false sin dejar rastro.
    if (!ok) {
      err = 'HTTP ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 300);
      console.error('[TELEGRAM] rechazado por la API:', err);
    }
  } catch (e) {
    err = (e && e.name === 'AbortError') ? ('timeout de ' + timeoutMs + 'ms') : ('red: ' + (e && e.message));
    console.error('[TELEGRAM] no se pudo enviar —', err);
  } finally { clearTimeout(t); }
  await logNotificacion({ ...meta, ok, error: err });
  return ok;
}

// Aviso de venta al vendedor: arma el texto y lo manda por el bot (nunca bloquea la confirmación).
// `tipo` distingue el aviso automático de la pasarela del reenvío que aprieta el vendedor.
async function notifyVentaTelegram(order, tipo = 'venta') {
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
  return sendTelegram(text, { tipo, order });   // true/false: lo usa el botón de reenvío del panel para poder decir si salió
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
    // Usos del motor de descuentos: suben SOLO aquí (venta confirmada), atómico e idempotente
    // por pedido — un 'pending' que nunca paga jamás gasta usos ni quema el 1-por-cliente.
    await consumirDescuentos(sb, order).catch(() => {});
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

module.exports = { anonClient, serviceClient, cleanText, calculateOrder, createOrder, getOrderByReference, confirmPaidOrder, contentIdsDe, cartSig, decrementStock, genWelcomeCode, esCodigoBienvenida, marcarCuponBienvenidaUsado, sendTelegram, notifyVentaTelegram, calcFlete, normCiudad, consumirDescuentos, validarDescuentoPublico };

// Motor de descuentos expuesto para pruebas locales (Vercel no lo usa; mismo patrón que
// dashboard._clientes y admin._audiencia): permite testear la lógica con un sb falso, sin BD.
module.exports._descuentos = { resolverDescuentos, montoDescuento, descuentoAplicaItem, motivoNoUtilizable, esCuponLegacy, clienteKey, cuponDesc };
