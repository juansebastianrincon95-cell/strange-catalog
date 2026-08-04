-- 007 — Metacampos por producto (columna meta jsonb, estilo Shopify) (2026-08-02)
-- Por qué: hoy cada dato nuevo de producto es un ALTER TABLE + migración + deploy (ya van 6).
-- Shopify resuelve esto con "metafields": datos propios por producto sin tocar el esquema.
-- Esta columna replica eso: un jsonb libre de pares clave→valor que el panel edita y la ficha
-- muestra, sin volver a migrar nunca por un dato de catálogo nuevo.
--
-- Usos previstos:
--   • Metacampos visibles en la ficha:  {"material":"cuero","temporada":"verano","cuidado":"..."}
--   • SEO por producto (hueco vs Shopify): meta.seo = {
--       "title":       "…",            -- título de página, máx 70 caracteres
--       "description": "…",            -- metadescripción, máx 160 caracteres
--       "handle":      "nike-air-90"   -- slug de la URL /p/{id}-{handle}; el id SIEMPRE queda
--     }                                --   en la URL → cambiar el handle no rompe links viejos
--
-- ⚠️⚠️ SEGURIDAD — LÉEME ANTES DE GUARDAR NADA EN meta ⚠️⚠️
-- La tabla products la lee CUALQUIER VISITANTE con la anon key pública (policy "anon read
-- products", select *). Es el MISMO motivo por el que el costo de adquisición tuvo que irse a
-- la tabla aparte product_costs (ver setup.sql). Por tanto meta es SOLO para datos PÚBLICOS:
-- material, temporada, cuidado, medidas, SEO. NUNCA costos, márgenes, proveedores, notas
-- internas ni datos personales. El editor del panel repite este aviso.
--
-- Compatibilidad: meta arranca en NULL para todo el catálogo y TODO sigue igual (ficha, feed
-- de Meta, sitemap, URLs): cada consumidor cae a su comportamiento de hoy cuando meta es null.
--
-- ⚠️ Correr ANTES del deploy del editor: sin la columna, guardar metacampos desde el panel
-- falla (update a columna inexistente). El resto del sitio no depende de ella para funcionar.
-- Idempotente: seguro de correr varias veces.

-- ⚠️ lock_timeout: añadir una columna nullable sin default es un cambio SOLO de catálogo (no
-- reescribe las ~200 filas, dura microsegundos). El riesgo no es la duración: es que el ALTER
-- pide ACCESS EXCLUSIVE y, si en ese instante algo tiene la tabla tomada (el backup automático
-- de Supabase hace pg_dump con ACCESS SHARE sobre todo), el ALTER se encola Y SE PONE DELANTE de
-- todos los `select * from products` de los visitantes → tienda en blanco mientras dure. Con el
-- timeout, si hay bloqueo falla en 3s (55P03) en vez de tumbar la tienda; se reintenta y ya.
set lock_timeout = '3s';
alter table products     add column if not exists meta jsonb;
alter table liq_products add column if not exists meta jsonb;
reset lock_timeout;

-- Sin índices: el catálogo son ~200 filas y meta se lee siempre junto con el resto de la fila
-- (select *). Un GIN aquí sería costo de escritura sin ninguna consulta que lo aproveche.
