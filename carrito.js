/* ═══ CARRITO ═══ El dinero: carrito, checkout 3 pasos, cupones/combos (pricing),
   contra entrega (WhatsApp), Wompi y Bold con sus retornos. ═══ */

/* ── COMBOS MUNDIALISTAS ── bundles con precio fijo (validados también server-side) ── */
// Fallback si el admin no ha configurado settings.combos. camiseta:true = regalo al completar.
const DEFAULT_COMBOS=[
  {id:'espana',   nombre:'Combo España',   bandera:'🇪🇸', pares:2, precio:379000, img:null, activo:true},
  {id:'francia',  nombre:'Combo Francia',  bandera:'🇫🇷', pares:3, precio:549000, img:null, activo:true},
  {id:'argentina',nombre:'Combo Argentina',bandera:'🇦🇷', pares:4, precio:700000, img:null, activo:true},
  {id:'colombia', nombre:'Combo Colombia', bandera:'🇨🇴', pares:5, precio:860000, img:null, activo:true, camiseta:true}
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

// PRECIOS DEL CARRITO centralizados: combo (precio fijo, sin cupón) o flujo normal con cupón.
// Único lugar donde se decide el subtotal — lo usan carrito, paso 3, WhatsApp, Wompi y Bold.
function cartPricing(rows){
  rows=rows||Object.values(cart);
  const subBruto=rows.reduce((s,{p,qty})=>s+p.price*qty,0);
  const pares=rows.reduce((s,{qty})=>s+qty,0);
  const combo=(comboActivo&&comboActivo.activo!==false&&pares===parseInt(comboActivo.pares))?comboActivo:null;
  const desc=combo?0:cuponDesc(subBruto);
  const sub=combo?parseInt(combo.precio):(subBruto-desc);
  return {subBruto,pares,combo,desc,sub,camiseta:!!(combo&&combo.camiseta)};
}

// Tarjetas de combos en la sección Ofertas
function renderCombos(){
  const box=$('combosRow');if(!box)return;
  const activos=(combos||[]).filter(c=>c&&c.activo!==false);
  if(!activos.length){box.innerHTML='';return;}
  box.innerHTML=`<div style="padding:10px 14px 0"><div style="font-size:17px;font-weight:800;color:var(--ink);letter-spacing:-.01em">🏆 Combos Mundialistas</div><div style="font-size:11.5px;color:var(--ink2);margin-top:2px">Escoge tu selección, arma tu combo y paga precio fijo</div></div>
  <div class="combos-grid">${activos.map(c=>{
    // Con FOTO: la imagen trae todo el diseño (bandera, pares, precio, camiseta) → solo se
    // añade la franja CTA. <picture> sirve la versión escritorio en pantallas ≥700px.
    if(c.img||c.img_desktop){
      const movil=c.img||c.img_desktop, desk=c.img_desktop||c.img;
      return `<div class="combo-card foto" onclick="activarCombo('${escHtml(c.id)}')">
        <picture>${desk!==movil?`<source media="(min-width:700px)" srcset="${escHtml(desk)}">`:''}<img src="${escHtml(movil)}" alt="${escHtml(c.nombre)}" loading="lazy"></picture>
        <div class="combo-cta-strip">Armar ${escHtml(c.nombre)} →</div>
      </div>`;
    }
    return `<div class="combo-card" onclick="activarCombo('${escHtml(c.id)}')">
      <div class="combo-flag">${c.bandera||'⚽'}</div>
      <div class="combo-nom">${escHtml(c.nombre)}</div>
      <div class="combo-det">${c.pares} pares a tu elección</div>
      <div class="combo-precio">${fmt(parseInt(c.precio))}</div>
      ${c.camiseta?`<div class="combo-cami">+ 🎁 CAMISETA GRATIS</div>`:''}
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
  return `<div class="xs-wrap"><div class="xs-title">Completa tu combo 👇</div><div class="xs-row">${cards}</div></div>`;
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
    ?`✅ ¡${escHtml(comboActivo.nombre)} COMPLETO! ${N} pares por ${fmt(parseInt(comboActivo.precio))}${comboActivo.camiseta?' + 🎁 camiseta GRATIS':''} — ve al carrito`
    :n>N
    ?`⚠️ ${escHtml(comboActivo.nombre)}: tienes ${n} pares — el combo es de ${N}. Quita ${n-N}.`
    :`🏆 ${escHtml(comboActivo.nombre)} · ${n}/${N} pares · ${fmt(parseInt(comboActivo.precio))}${comboActivo.camiseta?' + 🎁 camiseta':''}`;
  bar.innerHTML=`<span>${txt}</span><button class="cb-x" onclick="salirCombo()">✕ Salir</button>`;
  // Celebración de la camiseta: UNA vez al completar
  if(n===N&&comboActivo.camiseta&&!_comboCamisetaCelebrada){
    _comboCamisetaCelebrada=true;
    toast('🎉 ¡Gracias por escoger tu selección ganadora! Liberaste una CAMISETA GRATIS 🎁');
  }
  if(n!==N)_comboCamisetaCelebrada=false;
}

function aplicarCupon(){
  const inp=$('cupInput');if(!inp)return;
  const code=inp.value.trim().toUpperCase();
  const cupFail=msg=>{const e=$('cupErr');if(e){e.textContent=msg||'Código no válido';e.style.display='block';setTimeout(()=>{e.style.display='none';e.textContent='Código no válido';},3000);}};
  if(code==='BIENVENIDO20'&&welcomeVencido())return cupFail('Tu código de bienvenida venció (era válido por 7 días) 😢');
  if(CUPONES[code]){cuponAplicado=code;localStorage.setItem('ss_cupon',code);trackEvent('apply_coupon',{product_id:code});rCart();}
  else cupFail();
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
function togCard(id,type,talla){
  const key=cartKey(id,type,talla);
  const list=type==='liq'?liqs:prods;
  const p=list.find(x=>x.id===id);
  if(!p||p.sold)return;
  const wasInCart=!!cart[key];
  cart[key]?delete cart[key]:(cart[key]={p,qty:1,type,talla:talla||null});
  const inCart=!!cart[key];
  if(inCart&&!wasInCart){
    const _acat=type==='liq'?'liquidacion':p.g;
    const _anm=type==='liq'?'Liquidación':(p.g==='h'?'Hombre':'Mujer');
    px('AddToCart',{content_ids:[pxId(type,id)],content_type:'product',content_category:_acat,content_name:_anm,value:p.price,currency:'COP',...getUTM()});
    trackEvent('add_to_cart',{product_id:String(key),price:p.price,gender:type==='liq'?null:p.g});
    startReserva();   // arranca/continúa el contador de reserva al agregar al carrito
    openCart();       // el carrito se despliega como confirmación al agregar cada producto
  }else if(wasInCart&&!inCart){
    toast('Quitado del carrito');
  }
  // sincroniza la tarjeta (grid + lanzamientos + preview): ✓ si está en el carrito en ALGUNA talla
  const anyIn=enCarrito(id,type);
  const els=type==='liq'?[$('lk'+id)]:[$('k'+id),$('kl'+id),$('kp'+id)];
  els.forEach(el=>{
    if(!el)return;
    el.classList.toggle('picked',anyIn);
    const circle=el.querySelector('.add-circle');
    if(circle)circle.textContent=anyIn?'✓':'+';
  });
  syncDot();
  if(pmId===id&&pmType===type)syncPmBtn();
}
// Ítems del pedido para WhatsApp/orders (incluye la talla). Único punto de construcción.
function cartItems(rows){return rows.map(({p,qty,type,talla})=>({label:p.modelo||(type==='liq'?'Liq':(p.g==='h'?'Hombre':'Mujer')),type,id:p.id,brand:p.brand||null,qty,precio:p.price*qty,talla:talla||null}));}

function syncDot(){
  const n=Object.values(cart).reduce((s,i)=>s+i.qty,0);
  [$('bdot'),$('bdot2')].forEach(d=>{if(d){d.textContent=n;d.classList.toggle('show',n>0);}});
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
    cart[cartKey(it.id,it.type,it.talla)]={p,qty:Math.max(1,parseInt(it.qty)||1),type:it.type,talla:it.talla||null};
  });
  syncDot();   // actualiza el contador; las tarjetas marcan ✓ al renderizar (via enCarrito)
}

