-- ============================================================
-- Strange Catalog — Setup Supabase
-- Pega esto en: tu proyecto → SQL Editor → New query → Run
-- ============================================================

-- ─── TABLA: products ────────────────────────────────────────
create table if not exists products (
  id           bigint generated always as identity primary key,
  created_at   timestamptz default now(),
  gender       text check (gender in ('h','m')),
  brand        text,
  price        integer not null,
  price_before integer,
  promo        boolean default false,
  sold         boolean default false,
  img_url      text,
  imgs_360     text,
  imgs         text,
  modelo       text       -- nombre/SKU del modelo (ej. "Nike Air Max 90") — opcional
);

-- ─── TABLA: liq_products ────────────────────────────────────
create table if not exists liq_products (
  id           bigint generated always as identity primary key,
  created_at   timestamptz default now(),
  price        integer not null,
  price_before integer,
  sold         boolean default false,
  img_url      text,
  imgs_360     text,
  imgs         text,
  modelo       text       -- nombre/SKU del modelo (ej. "Nike Air Max 90") — opcional
);

-- ─── TABLA: settings ────────────────────────────────────────
create table if not exists settings (
  key   text primary key,
  value text
);

insert into settings (key, value) values
  ('promo_global', 'false'),
  ('banner_on',    'false'),
  ('store_name',   'Strange Sneakers'),
  ('wa',           '573122672336')
on conflict (key) do nothing;

-- ─── RLS: tablas principales ────────────────────────────────
alter table products     enable row level security;
alter table liq_products enable row level security;
alter table settings     enable row level security;

-- Anon: solo lectura. Escrituras solo desde service_role (via /api/admin)
drop policy if exists "anon all products"    on products;
drop policy if exists "anon read products"   on products;
drop policy if exists "service write products" on products;
create policy "anon read products"
  on products for select to anon using (true);
create policy "service write products"
  on products for all to service_role using (true) with check (true);

drop policy if exists "anon all liq"         on liq_products;
drop policy if exists "anon read liq"        on liq_products;
drop policy if exists "service write liq"    on liq_products;
create policy "anon read liq"
  on liq_products for select to anon using (true);
create policy "service write liq"
  on liq_products for all to service_role using (true) with check (true);

drop policy if exists "anon all settings"    on settings;
drop policy if exists "anon read settings"   on settings;
drop policy if exists "service write settings" on settings;
create policy "anon read settings"
  on settings for select to anon using (true);
create policy "service write settings"
  on settings for all to service_role using (true) with check (true);

-- ─── RLS: Storage (bucket product-images) ───────────────────
drop policy if exists "public read images"  on storage.objects;
drop policy if exists "anon upload images"  on storage.objects;
drop policy if exists "anon delete images"  on storage.objects;

create policy "public read images"
  on storage.objects for select
  using (bucket_id = 'product-images');

-- La subida de imágenes ya NO es anónima: va por /api/admin (action upload_image, service_role).
-- Sin policies de insert/delete anónimo: escribir en storage requiere service_role.

-- ─── TABLA: orders ──────────────────────────────────────────
create table if not exists orders (
  id         bigserial primary key,
  created_at timestamptz default now(),
  fecha      text,
  nombre     text,
  cedula     text,
  tel        text,
  ciudad     text,
  barrio     text,
  direccion  text,
  pago       text,
  subtotal   integer,
  envio      integer,
  total      integer,
  pares      integer,
  items      jsonb,
  status     text default 'pending',
  reference  text,
  utm        jsonb,
  referrer   text,
  seccion    text,
  session_id text,
  wa_status        text,   -- operador: sin_contactar | contactado | respondio | no_respondio
  temperatura      text,   -- operador: frio | tibio | caliente
  motivo_no_venta  text,   -- operador: por qué no compró
  nota             text    -- operador: nota interna del vendedor
);

alter table orders enable row level security;

-- Solo service_role escribe pedidos: el frontend pasa por /api/orders (recálculo + rate limit).
-- La policy de insert anónimo se eliminó (la anon key es pública → permitía ensuciar datos).
create policy "service all orders"
  on orders for all to service_role using (true) with check (true);

