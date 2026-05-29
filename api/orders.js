const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGINS = ['https://catalogo.strangesneakers.com', 'https://strange-catalog.vercel.app'];

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

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { error } = await sb.from('orders').insert({
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
  });

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ok: true });
};
