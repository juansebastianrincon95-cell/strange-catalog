-- 009 — El índice que le falta a la atribución (2026-08-04)
-- ⚠️ CORRER SOLA, y de preferencia fuera de hora pico.
--
-- Por qué: api/dashboard.js reconstruye la ruta de toques de cada venta con
--     .in('session_id', [...100 ids...]) + .gte/.lt('created_at') + .order('created_at')
-- y events NO tiene ningún índice por session_id: setup.sql solo creó events_created_idx,
-- events_type_created_idx y events_product_idx. Cada lote son 100 búsquedas sin índice, y el
-- filtro por fecha ayuda poco porque la ventana son 30 días de TODA la tabla.
-- Con el puente de identidad de Paylink entrando a la atribución, el número de sesiones
-- consultadas sube — esto deja de ser un lujo.
--
-- Compuesto (session_id, created_at) y no solo (session_id): un único índice sirve el filtro IN,
-- el rango de fechas Y el ORDER BY del mismo recorrido.
--
-- Si tu cliente SQL permite ejecutar FUERA de transacción, esta es la versión sin bloqueo:
--     create index concurrently if not exists events_session_created_idx
--       on events (session_id, created_at);
-- El SQL Editor de Supabase envuelve el script en una transacción y CONCURRENTLY falla ahí
-- (error 25001). La versión de abajo sí corre en el editor: bloquea las ESCRITURAS de events
-- mientras construye (segundos). Un insert de /api/event que espere no rompe ninguna venta: los
-- eventos son fire-and-forget y el checkout NO escribe en esta tabla.
set lock_timeout = '10s';
create index if not exists events_session_created_idx on events (session_id, created_at);
reset lock_timeout;

-- Bonus barato: el puente de identidad busca pedidos por teléfono para heredar la sesión.
-- Los `tel.eq.` de esa consulta sí aprovechan este índice (el `tel.like.*10dig` de respaldo no,
-- pero orders son ~5.000 filas estrechas).
create index if not exists orders_tel_idx on orders (tel);