/* ── CART SHEET ── */
// El carrito se abre como confirmación al agregar (puede ser muchas veces). El evento
// InitiateCheckout NO se dispara al abrir, sino al avanzar a "Tus datos" (goStep 1), para no
// inflar el funnel de Meta. _icFired evita duplicarlo dentro de un mismo ciclo de carrito.
let _icFired=false;

function openCart(){
  step=0;_icFired=false;_comboSugDismiss=false;renderStep();
  $('cscrim').classList.add('on');$('csheet').classList.add('on');lockScroll();
  navPush('carrito','/carrito','Tu carrito — '+STORE_NAME,closeCart);
}

function closeCart(){if(!_navPopping)navRemove('carrito');$('cscrim').classList.remove('on');$('csheet').classList.remove('on');unlockScroll();}

function updDots(){[0,1,2].forEach(i=>{const d=$('cs'+i);d.className='csd'+(i===step?' active':i<step?' done':'');});
  if(step===0){const n=Object.values(cart).reduce((s,i)=>s+i.qty,0);$('cttl').textContent=`Tu carrito (${n} ${n===1?'producto':'productos'})`;}
  else $('cttl').textContent=['Tu pedido','Tus datos','Pagar'][step]+`  ·  Paso ${step+1} de 3`;}

function renderStep(){updDots();[rCart,rForm,rPayChoice][step]();}

