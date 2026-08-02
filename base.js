/* ═══ BASE ═══ Config Supabase, helpers globales, estado compartido, cupones (datos),
   persistencia y stubs de carga perezosa. PRIMER módulo: todos dependen de él. ═══ */

/* ── SUPABASE ── */
const SUPABASE_URL  = 'https://ayogbrpqezutzfdktsok.supabase.co';

const SUPABASE_ANON = 'sb_publishable_ZjVLucKCxH2RM2CycRhkhQ_Gw95sl7s';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let WA='573122672336';

let STORE_NAME='Strange Sneakers';

const P_DEF=180000, P_ANT=240000;

let prods=[],liqs=[];

let cart={};

let gSel='all',promoG=false,bannerOn=false;

let step=0,cData={};

let pmId=null,pmType=null,pmTalla=null;

let orders=[];

let PIXEL_ID='';

let WOMPI_PK='';

let CLARITY_ID='';

const SESSION_ID=(()=>{
  // localStorage (no sessionStorage): el ID persiste entre visitas/pestañas → cuenta VISITANTES
  // ÚNICOS (≈personas), no sesiones de pestaña que mueren al cerrar (antes inflaba el conteo).
  let sid=localStorage.getItem('ss_sid');
  if(!sid){sid=Date.now().toString(36)+Math.random().toString(36).slice(2);localStorage.setItem('ss_sid',sid);}
  return sid;
})();

const $=id=>document.getElementById(id);

const fmt=n=>'$'+n.toLocaleString('es-CO');

const dsc=p=>p.was&&p.was>p.price?Math.round((1-p.price/p.was)*100):0;

/* ── FOTOS POR EL CDN DE VERCEL ──────────────────────────────────────────────
   Las fotos viven en Supabase Storage, y servirlas desde ahí a cada visitante que llega de los
   anuncios agotó la cuota: la organización se pasó por "Cached Egress" y los proyectos quedaban
   restringidos (402 = tienda caída). Ahora se piden a /img/…, que vercel.json reescribe hacia
   Supabase y el CDN de Vercel cachea un año (los nombres llevan marca de tiempo, son inmutables).
   Supabase solo se toca la PRIMERA vez que alguien pide cada foto.
   La base NO cambia: las URLs siguen guardadas completas y esto traduce al leer. Si algo sale
   mal, se quita esta función y todo vuelve a como estaba. */
const SB_FOTOS='/storage/v1/object/public/product-images/';
function imgCdn(u){
  const s=String(u||'');
  if(!s)return s;
  const i=s.indexOf(SB_FOTOS);
  return i===-1 ? s : '/img/'+s.slice(i+SB_FOTOS.length);
}
/* Reescribe TODAS las URLs de Supabase dentro de un objeto/arreglo, sin importar cómo se llame
   el campo (img, img_desktop, foto, urls sueltas…). Los ajustes traen fotos con nombres de campo
   distintos en cada bloque —testimonios, lanzamientos, banners— y la portada pesaba 3,2 MB por
   visitante nuevo saliendo directo de Supabase. Esto los cubre todos sin ir campo por campo. */
function imgCdnDeep(v){
  if(typeof v==='string')return imgCdn(v);
  if(Array.isArray(v))return v.map(imgCdnDeep);
  if(v&&typeof v==='object'){const o={};for(const k in v)o[k]=imgCdnDeep(v[k]);return o;}
  return v;
}

/* ── CUPONES ── */
// Cada cupón aplica SOBRE el subtotal de producto (nunca sobre el flete).
// 'pct' = porcentaje (val=0.05 → 5%); 'fijo' = monto en pesos (val=20000 → -$20.000).
const CUPONES={
  GRACIAS5:     {tipo:'pct', val:0.05,  lbl:'5%'},          // regalo post-compra
  BIENVENIDO20: {tipo:'fijo',val:20000, lbl:'$20.000'}      // popup de bienvenida (primera compra)
};

let cuponAplicado=null;

