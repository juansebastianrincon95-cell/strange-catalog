/* ═══ CARRITO ═══ El dinero: carrito, checkout 3 pasos, cupones/combos (pricing),
   contra entrega (WhatsApp), Wompi y Bold con sus retornos. ═══ */

/* ── COMBOS STRANGE ── bundles con precio fijo (validados también server-side) ── */
// Fallback si el admin no ha configurado settings.combos. camiseta:true = REGALO al completar
// (el campo se llama `camiseta` por historia; el texto que ve el cliente dice "regalo").
const DEFAULT_COMBOS=[
  {id:'bronce', nombre:'Combo Bronce', bandera:'🥉', pares:2, precio:379000, img:null, activo:true},
  {id:'plata',  nombre:'Combo Plata',  bandera:'🥈', pares:3, precio:549000, img:null, activo:true},
  {id:'oro',    nombre:'Combo Oro',    bandera:'🥇', pares:4, precio:700000, img:null, activo:true, camiseta:true}
];

let combos=DEFAULT_COMBOS.slice();

let comboActivo=null;

// objeto del combo elegido (o null)
let _comboCamisetaCelebrada=false;

// para disparar el toast UNA vez al completar
function restaurarCombo(){
  // El carrito NO sobrevive un refresh (vive en memoria). Si el combo sí sobreviviera
  // (sessionStorage), reaparecería su aviso al agregar un producto en una visita posterior
  // sin haberlo escogido (bug combo fantasma). Ciclo de vida unificado: el combo vive y
  // muere con el carrito. Aquí solo se limpia el residuo de pestañas con la versión vieja.
  try{sessionStorage.removeItem('ss_combo');}catch(e){}
}

function comboPares(){return Object.values(cart).reduce((s,{qty})=>s+qty,0);}

/* ── MOTOR DE DESCUENTOS (espejo del server) ──────────────────────────────────
   Aquí solo se PINTA (mismo patrón que calcFlete): el monto real lo decide SIEMPRE
   api/_orders.js con la tabla discounts. `descuentoAplicado` es la definición SANEADA que
   devolvió el server al validar el código; `descuentosAuto` son los automáticos que el server
   dijo que aplican a este carrito (se refrescan al abrir el carrito, syncDescuentosAuto). */
let descuentoAplicado=null;      // def del código validado por el server (o null)
let descuentosAuto=[];           // defs de los automáticos aplicables (según el server)
let _descEnvioGratis=false;      // el plan vigente incluye envío gratis (lo consume calcFlete)

// ¿El ítem del carrito está cubierto por el descuento? Espejo de descuentoAplicaItem del server.
// ids/marcas = UNIÓN (colecciones); generos/tipos/excluir_promo = filtros AND encima. Tiene que
// ser IDÉNTICO al server o el carrito pinta un precio que el servidor no cobra.
function _descAplicaItem(aplica,row){
  if(!aplica||typeof aplica!=='object')return true;
  const ids=Array.isArray(aplica.ids)?aplica.ids:[],marcas=Array.isArray(aplica.marcas)?aplica.marcas:[];
  const generos=Array.isArray(aplica.generos)?aplica.generos:[],tipos=Array.isArray(aplica.tipos)?aplica.tipos:[];
  if(ids.length||marcas.length){
    const key=(row.type==='liq'?'liq_':'cat_')+row.p.id;
    if(!(ids.includes(key)||(!!row.p.brand&&marcas.includes(String(row.p.brand)))))return false;
  }
  // liquidación no tiene género en la BD → gender null, nunca matchea un filtro de género
  const g=row.type==='liq'?null:(row.p.g||null);
  if(generos.length&&!generos.includes(g))return false;
  if(tipos.length&&!tipos.includes(row.type==='liq'?'liq':'cat'))return false;
  if(aplica.excluir_promo&&(row.p.promo||(row.p.price_before!=null&&Number(row.p.price_before)>Number(row.p.price))))return false;
  return true;
}

// Monto que descuenta `d` sobre las filas del carrito. Espejo de montoDescuento del server.
function _descMonto(d,rows,subBruto){
  const valor=Math.max(0,parseInt(d.valor)||0),pct=Math.min(valor,100);
  if(d.tipo==='pedido')return d.valor_tipo==='pct'?Math.round(subBruto*pct/100):Math.min(valor,subBruto);
  if(d.tipo==='producto'){
    const cub=rows.filter(r=>_descAplicaItem(d.aplica,r));
    const base=cub.reduce((s,r)=>s+r.p.price*r.qty,0);
    if(base<=0)return 0;
    if(d.valor_tipo==='pct')return Math.round(base*pct/100);
    if(d.valor_alcance==='articulo')return cub.reduce((s,r)=>s+Math.min(valor,r.p.price)*r.qty,0);
    return Math.min(valor,base);
  }
  if(d.tipo==='bogo'){
    const b=d.bogo||{},compra=parseInt(b.compra),lleva=parseInt(b.lleva),bp=Math.min(Math.max(parseInt(b.pct)||100,1),100);
    if(!(compra>0)||!(lleva>0))return 0;
    const u=[];rows.forEach(r=>{if(_descAplicaItem(d.aplica,r))for(let i=0;i<r.qty;i++)u.push(r.p.price);});
    const g=Math.floor(u.length/(compra+lleva));if(g<=0)return 0;
    u.sort((a,c)=>a-c);
    return Math.round(u.slice(0,g*lleva).reduce((s,x)=>s+x,0)*bp/100);
  }
  return 0;   // 'envio' no toca producto (apaga el flete)
}

/* Plan de descuentos para pintar: misma regla de combinación del server (todos los combinables
   juntos VS el mejor no-combinable solo; envío gratis en pista aparte). Los mínimos se
   re-chequean aquí para que el descuento aparezca/desaparezca en vivo al cambiar cantidades. */
function calcDescuentosFront(rows,subBruto,pares){
  const defs=[];
  if(descuentoAplicado)defs.push(descuentoAplicado);
  (descuentosAuto||[]).forEach(d=>{if(!defs.some(x=>x.id===d.id))defs.push(d);});
  const ok=defs.filter(d=>{
    if(parseInt(d.min_monto)>0&&subBruto<parseInt(d.min_monto))return false;
    if(parseInt(d.min_items)>0&&pares<parseInt(d.min_items))return false;
    return true;
  });
  const precio=[],envios=[];
  ok.forEach(d=>{
    if(d.tipo==='envio'){envios.push(d);return;}
    const m=Math.min(_descMonto(d,rows,subBruto),subBruto);
    if(m>0)precio.push({d,m});
  });
  const combi=precio.filter(c=>c.d.combinable),solos=precio.filter(c=>!c.d.combinable).sort((a,b)=>b.m-a.m);
  const sumCombi=Math.min(combi.reduce((s,c)=>s+c.m,0),subBruto);
  let plan=!solos.length?combi:(!combi.length?[solos[0]]:(sumCombi>=solos[0].m?combi:[solos[0]]));
  const envioOk=envios.find(d=>d.combinable||(!plan.length&&envios.length===1));
  const monto=Math.min(plan.reduce((s,c)=>s+c.m,0),subBruto);   // NUNCA subtotal negativo
  const tag=plan.map(c=>c.d.codigo||c.d.nombre||'Promo').concat(envioOk?[envioOk.codigo||envioOk.nombre||'Envío gratis']:[]).join(' + ');
  return {monto,envioGratis:!!envioOk,tag:tag||null};
}

// PRECIOS DEL CARRITO centralizados: combo (precio fijo, sin cupón) o flujo normal con cupón.
// Único lugar donde se decide el subtotal — lo usan carrito, paso 3, WhatsApp, Wompi y Bold.
function cartPricing(rows){
  rows=rows||Object.values(cart);
  const subBruto=rows.reduce((s,{p,qty})=>s+p.price*qty,0);
  const pares=rows.reduce((s,{qty})=>s+qty,0);
  const combo=(comboActivo&&comboActivo.activo!==false&&pares===parseInt(comboActivo.pares))?comboActivo:null;
  let desc=combo?0:cuponDesc(subBruto);
  // Etiqueta de lo que descuenta (para el resumen y el mensaje de WhatsApp)
  let descTag=desc>0?cuponAplicado:null;
  _descEnvioGratis=false;
  // Motor nuevo: solo sin combo y sin cupón legacy efectivo (los legacy nunca se combinan).
  // Igual que el server: si hay combo o legacy, el motor ni se mira.
  if(!combo&&desc===0){
    const e=calcDescuentosFront(rows,subBruto,pares);
    desc=Math.min(e.monto,subBruto);
    _descEnvioGratis=e.envioGratis;
    if(desc>0||e.envioGratis)descTag=e.tag;
  }
  const sub=combo?parseInt(combo.precio):(subBruto-desc);
  return {subBruto,pares,combo,desc,descTag,sub,camiseta:!!(combo&&combo.camiseta)};
}

// Tarjetas de combos en la sección Ofertas
function renderCombos(){
  const box=$('combosRow');if(!box)return;
  const activos=(combos||[]).filter(c=>c&&c.activo!==false);
  if(!activos.length){box.innerHTML='';return;}
  box.innerHTML=`<div style="padding:10px 14px 0"><div style="font-size:17px;font-weight:800;color:var(--ink);letter-spacing:-.01em">🏆 Sube de nivel</div><div style="font-size:11.5px;color:var(--ink2);margin-top:2px">Entre más pares, menos pagas por cada uno</div></div>
  <div class="combos-grid">${activos.map(c=>{
    // Con FOTO: la imagen trae todo el diseño (medalla, pares, precio, regalo) → solo se
    // añade la franja CTA. <picture> sirve la versión escritorio en pantallas ≥700px.
    if(c.img||c.img_desktop){
      const movil=c.img||c.img_desktop, desk=c.img_desktop||c.img;
      return `<div class="combo-card foto" onclick="activarCombo('${escHtml(c.id)}')">
        <picture>${desk!==movil?`<source media="(min-width:700px)" srcset="${escHtml(desk)}">`:''}<img src="${escHtml(movil)}" alt="${escHtml(c.nombre)}" loading="lazy"></picture>
        <div class="combo-cta-strip">Armar ${escHtml(c.nombre)} →</div>
      </div>`;
    }
    return `<div class="combo-card" onclick="activarCombo('${escHtml(c.id)}')">
      <div class="combo-flag">${c.bandera||'🏆'}</div>
      <div class="combo-nom">${escHtml(c.nombre)}</div>
      <div class="combo-det">${c.pares} pares a tu elección</div>
      <div class="combo-precio">${fmt(parseInt(c.precio))}</div>
      ${c.camiseta?`<div class="combo-cami">+ 🎁 REGALO GRATIS</div>`:''}
      <div class="combo-cta">Armar combo →</div>
    </div>`;
  }).join('')}</div>`;
}

function activarCombo(id){
  const c=(combos||[]).find(x=>x&&x.id===id&&x.activo!==false);if(!c)return;
  comboActivo=c;_comboCamisetaCelebrada=false;
  trackEvent('view_product',{product_id:'combo_'+c.id});
  openCatalog({gender:'all'});
  renderComboBar();
  toast(`🏆 ${c.nombre} activo — escoge ${c.pares} modelos`);
}

// Aplicar combo desde la SUGERENCIA del carrito: el cliente ya tiene los pares,
// no hay que navegarlo al catálogo (a diferencia de activarCombo).
function aplicarComboSug(id){
  const c=(combos||[]).find(x=>x&&x.id===id&&x.activo!==false);if(!c)return;
  comboActivo=c;_comboCamisetaCelebrada=false;
  trackEvent('view_product',{product_id:'combo_'+c.id});
  renderComboBar();
  toast(`🏆 ${c.nombre} aplicado — precio de combo`);
  rCart();
}

let _comboSugDismiss=false;

// el cliente cerró la sugerencia (por ciclo de carrito)
function cerrarComboSug(){_comboSugDismiss=true;rCart();}