function goStep(n){
  // InitiateCheckout = el cliente realmente inicia el checkout (avanza a "Tus datos"), una vez por ciclo.
  if(n===1&&!_icFired){
    _icFired=true;
    const cartVals=Object.values(cart);
    if(cartVals.length){
      const icTotal=cartVals.reduce((s,{p,qty})=>s+p.price*qty,0);
      const icItems=cartVals.reduce((s,{qty})=>s+qty,0);
      const icIds=cartVals.map(({p,type})=>pxId(type,p.id));
      px('InitiateCheckout',{content_ids:icIds,content_type:'product',num_items:icItems,value:icTotal,currency:'COP'});
      trackEvent('initiate_checkout',{price:icTotal});
    }
  }
  // reached_payment = llegó a la pantalla de métodos de pago (paso 3) — mide la fuga datos→pago.
  if(n===2)trackEvent('reached_payment');
  step=n;renderStep();$('cbody').scrollTop=0;
}

function chQty(key,d){if(!cart[key])return;cart[key].qty=Math.max(1,cart[key].qty+d);syncDot();renderStep();}

function rmItem(key){
  const it=cart[key];delete cart[key];
  if(it){
    const el=$(it.type==='liq'?'lk'+it.p.id:'k'+it.p.id);
    if(el){
      el.classList.remove('picked');
      const circle=el.querySelector('.add-circle');
      if(circle)circle.textContent='+';
    }
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
    return `<div class="crow"><div class="crimg">${m}</div><div class="crinfo"><div class="crname">${escHtml(lbl)}</div>${tallaTag}<div class="crprice">${fmt(p.price)} c/u</div></div><div class="cqc"><button class="cqb" onclick="chQty('${key}',-1)">−</button><span class="cqv">${qty}</span><button class="cqb" onclick="chQty('${key}',1)">+</button></div><button class="crm" onclick="rmItem('${key}')">✕</button></div>`;
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
    if(desc>0)   sumRows+=`<div class="csum-row disc"><span>Cupón ${cuponAplicado}</span><span class="v">−${fmt(desc)}</span></div>`;
  }
  sumRows+=`<div class="csum-row"><span>Envío</span><span class="free">Gratis</span></div>`;
  const summary=`<div class="csum"><div class="csum-t">Resumen del pedido</div>${sumRows}<div class="csum-total"><span class="l">Total</span><span class="v">${fmt(totalFinal)}</span></div></div>`;
  // Código promocional: NO acumulable con combo (si el combo aplica, el cupón se oculta/ignora)
  const cupHtml=pricing.combo
    ? (cuponAplicado?`<div class="cart-line" style="background:var(--bg);color:var(--ink3);border-color:var(--line);margin-top:14px"><span class="cl-ic">🏷️</span><span>El cupón no es acumulable con el combo — se aplicó el precio del combo.</span></div>`:'')
    : (cuponAplicado
      ? `<div class="cart-line cart-cupon" style="margin-top:14px"><span class="cl-ic">🏷️</span><span>Cupón <b>${cuponAplicado}</b> aplicado: −${fmt(desc)}</span></div>`
      : `<div class="cpromo"><button class="cpromo-toggle" onclick="toggleCupon()">🏷️ ¿Tienes un código promocional?</button><div class="cpromo-box" id="cpromoBox" style="display:none"><div class="cup-box"><input id="cupInput" placeholder="Código promocional" autocomplete="off"><button class="cup-btn" onclick="aplicarCupon()">Aplicar</button></div><div class="cup-err" id="cupErr" style="display:none">Código no válido</div></div></div>`);
  // 🎉 CAMISETA GRATIS: combo con camiseta COMPLETO
  const camisetaHtml=pricing.camiseta
    ? `<div class="cart-line" style="background:#eafaf0;color:#137a3a;border-color:#bfe9cd;margin-top:12px;font-weight:700"><span class="cl-ic">🎉</span><span>¡Gracias por escoger tu selección ganadora! Liberaste una <b>CAMISETA GRATIS</b> de tu selección 🎁 (confírmanos la talla por WhatsApp)</span></div>`
    :'';
  const gift=`<div class="cart-line cart-regalo" style="margin-top:12px"><span class="cl-ic">🎁</span><span>Incluye <b>guía de cuidado</b> + <b>5%</b> en tu próximo par</span></div>`;
  // Orden: mensajes → productos → escalera de ahorro → aviso combo → resumen → camiseta → código → regalo
  body.innerHTML=msgs+body.innerHTML+escalera+comboAviso+summary+camisetaHtml+cupHtml+gift;
  foot.innerHTML=`<button class="btnmain" onclick="goStep(1)">Ir a pagar &nbsp;→</button>`;
}

