const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const d = req.body;
  if (!d?.total || !d?.fecha) return res.status(400).json({ error: 'total y fecha requeridos' });

  const total = parseInt(d.total);
  if (isNaN(total) || total < 1000 || total > 100_000_000) {
    return res.status(400).json({ error: 'total fuera de rango' });
  }

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
    pares:     d.pares,
    items:     d.items,
    status:    d.status || 'pending',
    reference: d.reference,
    utm:       d.utm,
    referrer:  d.referrer,
    seccion:   d.seccion
  });

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ ok: true });
};