// ── ESCALERA DE AHORRO + CROSS-SELL ── "compra más, ahorra más" dentro del carrito.
// Muestra la escalera de niveles (combos) con su ahorro y, debajo, modelos del mismo género
// para subir de nivel. El ahorro de cada nivel se calcula con el precio promedio del carrito
// (refUnit) — honesto: lo que pagaría a precio normal vs el precio fijo del combo.
function escaleraAhorro(rows,pricing){
  if(comboActivo)return '';                                  // con combo activo manda comboAviso
  const tiers=(combos||[]).filter(c=>c&&c.activo!==false&&parseInt(c.pares)>=2)
    .sort((a,b)=>parseInt(a.pares)-parseInt(b.pares));
  if(!tiers.length)return '';
  const tot=pricing.pares;
  const refUnit=tot>0?Math.round(pricing.subBruto/tot):199000; // precio promedio de referencia
  const maxPares=parseInt(tiers[tiers.length-1].pares);
  const next=tiers.find(t=>parseInt(t.pares)>tot);            // próximo nivel a alcanzar
  const filas=tiers.map(t=>{
    const np=parseInt(t.pares), ahorro=(np*refUnit)-parseInt(t.precio);
    const reached=tot>=np, isNext=next&&np===parseInt(next.pares);
    const ahorroTxt=ahorro>0?`ahorras ${fmt(ahorro)}`:'';
    return `<div class="esc-row${reached?' done':''}${isNext?' next':''}">
      <span class="esc-dot">${reached?'●':'○'}</span>
      <span class="esc-pares">${np} pares</span>
      <span class="esc-precio">${fmt(parseInt(t.precio))}</span>
      <span class="esc-ahorro">${ahorroTxt}${t.camiseta?' + 🎁':''}</span></div>`;
  }).join('');
  let head;
  if(next){
    const faltan=parseInt(next.pares)-tot, ahorroNext=(parseInt(next.pares)*refUnit)-parseInt(next.precio);
    head=`Agrega <b>${faltan} modelo${faltan===1?'':'s'} más</b> → ahorras <b>${fmt(ahorroNext)}</b>`;
  }else head=`🎉 ¡Llevas el máximo ahorro (${maxPares} pares)!`;
  // Botón aplicar si el nivel EXACTO está disponible y sale más barato que lo que va a pagar.
  const cand=tiers.find(t=>parseInt(t.pares)===tot);
  let applyBtn='';
  if(cand&&parseInt(cand.precio)<pricing.sub){
    applyBtn=`<button class="esc-apply" onclick="aplicarComboSug('${escHtml(cand.id)}')">Aplicar ${escHtml(cand.nombre)} ${cand.bandera||''} y ahorrar ${fmt(pricing.sub-parseInt(cand.precio))}</button>`;
  }
  return `<div class="esc-wrap">
    <div class="esc-head"><span>🔥</span><span>COMPRA MÁS, AHORRA MÁS</span></div>
    <div class="esc-sub">${head}</div>
    <div class="esc-ladder">${filas}</div>
    ${applyBtn}
    ${crossSellHTML(rows)}
  </div>`;
}

// Tira de modelos sugeridos (mismo género que el carrito) para completar el combo.
// ABREN la ficha (escoger talla es obligatorio) → no se suman a ciegas.
function crossSellHTML(rows){
  const gs=rows.map(r=>r.p&&r.p.g).filter(Boolean);
  const gen=gs.length?gs.slice().sort((a,b)=>gs.filter(x=>x===b).length-gs.filter(x=>x===a).length)[0]:null;
  const enCart=new Set(rows.map(r=>r.type+'-'+r.p.id));
  let pool=(prods||[]).filter(p=>p&&!p.sold&&!enCart.has('cat-'+p.id));
  if(gen){const same=pool.filter(p=>p.g===gen); if(same.length>=4)pool=same;}
  pool=pool.slice(0,8);
  if(!pool.length)return '';
  const cards=pool.map(p=>{
    const m=p.img?`<img src="${p.img}" alt="${altProd(p)}" loading="lazy">`:`<span style="font-size:20px">👟</span>`;
    const nom=p.modelo||(BRAND_LABELS[p.brand]||'')||(p.g==='h'?'Hombre':'Mujer');
    return `<button class="xs-card" onclick="openPhoto(${p.id},'cat')">
      <div class="xs-img">${m}</div>
      <div class="xs-nom">${escHtml(nom)}</div>
      <div class="xs-precio">${fmt(p.price)}</div>
      <div class="xs-add">+ Escoger talla</div></button>`;
  }).join('');
  return `<div class="xs-wrap"><div class="xs-title">Completa tu combo 👇</div>${crslWrap(`<div class="xs-row">${cards}</div>`)}</div>`;
}

function salirCombo(){
  comboActivo=null;_comboCamisetaCelebrada=false;
  renderComboBar();
  toast('Saliste del combo — precios normales');
  if(typeof rCart==='function'&&$('csheet')&&$('csheet').classList.contains('on')&&step===0)rCart();
}

// Barra sticky de progreso: gris=faltan · verde=completo · ámbar=excedido
function renderComboBar(){
  const bar=$('comboBar');if(!bar)return;
  if(!comboActivo){bar.style.display='none';bar.innerHTML='';bar.className='';return;}
  const n=comboPares(),N=parseInt(comboActivo.pares);
  const estado=n===N?'ok':n>N?'exceso':'';
  bar.className='combo-bar'+(estado?' '+estado:'');
  bar.style.display='flex';
  const txt=n===N
    ?`✅ ¡${escHtml(comboActivo.nombre)} COMPLETO! ${N} pares por ${fmt(parseInt(comboActivo.precio))}${comboActivo.camiseta?' + 🎁 REGALO GRATIS':''} — ve al carrito`
    :n>N
    ?`⚠️ ${escHtml(comboActivo.nombre)}: tienes ${n} pares — el combo es de ${N}. Quita ${n-N}.`
    :`🏆 ${escHtml(comboActivo.nombre)} · ${n}/${N} pares · ${fmt(parseInt(comboActivo.precio))}${comboActivo.camiseta?' + 🎁 regalo':''}`;
  bar.innerHTML=`<span>${txt}</span><button class="cb-x" onclick="salirCombo()">✕ Salir</button>`;
  // Celebración del regalo: UNA vez al completar
  if(n===N&&comboActivo.camiseta&&!_comboCamisetaCelebrada){
    _comboCamisetaCelebrada=true;
    toast('🎉 ¡Combo completo! Liberaste tu REGALO GRATIS 🎁');
  }
  if(n!==N)_comboCamisetaCelebrada=false;
}

// Motivos del server (validar_descuento) en palabras que el cliente entiende.
const DESC_MOTIVOS={
  no_existe:'Código no válido',
  inactivo:'Código no válido',
  vencido:'Este código ya venció 😢',
  aun_no_empieza:'Este código aún no está activo',
  agotado:'Este código ya alcanzó su límite de usos 😢',
  ya_usado:'Ya usaste este código en una compra anterior',
  minimo_monto:'Tu pedido aún no llega al mínimo de compra de este código',
  minimo_items:'Te faltan pares en el carrito para usar este código',
  no_aplica_productos:'Este código no aplica a los productos de tu carrito',
  no_combinable:'Este código no se puede combinar con la promoción ya aplicada',
  error:'No pudimos validar el código. Intenta de nuevo.'
};

// Ítems del carrito en el formato que valida el server (ids/cantidades — jamás precios).
function _descItemsPayload(){
  return Object.values(cart).map(({p,qty,type,talla})=>({id:p.id,type,qty,talla:talla||null}));
}

async function aplicarCupon(){
  const inp=$('cupInput');if(!inp)return;
  let code=inp.value.trim().toUpperCase();
  // El mensaje se queda hasta que el cliente vuelva a escribir. Antes se borraba solo a los 3,5 s
  // y, como el server tarda ~1,2 s en responder, la ventana real de lectura eran ~3 s: quien
  // apartaba la vista un momento veía el botón volver a "Aplicar" sin ninguna explicación.
  const cupFail=msg=>{
    const e=$('cupErr');if(!e)return;
    e.textContent=msg||'Código no válido';
    e.style.display='block';
    const i=$('cupInput');
    if(i&&!i.dataset.limpiaErr){
      i.dataset.limpiaErr='1';
      i.addEventListener('input',()=>{const x=$('cupErr');if(x){x.style.display='none';x.textContent='Código no válido';}});
    }
  };
  // El suscriptor nuevo tiene código propio (BIENVENIDO20-XXXXX, lo guarda el popup). Si teclea
  // el genérico de memoria, se sube en silencio al suyo — el server ya no acepta el genérico
  // de quien no es suscriptor identificable, y el propio siempre valida.
  if(code==='BIENVENIDO20'&&localStorage.getItem('ss_wm_code'))code=localStorage.getItem('ss_wm_code');
  if(esCodigoBienvenida(code)&&welcomeVencido())return cupFail('Tu código de bienvenida venció (era válido por 7 días) 😢');
  // Cupones legacy (bienvenida / GRACIAS5): mismo camino de siempre, sin tocar el motor.
  if(CUPONES[code]||esCodigoBienvenida(code)){descuentoAplicado=null;cuponAplicado=code;localStorage.setItem('ss_cupon',code);trackEvent('apply_coupon',{product_id:code});rCart();return;}
  if(!code)return cupFail();
  // Motor nuevo: el SERVER decide si el código vale y cuánto descuenta — el front nunca
  // inventa un monto. Si no vale, el server dice el motivo exacto (vencido, mínimo, usado…).
  const btn=document.querySelector('.cup-btn');
  if(btn){btn.disabled=true;btn.textContent='…';}
  try{
    const r=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({kind:'validar_descuento',codigo:code,items:_descItemsPayload(),session_id:SESSION_ID,utm:getUTM(),tel:(cData&&cData.celular)||null})});
    const j=r.ok?await r.json():null;
    if(j&&j.ok&&j.valido&&j.codigo){
      descuentoAplicado=j.codigo;
      descuentosAuto=Array.isArray(j.autos)?j.autos:descuentosAuto;
      cuponAplicado=code;
      localStorage.setItem('ss_cupon',code);
      trackEvent('apply_coupon',{product_id:code});
      rCart();
    }else{
      cupFail(DESC_MOTIVOS[(j&&j.motivo)||'error']||'Código no válido');
    }
  }catch(e){cupFail(DESC_MOTIVOS.error);}
  finally{if(btn){btn.disabled=false;btn.textContent='Aplicar';}}
}

/* Trae del server los descuentos AUTOMÁTICOS que aplican a este carrito (y revalida el código
   guardado si lo hay). Se llama al abrir el carrito; con la misma firma de carrito+código no
   repite el viaje. Si el server no responde, no pasa nada: el cobro real igual lo decide él. */
let _descSyncSig='';
function syncDescuentosAuto(){
  const items=_descItemsPayload();
  if(!items.length){descuentosAuto=[];_descSyncSig='';return;}
  // El código guardado que aún no tiene definición (restaurado de otra visita) se revalida aquí.
  const codePend=cuponAplicado&&!CUPONES[cuponAplicado]&&!esCodigoBienvenida(cuponAplicado)?cuponAplicado:null;
  const sig=JSON.stringify(items)+'|'+(codePend||'');
  if(sig===_descSyncSig)return;
  _descSyncSig=sig;
  fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind:'validar_descuento',codigo:codePend,items,session_id:SESSION_ID,utm:getUTM(),tel:(cData&&cData.celular)||null})})
    .then(r=>r.ok?r.json():null)
    .then(j=>{
      if(!j||!j.ok)return;
      descuentosAuto=Array.isArray(j.autos)?j.autos:[];
      if(codePend){
        if(j.valido&&j.codigo)descuentoAplicado=j.codigo;
        else{descuentoAplicado=null;cuponAplicado=null;localStorage.removeItem('ss_cupon');}   // el código guardado ya no vale
      }
      // Re-pintar si el cliente está mirando el carrito (paso 0) — el descuento aparece en vivo.
      if($('csheet')&&$('csheet').classList.contains('on')&&step===0)rCart();
    })
    .catch(()=>{});
}

// Despliega/oculta el campo de código promocional (colapsado por defecto, estilo Adidas).
function toggleCupon(){
  const b=$('cpromoBox');if(!b)return;
  const show=b.style.display==='none';
  b.style.display=show?'block':'none';
  if(show){const i=$('cupInput');if(i)i.focus();}
}

/* ── CARRITO ── */
// Clave del carrito: incluye la talla → el mismo modelo en dos tallas son dos líneas distintas.
// Sin talla (productos sin tallas cargadas) la clave es la de siempre (retrocompatible).
function cartKey(id,type,talla){return (type==='liq'?'L'+id:''+id)+(talla?'-t'+talla:'');}
// ¿El producto está en el carrito en CUALQUIER talla? (para el ✓ de la tarjeta del grid)
function enCarrito(id,type){return Object.values(cart).some(it=>it.type===type&&it.p.id===id);}
// Sincroniza la tarjeta (grid + lanzamientos + preview + recientes): ✓ si está en el carrito
// en ALGUNA talla. Separado de togCard() para poder reusarlo desde addItemToCart().
function syncCardUI(id,type){
  const anyIn=enCarrito(id,type);
  const els=type==='liq'?[$('lk'+id)]:[$('k'+id),$('kl'+id),$('kp'+id),$('kr'+id),$('kf'+id)];
  els.forEach(el=>{
    if(!el)return;
    el.classList.toggle('picked',anyIn);
    const circle=el.querySelector('.add-circle');
    if(circle)circle.textContent=anyIn?'✓':'+';
  });
}

// Agrega SIN alternar (nunca quita) ni abrir el carrito — lo usa togCard() en su rama de
// agregar, y las compras rápidas de la ficha (buyNowFicha) que saltan directo a "Tus datos"
// sin pasar por la animación/apertura normal del carrito. Devuelve false si no aplicaba
// (agotado, inexistente o ya estaba en el carrito con esa talla).
function addItemToCart(id,type,talla){
  const key=cartKey(id,type,talla);
  const list=type==='liq'?liqs:prods;
  const p=list.find(x=>x.id===id);
  if(!p||p.sold||cart[key])return false;
  cart[key]={p,qty:1,type,talla:talla||null};
  const _acat=type==='liq'?'liquidacion':p.g;
  const _anm=type==='liq'?'Liquidación':genLabel(p.g);
  px('AddToCart',{content_ids:[pxId(type,id)],content_type:'product',content_category:_acat,content_name:_anm,value:p.price,currency:'COP',...getUTM()});
  ga4('add_to_cart',{currency:'COP',value:p.price,items:[{item_id:pxId(type,id),item_name:_anm,price:p.price,quantity:1}]});   // GA4 / Google Ads
  trackEvent('add_to_cart',{product_id:String(key),price:p.price,gender:type==='liq'?null:p.g});
  startReserva();   // arranca/continúa el contador de reserva al agregar al carrito
  syncCardUI(id,type);
  syncDot();
  if(pmId===id&&pmType===type)syncPmBtn();
  return true;
}

