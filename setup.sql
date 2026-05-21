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

drop policy if exists "anon all products" on products;
create policy "anon all products"
  on products for all to anon using (true) with check (true);

drop policy if exists "anon all liq" on liq_products;
create policy "anon all liq"
  on liq_products for all to anon using (true) with check (true);

drop policy if exists "anon all settings" on settings;
create policy "anon all settings"
  on settings for all to anon using (true) with check (true);

-- ─── RLS: Storage (bucket product-images) ───────────────────
drop policy if exists "public read images"  on storage.objects;
drop policy if exists "anon upload images"  on storage.objects;
drop policy if exists "anon delete images"  on storage.objects;

create policy "public read images"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "anon upload images"
  on storage.objects for insert to anon
  with check (bucket_id = 'product-images');

create policy "anon delete images"
  on storage.objects for delete to anon
  using (bucket_id = 'product-images');

-- ─── VERIFICACIÓN ───────────────────────────────────────────
select 'products'     as tabla, count(*) as filas from products
union all
select 'liq_products' as tabla, count(*) as filas from liq_products
union all
select 'settings'     as tabla, count(*) as filas from settings;
-- Resultado esperado: products=0, liq_products=0, settings=4