function rForm(){
  $('cbody').innerHTML=`<div class="formsec"><div class="formtit">¿A dónde enviamos tu pedido?</div>
    <div class="fld"><label>Nombre completo</label><input id="fn" type="text" autocomplete="name" autocapitalize="words" placeholder="Juan García" value="${escHtml(cData.nombre||'')}"></div>
    <div class="frow"><div class="fld"><label>Cédula</label><input id="fc" type="text" inputmode="numeric" autocomplete="off" placeholder="1000000000" value="${escHtml(cData.cedula||'')}"></div><div class="fld"><label>Celular</label><input id="ft" type="tel" inputmode="tel" autocomplete="tel" placeholder="300 000 0000" value="${escHtml(cData.celular||'')}"></div></div>
    <div class="fld"><label>Dirección</label><input id="fd" type="text" autocomplete="street-address" placeholder="Calle 10 # 25-30" value="${escHtml(cData.direccion||'')}"></div>
    <div class="frow"><div class="fld"><label>Barrio</label><input id="fb" type="text" autocomplete="address-level3" placeholder="El Poblado" value="${escHtml(cData.barrio||'')}"></div><div class="fld"><label>Ciudad</label><input id="fci" type="text" autocomplete="address-level2" autocapitalize="words" placeholder="Medellín" value="${escHtml(cData.ciudad||'')}"></div></div>
    <label for="fconsent" style="display:flex;gap:9px;align-items:flex-start;margin-top:6px;font-size:12px;line-height:1.45;color:var(--ink2);cursor:pointer">
      <input id="fconsent" type="checkbox" ${cData.consent?'checked':''} style="margin-top:2px;width:16px;height:16px;flex:0 0 auto;accent-color:var(--ink)">
      <span>Autorizo el tratamiento de mis datos personales según la <a href="#" onclick="openLegal('privacidad');return false" style="color:var(--ink);font-weight:700">Política de Privacidad</a> (Ley 1581 de 2012).</span>
    </label>
    <div class="ferr" id="ferr">Completa todos los campos y acepta la política de datos</div></div>`;
  $('cfoot').innerHTML=`<button class="btnmain" onclick="saveFormAndNext()">Continuar &nbsp;→</button><button class="btnback" onclick="goStep(0)">← Volver</button>`;
}

