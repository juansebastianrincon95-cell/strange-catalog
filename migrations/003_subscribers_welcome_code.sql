-- 003 — Cupón de bienvenida ÚNICO por suscriptor, de un solo uso (2026-07-29)
-- Por qué: BIENVENIDO20 era un código COMPARTIDO sin límite de usos — si alguien lo publicaba
-- en un grupo de WhatsApp/Facebook, cada uso ajeno eran $20.000. Ahora cada suscriptor recibe
-- BIENVENIDO20-XXXXX atado a su fila (welcome_code) y la venta lo marca gastado
-- (welcome_used_at). El genérico queda solo para los suscriptores viejos (welcome_code null),
-- identificados por tel/session al comprar. "Reactivar cupón" en el panel limpia welcome_used_at.
-- ⚠️ CORRER ANTES DEL DEPLOY: api/orders.js inserta welcome_code al registrar — sin la columna,
-- el registro del popup se rompe (mismo gotcha que orders.cupon en la 001).
-- Idempotente: seguro de correr varias veces.
alter table subscribers add column if not exists welcome_code text;            -- BIENVENIDO20-XXXXX (null = suscriptor de la era del genérico)
alter table subscribers add column if not exists welcome_used_at timestamptz;  -- cuándo se gastó (null = disponible)
-- Único: dos suscriptores jamás comparten código (el insert reintenta si colisiona).
create unique index if not exists subscribers_welcome_code_idx on subscribers(welcome_code);
