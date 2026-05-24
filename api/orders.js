const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const d = req.body;
  if (!d?.total || !d?.fecha) return res.status(400).json({ error: 'total y fecha requeridos' });

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { error } = await sb.from('orders').insert({
    fecha:     d.fecha,
    nombre:    d.nombre,
    cedula:    d.cedula,
    tel:       d.tel || d.celular,
    ciudad:    d.ciudad,
    barrio:    d.barrio,
    direccion: d.direccion,
    pago:      d.pago,
    total:     parseInt(d.total),
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
