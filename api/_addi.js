/* Integración Addi (BNPL — pago a crédito desde la web). Recuperada del plugin WooCommerce
   `buy-now-pay-later-addi` que ya operaba en producción para Strange Sneakers.
   Flujo: OAuth client_credentials → POST /v1/online-applications → Addi responde 302 con el
   Location al checkout hosted → el cliente aplica/paga → Addi confirma por webhook (callbackUrl).
   Sin archivos `api/` nuevos: este helper lleva guión bajo y NO cuenta para el límite de 12
   Serverless Functions de Vercel Hobby. */
const { serviceClient } = require('./_orders');

// Base URLs por entorno (Colombia). Tomadas del plugin: auth.addi.com + api.addi.com (prod).
const ENVS = {
  production: { auth: 'https://auth.addi.com/oauth/token', api: 'https://api.addi.com' },
  staging: { auth: 'https://auth.addi-staging.com/oauth/token', api: 'https://api.staging.addi.com' }
};

function addiEnv() {
  const e = (process.env.ADDI_ENV || 'production').trim().toLowerCase();
  return ENVS[e] || ENVS.production;
}

// Cache del token a nivel de módulo (sobrevive entre invocaciones en un lambda caliente).
let _tok = { value: null, exp: 0 };

async function getAddiToken() {
  const now = Date.now();
  if (_tok.value && now < _tok.exp - 30000) return _tok.value;
  const { auth, api } = addiEnv();
  const id = (process.env.ADDI_CLIENT_ID || '').trim();
  const secret = (process.env.ADDI_CLIENT_SECRET || '').trim();
  if (!id || !secret) throw new Error('addi_unconfigured');
  const r = await fetch(auth, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audience: api, grant_type: 'client_credentials', client_id: id, client_secret: secret })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('addi_auth_failed');
  _tok = { value: j.access_token, exp: now + (Number(j.expires_in) || 3600) * 1000 };
  return _tok.value;
}

// Parte un nombre completo en firstName/lastName de forma simple (Addi exige ambos).
function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) { const v = parts[0] || 'Cliente'; return { firstName: v, lastName: v }; }
  const cut = parts.length > 3 ? 2 : 1; // 4+ tokens → 2 nombres + 2 apellidos; si no, 1 + resto
  return { firstName: parts.slice(0, cut).join(' '), lastName: parts.slice(cut).join(' ') };
}

/* Items para Addi. Si NO hay descuento (cupón/combo) usamos el detalle real; si SÍ lo hay
   (subtotal < suma bruta), consolidamos en UNA línea al subtotal para que la suma de ítems
   coincida exacto con totalAmount (evita rechazos de validación de Addi y líneas negativas). */
function addiItems(order, amount) {
  const items = Array.isArray(order.items) ? order.items : [];
  const bruto = items.reduce((s, it) => s + (Number(it.precio) || 0), 0);
  if (items.length && Math.round(bruto) === Math.round(amount)) {
    return items.map(it => ({
      sku: String((it.type === 'liq' ? 'L' : '') + it.id),
      name: ((it.label || 'Producto') + (it.brand ? ' ' + it.brand : '') + (it.talla ? ' T' + it.talla : '')).slice(0, 120),
      quantity: Number(it.qty) || 1,
      unitPrice: Math.round(Number(it.unit_price != null ? it.unit_price : (Number(it.precio) / (Number(it.qty) || 1))) || 0)
    }));
  }
  const pares = items.reduce((s, it) => s + (Number(it.qty) || 1), 0) || 1;
  return [{ sku: 'PEDIDO', name: 'Pedido Strange Sneakers (' + pares + ' par' + (pares > 1 ? 'es' : '') + ')', quantity: 1, unitPrice: Math.round(amount) }];
}

/* Crea la solicitud online y devuelve { redirectUrl, applicationId }. El cobro se hace sobre el
   subtotal (sin flete: el crédito lleva envío gratis), igual que Bold. */
async function createAddiApplication(order, email) {
  const token = await getAddiToken();
  const { api } = addiEnv();
  const amount = Math.round(Number(order.subtotal != null ? order.subtotal : order.total));
  const { firstName, lastName } = splitName(order.nombre);
  const cedula = String(order.cedula || '').replace(/\D/g, '');
  const phone = String(order.tel || '').replace(/\D/g, '');
  const address = { lineOne: String(order.direccion || '').slice(0, 200), city: String(order.ciudad || '').slice(0, 80), country: 'CO' };
  const body = {
    orderId: String(order.reference),
    totalAmount: amount,
    shippingAmount: 0,
    totalTaxesAmount: Math.max(0, Math.round(amount - amount / 1.19)), // IVA 19% incluido (informativo)
    currency: 'COP',
    ecommercePlatform: 'CUSTOM',
    items: addiItems(order, amount),
    client: {
      idType: 'CC',
      idNumber: cedula,
      firstName, lastName,
      email: String(email || '').trim(),
      cellphone: phone,
      cellphoneCountryCode: '+57',
      address
    },
    shippingAddress: address,
    allyUrlRedirection: {
      logoUrl: '',
      callbackUrl: 'https://strangesneakers.com/api/orders?webhook=addi',
      redirectionUrl: 'https://strangesneakers.com/?addi=1',
      checkoutUrl: 'https://strangesneakers.com/?addi=cancel'
    }
  };
  const r = await fetch(api + '/v1/online-applications', {
    method: 'POST',
    redirect: 'manual', // Addi responde 302 al checkout hosted; NO seguir, leer el Location
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(body)
  });
  let redirectUrl = r.headers.get('location') || '';
  let applicationId = null;
  if (!redirectUrl) {
    // Fallback: algunos casos devuelven 200/201 con la URL en el cuerpo.
    const j = await r.json().catch(() => ({}));
    redirectUrl = j.redirectUrl || j.redirect_url || j.url || (j.allyUrlRedirection && j.allyUrlRedirection.redirectUrl) || '';
    applicationId = j.applicationId || j.id || null;
  }
  if (!redirectUrl) { const err = new Error('addi_no_redirect'); err.status = r.status; throw err; }
  return { redirectUrl, applicationId };
}

module.exports = { getAddiToken, createAddiApplication, serviceClient };
