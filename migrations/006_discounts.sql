-- 006 — Motor de descuentos estilo Shopify (2026-08-02)
-- Por qué: hoy cada promoción es código nuevo + deploy (BIENVENIDO20, GRACIAS5 y los combos viven
-- quemados en el código), y la auditoría dejó abierto que el cupón es FARMEABLE: un código
-- compartido no tiene límite de usos ni control por cliente. Esta tabla replica los 4 tipos de
-- descuento de Shopify (monto/% sobre productos, compra X y obtén Y, monto/% sobre el pedido,
-- envío gratis) con: código vs automático, mínimos, límite total de usos, 1 uso por cliente,
-- combinación opt-in y vigencia desde/hasta. La VALIDACIÓN vive en api/_orders.js (server-side,
-- fail-closed); aquí solo viven los datos y el contador atómico.
-- Los cupones legacy (BIENVENIDO20/GRACIAS5) y los combos NO se migran: siguen dando exactamente
-- el mismo precio por su camino de siempre.
-- ⚠️ CORRER ANTES DEL DEPLOY del motor (mismo gotcha que orders.cupon en la 001): sin la tabla,
-- el motor simplemente no aplica ningún descuento nuevo (fail-closed), pero el panel no podrá crear.
-- Idempotente: seguro de correr varias veces.

create table if not exists discounts (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  codigo          text,                          -- null = descuento AUTOMÁTICO (aplica solo); con valor = el cliente lo teclea
  nombre          text not null default '',      -- etiqueta interna/visible ("Promo agosto")
  tipo            text not null default 'pedido',-- 'pedido' | 'producto' | 'bogo' | 'envio'
  valor_tipo      text not null default 'pct',   -- 'pct' (valor = 1..100) | 'fijo' (valor = pesos)
  valor           integer not null default 0,    -- para tipo 'envio' se ignora (el descuento ES el flete)
  aplica          jsonb,                         -- {ids:['cat_29','liq_5'], marcas:['nike']} — null/vacío = todos los productos (tipos producto/bogo)
  bogo            jsonb,                         -- {compra:2, lleva:1, pct:100} — compra X, lleva Y con pct% off (100 = gratis)
  min_monto       integer,                       -- mínimo de subtotal de producto (null = sin mínimo)
  min_items       integer,                       -- mínimo de pares en el carrito (null = sin mínimo)
  usos_max        integer,                       -- tope TOTAL de ventas confirmadas con este descuento (null = ilimitado)
  usos            integer not null default 0,    -- ventas confirmadas que lo usaron — lo sube SOLO descuento_consumir()
  uno_por_cliente boolean not null default true, -- un uso por cliente (clave: últimos 10 dígitos del teléfono)
  -- DESVÍO CONSCIENTE vs Shopify (decidido el 2026-08-03): Shopify tiene TRES reglas de
  -- combinación independientes (producto / pedido / envío) y cada descuento declara con cuáles
  -- se junta. Aquí es UN solo booleano: no combinable = aplica solo el que más descuente;
  -- combinable = se suma con los otros marcados. Cubre el caso real de esta tienda (una promo de
  -- precio O envío gratis) y evita una matriz que nadie va a configurar bien. Si algún día hace
  -- falta "este envío gratis sí acompaña promos de producto pero no de pedido", son 3 columnas.
  combinable      boolean not null default false,
  desde           timestamptz,                   -- null = vigente desde ya
  hasta           timestamptz,                   -- null = sin vencimiento
  activo          boolean not null default true
);

-- ⚠️ RLS AQUÍ MISMO, no al final del archivo: en Supabase toda tabla nueva del esquema public
-- nace con GRANT ALL para anon (default privileges), y lo ÚNICO que la tapa es el RLS. Si este
-- script se corriera partido (dos tandas, o abortado en la función de abajo), entre el create y
-- un enable al final habría una ventana en la que cualquiera con la anon key pública —que está
-- a la vista en base.js— podría INSERTAR un cupón del 100%. Pegado entero va en una transacción
-- implícita y la ventana no existe, pero no se deja la seguridad dependiendo de cómo se pegue.
alter table discounts enable row level security;

-- Checks NOT VALID (patrón de la casa: corren contra datos reales sin bloquear filas viejas).
alter table discounts drop constraint if exists discounts_tipo_chk;
alter table discounts add constraint discounts_tipo_chk
  check (tipo in ('pedido','producto','bogo','envio')) not valid;
alter table discounts drop constraint if exists discounts_valor_tipo_chk;
alter table discounts add constraint discounts_valor_tipo_chk
  check (valor_tipo in ('pct','fijo')) not valid;
alter table discounts drop constraint if exists discounts_valor_chk;
alter table discounts add constraint discounts_valor_chk
  check (valor >= 0) not valid;

