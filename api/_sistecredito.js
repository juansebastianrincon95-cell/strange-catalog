/* Integración Sistecrédito (BNPL — pago a crédito desde la web). Recuperada del plugin
   WooCommerce `sistecredito-3-1` que ya operaba en producción para Strange Sneakers.
   Flujo: POST create/transaction (subscription_key + JWT HS256) → {transactionId, urlToRedirect} →
   el cliente aplica/paga → confirmación por estado (getInfoCredit, transactionStatus===3) tanto en
   el retorno del cliente como en el webhook y el cron de reconciliación.
   Helper con guión bajo → NO cuenta para el límite de 12 Serverless Functions de Vercel. */
const crypto = require('crypto');

const ENVS = {
  Production: 'https://api.sistecredito.com',
  Staging: 'https://api-co-stg.sistecreditocloud.com'
};
const PATH_CREATE = '/Spay/PasCheckout/checkout/create/transaction/sistecredito';
const PATH_INFO = '/Spay/PasCheckout/checkout/getInfoCredit?transactionId=';
const SITE = 'https://strangesneakers.com';

function scEnvName() { return (process.env.SISTECREDITO_ENV || 'Production').trim(); }
function scBase() { return ENVS[scEnvName()] || ENVS.Production; }

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// JWT HS256 firmado con un secreto ALEATORIO por request. Sistecrédito no lo verifica cripto
// (el plugin original usa uniqid); basta con un JWT válido cuyo `aud` sea el dominio.
function signJwt() {
  const secret = crypto.randomBytes(24).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: SITE, aud: SITE, iat: now, nbf: now + 30 }));
  const data = header + '.' + payload;
  const sig = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  return data + '.' + sig;
}

function scHeaders(withAuth) {
  const h = {
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': (process.env.SISTECREDITO_SUBSCRIPTION_KEY || '').trim(),
    'SCLocation': '0,0',
    'country': 'co',
    'SCOrigen': scEnvName()
  };
  if (withAuth) h['Authentication'] = signJwt();
  return h;
}

// Fecha ISO con offset Colombia -05:00 (formato del plugin: Y-m-d\TH:i:sP).
function nowBogotaISO() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, '-05:00');
}

// Crea la transacción y devuelve { transactionId, redirectUrl }. valueToPaid = subtotal
// (crédito = envío gratis). orderId DEBE ser entero (Sistecrédito valida FILTER_VALIDATE_INT).
async function createScTransaction(order) {
  const amount = Number(order.subtotal != null ? order.subtotal : order.total);
  const body = {
    typeDocument: 'CC',
    idDocument: String(order.cedula || '').replace(/\D/g, ''),
    transactionDate: nowBogotaISO(),
    valueToPaid: amount,
    vendorId: (process.env.SISTECREDITO_VENDOR_ID || '').trim(),
    storeId: (process.env.SISTECREDITO_STORE_ID || '').trim(),
    orderId: Number(order.id),
    responseUrl: SITE + '/api/orders?webhook=sistecredito'
  };
  const r = await fetch(scBase() + PATH_CREATE, { method: 'POST', headers: scHeaders(true), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  const data = j.data || {};
  if (!r.ok || !data.transactionId || !data.urlToRedirect) {
    const err = new Error('sc_create_failed'); err.status = r.status; err.body = j; throw err;
  }
  const sep = String(data.urlToRedirect).includes('?') ? '&' : '?';
  const redirectUrl = data.urlToRedirect + sep + 'transactionId=' + encodeURIComponent(data.transactionId);
  return { transactionId: data.transactionId, redirectUrl };
}

// Consulta el estado. transactionStatus===3 = "Terminado" (pagado).
async function getScInfo(transactionId) {
  const r = await fetch(scBase() + PATH_INFO + encodeURIComponent(transactionId), { headers: scHeaders(false) });
  const j = await r.json().catch(() => ({}));
  const data = j.data || {};
  // `http` y `raw` se devuelven para poder DISTINGUIR "la pasarela dijo que no pagó" de "la
  // pasarela nos rechazó las credenciales". Sin esto, un 401 se veía igual que un no_pagado y
  // podíamos dar por perdida una venta que sí estaba cobrada.
  return {
    paid: data.transactionStatus === 3,
    http: r.status,
    ok: r.ok,
    raw: (data.transactionStatus !== undefined && data.transactionStatus !== null) ? String(data.transactionStatus) : null,
    valueToPaid: data.valueToPaid,
    creditNumber: data.credit && data.credit.creditNumber
  };
}

module.exports = { createScTransaction, getScInfo };
