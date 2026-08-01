/* Service Worker — PWA del panel admin de Strange.
   Solo se registra en contexto admin (ver el bloque PWA en index.html).
   Diseño no-destructivo: aunque quede activo en el navegador donde abriste el admin,
   nunca rompe la tienda del cliente.

   Estrategia:
   - /api/*            → network-only (datos del admin SIEMPRE en vivo; nunca cachear).
   - same-origin resto → network-first con fallback a cache (admin fresco tras cada deploy,
                         pero abre offline). Navegaciones offline → cae a /index.html.
   - cross-origin      → passthrough sin tocar (supabase, GA, fbq, etc.).

   Sube el numero de version (v1 → v2 …) en cada deploy que cambie el app-shell. */
const CACHE = 'strange-admin-v12';   // v11: aviso de verificar la talla al escogerla

const SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/base.js',
  '/tracking.js',
  '/router.js',
  '/tienda.js',
  '/carrito.js',
  '/boot.js',
  '/extras.js',
  '/admin.html',
  '/admin.js',
  '/icons/admin-192.png',
  '/icons/admin-512.png',
  '/icons/admin-maskable-512.png',
  '/icons/admin-apple-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll falla si un solo recurso da error; lo hacemos tolerante.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // POST/PUT del admin: passthrough

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // cross-origin: passthrough

  if (url.pathname.startsWith('/api/')) {                 // datos: SIEMPRE en vivo
    e.respondWith(fetch(req));
    return;
  }

  // network-first con fallback a cache
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) =>
          hit || (req.mode === 'navigate' ? caches.match('/index.html') : undefined)
        )
      )
  );
});
