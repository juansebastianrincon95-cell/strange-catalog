/* ── MODAL DE COMPRA RÁPIDA (contenido de elenacuidadocapilar.com, apariencia de sahet.co) ──
   Se abre desde buyNowFicha() (tienda.js) SIN cerrar la ficha del producto — calcado de sahet.co
   (revisado en vivo por DOM, 2026-09-03): UNA tarjeta con DOS pestañas que comparten el mismo
   estado:
     · BOLSA  — lista editable (foto+stepper+Eliminar) de lo que ya está en el carrito.
     · PAGAR  — ① Datos de envío, ② Medios de pago, ③ Confirmación (resumen de solo lectura +
                desglose de precio), y el botón final de pago.
   Arranca en PAGAR (buyNowFicha ya salta la revisión del carrito a propósito) pero BOLSA queda
   siempre a un clic si el cliente quiere ajustar cantidad o quitar algo — igual que en sahet,
   donde ambas pestañas están siempre accesibles y cambiar de una a otra no pierde nada.

   Reusa tal cual (sin tocarlas) las funciones reales de pago de carrito.js: enviarWA/pagarWompi/
   pagarBold leen los campos del formulario por id ($('fn')...$('fci')) sin saber en qué
   contenedor viven ni qué apariencia tienen — por eso formEnvioSahetHTML() usa los MISMOS ids
   que el formEnvioHTML() clásico, y leerFormEnvio() (carrito.js) se reusa sin cambios.
   rPayChoice() y el #csheet clásico NO se tocan: siguen siendo el único camino para todo lo demás
   (grid, favoritos, lanzamientos, búsqueda) vía togCard().

   window.BUY_MODAL_ON=false permite volver al flujo clásico (csheet) sin tocar código. */
const BUY_MODAL_ON=true;

let bmIntent=null,bmCtx=null,bmGwSelected=null,bmTab='pagar';

// Iconos de línea (mismo template SVG que ya usa rPayChoice() en carrito.js: viewBox 24x24,
// stroke=currentColor) — sahet.co usa iconos de contorno minimalistas, no emoji.
const BM_SV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';
const BM_ICONS={
  cedula:BM_SV+'<rect x="2" y="5.5" width="20" height="13" rx="2"/><circle cx="8" cy="12" r="1.8"/><path d="M13 10.3h6M13 13.7h4"/></svg>',
  nombre:BM_SV+'<circle cx="12" cy="8" r="3.3"/><path d="M5 20c0-4 3.1-6.6 7-6.6s7 2.6 7 6.6"/></svg>',
  whatsapp:BM_SV+'<path d="M8 10.3c.9 2 2.9 4 4.9 4.9l1.1-1.4c.3-.3.7-.4 1.1-.2.8.4 1.6.6 2.5.7.5.1.9.5.9 1v2.1c0 .6-.5 1-1 1-6.6 0-12-5.4-12-12 0-.5.4-1 1-1h2.1c.5 0 .9.4 1 .9.1.9.3 1.7.7 2.5.2.4.1.8-.2 1.1z"/></svg>',
  email:BM_SV+'<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><path d="M3 6.5l9 6.3 9-6.3"/></svg>',
  ciudad:BM_SV+'<path d="M12 21s6.5-6 6.5-10.8A6.5 6.5 0 1 0 5.5 10.2C5.5 15 12 21 12 21z"/><circle cx="12" cy="10" r="2.2"/></svg>',
  direccion:BM_SV+'<path d="M4 11.2 12 4.5l8 6.7"/><path d="M6 10v9.5h12V10"/><path d="M10 19.5v-5.8h4v5.8"/></svg>',
  barrio:BM_SV+'<path d="M3.5 20.5v-9l5-3.3 5 3.3v9z"/><path d="M13.5 20.5V7l5-3v16.5"/><path d="M7 20.5v-4h3v4"/></svg>',
  chevron:BM_SV+'<path d="M6 15l6-6 6 6"/></svg>'
};

