/* ═══ TIENDA ═══ Todo el render público: home, hero, lanzamientos, catálogo, ficha,
   galería, testimonios, footer, popup, menú, info. ═══ */

/* ── POPUP DE BIENVENIDA ($20.000 OFF) ── */
let WELCOME_ON=true;

// se sobreescribe desde settings (welcome_popup)
const WELCOME_CODE='BIENVENIDO20';

// Fallback visual: el código REAL es único por suscriptor (BIENVENIDO20-XXXXX) y lo entrega
// el servidor al registrarse (ss_wm_code). Debe coincidir con CUPONES y api/orders.js.
let _wmOpen=false;

let _wmShownTracked=false;

// popup_shown: 1 vez por visita (mide tasa popup→registro)
function openWelcome(){const m=$('welcomeModal');if(m)m.classList.add('on');if(!_wmOpen){_wmOpen=true;lockScroll();}const t=$('wmReopen');if(t)t.classList.remove('show');
  if(!_wmShownTracked){_wmShownTracked=true;trackEvent('popup_shown');}}

// Cerrar NO marca "visto": si no dejó sus datos, queda el tag anclado abajo para reabrirlo.
function closeWelcome(){const m=$('welcomeModal');if(m)m.classList.remove('on');if(_wmOpen){_wmOpen=false;unlockScroll();}
  if(!localStorage.getItem('ss_subscribed')){const t=$('wmReopen');if(t)t.classList.add('show');}}

// Aparece en cada visita HASTA que el cliente se registre (ss_subscribed). Si está activo y sin otro modal abierto.
// Delay 7s (benchmark 5-10s): que la persona vea producto antes de interrumpir — 2.2s era agresivo.
function maybeWelcome(){
  if(!WELCOME_ON)return;
  if(localStorage.getItem('ss_subscribed'))return;
  setTimeout(()=>{
    if(localStorage.getItem('ss_subscribed'))return;
    const open=document.querySelector('.photo-modal.on,.guia-modal.on,.csheet.on,.apanel.on');
    if(open)return;   // no interrumpir si el usuario ya está en otra cosa (deep link, etc.)
    openWelcome();
  },7000);
}

// Vigencia del código de bienvenida: 7 días desde el registro (ss_welcome_ts).
// Sin timestamp local (registro viejo o de otro dispositivo) no bloquea: el server valida contra la BD.
const WELCOME_DIAS=7;

function welcomeVencido(){
  const ts=parseInt(localStorage.getItem('ss_welcome_ts')||'0',10);
  return !!ts&&(Date.now()-ts)>WELCOME_DIAS*24*60*60*1000;
}

// Suscriptores previos a la vigencia: su reloj de 7 días arranca hoy (no tenían timestamp).
if(localStorage.getItem('ss_subscribed')&&!localStorage.getItem('ss_welcome_ts'))localStorage.setItem('ss_welcome_ts',String(Date.now()));

function submitWelcome(){
  const nombre=($('wmNombre').value||'').trim();
  const whatsapp=($('wmWa').value||'').replace(/\D/g,'');
  const err=$('wmErr');
  if(!nombre||whatsapp.length<7){
    if(err){err.textContent='Completa tu nombre y WhatsApp 🙏';err.classList.add('show');}
    return;
  }
  if(err)err.classList.remove('show');
  const btn=$('wmBtn');if(btn){btn.disabled=true;btn.textContent='Enviando…';}
  fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind:'subscriber',nombre,whatsapp,utm:{...getUTM(),...getFbAttribution(),...getVisitCtx()},session_id:SESSION_ID})})
    .then(r=>r.ok?r.json():Promise.reject(new Error('http')))
    .then(j=>{
      const code=(j&&j.codigo)||WELCOME_CODE;
      localStorage.setItem('ss_subscribed','1');   // ya se registró → el popup no vuelve a aparecer
      localStorage.setItem('ss_welcome_ts',String(Date.now()));   // arranca el reloj de 7 días del código
      localStorage.setItem('ss_wm_code',code);     // su código ÚNICO: si luego teclea el genérico en el carrito, se sube al suyo
      localStorage.setItem('ss_wm_wa',whatsapp);   // para el paso 2 (chips talla/género → update)
      {const t=$('wmReopen');if(t)t.classList.remove('show');}   // ya no se necesita el tag de reapertura
      const cEl=$('wmCode');if(cEl)cEl.textContent=code;
      $('wmForm').style.display='none';$('wmOk').style.display='block';
      if(typeof px==='function')px('Lead',{content_name:'popup_bienvenida',...getUTM()},SESSION_ID+'_subscribe');
      trackEvent('lead',{});
    })
    .catch(()=>{if(btn){btn.disabled=false;btn.textContent='Quiero mi descuento';}if(err){err.textContent='No se pudo enviar, revisa tu conexión y reintenta.';err.classList.add('show');}});
}

// Paso 2 (zero-party data): chips de talla/género en la pantalla de éxito. Un clic = update
// silencioso del suscriptor (por WhatsApp o session_id). Si no responde, el registro ya quedó.
function wmPref(kind,val,el){
  if(el&&el.parentElement)el.parentElement.querySelectorAll('.wm-chip').forEach(b=>b.classList.toggle('sel',b===el));
  const wa=localStorage.getItem('ss_wm_wa')||'';
  const body={kind:'subscriber',update:1,whatsapp:wa,session_id:SESSION_ID};
  body[kind]=val;
  fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(()=>{});
}

function copyWelcomeCode(){
  const code=($('wmCode').textContent||WELCOME_CODE).trim();
  const done=()=>{const b=document.querySelector('.wm-copy');if(b){const t=b.textContent;b.textContent='¡Copiado!';setTimeout(()=>b.textContent=t,1600);}};
  if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(code).then(done).catch(done);
  else done();
}

/* ── HERO CARRUSEL ── */
let heroSlides=[];

// [{img,img_desktop,titulo,subtitulo,pos}] desde settings.hero_slides
let heroCur=0,_heroTimer=null,_heroTouchX=null;

function renderHero(){
  const hero=$('hero'),track=$('heroTrack'),dots=$('heroDots'),hdr=document.querySelector('.hdr');
  if(!hero||!track)return;
  const slides=Array.isArray(heroSlides)?heroSlides.filter(s=>s&&s.img):[];
  if(!slides.length){                         // sin banners → fallback al encabezado clásico
    hero.classList.remove('on');
    if(hdr)hdr.style.display='';
    if(_heroTimer){clearInterval(_heroTimer);_heroTimer=null;}
    return;
  }
  if(hdr)hdr.style.display='none';             // el carrusel reemplaza el encabezado
  hero.classList.add('on');
  const posMap={top:'18%',center:'50%',bottom:'82%'};
  // CTA por slide: TODOS los botones llevan a la sección OFERTAS (los combos).
  // Solo cambia el texto: slide 1 "Ver ofertas", los demás "¡Comprar ya!".
  track.innerHTML=slides.map((s,i)=>`<div class="hero-slide"><picture>${s.img_desktop?`<source media="(min-width:700px)" srcset="${escHtml(s.img_desktop)}">`:''}<img src="${escHtml(s.img)}" alt="${escHtml(s.titulo)}" loading="lazy" style="--pos:${posMap[s.pos]||'50%'}"></picture><div class="hero-ov">${s.titulo?`<div class="hero-tit">${escHtml(s.titulo)}</div>`:''}${s.subtitulo?`<div class="hero-sub">${escHtml(s.subtitulo)}</div>`:''}<button class="hero-cta" onclick="openCatalog({gender:'liq'})">${i===0?'Ver ofertas':'¡Comprar ya!'}</button></div></div>`).join('');
  dots.innerHTML=slides.length>1?slides.map((_,i)=>`<span class="hero-dot${i===0?' on':''}" onclick="heroGoStop(${i})"></span>`).join(''):'';
  heroCur=0;heroApply();
  if(_heroTimer)clearInterval(_heroTimer);
  if(slides.length>1)_heroTimer=setInterval(()=>heroGo(heroCur+1),5000);
  // swipe táctil (una sola vez)
  if(!track._heroBound){
    track._heroBound=true;
    track.addEventListener('touchstart',e=>{_heroTouchX=e.touches[0].clientX;},{passive:true});
    track.addEventListener('touchend',e=>{
      if(_heroTouchX==null)return;
      const dx=e.changedTouches[0].clientX-_heroTouchX;_heroTouchX=null;
      if(Math.abs(dx)>40)heroGoStop(heroCur+(dx<0?1:-1));
    },{passive:true});
  }
}

function heroApply(){
  const track=$('heroTrack'),n=(heroSlides||[]).filter(s=>s&&s.img).length;
  if(!track||!n)return;
  heroCur=((heroCur%n)+n)%n;                   // circular
  track.style.transform=`translateX(${-heroCur*100}%)`;
  document.querySelectorAll('#heroDots .hero-dot').forEach((d,i)=>d.classList.toggle('on',i===heroCur));
}

function heroGo(i){heroCur=i;heroApply();}

function heroGoStop(i){heroGo(i);if(_heroTimer){clearInterval(_heroTimer);_heroTimer=setInterval(()=>heroGo(heroCur+1),5000);}}

/* Editar un slide EXISTENTE: reemplazar imagen móvil/escritorio o el texto, sin borrarlo */
let _heroEdit=null;

/* ── ÚLTIMOS LANZAMIENTOS (curado por producto, selector VISUAL) ──
   El admin TOCA las fotos de sus productos (con modelo, #id y precio) para destacarlas (máx 10).
   En el inicio se ven como tarjetas de producto; al tocar la tarjeta (o el +) el cliente va
   DIRECTO a la ficha del zapato. */
let featuredIds=[];

// settings.featured_ids (orden = orden de aparición)
const LANZ_MAX=10;

function genLabel(g){return g==='h'?'Hombre':g==='u'?'Unisex':'Mujer';}
function prodLabel(p){return genLabel(p.g)+' · '+(BRAND_LABELS[p.brand]||'—')+' · '+fmt(p.price)+' (#'+p.id+')';}

function renderFeatured(){
  const sec=$('lanz'),row=$('lanzRow');if(!row)return;
  computeBadges();
  const items=featuredIds.map(id=>prods.find(p=>p.id===id)).filter(p=>p&&!p.sold);
  if(!items.length){if(sec)sec.style.display='none';row.innerHTML='';carAutoStop(row);return;}
  if(sec)sec.style.display='';
  row.innerHTML=items.map((p,i)=>cardHTML(p,i,'kl',true)).join('');
  row._prevBtn=$('lanzPrev');row._nextBtn=$('lanzNext');
  carSetup(row);
}

/* ── CARRUSEL REUSABLE ── giro CIRCULAR real (clones) + auto-rotación cada 4s. Lo usan
   "Últimos lanzamientos" Y las filas de Colección Mujer/Hombre — todas con el MISMO motor y tamaño.
   Estado por-fila en row._car (varios carruseles independientes). Flechas opcionales en
   row._prevBtn / row._nextBtn. Técnica de CLONES: se duplican tarjetas en los extremos y, cuando el
   snap reposa en zona clonada, se salta instantáneo a la equivalente real (layout uniforme → imperceptible). */
function carStep(row){const c=row&&row.querySelector('.card');return c?c.getBoundingClientRect().width+(parseFloat(getComputedStyle(row).columnGap)||10):220;}
function carOverflow(row){return !!row&&row.scrollWidth>row.clientWidth+4;}

function carSetup(row){
  if(!row)return;
  row.querySelectorAll('.lanz-clone').forEach(c=>c.remove());   // idempotente (resize re-ejecuta)
  const st=row._car||(row._car={timer:null,L:0,home:0,wrapAt:0});
  st.L=0;
  const reales=[...row.querySelectorAll('.card')];
  const ov=carOverflow(row);
  row.classList.toggle('centered',!ov);
  if(row._prevBtn)row._prevBtn.classList.toggle('show',ov);
  if(row._nextBtn)row._nextBtn.classList.toggle('show',ov);
  carAutoStop(row);
  if(!ov)return;
  const M=reales.length,P=Math.min(M,Math.ceil(row.clientWidth/carStep(row)));
  const clon=c=>{const k=c.cloneNode(true);k.classList.add('lanz-clone');k.removeAttribute('id');k.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));return k;};
  for(let i=0;i<P;i++){
    row.insertBefore(clon(reales[M-P+i]),row.children[i]);   // últimos P al frente (en orden)
    row.appendChild(clon(reales[i]));                        // primeros P al final
  }
  const apFirst=row.children[P+M];
  st.home=reales[0].offsetLeft;
  st.wrapAt=apFirst.offsetLeft;
  st.L=apFirst.offsetLeft-reales[0].offsetLeft;
  row.scrollLeft=st.home;
  if(!row._carPause){   // listeners una sola vez por elemento
    row._carPause=true;
    row.addEventListener('pointerdown',()=>{carAutoStop(row);clearTimeout(row._carRe);row._carRe=setTimeout(()=>{if(carOverflow(row))carAutoStart(row);},6000);},{passive:true});
    row.addEventListener('scroll',()=>{clearTimeout(row._carFix);row._carFix=setTimeout(()=>carLoopFix(row),250);},{passive:true});
  }
  carAutoStart(row);
}

