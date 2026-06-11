/* ═══ ROUTER SPA ═══ URLs por vista + botón atrás que cierra capas (History API). ═══ */

/* ── ROUTER SPA (History API) ──
   Las "vistas" (ficha, carrito, catálogo, info, legal…) son overlays; este mini-router les da
   URL propia y hace que el botón ATRÁS cierre la capa de arriba en vez de salir del sitio
   (clave en el navegador de Instagram). Modelo: pila _layers = capas abiertas en orden; cada
   open hace navPush y cada close navRemove; los cambios de historial se COMMITEAN en un
   microtask (batch) → los flujos compuestos (cerrar ficha + abrir carrito en el mismo tick)
   quedan en UN solo replaceState, sin razas pushState/back. Capas sin URL (360, testimonios,
   guía, menú) igual entran a la pila: consumen un "atrás" y heredan la URL de abajo. */
const _layers=[];

// {key,url,title,doClose}
let _navPopping=false,_navCommitQ=false;

function _histD(){return (history.state&&typeof history.state.d==='number')?history.state.d:0;}

function _navState(){ // URL y título según la capa con ruta más arriba de la pila
  let url='/',title=STORE_NAME;
  for(const l of _layers){if(l.url)url=l.url;if(l.title)title=l.title;}
  return {url,title};
}

function navApplyMeta(){
  const s=_navState();
  document.title=s.title;
  const og=$('ogUrl');if(og)og.content='https://strangesneakers.com'+s.url;
  const can=document.querySelector('link[rel="canonical"]');if(can)can.href='https://strangesneakers.com'+s.url.split('?')[0];
}

function navCommit(){
  if(_navCommitQ)return;_navCommitQ=true;
  queueMicrotask(()=>{
    _navCommitQ=false;
    if(_navPopping)return;
    const want=_layers.length,have=_histD();
    if(want>have){
      for(let i=have;i<want;i++){ // pushState es síncrono → se pueden apilar varias de una
        let url='/';for(let j=0;j<=i;j++)if(_layers[j]&&_layers[j].url)url=_layers[j].url;
        history.pushState({d:i+1},'',url);
      }
    }else if(want<have){
      history.go(want-have); // el popstate posterior solo re-sincroniza (profundidades ya iguales)
      navApplyMeta();return;
    }
    const s=_navState();
    history.replaceState({d:want},'',s.url);
    navApplyMeta();
  });
}

function navPush(key,url,title,doClose){
  const i=_layers.map(l=>l.key).lastIndexOf(key);
  if(i>=0){_layers[i].url=url;_layers[i].title=title;} // re-abrir/filtrar la misma capa = actualizar
  else _layers.push({key,url,title,doClose});
  navCommit();
}

function navRemove(key){
  const i=_layers.map(l=>l.key).lastIndexOf(key);
  if(i<0)return;
  _layers.splice(i,1);
  navCommit();
}

window.addEventListener('popstate',e=>{
  const d=(e.state&&typeof e.state.d==='number')?e.state.d:0;
  if(d<_layers.length){ // ATRÁS del usuario (o go(-n)): cerrar capas hasta esa profundidad
    _navPopping=true;
    while(_layers.length>d){const l=_layers.pop();try{l.doClose();}catch(_){}}
    _navPopping=false;
  }
  const s=_navState();
  history.replaceState({d:_layers.length},'',s.url); // auto-cura cualquier desfase
  navApplyMeta();
});

// El estado inicial del historial debe tener profundidad 0
if(!history.state||typeof history.state.d!=='number')history.replaceState({d:0},'',location.href);

function _slug(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);}

function navProdUrl(id,type,p){const sl=_slug(p&&p.modelo);return '/p/'+(type==='liq'?'L':'')+id+(sl?'-'+sl:'');}