function openBuyModal(intent){
  bmIntent=intent;
  bmCtx={id:pmId,type:pmType,talla:pmTalla};
  bmGwSelected=null;
  bmTab='pagar';
  // Limpia el csheet clásico: si quedó renderizado detrás (ej. el cliente había abierto el
  // carrito antes), sus inputs #fn/#fc/... duplicarían los ids del formulario de este modal y
  // $('fn') tomaría el primero en el DOM (el del csheet, que precede a #buyModal) — vacío o
  // desactualizado. openCart() ya re-renderiza siempre, así que esto es inocuo.
  {const cb=$('cbody');if(cb)cb.innerHTML='';const cf=$('cfoot');if(cf)cf.innerHTML='';}
  syncDescuentosAuto();
  fireInitiateCheckout();
  trackEvent('reached_payment');
  renderBuyModal();
  {const bm=$('buyModal');const _ya=bm.classList.contains('on');if(!_ya)lockScroll();$('bmScrim').classList.add('on');bm.classList.add('on');}
  $('cartBar').classList.add('hide');
  navPush('checkout','/carrito','Finaliza tu pedido — '+STORE_NAME,closeBuyModal);
}

function closeBuyModal(){
  // Guard: si ya estaba cerrado, no vuelvas a llamar unlockScroll() — evita desincronizar
  // _slCount con un doble-cierre (ej. doble-tap en un link que ya removió su propio botón).
  if(!$('buyModal').classList.contains('on'))return;
  if(!_navPopping)navRemove('checkout');
  $('bmScrim').classList.remove('on');
  $('buyModal').classList.remove('on');
  unlockScroll();
  $('cartBar').classList.remove('hide');
  $('bmBody').innerHTML='';$('bmFoot').innerHTML='';
  bmIntent=null;bmCtx=null;
}

// ── Pestañas BOLSA / PAGAR (calcadas de sahet.co: "BOLSA [n]" con badge negro, "PAGAR $total"
// con el monto — cambiar de una a otra no pierde nada, comparten el mismo cart/cData). ──
function bmMontoAPagar(){
  const {pares,sub}=cartPricing();
  const flete=bmIntent==='contra_entrega'?calcFlete(pares,(($('fci')||{}).value)||(cData&&cData.ciudad)||'',sub):0;
  return sub+flete;
}
function bmTabsHTML(){
  const totalPares=Object.values(cart).reduce((s,{qty})=>s+qty,0);
  return `<button type="button" class="bm-tab${bmTab==='bolsa'?' on':''}" onclick="bmSwitchTab('bolsa')">Bolsa <span class="bm-tab-badge">${totalPares}</span></button>
    <button type="button" class="bm-tab${bmTab==='pagar'?' on':''}" onclick="bmSwitchTab('pagar')">Pagar <span class="bm-tab-tot">${fmt(bmMontoAPagar())}</span></button>`;
}
function bmRefreshTabs(){
  const box=$('bmTabs');if(box)box.innerHTML=bmTabsHTML();
}
function bmSwitchTab(tab){
  bmTab=tab;
  renderBuyModal();
}

function bmTotalsHTML(){
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);
  const orig=rows.reduce((s,{p,qty})=>{const act=(p.promo||promoG)&&p.was&&p.was>p.price;return s+(act?p.was:p.price)*qty;},0);
  const ahorroTotal=orig-pricing.sub;
  const pctOff=orig>0?Math.round((ahorroTotal/orig)*100):0;
  const ciudadViva=(($('fci')||{}).value)||(cData&&cData.ciudad)||'';
  const flete=bmIntent==='contra_entrega'?calcFlete(pricing.pares,ciudadViva,pricing.sub):0;
  const totalFinal=pricing.sub+flete;
  const discRow=ahorroTotal>0?`<div class="sr-trow"><span class="sr-offpill">-${pctOff}% OFF</span><span class="sr-off-v">−${fmt(ahorroTotal)}</span></div>`:'';
  return `<div class="sr-trow"><span>Productos</span><span class="v">${fmt(orig)}</span></div>${discRow}<div class="sr-trow"><span>Envío</span><span class="v${flete===0?' free':''}">${flete===0?'Gratis':fmt(flete)}</span></div><div class="sr-trow sr-total"><span>Total</span><span class="v">${fmt(totalFinal)}</span></div>`;
}
function bmRefreshTotales(){
  const box=$('srTotals');if(box)box.innerHTML=bmTotalsHTML();
  bmRefreshTabs();
}