function carLoopFix(row){   // si el reposo cayó en zona clonada, saltar a la tarjeta real equivalente
  const st=row&&row._car;if(!row||!st||!st.L||!carOverflow(row))return;
  if(row.scrollLeft>=st.wrapAt-1)row.scrollLeft-=st.L;
  else if(row.scrollLeft<st.home-1)row.scrollLeft+=st.L;
}

function carNav(row,dir){
  if(!row)return;
  carLoopFix(row);   // si está en zona clonada, reubicar antes de avanzar
  row.scrollBy({left:dir*carStep(row),behavior:'smooth'});
  const st=row._car;if(st&&st.timer){carAutoStop(row);carAutoStart(row);}   // interactuar reinicia el ritmo
}

function carAutoStart(row){const st=row&&row._car;if(!st||st.timer)return;st.timer=setInterval(()=>{if(document.hidden)return;carNav(row,1);},3500);}
function carAutoStop(row){const st=row&&row._car;if(st&&st.timer){clearInterval(st.timer);st.timer=null;}}

// Compat: las flechas de "Últimos lanzamientos" en index.html llaman lanzNav().
function lanzNav(dir){carNav($('lanzRow'),dir);}

// Re-arma TODOS los carruseles al cambiar el tamaño de ventana.
function setupAllCarousels(){['lanzRow','genMRow','genHRow'].forEach(id=>{const r=$(id);if(r&&r.querySelector('.card'))carSetup(r);});}
// Solo re-armar si cambió el ANCHO. En móvil el scroll dispara 'resize' (la barra de URL aparece/
// desaparece y cambia la ALTURA); re-armar ahí reseteaba los carruseles a la primera tarjeta.
let _carLastW=window.innerWidth;
window.addEventListener('resize',()=>{
  if(window.innerWidth===_carLastW)return;   // cambio de solo altura (barra URL móvil) -> ignorar
  _carLastW=window.innerWidth;
  clearTimeout(window._carRz);window._carRz=setTimeout(setupAllCarousels,200);
});

/* ── BANNERS DE COLECCIÓN (Mujer/Hombre/Unisex) ── */
let bannerMujer=null, bannerHombre=null, bannerUnisex=null;

function colBannerHTML(b,g){
  const posMap={top:'18%',center:'50%',bottom:'82%'};   // legacy por palabra; ahora pos puede ser número (%)
  const _n=parseFloat(b.pos);
  const pos=isFinite(_n)?_n+'%':(posMap[b.pos]||'50%');
  return `<picture>${b.img_desktop?`<source media="(min-width:700px)" srcset="${escHtml(b.img_desktop)}">`:''}<img src="${escHtml(b.img)}" alt="${escHtml(b.titulo||'')}" loading="lazy" style="--pos:${pos}"></picture><div class="hero-ov">${b.titulo?`<div class="hero-tit">${escHtml(b.titulo)}</div>`:''}${b.subtitulo?`<div class="hero-sub">${escHtml(b.subtitulo)}</div>`:''}<button class="hero-cta" onclick="colCTA('${g}')">Comprar ahora</button></div>`;
}

function renderColBanners(){
  const set=(el,b,g)=>{if(!el)return; if(b&&b.img){el.innerHTML=colBannerHTML(b,g);el.style.display='';}else{el.style.display='none';el.innerHTML='';}};
  set($('bannerM'),bannerMujer,'m');
  set($('bannerH'),bannerHombre,'h');
  set($('bannerU'),bannerUnisex,'u');
}

// Los banners abren el catálogo (vista aparte) filtrado por su género.
function colCTA(g){ openCatalog({gender: g==='m'?'m' : g==='h'?'h' : g==='u'?'u' : 'all'}); }

function openCatalog(opts){
  opts=opts||{};
  _searchQ='';{const _si=$('catSearchInput');if(_si)_si.value='';const _sx=$('catSearchX');if(_sx)_sx.style.display='none';}
  _sortBy='';{const _so=$('catSort');if(_so)_so.value='';}
  const v=$('catView');if(!v)return;
  // Mismo motivo que en la ficha: navPush('cat') deduplica, así que un bloqueo por capa.
  {const _ya=v.classList.contains('on');v.classList.add('on');if(!_ya)lockScroll();}
  const tabs=document.querySelectorAll('#catView .tabs .tab');
  if(opts.coleccion&&coleccionDe(opts.coleccion)){
    gSel='all';brandSel='all';colSel=opts.coleccion;
    tabs.forEach((t,i)=>t.classList.toggle('on',i===0));
    renderGrid();
  }else if(opts.brand){
    gSel='all';brandSel=opts.brand;colSel=null;
    tabs.forEach((t,i)=>t.classList.toggle('on',i===0));
    renderGrid();
  }else{
    colSel=null;
    const g=opts.gender||'all';
    const idx=g==='h'?1:g==='m'?2:g==='u'?3:g==='liq'?4:0;
    setG(g, tabs[idx]);   // setG hace renderGrid
  }
  // Título del catálogo según la sección (las pestañas están ocultas).
  const tt=v.querySelector('.catview-title');
  let _ct='Catálogo';
  if(tt){
    const map={h:'Hombre',m:'Mujer',u:'Unisex',liq:'Ofertas',all:'Productos'};
    const _c=colSel?coleccionDe(colSel):null;
    tt.textContent = _c ? (_c.nombre||_c.slug)
                    : opts.brand ? (typeof BRAND_LABELS!=='undefined' && BRAND_LABELS[opts.brand] ? BRAND_LABELS[opts.brand] : 'Productos')
                    : (map[opts.gender||'all']||'Catálogo');
    _ct=tt.textContent;
  }
  v.scrollTop=0;
  navPush('cat',navCatUrl(),_ct+' — '+STORE_NAME,closeCatalog);
}

function closeCatalog(){if(!_navPopping)navRemove('cat');const v=$('catView');if(v)v.classList.remove('on');unlockScroll();}

/* ── ORDENAR POR (catálogo) ── '' = relevancia (orden actual), price_asc, price_desc, new, views ── */
let _sortBy='';
function setSort(v){_sortBy=v;if(typeof renderGrid==='function')renderGrid();}

/* ── BUSCADOR de productos (filtra por modelo/marca dentro del catálogo) ── */
let _searchQ='';
function buscarProductos(q){
  _searchQ=(q||'').trim().toLowerCase();
  const x=$('catSearchX');if(x)x.style.display=_searchQ?'flex':'none';
  if(typeof renderGrid==='function')renderGrid();
}
function limpiarBusqueda(){
  const i=$('catSearchInput');if(i)i.value='';
  _searchQ='';const x=$('catSearchX');if(x)x.style.display='none';
  if(typeof renderGrid==='function')renderGrid();
}

/* ── MENÚ MÓVIL (panel lateral ☰) ── */
function openMenu(){const d=$('navDrawer');if(!d)return;d.classList.add('on');lockScroll();navPush('menu',null,null,closeMenu);}

function closeMenu(){if(!_navPopping)navRemove('menu');const d=$('navDrawer');if(!d)return;d.classList.remove('on');unlockScroll();}

function navGo(t){
  closeMenu();
  if(t==='h')openCatalog({gender:'h'});
  else if(t==='m')openCatalog({gender:'m'});
  else if(t==='u')openCatalog({gender:'u'});
  else if(t==='liq')openCatalog({gender:'liq'});
  else if(t==='envios')openInfo('envios');
  else if(t==='mayoristas')openInfo('mayoristas');
  else if(t==='cambios')openInfo('cambios');
  else if(t==='quienes')openInfo('quienes');
  else openCatalog();   // Productos → todos
}

/* ── VENTANAS INFO (Mayoristas / Cambios y Garantías) ── reusan el modal .guia-modal ── */
const INFO_MAYORISTAS=`<div class="info-pad">
  <h2 class="info-h1">Gana hasta un <span class="big">46%</span> de rentabilidad</h2>
  <p class="info-lead">Vende sneakers importados y genera ingresos extra con nosotros. Te acompañamos en todo el proceso.</p>
  <div class="info-subt">Beneficios de ser mayorista</div>
  <div class="info-benes">
    <div class="info-bene">✅ Precios especiales de mayorista</div>
    <div class="info-bene">✅ Material listo para publicar (fotos y videos)</div>
    <div class="info-bene">✅ Catálogo siempre actualizado</div>
    <div class="info-bene">✅ Asesoría directa por WhatsApp</div>
    <div class="info-bene">✅ Envíos a toda Colombia</div>
    <div class="info-bene">✅ Vende sin inventario (te despachamos directo a tu cliente)</div>
  </div>
  <button class="info-wa" onclick="waMayoristas()">💬 Más información por WhatsApp</button>
</div>`;

const INFO_CAMBIOS=`<div class="info-pad">
  <p class="info-lead" style="margin-top:0">Tu compra está protegida. Estas son nuestras condiciones de cambios y garantía 👇</p>
  <div class="info-grid">
  <div class="info-sec"><h3>👟 Solo cambios por talla</h3><p>Si te equivocaste, los costos de envío van por tu cuenta. Si es defecto de fábrica 👉 ¡nosotros lo cubrimos! ✅</p></div>
  <div class="info-sec"><h3>⏳ Tiempo para solicitar cambio</h3><p>Tienes 2 días hábiles después de recibir tu pedido. Pasado este tiempo no podremos hacer el cambio.</p></div>
  <div class="info-sec"><h3>📦 Condiciones del producto</h3><p>Devuélvelos en la misma bolsa. Deben estar en perfecto estado (sin manchas, ni uso).</p></div>
  <div class="info-sec"><h3>💸 Importante</h3><p>No hacemos devoluciones de dinero, ni cancelación de créditos. Si la talla no está disponible, podrás elegir entre otros modelos.</p></div>
  <div class="info-sec"><h3>🕐 Proceso</h3><p>El cambio puede tardar 15 días hábiles aproximadamente.</p></div>
  <div class="info-sec"><h3>✅ Garantía</h3><p>Tu compra tiene 1 mes de garantía por defectos de costura o despegue. En este caso, el cambio será sin costo adicional.</p></div>
  </div>
</div>`;

/* Condiciones del envío. Existe porque la barra superior promete "ENVÍO GRATIS" y eso es cierto
   SOLO pagando por adelantado: contra entrega cobra flete (calcFlete). Decirlo aquí, con el monto,
   es lo que exige el Estatuto del Consumidor (Ley 1480) sobre publicidad con condiciones. */
const INFO_ENVIOS=`<div class="info-pad">
  <p class="info-lead" style="margin-top:0">Enviamos a toda Colombia. Así funciona el costo del envío 👇</p>
  <div class="info-grid">
  <div class="info-sec"><h3>✅ Envío GRATIS pagando por adelantado</h3><p>Si pagas en línea (Wompi, Bold, Addi o Sistecrédito) o coordinas el pago por WhatsApp, el envío no te cuesta nada: el precio que ves es el precio final.</p></div>
  <div class="info-sec"><h3>📦 Contra entrega: el envío se paga primero</h3><p>Si prefieres pagar los zapatos al recibirlos, el envío sí tiene costo y se paga por adelantado. El valor depende de <b>tu ciudad y el número de pares</b> — lo ves exacto en el checkout antes de confirmar tu pedido. Los zapatos los pagas cuando lleguen a tu casa.</p></div>
  <div class="info-sec"><h3>💡 ¿Por qué cobramos el envío contra entrega?</h3><p>Para asegurar que tu pedido salga y llegue. Así evitamos los pedidos que se piden y nadie recibe, que encarecen los precios para todos.</p></div>
  <div class="info-sec"><h3>🕐 Tiempos de entrega</h3><p>Entre 2 y 5 días hábiles según la ciudad. Te avisamos por WhatsApp cuando tu pedido salga, con el número de guía para que lo rastrees.</p></div>
  <div class="info-sec"><h3>🏠 Hasta la puerta de tu casa</h3><p>La transportadora entrega en la dirección que nos indiques. Asegúrate de que haya alguien para recibir el pedido.</p></div>
  </div>
</div>`;

