const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGINS = ['https://catalogo.strangesneakers.com', 'https://strange-catalog.vercel.app'];

// Código del cupón de bienvenida ($20.000 OFF). Debe coincidir con CUPONES en index.html.
const CODIGO_BIENVENIDA = 'BIENVENIDO20';

// Suscriptor del popup de bienvenida (NO es un pedido). Va aquí, y no en su propio endpoint,
// para no superar el límite de 12 funciones serverless del plan Hobby de Vercel.
async function handleSubscribe(req, res) {
  const d = req.body || {};
  const utm        = (d.utm && typeof d.utm === 'object' && !Array.isArray(d.utm)) ? d.utm : null;
  const session_id = d.session_id ? String(d.session_id).slice(0, 64) : null;
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const sb = createClient(process.env.SUPABASE_URL, key);

  // ── Newsletter del footer: solo correo (sin nombre/whatsapp) ──
  const email = d.email ? String(d.email).trim().slice(0, 200) : '';
  if (d.source === 'footer' || (email && !d.whatsapp)) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'email inválido' });
    try {
      const { data: prev } = await sb.from('subscribers').select('id').eq('email', email).limit(1);
      if (!prev || !prev.length) {
        const { error } = await sb.from('subscribers').insert({ email, utm, session_id, source: 'footer' });
        if (error) return res.status(500).json({ error: error.message });
      }
    } catch (e) { return res.status(500).json({ error: e.message || 'error' }); }
    return res.status(201).json({ ok: true });
  }

  // ── Popup de bienvenida: nombre + whatsapp (+ cumpleaños) ──
  const nombre   = d.nombre ? String(d.nombre).trim().slice(0, 200) : '';
  const whatsapp = d.whatsapp ? String(d.whatsapp).replace(/\D/g, '').slice(0, 20) : '';
  if (!nombre)             return res.status(400).json({ error: 'nombre requerido' });
  if (whatsapp.length < 7) return res.status(400).json({ error: 'whatsapp inválido' });
  const cumple = d.cumple ? String(d.cumple).slice(0, 20) : null;
  try {
    const { data: prev } = await sb.from('subscribers').select('id').eq('whatsapp', whatsapp).limit(1);
    if (!prev || !prev.length) {
      const { error } = await sb.from('subscribers').insert({
        nombre, whatsapp, cumple, utm, session_id, source: 'popup_bienvenida'
      });
      if (error) return res.status(500).json({ error: error.message });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message || 'error' });
  }
  return res.status(201).json({ ok: true, codigo: CODIGO_BIENVENIDA });
}

module.exports = async (req, res) => {
  const origin = (req.headers.origin || '').trim();
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  if (!ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // El popup de bienvenida reusa este endpoint (ver nota de límite de funciones).
  if (req.body && req.body.kind === 'subscriber') return handleSubscribe(req, res);

  const d = req.body;
  if (!d?.total || !d?.fecha) return res.status(400).json({ error: 'total y fecha requeridos' });

  const total = parseInt(d.total);
  if (isNaN(total) || total < 1000 || total > 100_000_000) {
    return res.status(400).json({ error: 'total fuera de rango' });
  }

  // Acotar payloads para evitar abuso (origin es spoofeable por clientes no-browser)
  const pares = Number.isFinite(parseInt(d.pares)) ? Math.min(Math.max(0, parseInt(d.pares)), 1000) : null;
  const items = Array.isArray(d.items) ? d.items.slice(0, 50) : null;
  const utm   = (d.utm && typeof d.utm === 'object' && !Array.isArray(d.utm)) ? d.utm : null;
  const subtotal = Number.isFinite(parseInt(d.subtotal)) ? parseInt(d.subtotal) : null;
  const envio    = Number.isFinite(parseInt(d.envio))    ? parseInt(d.envio)    : null;

  // Campos base (siempre existen en la tabla)
  const base = {
    fecha:     String(d.fecha).slice(0, 50),
    nombre:    d.nombre ? String(d.nombre).slice(0, 200) : null,
    cedula:    d.cedula ? String(d.cedula).slice(0, 30) : null,
    tel:       d.tel || d.celular ? String(d.tel || d.celular).slice(0, 30) : null,
    ciudad:    d.ciudad ? String(d.ciudad).slice(0, 100) : null,
    barrio:    d.barrio ? String(d.barrio).slice(0, 100) : null,
    direccion: d.direccion ? String(d.direccion).slice(0, 300) : null,
    pago:      d.pago ? String(d.pago).slice(0, 50) : null,
    total,
    pares,
    items,
    status:    d.status ? String(d.status).slice(0, 20) : 'pending',
    reference: d.reference ? String(d.reference).slice(0, 100) : null,
    utm,
    referrer:  d.referrer ? String(d.referrer).slice(0, 300) : null,
    seccion:   d.seccion ? String(d.seccion).slice(0, 20) : null
  };
  // Campos nuevos (requieren migración: subtotal/envio/session_id)
  const extra = {
    subtotal,
    envio,
    session_id: d.session_id ? String(d.session_id).slice(0, 64) : null
  };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

  // Si este es un pedido REAL (no el lead 'abandoned' que se guarda al llenar el form),
  // borrar el 'abandoned' previo de la misma sesión para no duplicar. Requiere service_role
  // (la RLS solo deja insertar al anon). Acotado a status='abandoned' + esa session_id.
  if (base.status !== 'abandoned' && extra.session_id && process.env.SUPABASE_SERVICE_KEY) {
    try {
      const sbSvc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
      await sbSvc.from('orders').delete()
        .eq('session_id', extra.session_id).eq('status', 'abandoned');
    } catch (e) { /* si falla, peor caso queda un abandoned huérfano; no rompe el pedido */ }
  }

  let { error } = await sb.from('orders').insert({ ...base, ...extra });

  // Resiliencia: si las columnas nuevas aún no existen (migración pendiente),
  // reintentar solo con los campos base para no perder el pedido.
  if (error && /column .* does not exist|schema cache/i.test(error.message || '')) {
    ({ error } = await sb.from('orders').insert(base));
  }

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ok: true });
};