function togCard(id,type,talla,fromEl){
  const key=cartKey(id,type,talla);
  if(cart[key]){
    delete cart[key];
    toast('Quitado del carrito');
    syncCardUI(id,type);
    syncDot();
    if(pmId===id&&pmType===type)syncPmBtn();
    return;
  }
  if(!addItemToCart(id,type,talla))return;   // no existe o está agotado
  // Si hay foto de origen, la vemos volar al carrito antes de abrirlo (si no, openCart()
  // le pone .hide al instante y tapa/mueve el ícono destino a mitad de la animación).
  const voló=typeof flyToCart==='function'&&flyToCart(fromEl);
  if(voló)setTimeout(openCart,520);else openCart();
}
// Ítems del pedido para WhatsApp/orders (incluye la talla). Único punto de construcción.
function cartItems(rows){return rows.map(({p,qty,type,talla})=>({label:p.modelo||(type==='liq'?'Liq':(p.g==='h'?'Hombre':'Mujer')),type,id:p.id,brand:p.brand||null,qty,precio:p.price*qty,talla:talla||null}));}

function syncDot(){
  const n=Object.values(cart).reduce((s,i)=>s+i.qty,0);
  const dot=$('cartBarDot');
  if(dot){dot.textContent=n;dot.classList.toggle('show',n>0);}
  const total=$('cartBarTotal');
  if(total)total.textContent=fmt(cartPricing().sub);
  renderComboBar();   // el progreso del combo sigue cada cambio del carrito
  saveCart();         // persistir el carrito en cada cambio
}

// ── CARRITO PERSISTENTE ── sobrevive refresh / cierre / regreso (localStorage).
// Guarda SOLO identificadores (id/type/talla/qty); al restaurar re-hidrata el producto desde
// prods/liqs (precio/stock FRESCOS) y descarta los que ya no existen o están agotados.
// El combo NO se persiste a propósito (evita el "combo fantasma" — ver restaurarCombo).
function saveCart(){
  try{
    const items=Object.values(cart).map(({p,qty,type,talla})=>({id:p.id,type,talla:talla||null,qty}));
    if(items.length)localStorage.setItem('ss_cart',JSON.stringify(items));
    else localStorage.removeItem('ss_cart');
  }catch(e){}
}
function restoreCart(){
  let saved;try{saved=JSON.parse(localStorage.getItem('ss_cart')||'[]');}catch(e){saved=[];}
  if(!Array.isArray(saved)||!saved.length)return;
  saved.forEach(it=>{
    const list=it.type==='liq'?liqs:prods;
    const p=(list||[]).find(x=>x.id===it.id);
    if(!p||p.sold)return;   // ya no existe o agotado → se descarta
    // Ítem sin talla cuyo producto SÍ tiene tallas (residuo de versiones viejas) → se descarta
    if(it.talla==null && typeof tallasDe==='function' && tallasDe(p).length>0)return;
    cart[cartKey(it.id,it.type,it.talla)]={p,qty:Math.max(1,parseInt(it.qty)||1),type:it.type,talla:it.talla||null};
  });
  syncDot();   // actualiza el contador; las tarjetas marcan ✓ al renderizar (via enCarrito)
}

// Rehidrata el cupón aplicado tras refresh/cierre/regreso (simétrico a restoreCart).
// Si está vencido o ya no existe, limpia el guardado para no dejar código muerto.
function restoreCupon(){
  try{
    const code=(localStorage.getItem('ss_cupon')||'').toUpperCase();
    if(!code)return;
    const vencido=esCodigoBienvenida(code)&&typeof welcomeVencido==='function'&&welcomeVencido();
    if((CUPONES[code]||esCodigoBienvenida(code))&&!vencido)cuponAplicado=code;
    // Código del motor nuevo: se restaura PROVISIONAL (sin definición no descuenta nada en
    // pantalla) y syncDescuentosAuto lo revalida contra el server al abrir el carrito —
    // si ya no vale (vencido, agotado, usado), ahí mismo se limpia.
    else if(/^[A-Z0-9_-]{3,40}$/.test(code))cuponAplicado=code;
    else localStorage.removeItem('ss_cupon');
  }catch(e){}
}

/* ── CART SHEET ── */
// El carrito se abre como confirmación al agregar (puede ser muchas veces). El evento
// InitiateCheckout NO se dispara al abrir, sino al avanzar a "Tus datos" (goStep 1), para no
// inflar el funnel de Meta. _icFired evita duplicarlo dentro de un mismo ciclo de carrito.
let _icFired=false;
// Intención de compra rápida desde la ficha ('contra_entrega'|'whatsapp'|null) — la fija
// buyNowFicha() y rPayChoice() la consume UNA vez para resaltar esa tarjeta de pago.
let _buyIntent=null;

function openCart(){
  step=0;_icFired=false;_comboSugDismiss=false;
  // La ficha y la ventana de info tienen z-index más alto que el carrito: si quedan abiertas
  // detrás (ej. el usuario le da al carrito flotante mientras ve un producto), el carrito se
  // abre invisible, tapado por lo que ya estaba abierto. El catálogo SÍ se deja abierto a
  // propósito (ver el carrito y volver a comprar donde iba es el flujo esperado).
  if(typeof closeHigherLayers==='function')closeHigherLayers();
  syncDescuentosAuto();   // pedirle al server los descuentos automáticos de ESTE carrito (async, solo pinta)
  renderStep();
  {const _cs=$('csheet');const _ya=_cs.classList.contains('on');if(!_ya)lockScroll();$('cscrim').classList.add('on');_cs.classList.add('on');}   // un bloqueo por capa (navPush deduplica)
  $('cartBar').classList.add('hide');
  navPush('carrito','/carrito','Tu carrito — '+STORE_NAME,closeCart);
}

function closeCart(){if(!_navPopping)navRemove('carrito');$('cscrim').classList.remove('on');$('csheet').classList.remove('on');unlockScroll();$('cartBar').classList.remove('hide');}

function updDots(){[0,1,2].forEach(i=>{const d=$('cs'+i);d.className='csd'+(i===step?' active':i<step?' done':'');});
  if(step===0){const n=Object.values(cart).reduce((s,i)=>s+i.qty,0);$('cttl').textContent=`Tu carrito (${n} ${n===1?'producto':'productos'})`;}
  else $('cttl').textContent=['Tu pedido','Tus datos','Pagar'][step]+`  ·  Paso ${step+1} de 3`;}

function renderStep(){updDots();[rCart,rForm,rPayChoice][step]();}

// InitiateCheckout = el cliente realmente inicia el checkout, una vez por ciclo (guard _icFired).
// Extraída para que el modal de compra rápida (compra.js) también la dispare al abrir, ya que
// ahí el cliente entra directo a "Tus datos" sin pasar por goStep(1).
function fireInitiateCheckout(){
  if(_icFired)return;
  _icFired=true;
  const cartVals=Object.values(cart);
  if(cartVals.length){
    const icTotal=cartVals.reduce((s,{p,qty})=>s+p.price*qty,0);
    const icItems=cartVals.reduce((s,{qty})=>s+qty,0);
    const icIds=cartVals.map(({p,type})=>pxId(type,p.id));
    px('InitiateCheckout',{content_ids:icIds,content_type:'product',num_items:icItems,value:icTotal,currency:'COP'});
    ga4('begin_checkout',{currency:'COP',value:icTotal,items:icIds.map(id=>({item_id:id}))});   // GA4 / Google Ads
    trackEvent('initiate_checkout',{price:icTotal});
  }
}

function goStep(n){
  if(n===1)fireInitiateCheckout();
  // reached_payment = llegó a la pantalla de métodos de pago (paso 3) — mide la fuga datos→pago.
  if(n===2)trackEvent('reached_payment');
  step=n;renderStep();$('cbody').scrollTop=0;
}

function chQty(key,d){if(!cart[key])return;cart[key].qty=Math.max(1,cart[key].qty+d);syncDot();renderStep();}

function rmItem(key){
  const it=cart[key];delete cart[key];
  if(it){
    // El ✓ solo se quita si NO queda otra talla del mismo modelo en el carrito (igual que togCard).
    const anyIn=enCarrito(it.p.id,it.type);
    const els=it.type==='liq'?[$('lk'+it.p.id)]:[$('k'+it.p.id),$('kl'+it.p.id),$('kp'+it.p.id),$('kr'+it.p.id),$('kf'+it.p.id)];
    els.forEach(el=>{
      if(!el)return;
      el.classList.toggle('picked',anyIn);
      const circle=el.querySelector('.add-circle');
      if(circle)circle.textContent=anyIn?'✓':'+';
    });
    if(pmId===it.p.id&&pmType===it.type)syncPmBtn();
  }
  syncDot();renderStep();
}