function saveFormAndNext(){
  const m={nombre:'fn',cedula:'fc',celular:'ft',direccion:'fd',barrio:'fb',ciudad:'fci'};
  let ok=true;const d={};
  Object.entries(m).forEach(([k,id])=>{const v=($( id)||{}).value||'';d[k]=v.trim();if(!v.trim())ok=false;});
  const consent=!!($('fconsent')||{}).checked;
  if(!ok||!consent){const e=$('ferr');if(e)e.classList.add('show');return;}
  d.consent=true;
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
    subtotal:sub,envio:0,total:sub,pares:totalPares,pago:null,status:'abandoned',session_id:SESSION_ID,
    combo:pricing.combo?pricing.combo.id:null,
    nombre:d.nombre,cedula:d.cedula,ciudad:d.ciudad,barrio:d.barrio,tel:d.celular,direccion:d.direccion,
    utm:{...getUTM(),...getFbAttribution(),...getVisitCtx()},referrer:getReferrer(),seccion:gSel
  };
  fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(lead)})
    .then(()=>sessionStorage.setItem('ss_lead_saved',SESSION_ID)).catch(()=>{});
}

function calcFlete(pares){return 25000+Math.max(0,pares-1)*15000;}

function rPayChoice(){
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);          // combo (precio fijo) o normal con cupón
  const sub=pricing.sub;
  const pares=pricing.pares;
  const flete=calcFlete(pares);
  const SV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">';
  const icTruck=SV+'<path d="M2.5 6.5h11v9h-11z"/><path d="M13.5 9.5h4l3 3v3h-7z"/><circle cx="6" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/></svg>';
  const icBank=SV+'<path d="M3 9.5l9-5 9 5"/><path d="M5 10v7M9.5 10v7M14.5 10v7M19 10v7"/><path d="M3.5 20h17"/></svg>';
  const icCard=SV+'<rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 9.5h19"/><path d="M6 14.5h4"/></svg>';
  const icCuotas=SV+'<rect x="3.5" y="4.5" width="17" height="16" rx="2.5"/><path d="M3.5 9.5h17"/><path d="M8 3v3M16 3v3"/><path d="M8.3 14.5l2 2 4-4"/></svg>';
  // Logo real con fallback al SVG genérico si el archivo no existe (mismo patrón que la ficha)
  const icLogo=(src,alt,fb)=>`<img src="${src}" alt="${alt}" class="pc-logo" onerror="this.outerHTML=${JSON.stringify(fb).replace(/"/g,'&quot;')}">`;
  const card=(fn,acc,tint,ico,tit,desc,tot)=>`<button class="paychoice" onclick="${fn}" style="--acc:${acc}"><span class="pc-ic" style="background:${tint}">${ico}</span><span class="pc-main"><span class="pc-tit">${tit}</span><span class="pc-desc">${desc}</span><span class="pc-tot">${tot}</span></span><span class="pc-arrow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span></button>`;
  $('cbody').innerHTML=`<div class="paysec"><div class="paytit">¿Cómo quieres pagar?</div><div class="paychoice-list">`
    +card(`enviarWA('contra_entrega')`,'#1E1E1C','#f1f1ef',icTruck,'Contra entrega',`Pagas el envío ahora y los zapatos al recibir en casa`,`Hoy: envío ${fmt(flete)} · Al recibir: ${fmt(sub)}`)
    +card(`enviarWA('pago_anticipado')`,'#FF7A00','#fff3e6',icBank,'Pago anticipado','Transfieres antes · Envío GRATIS ✓',`Total a pagar: ${fmt(sub)}`)
    +card(`pagarWompi()`,'#5D2D91','#fff',icLogo('/logos/wompi.png','Wompi',icCard),'Pagar en línea — Wompi','Tarjeta · PSE · Nequi · Bancolombia · Envío GRATIS ✓',`Total a pagar: ${fmt(sub)}`)
    +card(`pagarBold()`,'#2541B2','#fff',icLogo('/logos/bold.png','Bold',icCard),'Pagar en línea — Bold','Tarjeta · PSE · Botón Bancolombia · Envío GRATIS ✓',`Total a pagar: ${fmt(sub)}`)
    +card(`enviarWA('credito')`,'#0a7d4b','#fff',`<span class="pc-logos2">${icLogo('/logos/addi.png','Addi',icCuotas)}${icLogo('/logos/sistecredito.png','Sistecrédito','')}</span>`,'Pagar a crédito — Addi / Sistecrédito','En cuotas · Te asesoramos por WhatsApp · Envío GRATIS ✓',`Total a pagar: ${fmt(sub)}`)
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
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);         // combo (precio fijo) o normal con cupón
  const subBruto=pricing.subBruto;
  const desc=pricing.desc;
  const sub=pricing.sub;
  const totalPares=pricing.pares;
  const flete=tipo==='contra_entrega'?calcFlete(totalPares):0;
  const tot=sub+flete;
  let items='';
  rows.forEach(({p,qty,type,talla})=>{const s=p.price*qty;const lbl=p.modelo||(type==='liq'?'Liquidación':(p.g==='h'?'Hombre':'Mujer'));const mk=p.brand?(BRAND_LABELS[p.brand]||p.brand)+' · ':'';items+=`  • ${mk}${lbl} · #${p.id}${talla?` · Talla ${talla}`:''} x${qty} — ${fmt(s)}\n`;});
  // UN solo link que abre TODO el pedido con fotos (más fácil para el vendedor que link por link).
  const pedidoCode=rows.map(({p,qty,type})=>(type==='liq'?'L':'')+p.id+'x'+qty).join(',');
  const pedidoLink=`https://strangesneakers.com/?pedido=${pedidoCode}`;
  const envioLinea=tipo==='contra_entrega'?`🚚 *Envío (se paga primero):* ${fmt(flete)}\n👟 *Zapatos (pagas al recibir en casa):* ${fmt(sub)}`:`📦 *Envío: GRATIS ✓*`;
  // Ahorro REAL del combo: contra el precio original (antes→ahora + combo), igual que el carrito.
  const origWA=rows.reduce((s,{p,qty})=>{const act=(p.promo||promoG)&&p.was&&p.was>p.price;return s+(act?p.was:p.price)*qty;},0);
  const descLinea=pricing.combo
    ?`🏆 *${pricing.combo.nombre}: ${pricing.combo.pares} pares por ${fmt(pricing.sub)}* (ahorra en total ${fmt(Math.max(origWA,subBruto)-pricing.sub)})\n${pricing.camiseta?`🎁 *CAMISETA GRATIS de su selección* — pedirle la talla ⚽\n`:''}`
    :(desc>0?`🏷️ *Descuento ${cuponAplicado}:* -${fmt(desc)}\n`:'');
  const pagoLbl=tipo==='contra_entrega'?'Contra entrega 📦':tipo==='credito'?'Crédito (Addi / Sistecrédito) 🧾':'Pago anticipado 💸';
  const instruccion=tipo==='contra_entrega'?`El cliente paga primero el *ENVÍO* (${fmt(flete)}) y los *zapatos al recibir* en casa. Coordinemos el pago del envío 🙏`:tipo==='credito'?'El cliente quiere pagar a *CRÉDITO*. Indícale si aplica por *Addi* o *Sistecrédito* y el paso a paso 🙏':'Enviar comprobante de pago para procesar el envío 🙏';
  const msg=`🛍️ *NUEVO PEDIDO — ${STORE_NAME}*\n━━━━━━━━━━━━━━━━━━━━\n👟 *PRODUCTOS*\n${items}\n📸 *Ver el pedido con fotos:*\n${pedidoLink}\n━━━━━━━━━━━━━━━━━━━━\n💰 *Subtotal: ${fmt(subBruto)}*\n${descLinea}${envioLinea}\n💰 *TOTAL: ${fmt(tot)}*\n━━━━━━━━━━━━━━━━━━━━\n👤 *DATOS*\n• Nombre: ${d.nombre}\n• Cédula: ${d.cedula}\n• Celular: ${d.celular}\n• Dirección: ${d.direccion}\n• Barrio: ${d.barrio}\n• Ciudad: ${d.ciudad}\n━━━━━━━━━━━━━━━━━━━━\n💳 *Pago:* ${pagoLbl}\n━━━━━━━━━━━━━━━━━━━━\n${instruccion}\n\n🎁 *Tu regalo — Guía de cuidado de tus sneakers:*\nhttps://strangesneakers.com/?regalo=cuidado`;
  const orderObj={
    id:Date.now(),fecha:new Date().toISOString(),
    items:cartItems(rows),
    subtotal:sub,envio:flete,total:tot,pares:totalPares,pago:tipo,session_id:SESSION_ID,cupon:cuponAplicado||null,
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
  trackEvent('lead',{price:sub});
  orders.push(orderObj);
  saveState();
  // Fire-and-forget (sin await: un await rompe window.open en iOS Safari — pierde la
  // activación del gesto → popup bloqueado). keepalive:true hace que el navegador complete
  // el request aunque la pestaña navegue a WhatsApp — sin esto el pedido/lead podía perderse.
  fetch('/api/orders',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'create_order',...orderObj})}).catch(()=>{});
  if(SHEETS_URL){fetch(SHEETS_URL,{method:'POST',keepalive:true,body:JSON.stringify(orderObj),headers:{'Content-Type':'application/json'}}).catch(()=>{});}
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');
  return false;
}

