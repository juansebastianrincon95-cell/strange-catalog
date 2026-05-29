-- ============================================================
-- Strange Catalog — Setup Supabase
-- Pega esto en: tu proyecto → SQL Editor → New query → Run
-- ============================================================

-- ─── TABLA: products ────────────────────────────────────────
create table if not exists products (
  id           bigint generated always as identity primary key,
  created_at   timestamptz default now(),
  gender       text check (gender in ('h','m')),
  price        integer not null,
  price_before integer,
  promo        boolean default false,
  sold         boolean default false,
  img_url      text,
  imgs_360     text
);

-- ─── TABLA: liq_products ────────────────────────────────────
create table if not exists liq_products (
  id           bigint generated always as identity primary key,
  created_at   timestamptz default now(),
  price        integer not null,
  price_before integer,
  sold         boolean default false,
  img_url      text,
  imgs_360     text
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

-- Subida de imágenes desde el browser (admin panel) — sigue siendo anon
create policy "anon upload images"
  on storage.objects for insert to anon
  with check (bucket_id = 'product-images');

-- Sin policy de delete anónimo: borrar imágenes requiere service_role

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
  total      integer,
  pares      integer,
  items      jsonb,
  status     text default 'pending',
  reference  text,
  utm        jsonb,
  referrer   text,
  seccion    text
);

alter table orders enable row level security;

create policy "anon insert orders"
  on orders for insert to anon with check (true);
create policy "service all orders"
  on orders for all to service_role using (true) with check (true);

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

create policy "anon insert events"
  on events for insert to anon with check (true);
create policy "service all events"
  on events for all to service_role using (true) with check (true);

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