function rCart(){
  const rows=Object.values(cart),body=$('cbody'),foot=$('cfoot');
  if(!rows.length){body.innerHTML=`<div class="cempty"><div class="cempty-i">👜</div><div class="cempty-t">Tu carrito está vacío.<br>Toca cualquier par para agregarlo.</div></div>`;foot.innerHTML='';return;}
  body.innerHTML=rows.map(({p,qty,type,talla})=>{
    const key=cartKey(p.id,type,talla);
    const m=p.img?`<img src="${p.img}" alt="${altProd(p)}">`:`<span style="font-size:22px">${type==='liq'?'🔥':'👟'}</span>`;
    const lbl=p.modelo||(type==='liq'?'Liquidación':(p.g==='h'?'Hombre':'Mujer'));
    const tallaTag=talla?`<span class="crtalla">Talla ${escHtml(String(talla))}</span>`:'';
    // Tachado + vigente por línea (mismo componente y misma regla de "¿hay promo activa?" que
    // ya usa el resumen de abajo: p.promo||promoG). Reusa .cprice-row/.cwas/.cprice.sale del card.
    const actP=(p.promo||promoG)&&p.was&&p.was>p.price;
    const priceHtml=actP
      ? `<div class="cprice-row"><div class="cwas">${fmt(p.was)}</div><div class="cprice sale">${fmt(p.price)} c/u</div></div>`
      : `<div class="crprice">${fmt(p.price)} c/u</div>`;
    return `<div class="crow"><div class="crimg">${m}</div><div class="crinfo"><div class="crname">${escHtml(lbl)}</div>${tallaTag}${priceHtml}</div><div class="cqc"><button class="cqb" onclick="chQty('${key}',-1)">−</button><span class="cqv">${qty}</span><button class="cqb" onclick="chQty('${key}',1)">+</button></div><button class="crm" onclick="rmItem('${key}')">✕</button></div>`;
  }).join('');
  const pricing=cartPricing(rows);
  const sub=pricing.subBruto,tot=pricing.pares;
  // El "precio original/descuento" SOLO se muestra cuando el descuento está activo (promo global o
  // por producto). Si está apagado, orig==sub → no aparece línea de descuento.
  const orig=rows.reduce((s,{p,qty})=>{const act=(p.promo||promoG)&&p.was&&p.was>p.price;return s+(act?p.was:p.price)*qty;},0);
  const ahorro=orig-sub;                 // descuento por precio tachado (solo si promo activo)
  const desc=pricing.desc;               // descuento por cupón (0 si hay combo)
  const totalFinal=pricing.sub;
  // 2 mensajes (estilo Adidas): no reservado + financiación
  const msgs=`<div class="cart-msg"><span class="cm-ic">🔒</span><span>Los artículos en tu carrito <b>no están reservados</b>. Termina tu compra ahora.</span></div>`
    +`<div class="cart-fin"><div class="cart-fin-tx">Llévalos hoy y <b>págalos después</b> con Addi y Sistecrédito</div><div class="cart-fin-logos"><img src="/logos/addi.png" alt="Addi" onerror="this.remove()"><img src="/logos/sistecredito.png" alt="Sistecrédito" onerror="this.remove()"></div></div>`;
  // Escalera de ahorro + cross-sell ("compra más, ahorra más"): escalera de niveles con su
  // ahorro + modelos del mismo género para subir de nivel. Reemplaza la sugerencia simple.
  const escalera=escaleraAhorro(rows,pricing);
  // Aviso de combo en progreso (activo pero sin los pares exactos)
  const comboAviso=(comboActivo&&!pricing.combo)
    ? `<div class="cart-line" style="background:#fff8e6;color:#8a6d00;border-color:#f0dfa8;margin-top:12px"><span class="cl-ic">🏆</span><span><b>${escHtml(comboActivo.nombre)}</b>: ${pricing.pares<comboActivo.pares?`te falta${comboActivo.pares-pricing.pares===1?'':'n'} <b>${comboActivo.pares-pricing.pares} par${comboActivo.pares-pricing.pares===1?'':'es'}</b> para el precio de ${fmt(comboActivo.precio)}`:`tienes <b>${pricing.pares-comboActivo.pares} par${pricing.pares-comboActivo.pares===1?'':'es'} de más</b> — el combo es de ${comboActivo.pares}`}</span></div>`
    :'';
  // Resumen del pedido. Con combo, el ahorro se muestra COMPLETO: descuento de tienda
  // (precio antes→ahora) + descuento del combo — el cliente debe ver todo lo que ahorra,
  // no solo el tramo del combo (anclaje). Los montos cobrados no cambian.
  let sumRows=`<div class="csum-row"><span>Productos (${tot})</span><span class="v"${pricing.combo?' style="text-decoration:line-through;color:var(--ink3)"':''}>${fmt(orig)}</span></div>`;
  if(pricing.combo){
    if(ahorro>0)sumRows+=`<div class="csum-row disc"><span>Descuento tienda</span><span class="v">−${fmt(ahorro)}</span></div>`;
    sumRows+=`<div class="csum-row disc"><span>🏆 ${escHtml(pricing.combo.nombre)} (${pricing.combo.pares} pares)</span><span class="v">${fmt(pricing.sub)}</span></div>`;
    if(sub>pricing.sub)sumRows+=`<div class="csum-row disc"><span>Ahorro del combo</span><span class="v">−${fmt(sub-pricing.sub)}</span></div>`;
    if(orig>pricing.sub)sumRows+=`<div class="csum-row disc" style="font-weight:800;font-size:13px"><span>🎉 Ahorras en total</span><span class="v">${fmt(orig-pricing.sub)}</span></div>`;
  }else{
    if(ahorro>0) sumRows+=`<div class="csum-row disc"><span>Descuento</span><span class="v">−${fmt(ahorro)}</span></div>`;
    // Etiqueta: cupón tecleado → "Cupón X"; descuento automático del motor → su nombre/etiqueta
    if(desc>0)   sumRows+=`<div class="csum-row disc"><span>${pricing.descTag===cuponAplicado&&cuponAplicado?'Cupón '+escHtml(cuponAplicado):'🎉 '+escHtml(pricing.descTag||'Descuento')}</span><span class="v">−${fmt(desc)}</span></div>`;
  }
  // Envío: GRATIS es cierto en 5 de los 6 métodos de pago, pero contra entrega cobra flete
  // (calcFlete). Decirlo aquí — con el monto real — evita el costo sorpresa en el paso de pago,
  // que es la causa #1 de abandono. El "Gratis" se conserva: es verdad pagando por adelantado.
  sumRows+=`<div class="csum-row"><span>Envío <span style="color:var(--ink3);font-size:11px">pagando en línea</span></span><span class="free">Gratis</span></div>`;
  // Flete contra entrega con la ciudad que se conozca (si aún no ha llenado datos → zona por defecto)
  const fleteCOD=calcFlete(tot,(cData&&cData.ciudad)||'',pricing.sub);
  // Palanca de AOV: si el envío gratis por monto está activo y aún no lo alcanza, decirle
  // cuánto le falta (sobrio, dentro del resumen — no un banner).
  if(envioGratisDesde>0){
    const falta=envioGratisDesde-pricing.sub;
    sumRows+=falta>0
      ?`<div class="csum-row" style="font-size:11px;color:var(--ink2)"><span>🚚 Te faltan <b>${fmt(falta)}</b> para envío GRATIS también contra entrega</span></div>`
      :`<div class="csum-row disc" style="font-size:11px;font-weight:700"><span>🚚 ¡Envío GRATIS en todos los métodos de pago!</span><span class="v">✓</span></div>`;
  }
  const notaCOD=fleteCOD>0
    ?`<div style="font-size:10.5px;color:var(--ink3);line-height:1.45;margin-top:9px">📦 ¿Prefieres <b>contra entrega</b>? El envío cuesta ${fmt(fleteCOD)} según tu ciudad y se paga por adelantado; los zapatos los pagas al recibir en casa.</div>`
    :`<div style="font-size:10.5px;color:var(--ink3);line-height:1.45;margin-top:9px">📦 <b>Contra entrega también con envío GRATIS</b> — los zapatos los pagas al recibir en casa.</div>`;
  const summary=`<div class="csum"><div class="csum-t">Resumen del pedido</div>${sumRows}<div class="csum-total"><span class="l">Total</span><span class="v">${fmt(totalFinal)}</span></div>${notaCOD}</div>`;
  // Código promocional: NO acumulable con combo (si el combo aplica, el cupón se oculta/ignora)
  const cupHtml=pricing.combo
    ? (cuponAplicado?`<div class="cart-line" style="background:var(--bg);color:var(--ink3);border-color:var(--line);margin-top:14px"><span class="cl-ic">🏷️</span><span>El cupón no es acumulable con el combo — se aplicó el precio del combo.</span></div>`:'')
    : (cuponAplicado&&(desc>0||_descEnvioGratis)
      ? `<div class="cart-line cart-cupon" style="margin-top:14px"><span class="cl-ic">🏷️</span><span>Cupón <b>${escHtml(cuponAplicado)}</b> aplicado${desc>0?`: −${fmt(desc)}`:' (envío gratis)'}</span></div>`
      : `<div class="cpromo"><button class="cpromo-toggle" onclick="toggleCupon()">🏷️ ¿Tienes un código promocional?</button><div class="cpromo-box" id="cpromoBox" style="display:none"><div class="cup-box"><input id="cupInput" placeholder="Código promocional" autocomplete="off"><button class="cup-btn" onclick="aplicarCupon()">Aplicar</button></div><div class="cup-err" id="cupErr" style="display:none">Código no válido</div></div></div>`);
  // 🎉 REGALO GRATIS: combo con regalo COMPLETO
  const camisetaHtml=pricing.camiseta
    ? `<div class="cart-line" style="background:#eafaf0;color:#137a3a;border-color:#bfe9cd;margin-top:12px;font-weight:700"><span class="cl-ic">🎉</span><span>¡Combo completo! Liberaste tu <b>REGALO GRATIS</b> 🎁 (te lo coordinamos por WhatsApp)</span></div>`
    :'';
  const gift=`<div class="cart-line cart-regalo" style="margin-top:12px"><span class="cl-ic">🎁</span><span>Incluye <b>guía de cuidado</b> + <b>5%</b> en tu próximo par</span></div>`;
  // Orden: mensajes → productos → escalera de ahorro → aviso combo → resumen → regalo del combo → código → regalo de compra
  body.innerHTML=msgs+body.innerHTML+escalera+comboAviso+summary+camisetaHtml+cupHtml+gift;
  crslUpd();   // muestra las flechas del carrusel si la tira de cross-sell se desborda
  foot.innerHTML=`<button class="btnmain" onclick="goStep(1)">Ir a pagar &nbsp;→</button>`;
}

// Markup del formulario de envío — extraído para poder reusarlo tal cual (mismos ids `fn/fc/ft/
// fem/fd/fb/fci/fconsent/ferr`) dentro del modal de compra rápida de la ficha (ver compra.js),
// sin que enviarWA/pagarWompi/pagarBold/updFleteHint tengan que saber en qué contenedor viven.
function formEnvioHTML(){
  return `<div class="formsec"><div class="formtit">¿A dónde enviamos tu pedido?</div>
    <div class="fld"><label>Nombre completo</label><input id="fn" type="text" autocomplete="name" autocapitalize="words" placeholder="Juan García" value="${escHtml(cData.nombre||'')}"></div>
    <div class="frow"><div class="fld"><label>Cédula</label><input id="fc" type="text" inputmode="numeric" autocomplete="off" placeholder="1000000000" value="${escHtml(cData.cedula||'')}"></div><div class="fld"><label>Celular</label><input id="ft" type="tel" inputmode="tel" autocomplete="tel" placeholder="300 000 0000" value="${escHtml(cData.celular||'')}"></div></div>
    <div class="fld"><label>Correo electrónico <span style="font-weight:400;color:var(--ink2)">(para pagar a crédito con Addi)</span></label><input id="fem" type="email" inputmode="email" autocomplete="email" placeholder="tucorreo@email.com" value="${escHtml(cData.email||'')}"></div>
    <div class="fld"><label>Dirección</label><input id="fd" type="text" autocomplete="street-address" placeholder="Calle 10 # 25-30" value="${escHtml(cData.direccion||'')}"></div>
    <div class="frow"><div class="fld"><label>Barrio</label><input id="fb" type="text" autocomplete="address-level3" placeholder="El Poblado" value="${escHtml(cData.barrio||'')}"></div><div class="fld"><label>Ciudad</label><input id="fci" type="text" autocomplete="address-level2" autocapitalize="words" placeholder="Medellín" value="${escHtml(cData.ciudad||'')}" oninput="updFleteHint()"></div></div>
    <div id="fleteHint" style="font-size:11px;color:var(--ink2);line-height:1.45;margin-top:2px"></div>
    <label for="fconsent" style="display:flex;gap:9px;align-items:flex-start;margin-top:6px;font-size:12px;line-height:1.45;color:var(--ink2);cursor:pointer">
      <input id="fconsent" type="checkbox" ${cData.consent?'checked':''} style="margin-top:2px;width:16px;height:16px;flex:0 0 auto;accent-color:var(--ink)">
      <span>Autorizo el tratamiento de mis datos personales según la <a href="#" onclick="openLegal('privacidad');return false" style="color:var(--ink);font-weight:700">Política de Privacidad</a> (Ley 1581 de 2012).</span>
    </label>
    <div class="ferr" id="ferr">Completa todos los campos y acepta la política de datos</div></div>`;
}

function rForm(){
  $('cbody').innerHTML=formEnvioHTML();
  $('cfoot').innerHTML=`<button class="btnmain" onclick="saveFormAndNext()">Continuar &nbsp;→</button><button class="btnback" onclick="goStep(0)">← Volver</button>`;
  updFleteHint();
}

// Recalcula EN VIVO el flete contra entrega mientras el cliente escribe su ciudad (zona de
// envío). Solo informa: el cobro real lo pinta el paso de pago y lo decide siempre el server.
function updFleteHint(){
  const el=$('fleteHint');if(!el)return;
  const pricing=cartPricing();
  const ciudad=(($('fci')||{}).value||'').trim();
  const flete=calcFlete(pricing.pares,ciudad,pricing.sub);
  el.innerHTML=flete>0
    ?`📦 Contra entrega${ciudad?` en <b>${escHtml(ciudad)}</b>`:''}: envío ${fmt(flete)} · Pagando en línea: envío <b>GRATIS</b>`
    :`📦 Envío <b>GRATIS</b>${ciudad?` a <b>${escHtml(ciudad)}</b>`:''} en todos los métodos de pago ✓`;
}

// Valida el formulario de envío (mismos ids que formEnvioHTML) y devuelve los datos, o null +
// muestra #ferr si falta algo. Extraída para que el modal de compra rápida (compra.js) pueda
// pre-validar antes de delegar a enviarWA/pagarWompi/pagarBold, sin duplicar la regla.
function leerFormEnvio(){
  const m={nombre:'fn',cedula:'fc',celular:'ft',direccion:'fd',barrio:'fb',ciudad:'fci'};
  let ok=true;const d={};
  Object.entries(m).forEach(([k,id])=>{const v=($( id)||{}).value||'';d[k]=v.trim();if(!v.trim())ok=false;});
  d.email=(($('fem')||{}).value||'').trim();   // opcional para avanzar; obligatorio solo en el flujo Addi
  const consent=!!($('fconsent')||{}).checked;
  if(!ok||!consent){const e=$('ferr');if(e)e.classList.add('show');return null;}
  d.consent=true;
  return d;
}

function saveFormAndNext(){
  const d=leerFormEnvio();
  if(!d)return;
  cData=d;
  captureLead(d);   // guarda el contacto YA (antes de pagar) por si abandona → remarketing
  goStep(2);
}

// Guarda el lead apenas completa datos. status='abandoned' hasta que confirme el pedido.
// Una sola vez por sesión (flag) para no duplicar si va y vuelve entre pasos.
function captureLead(d){
  if(sessionStorage.getItem('ss_lead_saved')===SESSION_ID)return;
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);
  const sub=pricing.sub;
  const totalPares=pricing.pares;
  const lead={
    id:Date.now(),fecha:new Date().toISOString(),
    items:cartItems(rows),
    subtotal:sub,envio:0,total:sub,pares:totalPares,pago:null,status:'abandoned',session_id:SESSION_ID,test:!!window.__TEST__,
    combo:pricing.combo?pricing.combo.id:null,
    nombre:d.nombre,cedula:d.cedula,ciudad:d.ciudad,barrio:d.barrio,tel:d.celular,direccion:d.direccion,
    utm:{...getUTM(),...getFbAttribution(),...getVisitCtx()},referrer:getReferrer(),seccion:gSel
  };
  fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(lead)})
    .then(()=>sessionStorage.setItem('ss_lead_saved',SESSION_ID)).catch(()=>{});
}

/* ── FLETE POR ZONAS ── espejo del cálculo server-side de api/_orders.js. Aquí solo se PINTA
   el número que verá el cliente; el cobro real lo recalcula siempre el servidor (createOrder
   ignora el envio del navegador). envioZonas/envioGratisDesde llegan de settings (loadState). */
let envioZonas=null,envioGratisDesde=0;

// Ciudad comparable: sin tildes, sin mayúsculas, sin espacios ni puntuación
// ("BOGOTÁ D.C." = "bogota dc" = "Bogotá").
function normCiudad(s){return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}

