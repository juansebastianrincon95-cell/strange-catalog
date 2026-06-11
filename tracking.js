/* ═══ TRACKING ═══ Meta Pixel (px/trackEvent) + captura de UTM/fbclid/contexto.
   Carga después de base; antes que la tienda (todo lo demás lo usa). ═══ */

/* ── META PIXEL ── */
function initPixel(){
  if(!PIXEL_ID||window._pixelLoaded)return;
  window._pixelLoaded=true;
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window,document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init',PIXEL_ID);
  fbq('track','PageView');
}

function _injectClarity(id){
  if(document.getElementById('clarity-script'))return;
  const s=document.createElement('script');
  s.id='clarity-script';
  s.type='text/javascript';
  s.textContent=`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${id}");`;
  document.head.appendChild(s);
}

function px(event,params,eid){
  if(typeof fbq==='function')fbq('track',event,params||{},{eventID:eid||SESSION_ID+'_'+event});
}

// ID de producto para Pixel/CAPI: MISMO formato que el feed de Meta (cat_34 / liq_34) —
// si no coinciden, Meta no asocia los eventos al catálogo (FASE M, plan Codex).
function pxId(type,id){return (type==='liq'?'liq_':'cat_')+String(id).replace(/^L/i,'');}

function trackEvent(type,extra={}){
  const utm=getUTM();
  const ctx=getVisitCtx();
  // Atribución completa: cada evento del funnel lleva campaña/conjunto/anuncio + landing/device.
  fetch('/api/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    session_id:SESSION_ID,type,
    utm_source:utm.utm_source||null,utm_medium:utm.utm_medium||null,utm_campaign:utm.utm_campaign||null,
    utm_content:utm.utm_content||null,utm_term:utm.utm_term||null,
    campaign_id:utm.campaign_id||null,adset_id:utm.adset_id||null,ad_id:utm.ad_id||null,
    landing:ctx.landing||null,device:ctx.device||null,
    referrer:getReferrer()||null,...extra})}).catch(()=>{});
}

/* ── UTM ── */
function captureUTM(){
  const p=new URLSearchParams(window.location.search);
  // campaign_id/adset_id/ad_id llegan si los anuncios usan los parámetros dinámicos de Meta
  // ({{campaign.id}} etc. en "Parámetros de URL" del anuncio) → ROAS por anuncio.
  const keys=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','campaign_id','adset_id','ad_id'];
  const utm={};
  keys.forEach(k=>{const v=p.get(k);if(v&&!v.startsWith('{{'))utm[k]=v;});   // ignora placeholders sin reemplazar
  // fbclid: clic desde un anuncio de Meta. Se persiste para atribución (cookie _fbc la deriva el Pixel).
  const fbclid=p.get('fbclid');
  if(fbclid)localStorage.setItem('ss_fbclid',fbclid);
  if(Object.keys(utm).length)localStorage.setItem('ss_utm',JSON.stringify(utm));
  // Landing inicial: primera URL con la que llegó el visitante (una sola vez por visitante).
  if(!localStorage.getItem('ss_landing'))localStorage.setItem('ss_landing',(location.pathname+location.search).slice(0,300));
}

// Contexto de visita para el admin: landing inicial + tipo de dispositivo + app de origen.
// Viaja dentro de order.utm (jsonb) — sin migración.
function getVisitCtx(){
  return {
    landing: localStorage.getItem('ss_landing')||null,
    device: (navigator.maxTouchPoints>0&&matchMedia('(max-width:820px)').matches)?'movil':'escritorio',
    src_app: detectSrcApp()
  };
}

/* App de origen del visitante. Señal 1 (la más confiable): el navegador interno de cada app se
   identifica en el User-Agent — los clics en IG/FB/Messenger/WhatsApp-iOS/TikTok abren ahí.
   Señal 2: referrer (en vivo, o el primero guardado en ss_ref). Messenger va ANTES que el check
   genérico de Facebook porque su UA también contiene FBAN. Limitación: WhatsApp en Android abre
   el navegador externo sin referrer → sale 'directo'. */
function detectSrcApp(){
  const ua=navigator.userAgent||'';
  if(/Instagram/i.test(ua))return 'instagram';
  if(/FBAN\/Messenger|MessengerLite|Orca-/i.test(ua))return 'messenger';
  if(/FBAN|FBAV|FB_IAB|FB4A|FBIOS/i.test(ua))return 'facebook';
  if(/WhatsApp/i.test(ua))return 'whatsapp';
  if(/TikTok|musical_ly|Bytedance/i.test(ua))return 'tiktok';
  const ref=document.referrer||getReferrer()||'';
  if(/instagram\.com/i.test(ref))return 'instagram';
  if(/facebook\.com|fb\.me|fb\.com/i.test(ref))return 'facebook';
  if(/whatsapp\.com|wa\.me/i.test(ref))return 'whatsapp';
  if(/tiktok\.com/i.test(ref))return 'tiktok';
  if(/google\./i.test(ref))return 'google';
  return ref?'web':'directo';
}

const SRC_APP_LABELS={instagram:'📸 Instagram',facebook:'📘 Facebook',messenger:'💬 Messenger',whatsapp:'💬 WhatsApp',tiktok:'🎵 TikTok',google:'🔎 Google',web:'🌐 Otro sitio',directo:'🌐 Directo / navegador'};

function srcAppLabel(v){return v?(SRC_APP_LABELS[v]||v):'';}

function getUTM(){
  try{return JSON.parse(localStorage.getItem('ss_utm')||'{}');}catch(e){return {};}
}

// Lee una cookie por nombre (para _fbp/_fbc que setea el Meta Pixel)
function getCookie(name){
  const m=document.cookie.match(new RegExp('(?:^|; )'+name.replace(/([.$?*|{}()[\]\\/+^])/g,'\\$1')+'=([^;]*)'));
  return m?decodeURIComponent(m[1]):'';
}

// Identificadores de atribución de Meta para enviar al backend (CAPI).
function getFbAttribution(){
  const a={};
  const fbp=getCookie('_fbp'); if(fbp)a.fbp=fbp;
  let fbc=getCookie('_fbc');
  // Si no hay cookie _fbc pero sí un fbclid guardado, construir el _fbc en formato Meta.
  if(!fbc){const id=localStorage.getItem('ss_fbclid');if(id)fbc='fb.1.'+Date.now()+'.'+id;}
  if(fbc)a.fbc=fbc;
  return a;
}

function captureReferrer(){
  if(document.referrer&&!localStorage.getItem('ss_ref'))
    localStorage.setItem('ss_ref',document.referrer);
}

function getReferrer(){return localStorage.getItem('ss_ref')||'';}