// ── BOLSA: lista editable (foto grande+nombre+"Eliminar"+"Talla X"+stepper+precio), calcada
// por DOM de la BOLSA real de sahet.co. Reusa .cqb/.cqv, el mismo stepper del carrito clásico. ──
function bmProductosListHTML(){
  return Object.entries(cart).map(([key,{p,qty,type,talla}])=>{
    const img=p.img?`<img src="${p.img}" alt="${altProd(p)}">`:`<span style="font-size:30px">${type==='liq'?'🔥':'👟'}</span>`;
    const nom=p.modelo||(type==='liq'?'Liquidación':(p.g==='h'?'Hombre':'Mujer'));
    return `<div class="sr-row">
      <div class="sr-row-ph">${img}</div>
      <div class="sr-row-info">
        <div class="sr-row-top"><span class="sr-row-nom">${escHtml(nom)}</span><button type="button" class="sr-row-elim" onclick="bmRmItem('${key}')">Eliminar</button></div>
        ${talla?`<div class="sr-row-talla">Talla ${escHtml(String(talla))}</div>`:''}
        <div class="cqc"><button class="cqb" onclick="bmChQty('${key}',-1)">−</button><span class="cqv">${qty}</span><button class="cqb" onclick="bmChQty('${key}',1)">+</button></div>
        <div class="sr-row-precio">${fmt(p.price*qty)}</div>
      </div>
    </div>`;
  }).join('');
}
function bmBolsaHTML(){
  return `<div id="srList">${bmProductosListHTML()}</div>`;
}
function bmBolsaFooterHTML(){
  return `<button class="btnmain" onclick="bmSwitchTab('pagar')">Ir a pagar ${fmt(bmMontoAPagar())}</button>`;
}
function bmRefreshProductos(){
  const list=$('srList');if(list)list.innerHTML=bmProductosListHTML();
  bmRefreshTabs();
}
// +/− de cantidad y "Eliminar" — mismo patrón que chQty()/rmItem() (carrito.js), pero refresca
// las funciones propias del modal (totales/medios de pago dependen de cartPricing(), que cambia
// con la cantidad) en vez de renderStep(). syncDot() sí es compartida: mantiene el contador del
// carrito flotante del sitio sincronizado sin importar desde qué UI se editó.
function bmChQty(key,d){
  if(!cart[key])return;
  cart[key].qty=Math.max(1,cart[key].qty+d);
  bmGwSelected=null;
  syncDot();
  bmRefreshProductos();
  bmRefreshTotales();
  bmRefreshMediosPago();
  if($('bmFoot')&&bmTab==='bolsa')$('bmFoot').innerHTML=bmBolsaFooterHTML();
}
function bmRmItem(key){
  delete cart[key];
  syncDot();
  // Este modal existe SOLO porque ya había un producto elegido — si el cliente lo quita y no
  // queda nada más, no hay nada que pagar: se cierra y listo (la ficha ya estaba abierta detrás,
  // closeBuyModal() no la toca, así que "volver a la ficha" es simplemente no hacer nada más).
  if(!Object.keys(cart).length){closeBuyModal();return;}
  bmGwSelected=null;
  bmRefreshProductos();
  bmRefreshTotales();
  bmRefreshMediosPago();
  if($('bmFoot')&&bmTab==='bolsa')$('bmFoot').innerHTML=bmBolsaFooterHTML();
}