function navCatUrl(){
  const g=gSel==='h'?'/hombre':gSel==='m'?'/mujer':gSel==='liq'?'/ofertas':'';
  return '/catalogo'+g+(brandSel&&brandSel!=='all'?'?marca='+encodeURIComponent(brandSel):'');
}

function navUpdateCat(){ // al filtrar dentro del catálogo abierto, refrescar su URL
  const i=_layers.map(l=>l.key).lastIndexOf('cat');
  if(i>=0){_layers[i].url=navCatUrl();navCommit();}
}

function checkDeepLink(){
  const params=new URLSearchParams(location.search);
  // ── Rutas SPA (path): /p/126, /carrito, /catalogo/hombre, /mayoristas, /cambios, /legal/x ──
  // Al aterrizar directo en una ruta de capa se inyecta el home DEBAJO en el historial →
  // el botón ATRÁS lleva al catálogo, no de vuelta a Instagram/WhatsApp.
  const _path=location.pathname;
  if(_path!=='/'&&_path!=='/index.html'){
    const seg=_path.split('/').filter(Boolean);
    const enter=fn=>{history.replaceState({d:0},'','/');setTimeout(fn,250);};
    const home=()=>history.replaceState({d:0},'','/');
    if(seg[0]==='p'&&seg[1]){
      const m=seg[1].match(/^(L?)(\d+)/i);
      const id=m?parseInt(m[2]):0;
      const liq=!!(m&&m[1].toUpperCase()==='L');
      const p=id?(liq?liqs.find(x=>x.id===id):prods.find(x=>x.id===id)):null;
      if(p){enter(()=>openPhoto(id,liq?'liq':'cat'));}else home();
      return;
    }
    if(seg[0]==='carrito'){enter(()=>openCart());return;}
    if(seg[0]==='catalogo'){
      const g={hombre:'h',mujer:'m',ofertas:'liq'}[seg[1]]||'all';
      const marca=params.get('marca');
      enter(()=>openCatalog(marca?{brand:marca}:{gender:g}));
      return;
    }
    if(seg[0]==='mayoristas'){enter(()=>openInfo('mayoristas'));return;}
    if(seg[0]==='cambios'){enter(()=>openInfo('cambios'));return;}
    if(seg[0]==='legal'&&['privacidad','terminos','cookies','garantias'].includes(seg[1])){const k=seg[1];enter(()=>openLegal(k));return;} // claves fijas (legalContent vive en extras.js)
    home(); // ruta desconocida → home
    return;
  }
  // Entrada secreta al panel: ?admin abre el admin (pide PIN como siempre) y limpia la URL.
  if(params.has('admin')){
    history.replaceState(null,'',location.pathname);
    setTimeout(()=>openAdmin(),200);
    return;
  }
  // Guía de cuidado: REGALO EXCLUSIVO de compradores. Solo se abre con el token del ticket
  // de WhatsApp (?regalo=cuidado). No hay acceso público en la tienda.
  if(params.get('regalo')==='cuidado'){
    history.replaceState(null,'',location.pathname);
    setTimeout(()=>openGuia(),200);
    return;
  }
  if(params.get('wompi')||params.get('bold'))return; // retorno de pasarela, no es un producto
  const id=parseInt(params.get('id'));
  if(!id)return;
  const requestedType=params.get('type');
  const inLiq=requestedType==='liq'?liqs.find(x=>x.id===id):null;
  const inCat=requestedType==='cat'?prods.find(x=>x.id===id):null;
  const fallbackCat=prods.find(x=>x.id===id);
  const fallbackLiq=liqs.find(x=>x.id===id);
  const p=inLiq||inCat||fallbackCat||fallbackLiq;
  if(!p)return;
  const type=(inLiq||(!inCat&&!fallbackCat&&fallbackLiq))?'liq':'cat';
  history.replaceState({d:0},'','/'); // normalizar el legacy ?type=&id= (la ficha pondrá /p/...)
  setTimeout(()=>openPhoto(id,type),300);
}