async function pagarWompi(){
  if(window._payBusy)return; // guard anti doble-toque (igual que pagarBold)
  window._payBusy=true;
  setTimeout(()=>{window._payBusy=false;},15000); // red de escape por si algo cuelga
  trackEvent('select_payment',{product_id:'wompi'});
  const m={nombre:'fn',cedula:'fc',celular:'ft',direccion:'fd',barrio:'fb',ciudad:'fci'};
  let ok=true;const d={};
  Object.entries(m).forEach(([k,id])=>{const el=$(id);const v=el?el.value:(cData[k]||'');d[k]=v.trim();if(!v.trim())ok=false;});
  if(!ok){const e=$('ferr');if(e)e.classList.add('show');return;}
  cData=d;
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);
  const tot=pricing.sub;                   // Wompi cobra el subtotal (combo o con cupón; envío gratis)
  const reference='STR-'+Date.now();
  const totalPares=pricing.pares;
  const wOrder={
    id:Date.now(),fecha:new Date().toISOString(),
    items:cartItems(rows),
    subtotal:tot,envio:0,total:tot,pares:totalPares,pago:'wompi',status:'pending',session_id:SESSION_ID,cupon:cuponAplicado||null,
    combo:pricing.combo?pricing.combo.id:null,
    nombre:d.nombre,cedula:d.cedula,ciudad:d.ciudad,barrio:d.barrio,tel:d.celular,direccion:d.direccion,
    reference,utm:{...getUTM(),...getFbAttribution(),...getVisitCtx()},referrer:getReferrer(),seccion:gSel
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
      trackEvent('purchase',{price:order.subtotal!=null?order.subtotal:order.total});
      let items='';
      order.items.forEach(it=>{const mk=it.brand?(BRAND_LABELS[it.brand]||it.brand)+' · ':'';const ref=it.id?` · #${it.id}`:'';const ln=it.id?`\n     👉 https://strangesneakers.com/p/${it.type==='liq'?'L':''}${it.id}`:'';items+=`  • ${mk}${it.label}${ref}${it.talla?` · Talla ${it.talla}`:''} x${it.qty} — ${fmt(it.precio)}${ln}\n`;});
      const msg=`✅ *PAGO CONFIRMADO — ${STORE_NAME}*\n━━━━━━━━━━━━━━━━━━━━\n👟 *PRODUCTOS*\n${items}\n📦 *Envío: GRATIS ✓*\n💰 *TOTAL: ${fmt(order.total)}*\n━━━━━━━━━━━━━━━━━━━━\n👤 *DATOS*\n• Nombre: ${order.nombre}\n• Cédula: ${order.cedula||'-'}\n• Celular: ${order.tel}\n• Dirección: ${order.direccion||'-'}\n• Barrio: ${order.barrio}\n• Ciudad: ${order.ciudad}\n• Ref: ${reference}\n━━━━━━━━━━━━━━━━━━━━\n💜 *Pago Wompi:* Confirmado ✓\n━━━━━━━━━━━━━━━━━━━━\n¡Gracias por tu compra! Tu pedido está siendo procesado 🙏\n\n🎁 *Tu regalo — Guía de cuidado de tus sneakers:*\nhttps://strangesneakers.com/?regalo=cuidado`;
      setTimeout(()=>{
        alert('✅ ¡Pago confirmado!\nEn un momento recibirás confirmación por WhatsApp.');
        window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');
      },300);
    }else{
      setTimeout(()=>alert('✅ ¡Pago confirmado con Wompi!\nTu pedido está en camino. Pronto te contactamos.'),300);
    }
  }else if(status==='APPROVED'){
    // Wompi (vía URL) dice aprobado pero no pudimos verificarlo server-side.
    setTimeout(()=>alert('⏳ Estamos confirmando tu pago.\nApenas se confirme te contactaremos por WhatsApp.'),300);
  }else if(status){
    setTimeout(()=>alert('❌ El pago no fue completado.\nPuedes intentar de nuevo o elegir otro método de pago.'),300);
  }
}

