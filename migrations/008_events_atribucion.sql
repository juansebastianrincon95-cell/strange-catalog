-- 008 — Atribución observable: distinguir un CLIC de una revisita (2026-08-04)
--
-- Por qué: trackEvent (tracking.js) manda getUTM(), que lee ss_utm de localStorage. Ese valor no
-- se borra nunca, así que una revisita directa dos días después repite ÍNTEGRO el UTM del clic
-- anterior. Consecuencias medidas hoy en producción:
--   · "último clic no directo" es un ESPEJO de "último clic" (nunca hay tráfico directo que
--     ignorar, porque el directo es inobservable) → 1 de los 5 modelos es decorativo.
--   · el dedupe de toques consecutivos del dashboard tapa el ruido, pero de paso COLAPSA dos
--     clics reales seguidos a la misma campaña → el modelo lineal reparte mal.
--
-- utm_fresh responde una sola pregunta: "¿esta carga de página traía UTM/fbclid/gclid EN LA URL?".
-- Con eso, "clic" y "directo" pasan a ser HECHOS OBSERVABLES en vez de suposiciones.
--
-- ⚠️⚠️ NULLABLE Y SIN DEFAULT — A PROPÓSITO. Son TRES estados, no dos:
--     true  = la URL traía señal de clic        → CLIC REAL
--     false = la URL no traía nada              → revisita / tráfico directo
--     NULL  = evento anterior a esta migración  → NO SE SABE
-- api/dashboard.js trata NULL con el comportamiento de HOY (utm del evento + dedupe de
-- consecutivos). Si esta columna naciera con `default false`, TODO el histórico pasaría a
-- "Directo" de golpe y el panel de atribución se pondría en cero. NO PONER DEFAULT NUNCA.
--
-- src_app: ya se calcula en el front (tracking.js, detectSrcApp) y nunca se manda. Es la señal
-- más barata para ver de qué app llega el tráfico que termina cerrando por WhatsApp (71% de la
-- caja). Instagram/Facebook/Messenger/WhatsApp/TikTok se detectan por User-Agent del navegador
-- interno de cada app.
--
-- RLS: events ya la tiene activa con policy solo service_role (setup.sql). Añadir columnas no la
-- altera y anon sigue sin poder leer ni escribir.
-- Sin backfill: el dato empieza a existir el día del deploy del front. Idempotente.

-- ⚠️ lock_timeout (mismo motivo que la 007): añadir una columna nullable sin default es un cambio
-- SOLO de catálogo (microsegundos, no reescribe filas), pero pide ACCESS EXCLUSIVE. Si en ese
-- instante algo tiene events tomada (el pg_dump del backup automático de Supabase), el ALTER se
-- encola y se pone DELANTE de los inserts de /api/event. Con el timeout falla en 3s (55P03) y se
-- reintenta, en vez de atascar el tracking de toda la tienda.
set lock_timeout = '3s';
alter table events add column if not exists utm_fresh boolean;
alter table events add column if not exists src_app   text;
reset lock_timeout;

-- NOT VALID (patrón de la casa): valida las filas nuevas sin recorrer el histórico.
alter table events drop constraint if exists events_src_app_chk;
alter table events add constraint events_src_app_chk
  check (src_app is null or src_app in
    ('instagram','facebook','messenger','whatsapp','tiktok','google','web','directo')) not valid;