-- Un código no puede existir dos veces (case-insensitive: el server siempre compara en MAYÚSCULAS).
-- Parcial: los automáticos (codigo null) no compiten entre sí.
create unique index if not exists discounts_codigo_idx on discounts (upper(codigo)) where codigo is not null;
create index if not exists discounts_activo_idx on discounts (activo) where activo = true;

-- ── Registro de QUIÉN usó QUÉ descuento ─────────────────────────────────────
-- Necesario para el "1 uso por cliente": el cliente se identifica por los ÚLTIMOS 10 DÍGITOS
-- del teléfono (la misma clave que usa el resto del sistema para cruzar pedidos/suscriptores).
-- Solo se escribe al CONFIRMAR la venta (descuento_consumir), nunca en un pedido 'pending' —
-- así nadie "gasta" usos de un código creando pedidos que jamás paga.
create table if not exists discount_usos (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  discount_id bigint not null,   -- sin FK a propósito (patrón notificaciones): el registro no muere si el descuento se borra
  order_id    bigint not null,   -- orders.id de la venta confirmada
  reference   text,              -- STR-… para auditar sin joins
  cliente     text               -- últimos 10 dígitos del teléfono (null si el pedido no traía tel)
);

alter table discount_usos enable row level security;   -- mismo motivo que arriba: pegado al create

-- El MISMO pedido jamás cuenta dos veces (webhook + cron + panel pueden confirmar en paralelo):
-- este índice único es el candado — descuento_consumir hace ON CONFLICT DO NOTHING sobre él.
create unique index if not exists discount_usos_orden_idx on discount_usos (discount_id, order_id);
-- La consulta caliente del "1 por cliente": ¿este teléfono ya usó este descuento?
create index if not exists discount_usos_cliente_idx on discount_usos (discount_id, cliente);

-- ── Consumo ATÓMICO de un uso (candado anti doble-conteo + contador sin carreras) ──
-- Por qué una función y no dos queries desde JS: supabase-js no puede hacer `usos = usos + 1`
-- como expresión — habría que leer y reescribir, y dos confirmaciones simultáneas perderían un
-- incremento (lost update). Aquí el INSERT dedupe por (discount_id, order_id) y el UPDATE
-- incrementa en una sola sentencia: ambas atómicas.
-- Devuelve true si contó el uso, false si ese pedido ya estaba contado (idempotente).
create or replace function descuento_consumir(
  p_discount_id bigint,
  p_order_id    bigint,
  p_reference   text,
  p_cliente     text
) returns boolean
language plpgsql
security definer
-- pg_temp al FINAL a propósito: con `search_path = public` Postgres sigue mirando pg_temp
-- primero para resolver nombres de tabla, y esta función referencia dos. Fijarlo último cierra
-- el secuestro por objetos temporales (es el endurecimiento estándar de un SECURITY DEFINER).
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into discount_usos (discount_id, order_id, reference, cliente)
  values (p_discount_id, p_order_id, p_reference, nullif(p_cliente, ''))
  on conflict (discount_id, order_id) do nothing;
  if not found then
    return false;   -- este pedido ya había consumido este descuento (webhook + cron, etc.)
  end if;
  -- El incremento es incondicional a propósito: si por una carrera de pedidos simultáneos se
  -- superó usos_max, el contador debe reflejar la realidad (el descuento YA se otorgó en una
  -- venta pagada); la validación en api/_orders.js deja de aceptar nuevos apenas usos >= usos_max.
  update discounts set usos = usos + 1 where id = p_discount_id;
  return true;
end;
$$;

-- La función es SECURITY DEFINER: que NADIE con la anon key pública pueda ejecutarla
-- (podría inflar contadores o quemar el 1-por-cliente de otros). Solo el servidor.
revoke all on function descuento_consumir(bigint, bigint, text, text) from public;
revoke all on function descuento_consumir(bigint, bigint, text, text) from anon;
revoke all on function descuento_consumir(bigint, bigint, text, text) from authenticated;
grant execute on function descuento_consumir(bigint, bigint, text, text) to service_role;

-- ⚠️ SEGURIDAD (patrón migración 005): el RLS ya quedó activo junto a cada create table, y sin
-- políticas → la anon key pública no puede leer ni escribir nada (ni enumerar códigos, ni ver
-- límites, ni inflar usos). Solo el service_role del servidor, que se salta RLS.
--
-- DEFENSA EN PROFUNDIDAD: además de RLS, se le quitan a anon los GRANT que Supabase le da por
-- default privileges a toda tabla nueva. Sin esto, un solo clic de "Disable RLS" en el dashboard
-- —o una policy futura mal escrita— dejaría la tabla abierta. Con esto, aunque el RLS se apague,
-- la tabla sigue siendo invisible para la anon key. El servidor usa service_role, no se afecta.
revoke all on table discounts, discount_usos from anon, authenticated;
revoke all on sequence discounts_id_seq, discount_usos_id_seq from anon, authenticated;