// Zonas utilizables: array con tarifas base numéricas y una zona default. Si no, null → fórmula vieja.
function zonasEnvio(){
  if(!Array.isArray(envioZonas))return null;
  const zs=envioZonas.filter(z=>z&&Number.isFinite(parseInt(z.base))&&parseInt(z.base)>=0);
  return zs.some(z=>z.default)?zs:null;
}

// Ciudad por PALABRAS (conserva los límites entre ellas): "Cali - Valle" → "cali valle".
function normCiudadFrase(s){return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}

function zonaDeCiudad(ciudad){
  const zonas=zonasEnvio();if(!zonas)return null;
  const n=normCiudad(ciudad);
  const frase=' '+normCiudadFrase(ciudad)+' ';
  if(n)for(const z of zonas){
    const cs=Array.isArray(z.ciudades)?z.ciudades:[];
    // Igualdad compacta o PALABRA COMPLETA (mismo criterio del server): "Cali - Valle" y
    // "Bogotá D.C." caen en su zona, pero "Calima" NO cae en "cali" (substring cobraba mal).
    if(cs.some(c=>{const nc=normCiudad(c);return nc&&nc.length>=3&&(n===nc||frase.includes(' '+normCiudadFrase(c)+' '));}))return z;
  }
  return zonas.find(z=>z.default);   // ciudad vacía o sin match → zona por defecto, NUNCA flete 0
}

function calcFlete(pares,ciudad,subtotal){
  // Descuento tipo 'envío gratis' del motor activo (espejo: el server lo revalida al cobrar)
  if(_descEnvioGratis)return 0;
  // Envío gratis desde X: sobre el mismo subtotal (post-descuento) que cobra el server
  if(envioGratisDesde>0&&Number(subtotal||0)>=envioGratisDesde)return 0;
  const z=zonaDeCiudad(ciudad);
  if(!z)return 25000+Math.max(0,pares-1)*15000;   // sin zonas configuradas → fórmula nacional histórica
  return Math.max(0,parseInt(z.base)||0)+Math.max(0,pares-1)*Math.max(0,parseInt(z.extra)||0);
}

function rPayChoice(){
  // Se consume UNA vez (compra rápida desde la ficha): resalta la tarjeta que el cliente ya
  // eligió al tocar "Contraentrega" o "Comprar por WhatsApp", pero el pago sigue siendo un
  // clic suyo — solo le ahorramos tener que volver a decidir entre las 6 opciones.
  const _hi=_buyIntent;_buyIntent=null;
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);          // combo (precio fijo) o normal con cupón
  const sub=pricing.sub;
  const pares=pricing.pares;
  // Flete por zona con la ciudad del formulario (paso 2 siempre viene después de "Tus datos")
  const flete=calcFlete(pares,(cData&&cData.ciudad)||'',sub);
  const SV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">';
  const icTruck=SV+'<path d="M2.5 6.5h11v9h-11z"/><path d="M13.5 9.5h4l3 3v3h-7z"/><circle cx="6" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/></svg>';
  const icBank=SV+'<path d="M3 9.5l9-5 9 5"/><path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7"/><path d="M3.5 20h17"/></svg>';
  const icCard=SV+'<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 9.5h19"/><path d="M6 14.5h4"/></svg>';
  const icCuotas=SV+'<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M8 3v3M16 3v3"/><path d="M8.3 14.5l2 2 4-4"/></svg>';
  // Repartidor con caja (más profesional que el camión) para Contra entrega.
  const icDelivery=SV+'<circle cx="12" cy="4" r="2"/><path d="M8.5 21v-5.4M15.5 21v-5.4"/><rect x="8.7" y="9.3" width="6.6" height="6.2" rx="1"/><path d="M8.7 12.4h6.6M12 9.3v6.2"/><path d="M8.7 10.6 6.9 13M15.3 10.6 17.1 13"/></svg>';
  // Ícono de WhatsApp (reusa el SVG de redes; le forzamos fill currentColor para teñirlo con --acc).
  const icWa=(typeof SOC_SVG!=='undefined'&&SOC_SVG.wa)?SOC_SVG.wa.replace('<svg ','<svg fill="currentColor" '):icBank;
  // Logo real con fallback al SVG genérico si el archivo no existe (mismo patrón que la ficha)
  const icLogo=(src,alt,fb)=>`<img src="${src}" alt="${alt}" class="pc-logo" onerror="this.outerHTML=${JSON.stringify(fb).replace(/"/g,'&quot;')}">`;
  // tip (opcional): muestra una burbuja de info — en escritorio al pasar el cursor por la card,
  // en móvil al tocar el marcador ⓘ (no dispara el pago: stopPropagation + preventDefault).
  const card=(fn,acc,tint,ico,tit,desc,tot,tip,hi)=>`<button class="paychoice${hi?' paychoice-hi':''}" onclick="${fn}" style="--acc:${acc}"><span class="pc-ic" style="background:${tint}">${ico}</span><span class="pc-main"><span class="pc-tit">${tit}</span><span class="pc-desc">${desc}</span><span class="pc-tot">${tot}</span></span><span class="pc-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>${tip?`<span class="pc-info" onclick="event.stopPropagation();event.preventDefault();this.parentElement.classList.toggle('tipon')" aria-label="Más información">i</span><span class="pc-tip">${tip}</span>`:''}</button>`;
  $('cbody').innerHTML=`<div class="paysec"><div class="paytit">¿Cómo quieres pagar?</div><div class="paychoice-list">`
    // Contra entrega con flete: el envío se COBRA EN LÍNEA (Wompi/Bold). Antes esta tarjeta abría
    // WhatsApp igual que "Pago por WhatsApp" pero $25.000 más cara — o sea, estaba dominada y nadie
    // la elegía nunca (0 pedidos en 3 meses). Cobrando el flete, el pedido queda confirmado por
    // pasarela y entra al sistema como venta con su envío pendiente de entregar.
    +(flete>0
      ?card(`elegirPagoFlete()`,'#1E1E1C','#f1f1ef',icDelivery,'Contra entrega',`Pagas solo el envío ahora y los zapatos al recibir`,`Hoy: envío ${fmt(flete)} · Al recibir: ${fmt(sub)}`,`📦 El envío se paga primero para <b>asegurar tu despacho</b>. Así garantizamos que tu pedido salga y llegue — evitamos los pedidos que se piden y no se reciben.`,_hi==='contra_entrega')
      // Envío gratis alcanzado (umbral por monto): contra entrega sin flete → todo se paga al recibir
      :card(`enviarWA('contra_entrega')`,'#1E1E1C','#f1f1ef',icDelivery,'Contra entrega','¡Envío GRATIS! Pagas todo al recibir en casa ✓',`Al recibir: ${fmt(sub)}`,`🎉 Tu pedido alcanzó el <b>envío GRATIS</b> también contra entrega: no pagas nada hoy.`,_hi==='contra_entrega'))
    +card(`enviarWA('pago_anticipado')`,'#25D366','#e9fbf1',icWa,'Pago por WhatsApp','Coordina tu pago por WhatsApp · Envío GRATIS ✓',`Total a pagar: ${fmt(sub)}`,null,_hi==='whatsapp')
    +card(`pagarWompi()`,'#5D2D91','#fff',icLogo('/logos/wompi.png','Wompi',icCard),'Pagar en línea — Wompi','Tarjeta · PSE · Nequi · Bancolombia · Envío GRATIS ✓',`Total a pagar: ${fmt(sub)}`)
    +card(`pagarBold()`,'#2541B2','#fff',icLogo('/logos/bold.png','Bold',icCard),'Pagar en línea — Bold','Tarjeta · PSE · Botón Bancolombia · Envío GRATIS ✓',`Total a pagar: ${fmt(sub)}`)
    +card(`pagarAddi()`,'#0a7d4b','#fff',icLogo('/logos/addi.png','Addi',icCuotas),'Pagar con Addi — a cuotas','Crédito 100% online · Solo cédula y celular · Envío GRATIS ✓',`Total a pagar: ${fmt(sub)}`)
    +card(`pagarSistecredito()`,'#E30613','#fff',icLogo('/logos/sistecredito.png','Sistecrédito',icCuotas),'Pagar con Sistecrédito — a cuotas','Crédito 100% online · Solo tu cédula · Envío GRATIS ✓',`Total a pagar: ${fmt(sub)}`)
    +`</div>`
    +`<div class="pay-trust">`
      +`<button type="button" class="pay-trust-i" onclick="openInfo('cambios')"><span>🔄</span><span>Cambios por talla fáciles</span></button>`
      +`<button type="button" class="pay-trust-i" onclick="openInfo('cambios')"><span>🛡️</span><span>Garantía de 1 mes</span></button>`
      +`<div class="pay-trust-i"><span>📦</span><span>Pago contra entrega disponible</span></div>`
    +`</div></div>`;
  $('cfoot').innerHTML=`<button class="btnback" onclick="goStep(1)">← Volver</button>`;
}

async function enviarWA(tipo){
  tipo=tipo||'pago_anticipado';
  trackEvent('select_payment',{product_id:tipo});
  const m={nombre:'fn',cedula:'fc',celular:'ft',direccion:'fd',barrio:'fb',ciudad:'fci'};
  let ok=true;const d={};
  Object.entries(m).forEach(([k,id])=>{const el=$(id);const v=el?el.value:(cData[k]||'');d[k]=v.trim();if(!v.trim())ok=false;});
  if(!ok){const e=$('ferr');if(e)e.classList.add('show');return false;}
  cData=d;
  if(window._payBusy)return false;   // guard anti doble-toque: evita pedido + Lead GEMELO (mismo fix que pagarBold/Wompi)
  window._payBusy=true;
  setTimeout(()=>{window._payBusy=false;},4000);   // se libera solo (WhatsApp abre en otra pestaña, la página no navega)
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);         // combo (precio fijo) o normal con cupón
  const subBruto=pricing.subBruto;
  const desc=pricing.desc;
  const sub=pricing.sub;
  const totalPares=pricing.pares;
  const flete=tipo==='contra_entrega'?calcFlete(totalPares,d.ciudad,sub):0;   // por zona (el server revalida)
  const tot=sub+flete;
  let items='';
  rows.forEach(({p,qty,type,talla})=>{const s=p.price*qty;const lbl=p.modelo||(type==='liq'?'Liquidación':(p.g==='h'?'Hombre':'Mujer'));const mk=p.brand?(BRAND_LABELS[p.brand]||p.brand)+' · ':'';items+=`  • ${mk}${lbl} · #${p.id}${talla?` · Talla ${talla}`:''} x${qty} — ${fmt(s)}\n`;});
  // UN solo link que abre TODO el pedido con fotos (más fácil para el vendedor que link por link).
  // Formato 29x1t40: la talla viaja en el link para saber qué alistar sin abrir el panel.
  const pedidoCode=rows.map(({p,qty,type,talla})=>{
    const t=String(talla==null?'':talla).replace(/[^\w.]/g,'').slice(0,6);
    return (type==='liq'?'L':'')+p.id+'x'+qty+(t?'t'+t:'');
  }).join(',');
  const pedidoLink=`https://strangesneakers.com/?pedido=${pedidoCode}`;
  // Contra entrega con envío gratis (umbral por monto): no hay nada que pagar por adelantado
  const envioLinea=tipo==='contra_entrega'
    ?(flete>0?`🚚 *Envío (se paga primero):* ${fmt(flete)}\n👟 *Zapatos (pagas al recibir en casa):* ${fmt(sub)}`:`📦 *Envío: GRATIS ✓* — todo se paga al recibir`)
    :`📦 *Envío: GRATIS ✓*`;
  // Ahorro REAL del combo: contra el precio original (antes→ahora + combo), igual que el carrito.
  const origWA=rows.reduce((s,{p,qty})=>{const act=(p.promo||promoG)&&p.was&&p.was>p.price;return s+(act?p.was:p.price)*qty;},0);
  const descLinea=pricing.combo
    ?`🏆 *${pricing.combo.nombre}: ${pricing.combo.pares} pares por ${fmt(pricing.sub)}* (ahorra en total ${fmt(Math.max(origWA,subBruto)-pricing.sub)})\n${pricing.camiseta?`🎁 *REGALO GRATIS* — coordinar con el cliente\n`:''}`
    :(desc>0?`🏷️ *Descuento ${pricing.descTag||cuponAplicado||'promoción'}:* -${fmt(desc)}\n`:'');
  const pagoLbl=tipo==='contra_entrega'?'Contra entrega 📦':tipo==='credito'?'Crédito (Addi / Sistecrédito) 🧾':'Pago anticipado 💸';
  const instruccion=tipo==='contra_entrega'?(flete>0?`El cliente paga primero el *ENVÍO* (${fmt(flete)}) y los *zapatos al recibir* en casa. Coordinemos el pago del envío 🙏`:`Pedido contra entrega con *ENVÍO GRATIS* (superó el mínimo de compra). Coordinar el despacho 🙏`):tipo==='credito'?'El cliente quiere pagar a *CRÉDITO*. Indícale si aplica por *Addi* o *Sistecrédito* y el paso a paso 🙏':'Enviar comprobante de pago para procesar el envío 🙏';
  const msg=`🛍️ *NUEVO PEDIDO — ${STORE_NAME}*\n━━━━━━━━━━━━━━━━━━━━\n👟 *PRODUCTOS*\n${items}\n📸 *Ver el pedido con fotos:*\n${pedidoLink}\n━━━━━━━━━━━━━━━━━━━━\n💰 *Subtotal: ${fmt(subBruto)}*\n${descLinea}${envioLinea}\n💰 *TOTAL: ${fmt(tot)}*\n━━━━━━━━━━━━━━━━━━━━\n👤 *DATOS*\n• Nombre: ${d.nombre}\n• Cédula: ${d.cedula}\n• Celular: ${d.celular}\n• Dirección: ${d.direccion}\n• Barrio: ${d.barrio}\n• Ciudad: ${d.ciudad}\n━━━━━━━━━━━━━━━━━━━━\n💳 *Pago:* ${pagoLbl}\n━━━━━━━━━━━━━━━━━━━━\n${instruccion}\n\n🎁 *Tu regalo — Guía de cuidado de tus sneakers:*\nhttps://strangesneakers.com/?regalo=cuidado`;
  const orderObj={
    id:Date.now(),fecha:new Date().toISOString(),
    items:cartItems(rows),
    subtotal:sub,envio:flete,total:tot,pares:totalPares,pago:tipo,session_id:SESSION_ID,test:!!window.__TEST__,cupon:cuponAplicado||null,
    combo:pricing.combo?pricing.combo.id:null,
    nombre:d.nombre,cedula:d.cedula,ciudad:d.ciudad,barrio:d.barrio,tel:d.celular,direccion:d.direccion,
    utm:{...getUTM(),...getFbAttribution(),...getVisitCtx()},referrer:getReferrer(),seccion:gSel
  };
  // Advanced Matching para mejor calidad de match en Meta (el Pixel lo hashea client-side).
  if(PIXEL_ID&&typeof fbq==='function'){
    const np=d.nombre.trim().toLowerCase().split(' ');
    fbq('init',PIXEL_ID,{ph:d.celular.replace(/\D/g,''),fn:np[0]||'',ln:np.slice(1).join(' ')||'',ct:d.ciudad.trim().toLowerCase(),country:'co'});
  }
  const _pids=rows.map(({p,type})=>pxId(type,p.id));
  // Esto es un LEAD (abrió WhatsApp), NO una compra. El Purchase real se dispara al
  // confirmar la venta (panel Leads → CAPI). value = subtotal de producto, sin flete.
  px('Lead',{content_ids:_pids,content_type:'product',value:sub,currency:'COP',num_items:totalPares,...getUTM()},SESSION_ID+'_lead');
  gadsUserData(d); gads('lead',{value:sub,currency:'COP'}); ga4('generate_lead',{value:sub,currency:'COP'});   // Google Ads conversión + GA4
  trackEvent('lead',{price:sub});
  orders.push(orderObj);
  saveState();
  // Fire-and-forget (sin await: un await rompe window.open en iOS Safari — pierde la
  // activación del gesto → popup bloqueado). keepalive:true hace que el navegador complete
  // el request aunque la pestaña navegue a WhatsApp — sin esto el pedido/lead podía perderse.
  fetch('/api/orders',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'create_order',...orderObj})}).catch(()=>{});
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');
  return false;
}