// null o el CÓDIGO aplicado (string)
// ¿Es un código de bienvenida? El genérico (suscriptores viejos) o el ÚNICO por suscriptor
// (BIENVENIDO20-XXXXX) que entrega el popup. Ambos descuentan lo de la entrada BIENVENIDO20;
// si el código de verdad existe, no está usado y no venció lo decide SIEMPRE el servidor.
function esCodigoBienvenida(code){return /^BIENVENIDO20(-[A-Z0-9]{4,6})?$/.test(code||'');}

// Descuento real para un subtotal dado, según el cupón aplicado. Nunca deja el subtotal negativo.
// El código de bienvenida tiene vigencia de 7 días desde el registro (welcomeVencido) — el server replica la regla.
function cuponDesc(sub){
  const key=cuponAplicado&&(esCodigoBienvenida(cuponAplicado)?'BIENVENIDO20':cuponAplicado);
  const c=key&&CUPONES[key];if(!c)return 0;
  if(esCodigoBienvenida(cuponAplicado)&&typeof welcomeVencido==='function'&&welcomeVencido())return 0;
  return c.tipo==='pct'?Math.round(sub*c.val):Math.min(c.val,sub);
}

const escHtml=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ── CATÁLOGO COMPLETO (vista a pantalla completa) + PREVIEW del inicio ── */
/* Bloqueo de scroll del fondo (iOS no respeta body{overflow:hidden}: hay que fijar el body).
   Ref-contado para soportar modales apilados (ej. ficha → carrito). */
let _slCount=0,_slY=0;

function lockScroll(){
  if(_slCount++>0)return;
  _slY=window.scrollY||document.documentElement.scrollTop||0;
  const b=document.body.style;
  b.position='fixed';b.top=(-_slY)+'px';b.left='0';b.right='0';b.width='100%';b.overflow='hidden';
}

function unlockScroll(){
  if(_slCount<=0)return;
  if(--_slCount>0)return;
  const b=document.body.style;
  b.position='';b.top='';b.left='';b.right='';b.width='';b.overflow='';
  window.scrollTo(0,_slY);
}

let _toastT=null;

function toast(msg){
  const t=$('toast');if(!t)return;
  t.textContent=msg;t.classList.add('on');
  clearTimeout(_toastT);_toastT=setTimeout(()=>t.classList.remove('on'),2000);
}

function loadConfig(){
  try{
    const c=JSON.parse(localStorage.getItem('ss_config')||'{}');
    if(c.wa)WA=c.wa;
    if(c.nombre)STORE_NAME=c.nombre;
    if(c.pixelId)PIXEL_ID=c.pixelId;
    if(c.wompiPk)WOMPI_PK=c.wompiPk;
    if(c.clarityId)CLARITY_ID=c.clarityId;
    applyStoreName();
    const setMeta=(id,val)=>{const el=document.getElementById(id);if(el)el.content=val;};
    setMeta('ogSite',STORE_NAME);
    setMeta('ogTitle',STORE_NAME+' — Sneakers exclusivos');
    setMeta('ogDesc','Catálogo de sneakers. Paga por WhatsApp, recibe en casa.');
    setMeta('ogUrl',location.href.split('?')[0]);
    const cfgPx=$('cfgPixel');if(cfgPx)cfgPx.value=PIXEL_ID;
    const cfgWo=$('cfgWompi');if(cfgWo)cfgWo.value=WOMPI_PK;
    const cfgCl=$('cfgClarity');if(cfgCl)cfgCl.value=CLARITY_ID;
    initPixel();
    if(CLARITY_ID)_injectClarity(CLARITY_ID);
  }catch(e){}
}

function applyStoreName(){
  // El encabezado del nav es marca fija "CATALOGO SNEAKERS" (no se sobreescribe con store_name).
  // El título lo gobierna el router (capa abierta = su título; sin capas = STORE_NAME).
  navApplyMeta();
}

/* ── PERSISTENCIA ── */
function saveState(){
  try{
    localStorage.setItem('ss_orders',JSON.stringify(orders));
  }catch(e){}
}

