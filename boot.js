/* ═══ BOOT ═══ Arranque: tracking inicial, carga de estado y catálogo, deep links,
   retornos de pago, popup. SIEMPRE el último script. ═══ */

captureUTM();

captureReferrer();

trackEvent('page_view');

loadConfig();

loadViews();

// prueba social: traer vistas reales por producto
// Si quedó una reserva activa de una visita anterior, retomar el contador (guard: no duplicar timer)
if(localStorage.getItem('ss_reserve_until')&&!_reserveTimer){_reserveTimer=setInterval(tickReserva,1000);tickReserva();}

(async()=>{
  await loadState();
  if(typeof restoreCart==='function')restoreCart();   // recuperar carrito guardado (sobrevive refresh/cierre/regreso)
  if(bannerOn)$('banner').classList.remove('off');
  renderHero();   // carrusel del inicio (reemplaza el encabezado si hay banners)
  renderFeatured();    // sección "Últimos lanzamientos"
  renderColBanners();  // banners de colección Mujer/Hombre/Unisex
  renderPreview();     // preview de 2 columnas del inicio
  renderFooter();      // footer: redes + newsletter
  renderTestimonios(); // sección clientes felices
  renderCombos();      // tarjetas de combos mundialistas (sección Ofertas)
  renderComboBar();    // barra de progreso si hay combo activo de la sesión
  renderGrid();
  if(checkPedidoLink())return;   // ?pedido= → mostrar solo el pedido con fotos (link del vendedor)
  checkDeepLink();
  checkWompiReturn();
  checkBoldReturn();
  maybeWelcome();   // popup de bienvenida ($20.000 OFF), una vez por visitante
  maybeWaBubble();  // mini-anuncio "pregunta por los combos" sobre el FAB de WhatsApp
})();
