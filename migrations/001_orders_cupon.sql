-- 001 — Registrar el cupón usado en cada pedido (2026-06-24)
-- Por qué: hoy la orden no guarda qué cupón se usó → no se puede saber quién aprovechó
-- el descuento (BIENVENIDO20 / GRACIAS5). Esta columna lo registra de aquí en adelante.
-- El código (api/_orders.js) guarda el cupón SOLO cuando el descuento se aplicó de verdad
-- (desc > 0), así "cupon" en orders significa "usó el descuento".
-- Idempotente: seguro de correr varias veces.
alter table orders add column if not exists cupon text;