// ── PAGAR — ① Datos de envío: icono + etiqueta chica arriba + input abajo (revisado en vivo en
// sahet.co por DOM: NO es un placeholder que desaparece al escribir — es una etiqueta fija de
// verdad, siempre visible, con el valor escrito debajo). Mismos ids que formEnvioHTML()
// (carrito.js), así que enviarWA/pagarWompi/pagarBold/leerFormEnvio los leen igual. ──
function formEnvioSahetHTML(){
  const f=(id,ph,ic,val,type,extra,oninput)=>`<div class="sf-fld"><span class="sf-ic">${ic}</span><div class="sf-fld-b"><label class="sf-lbl" for="${id}">${ph}</label><input id="${id}" type="${type||'text'}" ${extra||''} oninput="${oninput||'bmRefreshDatosStep()'}" value="${escHtml(val||'')}"></div></div>`;
  return `<div class="sf-sec" id="sfSecDatos" style="margin-top:0">
    <div class="sf-head"><span class="sf-num">1</span>Datos de envío<span class="sf-chev">${BM_ICONS.chevron}</span></div>
    <div class="sf-body">
      ${f('fc','CÉDULA',BM_ICONS.cedula,cData.cedula,'text','inputmode="numeric" autocomplete="off"')}
      ${f('fn','NOMBRE COMPLETO',BM_ICONS.nombre,cData.nombre,'text','autocomplete="name" autocapitalize="words"')}
      ${f('ft','WHATSAPP',BM_ICONS.whatsapp,cData.celular,'tel','inputmode="tel" autocomplete="tel"')}
      ${f('fem','EMAIL',BM_ICONS.email,cData.email,'email','inputmode="email" autocomplete="email"')}
      ${f('fci','CIUDAD O MUNICIPIO',BM_ICONS.ciudad,cData.ciudad,'text','autocomplete="address-level2" autocapitalize="words"','bmRefreshTotales();bmGwSelected=null;bmRefreshMediosPago();bmRefreshDatosStep()')}
      ${f('fd','DIRECCIÓN',BM_ICONS.direccion,cData.direccion,'text','autocomplete="street-address"')}
      ${f('fb','BARRIO',BM_ICONS.barrio,cData.barrio,'text','autocomplete="address-level3"')}
      <div class="ferr" id="ferr">Completa todos los campos y acepta la política de datos</div>
    </div>
  </div>`;
}

// ¿Los 6 campos requeridos de "Datos de envío" están llenos? (email es opcional, igual que en
// leerFormEnvio()). Solo mira si hay texto — la validación real de verdad sigue siendo
// leerFormEnvio() al pagar; esto es puramente visual (círculo/línea en negro, estilo sahet.co).
function bmDatosCompletos(){
  return ['fc','fn','ft','fd','fb','fci'].every(id=>{const el=$(id);return el&&el.value.trim();});
}
function bmRefreshDatosStep(){
  const sec=$('sfSecDatos');if(sec)sec.classList.toggle('sf-done',bmDatosCompletos());
}

// ¿Hace falta elegir pasarela para el envío? Solo aplica a contra entrega con flete>0 (si es
// $0 o el intent es whatsapp, no hay nada que cobrar por adelantado — enviarWA basta).
function bmNeedsGateway(){
  if(bmIntent!=='contra_entrega')return false;
  const {pares,sub}=cartPricing();
  const ciudadViva=(($('fci')||{}).value)||(cData&&cData.ciudad)||'';
  return calcFlete(pares,ciudadViva,sub)>0;
}

function bmConsentHTML(){
  // Lee el checkbox EN VIVO si ya existe (bmMediosPagoBodyHTML se re-pinta al elegir/cambiar
  // pasarela o al escribir la ciudad — sin esto, cada re-render lo reconstruía desde cData.consent,
  // que sigue en false hasta pagar, y le borraba la marca al cliente que ya lo había tildado).
  const checked=$('fconsent')?$('fconsent').checked:!!cData.consent;
  return `<label class="sf-consent" for="fconsent">
    <input id="fconsent" type="checkbox" ${checked?'checked':''}>
    <span>Al dar clic en el siguiente botón aceptas haber leído nuestra <a href="#" onclick="openLegal('privacidad');return false">Política de Datos</a> y nuestras condiciones de <a href="#" onclick="openInfo('cambios');return false">Cambios y Garantías</a>.</span>
  </label>`;
}

