-- 010 — Piso de margen: que un descuento NUNCA venda por debajo del costo (2026-08-04)
--
-- Por qué: product_costs (setup.sql) existe desde hace meses, alimenta el margen del dashboard
-- (api/dashboard.js) y api/_orders.js NO LA MENCIONA NI UNA VEZ. O sea: hoy mismo un descuento
-- del 60% sobre un producto con poco margen se cobra sin que nada lo impida.
-- Shopify tiene "costo por artículo" pero TAMPOCO protege el descuento contra él — esto es
-- superarlo, no emparejarlo.
--
-- Config por descuento en `piso` (jsonb); null = usa el default global de settings.descuento_piso:
--   {"modo":"avisar"|"aplicar"|"off", "pct":15, "sin_costo":"ignorar"|"estimar"|"bloquear",
--    "pct_fallback":55, "incluir_flete":false}
--
--   modo "avisar"  → CALCULA el recorte y lo registra en orders.utm.descuentos_piso, pero NO
--                    cambia el precio. Es el modo de estreno obligatorio: así el deploy no puede
--                    subirle el precio a una promo que ya está corriendo.
--   modo "aplicar" → recorta de verdad.
--   pct            → margen mínimo exigido sobre el costo (15 = vender al menos a costo × 1,15).
--   sin_costo      → qué hacer con un producto SIN costo registrado (la cobertura es parcial):
--                    "ignorar" (default) = no aporta al costo base, el piso protege lo que sí se
--                    conoce y mejora solo a medida que se registran costos.
--                    "estimar" = usa pct_fallback × precio.
--                    "bloquear" = sin costo, sin descuento. NO usarlo de default: con cobertura
--                    parcial mataría casi todas las promos EN SILENCIO, que es lo peor que puede
--                    hacer un descuento.
--
-- ignora_piso: escotilla explícita para liquidar bajo costo A PROPÓSITO (liq_products es
-- justamente el sitio donde vender bajo costo es el negocio). Fail-closed: por defecto false.
--
-- ⚠️ La configuración del piso vive AQUÍ, en discounts (RLS activo, sin policies, solo
-- service_role) y NO en la tabla settings — settings la lee cualquier visitante con la anon key
-- ("anon read settings", setup.sql). En settings solo va la POLÍTICA global (modo/pct), que no
-- contiene ningún costo ni margen.
--
-- ⚠️ Correr ANTES del deploy (mismo gotcha que la 006 y la 001): sin las columnas, guardar un
-- descuento desde el panel falla. El motor sin ellas sigue funcionando exactamente como hoy.
-- Idempotente: seguro de correr varias veces.

-- ⚠️ lock_timeout: `add column ... not null default` NO reescribe la tabla en PG11+ (el default se
-- guarda en catálogo) y discounts tiene un puñado de filas, pero el ALTER pide igualmente ACCESS
-- EXCLUSIVE y esta tabla la lee CADA checkout. Fallar en 3s es mejor que encolar carritos.
set lock_timeout = '3s';
alter table discounts add column if not exists piso        jsonb;
alter table discounts add column if not exists ignora_piso boolean not null default false;
reset lock_timeout;

-- Default global. NACE APAGADO a propósito: un deploy jamás puede cambiar el precio de una promo
-- que ya está corriendo. El dueño lo enciende cuando quiera, primero en "avisar" para ver una
-- semana cuánto le habría recortado y con qué productos.
-- ⚠️ settings lo lee cualquiera con la anon key: aquí SOLO va la política, NUNCA un costo, un
-- margen ni nada derivado de product_costs.
insert into settings (key, value) values
  ('descuento_piso',
   '{"modo":"off","pct":0,"sin_costo":"ignorar","pct_fallback":55,"incluir_flete":false}')
on conflict (key) do nothing;

-- RLS: discounts ya nace con row level security y sin policies (migración 006), así que la anon
-- key no ve ni códigos, ni límites, ni ahora los pisos de margen. Nada que añadir.
-- Se repite el revoke por defensa en profundidad (idempotente, mismo criterio que la 006).
revoke all on table discounts, discount_usos from anon, authenticated;