/* "Comprar por WhatsApp" desde la ficha: a diferencia de enviarWA() (que exige los 6 campos del
   formulario porque arma un pedido completo con dirección de envío), esto es solo el enganche
   del chat — el cliente aún no dio nombre/cédula/dirección, eso lo levanta el vendedor por
   WhatsApp junto con la forma de pago. Va DIRECTO a wa.me sin pasar por el modal de datos.
   El link a /p/<id>-slug lleva la foto: middleware.js reescribe el og:image de esa ruta con la
   foto real del producto, así que WhatsApp arma la preview con la foto del zapato sola. */
function waConsultaFicha(p,type,talla){
  fireInitiateCheckout();
  trackEvent('reached_payment');
  const mk=p.brand?(BRAND_LABELS[p.brand]||p.brand)+' · ':'';
  const lbl=p.modelo||(type==='liq'?'Liquidación':(p.g==='h'?'Hombre':'Mujer'));
  const url='https://strangesneakers.com'+navProdUrl(p.id,type,p);
  const msg=`💬 *QUIERE COMPRAR — ${STORE_NAME}*\n━━━━━━━━━━━━━━━━━━━━\n👟 *${mk}${lbl}* · #${p.id}\n📏 *Talla:* ${talla}\n💰 *Precio:* ${fmt(p.price)}\n\n📸 Ver el zapato:\n${url}\n\nIndícale la forma de pago 🙏`;
  const pid=pxId(type,p.id);
  px('Lead',{content_ids:[pid],content_type:'product',value:p.price,currency:'COP',num_items:1},SESSION_ID+'_lead_wa_'+p.id+'_'+talla);
  gads('lead',{value:p.price,currency:'COP'}); ga4('generate_lead',{value:p.price,currency:'COP'});
  trackEvent('lead',{price:p.price});
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');
}

/* ── CONTRA ENTREGA: elegir con qué pasarela se paga el ENVÍO ──
   Solo se cobra el flete. El producto se paga al recibir, y el pedido queda registrado como
   venta con su envío por despachar — así el vendedor sabe cuánto recoger en la puerta. */
function elegirPagoFlete(){
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);
  const flete=calcFlete(pricing.pares,(cData&&cData.ciudad)||'',pricing.sub);
  if(flete<=0){enviarWA('contra_entrega');return;}   // envío gratis: no hay nada que cobrar
  const b=$('cbody');if(!b)return;
  b.innerHTML=`<div class="paysec">
    <div class="paytit">Paga tu envío para asegurar el despacho</div>
    <div style="background:var(--bg);border-radius:12px;padding:12px 14px;margin-bottom:12px;font-size:12.5px;color:var(--ink2);line-height:1.5">
      Pagas ahora <b>solo el envío: ${fmt(flete)}</b>.<br>
      Los zapatos (<b>${fmt(pricing.sub)}</b>) los pagas <b>al recibir en casa</b> 📦
    </div>
    <div class="paychoice-list">
      <button class="paychoice" onclick="pagarWompi(true)" style="--acc:#5D2D91"><span class="pc-ic" style="background:#fff"><img src="/logos/wompi.png" alt="Wompi" class="pc-logo"></span><span class="pc-main"><span class="pc-tit">Pagar el envío — Wompi</span><span class="pc-desc">Tarjeta · PSE · Nequi · Bancolombia</span><span class="pc-tot">A pagar hoy: ${fmt(flete)}</span></span><span class="pc-arrow">›</span></button>
      <button class="paychoice" onclick="pagarBold(true)" style="--acc:#2541B2"><span class="pc-ic" style="background:#fff"><img src="/logos/bold.png" alt="Bold" class="pc-logo"></span><span class="pc-main"><span class="pc-tit">Pagar el envío — Bold</span><span class="pc-desc">Tarjeta · PSE · Botón Bancolombia</span><span class="pc-tot">A pagar hoy: ${fmt(flete)}</span></span><span class="pc-arrow">›</span></button>
    </div>
  </div>`;
  $('cfoot').innerHTML=`<button class="btnback" onclick="goStep(2)">← Volver</button>`;
}

async function pagarWompi(cod){
  if(window._payBusy)return; // guard anti doble-toque (igual que pagarBold)
  window._payBusy=true;
  setTimeout(()=>{window._payBusy=false;},15000); // red de escape por si algo cuelga
  trackEvent('select_payment',{product_id:cod?'contra_entrega_wompi':'wompi'});
  const m={nombre:'fn',cedula:'fc',celular:'ft',direccion:'fd',barrio:'fb',ciudad:'fci'};
  let ok=true;const d={};
  Object.entries(m).forEach(([k,id])=>{const el=$(id);const v=el?el.value:(cData[k]||'');d[k]=v.trim();if(!v.trim())ok=false;});
  if(!ok){const e=$('ferr');if(e)e.classList.add('show');window._payBusy=false;return;}
  cData=d;
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);
  // Contra entrega: se cobra SOLO el flete. subtotal sigue siendo el producto (base del ROAS);
  // el server recalcula el envío con sus propios ajustes y firma el cobro con montoACobrar().
  const tot=pricing.sub;
  const fleteCOD=cod?calcFlete(pricing.pares,d.ciudad,pricing.sub):0;
  const reference='STR-'+Date.now();
  const totalPares=pricing.pares;
  const wOrder={
    id:Date.now(),fecha:new Date().toISOString(),
    items:cartItems(rows),
    subtotal:tot,envio:fleteCOD,total:tot+fleteCOD,pares:totalPares,pago:cod?'contra_entrega':'wompi',status:'pending',session_id:SESSION_ID,test:!!window.__TEST__,cupon:cuponAplicado||null,
    combo:pricing.combo?pricing.combo.id:null,
    nombre:d.nombre,cedula:d.cedula,ciudad:d.ciudad,barrio:d.barrio,tel:d.celular,direccion:d.direccion,
    reference,utm:{...getUTM(),...getFbAttribution(),...getVisitCtx(),...(cod?{flete_via:'wompi'}:{})},referrer:getReferrer(),seccion:gSel
  };
  orders.push(wOrder);
  saveState();
  try{
    const saved=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'create_order',...wOrder})}).then(r=>r.ok?r.json():Promise.reject(new Error('order error')));
    if(saved&&saved.order){
      wOrder.reference=saved.order.reference;
      wOrder.subtotal=saved.order.subtotal;wOrder.total=saved.order.total;wOrder.items=saved.order.items;
    }
    const res=await fetch(`/api/wompi-sign?reference=${encodeURIComponent(wOrder.reference)}`);
    if(!res.ok)throw new Error('sign error');
    const {signature,amount_in_cents}=await res.json();
    const params=new URLSearchParams({
      'public-key':WOMPI_PK,
      'currency':'COP',
      'amount-in-cents':String(amount_in_cents),
      'reference':wOrder.reference,
      'signature:integrity':signature,
      'redirect-url':location.origin+'/?wompi=1',
      'customer-data:full-name':d.nombre,
      'customer-data:phone-number':d.celular.replace(/\D/g,''),
    });
    localStorage.setItem('wompi_ref',wOrder.reference);
    location.href='https://checkout.wompi.co/p/?'+params.toString();
  }catch(e){
    alert('Error al conectar con Wompi. Verifica tu conexión e intenta de nuevo.');
  }
}

/* ── RECIBO DE PAGO CONFIRMADO ────────────────────────────────────────────────
   Antes, al volver de la pasarela, el cliente solo veía un alert() y el WhatsApp con el pedido
   se abría por window.open dentro de un setTimeout — o sea SIN gesto suyo, así que Chrome y
   Safari de celular lo bloqueaban seguido y el mensaje nunca le llegaba a la tienda. Ahora se
   pinta un recibo real con las fotos y el WhatsApp es un <a> que el cliente TOCA: eso no lo
   bloquea ningún navegador. Vive aquí y no en extras.js para no depender de una descarga extra
   justo después de un pago (su onerror muestra un alert que ahí sería pésimo).
   Solo cambia lo que se le MUESTRA al cliente: cuando se llega aquí el pago ya se verificó
   server-side y el Purchase ya se disparó. ── */

/* "Adidas · ADIDAS RUNNING" se leía redundante: muchos modelos ya traen la marca en el nombre.
   Solo se antepone la marca cuando el nombre no la menciona. */
function nombreItem(it){
  const marca=it.brand?(BRAND_LABELS[it.brand]||it.brand):'';
  const label=it.label||'Producto';
  if(!marca||label.toLowerCase().includes(marca.toLowerCase()))return label;
  return marca+' · '+label;
}

// Texto del pedido para WhatsApp. Era el mismo bloque copiado en los 4 retornos de pasarela.
function msgPedidoWA(order,pasarela,esCredito){
  const titulo=esCredito?`CRÉDITO APROBADO (${pasarela})`:'PAGO CONFIRMADO';
  const metodo=`${pasarela==='Wompi'?'💜':'💳'} *Pago ${pasarela}:* ${esCredito?'Aprobado':'Confirmado'} ✓`;
  let items='';
  (order.items||[]).forEach(it=>{
    const ref=it.id?` · #${it.id}`:'';
    const ln=it.id?`\n     👉 https://strangesneakers.com/p/${it.type==='liq'?'L':''}${it.id}`:'';
    items+=`  • ${nombreItem(it)}${ref}${it.talla?` · Talla ${it.talla}`:''} x${it.qty} — ${fmt(it.precio)}${ln}\n`;
  });
  const sep='━━━━━━━━━━━━━━━━━━━━';
  const prod=items?`👟 *PRODUCTOS*\n${items}\n📦 *Envío: GRATIS ✓*\n💰 *TOTAL: ${order.total!=null?fmt(order.total):'-'}*\n${sep}\n`:'';
  // Sin el pedido en localStorage solo tenemos la referencia: se omite el bloque de datos en vez
  // de mandar seis guiones (la tienda igual tiene todo en el panel buscando por la ref).
  const datos=order.nombre?`👤 *DATOS*\n`+
    `• Nombre: ${order.nombre}\n• Cédula: ${order.cedula||'-'}\n• Celular: ${order.tel||'-'}\n`+
    `• Dirección: ${order.direccion||'-'}\n• Barrio: ${order.barrio||'-'}\n• Ciudad: ${order.ciudad||'-'}\n`:'';
  return `✅ *${titulo} — ${STORE_NAME}*\n${sep}\n${prod}${datos}`+
    `• Ref: ${order.reference||order.id||'-'}\n${sep}\n${metodo}\n${sep}\n`+
    `¡Gracias por tu compra! Tu pedido está siendo procesado 🙏\n\n`+
    `🎁 *Tu regalo — Guía de cuidado de tus sneakers:*\nhttps://strangesneakers.com/?regalo=cuidado`;
}