async function loadState(){
  try{
    const [{ data: pRows }, { data: lRows }, { data: sRows }] = await Promise.all([
      sb.from('products').select('*').order('id'),
      sb.from('liq_products').select('*').order('id'),
      sb.from('settings').select('*')
    ]);
    prods=(pRows||[]).map(r=>({
      id:r.id, g:r.gender, brand:r.brand||'', modelo:r.modelo||'', img:imgCdn(r.img_url),
      imgs:r.imgs?JSON.parse(r.imgs).map(imgCdn):[],
      tallas:r.tallas||null,   // jsonb {talla:stock} | null = sin rastreo (deriva por género)
      price:r.price, was:r.price_before, promo:r.promo, sold:r.sold
    }));
    liqs=(lRows||[]).map(r=>({
      id:r.id, modelo:r.modelo||'', img:imgCdn(r.img_url),
      imgs:r.imgs?JSON.parse(r.imgs).map(imgCdn):[],
      tallas:r.tallas||null,
      price:r.price, was:r.price_before, sold:r.sold
    }));
    const cfg=Object.fromEntries((sRows||[]).map(r=>[r.key,r.value]));
    promoG=cfg.promo_global==='true';
    bannerOn=cfg.banner_on==='true';
    WELCOME_ON=cfg.welcome_popup!=='false';   // activo por defecto; admin puede apagarlo
    {const sw=$('swWelcome');if(sw)sw.checked=WELCOME_ON;}
    try{heroSlides=imgCdnDeep(JSON.parse(cfg.hero_slides||'[]'));}catch(e){heroSlides=[];}
    try{const cb=cfg.combos?JSON.parse(cfg.combos):null;if(Array.isArray(cb)&&cb.length)combos=cb;}catch(e){}
    restaurarCombo();
    try{featuredIds=JSON.parse(cfg.featured_ids||'[]');}catch(e){featuredIds=[];}
    try{bannerMujer=cfg.banner_mujer?imgCdnDeep(JSON.parse(cfg.banner_mujer)):null;}catch(e){bannerMujer=null;}
    try{bannerHombre=cfg.banner_hombre?imgCdnDeep(JSON.parse(cfg.banner_hombre)):null;}catch(e){bannerHombre=null;}
    try{bannerUnisex=cfg.banner_unisex?imgCdnDeep(JSON.parse(cfg.banner_unisex)):null;}catch(e){bannerUnisex=null;}
    try{socials=cfg.socials?JSON.parse(cfg.socials):{ig:'',tiktok:'',fb:''};}catch(e){socials={ig:'',tiktok:'',fb:''};}
    // La marquilla se ve en cada ficha y en cada selector rápido: por el CDN, no directo a Supabase.
    try{sizeGuide=cfg.size_guide?imgCdnDeep(JSON.parse(cfg.size_guide)):null;}catch(e){sizeGuide=null;}
    reviewsCount=parseInt(cfg.reviews_count)||0;
    {const r=$('cfgReviews');if(r)r.value=reviewsCount||'';}
    try{testimonios=imgCdnDeep(JSON.parse(cfg.testimonios||'[]'));}catch(e){testimonios=[];}
    {const a=$('cfgIg');if(a)a.value=socials.ig||'';const b=$('cfgTiktok');if(b)b.value=socials.tiktok||'';const c=$('cfgFb');if(c)c.value=socials.fb||'';}
    if(cfg.store_name)STORE_NAME=cfg.store_name;
    if(cfg.wa)WA=cfg.wa;
    if(cfg.pixel_id)PIXEL_ID=cfg.pixel_id;
    if(cfg.wompi_pk)WOMPI_PK=cfg.wompi_pk;
    if(cfg.clarity_id)CLARITY_ID=cfg.clarity_id;
    applyStoreName();
    const firstImg=(prods.find(p=>p.img)||liqs.find(p=>p.img))?.img;
    if(firstImg){const el=document.getElementById('ogImg');if(el)el.content=firstImg;}
    const cfgW=$('cfgWA');if(cfgW)cfgW.value=WA;
    const cfgPx=$('cfgPixel');if(cfgPx)cfgPx.value=PIXEL_ID;
    const cfgWo=$('cfgWompi');if(cfgWo)cfgWo.value=WOMPI_PK;
    const cfgCl=$('cfgClarity');if(cfgCl)cfgCl.value=CLARITY_ID;
    initPixel();
    if(CLARITY_ID)_injectClarity(CLARITY_ID);
  }catch(e){console.warn('loadState error:',e);}
}
