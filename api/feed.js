const { createClient } = require('@supabase/supabase-js');

// La anon key publishable (sb_publishable_...) es PÚBLICA por diseño (ya está en base.js y
// middleware.js; RLS protege). Supabase deprecó las llaves JWT legacy (eyJ...) → la env vieja
// daba 503 en el feed. Se prefiere la env SI ya está en el formato nuevo sb_*; si no, esta.
// (Self-healing: cuando se actualice SUPABASE_ANON_KEY en Vercel al formato nuevo, se usará esa.)
const ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '').startsWith('sb_')
  ? process.env.SUPABASE_ANON_KEY
  : 'sb_publishable_ZjVLucKCxH2RM2CycRhkhQ_Gw95sl7s';

/* ── PROXY DE FOTOS (/img/… lo reescribe aquí) ────────────────────────────────
   Sirve las fotos de producto desde Supabase Storage pero A TRAVÉS de Vercel, para que su CDN
   las cachee: la organización se pasó de cuota por "Cached Egress" y los proyectos quedaban
   restringidos (402 = tienda caída).
   ¿Por qué una función y no una reescritura directa a Supabase? Porque Vercel NO cachea las
   reescrituras hacia un origen externo — medido: 5 peticiones seguidas, 5 MISS. La respuesta de
   una función SÍ entra a su CDN cuando lleva s-maxage. Así Supabase se toca una vez por foto y
   no una vez por visitante.
   Vive dentro de feed.js (que ya es público) para no crear un archivo en api/: Vercel está en
   12 de 12 funciones y una más rompe el deploy. */
const SB_BUCKET = '/storage/v1/object/public/product-images/';

async function servirFoto(req, res, archivo) {
  // Solo nombres de archivo: sin rutas ni '..' → no se puede salir del bucket de fotos.
  if (!/^[\w.-]{1,120}$/.test(archivo) || archivo.includes('..')) {
    return res.status(400).json({ error: 'nombre inválido' });
  }
  const base = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  if (!base) return res.status(500).json({ error: 'sin SUPABASE_URL' });
  try {
    const r = await fetch(base + SB_BUCKET + encodeURIComponent(archivo));
    if (!r.ok) return res.status(r.status === 404 ? 404 : 502).json({ error: 'foto no disponible' });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', r.headers.get('content-type') || 'image/webp');
    res.setHeader('Content-Length', String(buf.length));
    // s-maxage = lo que hace que el CDN de Vercel la guarde. Los nombres llevan marca de tiempo
    // (1780374474306_1.webp), así que el contenido nunca cambia: cachear un año es seguro.
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('CDN-Cache-Control', 'public, s-maxage=31536000, immutable');
    return res.status(200).end(buf);
  } catch (e) {
    return res.status(502).json({ error: 'no se pudo traer la foto' });
  }
}

