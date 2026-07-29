-- 004 — Pipeline de entrega manual (2026-07-29)
-- El negocio vende contra entrega: la venta solo es plata cuando el paquete llega. estado_envio
-- ya existe (migración 002); aquí van los sellos de fecha que pone /api/admin (update_order_meta)
-- al avanzar el estado, para poder medir tiempos de despacho y devoluciones por rango.
-- Idempotente: seguro de correr varias veces.
alter table orders add column if not exists despachado_at timestamptz; -- pasó a 'enviado' (el paquete salió)
alter table orders add column if not exists entregado_at  timestamptz; -- cierre: 'entregado' o 'devuelto' (en devuelto = cuando volvió)