// ── PAGAR — ② Medios de pago: si no hace falta elegir pasarela, solo el método ya tocado en la
// ficha (WhatsApp/Contra entrega). Si el envío tiene costo, se elige Wompi o Bold — igual que
// sahet.co (revisado en vivo: elegir un método solo lo SELECCIONA, colapsa el resto y deja un
// link "Cambiar"; el pago real se dispara con un botón "Pagar $X" aparte, al final) tocar
// Wompi/Bold aquí NO paga todavía — solo marca bmGwSelected. El botón del pie (bmFooterHTML) es
// el que valida y llama a pagarWompi/pagarBold, ya con la pasarela elegida. ──
function bmMediosPagoBodyHTML(){
  if(bmIntent==='whatsapp')return `<div class="sf-metodo">💬 Pago por WhatsApp</div>${bmConsentHTML()}`;
  const {pares,sub}=cartPricing();
  const ciudadViva=(($('fci')||{}).value)||(cData&&cData.ciudad)||'';
  const flete=calcFlete(pares,ciudadViva,sub);
  if(flete<=0)return `<div class="sf-metodo">🚚 Contra entrega</div>${bmConsentHTML()}`;
  const desc=`<div class="sf-metodo-tx">Paga ahora <b>solo el envío: ${fmt(flete)}</b>. Los zapatos (<b>${fmt(sub)}</b>) los pagas <b>al recibir en casa</b> 📦</div>`;
  // Botones pequeños solo-logo, calcados de los métodos de pago reales de sahet.co.
  const gws=bmGwSelected
    ? `<div class="sf-gw-row">
        <button class="sf-gw sf-gw-sel" disabled><img src="/logos/${bmGwSelected}.png" alt="${bmGwSelected==='wompi'?'Wompi':'Bold'}" class="sf-gw-logo"><span class="sf-gw-tot">${fmt(flete)}</span></button>
        <button type="button" class="sf-gw-cambiar" onclick="bmSelectGw(null)">Cambiar</button>
      </div>`
    : `<div class="sf-gw-row">
        <button class="sf-gw" onclick="bmSelectGw('wompi')"><img src="/logos/wompi.png" alt="Wompi" class="sf-gw-logo"><span class="sf-gw-tot">${fmt(flete)}</span></button>
        <button class="sf-gw" onclick="bmSelectGw('bold')"><img src="/logos/bold.png" alt="Bold" class="sf-gw-logo"><span class="sf-gw-tot">${fmt(flete)}</span></button>
      </div>`;
  return desc+gws+bmConsentHTML();
}

function bmMediosPagoHTML(){
  return `<div class="sf-sec">
    <div class="sf-head"><span class="sf-num">2</span>Medios de pago<span class="sf-chev">${BM_ICONS.chevron}</span></div>
    <div class="sf-body"><div id="srMedios">${bmMediosPagoBodyHTML()}</div></div>
  </div>`;
}

// Marca (o des-marca, "Cambiar") la pasarela elegida — solo selecciona, no paga todavía.
function bmSelectGw(gw){
  bmGwSelected=gw;
  bmRefreshMediosPago();
}

// Re-pinta solo la sección 2 y el pie (el botón principal cambia a "Pagar $X" cuando hace falta
// elegir pasarela, ver bmFooterHTML) — se llama al escribir la ciudad y al elegir/cambiar la
// pasarela, igual que bmRefreshTotales().
function bmRefreshMediosPago(){
  const box=$('srMedios');if(box)box.innerHTML=bmMediosPagoBodyHTML();
  if($('bmFoot')&&bmTab==='pagar')$('bmFoot').innerHTML=bmFooterHTML();
  bmRefreshTabs();
}

// ── PAGAR — ③ Confirmación: resumen de SOLO LECTURA (grid compacto de fotos + desglose de
// precio) — calcado de la "CONFIRMACIÓN" real de sahet.co. A diferencia de BOLSA, aquí no se
// edita nada (ni stepper ni "Eliminar"): es la última revisión antes de pagar. ──
function bmConfirmacionHTML(){
  const totalPares=Object.values(cart).reduce((s,{qty})=>s+qty,0);
  const cards=Object.values(cart).map(({p,qty,type,talla})=>{
    const img=p.img?`<img src="${p.img}" alt="${altProd(p)}">`:`<span style="font-size:26px">${type==='liq'?'🔥':'👟'}</span>`;
    const nom=p.modelo||(type==='liq'?'Liquidación':(p.g==='h'?'Hombre':'Mujer'));
    const tag=talla?`<span class="sc-talla">${escHtml(String(talla))}${qty>1?' · '+qty:''}</span>`:'';
    return `<div class="sc-card"><div class="sc-ph">${img}${qty>1?`<span class="sc-qty">${qty}</span>`:''}</div><div class="sc-nom">${escHtml(nom)}</div><div class="sc-precio">${fmt(p.price*qty)}</div>${tag}</div>`;
  }).join('');
  return `<div class="sf-sec">
    <div class="sf-head"><span class="sf-num">3</span>Confirmación<span class="sf-chev">${BM_ICONS.chevron}</span></div>
    <div class="sf-body">
      <div class="sr-badge">${totalPares} Producto${totalPares===1?'':'s'}</div>
      <div class="sc-grid">${cards}</div>
      <div class="sr-totals" id="srTotals">${bmTotalsHTML()}</div>
    </div>
  </div>`;
}