module.exports = async (req, res) => {
 // El proxy va ANTES de armar el feed: es otra cosa que comparte archivo, no parte del feed.
 const foto = req.query && req.query.img;
 if (foto) return servirFoto(req, res, String(foto));
 try {
  const sb = createClient(process.env.SUPABASE_URL, ANON_KEY);

  // .trim() + sin "/" final: un env mal pegado (BOM/CRLF/slash) ya ensució los links del feed una vez.
  const storeUrl = (process.env.STORE_URL || `https://${req.headers.host}`).trim().replace(/\/+$/, '');

  const [{ data: cats }, { data: liqs }, { data: settings }] = await Promise.all([
    sb.from('products').select('*').eq('sold', false),
    sb.from('liq_products').select('*').eq('sold', false),
    sb.from('settings').select('*')
  ]);

  const cfg = Object.fromEntries((settings || []).map(r => [r.key, r.value]));
  const brand = cfg.store_name || 'Strange Sneakers';

  // Etiquetas legibles de marca para el feed de Meta
  const BRAND_LABELS = { adidas:'Adidas', nike:'Nike', reebok:'Reebok', new_balance:'New Balance', on_cloud:'On Cloud', puma:'Puma', lecoq_sportif:'Le Coq Sportif', jordan:'Jordan', lacoste:'Lacoste', asics:'Asics', onitsuka_tiger:'Onitsuka Tiger', luxury:'Luxury' };
  const brandLabel = b => BRAND_LABELS[b] || null;

  // ── Tallas por género — MISMA regla que tallasInfo() en tienda.js ──
  // La tienda NO rastrea stock por talla (la columna tallas está en null en todo el catálogo):
  // deriva las tallas del género del producto. Se replica esa regla aquí para que el feed nunca
  // anuncie una talla que la ficha no ofrece. Si algún día se llena tallas (jsonb {talla:stock}),
  // se respeta: solo se listan las tallas con stock > 0.
  const TALLAS_MUJER = ['36','37','38','39'], TALLAS_HOMBRE = ['40','41','42','43','44'];
  const TALLAS_UNISEX = ['36','37','38','39','40','41','42','43','44'];
  const tallasDe = p => {
    const t = p.tallas;
    if (t && typeof t === 'object' && !Array.isArray(t)) {
      // jsonb con stock: anunciar solo lo disponible (todo en 0 → mejor callar tallas que
      // prometer una agotada en un anuncio pago)
      return Object.keys(t).filter(k => Number(t[k]) > 0).sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0));
    }
    if (Array.isArray(t)) return t.filter(x => x != null && String(x).trim() !== '');
    if (p.gender === 'm') return TALLAS_MUJER;
    if (p.gender === 'h') return TALLAS_HOMBRE;
    if (p.gender === 'u') return TALLAS_UNISEX;
    return [];   // liquidación no tiene género → la ficha no muestra selector de tallas
  };
  // "Tallas 40 a 44" si son consecutivas (el caso normal por género); lista explícita si hay
  // huecos (pasa cuando el jsonb de stock deja tallas agotadas por fuera).
  const tallasTexto = ts => {
    if (!ts.length) return '';
    if (ts.length === 1) return 'Talla ' + ts[0];
    const n = ts.map(Number);
    const seguidas = n.every((v, i) => i === 0 || v === n[i - 1] + 1);
    return seguidas && ts.length > 2 ? 'Tallas ' + ts[0] + ' a ' + ts[ts.length - 1] : 'Tallas ' + ts.join(', ');
  };

  // Descripción ÚNICA por producto (nombre/marca + género + tallas + Ref). Antes era idéntica
  // para todo el catálogo → Meta agrupaba los anuncios dinámicos como duplicados y castigaba
  // la entrega. Solo datos REALES de la fila; los claims comerciales calcan el copy del sitio
  // (contra entrega en todo el país). El "envío gratis" es condicional (solo pago anticipado,
  // ver annbar de index.html) → NO se promete aquí.
  const descDe = (p, bl, gen, ref) => {
    const genTxt = gen === 'Hombre' ? 'hombre' : gen === 'Unisex' ? 'hombre y mujer' : 'mujer';
    const nombre = p.modelo || (bl ? 'Tenis ' + bl : 'Tenis');
    const tt = tallasTexto(tallasDe(p));
    return [
      nombre + ' para ' + genTxt,
      tt ? tt + ' disponibles' : '',
      'Envío a toda Colombia con pago contra entrega: pagas al recibir',
      brand + ' · Ref. ' + ref
    ].filter(Boolean).join('. ') + '.';
  };
  /* Las fotos se sirven por el CDN de Vercel, no directo desde Supabase Storage: servirlas desde
     allá agotó la cuota de "Cached Egress" de la organización. Meta necesita la URL ABSOLUTA.
     Espejo de imgCdn() en base.js — si se cambia una, cambiar la otra. */
  const SB_FOTOS = '/storage/v1/object/public/product-images/';
  const imgCdn = u => {
    const s = String(u || '');
    if (!s) return s;
    const i = s.indexOf(SB_FOTOS);
    return i === -1 ? s : 'https://strangesneakers.com/img/' + s.slice(i + SB_FOTOS.length);
  };
  // Galería: fotos secundarias (columna imgs = JSON array) → additional_image_link (máx 10)
  const extraImgs = p => {
    try { const a = JSON.parse(p.imgs || '[]'); return Array.isArray(a) && a.length ? { additional_image_link: a.slice(0, 10).map(imgCdn) } : {}; }
    catch { return {}; }
  };

  const all = [
    ...(cats || []).map(p => {
      const bl = brandLabel(p.brand);                 // marca real del zapato (o null)
      const gen = p.gender === 'h' ? 'Hombre' : p.gender === 'u' ? 'Unisex' : 'Mujer';
      return {
      id:           'cat_' + p.id,
      // Sin modelo, la Ref. hace el título único: 45 productos compartían "Nike Par Hombre — ..."
      // y Meta los trataba como duplicados en el catálogo. .slice(0,200) porque Meta corta ahí.
      title:        (p.modelo || ('Tenis ' + (bl ? bl + ' ' : '') + gen + ' Ref. ' + p.id + ' — ' + brand)).slice(0, 200),
      description:  descDe(p, bl, gen, p.id),
      availability: 'in stock',
      condition:    'new',
      price:        ((p.price_before && p.price_before > p.price) ? p.price_before : p.price) + ' COP',
      ...(p.price_before && p.price_before > p.price ? { sale_price: p.price + ' COP' } : {}),
      link:         storeUrl + '/?type=cat&id=' + p.id,
      image_link:   imgCdn(p.img_url),
      ...extraImgs(p),
      brand:        bl || brand,                       // marca real si existe; si no, la tienda
      google_product_category: '187',                  // Google taxonomy: 187 = Apparel & Accessories > Shoes
      product_type: 'Calzado > ' + gen,
      identifier_exists: 'no'                           // sin GTIN/MPN → evita penalización en Merchant
    };}),
    ...(liqs || []).map(p => ({
      id:           'liq_' + p.id,
      // Ref. L{id} para no chocar con las Ref. del catálogo (los ids de las dos tablas se solapan)
      title:        (p.modelo ? p.modelo + ' — Liquidación' : ('Liquidación Ref. L' + p.id + ' — ' + brand)).slice(0, 200),
      description:  [
        (p.modelo || 'Tenis') + ' a precio especial de liquidación',
        'Envío a toda Colombia con pago contra entrega: pagas al recibir',
        brand + ' · Ref. L' + p.id
      ].join('. ') + '.',
      availability: 'in stock',
      condition:    'new',
      price:        ((p.price_before && p.price_before > p.price) ? p.price_before : p.price) + ' COP',
      ...(p.price_before && p.price_before > p.price ? { sale_price: p.price + ' COP' } : {}),
      link:         storeUrl + '/?type=liq&id=' + p.id,
      image_link:   imgCdn(p.img_url),
      ...extraImgs(p),
      brand:        brand,
      google_product_category: '187',
      product_type: 'Calzado > Liquidación',
      identifier_exists: 'no'
    }))
  ];

  // ── DESEMPATE DE TÍTULOS REPETIDOS ──
  // Meta marca "contenido duplicado" cuando varios productos comparten título, y eso castiga
  // los anuncios de catálogo. Aquí pasa de verdad: hay 8 "ADIDAS SAMBA", 6 "ADIDAS SUPERSTAR"…
  // porque el mismo modelo se subió en varios colores con un solo nombre.
  // Shopify lo resuelve agrupando variantes con item_group_id + atributo color; sin columna de
  // color en la BD, se desempata con la referencia SOLO en los repetidos: los títulos ya únicos
  // ("NIKE DUNK PANDA", "ADIDAS SUPERSTAR NEGRO") quedan limpios, sin número encima.
  // Va después del array para que aplique igual al JSON y al CSV programado de Meta.
  // Cuando se llene el color por producto, la mayoría dejará de chocar y esto se apagará solo.
  const vecesTitulo = {};
  all.forEach(p => { vecesTitulo[p.title] = (vecesTitulo[p.title] || 0) + 1; });
  all.forEach(p => {
    if (vecesTitulo[p.title] > 1 && !/ Ref\. /.test(p.title)) {
      // La Ref. va SIEMPRE al final: si el título es tan largo que no cabe, se recorta el
      // título, no la referencia. Cortando al final, dos títulos largos casi iguales volverían
      // a quedar idénticos justo después de desempatarlos.
      const ref = ' Ref. ' + String(p.id).replace(/^(cat|liq)_/, '');
      const base = p.title.length + ref.length > 200 ? p.title.slice(0, 200 - ref.length) : p.title;
      p.title = base + ref;
    }
  });

  // ?format=csv → formato que Meta Commerce acepta como feed PROGRAMADO (JSON no es válido
  // para data sources con schedule; CSV sí). El JSON se mantiene como default (lo usan
  // el agente y otras integraciones).
  if ((req.query || {}).format === 'csv') {
    const cols = ['id','title','description','availability','condition','price','sale_price','link','image_link','additional_image_link','brand','google_product_category','product_type','identifier_exists'];
    const esc = v => {
      if (v == null) return '';
      const s = Array.isArray(v) ? v.join(',') : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(',')];
    all.forEach(p => lines.push(cols.map(c => esc(p[c])).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    return res.send(lines.join('\n'));
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  res.json({ data: all });
 } catch (e) {
  // Un fallo transitorio de Supabase no debe romper el feed sin diagnóstico (Merchant/Meta).
  res.status(503).json({ error: 'feed_unavailable' });
 }
};
