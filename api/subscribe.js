const { createClient } = require('@supabase/supabase-js');

const ALLOWED_ORIGINS = ['https://catalogo.strangesneakers.com', 'https://strange-catalog.vercel.app'];

// Código del cupón de bienvenida ($20.000 OFF). Debe coincidir con CUPONES en index.html.
const CODIGO_BIENVENIDA = 'BIENVENIDO20';

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

  const d = req.body || {};
  const nombre   = d.nombre ? String(d.nombre).trim().slice(0, 200) : '';
  const whatsapp = d.whatsapp ? String(d.whatsapp).replace(/\D/g, '').slice(0, 20) : '';

  if (!nombre)            return res.status(400).json({ error: 'nombre requerido' });
  if (whatsapp.length < 7) return res.status(400).json({ error: 'whatsapp inválido' });

  // cumple: aceptar YYYY-MM-DD (input date). Guardar como texto para promos de cumpleaños.
  const cumple = d.cumple ? String(d.cumple).slice(0, 20) : null;
  const utm    = (d.utm && typeof d.utm === 'object' && !Array.isArray(d.utm)) ? d.utm : null;
  const session_id = d.session_id ? String(d.session_id).slice(0, 64) : null;

  // Para escribir/leer subscribers se usa service_role (la tabla tiene RLS sin policy pública).
  const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
  const sb = createClient(process.env.SUPABASE_URL, key);

  try {
    // Dedup suave por whatsapp: si ya está registrado, no duplicar, pero igual dar el código.
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

  res.status(201).json({ ok: true, codigo: CODIGO_BIENVENIDA });
};
