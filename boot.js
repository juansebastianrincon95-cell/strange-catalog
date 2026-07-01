/* ═══ BOOT ═══ Arranque: tracking inicial, carga de estado y catálogo, deep links,
   retornos de pago, popup. SIEMPRE el último script. ═══ */

// ═══ ARRANQUE LIGERO (SOLO app instalada / standalone) ═══
// En la PWA del admin no cargamos NI renderizamos la tienda (sin hero/grilla/imagenes/tracking):
// solo config + estado (datos que el panel lee) y abrimos el panel directo. Elimina el lag y la
// tienda nunca se pinta. En navegador normal (y ?admin en escritorio) el arranque sigue completo.
var _ssApp=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone;
if(_ssApp){
  loadConfig();
  (async()=>{
    try{await loadState();}catch(e){}   // pobla prods/liqs/combos/featuredIds/banners/testimonios que el panel necesita
    if(new URLSearchParams(location.search).has('admin'))history.replaceState(null,'',location.pathname);
    try{openAdmin();}catch(e){}         // panel directo (PIN solo la 1a vez; sesion persiste)
  })();
}else{

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
  if(typeof restoreCupon==='function')restoreCupon();   // recuperar el cupón aplicado (idem)
  if(bannerOn)$('banner').classList.remove('off');
  renderHero();   // carrusel del inicio (reemplaza el encabezado si hay banners)
  renderFeatured();    // sección "Últimos lanzamientos"
  renderColBanners();  // banners de colección Mujer/Hombre/Unisex
  renderGenRow('m');   // fila de variedad Mujer (tras banner Mujer)
  renderGenRow('h');   // fila de variedad Hombre (tras banner Hombre)
  renderFavoritos();   // pre-rellena la ventana de favoritos (#favModal)
  updFavDot();         // contador del corazón en el nav
  renderPreview();     // "Nuestros modelos"
  renderFooter();      // footer: redes + newsletter
  renderTestimonios(); // sección clientes felices
  renderCombos();      // tarjetas de combos mundialistas (sección Ofertas)
  renderComboBar();    // barra de progreso si hay combo activo de la sesión
  renderGrid();
  if(checkPedidoLink())return;   // ?pedido= → mostrar solo el pedido con fotos (link del vendedor)
  checkDeepLink();
  checkWompiReturn();
  checkBoldReturn();
  checkAddiReturn();   // retorno del checkout de Addi (crédito BNPL)
  checkSistecreditoReturn();   // retorno del checkout de Sistecrédito (crédito BNPL)
  maybeWelcome();   // popup de bienvenida ($20.000 OFF), una vez por visitante
  maybeWaBubble();  // mini-anuncio "pregunta por los combos" sobre el FAB de WhatsApp
})();

}
