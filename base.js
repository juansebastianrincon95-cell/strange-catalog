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

// modo 360 del ADMIN al subir fotos
let v360Id=null,v360Type=null,v360Pos=0,v360Dragging=false,v360LastX=0,_preview360Frames=null,_v360Images=[];

let orders=[];

let SHEETS_URL='';

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

/* ── CUPONES ── */
// Cada cupón aplica SOBRE el subtotal de producto (nunca sobre el flete).
// 'pct' = porcentaje (val=0.05 → 5%); 'fijo' = monto en pesos (val=20000 → -$20.000).
const CUPONES={
  GRACIAS5:     {tipo:'pct', val:0.05,  lbl:'5%'},          // regalo post-compra
  BIENVENIDO20: {tipo:'fijo',val:20000, lbl:'$20.000'}      // popup de bienvenida (primera compra)
};

let cuponAplicado=null;

// null o el CÓDIGO aplicado (string)
// Descuento real para un subtotal dado, según el cupón aplicado. Nunca deja el subtotal negativo.
// BIENVENIDO20 tiene vigencia de 7 días desde el registro (welcomeVencido) — el server replica la regla.
function cuponDesc(sub){
  const c=cuponAplicado&&CUPONES[cuponAplicado];if(!c)return 0;
  if(cuponAplicado==='BIENVENIDO20'&&typeof welcomeVencido==='function'&&welcomeVencido())return 0;
  return c.tipo==='pct'?Math.round(sub*c.val):Math.min(c.val,sub);
}

const escHtml=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ── CATÁLOGO COMPLETO (vista a pantalla completa) + PREVIEW del inicio ── */
/* Bloqueo de scroll del fondo (iOS no respeta body{overflow:hidden}: hay que fijar el body).
   Ref-contado para soportar modales apilados (ej. visor 360 → carrito). */
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
    if(c.sheetsUrl)SHEETS_URL=c.sheetsUrl;
    if(c.pixelId)PIXEL_ID=c.pixelId;
    if(c.wompiPk)WOMPI_PK=c.wompiPk;
    if(c.clarityId)CLARITY_ID=c.clarityId;
    applyStoreName();
    const setMeta=(id,val)=>{const el=document.getElementById(id);if(el)el.content=val;};
    setMeta('ogSite',STORE_NAME);
    setMeta('ogTitle',STORE_NAME+' — Sneakers exclusivos');
    setMeta('ogDesc','Catálogo de sneakers. Paga por WhatsApp, recibe en casa.');
    setMeta('ogUrl',location.href.split('?')[0]);
    const cfgS=$('cfgSheets');if(cfgS)cfgS.value=SHEETS_URL;
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
      id:r.id, g:r.gender, brand:r.brand||'', modelo:r.modelo||'', img:r.img_url,
      imgs360:r.imgs_360?JSON.parse(r.imgs_360):[],
      imgs:r.imgs?JSON.parse(r.imgs):[],
      price:r.price, was:r.price_before, promo:r.promo, sold:r.sold
    }));
    liqs=(lRows||[]).map(r=>({
      id:r.id, modelo:r.modelo||'', img:r.img_url,
      imgs360:r.imgs_360?JSON.parse(r.imgs_360):[],
      imgs:r.imgs?JSON.parse(r.imgs):[],
      price:r.price, was:r.price_before, sold:r.sold
    }));
    const cfg=Object.fromEntries((sRows||[]).map(r=>[r.key,r.value]));
    promoG=cfg.promo_global==='true';
    bannerOn=cfg.banner_on==='true';
    WELCOME_ON=cfg.welcome_popup!=='false';   // activo por defecto; admin puede apagarlo
    {const sw=$('swWelcome');if(sw)sw.checked=WELCOME_ON;}
    try{heroSlides=JSON.parse(cfg.hero_slides||'[]');}catch(e){heroSlides=[];}
    try{const cb=cfg.combos?JSON.parse(cfg.combos):null;if(Array.isArray(cb)&&cb.length)combos=cb;}catch(e){}
    restaurarCombo();
    try{featuredIds=JSON.parse(cfg.featured_ids||'[]');}catch(e){featuredIds=[];}
    try{bannerMujer=cfg.banner_mujer?JSON.parse(cfg.banner_mujer):null;}catch(e){bannerMujer=null;}
    try{bannerHombre=cfg.banner_hombre?JSON.parse(cfg.banner_hombre):null;}catch(e){bannerHombre=null;}
    try{bannerUnisex=cfg.banner_unisex?JSON.parse(cfg.banner_unisex):null;}catch(e){bannerUnisex=null;}
    try{socials=cfg.socials?JSON.parse(cfg.socials):{ig:'',tiktok:'',fb:''};}catch(e){socials={ig:'',tiktok:'',fb:''};}
    try{sizeGuide=cfg.size_guide?JSON.parse(cfg.size_guide):null;}catch(e){sizeGuide=null;}
    reviewsCount=parseInt(cfg.reviews_count)||0;
    {const r=$('cfgReviews');if(r)r.value=reviewsCount||'';}
    try{testimonios=JSON.parse(cfg.testimonios||'[]');}catch(e){testimonios=[];}
    {const a=$('cfgIg');if(a)a.value=socials.ig||'';const b=$('cfgTiktok');if(b)b.value=socials.tiktok||'';const c=$('cfgFb');if(c)c.value=socials.fb||'';}
    if(cfg.store_name)STORE_NAME=cfg.store_name;
    if(cfg.wa)WA=cfg.wa;
    if(cfg.pixel_id)PIXEL_ID=cfg.pixel_id;
    if(cfg.sheets_url)SHEETS_URL=cfg.sheets_url;
    if(cfg.wompi_pk)WOMPI_PK=cfg.wompi_pk;
    if(cfg.clarity_id)CLARITY_ID=cfg.clarity_id;
    applyStoreName();
    const firstImg=(prods.find(p=>p.img)||liqs.find(p=>p.img))?.img;
    if(firstImg){const el=document.getElementById('ogImg');if(el)el.content=firstImg;}
    const cfgW=$('cfgWA');if(cfgW)cfgW.value=WA;
    const cfgPx=$('cfgPixel');if(cfgPx)cfgPx.value=PIXEL_ID;
    const cfgS=$('cfgSheets');if(cfgS)cfgS.value=SHEETS_URL;
    const cfgWo=$('cfgWompi');if(cfgWo)cfgWo.value=WOMPI_PK;
    const cfgCl=$('cfgClarity');if(cfgCl)cfgCl.value=CLARITY_ID;
    initPixel();
    if(CLARITY_ID)_injectClarity(CLARITY_ID);
  }catch(e){console.warn('loadState error:',e);}
}
