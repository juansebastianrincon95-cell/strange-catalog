// Edge Middleware — Open Graph dinámico para /p/:id (incl. liquidación /p/L:id) + sitemap.xml
//
// Por qué existe: los scrapers de WhatsApp/Facebook NO ejecutan JS, así que leen el Open Graph
// genérico de index.html y el preview sale sin la foto/título del producto. Este middleware corre
// en el Edge (Web API estándar, sin next/server) y reescribe SOLO los 4 meta OG server-side para
// rutas /p/*. También genera /sitemap.xml desde el inventario real.
//
// IMPORTANTE — el Edge Middleware NO cuenta contra el límite de 12 Serverless Functions del plan
// Hobby (api/). NO crea ninguna función nueva en api/.
//
// DEFENSIVO: TODO va en try/catch. Ante CUALQUIER fallo (id no numérico, producto inexistente,
// Supabase caído, error de red, etc.) se hace `return;` y Vercel sirve la ruta normal (index.html
// genérico hidratado por el front, o el sitemap.xml estático). Un preview feo es aceptable; una
// página rota NO.

export const config = { matcher: ['/p/:path*', '/sitemap.xml'] };

const SUPABASE_URL  = 'https://ayogbrpqezutzfdktsok.supabase.co';
const SUPABASE_ANON = 'sb_publishable_ZjVLucKCxH2RM2CycRhkhQ_Gw95sl7s';
const SITE = 'https://strangesneakers.com';

// Escapa para insertar de forma segura dentro de un atributo HTML / texto XML con comillas dobles.
function escAttr(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// $1.234.567 — mismo formato que fmt() del front (base.js:50)
function fmtCOP(n) {
  const num = Number(n);
  if (!isFinite(num)) return '';
  return '$' + num.toLocaleString('es-CO');
}

// Mismo mapa que tienda.js:803 / api/feed.js:22
const BRAND_LABELS = {
  adidas: 'Adidas', nike: 'Nike', reebok: 'Reebok', new_balance: 'New Balance',
  on_cloud: 'On Cloud', puma: 'Puma', lecoq_sportif: 'Le Coq Sportif',
  jordan: 'Jordan', lacoste: 'Lacoste', asics: 'Asics',
  onitsuka_tiger: 'Onitsuka Tiger', luxury: 'Luxury',
};
function brandLabel(b) {
  if (!b) return '';
  return BRAND_LABELS[String(b).toLowerCase()] || (String(b).charAt(0).toUpperCase() + String(b).slice(1));
}
function genderLabel(g) {
  if (g === 'h' || g === 'hombre') return 'Hombre';
  if (g === 'm' || g === 'mujer') return 'Mujer';
  if (g === 'u' || g === 'unisex') return 'Unisex';
  return '';
}
// slug igual que navProdUrl/_slug del front (router.js): minúsculas sin tildes, guiones.
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

const SB_HEADERS = { apikey: SUPABASE_ANON, Authorization: 'Bearer ' + SUPABASE_ANON };

export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/sitemap.xml') return sitemap();

    // /p/{L?}{id}-{slug}. Sin L → tabla `products`; con L → `liq_products`.
    const m = pathname.match(/^\/p\/(L)?(\d+)(?:-|$)/);
    if (!m) return; // ruta de producto no reconocida → servir normal
    const isLiq = !!m[1];
    const id = m[2];
    const table = isLiq ? 'liq_products' : 'products';
    // liq_products NO tiene columna gender → pedir gender solo en products (si no, Supabase da 400).
    const select = isLiq ? 'id,modelo,brand,img_url,price' : 'id,modelo,brand,gender,img_url,price';

    const res = await fetch(
      SUPABASE_URL + '/rest/v1/' + table + '?id=eq.' + encodeURIComponent(id) + '&select=' + select,
      { headers: SB_HEADERS }
    );
    if (!res.ok) return;

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return; // no existe → servir normal
    const p = rows[0];
    if (!p || !p.img_url) return; // sin imagen no vale la pena reescribir → servir normal

    const titleCore =
      (p.modelo && String(p.modelo).trim()) ||
      [brandLabel(p.brand), genderLabel(p.gender)].filter(Boolean).join(' · ') ||
      'Sneakers';
    const ogTitle = titleCore + (isLiq ? ' — Oferta Strange Sneakers' : ' — Strange Sneakers');
    const priceTxt = fmtCOP(p.price);
    const ogDesc = (priceTxt ? priceTxt + ' · ' : '') + 'Envío gratis a toda Colombia · Pago contra entrega';
    const ogImg = String(p.img_url);
    const ogUrl = SITE + pathname;

    const htmlRes = await fetch(new URL('/index.html', request.url));
    if (!htmlRes.ok) return;
    let html = await htmlRes.text();

    html = html
      .replace(/<meta property="og:title" id="ogTitle" content="[^"]*">/,
        '<meta property="og:title" id="ogTitle" content="' + escAttr(ogTitle) + '">')
      .replace(/<meta property="og:description" id="ogDesc" content="[^"]*">/,
        '<meta property="og:description" id="ogDesc" content="' + escAttr(ogDesc) + '">')
      .replace(/<meta property="og:url" id="ogUrl" content="[^"]*">/,
        '<meta property="og:url" id="ogUrl" content="' + escAttr(ogUrl) + '">')
      .replace(/<meta property="og:image" id="ogImg" content="[^"]*">/,
        '<meta property="og:image" id="ogImg" content="' + escAttr(ogImg) + '">');

    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' },
    });
  } catch (e) {
    return; // CUALQUIER error → servir index.html genérico
  }
}

// Sitemap dinámico desde el inventario (productos + liquidación no agotados) + vistas fijas.
// Si algo falla → return (Vercel sirve el sitemap.xml estático de fallback).
async function sitemap() {
  try {
    const get = (t) => fetch(SUPABASE_URL + '/rest/v1/' + t + '?select=id,modelo,sold', { headers: SB_HEADERS })
      .then(r => r.ok ? r.json() : []).catch(() => []);
    const [pr, lq] = await Promise.all([get('products'), get('liq_products')]);

    const urls = ['/', '/catalogo', '/quienes', '/mayoristas', '/cambios', '/envios'].map(f => SITE + f);
    for (const p of (Array.isArray(pr) ? pr : [])) {
      if (p && p.id && !p.sold) urls.push(SITE + '/p/' + p.id + (p.modelo ? '-' + slugify(p.modelo) : ''));
    }
    for (const p of (Array.isArray(lq) ? lq : [])) {
      if (p && p.id && !p.sold) urls.push(SITE + '/p/L' + p.id + (p.modelo ? '-' + slugify(p.modelo) : ''));
    }

    const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(u => '  <url><loc>' + escAttr(u) + '</loc></url>').join('\n') +
      '\n</urlset>\n';

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (e) {
    return; // fallback al sitemap.xml estático
  }
}
