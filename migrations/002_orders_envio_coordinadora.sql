-- 002 — Integración de envíos (Coordinadora) (2026-06-25)
-- Columnas para guardar la guía/recaudo/tracking de cada pedido al despacharlo.
-- Idempotente: seguro de correr varias veces.
alter table orders add column if not exists guia          text;    -- N° de guía de la transportadora
alter table orders add column if not exists tracking_url  text;    -- URL de rastreo para el cliente
alter table orders add column if not exists transportadora text;   -- 'coordinadora' (futuro: otras)
alter table orders add column if not exists estado_envio  text;    -- guia_generada | recogido | en_transito | entregado | devuelto
alter table orders add column if not exists recaudo       integer; -- monto a cobrar contra-entrega (0 = prepago)
