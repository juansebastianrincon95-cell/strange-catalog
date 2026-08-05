-- 011 — Motor de descuentos v2: condición por campaña de Meta, elegibilidad por historial,
--       monto por artículo y códigos únicos en masa (2026-08-05)
--
-- Qué cierra, en orden:
--
-- 1) `origen` — el descuento SOLO vale si el cliente viene de cierta campaña de Meta.
--      {"campaigns":["120210..."],"sources":["instagram"],"campaign_like":["remarketing"]}
--    **Shopify NO puede expresar esto**: no sabe de qué anuncio vino el visitante. Para un
--    trafficker es la diferencia entre "20% para todos" y "20% solo para quien vino del
--    remarketing", que es donde el descuento de verdad paga.
--    ⚠️ El utm lo controla el navegador. api/_orders.js lo VERIFICA contra los events de esa
--    sesión cuando este campo no es null; el utm del navegador queda solo como respaldo. Es
--    segmentación, no barrera criptográfica — y sigue acotado por usos_max y vigencia.
--
-- 2) `cliente` — elegibilidad por historial con criterios ABSOLUTOS y baratos (una query).
--      {"compras_min":2,"compras_max":null,"dias_desde_ultima_min":30,"dias_desde_ultima_max":180}
--    A PROPÓSITO no se usan las etiquetas RFM del dashboard: son RELATIVAS a toda la base
--    (quintiles), cambian solas cuando compran OTROS clientes, costarían recalcular la población
--    entera dentro del checkout, y ya dieron un fallo real (el mejor cliente salía "Perdidos").
--    "2 compras" se explica por WhatsApp y se audita a mano; "Campeón" no.
--
-- 3) `valor_alcance` — un monto fijo se aplica una vez por PEDIDO (como hoy) o por ARTÍCULO
--    elegible (como Shopify por defecto). Esto es solo emparejar, no superar.
--
-- 4) `discount_codes` — N códigos irrepetibles de un solo uso atados a UN descuento
--    ("500 códigos para los influencers de agosto"). **Shopify lo tiene SOLO en el plan Plus.**
--    El descuento (reglas, vigencia, mínimos, piso) sigue viviendo en `discounts`; aquí solo
--    viven los TEXTOS. Meter 5.000 filas casi idénticas en `discounts` habría sido el error.
--
-- `aplica` gana claves nuevas SIN DDL (ya es jsonb):
--      {"ids":[],"marcas":[],"generos":["h","u"],"tipos":["liq"],"excluir_promo":true}
--    Semántica: ids/marcas siguen siendo UNIÓN (son "colecciones"); generos/tipos/excluir_promo
--    son filtros AND encima. Meter generos en la unión convertiría "Nike de hombre" en
--    "Nike O hombre". Sin las claves nuevas el comportamiento es IDÉNTICO al de hoy.
--    ⚠️ liq_products no tiene columna gender → un ítem de liquidación NUNCA matchea un filtro de
--    género. Es correcto y el panel lo advierte.
--
-- ⚠️ Correr ANTES del deploy (mismo gotcha que la 006 y la 010): sin las columnas, guardar un
-- descuento desde el panel falla. El motor sin ellas sigue funcionando exactamente como hoy.
-- Idempotente: seguro de correr varias veces.

-- ⚠️ lock_timeout: discounts la lee CADA checkout. Fallar en 3s es mejor que encolar carritos.
set lock_timeout = '3s';
alter table discounts add column if not exists origen        jsonb;
alter table discounts add column if not exists cliente       jsonb;
alter table discounts add column if not exists valor_alcance text not null default 'pedido';
reset lock_timeout;

alter table discounts drop constraint if exists discounts_valor_alcance_chk;
alter table discounts add constraint discounts_valor_alcance_chk
  check (valor_alcance in ('pedido','articulo')) not valid;

-- ── Códigos únicos en masa ───────────────────────────────────────────────────
create table if not exists discount_codes (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  discount_id bigint not null,   -- sin FK a propósito (patrón 005/006): el rastro sobrevive al borrado
  codigo      text   not null,
  lote        text,              -- etiqueta del lote ("agosto-influencers") para exportar o borrar
  usado_at    timestamptz,       -- null = disponible. UN SOLO USO por definición
  order_id    bigint,
  cliente     text               -- últimos 10 dígitos del teléfono que lo quemó
);

-- ⚠️ RLS pegado al create (mismo razonamiento literal que la 006): toda tabla nueva del esquema
-- public nace con GRANT ALL para anon por default privileges, y lo ÚNICO que la tapa es el RLS.
-- Si el script se corriera partido, entre el create y un enable al final habría una ventana en la
-- que cualquiera con la anon key —que está a la vista en base.js— podría LEERSE los 500 códigos.
alter table discount_codes enable row level security;

-- Un código no existe dos veces en TODO el sistema (case-insensitive: el server compara en
-- MAYÚSCULAS). Es además el candado anti-colisión del generador.
create unique index if not exists discount_codes_codigo_idx on discount_codes (upper(codigo));
-- Consulta caliente del panel: "¿cuántos quedan de este lote?"
create index if not exists discount_codes_lote_idx on discount_codes (discount_id, lote);

-- ── Quemar un código: atómico e idempotente ──────────────────────────────────
-- Sobrecarga de descuento_consumir con un 5º parámetro. La firma de 4 argumentos de la 006 SIGUE
-- EXISTIENDO y resolviendo igual, así que ningún llamador actual se rompe.
-- El `where usado_at is null` es el candado: dos confirmaciones simultáneas del mismo código solo
-- pueden quemarlo una vez.
create or replace function descuento_consumir(
  p_discount_id bigint,
  p_order_id    bigint,
  p_reference   text,
  p_cliente     text,
  p_codigo      text
) returns boolean
language plpgsql
security definer
-- pg_temp al FINAL a propósito (mismo endurecimiento que la 006).
set search_path = pg_catalog, public, pg_temp
as $$
declare v_conto boolean;
begin
  insert into discount_usos (discount_id, order_id, reference, cliente)
  values (p_discount_id, p_order_id, p_reference, nullif(p_cliente, ''))
  on conflict (discount_id, order_id) do nothing;
  v_conto := found;
  if v_conto then
    update discounts set usos = usos + 1 where id = p_discount_id;
  end if;
  if nullif(p_codigo, '') is not null then
    update discount_codes
       set usado_at = now(), order_id = p_order_id, cliente = nullif(p_cliente, '')
     where upper(codigo) = upper(p_codigo) and usado_at is null;
  end if;
  return v_conto;
end;
$$;

-- SECURITY DEFINER: que NADIE con la anon key pueda ejecutarla (podría quemar los códigos de
-- otros o inflar contadores). Solo el servidor.
revoke all on function descuento_consumir(bigint, bigint, text, text, text) from public;
revoke all on function descuento_consumir(bigint, bigint, text, text, text) from anon;
revoke all on function descuento_consumir(bigint, bigint, text, text, text) from authenticated;
grant execute on function descuento_consumir(bigint, bigint, text, text, text) to service_role;

-- DEFENSA EN PROFUNDIDAD (patrón 005/006/010): además del RLS, se le quitan a anon los GRANT que
-- Supabase da por default privileges. Aunque alguien apague el RLS desde el dashboard, la tabla
-- sigue invisible para la anon key.
revoke all on table discount_codes from anon, authenticated;
revoke all on sequence discount_codes_id_seq from anon, authenticated;
