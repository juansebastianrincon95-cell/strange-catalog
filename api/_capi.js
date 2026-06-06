const https = require('https');
const crypto = require('crypto');

const GRAPH = 'graph.facebook.com';
const VER   = 'v21.0';

// SHA-256 de un dato normalizado (Meta exige hash para Advanced Matching server-side)
function hash(v) {
  if (!v) return undefined;
  return crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
}

// Teléfono: solo dígitos, con prefijo país Colombia (57) si viene sin él
function hashPhone(tel) {
  if (!tel) return undefined;
  let d = String(tel).replace(/\D/g, '');
  if (d.length === 10) d = '57' + d;        // celular CO sin prefijo
  return crypto.createHash('sha256').update(d).digest('hex');
}

function post(path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname: GRAPH, path: `/${VER}/${path}`, method: 'POST', headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }},
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode, body: raw }); }
        });
      }
    );
    req.on('error', () => resolve(null));   // falla en silencio: nunca rompe el checkout
    req.write(data);
    req.end();
  });
}

/**
 * Envía un evento a la Conversions API de Meta.
 * Falla en silencio si faltan credenciales o Meta no responde.
 * @returns {Promise<boolean>} true si Meta aceptó el evento
 */
async function sendEvent({ eventName, value, currency = 'COP', phone, city, name,
                           eventId, actionSource = 'website', eventSourceUrl,
                           contentIds, fbp, fbc, clientIp, clientUserAgent }) {
  const PIXEL = (process.env.META_PIXEL_ID || '').trim();
  const TOKEN = (process.env.META_CAPI_TOKEN || process.env.META_USER_TOKEN || '').trim();
  if (!PIXEL || !TOKEN || !eventName) return false;

  const np = name ? String(name).trim().toLowerCase().split(/\s+/) : [];
  const user_data = {};
  const ph = hashPhone(phone);  if (ph) user_data.ph = [ph];
  const ct = hash(city);        if (ct) user_data.ct = [ct];
  const fn = hash(np[0]);       if (fn) user_data.fn = [fn];
  const ln = hash(np.slice(1).join(' ')); if (ln) user_data.ln = [ln];
  user_data.country = [hash('co')];
  // Identificadores de atribución de Meta (NO se hashean: van en crudo)
  if (fbp) user_data.fbp = String(fbp);
  if (fbc) user_data.fbc = String(fbc);
  if (clientIp) user_data.client_ip_address = String(clientIp);
  if (clientUserAgent) user_data.client_user_agent = String(clientUserAgent);

  const custom_data = { currency };
  if (value != null) custom_data.value = Number(value);
  if (Array.isArray(contentIds) && contentIds.length) {
    custom_data.content_ids = contentIds;
    custom_data.content_type = 'product';
  }

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: actionSource,
    user_data,
    custom_data
  };
  if (eventId) event.event_id = eventId;
  if (eventSourceUrl) event.event_source_url = eventSourceUrl;

  // Con META_TEST_EVENT_CODE puesto en Vercel, los eventos caen en la pestaña "Probar eventos"
  // de Events Manager (validación sin ensuciar datos reales). Quitar el env = producción normal.
  const payload = { data: [event] };
  const testCode = (process.env.META_TEST_EVENT_CODE || '').trim();
  if (testCode) payload.test_event_code = testCode;

  const r = await post(`${PIXEL}/events?access_token=${TOKEN}`, payload);
  return !!(r && r.status >= 200 && r.status < 300);
}

module.exports = { sendEvent, hash, hashPhone };