/* ── PAGO EN LÍNEA: BOLD (Payment Link API; firma/llave en api/orders.js) ── */
async function pagarBold(){
  // Guard anti doble-toque: un 2º tap mientras se crea el link generaba un pedido GEMELO
  // (visto en la compra de prueba real del 2026-06-11). Si tiene éxito, la página navega
  // a Bold y el guard muere con ella; si falla, el timeout lo libera.
  if(window._payBusy)return;
  window._payBusy=true;
  setTimeout(()=>{window._payBusy=false;},15000);
  trackEvent('select_payment',{product_id:'bold'});
  const m={nombre:'fn',cedula:'fc',celular:'ft',direccion:'fd',barrio:'fb',ciudad:'fci'};
  let ok=true;const d={};
  Object.entries(m).forEach(([k,id])=>{const el=$(id);const v=el?el.value:(cData[k]||'');d[k]=v.trim();if(!v.trim())ok=false;});
  if(!ok){const e=$('ferr');if(e)e.classList.add('show');return;}
  cData=d;
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);
  const tot=pricing.sub;                   // Bold cobra el subtotal (combo o con cupón; envío gratis)
  const reference='STR-'+Date.now();
  const totalPares=pricing.pares;
  const bOrder={
    id:Date.now(),fecha:new Date().toISOString(),
    items:cartItems(rows),
    subtotal:tot,envio:0,total:tot,pares:totalPares,pago:'bold',status:'pending',session_id:SESSION_ID,cupon:cuponAplicado||null,
    combo:pricing.combo?pricing.combo.id:null,
    nombre:d.nombre,cedula:d.cedula,ciudad:d.ciudad,barrio:d.barrio,tel:d.celular,direccion:d.direccion,
    reference,utm:{...getUTM(),...getFbAttribution(),...getVisitCtx()},referrer:getReferrer(),seccion:gSel
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
      trackEvent('purchase',{price:order.subtotal!=null?order.subtotal:order.total});
      let items='';order.items.forEach(it=>{const mk=it.brand?(BRAND_LABELS[it.brand]||it.brand)+' · ':'';const ref=it.id?` · #${it.id}`:'';const ln=it.id?`\n     👉 https://strangesneakers.com/p/${it.type==='liq'?'L':''}${it.id}`:'';items+=`  • ${mk}${it.label}${ref}${it.talla?` · Talla ${it.talla}`:''} x${it.qty} — ${fmt(it.precio)}${ln}\n`;});
      const msg=`✅ *PAGO CONFIRMADO — ${STORE_NAME}*\n━━━━━━━━━━━━━━━━━━━━\n👟 *PRODUCTOS*\n${items}\n📦 *Envío: GRATIS ✓*\n💰 *TOTAL: ${fmt(order.total)}*\n━━━━━━━━━━━━━━━━━━━━\n👤 *DATOS*\n• Nombre: ${order.nombre}\n• Celular: ${order.tel}\n• Dirección: ${order.direccion||'-'}\n• Ciudad: ${order.ciudad}\n• Ref: ${reference}\n━━━━━━━━━━━━━━━━━━━━\n💳 *Pago Bold:* Confirmado ✓\n━━━━━━━━━━━━━━━━━━━━\n¡Gracias por tu compra! 🙏\n\n🎁 *Tu regalo — Guía de cuidado:*\nhttps://strangesneakers.com/?regalo=cuidado`;
      setTimeout(()=>{alert('✅ ¡Pago confirmado!\nEn un momento recibirás confirmación por WhatsApp.');window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`,'_blank');},300);
    }else{setTimeout(()=>alert('✅ ¡Pago confirmado con Bold!\nTu pedido está en camino. Pronto te contactamos.'),300);}
  }else{
    setTimeout(()=>alert('⏳ Estamos confirmando tu pago con Bold.\nApenas se confirme te contactamos por WhatsApp.'),300);
  }
}

/* ── VER PEDIDO (?pedido=) — el render vive en extras.js; el early-return del boot se conserva ── */
function checkPedidoLink(){
  const code=new URLSearchParams(location.search).get('pedido');
  if(!code)return false;
  loadExtras().then(()=>_pedidoViewReal(code)).catch(()=>{});
  return true;
}