/* Pantalla de confirmación a pantalla completa. Reusa las clases .ped-* de la vista ?pedido=.
   Tolera un pedido incompleto: si se perdió el localStorage solo llega la referencia y se pinta
   la versión mínima (sin fotos ni datos), pero con el mismo botón de WhatsApp. */
function mostrarRecibo(order,pasarela,esCredito){
  const wa=`https://wa.me/${WA}?text=${encodeURIComponent(msgPedidoWA(order,pasarela,esCredito))}`;
  const lista=Array.isArray(order.items)?order.items:[];
  const pares=lista.reduce((s,it)=>s+(Number(it.qty)||1),0);
  const rows=lista.map(it=>{
    const p=(it.type==='liq'?liqs:prods).find(x=>x.id===it.id);
    const img=p&&p.img?`<img src="${escHtml(p.img)}" alt="${altProd(p)}">`:'👟';
    const sub=[it.talla?'Talla '+it.talla:'','Cantidad '+(it.qty||1)].filter(Boolean).join(' · ');
    return `<div class="ped-row"><div class="ped-img">${img}</div><div class="ped-info">`+
      `<div class="ped-name">${escHtml(nombreItem(it))}${it.id?' · #'+it.id:''}</div>`+
      `<div class="ped-q">${escHtml(sub)}</div></div>`+
      `<div class="ped-pr">${it.precio!=null?fmt(it.precio):''}</div></div>`;
  }).join('');
  const pedido=rows?`<div class="ped-head">Tu pedido · ${pares} ${pares===1?'par':'pares'}</div>${rows}`+
    `<div class="rec-envio"><span>Envío</span><span>GRATIS ✓</span></div>`+
    `<div class="ped-total"><span>Total</span><span>${order.total!=null?fmt(order.total):''}</span></div>`:'';
  const dir=[order.direccion,order.barrio].filter(Boolean).join(' · ');
  const datos=order.nombre?`<div class="rec-datos"><div class="rec-tit">Enviamos a</div>`+
    `<div class="rec-l"><b>${escHtml(order.nombre)}</b>${order.cedula?' · CC '+escHtml(String(order.cedula)):''}</div>`+
    (dir?`<div class="rec-l">${escHtml(dir)}</div>`:'')+
    `<div class="rec-l">${escHtml(order.ciudad||'')}${order.tel?' · '+escHtml(String(order.tel)):''}</div>`+
    `<div class="rec-nota">¿Algo mal? Escríbenos y lo corregimos antes de despachar.</div></div>`:'';
  const ov=document.createElement('div');
  ov.className='ped-view';
  ov.innerHTML=`<div class="rec-ok"><div class="rec-check">✅</div>`+
    `<div class="rec-h1">¡${esCredito?'Crédito aprobado':'Pago confirmado'}!</div>`+
    `<div class="rec-ref">${escHtml(String(order.reference||order.id||''))} · ${escHtml(pasarela)}</div></div>`+
    `<div class="ped-body">${pedido}${datos}`+
    `<a class="rec-wa" href="${wa}" target="_blank" rel="noopener">💬 Confirmar por WhatsApp</a>`+
    `<div class="rec-extra"><a href="/?regalo=cuidado">🎁 Tu guía de cuidado de sneakers</a>`+
    `<span>📦 Llega en 2 a 5 días hábiles</span>`+
    `<a href="#" class="rec-cerrar">Seguir viendo el catálogo →</a></div></div>`;
  document.body.appendChild(ov);
  document.body.style.overflow='hidden';
  const cerrar=ov.querySelector('.rec-cerrar');
  if(cerrar)cerrar.addEventListener('click',e=>{e.preventDefault();ov.remove();document.body.style.overflow='';});
}

async function checkWompiReturn(){
  const params=new URLSearchParams(location.search);
  if(!params.get('wompi'))return;
  const txId=params.get('id')||'';
  const reference=localStorage.getItem('wompi_ref')||'';
  localStorage.removeItem('wompi_ref');
  history.replaceState({},'',location.pathname);
  // Verificación server-side: NO confiar en ?status= de la URL (es falsificable).
  let verified=false,status=params.get('status')||'';
  if(txId){
    try{
      // Pasar la reference: el server marca la venta en BD y dispara Purchase vía CAPI.
      const vr=await fetch('/api/wompi-verify?id='+encodeURIComponent(txId)+(reference?'&reference='+encodeURIComponent(reference):''));
      if(vr.ok){const t=await vr.json();status=t.status||status;verified=!!t.confirmed;}
    }catch(e){}
  }
  if(verified){
    comboActivo=null;   // ciclo del combo cerrado
    for(const k in cart)delete cart[k];syncDot();   // compra pagada → vaciar el carrito (y ss_cart)
    const order=orders.find(o=>o.reference===reference)||
                orders.filter(o=>o.pago==='wompi'&&o.status==='pending').pop();
    if(order){
      order.status='venta';
      saveState();
      // Purchase REAL (pago confirmado server-side). Mismo event_id que el CAPI → dedup.
      if(PIXEL_ID&&typeof fbq==='function'){
        const np=String(order.nombre||'').trim().toLowerCase().split(' ');
        fbq('init',PIXEL_ID,{ph:String(order.tel||'').replace(/\D/g,''),fn:np[0]||'',ln:np.slice(1).join(' ')||'',ct:String(order.ciudad||'').trim().toLowerCase(),country:'co'});
      }
      const _wIds=Array.isArray(order.items)?order.items.map(it=>pxId(it.type,it.id)):[];
      px('Purchase',{content_ids:_wIds,content_type:'product',value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',num_items:order.pares||1,...getUTM()},(order.reference||order.id)+'_purchase');
      gadsUserData(order); gads('purchase',{value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',transaction_id:String(order.reference||order.id)}); ga4('purchase',{transaction_id:String(order.reference||order.id),value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',items:(order.items||[]).map(it=>({item_id:(it.type==='liq'?'liq_':'cat_')+it.id,item_name:it.label,price:it.precio,quantity:it.qty}))});
      trackEvent('purchase',{price:order.subtotal!=null?order.subtotal:order.total});
      mostrarRecibo(order,'Wompi',false);
    }else{
      mostrarRecibo({reference},'Wompi',false);   // sin el pedido en localStorage: recibo mínimo con la ref
    }
  }else if(status==='APPROVED'){
    // Wompi (vía URL) dice aprobado pero no pudimos verificarlo server-side.
    setTimeout(()=>alert('⏳ Estamos confirmando tu pago.\nApenas se confirme te contactaremos por WhatsApp.'),300);
  }else if(status){
    setTimeout(()=>alert('❌ El pago no fue completado.\nPuedes intentar de nuevo o elegir otro método de pago.'),300);
  }
}

/* ── PAGO EN LÍNEA: BOLD (Payment Link API; firma/llave en api/orders.js) ── */
async function pagarBold(cod){
  // Guard anti doble-toque: un 2º tap mientras se crea el link generaba un pedido GEMELO
  // (visto en la compra de prueba real del 2026-06-11). Si tiene éxito, la página navega
  // a Bold y el guard muere con ella; si falla, el timeout lo libera.
  if(window._payBusy)return;
  window._payBusy=true;
  setTimeout(()=>{window._payBusy=false;},15000);
  trackEvent('select_payment',{product_id:cod?'contra_entrega_bold':'bold'});
  const m={nombre:'fn',cedula:'fc',celular:'ft',direccion:'fd',barrio:'fb',ciudad:'fci'};
  let ok=true;const d={};
  Object.entries(m).forEach(([k,id])=>{const el=$(id);const v=el?el.value:(cData[k]||'');d[k]=v.trim();if(!v.trim())ok=false;});
  if(!ok){const e=$('ferr');if(e)e.classList.add('show');window._payBusy=false;return;}
  cData=d;
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);
  // Contra entrega: Bold cobra SOLO el flete (montoACobrar en el server firma el mismo monto).
  const tot=pricing.sub;
  const fleteCOD=cod?calcFlete(pricing.pares,d.ciudad,pricing.sub):0;
  const reference='STR-'+Date.now();
  const totalPares=pricing.pares;
  const bOrder={
    id:Date.now(),fecha:new Date().toISOString(),
    items:cartItems(rows),
    subtotal:tot,envio:fleteCOD,total:tot+fleteCOD,pares:totalPares,pago:cod?'contra_entrega':'bold',status:'pending',session_id:SESSION_ID,test:!!window.__TEST__,cupon:cuponAplicado||null,
    combo:pricing.combo?pricing.combo.id:null,
    nombre:d.nombre,cedula:d.cedula,ciudad:d.ciudad,barrio:d.barrio,tel:d.celular,direccion:d.direccion,
    reference,utm:{...getUTM(),...getFbAttribution(),...getVisitCtx(),...(cod?{flete_via:'bold'}:{})},referrer:getReferrer(),seccion:gSel
  };
  orders.push(bOrder);saveState();
  try{
    const saved=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'create_order',...bOrder})}).then(r=>r.ok?r.json():Promise.reject(new Error('order error')));
    if(saved&&saved.order){
      bOrder.reference=saved.order.reference;
      bOrder.subtotal=saved.order.subtotal;bOrder.total=saved.order.total;bOrder.items=saved.order.items;
    }
    const res=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'bold_link',reference:bOrder.reference,description:'Pedido '+bOrder.reference})});
    const j=await res.json().catch(()=>({}));
    if(!res.ok||!j.url){
      if(j&&j.error==='bold_unavailable'){alert('El pago con Bold se activará muy pronto 🙏\nPor ahora elige otro método de pago.');return;}
      throw new Error('bold link');
    }
    localStorage.setItem('bold_ref',bOrder.reference);
    localStorage.setItem('bold_link',j.payment_link||'');
    location.href=j.url;
  }catch(e){alert('No se pudo conectar con Bold. Intenta de nuevo o elige otro método de pago.');}
}

async function checkBoldReturn(){
  const params=new URLSearchParams(location.search);
  if(!params.get('bold'))return;
  const reference=localStorage.getItem('bold_ref')||'';
  const link=localStorage.getItem('bold_link')||'';
  localStorage.removeItem('bold_ref');localStorage.removeItem('bold_link');
  history.replaceState({},'',location.pathname);
  let verified=false;
  if(link){
    try{
      const vr=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'bold_status',payment_link:link,reference})});
      if(vr.ok){const t=await vr.json();verified=!!t.confirmed;}
    }catch(e){}
  }
  if(verified){
    comboActivo=null;   // ciclo del combo cerrado
    for(const k in cart)delete cart[k];syncDot();   // compra pagada → vaciar el carrito (y ss_cart)
    const order=orders.find(o=>o.reference===reference)||orders.filter(o=>o.pago==='bold'&&o.status==='pending').pop();
    if(order){
      order.status='venta';saveState();
      if(PIXEL_ID&&typeof fbq==='function'){const np=String(order.nombre||'').trim().toLowerCase().split(' ');fbq('init',PIXEL_ID,{ph:String(order.tel||'').replace(/\D/g,''),fn:np[0]||'',ln:np.slice(1).join(' ')||'',ct:String(order.ciudad||'').trim().toLowerCase(),country:'co'});}
      const _bIds=Array.isArray(order.items)?order.items.map(it=>pxId(it.type,it.id)):[];
      px('Purchase',{content_ids:_bIds,content_type:'product',value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',num_items:order.pares||1,...getUTM()},(order.reference||order.id)+'_purchase');
      gadsUserData(order); gads('purchase',{value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',transaction_id:String(order.reference||order.id)}); ga4('purchase',{transaction_id:String(order.reference||order.id),value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',items:(order.items||[]).map(it=>({item_id:(it.type==='liq'?'liq_':'cat_')+it.id,item_name:it.label,price:it.precio,quantity:it.qty}))});
      trackEvent('purchase',{price:order.subtotal!=null?order.subtotal:order.total});
      mostrarRecibo(order,'Bold',false);
    }else{mostrarRecibo({reference},'Bold',false);}
  }else{
    setTimeout(()=>alert('⏳ Estamos confirmando tu pago con Bold.\nApenas se confirme te contactamos por WhatsApp.'),300);
  }
}

/* ── ESPERA DE LA APROBACIÓN DE ADDI ──────────────────────────────────────────
   A diferencia de Wompi, Bold y Sistecrédito —donde el servidor le PREGUNTA a la pasarela y
   la respuesta es inmediata— Addi no tiene consulta de estado: hay que esperar a que ELLA
   llame al webhook. Por eso aquí se sondea la BD hasta que aparezca la venta. ── */
function pintarEsperaAddi(){
  if(document.getElementById('addiWait'))return;
  const d=document.createElement('div');
  d.id='addiWait';
  d.style.cssText='position:fixed;inset:0;z-index:800;background:rgba(15,15,15,.92);color:#fff;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:var(--font,system-ui)';
  d.innerHTML='<div style="max-width:340px">'+
    '<div style="font-size:38px;line-height:1">⏳</div>'+
    '<div style="font-size:19px;font-weight:800;margin-top:10px">Confirmando tu crédito con Addi…</div>'+
    '<div style="font-size:13px;opacity:.85;margin-top:8px;line-height:1.5">Addi está aprobando tu compra. Puede tardar un par de minutos.<br><b>No cierres esta página.</b></div>'+
    '</div>';
  document.body.appendChild(d);
}
function cerrarEsperaAddi(){ const d=document.getElementById('addiWait'); if(d)d.remove(); }

/* Devuelve true apenas el pedido queda marcado 'venta'. La PRIMERA consulta va sin esperar
   (por si el webhook ya había llegado antes que el cliente).
   El tope son 2 MINUTOS y no menos: el único caso real medido (#150) tardó 63 segundos, así que
   un tope de 50s —el primero que puse— habría fallado justo en el caso que estamos arreglando. */
async function esperarConfirmacionAddi(reference,maxMs=120000){
  const t0=Date.now();
  let primera=true;
  while(Date.now()-t0<maxMs){
    try{
      const vr=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'addi_status',reference})});
      if(vr.ok){ const t=await vr.json(); if(t.confirmed)return true; }
    }catch(e){}
    if(primera){ primera=false; pintarEsperaAddi(); }   // solo se muestra si de verdad hay que esperar
    await new Promise(r=>setTimeout(r,2500));
  }
  return false;
}