// Valida el formulario y captura el lead ANTES de pagar el envío por Wompi/Bold — mismo guard
// que bmPagar(), llamado desde el botón "Pagar $X" del pie una vez ya se eligió la pasarela.
// pagarWompi/pagarBold quedan intactas, agnósticas de quién las llama.
function bmValidarYPagar(gw){
  const d=leerFormEnvio();
  if(!d)return;
  cData=d;
  captureLead(d);
  if(gw==='wompi')pagarWompi(true);else pagarBold(true);
}

function bmPagarGw(){
  if(!bmGwSelected)return;
  bmValidarYPagar(bmGwSelected);
}

function bmFooterHTML(){
  if(bmNeedsGateway()){
    const {pares,sub}=cartPricing();
    const ciudadViva=(($('fci')||{}).value)||(cData&&cData.ciudad)||'';
    const flete=calcFlete(pares,ciudadViva,sub);
    const dis=bmGwSelected?'':' disabled';
    return `<button class="btnmain"${dis} onclick="bmPagarGw()">Pagar ${fmt(flete)}</button><button class="btnback" onclick="bmIrAlCarritoCompleto()">Ver todas las formas de pago (tarjeta, PSE, Addi…)</button>`;
  }
  const label=bmIntent==='whatsapp'?'💬 Completar pedido por WhatsApp':'🚚 Continuar con contra entrega';
  return `<button class="btnmain" onclick="bmPagar()">${label}</button><button class="btnback" onclick="bmIrAlCarritoCompleto()">Ver todas las formas de pago (tarjeta, PSE, Addi…)</button>`;
}

function renderBuyModal(){
  $('bmTabs').innerHTML=bmTabsHTML();
  if(bmTab==='bolsa'){
    $('bmBody').innerHTML=bmBolsaHTML();
    $('bmFoot').innerHTML=bmBolsaFooterHTML();
  }else{
    $('bmBody').innerHTML=formEnvioSahetHTML()+bmMediosPagoHTML()+bmConfirmacionHTML();
    $('bmFoot').innerHTML=bmFooterHTML();
    bmRefreshDatosStep();
  }
}

// Solo se llega aquí cuando NO hace falta elegir pasarela (whatsapp, o contra entrega con
// envío gratis) — con flete>0 el botón principal ni se muestra (bmFooterHTML), el cliente paga
// tocando Wompi/Bold directo en ② Medios de pago vía bmValidarYPagar().
function bmPagar(){
  const d=leerFormEnvio();
  if(!d)return;
  cData=d;
  captureLead(d);
  enviarWA(bmIntent==='whatsapp'?'pago_anticipado':'contra_entrega');
}

// Escape al flujo clásico completo (Addi/Sistecrédito/Wompi/Bold sin restricción de intención):
// cierra este modal y la ficha, y abre el csheet de 3 pasos ya en "Tus datos" con cData lleno.
function bmIrAlCarritoCompleto(){
  // Guard: closePhotoBtn() (tienda.js) no tiene guard propio contra un doble-cierre — sin este
  // chequeo, un doble-tap volvería a llamarla y a desincronizar _slCount aunque closeBuyModal()
  // ya se proteja a sí mismo.
  if(!$('buyModal').classList.contains('on'))return;
  closeBuyModal();
  closePhotoBtn();
  openCart();
  goStep(1);
}
