-- 005 — Registro de los avisos que manda el bot (2026-07-31)
-- Por qué: los mensajes de Telegram se enviaban y se perdían. No quedaban en ningún lado, así que
-- era imposible responder "¿qué avisos llegaron?" o "¿este aviso salió o falló?". Peor: sendTelegram
-- se traga los errores (timeout de 2.5s, chat bloqueado, 4xx de la API) y devuelve false en silencio,
-- de modo que una venta podía confirmarse sin que el dueño se enterara y sin dejar rastro.
-- Ahora TODO lo que sale por sendTelegram queda aquí, con el resultado real del envío.
-- Idempotente: seguro de correr varias veces.
create table if not exists notificaciones (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  canal       text        not null default 'telegram',
  tipo        text,          -- 'venta' | 'reenvio_manual' | …
  order_id    bigint,        -- sin FK a propósito: un aviso nunca debe morir porque el pedido se borró
  reference   text,          -- STR-… para cruzar contra la pasarela sin joins
  texto       text not null, -- el mensaje EXACTO que se envió
  ok          boolean not null default false,
  error       text           -- por qué falló, cuando falló
);

-- Se consulta casi siempre por fecha ("los avisos de esta semana") o por pedido.
create index if not exists notificaciones_created_idx   on notificaciones (created_at desc);
create index if not exists notificaciones_reference_idx on notificaciones (reference);

-- ⚠️ SEGURIDAD: el texto lleva nombre, teléfono, cédula y dirección del cliente. RLS activo y
-- SIN políticas → nadie con la anon key puede leerlo; solo el service_role del servidor.
-- (Postgres deniega por defecto cuando RLS está activo y no hay política que permita.)
alter table notificaciones enable row level security;