/* ── ADDI (pago a crédito BNPL) — espejo de pagarBold/checkBoldReturn ── */
async function pagarAddi(){
  if(window._payBusy)return;                 // mismo guard anti doble-toque que Bold
  window._payBusy=true;
  setTimeout(()=>{window._payBusy=false;},15000);
  trackEvent('select_payment',{product_id:'addi'});
  const m={nombre:'fn',cedula:'fc',celular:'ft',email:'fem',direccion:'fd',barrio:'fb',ciudad:'fci'};
  let ok=true;const d={};
  Object.entries(m).forEach(([k,id])=>{const el=$(id);const v=el?el.value:(cData[k]||'');d[k]=v.trim();if(!v.trim())ok=false;});
  const emailOk=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email||'');   // Addi exige email para su motor de riesgo
  if(!ok||!emailOk){
    window._payBusy=false;
    cData=Object.assign({},cData,d);   // conservar lo escrito al re-renderizar el formulario
    goStep(1);                          // volver a "Tus datos" (el #ferr y el campo email viven ahí)
    setTimeout(()=>{const e=$('ferr');if(e){e.textContent=(ok&&!emailOk)?'Para pagar con Addi necesitamos un correo electrónico válido':'Completa todos los campos (incluido el correo)';e.classList.add('show');}const em=$('fem');if(em)em.focus();},60);
    return;
  }
  cData=d;
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);
  const tot=pricing.sub;                     // Addi cobra el subtotal (crédito = envío gratis)
  const reference='STR-'+Date.now();
  const totalPares=pricing.pares;
  const aOrder={
    id:Date.now(),fecha:new Date().toISOString(),
    items:cartItems(rows),
    subtotal:tot,envio:0,total:tot,pares:totalPares,pago:'addi',status:'pending',session_id:SESSION_ID,test:!!window.__TEST__,cupon:cuponAplicado||null,
    combo:pricing.combo?pricing.combo.id:null,
    nombre:d.nombre,cedula:d.cedula,ciudad:d.ciudad,barrio:d.barrio,tel:d.celular,direccion:d.direccion,
    reference,utm:{...getUTM(),...getFbAttribution(),...getVisitCtx(),email:d.email},referrer:getReferrer(),seccion:gSel
  };
  orders.push(aOrder);saveState();
  try{
    const saved=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'create_order',...aOrder})}).then(r=>r.ok?r.json():Promise.reject(new Error('order error')));
    if(saved&&saved.order){
      aOrder.reference=saved.order.reference;
      aOrder.subtotal=saved.order.subtotal;aOrder.total=saved.order.total;aOrder.items=saved.order.items;
    }
    const res=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'addi_link',reference:aOrder.reference,email:d.email})});
    const j=await res.json().catch(()=>({}));
    if(!res.ok||!j.url){
      window._payBusy=false;
      if(j&&j.error==='addi_unavailable'){if(confirm('El pago a crédito con Addi se activará muy pronto 🙏\n¿Quieres coordinarlo por WhatsApp?'))enviarWA('credito');return;}
      throw new Error('addi link');
    }
    localStorage.setItem('addi_ref',aOrder.reference);
    location.href=j.url;
  }catch(e){window._payBusy=false;if(confirm('No pudimos conectar con Addi en este momento.\n¿Quieres coordinar tu crédito por WhatsApp?'))enviarWA('credito');}
}

async function checkAddiReturn(){
  const params=new URLSearchParams(location.search);
  if(!params.get('addi'))return;
  const cancel=params.get('addi')==='cancel';
  const reference=localStorage.getItem('addi_ref')||'';
  localStorage.removeItem('addi_ref');
  history.replaceState({},'',location.pathname);
  if(cancel){setTimeout(()=>alert('Cancelaste el pago con Addi. Tu carrito sigue disponible 🛒'),300);return;}
  // Addi confirma por webhook server-to-server, y eso TARDA: en la venta real #150 tardó 63
  // segundos. El cliente vuelve a la tienda en 10-20, así que una sola consulta lo dejaba casi
  // siempre en "estamos confirmando" y NUNCA veía su recibo con los productos. Ahora se espera
  // hasta ~50s preguntando cada 2.5s, con un cartel en pantalla (no un alert, que bloquea).
  const verified = reference ? await esperarConfirmacionAddi(reference) : false;
  cerrarEsperaAddi();
  if(verified){
    comboActivo=null;
    for(const k in cart)delete cart[k];syncDot();
    const order=orders.find(o=>o.reference===reference)||orders.filter(o=>o.pago==='addi'&&o.status==='pending').pop();
    if(order){
      order.status='venta';saveState();
      if(PIXEL_ID&&typeof fbq==='function'){const np=String(order.nombre||'').trim().toLowerCase().split(' ');fbq('init',PIXEL_ID,{ph:String(order.tel||'').replace(/\D/g,''),fn:np[0]||'',ln:np.slice(1).join(' ')||'',ct:String(order.ciudad||'').trim().toLowerCase(),country:'co'});}
      const _aIds=Array.isArray(order.items)?order.items.map(it=>pxId(it.type,it.id)):[];
      px('Purchase',{content_ids:_aIds,content_type:'product',value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',num_items:order.pares||1,...getUTM()},(order.reference||order.id)+'_purchase');
      gadsUserData(order); gads('purchase',{value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',transaction_id:String(order.reference||order.id)}); ga4('purchase',{transaction_id:String(order.reference||order.id),value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',items:(order.items||[]).map(it=>({item_id:(it.type==='liq'?'liq_':'cat_')+it.id,item_name:it.label,price:it.precio,quantity:it.qty}))});
      trackEvent('purchase',{price:order.subtotal!=null?order.subtotal:order.total});
      mostrarRecibo(order,'Addi',true);
    }else{mostrarRecibo({reference},'Addi',true);}
  }else{
    setTimeout(()=>alert('⏳ Estamos confirmando tu crédito con Addi.\nApenas Addi lo apruebe te contactamos por WhatsApp.'),300);
  }
}

/* ── SISTECRÉDITO (pago a crédito BNPL) — espejo de pagarAddi, SIN email ── */
async function pagarSistecredito(){
  if(window._payBusy)return;
  window._payBusy=true;
  setTimeout(()=>{window._payBusy=false;},15000);
  trackEvent('select_payment',{product_id:'sistecredito'});
  const m={nombre:'fn',cedula:'fc',celular:'ft',direccion:'fd',barrio:'fb',ciudad:'fci'};
  let ok=true;const d={};
  Object.entries(m).forEach(([k,id])=>{const el=$(id);const v=el?el.value:(cData[k]||'');d[k]=v.trim();if(!v.trim())ok=false;});
  if(!ok){
    window._payBusy=false;
    cData=Object.assign({},cData,d);
    goStep(1);
    setTimeout(()=>{const e=$('ferr');if(e){e.textContent='Completa todos los campos para continuar';e.classList.add('show');}},60);
    return;
  }
  cData=Object.assign({},cData,d);
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);
  const tot=pricing.sub;                     // Sistecrédito cobra el subtotal (crédito = envío gratis)
  const reference='STR-'+Date.now();
  const totalPares=pricing.pares;
  const sOrder={
    id:Date.now(),fecha:new Date().toISOString(),
    items:cartItems(rows),
    subtotal:tot,envio:0,total:tot,pares:totalPares,pago:'sistecredito',status:'pending',session_id:SESSION_ID,test:!!window.__TEST__,cupon:cuponAplicado||null,
    combo:pricing.combo?pricing.combo.id:null,
    nombre:d.nombre,cedula:d.cedula,ciudad:d.ciudad,barrio:d.barrio,tel:d.celular,direccion:d.direccion,
    reference,utm:{...getUTM(),...getFbAttribution(),...getVisitCtx()},referrer:getReferrer(),seccion:gSel
  };
  orders.push(sOrder);saveState();
  try{
    const saved=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'create_order',...sOrder})}).then(r=>r.ok?r.json():Promise.reject(new Error('order error')));
    if(saved&&saved.order){
      sOrder.reference=saved.order.reference;
      sOrder.subtotal=saved.order.subtotal;sOrder.total=saved.order.total;sOrder.items=saved.order.items;
    }
    const res=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'sistecredito_link',reference:sOrder.reference})});
    const j=await res.json().catch(()=>({}));
    if(!res.ok||!j.url){
      window._payBusy=false;
      if(j&&j.error==='sistecredito_unavailable'){if(confirm('El pago a crédito con Sistecrédito se activará muy pronto 🙏\n¿Quieres coordinarlo por WhatsApp?'))enviarWA('credito');return;}
      throw new Error('sistecredito link');
    }
    localStorage.setItem('sc_ref',sOrder.reference);
    location.href=j.url;
  }catch(e){window._payBusy=false;if(confirm('No pudimos conectar con Sistecrédito en este momento.\n¿Quieres coordinar tu crédito por WhatsApp?'))enviarWA('credito');}
}

async function checkSistecreditoReturn(){
  const params=new URLSearchParams(location.search);
  if(!params.get('sistecredito'))return;
  const cancel=params.get('sistecredito')==='cancel';
  const reference=localStorage.getItem('sc_ref')||'';
  localStorage.removeItem('sc_ref');
  history.replaceState({},'',location.pathname);
  if(cancel){setTimeout(()=>alert('Cancelaste el pago con Sistecrédito. Tu carrito sigue disponible 🛒'),300);return;}
  let verified=false;
  if(reference){
    try{
      // El server consulta el estado en Sistecrédito (getInfoCredit) y marca la venta si está pagado.
      const vr=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'sistecredito_status',reference})});
      if(vr.ok){const t=await vr.json();verified=!!t.confirmed;}
    }catch(e){}
  }
  if(verified){
    comboActivo=null;
    for(const k in cart)delete cart[k];syncDot();
    const order=orders.find(o=>o.reference===reference)||orders.filter(o=>o.pago==='sistecredito'&&o.status==='pending').pop();
    if(order){
      order.status='venta';saveState();
      if(PIXEL_ID&&typeof fbq==='function'){const np=String(order.nombre||'').trim().toLowerCase().split(' ');fbq('init',PIXEL_ID,{ph:String(order.tel||'').replace(/\D/g,''),fn:np[0]||'',ln:np.slice(1).join(' ')||'',ct:String(order.ciudad||'').trim().toLowerCase(),country:'co'});}
      const _sIds=Array.isArray(order.items)?order.items.map(it=>pxId(it.type,it.id)):[];
      px('Purchase',{content_ids:_sIds,content_type:'product',value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',num_items:order.pares||1,...getUTM()},(order.reference||order.id)+'_purchase');
      gadsUserData(order); gads('purchase',{value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',transaction_id:String(order.reference||order.id)}); ga4('purchase',{transaction_id:String(order.reference||order.id),value:order.subtotal!=null?order.subtotal:order.total,currency:'COP',items:(order.items||[]).map(it=>({item_id:(it.type==='liq'?'liq_':'cat_')+it.id,item_name:it.label,price:it.precio,quantity:it.qty}))});
      trackEvent('purchase',{price:order.subtotal!=null?order.subtotal:order.total});
      mostrarRecibo(order,'Sistecrédito',true);
    }else{mostrarRecibo({reference},'Sistecrédito',true);}
  }else{
    setTimeout(()=>alert('⏳ Estamos confirmando tu crédito con Sistecrédito.\nApenas lo aprueben te contactamos por WhatsApp.'),300);
  }
}

/* ── VER PEDIDO (?pedido=) — el render vive en extras.js; el early-return del boot se conserva ── */
function checkPedidoLink(){
  const code=new URLSearchParams(location.search).get('pedido');
  if(!code)return false;
  loadExtras().then(()=>_pedidoViewReal(code)).catch(()=>{});
  return true;
}