-- Migraciones idempotentes para instalaciones existentes
drop policy if exists "anon insert orders" on orders;
alter table products add column if not exists brand text;
alter table products add column if not exists imgs text;        -- galería: fotos secundarias (JSON array de URLs)
alter table liq_products add column if not exists imgs text;
alter table products add column if not exists modelo text;
alter table liq_products add column if not exists modelo text;

-- ─── TABLA: product_costs ───────────────────────────────────
-- Costo de adquisición por producto, SEPARADO de products: esa tabla la lee cualquier
-- visitante con la anon key (select *), y el costo NUNCA debe ser público.
-- Solo service_role (admin.js: list_costs / upsert_cost).
create table if not exists product_costs (
  ptype text not null check (ptype in ('cat','liq')),
  pid   bigint not null,
  costo integer not null check (costo >= 0),
  primary key (ptype, pid)
);
alter table product_costs enable row level security;
drop policy if exists "service all product_costs" on product_costs;
create policy "service all product_costs"
  on product_costs for all to service_role using (true) with check (true);
alter table orders add column if not exists subtotal integer;
alter table orders add column if not exists envio integer;
alter table orders add column if not exists session_id text;
alter table orders add column if not exists wa_status text;
alter table orders add column if not exists temperatura text;
alter table orders add column if not exists motivo_no_venta text;
alter table orders add column if not exists nota text;
alter table orders add column if not exists seguimiento date;   -- fecha de seguimiento del lead
alter table orders add column if not exists combo text;          -- id del combo mundialista aplicado (precio fijo validado server-side)
create index if not exists orders_reference_idx on orders(reference);
create index if not exists orders_session_status_idx on orders(session_id, status);
create index if not exists orders_status_created_idx on orders(status, created_at);

do $$
begin
  -- NOT VALID: aplica solo a filas nuevas — no falla si alguna fila histórica
  -- tiene un status/monto fuera de regla (la migración nunca debe romper producción).
  if not exists (select 1 from pg_constraint where conname = 'orders_status_allowed') then
    alter table orders add constraint orders_status_allowed
      check (status in ('pending','venta','no_venta','abandoned')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_amounts_nonnegative') then
    alter table orders add constraint orders_amounts_nonnegative
      check (coalesce(subtotal,0) >= 0 and coalesce(envio,0) >= 0 and coalesce(total,0) >= 0) not valid;
  end if;
end $$;

-- ─── TABLA: events ──────────────────────────────────────────
create table if not exists events (
  id           bigserial primary key,
  created_at   timestamptz default now(),
  session_id   text not null,
  type         text not null,
  product_id   text,
  price        integer,
  gender       text check (gender in ('h','m')),
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  referrer     text
);

alter table events enable row level security;

-- Solo service_role escribe eventos: el frontend pasa por /api/event (whitelist + rate limit).
create policy "service all events"
  on events for all to service_role using (true) with check (true);
-- Migración para instalaciones existentes (aquí y no arriba: la tabla debe existir primero)
drop policy if exists "anon insert events" on events;

-- ─── SUBSCRIBERS (popup de bienvenida $20.000 OFF) ───────────
-- Leads capturados por el popup. Se escribe/lee SOLO con service_role
-- (api/orders.js?kind=subscriber y api/catalog.js); RLS sin policy pública = el anon no ve datos personales.
create table if not exists subscribers (
  id         bigserial primary key,
  created_at timestamptz default now(),
  nombre     text,
  email      text,
  whatsapp   text,
  cumple     text,            -- YYYY-MM-DD, para promos de cumpleaños
  utm        jsonb,
  session_id text,
  source     text default 'popup_bienvenida'
);

alter table subscribers enable row level security;
-- (sin policies anon: solo service_role puede leer/escribir)
alter table subscribers add column if not exists email text;
create index if not exists subscribers_whatsapp_idx on subscribers(whatsapp);
create index if not exists subscribers_email_idx on subscribers(email);

-- ─── VERIFICACIÓN ───────────────────────────────────────────
select 'products'     as tabla, count(*) as filas from products
union all
select 'liq_products' as tabla, count(*) as filas from liq_products
union all
select 'settings'     as tabla, count(*) as filas from settings
union all
select 'orders'       as tabla, count(*) as filas from orders
union all
select 'events'       as tabla, count(*) as filas from events;
-- Resultado esperado: products=0, liq_products=0, settings=4, orders=0, events=0
