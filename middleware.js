// Edge Middleware — Open Graph dinámico para rutas de producto /p/:id
//
// Por qué existe: los scrapers de WhatsApp/Facebook NO ejecutan JS, así que leen
// el Open Graph genérico de index.html y el preview sale sin la foto/título del
// producto. Este middleware corre en el Edge (Web API estándar, sin next/server)
// y reescribe SOLO los 4 meta OG server-side para rutas /p/*.
//
// IMPORTANTE — el Edge Middleware NO cuenta contra el límite de 12 Serverless
// Functions del plan Hobby (api/). NO crea ninguna función nueva en api/.
//
// DEFENSIVO: TODO va en try/catch. Ante CUALQUIER fallo (id no numérico,
// producto inexistente, Supabase caído, error de red, etc.) se hace `return;`
// y Vercel sirve la ruta normal (index.html genérico, hidratado por el front).
// Un preview feo es aceptable; una página rota NO.

export const config = { matcher: '/p/:path*' };

const SUPABASE_URL  = 'https://ayogbrpqezutzfdktsok.supabase.co';
const SUPABASE_ANON = 'sb_publishable_ZjVLucKCxH2RM2CycRhkhQ_Gw95sl7s';

// Escapa para insertar de forma segura dentro de un atributo HTML con comillas dobles.
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
  // En la data: 'h' = Hombre, 'm' = Mujer (ver tienda.js/router.js).
  if (g === 'h' || g === 'hombre') return 'Hombre';
  if (g === 'm' || g === 'mujer') return 'Mujer';
  if (g === 'u' || g === 'unisex') return 'Unisex';
  return '';
}

export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname; // ej. /p/29-adidas-running

    // Extraer el id: /p/{id}-{slug}. Solo productos numéricos de la tabla `products`.
    // Los liquidación llevan prefijo "L" (/p/L29) y NO están en `products` → fallback.
    const m = pathname.match(/^\/p\/(\d+)(?:-|$)/);
    if (!m) return; // no numérico o con prefijo L → servir normal

    const id = m[1];

    // Traer el producto de Supabase REST (anon, público).
    const apiUrl =
      SUPABASE_URL +
      '/rest/v1/products?id=eq.' + encodeURIComponent(id) +
      '&select=id,modelo,brand,gender,img_url,price';

    const res = await fetch(apiUrl, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: 'Bearer ' + SUPABASE_ANON,
      },
    });
    if (!res.ok) return; // Supabase devolvió error → servir normal

    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return; // producto no existe → servir normal
    const p = rows[0];
    if (!p || !p.img_url) return; // sin imagen no vale la pena reescribir → servir normal

    // Construir valores OG.
    const titleCore =
      (p.modelo && String(p.modelo).trim()) ||
      [brandLabel(p.brand), genderLabel(p.gender)].filter(Boolean).join(' · ') ||
      'Sneakers';
    const ogTitle = titleCore + ' — Strange Sneakers';
    const priceTxt = fmtCOP(p.price);
    const ogDesc =
      (priceTxt ? priceTxt + ' · ' : '') +
      'Envío gratis a toda Colombia · Pago contra entrega';
    const ogImg = String(p.img_url);
    const ogUrl = 'https://strangesneakers.com' + pathname;

    // Traer el HTML base. /index.html NO matchea el matcher (/p/:path*) → sin loop.
    const htmlRes = await fetch(new URL('/index.html', request.url));
    if (!htmlRes.ok) return; // no se pudo leer el HTML → servir normal
    let html = await htmlRes.text();

    // Reemplazos ANCLADOS a los ids existentes (forma EXACTA en index.html).
    // Si alguno no matchea (HTML cambió), simplemente no se reescribe esa etiqueta;
    // el resto sí, y nunca rompemos nada.
    html = html
      .replace(
        /<meta property="og:title" id="ogTitle" content="[^"]*">/,
        '<meta property="og:title" id="ogTitle" content="' + escAttr(ogTitle) + '">'
      )
      .replace(
        /<meta property="og:description" id="ogDesc" content="[^"]*">/,
        '<meta property="og:description" id="ogDesc" content="' + escAttr(ogDesc) + '">'
      )
      .replace(
        /<meta property="og:url" id="ogUrl" content="[^"]*">/,
        '<meta property="og:url" id="ogUrl" content="' + escAttr(ogUrl) + '">'
      )
      .replace(
        /<meta property="og:image" id="ogImg" content="[^"]*">/,
        '<meta property="og:image" id="ogImg" content="' + escAttr(ogImg) + '">'
      );

    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=300',
      },
    });
  } catch (e) {
    // CUALQUIER error → dejar pasar para servir index.html genérico.
    return;
  }
}