const INFO_QUIENES=`<div class="info-pad">
  <h2 class="info-h1">Somos <span class="big">Strange Sneakers</span></h2>
  <p class="info-lead">Una tienda colombiana hecha por amantes de los sneakers. Traemos los modelos que quieres a un precio justo y, sobre todo, con la confianza de comprar sin riesgo.</p>
  <div class="info-subt">Por qué comprarnos</div>
  <div class="info-benes">
    <div class="info-bene">🚚 Envío GRATIS pagando en línea</div>
    <div class="info-bene">📦 Pago contra entrega — pagas al recibir</div>
    <div class="info-bene">🔄 Cambios por talla fáciles</div>
    <div class="info-bene">🛡️ 1 mes de garantía</div>
    <div class="info-bene">💳 Paga a cuotas con Addi y Sistecrédito</div>
    <div class="info-bene">💬 Atención real por WhatsApp</div>
  </div>
  <div class="info-subt">Nuestro compromiso</div>
  <p class="info-lead">Revisamos cada par antes de enviarlo. Queremos que estrenes tranquilo: si algo no está bien, lo resolvemos. <b>Tu estilo. Tu par.</b> 👟</p>
  <button class="info-wa" onclick="waHola()">💬 Escríbenos por WhatsApp</button>
</div>`;
function waHola(){
  try{trackEvent('lead',{});}catch(e){}
  if(typeof px==='function')px('Lead',{content_name:'quienes_somos',...getUTM()});
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent('Hola '+STORE_NAME+' 👋, quiero más información sobre sus sneakers')}`,'_blank');
}

function openInfo(which){
  const b=$('infoBody');if(!b)return;
  const INFO={mayoristas:[INFO_MAYORISTAS,'Mayoristas','/mayoristas'],cambios:[INFO_CAMBIOS,'Cambios y Garantías','/cambios'],quienes:[INFO_QUIENES,'Quiénes somos','/quienes'],envios:[INFO_ENVIOS,'Condiciones de envío','/envios']};
  const cfg=INFO[which]||INFO.cambios;
  b.innerHTML=cfg[0];
  const t=$('infoTitle');if(t)t.textContent=cfg[1];
  const m=$('infoModal');{const _ya=m.classList.contains('on');m.classList.add('on');if(!_ya)lockScroll();}   // un bloqueo por capa (navPush deduplica)
  const sc=m.querySelector('.info-scroll');if(sc)sc.scrollTop=0;
  navPush('info',cfg[2],cfg[1]+' — '+STORE_NAME,closeInfo);
}

function closeInfo(){if(!_navPopping)navRemove('info');const m=$('infoModal');if(m)m.classList.remove('on');unlockScroll();}

function waMayoristas(){
  const msg=`Hola ${STORE_NAME}, quiero ser mayorista. ¿Me puedes enviar precios, condiciones y catálogo disponible?`;
  try{trackEvent('lead',{});}catch(e){}
  if(typeof px==='function')px('Lead',{content_name:'mayoristas',...getUTM()});
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');
}

/* ── CABECERA AUTO-OCULTABLE (estilo Adidas) ── se oculta al bajar, reaparece al subir ── */
(function(){
  const bar=document.getElementById('topbar');
  if(!bar)return;
  let lastY=window.scrollY||0, ticking=false;
  const TH=6;   // umbral para ignorar micro-scrolls
  function update(){
    const y=window.scrollY||document.documentElement.scrollTop||0;
    if(y<=2){ bar.classList.remove('hide'); }                         // arriba del todo: siempre visible
    else if(Math.abs(y-lastY)>TH){
      if(y>lastY && y>bar.offsetHeight) bar.classList.add('hide');    // bajando → ocultar
      else bar.classList.remove('hide');                              // subiendo → mostrar
    }
    lastY=y; ticking=false;
  }
  window.addEventListener('scroll',()=>{ if(!ticking){ requestAnimationFrame(update); ticking=true; } },{passive:true});
})();

// Preview del inicio: 6 modelos disponibles más recientes (prods viene ordenado por id asc).
function renderPreview(){
  const sec=$('preview'),grid=$('previewGrid');if(!grid)return;
  computeBadges();
  const items=prods.filter(p=>!p.sold).slice(-8).reverse();   // 8 en escritorio; móvil oculta 7º/8º (CSS)
  if(!items.length){if(sec)sec.style.display='none';grid.innerHTML='';return;}
  if(sec)sec.style.display='';
  grid.innerHTML=items.map((p,i)=>cardHTML(p,i,'kp')).join('');
}

/* ── FILAS DE VARIEDAD POR GÉNERO (inicio) ── fila scrolleable con ~12 modelos del género
   (los más recientes), estilo "Últimos lanzamientos"; "Ver todo →" abre el catálogo filtrado.
   Muestra curada (no todo el inventario): menos fatiga de decisión + curiosidad → mejor retención. */
function renderGenRow(g){
  const sec=$(g==='m'?'genM':'genH'), row=$(g==='m'?'genMRow':'genHRow');
  if(!row)return;
  computeBadges();
  const items=prods.filter(p=>p.g===g&&!p.sold).slice(-12).reverse();
  if(!items.length){if(sec)sec.style.display='none';row.innerHTML='';carAutoStop(row);return;}
  if(sec)sec.style.display='';
  row.innerHTML=items.map((p,i)=>cardHTML(p,i,g==='m'?'kgm':'kgh',true)).join('');
  row._prevBtn=$(g==='m'?'genMPrev':'genHPrev');row._nextBtn=$(g==='m'?'genMNext':'genHNext');
  carSetup(row);   // mismo carrusel que "Últimos lanzamientos" (se corre solo)
}

/* ── FOOTER (redes sociales + newsletter) ── */
let socials={ig:'',tiktok:'',fb:''};
let sizeGuide=null;   // {img1,img2} de marquillas para la guía de tallas (lo sube el admin)

// settings.socials (WhatsApp reusa WA)
let reviewsCount=0;

// settings.reviews_count (nº de reseñas de marketing)
const SOC_SVG={
  ig:'<svg viewBox="0 0 24 24"><path d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.17 15.58 2.16 15.2 2.16 12s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.31-1.46.72-2.12 1.38C1.36 2.67.95 3.34.63 4.14.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.31.8.72 1.47 1.38 2.13.66.66 1.33 1.07 2.12 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.86 5.86 0 0 0 2.13-1.38 5.86 5.86 0 0 0 1.38-2.13c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.86 5.86 0 0 0-1.38-2.12A5.86 5.86 0 0 0 19.86.63c-.76-.3-1.64-.5-2.91-.56C15.67.01 15.26 0 12 0Zm0 5.84A6.16 6.16 0 1 0 18.16 12 6.16 6.16 0 0 0 12 5.84M12 16a4 4 0 1 1 4-4 4 4 0 0 1-4 4Zm6.41-10.84a1.44 1.44 0 1 0 1.44 1.44 1.44 1.44 0 0 0-1.44-1.44Z"/></svg>',
  tiktok:'<svg viewBox="0 0 24 24"><path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>',
  fb:'<svg viewBox="0 0 24 24"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07c0 6.02 4.39 11.01 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.08 24 18.09 24 12.07z"/></svg>',
  wa:'<svg viewBox="0 0 24 24"><path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.26-.46-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.07-.12-.27-.2-.57-.35M12.05 21.78h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88M20.46 3.49A11.81 11.81 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.89 0-3.18-1.24-6.16-3.48-8.42z"/></svg>'
};

function renderFooter(){
  const box=$('ftrIcons');
  const icon=(href,svg,label)=>`<a href="${escHtml(href)}" target="_blank" rel="noopener" aria-label="${label}">${svg}</a>`;
  if(box){
    let h='';
    if(socials.ig)h+=icon(socials.ig,SOC_SVG.ig,'Instagram');
    if(socials.tiktok)h+=icon(socials.tiktok,SOC_SVG.tiktok,'TikTok');
    if(socials.fb)h+=icon(socials.fb,SOC_SVG.fb,'Facebook');
    if(WA)h+=icon('https://wa.me/'+WA,SOC_SVG.wa,'WhatsApp');
    box.innerHTML=h||'<span style="font-size:12px;color:var(--ink3)">Pronto en redes</span>';
  }
  const logo=$('ftrLogo');if(logo)logo.textContent=(STORE_NAME||'STRANGE')+'®';
  const yr=$('ftrYear');if(yr)yr.textContent=new Date().getFullYear();
  const f=$('siteFooter');if(f)f.style.display='';   // se muestra solo cuando ya cargó todo (evita verlo al inicio)
}

/* ── PÁGINAS LEGALES — contenido y modal viven en extras.js (carga bajo demanda) ── */
function openLegal(key){loadExtras().then(()=>openLegal(key)).catch(()=>{});}

function subscribeFooter(){
  const inp=$('ftrEmail'),msg=$('ftrMsg'),btn=$('ftrBtn');
  const email=((inp&&inp.value)||'').trim();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){if(msg){msg.style.color='var(--red)';msg.textContent='Escribe un correo válido 🙏';}return;}
  if(btn){btn.disabled=true;btn.textContent='…';}
  fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind:'subscriber',source:'footer',email,utm:{...getUTM(),...getFbAttribution(),...getVisitCtx()},session_id:SESSION_ID})})
    .then(r=>r.ok?r.json():Promise.reject(new Error('http')))
    .then(()=>{if(msg){msg.style.color='var(--green)';msg.textContent='¡Listo! 🎉 Te avisaremos de novedades.';}if(inp)inp.value='';
      if(typeof px==='function')px('Lead',{content_name:'newsletter_footer',...getUTM()},SESSION_ID+'_news');})
    .catch(()=>{if(msg){msg.style.color='var(--red)';msg.textContent='No se pudo, reintenta.';}})
    .finally(()=>{if(btn){btn.disabled=false;btn.textContent='Suscribirme';}});
}

/* ── CLIENTES FELICES (testimonios) ── */
let testimonios=[];

// settings.testimonios [{nombre,ciudad,fecha,texto,foto,captura,estrellas}]
let _testiList=[];

/* Sin foto del cliente, igual que elena: solo nombre + check verde, fecha, estrellas y texto.
   El protagonista es el pantallazo. Una foto de perfil al lado compite con él, y además obliga a
   publicar la cara de un cliente real (o a inventarla, que es peor). */

/* Al agrandar el pantallazo en el modal, dos capturas quedaron legibles con la guía de Servientrega
   a la vista (nombre, dirección y celular del destinatario). Se reemplazaron el 2026-08-17 por
   versiones recortadas sin la guía; el bloqueo temporal que las ocultaba ya no hace falta.
   Regla que queda: antes de subir un pantallazo, recortar o tapar TODA la guía —no solo el nombre—
   porque el QR y el número también llevan a los datos del envío. */

// Estrellas de 0 a 5, con decimales. Los testimonios viejos no traen el campo → 5 por defecto.
function _estrellas(v){const n=Number(v);return (isFinite(n)&&n>0)?Math.min(5,n):5;}
function _starsHtml(v,cls){return `<span class="stars${cls?' '+cls:''}" style="--r:${_estrellas(v)}"><i></i></span>`;}

// Nº de columnas del masonry según el ancho (elena usa 5 en escritorio y 2 en móvil).
function _testiCols(){return innerWidth>=1000?5:innerWidth>=700?4:2;}

/* Reparte las tarjetas a la columna MÁS CORTA. Se vuelve a llamar cada vez que carga un
   pantallazo, porque hasta que la imagen no llega no se sabe cuánto mide la tarjeta. */
let _testiRebT=null;
function _testiReb(){clearTimeout(_testiRebT);_testiRebT=setTimeout(_testiRebDo,90);}
function _testiRebDo(){
  const row=$('testiRow');if(!row)return;
  const cards=[...row.querySelectorAll('.testi-card')];
  if(!cards.length)return;
  const n=Math.min(_testiCols(),cards.length);
  const alt=cards.map(c=>c.offsetHeight||1);      // medir ANTES de mover nada
  const cols=[];
  for(let i=0;i<n;i++){const d=document.createElement('div');d.className='testi-col';cols.push({el:d,h:0});}
  cards.forEach((c,i)=>{
    let m=0;for(let j=1;j<n;j++)if(cols[j].h<cols[m].h)m=j;
    cols[m].el.appendChild(c);cols[m].h+=alt[i];      // appendChild las saca de la columna vieja
  });
  row.innerHTML='';cols.forEach(c=>row.appendChild(c.el));
}

function renderTestimonios(){
  const sec=$('testimonios'),row=$('testiRow'),cnt=$('testiCount');
  const ts=Array.isArray(testimonios)?testimonios:[];   // solo reales del admin; si no hay, la sección se oculta
  _testiList=ts;
  if(cnt)cnt.textContent=reviewsCount>0?`${reviewsCount.toLocaleString('es-CO')} reseñas`:`${ts.length} reseñas`;
  // Promedio real de los testimonios cargados (por eso la cabecera puede mostrar 4,8 y no 5 clavado)
  const avg=ts.length?ts.reduce((a,t)=>a+_estrellas(t.estrellas),0)/ts.length:5;
  const as=$('testiAvgStars');if(as)as.style.setProperty('--r',avg.toFixed(2));
  if(!row)return;
  if(!ts.length){if(sec)sec.style.display='none';row.innerHTML='';return;}
  if(sec)sec.style.display='';
  const cards=ts.map((t,i)=>{
    const meta=[t.ciudad,t.fecha].filter(Boolean).map(escHtml).join(' · ');
    const cap=t.captura?`<img class="testi-card-cap" src="${escHtml(t.captura)}" alt="Pedido recibido" loading="lazy" onload="_testiReb()" onerror="this.style.display='none';_testiReb()">`:'';
    return `<div class="testi-card" onclick="openTesti(${i})">
      ${cap}
      <div class="testi-card-top"><div class="testi-card-name">${escHtml(t.nombre||'Cliente')} <span class="testi-card-verif">✓</span></div><div class="testi-card-date">${meta}</div></div>
      <div class="testi-card-stars">${_starsHtml(t.estrellas)}</div>
      <div class="testi-card-text">${escHtml(t.texto||'')}</div>
    </div>`;
  });
  // Reparto inicial por turnos; al cargar las imágenes _testiReb() lo reequilibra por altura real.
  const n=Math.min(_testiCols(),cards.length);
  const cols=Array.from({length:n},()=>'');
  cards.forEach((h,i)=>{cols[i%n]+=h;});
  row.innerHTML=cols.map(c=>`<div class="testi-col">${c}</div>`).join('');
  _testiReb();
}

// Al cambiar el ancho cambia el nº de columnas: hay que volver a repartir.
addEventListener('resize',_testiReb);

function openTesti(i){
  const t=_testiList[i];if(!t)return;
  $('tmName').textContent=t.nombre||'Cliente';
  $('tmDate').textContent=[t.ciudad,t.fecha].filter(Boolean).join(' · ');
  $('tmText').textContent=t.texto||'';
  const st=$('tmStars');if(st)st.style.setProperty('--r',_estrellas(t.estrellas));
  // El pantallazo manda el panel entero: sin captura, el modal queda solo con el texto.
  const pane=$('tmPaneImg'),cp=$('tmCap');
  if(pane){if(t.captura){if(cp)cp.src=t.captura;pane.style.display='';}else pane.style.display='none';}
  {const _tm=$('testiModal');const _ya=_tm.classList.contains('on');_tm.classList.add('on');if(!_ya)lockScroll();}   // un bloqueo por capa
  navPush('testi',null,null,closeTesti);
}

function closeTesti(){if(!_navPopping)navRemove('testi');$('testiModal').classList.remove('on');unlockScroll();}

/* ── NEUROMARKETING ── */
// Prueba social real: vistas por producto (de la tabla events, vía /api/product-views)
let _views={};

function loadViews(){
  fetch('/api/product-views').then(r=>r.json()).then(j=>{
    _views=j.views||{};
    computeBadges();
    // re-render para que el badge "Más visto" (datos reales) aparezca al llegar las vistas
    if(typeof renderPreview==='function')renderPreview();
    if($('catView')&&$('catView').classList.contains('on')&&typeof renderGrid==='function')renderGrid();
  }).catch(()=>{});
}

// Contador de reserva persistente: nunca borra el carrito, al expirar reinicia (urgencia sin castigo)
const RESERVE_MS=15*60*1000;

let _reserveTimer=null;

function startReserva(){
  if(!localStorage.getItem('ss_reserve_until')){
    localStorage.setItem('ss_reserve_until',String(Date.now()+RESERVE_MS));
  }
  if(!_reserveTimer)_reserveTimer=setInterval(tickReserva,1000);
  tickReserva();
}

function reserveRemaining(){
  let until=parseInt(localStorage.getItem('ss_reserve_until')||'0');
  let rem=until-Date.now();
  if(rem<=0){ until=Date.now()+RESERVE_MS; localStorage.setItem('ss_reserve_until',String(until)); rem=RESERVE_MS; }
  return rem;
}

function tickReserva(){
  const rem=reserveRemaining();
  const mm=String(Math.floor(rem/60000)).padStart(2,'0');
  const ss=String(Math.floor((rem%60000)/1000)).padStart(2,'0');
  const txt=mm+':'+ss;
  const t1=$('pmReserveT');if(t1)t1.textContent=txt;
  const pr=$('pmReserve');if(pr&&Object.keys(cart).length)pr.style.display='flex';
  const t2=$('cartReserveT');if(t2)t2.textContent=txt;
}

/* ── WHATSAPP FLOTANTE ── */
function openWA(){
  const msg=`¡Hola ${STORE_NAME}! 👟 Vengo del catálogo y quiero más información.`;
  // Contacto directo = lead. Se registra para que el agente lo cuente en el embudo.
  trackEvent('lead',{});
  if(typeof px==='function')px('Lead',{content_name:'whatsapp_directo',...getUTM()});
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');
}

/* Mini-anuncio del FAB: chat que llega preguntando por un combo = lead caliente precalificado.
   content_name distinto (whatsapp_combos) para medir cuántos leads trae la burbuja. */
function openWACombos(){
  const msg=`¡Hola ${STORE_NAME}! 👟 Vengo del catálogo, estoy interesado en los combos 🏆 Dame más información...`;
  trackEvent('lead',{});
  if(typeof px==='function')px('Lead',{content_name:'whatsapp_combos',...getUTM()});
  hideWaBubble(true);
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');
}

function hideWaBubble(dismiss){
  const b=$('waBubble');if(b)b.classList.remove('show');
  if(dismiss){try{sessionStorage.setItem('ss_wabub','1');}catch(e){}}
}

// Aparece a los 12s (el popup de bienvenida sale a los 7s — no competir). Si hay un modal
// abierto reintenta. Solo con combos activos. Cerrada = no vuelve en esta sesión.
function maybeWaBubble(){
  try{if(sessionStorage.getItem('ss_wabub'))return;}catch(e){}
  setTimeout(function intentar(){
    try{if(sessionStorage.getItem('ss_wabub'))return;}catch(e){}
    if(!(combos||[]).some(c=>c&&c.activo!==false))return;
    const open=document.querySelector('.wm.on,.photo-modal.on,.guia-modal.on,.csheet.on,.apanel.on');
    if(open){setTimeout(intentar,8000);return;}
    const b=$('waBubble');if(b)b.classList.add('show');
  },12000);
}

/* ── FAVORITOS ❤️ ── estado en localStorage (ss_favs = array de ids). El cliente marca
   productos con el corazón de cada tarjeta y los ve luego en la sección #favoritos del inicio. */
function favIds(){
  try{const a=JSON.parse(localStorage.getItem('ss_favs')||'[]');return Array.isArray(a)?a.filter(x=>typeof x==='number'):[];}catch(e){return [];}
}
function esFav(id){return favIds().includes(id);}
function togFav(id,btn){
  let favs=favIds();
  const i=favs.indexOf(id);
  const ahora=i<0;
  if(ahora)favs.unshift(id); else favs.splice(i,1);
  try{localStorage.setItem('ss_favs',JSON.stringify(favs));}catch(e){}
  // refleja el estado en TODAS las tarjetas de ese producto (grid, lanzamientos, preview, recientes, favoritos)
  document.querySelectorAll('.fav-btn[data-id="'+id+'"]').forEach(b=>b.classList.toggle('on',ahora));
  updFavDot();
  renderFavoritos();
  toast(ahora?'❤️ Guardado en favoritos':'Quitado de favoritos');
}

/* Contador del corazón en el nav: número de favoritos; oculto si 0. */
function updFavDot(){
  const d=$('favDot');if(!d)return;
  const n=favIds().length;
  d.textContent=n;
  d.classList.toggle('show',n>0);
}

/* Favoritos ahora en su propia VENTANA (#favModal): este render llena el grid del modal.
   Así marcar 20 favoritos no llena el inicio. Si está vacío, muestra un estado amable. */
function renderFavoritos(){
  const grid=$('favModalGrid');if(!grid)return;
  computeBadges();
  const seen=new Set();
  const items=favIds().map(id=>{
    const p=prods.find(x=>x.id===id);
    if(!p||p.sold||seen.has(p.id))return null;
    seen.add(p.id);
    return p;
  }).filter(Boolean);
  grid.innerHTML=items.length
    ? items.map((p,i)=>cardHTML(p,i,'kf')).join('')
    : `<div class="favmodal-empty">Aún no tienes favoritos.<br>Toca el ♥ en los zapatos que te gusten<br>y aparecerán aquí.</div>`;
}

/* Botón corazón del nav: abre la VENTANA de favoritos (si hay). Vacío → toast. */
function abrirFavoritos(){
  if(typeof closeCatalog==='function')closeCatalog();
  if(typeof closeMenu==='function')closeMenu();
  if(!favIds().length){toast('Aún no tienes favoritos ❤️');return;}
  renderFavoritos();
  const m=$('favModal');if(m){m.classList.add('on');if(typeof lockScroll==='function')lockScroll();}
  if(typeof navPush==='function')navPush('fav',null,'Tus favoritos — '+STORE_NAME,cerrarFavoritos);   // el botón ATRÁS cierra el modal (no se sale del sitio ni deja el scroll bloqueado)
}
function cerrarFavoritos(){
  if(typeof navRemove==='function'&&!_navPopping)navRemove('fav');
  const m=$('favModal');if(m)m.classList.remove('on');
  if(typeof unlockScroll==='function')unlockScroll();
}

/* ── GRID ── */
// Markup de una tarjeta de producto (reusado por el grid y por "Últimos lanzamientos").
// ── BADGES HONESTOS (datos REALES) ── "Nuevo" = de los más recientes (id más alto);
// "👀 Más visto" = top por vistas reales (_views, mín. 5). Se recalculan en cada render.
let _badgeNew=new Set(),_badgeTop=new Set();
function computeBadges(){
  const ps=(prods||[]).filter(p=>!p.sold);
  _badgeNew=new Set(ps.map(p=>p.id).sort((a,b)=>b-a).slice(0,10));
  _badgeTop=new Set(ps.filter(p=>(_views[String(p.id)]||0)>=5)
    .sort((a,b)=>(_views[String(b.id)]||0)-(_views[String(a.id)]||0)).slice(0,6).map(p=>p.id));
}
function cardBadge(p){
  if(_badgeTop.has(p.id))return '<div class="bviews">🔥 Top</div>';
  if(_badgeNew.has(p.id))return '<div class="bnew">Nuevo</div>';
  return '';
}

/* ── TALLA + AÑADIR EN LA TARJETA ── siempre visibles bajo el precio (no tapan la foto). El
   estado de "qué talla eligió" vive en el propio nodo .card (dataset), no en memoria global —
   cardHTML() genera el nodo desde cero cada vez, así que nunca queda sucio entre productos. */
function tallasChipsHtml(id,tallas,stock){
  return tallas.map(t=>{
    const out=stock&&(Number(stock[t])||0)<=0;
    const s=escHtml(String(t));
    return out
      ? `<button type="button" class="ctalla-chip out" disabled aria-disabled="true" title="Agotada">${s}</button>`
      : `<button type="button" class="ctalla-chip" onclick="event.stopPropagation();pickCardSize(${id},'${s}',this)">${s}</button>`;
  }).join('');
}
function pickCardSize(id,talla,btn){
  const card=btn.closest('.card'); if(!card)return;
  card.querySelectorAll('.ctalla-chip').forEach(c=>c.classList.remove('on'));
  btn.classList.add('on');
  card.dataset.selTalla=talla;
  const box=card.querySelector('.ctallas'); if(box)box.classList.remove('err');
}
// Mismo patrón que el viejo quickPick(): si esa talla YA está en el carrito, solo abre el
// carrito; togCard hace todo lo demás (pixel/GA4/reserva/abrir carrito/sincronizar ✓).
function addCardWithSize(id,btn){
  const card=btn.closest('.card'); if(!card)return;
  const p=(prods||[]).find(x=>x.id===id); if(!p||p.sold)return;
  const talla=card.dataset.selTalla;
  if(!talla){
    const box=card.querySelector('.ctallas');
    if(box){box.classList.remove('err');void box.offsetWidth;box.classList.add('err');}
    return;
  }
  const key=cartKey(id,'cat',talla);
  if(cart[key])openCart(); else togCard(id,'cat',talla);
}

// prefix: 'k' en el grid, 'kl' en lanzamientos (evita IDs duplicados).
// toFicha: en lanzamientos el clic en el CUERPO de la tarjeta lleva a la ficha del zapato.
function cardHTML(p,i,prefix,toFicha){
  prefix=prefix||'k';
  const on=enCarrito(p.id,'cat')&&!p.sold;
  const sp=p.promo||promoG;
  const pct=sp?dsc(p):0;
  const m=p.img?`<img src="${p.img}" alt="${altProd(p)}" loading="lazy">`:`<div class="noimg">👟</div>`;
  // CUERPO de la tarjeta: con tallas abre la ficha (para ver el producto). Sin tallas, el "+"
  // circular agrega directo (comportamiento sin cambios).
  const {tallas:_tallas,stock:_stock}=tallasInfo(p);
  const conTalla=_tallas.length>0;
  const goCard=(toFicha||conTalla)?`openPhoto(${p.id},'cat')`:`cardClick(event,${p.id},'cat')`;
  const goAdd=`event.stopPropagation();togCard(${p.id},'cat')`;   // solo aplica sin tallas
  // Nombre: marca (línea fina) + modelo (destacado). Sin modelo, el modelo cae a marca/género.
  const _bl=p.brand?brandLabel(p.brand):'';
  const _modelTxt=p.modelo||_bl||(genLabel(p.g));
  const _showBrand=!!(p.modelo&&_bl);
  const _tallasHtml=conTalla?tallasChipsHtml(p.id,_tallas,_stock):'';
  const _addBtn=conTalla?`<button type="button" class="cadd-btn" onclick="event.stopPropagation();addCardWithSize(${p.id},this)">Añadir</button>`:'';
  return `<div class="card ${on?'picked':''} ${p.sold?'sold':''}" id="${prefix}${p.id}" style="animation-delay:${Math.min(i*.02,.4)}s" onclick="${goCard}">
      <div class="cphoto">
        ${m}
        ${pct?`<div class="bdsc">-${pct}%</div>`:''}
        ${p.sold?`<div class="bsold">Agotado</div>`:cardBadge(p)}
        <div class="bchk">✓</div>
        <button class="fav-btn ${esFav(p.id)?'on':''}" data-id="${p.id}" onclick="event.stopPropagation();togFav(${p.id},this)" aria-label="Favorito">♥</button>
        ${conTalla?'':`<button class="add-circle" onclick="${goAdd}">${on?'✓':'+'}</button>`}
      </div>
      <div class="cfoot-card">${_showBrand?`<div class="cbrand">${escHtml(_bl)}</div>`:''}<div class="cmodel">${escHtml(_modelTxt)}</div><div class="cprice ${sp?'sale':''}">${fmt(p.price)}</div>${sp&&p.was?`<div class="cwas">${fmt(p.was)}</div>`:''}${conTalla?`<div class="ctallas" id="ctallas${prefix}${p.id}">
          <div class="ctallas-row">${_tallasHtml}</div>
          ${_addBtn}
        </div>`:''}</div>
    </div>`;
}

function renderGrid(){
  computeBadges();
  const liqEl=$('liqSec');
  // El buscador filtra por marca/modelo de `prods`; en Ofertas manda `liqs` (sin columna brand),
  // así que ahí no aplica: se oculta y se limpia para no dejar un filtro activo invisible.
  const cs=document.querySelector('#catView .catsearch');
  if(cs)cs.style.display=(gSel==='liq')?'none':'';
  if(gSel==='liq'&&_searchQ){
    _searchQ='';
    const si=$('catSearchInput');if(si)si.value='';
    const sx=$('catSearchX');if(sx)sx.style.display='none';
  }
  if(gSel==='liq'){
    $('grid').innerHTML='';
    $('grid').style.display='none';
    const bb=$('brandbar');if(bb)bb.innerHTML='';   // liquidación no tiene filtro de marca
    $('statN').textContent=prods.length;
    $('secName').textContent='🔥 Ofertas';
    // El contador tiene que hablar de lo que SE VE. Sin liquidación esta sección la llenan los
    // combos (#combosRow, dentro de #liqSec), así que decir "0 modelos" encima de tres combos
    // hace leer la página como vacía — y aquí es donde aterrizan los 4 banners del hero.
    {
      const nCombos=(typeof combos!=='undefined'?combos:[]).filter(c=>c&&c.activo!==false).length;
      $('secCt').textContent = liqs.length ? (liqs.length+' modelos')
                             : nCombos     ? (nCombos+(nCombos===1?' combo':' combos'))
                             : '0 modelos';
    }
    liqEl.style.display='block';
    const lhdr=liqEl.querySelector('.liq-hdr');
    if(lhdr)lhdr.style.display='none';
    renderLiqGrid();
    return;
  }
  $('grid').style.display='';
  renderBrandBar();
  let items=gSel==='all'?prods:gSel==='u'?prods.filter(p=>p.g==='u'):prods.filter(p=>p.g===gSel||p.g==='u');   // Hombre/Mujer incluyen Unisex; pestaña Unisex solo 'u'
  // Colección curada: manda sobre todo y respeta el ORDEN en que el admin eligió los productos
  // (por eso se recorre la lista de ids, no la de productos). Un id borrado del catálogo
  // simplemente no aparece: la colección nunca muestra un hueco ni rompe.
  const _col=colSel?coleccionDe(colSel):null;
  if(_col){
    const byId=new Map(prods.map(p=>[p.id,p]));
    items=_col.ids.map(id=>byId.get(id)).filter(Boolean);
  }
  if(brandSel!=='all')items=items.filter(p=>p.brand===brandSel);
  if(_searchQ)items=items.filter(p=>((p.modelo||'')+' '+brandLabel(p.brand)).toLowerCase().includes(_searchQ));
  // Ordenar sobre una COPIA (cuando gSel==='all', items === prods por referencia: nunca ordenar in-place).
  if(_sortBy){
    items=items.slice();
    if(_sortBy==='price_asc')items.sort((a,b)=>a.price-b.price);
    else if(_sortBy==='price_desc')items.sort((a,b)=>b.price-a.price);
    else if(_sortBy==='new')items.sort((a,b)=>b.id-a.id);
    else if(_sortBy==='views')items.sort((a,b)=>(_views[String(b.id)]||0)-(_views[String(a.id)]||0));
  }
  $('statN').textContent=prods.length;
  $('secName').textContent=_col?(_col.nombre||_col.slug):((gSel==='all'?'Todos':genLabel(gSel))+(brandSel!=='all'?' · '+brandLabel(brandSel):''));
  $('secCt').textContent=items.length+' modelos';
  $('grid').innerHTML=items.length?items.map((p,i)=>cardHTML(p,i,'k')).join(''):`<div class="grid-empty">No encontramos "<b>${escHtml(_searchQ)}</b>" 😕<br>Prueba con otra marca o modelo.</div>`;
  if(liqs.length&&gSel==='all'){
    liqEl.style.display='block';
    const lhdr=liqEl.querySelector('.liq-hdr');
    if(lhdr)lhdr.style.display='';
    renderLiqGrid();
  }else liqEl.style.display='none';
  $('liqN').textContent=liqs.length;
}

function renderLiqGrid(){
  $('liqN').textContent=liqs.length;
  if(!liqs.length){$('liqGrid').innerHTML='';return;}   // sin liq: la sección Ofertas la cargan los combos (#combosRow); NO mostrar mensaje de admin al cliente
  $('liqGrid').innerHTML=liqs.map((p,i)=>{
    const on=enCarrito(p.id,'liq')&&!p.sold;
    const pct=dsc(p);
    const m=p.img?`<img src="${p.img}" alt="${altProd(p)}" loading="lazy">`:`<div class="noimg">🔥</div>`;
    return `<div class="liq-card ${on?'picked':''} ${p.sold?'sold':''}" id="lk${p.id}" style="animation-delay:${Math.min(i*.02,.4)}s" onclick="cardClick(event,${p.id},'liq')">
      <div class="lphoto">
        ${m}
        ${pct?`<div class="lbdsc">-${pct}%</div>`:''}
        ${p.sold?`<div class="lbsold">Agotado</div>`:''}
        <div class="lbchk">✓</div>
        <button class="add-circle" onclick="event.stopPropagation();togCard(${p.id},'liq')">${on?'✓':'+'}</button>
      </div>
      <div class="lfoot"><div class="lpnow">${fmt(p.price)}</div>${p.was?`<div class="lpwas">${fmt(p.was)}</div>`:''}${pct?`<div class="lsave">Ahorras $${(p.was-p.price).toLocaleString('es-CO')}</div>`:''}</div>
    </div>`;
  }).join('');
}

/* ── CARD CLICK ── */
function cardClick(e,id,type){
  const list=type==='liq'?liqs:prods;
  const p=list.find(x=>x.id===id);
  if(!p||p.sold)return;
  const inPhoto=e.target.closest('.cphoto')||e.target.closest('.lphoto');
  if(inPhoto&&p.img){openPhoto(id,type);return;}
  if(tallasDe(p).length){openPhoto(id,type);return;}   // con tallas: la elección es en la ficha
  togCard(id,type);
}

function setG(v,btn){
  gSel=v;
  brandSel='all';   // al cambiar de sección, resetear el filtro de marca
  colSel=null;      // ...y salir de la colección: el cliente pidió ver una sección completa
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  // btn puede no existir: openCatalog resuelve tabs[idx] por posición, y si algún día se quita un
  // botón del DOM esto reventaba con TypeError y la vista no abría. Filtrar es lo importante.
  if(btn)btn.classList.add('on');
  renderGrid();
  navUpdateCat();
}

/* ── FILTRO POR MARCA ── */
const BRAND_LABELS={adidas:'Adidas',nike:'Nike',reebok:'Reebok',new_balance:'New Balance',on_cloud:'On Cloud',puma:'Puma',lecoq_sportif:'Le Coq Sportif',jordan:'Jordan',lacoste:'Lacoste',asics:'Asics',onitsuka_tiger:'Onitsuka Tiger',luxury:'Luxury'};

let brandSel='all';

/* Colección activa (slug) o null. Manda sobre género y marca: si el cliente entró por /c/xxx,
   está viendo una selección hecha a mano y no debe mezclarse con los filtros. */
let colSel=null;

function coleccionDe(slug){return (colecciones||[]).find(c=>c.slug===slug&&c.activo!==false)||null;}

function brandLabel(b){return BRAND_LABELS[b]||b;}

function altProd(p){return escHtml(p.modelo||((BRAND_LABELS[p.brand]||'Sneakers')+(p.g==='h'?' hombre':p.g==='m'?' mujer':p.g==='u'?' unisex':'')));}

function renderBrandBar(){
  const bar=$('brandbar');if(!bar)return;
  // Marcas presentes en el inventario disponible (no agotado)
  const set=new Set();
  prods.forEach(p=>{if(p.brand&&!p.sold)set.add(p.brand);});
  // Mantener el orden de BRAND_LABELS y solo mostrar las que existen
  const marcas=Object.keys(BRAND_LABELS).filter(b=>set.has(b));
  if(!marcas.length){bar.innerHTML='';return;}  // sin marcas → barra oculta (CSS :empty)
  const chip=(v,txt)=>`<button class="bchip ${brandSel===v?'on':''}" onclick="setBrand('${v}',this)">${txt}</button>`;
  bar.innerHTML=chip('all','Todas las marcas')+marcas.map(b=>chip(b,brandLabel(b))).join('');
}

function setBrand(v,btn){
  brandSel=v;
  colSel=null;      // elegir una marca es salir de la colección curada
  document.querySelectorAll('.bchip').forEach(c=>c.classList.remove('on'));
  if(btn)btn.classList.add('on');
  renderGrid();
  navUpdateCat();
}

/* ── VISTOS RECIENTEMENTE ── últimos productos cuya ficha abrió el cliente (localStorage).
   Se registra al abrir la ficha; se re-hidrata desde `prods` al renderizar (descarta agotados). */
/* ── SEO POR PRODUCTO (meta.seo, estilo Shopify) ──
   Devuelve {title,desc} saneados o nulls. TODO defensivo: meta puede venir null, roto o con
   una forma inesperada (lo escribe el panel, pero la tabla es pública) — la ficha JAMÁS se
   rompe por un meta malo: sin datos válidos cae a los textos de siempre. */
function seoFicha(p){
  try{
    const s=p&&p.meta&&typeof p.meta==='object'&&!Array.isArray(p.meta)?p.meta.seo:null;
    if(!s||typeof s!=='object'||Array.isArray(s))return {title:null,desc:null};
    const title=(typeof s.title==='string'&&s.title.trim())?s.title.trim().slice(0,70):null;      // límite Shopify: 70
    const desc=(typeof s.description==='string'&&s.description.trim())?s.description.trim().slice(0,160):null; // límite Shopify: 160
    return {title,desc};
  }catch(_){return {title:null,desc:null};}
}
/* Metadescripción del documento: por producto si existe, y al cerrar la ficha se RESTAURA la
   global (guardada la primera vez). Toca <meta name="description"> y el og:description. */
let _descGlobal=null,_ogDescGlobal=null;
function setMetaDesc(txt){
  const el=document.querySelector('meta[name="description"]');
  if(el){
    if(_descGlobal===null)_descGlobal=el.content;
    el.content=txt||_descGlobal;
  }
  const og=$('ogDesc');
  if(og){
    if(_ogDescGlobal===null)_ogDescGlobal=og.content;
    og.content=txt||_ogDescGlobal;
  }
}
/* ── METACAMPOS PÚBLICOS en la ficha ── pares clave→valor de la columna meta (material,
   temporada, cuidado, medidas…). 'seo' se excluye: es para las etiquetas <meta>, no para
   mostrar. Sin metacampos válidos el bloque se oculta y la ficha queda como siempre. */
function renderPmSpecs(p){
  const box=$('pmSpecs');if(!box)return;
  let entradas=[];
  try{
    const m=p&&p.meta;
    if(m&&typeof m==='object'&&!Array.isArray(m)){
      entradas=Object.entries(m).filter(([k,v])=>k!=='seo'&&v!=null&&typeof v!=='object'&&String(v).trim()!=='');
    }
  }catch(_){entradas=[];}
  if(!entradas.length){box.style.display='none';box.innerHTML='';return;}
  box.style.display='';
  box.innerHTML='<div class="pm-specs-t">Detalles del producto</div>'
    +entradas.slice(0,12).map(([k,v])=>`<div class="pm-spec"><span class="pm-spec-k">${escHtml(k)}</span><span class="pm-spec-v">${escHtml(String(v))}</span></div>`).join('');
}
/* ── MODAL FOTO ── */
function openPhoto(id,type){
  const list=type==='liq'?liqs:prods;
  const p=list.find(x=>x.id===id);
  if(!p)return;
  if(!p.img)return;
  pmId=id;pmType=type;
  {const fb=$('pmFav');if(fb){fb.dataset.id=id;fb.classList.toggle('on',esFav(id));fb.style.display=type==='liq'?'none':'';}}   // corazón de la ficha (favoritos solo en catálogo, no liquidación)
  renderPmGal([p.img,...(p.imgs||[])],altProd(p));
  const _mk=BRAND_LABELS[p.brand]||'';
  // Si el producto tiene MODELO (ej. "Nike Air Max 90"), ese es el título; si no, Marca · Género.
  $('pmTitle').textContent=p.modelo||((_mk?_mk+' · ':'')+(type==='liq'?'Liquidación':(genLabel(p.g))));
  pmReviewN=reviewsCount;   // nº de reseñas = el de marketing del admin (settings.reviews_count)
  {const rv=$('pmReviews');if(rv)rv.textContent=pmReviewN>0?`(${pmReviewN.toLocaleString('es-CO')} reseñas)`:'';}
  {const dd=$('pmDesc');if(dd)dd.textContent=genDescripcion(p,type);}
  renderPmSpecs(p);   // metacampos públicos (meta jsonb): material, temporada, cuidado…
  {const wa=$('pmWas');if(wa){if(p.was&&p.was>p.price){wa.textContent=fmt(p.was);wa.style.display='';}else wa.style.display='none';}}
  $('pmPrice').textContent=fmt(p.price);
  {const ff=$('pmFootPrice');if(ff)ff.textContent=fmt(p.price);}
  // Anclaje de ahorro: "Ahorras $X (Y%)" si tiene precio antes
  const sv=$('pmSave');
  if(sv){
    const pct=dsc(p);
    if(p.was&&p.was>p.price){sv.textContent=`Ahorras ${fmt(p.was-p.price)} (${pct}%)`;sv.style.display='block';}
    else sv.style.display='none';
  }
  // Prueba social real: vistas de este producto (oculto si 0)
  const so=$('pmSocial');
  if(so){
    const n=_views[String(id)]||0;
    if(n>=3){so.innerHTML=`<span class="pm-chip-ic">👀<span class="pm-live"></span></span><span><b>${n} personas</b> vieron este modelo esta semana</span>`;so.style.display='flex';}
    else so.style.display='none';
  }
  // Reserva: solo mostrar si ya hay algo en el carrito
  const pr=$('pmReserve');
  if(pr)pr.style.display=Object.keys(cart).length?'flex':'none';
  if(Object.keys(cart).length)tickReserva();
  renderPmSizes(p);
  renderPmGuia();
  renderFichaReviews();
  renderPmCross(p,type);
  syncPmBtn();
  const _vcat=type==='liq'?'liquidacion':p.g;
  const _vnm=type==='liq'?'Liquidación':(genLabel(p.g));
  px('ViewContent',{content_ids:[pxId(type,id)],content_type:'product',content_category:_vcat,content_name:_vnm,value:p.price,currency:'COP',...getUTM()});
  ga4('view_item',{currency:'COP',value:p.price,items:[{item_id:pxId(type,id),item_name:_vnm,price:p.price}]});   // GA4 / Google Ads
  trackEvent('view_product',{product_id:(type==='liq'?'L':'')+id,price:p.price,gender:type==='liq'?null:p.g||null});
  // Un bloqueo POR CAPA, no por llamada. navPush('ficha') deduplica por clave: abrir una ficha
  // estando ya en otra (cross-sell / "también te puede gustar") NO crea una capa nueva, así que
  // un solo atrás la cierra y solo desbloquea una vez. Sin esta guarda el contador quedaba en 1
  // y el body se quedaba en position:fixed → la página se congelaba y solo salía recargando.
  {const _pm=$('photoModal');const _yaAbierta=_pm.classList.contains('on');_pm.classList.add('on');if(!_yaAbierta)lockScroll();}
  // SEO por producto: título de página y metadescripción propios cuando existen (meta.seo);
  // sin ellos, el título de siempre y la descripción global (setMetaDesc(null) restaura).
  const _seo=seoFicha(p);
  setMetaDesc(_seo.desc);
  navPush('ficha',navProdUrl(id,type,p),_seo.title||($('pmTitle').textContent+' — '+STORE_NAME),closePhotoBtn);
  // Resetear el scroll de la ficha al ABRIR (si no, reabre donde quedó el anterior → en iOS el
  // header sticky no se ancla y toca subir para ver "CATALOGO SNEAKERS").
  const _ps=document.querySelector('.pm-scroll'), _pb=document.querySelector('.pm-body');
  if(_ps)_ps.scrollTop=0; if(_pb)_pb.scrollTop=0;
  requestAnimationFrame(()=>{if(_ps)_ps.scrollTop=0; if(_pb)_pb.scrollTop=0;});
}

// Tallas de la ficha. Por defecto se DERIVAN del género (sin trabajo de admin): mujer 36-39,
// hombre 40-44 (tallas EUR reales del negocio). Liquidación no tiene género → sin tallas.
// Override por producto (futuro: gestionar agotadas desde el admin): p.tallas array, o 'none'.
const TALLAS_MUJER=['36','37','38','39'], TALLAS_HOMBRE=['40','41','42','43','44'];
// Unisex: tallas según la SECCIÓN activa (gSel) con un poco de solape para pies de borde.
const TALLAS_U_M=['36','37','38','39','40'], TALLAS_U_H=['39','40','41','42','43','44'], TALLAS_U_ALL=['36','37','38','39','40','41','42','43','44'];
// Devuelve {tallas:[...], stock:{talla:n}|null}. stock=null => NO se rastrea inventario por talla
// (todas disponibles). stock objeto => solo las de stock>0 son comprables (el resto se ven agotadas).
function tallasInfo(p){
  if(!p)return {tallas:[],stock:null};
  // Mapa de stock por talla (jsonb): {"38":3,"39":0,...}
  if(p.tallas && typeof p.tallas==='object' && !Array.isArray(p.tallas)){
    const keys=Object.keys(p.tallas).filter(k=>String(k).trim()!=='');
    keys.sort((a,b)=>(parseFloat(a)||0)-(parseFloat(b)||0));
    return {tallas:keys, stock:p.tallas};
  }
  if(Array.isArray(p.tallas))return {tallas:p.tallas.filter(t=>t!=null&&String(t).trim()!==''),stock:null};
  if(p.tallas==='none')return {tallas:[],stock:null};
  if(p.g==='u')return {tallas:(gSel==='m'?TALLAS_U_M:gSel==='h'?TALLAS_U_H:TALLAS_U_ALL).slice(),stock:null};   // contextual
  if(p.g==='m')return {tallas:TALLAS_MUJER.slice(),stock:null};
  if(p.g==='h')return {tallas:TALLAS_HOMBRE.slice(),stock:null};
  return {tallas:[],stock:null};
}
function tallasDe(p){return tallasInfo(p).tallas;}   // compat: lista de tallas configuradas
function tallaDisponible(p,t){const{stock}=tallasInfo(p);return !stock||((Number(stock[t])||0)>0);}
function renderPmSizes(p){
  const box=$('pmSizes'),row=$('pmSizesRow');if(!box||!row)return;
  pmTalla=null;box.classList.remove('err');
  pmAvisoTalla(null);   // limpiar el aviso al abrir OTRO producto (si no, queda el de la talla anterior)
  const {tallas,stock}=tallasInfo(p);
  if(!tallas.length){box.style.display='none';row.innerHTML='';return;}
  box.style.display='';
  row.innerHTML=tallas.map(t=>{
    const out=stock&&(Number(stock[t])||0)<=0;   // sin stock → agotada (deshabilitada y tachada)
    const s=escHtml(String(t));
    return out
      ? `<button type="button" class="pm-size out" disabled aria-disabled="true" title="Agotada">${s}</button>`
      : `<button type="button" class="pm-size" onclick="pmPickSize('${s}',this)">${s}</button>`;
  }).join('');
}
// Guía de tallas: link colapsable con las 2 fotos de marquilla (oculto si el admin no las subió).
function renderPmGuia(){
  const box=$('pmGuia'),imgs=$('pmGuiaImgs'),panel=$('pmGuiaBox');if(!box||!imgs)return;
  const fotos=[sizeGuide&&sizeGuide.img1].filter(Boolean);
  if(!fotos.length){box.style.display='none';imgs.innerHTML='';return;}
  box.style.display='';
  if(panel)panel.style.display='none';   // siempre arranca colapsado
  imgs.innerHTML=fotos.map(u=>`<img class="pm-guia-img" src="${escHtml(u)}" alt="Etiqueta de talla" loading="lazy" onclick="zoomImg('${escHtml(u)}')">`).join('');
}
function toggleGuiaTallas(){const b=$('pmGuiaBox');if(b)b.style.display=b.style.display==='none'?'block':'none';}
/* ── VISOR AMPLIADO (fotos del producto, guía de tallas, marquilla) ──
   Pellizco, rueda, doble toque para acercar/alejar y arrastre para recorrer.
   Escala en `transform` (la GPU la hace sin repintar) con origen en el centro, que es lo que
   hace que la cuenta del punto focal salga corta y estable. */
let _izS=1,_izX=0,_izY=0,_izPtr=new Map(),_izPinch=null,_izPan=null,_izLastTap=0,_izTapT=null,_izHintT=null;
const IZ_MAX=4;
/* En escritorio el visor se comporta como la lupa de la ficha: entra YA acercado y el detalle
   sigue al cursor, sin doble clic ni arrastre. En táctil manda el pellizco.
   Es una FUNCIÓN, no un valor: guardarlo en una constante al cargar hacía que el modo móvil de
   las herramientas del navegador —que se activa después— no cambiara nada hasta recargar. */
const _izHoverQ=matchMedia('(hover:hover) and (pointer:fine)');
function _izHover(){return _izHoverQ.matches;}

function _izApply(anim){
  const im=$('imgZoomImg'),z=$('imgZoom');if(!im)return;
  im.style.transition=anim?'transform .22s cubic-bezier(.16,1,.3,1)':'none';
  im.style.transform=`translate(${_izX}px,${_izY}px) scale(${_izS})`;
  if(z)z.classList.toggle('zoomed',_izS>1.02);
}

// Que no se pueda arrastrar la foto fuera de la pantalla y quede un vacío negro.
function _izClamp(){
  const im=$('imgZoomImg'),z=$('imgZoom');if(!im||!z)return;
  const mx=Math.max(0,(im.offsetWidth*_izS-z.clientWidth)/2);
  const my=Math.max(0,(im.offsetHeight*_izS-z.clientHeight)/2);
  _izX=Math.min(mx,Math.max(-mx,_izX));
  _izY=Math.min(my,Math.max(-my,_izY));
}

/* Acerca hasta `s2` dejando quieto el punto (cx,cy): así el zoom sigue al dedo o al cursor
   en vez de saltar al centro. */
function _izZoomA(s2,cx,cy){
  const z=$('imgZoom');if(!z)return;
  s2=Math.min(IZ_MAX,Math.max(1,s2));
  const r=z.getBoundingClientRect();
  const fx=cx-(r.left+r.width/2), fy=cy-(r.top+r.height/2);
  _izX=fx-(fx-_izX)*s2/_izS;
  _izY=fy-(fy-_izY)*s2/_izS;
  _izS=s2;
  if(_izS<=1.01){_izS=1;_izX=0;_izY=0;}
  _izClamp();
}

function _izReset(){
  _izS=1;_izX=0;_izY=0;_izPtr.clear();_izPinch=null;_izPan=null;
  const im=$('imgZoomImg');if(im)im.style.transformOrigin='';
  _izApply(false);
}

/* Coloca el punto que hay bajo el cursor como centro del acercamiento. Se calcula sobre la caja
   SIN escalar (offsetWidth y el centrado del flex), porque getBoundingClientRect ya viene con la
   escala aplicada y la cuenta se realimentaría a sí misma. */
function _izSeguir(cx,cy){
  const z=$('imgZoom'),im=$('imgZoomImg');if(!z||!im||!im.offsetWidth)return;
  const zr=z.getBoundingClientRect();
  const w0=im.offsetWidth,h0=im.offsetHeight;
  const x0=zr.left+(zr.width-w0)/2, y0=zr.top+(zr.height-h0)/2;
  const px=Math.min(100,Math.max(0,(cx-x0)/w0*100));
  const py=Math.min(100,Math.max(0,(cy-y0)/h0*100));
  im.style.transformOrigin=px+'% '+py+'%';
  _izX=0;_izY=0;_izApply(false);
}

/* Cuánto acercar al abrir el visor: justo hasta la resolución REAL del archivo, ni un píxel más.
   Con fotos de 1400 y el visor a ~845 px salen ~1,65x. Si algún día se suben a 2000, el
   acercamiento sube solo sin tocar código. Nunca pide más píxeles de los que existen. */
function _izNativo(){
  const im=$('imgZoomImg');
  if(!im||!im.offsetWidth||!im.naturalWidth)return PM_HOVER_Z;
  return Math.min(IZ_MAX,Math.max(1.3,im.naturalWidth/im.offsetWidth));
}

function zoomImg(src){
  const z=$('imgZoom'),im=$('imgZoomImg');if(!z||!im)return;
  const ya=z.classList.contains('on');
  im.src=src;_izReset();
  z.classList.add('on');if(!ya)lockScroll();     // un bloqueo por capa
  if(_izHover()){
    // Se mide DESPUÉS de mostrar la capa: oculta, offsetWidth es 0 y la cuenta saldría mal.
    const poner=()=>{_izS=_izNativo();_izApply(false);};
    if(im.complete&&im.naturalWidth)poner(); else im.addEventListener('load',poner,{once:true});
  }
  const h=$('izHint');
  if(h){
    h.textContent=_izHover()?'Mueve el cursor para ver el detalle · rueda para acercar':'Pellizca o toca dos veces para acercar';
    h.style.opacity='1';clearTimeout(_izHintT);_izHintT=setTimeout(()=>{h.style.opacity='0';},2600);
  }
  navPush('zoom',null,null,closeZoom);
}

function closeZoom(){
  const z=$('imgZoom');if(!z||!z.classList.contains('on'))return;
  if(!_navPopping)navRemove('zoom');
  z.classList.remove('on');unlockScroll();_izReset();
}

// Amplía la foto que se está viendo en la galería de la ficha.
function pmZoomActual(){
  const tr=$('pmGalTrack');if(!tr)return;
  const im=tr.children[_galIdx];if(im)zoomImg(im.currentSrc||im.src);
}

(function(){
  const z=document.getElementById('imgZoom');if(!z)return;

  // Escritorio: el detalle sigue al cursor, como la lupa de la ficha pero a pantalla completa.
  z.addEventListener('mousemove',e=>{
    if(!_izHover()||!z.classList.contains('on')||_izS<=1.01)return;
    _izSeguir(e.clientX,e.clientY);
  });

  z.addEventListener('wheel',e=>{
    if(!z.classList.contains('on'))return;
    e.preventDefault();
    if(_izHover()){   // la rueda solo gradúa el aumento; de recorrer ya se encarga el cursor
      _izS=Math.min(IZ_MAX,Math.max(1,_izS*(e.deltaY<0?1.18:1/1.18)));
      if(_izS<=1.01){_izS=1;const im=$('imgZoomImg');if(im)im.style.transformOrigin='';_izX=0;_izY=0;_izApply(false);}
      else _izSeguir(e.clientX,e.clientY);
      return;
    }
    _izZoomA(_izS*(e.deltaY<0?1.18:1/1.18),e.clientX,e.clientY);_izApply(false);
  },{passive:false});

  z.addEventListener('pointerdown',e=>{
    if(e.target.closest('.iz-close'))return;
    try{z.setPointerCapture(e.pointerId);}catch(_){}
    _izPtr.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(_izPtr.size===2){
      const p=[..._izPtr.values()];
      _izPinch={d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)||1,s:_izS};
      _izPan=null;
    }else if(_izPtr.size===1){
      _izPan={x:e.clientX,y:e.clientY,tx:_izX,ty:_izY,mov:0};
    }
  });

  z.addEventListener('pointermove',e=>{
    if(!_izPtr.has(e.pointerId))return;
    _izPtr.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(_izPinch&&_izPtr.size===2){
      const p=[..._izPtr.values()];
      const d=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
      _izZoomA(_izPinch.s*(d/_izPinch.d),(p[0].x+p[1].x)/2,(p[0].y+p[1].y)/2);_izApply(false);
    }else if(_izPan){
      const dx=e.clientX-_izPan.x, dy=e.clientY-_izPan.y;
      _izPan.mov=Math.max(_izPan.mov,Math.hypot(dx,dy));
      // En escritorio NO se arrastra: el cursor ya recorre la foto, y arrastrar pelearía con él.
      if(_izS>1&&!_izHover()){_izX=_izPan.tx+dx;_izY=_izPan.ty+dy;_izClamp();_izApply(false);}
    }
  });

  /* Un toque quieto significa cosas distintas según el estado: si está sin acercar, cierra
     (era el comportamiento de siempre); si está acercado, no hace nada —para poder soltar el
     dedo tras recorrer la foto sin que se cierre—. Dos toques seguidos alternan acercar/alejar.
     Los 310 ms de espera son para no cerrar cuando el segundo toque viene en camino. */
  const soltar=e=>{
    _izPtr.delete(e.pointerId);
    if(_izPtr.size<2)_izPinch=null;
    if(_izPtr.size)return;
    const mov=_izPan?_izPan.mov:99;_izPan=null;
    if(mov>=8)return;
    /* En escritorio un clic siempre cierra: el visor entra ya acercado, así que la regla táctil
       ("solo cierra si no está acercado") dejaría al ratón sin forma de salir salvo ✕ o Escape.
       Y sin doble clic que esperar, no hace falta el retardo de 310 ms. */
    if(_izHover()){closeZoom();return;}
    const t=Date.now();
    if(t-_izLastTap<300){
      _izLastTap=0;clearTimeout(_izTapT);
      _izZoomA(_izS>1.05?1:2.6,e.clientX,e.clientY);_izApply(true);
    }else{
      _izLastTap=t;clearTimeout(_izTapT);
      _izTapT=setTimeout(()=>{if(_izS<=1.05)closeZoom();},310);
    }
  };
  z.addEventListener('pointerup',soltar);
  z.addEventListener('pointercancel',e=>{_izPtr.delete(e.pointerId);if(_izPtr.size<2)_izPinch=null;if(!_izPtr.size)_izPan=null;});

  // Al girar el teléfono cambia el tamaño disponible: recolocar para que no quede descuadrada.
  addEventListener('resize',()=>{if(z.classList.contains('on')){_izClamp();_izApply(false);}});
})();
/* Aviso de verificación de talla: aparece AL ESCOGER, con la foto de la marquilla A LA VISTA.
   El ejemplo ya existía, pero escondido tras el botón "¿Cómo sé mi talla?" — y quien cree saber
   su talla nunca lo abre. No bloquea ni agrega pasos: solo pone el ejemplo donde se decide. */
function pmAvisoTalla(t){
  const box=$('pmTallaCheck'); if(!box)return;
  const foto=sizeGuide&&sizeGuide.img1;
  if(!t||!foto){box.style.display='none';box.innerHTML='';return;}
  // SIN loading="lazy": el HTML se inserta con la caja todavía en display:none y el observador de
  // carga diferida nunca se activa para ese <img> — quedaba en blanco para siempre. Y no hace
  // falta: esta foto solo se pinta cuando el cliente toca una talla, ya es diferida de por sí.
  box.innerHTML=`<img class="pm-talla-check-img" src="${escHtml(foto)}" alt="Ejemplo de marquilla" onclick="zoomImg('${escHtml(foto)}')">`+
    `<div class="pm-talla-check-tx"><b>Elegiste la talla ${escHtml(String(t))}.</b> Compárala con la marquilla dentro de un zapato tuyo antes de seguir. <span class="pm-talla-check-a" onclick="zoomImg('${escHtml(foto)}')">Ver el ejemplo ampliado</span></div>`;
  box.style.display='';
}

function pmPickSize(t,btn){
  pmTalla=t;
  document.querySelectorAll('#pmSizesRow .pm-size').forEach(b=>b.classList.remove('on'));
  if(btn)btn.classList.add('on');
  const box=$('pmSizes');if(box)box.classList.remove('err');
  pmAvisoTalla(t);
  syncPmBtn();   // si esa talla ya está en el carrito, el botón muestra "✓ Agregado"
}
function syncPmBtn(){
  // Con talla elegida, el botón refleja si ESA talla está en el carrito; sin talla, el estado base.
  const ic=!!cart[cartKey(pmId,pmType,pmTalla)];
  const txt=ic?'✓ Agregado al carrito':'+ Agregar al carrito';
  $('pmAdd').textContent=txt;
  $('pmAdd').className='pm-add'+(ic?' in':'');
  const ff=$('pmFootAdd');if(ff){ff.textContent=txt;ff.className='pm-foot-add'+(ic?' in':'');}
}

// Descripción genérica (no hay nombres de producto): plantilla por género/marca.
function genDescripcion(p,type){
  const mk=BRAND_LABELS[p.brand]||'';
  if(type==='liq')return `Edición de liquidación a precio especial — ${mk?mk+', ':''}calidad original y comodidad para uso diario. Pocas unidades. Envío gratis a todo el país, pago contra entrega, cambios por talla y 100% garantía.`;
  const g=p.g==='h'?'hombre':p.g==='u'?'hombre y mujer':'mujer';
  return `Sneakers ${mk?mk+' ':''}para ${g}: diseño original, materiales de calidad y comodidad todo el día — perfectos para combinar con todo. Envío gratis a todo el país, pago contra entrega, cambios por talla y 100% garantía.`;
}

let pmReviewN=0;

// ── CARRUSEL del cross-sell (carrito + ficha): flechas ‹ › en escritorio; en móvil = swipe ──
function crslWrap(rowHtml){
  return `<div class="crsl"><button class="crsl-a prev" onclick="crslScroll(this,-1)" aria-label="Anterior">‹</button>${rowHtml}<button class="crsl-a next" onclick="crslScroll(this,1)" aria-label="Siguiente">›</button></div>`;
}
function crslScroll(btn,dir){
  const row=btn.parentElement.querySelector('.xs-row,.pmx-row');
  if(row)row.scrollBy({left:dir*Math.max(row.clientWidth*0.8,180),behavior:'smooth'});
}
function crslUpd(){   // muestra las flechas solo si la fila se desborda (hay más fotos que las visibles)
  document.querySelectorAll('.crsl').forEach(c=>{
    const row=c.querySelector('.xs-row,.pmx-row');
    c.classList.toggle('crsl-on',!!row&&row.scrollWidth>row.clientWidth+4);
  });
}
window.addEventListener('resize',()=>{try{crslUpd();}catch(e){}});

// ── "También te puede gustar" — cross-sell en la ficha (mezcla: marca+género, rellena con más vistos) ──
function fichaSugeridos(p,type){
  const pool=(prods||[]).filter(x=>x&&!x.sold&&!(type==='cat'&&x.id===p.id));
  if(!pool.length)return [];
  const score=x=>{
    let s=0;
    if(type==='cat'){
      if(x.brand&&x.brand===p.brand)s+=3;          // misma marca
      if(x.g===p.g)s+=2;                            // mismo género
    }
    s+=Math.min((_views[String(x.id)]||0)/20,1.5); // popularidad (vistas reales)
    return s;
  };
  return pool.slice().sort((a,b)=>score(b)-score(a)).slice(0,4);
}
function renderPmCross(p,type){
  const box=$('pmCross');if(!box)return;
  const sug=fichaSugeridos(p,type);
  if(!sug.length){box.style.display='none';box.innerHTML='';return;}
  box.style.display='';
  const cards=sug.map(s=>{
    const m=s.img?`<img src="${s.img}" alt="${altProd(s)}" loading="lazy">`:`<span style="font-size:20px">👟</span>`;
    const nom=s.modelo||(BRAND_LABELS[s.brand]||'')||(s.g==='h'?'Hombre':'Mujer');
    return `<button class="xs-card" onclick="openPhoto(${s.id},'cat')"><div class="xs-img">${m}</div><div class="xs-nom">${escHtml(nom)}</div><div class="xs-precio">${fmt(s.price)}</div></button>`;
  }).join('');
  box.innerHTML=`<div class="pmx-t">También te puede gustar</div>`+crslWrap(`<div class="pmx-row">${cards}</div>`);
  crslUpd();
}
function renderFichaReviews(){
  const c=$('pmRevList');if(!c)return;
  // Reseñas REALES (las que el admin sube en settings.testimonios). Si no hay, se oculta el bloque
  // (nunca mostramos reseñas inventadas → coherente con políticas de Meta y con la confianza real).
  const revs=(Array.isArray(testimonios)?testimonios:[]).filter(r=>r&&r.texto).slice(0,6);
  if(!revs.length){c.innerHTML='';c.style.display='none';return;}
  c.style.display='';
  const cnt=pmReviewN>0?`${pmReviewN.toLocaleString('es-CO')} reseñas`:'';
  c.innerHTML=`<div class="pm-rev-head"><h4>Dejamos que nuestros clientes hablen</h4><div class="pm-rev-bigstars">★★★★★</div>${cnt?`<div class="pm-rev-count">${cnt}</div>`:''}</div>`+revs.map(r=>{
    const quien=[r.nombre||'Cliente',r.ciudad].filter(Boolean).map(escHtml).join(' · ');
    return `<div class="pm-rev"><div class="pm-rev-h"><b>${quien}</b><span class="pm-rev-v">Cliente Strange</span></div><div class="pm-rev-s">★★★★★</div><div class="pm-rev-x">${escHtml(r.texto)}</div></div>`;
  }).join('');
}

function addFromModal(){
  if(pmId===null)return;
  const list=pmType==='liq'?liqs:prods;
  const p=list.find(x=>x.id===pmId);
  // Si el producto tiene tallas, es OBLIGATORIO elegir una antes de agregar (shake + aviso).
  if(tallasDe(p).length&&!pmTalla){
    const box=$('pmSizes');
    if(box){
      box.classList.remove('err');void box.offsetWidth;box.classList.add('err');
      const sc=document.querySelector('.pm-scroll');
      if(sc){const y=box.offsetTop-130;if(y<sc.scrollTop||box.offsetTop>sc.scrollTop+sc.clientHeight-120)sc.scrollTo({top:y,behavior:'smooth'});}
    }
    return;
  }
  const id=pmId,t=pmType,talla=pmTalla;
  const ya=!!cart[cartKey(id,t,talla)];   // ya estaba en esa talla → no alternar, solo abrir carrito
  closePhotoBtn();
  if(ya)openCart(); else togCard(id,t,talla);
}

function closePhotoBtn(){
  if(!_navPopping)navRemove('ficha');
  setMetaDesc(null);   // al salir de la ficha vuelve la metadescripción global
  $('photoModal').classList.remove('on');
  unlockScroll();
  setTimeout(()=>{const tr=$('pmGalTrack');if(tr)tr.innerHTML='';pmId=null;pmType=null;pmTalla=null;},300);
}

/* ── GALERÍA de la ficha ── */
let _galIdx=0,_galN=1;

function renderPmGal(urls,altTxt){
  _galIdx=0;_galN=urls.length;
  const tr=$('pmGalTrack');if(!tr)return;
  tr.style.transform='translateX(0)';
  tr.innerHTML=urls.map(u=>`<img src="${escHtml(u)}" alt="${altTxt||'Foto del producto'}" loading="lazy">`).join('');
  const dots=$('pmGalDots');
  if(dots)dots.innerHTML=_galN>1?urls.map((_,i)=>`<span class="pm-gal-dot${i===0?' on':''}"></span>`).join(''):'';
  const showArr=_galN>1?'':'none';
  const pv=$('pmGalPrev'),nx=$('pmGalNext');
  // En móvil las flechas no se muestran (swipe); en escritorio aparecen al hover si hay >1 foto
  if(pv)pv.dataset.multi=showArr===''?'1':'0';
  if(nx)nx.dataset.multi=showArr===''?'1':'0';
}

function pmGalGo(dir){
  if(_galN<2)return;
  _galIdx=Math.min(Math.max(_galIdx+dir,0),_galN-1);
  const tr=$('pmGalTrack');if(tr)tr.style.transform=`translateX(-${_galIdx*100}%)`;
  document.querySelectorAll('#pmGalDots .pm-gal-dot').forEach((d,i)=>d.classList.toggle('on',i===_galIdx));
  _pmHoverReset();   // al cambiar de foto, deshacer el acercamiento de la anterior
}

/* ── LUPA AL PASAR EL CURSOR (solo escritorio) ──
   Copiado de adidas.es tras medir su componente `desktop-zoom`:
     .is-zoomed .content { transform: scale(1.8) translateZ(0) }
     transition: transform .4s ease-out      ← y el ORIGEN no se transiciona
     el JS le pone `transform-origin` en píxeles según dónde está el cursor
   Aquí es lo mismo con el origen en %, que es equivalente y no depende del tamaño del marco.

   **1,8x y no más**, por resolución real: la foto se ve a ~563 px y el archivo es de 1400
   (`IMG_MAX` del panel). A 1,8x son 1013 px pedidos contra 1400 disponibles → nítida y con margen
   incluso en pantallas de mucha densidad. A 2,5x se pedían 1407 de 1400: justo al límite, y en un
   portátil retina se veía blanda.
   Adidas puede permitirse más porque **al ampliar cambia a otra imagen de 2000 px** que lleva
   precargada y oculta. Nosotros no tenemos esa versión: el panel comprime todo a 1400 al subir. */
const PM_HOVER_Z=1.8;

function _pmHoverReset(){
  const tr=$('pmGalTrack');if(!tr)return;
  [...tr.children].forEach(im=>{im.style.transform='';im.style.transformOrigin='';});
  const g=$('pmGal');if(g)g.classList.remove('lupa');
  _pmPinReset();
}

/* ── PELLIZCO SOBRE LA PROPIA FICHA (solo táctil) ──
   El equivalente móvil de la lupa: en el teléfono no hay cursor, así que se pellizca la foto
   SIN salir de la página, como el `pinch-zoom-v2` de adidas (wrapper con overflow:hidden y el
   contenido escalado por transform). `.pm-gal` ya recorta. El visor a pantalla completa sigue
   ahí para quien quiera verla en grande. */
let _pmZ=1,_pmZX=0,_pmZY=0;

function _pmPinReset(){
  if(_pmZ===1&&!_pmZX&&!_pmZY)return;
  _pmZ=1;_pmZX=0;_pmZY=0;
  const g=$('pmGal'),tr=$('pmGalTrack');
  if(tr&&tr.children[_galIdx]){const im=tr.children[_galIdx];im.style.transition='transform .22s ease-out';im.style.transform='';}
  if(g){g.classList.remove('pellizcada');g.style.touchAction='';}
}

(function(){
  const gal=document.getElementById('pmGal');if(!gal)return;
  gal.addEventListener('mousemove',e=>{
    // Solo con ratón de verdad: en táctil el `mousemove` que el navegador inventa tras un toque
    // dispararía la lupa sin que nadie la haya pedido.
    if(!_izHover())return;
    const tr=document.getElementById('pmGalTrack');
    const im=tr&&tr.children[_galIdx];if(!im)return;
    const r=gal.getBoundingClientRect();if(!r.width)return;
    const px=Math.min(100,Math.max(0,(e.clientX-r.left)/r.width*100));
    const py=Math.min(100,Math.max(0,(e.clientY-r.top)/r.height*100));
    // El origen cambia sin transición: así el acercamiento sigue al cursor sin ir por detrás.
    im.style.transformOrigin=px+'% '+py+'%';
    im.style.transform='scale('+PM_HOVER_Z+')';
    gal.classList.add('lupa');
  });

  gal.addEventListener('mouseleave',_pmHoverReset);
})();

/* Pellizco en la ficha, solo en táctil. Mientras está acercada: un dedo RECORRE la foto (no cambia
   de foto ni abre el visor); al volver a 1 todo se comporta como antes.
   `touch-action` pasa a 'none' solo mientras está acercada: así se puede recorrer en vertical.
   En reposo se queda en 'pan-y' para que la página siga bajando con el dedo sobre la foto. */
(function(){
  const gal=document.getElementById('pmGal');if(!gal)return;
  const P=new Map(); let pin=null,pan=null;
  const foto=()=>{const tr=document.getElementById('pmGalTrack');return tr?tr.children[_galIdx]:null;};

  function pinta(anim){
    const im=foto();if(!im)return;
    im.style.transition=anim?'transform .22s ease-out':'none';
    im.style.transform=`translate(${_pmZX}px,${_pmZY}px) scale(${_pmZ})`;
    gal.classList.toggle('pellizcada',_pmZ>1.02);
    gal.style.touchAction=_pmZ>1.02?'none':'';
  }
  function topes(){
    const im=foto();if(!im)return;
    const mx=Math.max(0,(im.offsetWidth*_pmZ-gal.clientWidth)/2);
    const my=Math.max(0,(im.offsetHeight*_pmZ-gal.clientHeight)/2);
    _pmZX=Math.min(mx,Math.max(-mx,_pmZX));
    _pmZY=Math.min(my,Math.max(-my,_pmZY));
  }
  /* Tope 3x. En un teléfono de densidad 3 la foto ya consume 1170 de los 1400 px del archivo con
     solo estar en pantalla, así que pasado ~1,2x se estiran píxeles. 3x es el punto donde todavía
     revela textura sin verse deshecha; a 4x ya se notaba blanda. Sube solo si sube `IMG_MAX`. */
  function acercarA(s2,cx,cy){
    s2=Math.min(3,Math.max(1,s2));
    const r=gal.getBoundingClientRect();
    const fx=cx-(r.left+r.width/2), fy=cy-(r.top+r.height/2);
    _pmZX=fx-(fx-_pmZX)*s2/_pmZ; _pmZY=fy-(fy-_pmZY)*s2/_pmZ; _pmZ=s2;
    if(_pmZ<=1.02){_pmZ=1;_pmZX=0;_pmZY=0;}
    topes();
  }

  gal.addEventListener('pointerdown',e=>{
    if(e.pointerType==='mouse')return;   // con ratón manda la lupa; el pellizco es solo de dedos
    if(e.target.closest('.pm-gal-arr,.pm-gal-zoom,.pm-fav,.pm-gal-dots'))return;
    P.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(P.size===2){
      const q=[...P.values()];
      pin={d:Math.hypot(q[0].x-q[1].x,q[0].y-q[1].y)||1,s:_pmZ};pan=null;
    }else if(P.size===1&&_pmZ>1.02){
      pan={x:e.clientX,y:e.clientY,tx:_pmZX,ty:_pmZY};
    }
  });

  gal.addEventListener('pointermove',e=>{
    if(!P.has(e.pointerId))return;
    P.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pin&&P.size===2){
      const q=[...P.values()];
      const d=Math.hypot(q[0].x-q[1].x,q[0].y-q[1].y);
      acercarA(pin.s*(d/pin.d),(q[0].x+q[1].x)/2,(q[0].y+q[1].y)/2);pinta(false);
      e.preventDefault();
    }else if(pan&&_pmZ>1.02){
      _pmZX=pan.tx+(e.clientX-pan.x);_pmZY=pan.ty+(e.clientY-pan.y);topes();pinta(false);
      e.preventDefault();
    }
  },{passive:false});

  const soltar=e=>{
    P.delete(e.pointerId);
    if(P.size<2)pin=null;
    if(!P.size){pan=null;if(_pmZ<=1.02)_pmPinReset();}
  };
  gal.addEventListener('pointerup',soltar);
  gal.addEventListener('pointercancel',soltar);
  /* Aquí NO va doble toque: chocaría con el toque que abre el visor. Habría que retrasar la
     apertura 300 ms para saber si viene un segundo toque, y eso le mete lag a la acción
     principal. En sitio se pellizca; el doble toque vive dentro del visor. */
})();

/* La rueda encima de la FOTO no hacía nada y la ficha parecía trabada.
   En escritorio la ficha son 2 columnas: `.pm-scroll` va en overflow:hidden y el único que
   scrollea es `.pm-body` (la info de la derecha). La columna de la foto no tiene nada que
   desplazar, así que la rueda se perdía ahí. Se reenvía al panel que sí scrollea.
   Va en su propio bloque —fuera de la guarda de hover— para que funcione con cualquier ratón. */
(function(){
  const gal=document.getElementById('pmGal');if(!gal)return;
  gal.addEventListener('wheel',e=>{
    if(!matchMedia('(min-width:700px)').matches)return;   // en móvil scrollea la página: no tocar
    const body=document.querySelector('.pm-body');
    if(!body||body.scrollHeight<=body.clientHeight)return;
    const d=e.deltaMode===1?e.deltaY*16:e.deltaY;         // hay ratones que miden en líneas, no en píxeles
    const antes=body.scrollTop;
    body.scrollTop+=d;
    // Solo se traga el evento si de verdad movió algo: al llegar al tope, que siga su camino.
    if(body.scrollTop!==antes)e.preventDefault();
  },{passive:false});
})();

// Swipe táctil de la galería (mismo patrón que el hero) + toque para ampliar.
(function(){
  const gal=document.getElementById('pmGal');if(!gal)return;
  let x0=null,deslizo=false;
  gal.addEventListener('touchstart',e=>{
    if(e.touches.length>1){x0=null;return;}   // dos dedos = pellizco, no deslizamiento
    x0=e.touches[0].clientX;deslizo=false;
  },{passive:true});
  gal.addEventListener('touchend',e=>{
    if(x0===null)return;
    const dx=e.changedTouches[0].clientX-x0;x0=null;
    if(Math.abs(dx)>10)deslizo=true;          // hubo arrastre: el click que viene NO es un toque
    if(_pmZ>1.02)return;                      // acercada: el dedo la recorre, no cambia de foto
    if(Math.abs(dx)>40)pmGalGo(dx<0?1:-1);
  },{passive:true});

  /* Tocar la foto la amplía. El oyente va en el MARCO, no en la <img>: `styles.css` le pone
     `pointer-events:none` a `.pm-gal-track img` para tapar la barra de "Búsqueda visual" de Edge,
     así que la imagen NUNCA es el destino de un clic y buscarla con `closest('img')` no encontraba
     nada — tocar la foto no hacía absolutamente nada, ni en móvil ni en escritorio.
     Se ignora el clic que el navegador dispara al terminar un deslizamiento. */
  gal.addEventListener('click',e=>{
    if(e.target.closest('.pm-gal-arr,.pm-gal-zoom,.pm-fav,.pm-gal-dots'))return;   // controles propios
    if(deslizo){deslizo=false;return;}
    if(_pmZ>1.02){_pmPinReset();return;}      // si está pellizcada, el toque la devuelve a su sitio
    pmZoomActual();
  });
})();

/* ── GUÍA DE CUIDADO — vive en extras.js (carga bajo demanda) ── */
function openGuia(){loadExtras().then(()=>openGuia()).catch(()=>{});}

document.addEventListener('keydown',e=>{if(e.key==='Escape'){const z=$('imgZoom');if(z&&z.classList.contains('on')){closeZoom();return;}closePhotoBtn();if(typeof closeGuia==='function')closeGuia();closeInfo();closeMenu();}});

/* openAdmin = STUB público: carga /admin.js (todo el JS del panel) UNA vez y delega.
   La tienda del cliente nunca descarga el código del admin. */
/* Cargador de extras.js (guía, legales, vista de pedido) — bajo demanda, una sola vez */
let _extrasJs=null;

function loadExtras(){
  return new Promise((res,rej)=>{
    if(window._extrasReady)return res();
    if(_extrasJs){_extrasJs.addEventListener('load',()=>res());_extrasJs.addEventListener('error',()=>rej());return;}
    _extrasJs=document.createElement('script');
    _extrasJs.src='/extras.js';
    _extrasJs.onload=()=>res();
    _extrasJs.onerror=()=>{_extrasJs=null;alert('No se pudo cargar este contenido. Revisa tu conexión e intenta de nuevo.');rej();};
    document.head.appendChild(_extrasJs);
  });
}

let _adminScriptEl=null;

function openAdmin(){
  try{localStorage.setItem('ss_admin_pwa','1');}catch(e){} // marca el dispositivo como admin → habilita la PWA
  if(window._adminReady){_openAdminReal();return;}
  if(_adminScriptEl)return; // ya está cargando
  _adminScriptEl=document.createElement('script');
  _adminScriptEl.src='/admin.js';
  _adminScriptEl.onload=async()=>{try{await window._adminInit;_openAdminReal();}catch(e){_adminScriptEl=null;alert('No se pudo cargar el panel. Revisa tu conexión e intenta de nuevo.');}};
  _adminScriptEl.onerror=()=>{_adminScriptEl=null;alert('No se pudo cargar el panel. Revisa tu conexión e intenta de nuevo.');};
  document.head.appendChild(_adminScriptEl);
}

/* (AV_TITLES, avGo y el listener del buscador admin viven en admin.js) */















































const _isClasificado=o=>o.status==='venta'||o.status==='no_venta';

/* (drag & drop de las zonas de subida: vive en admin.js) */
