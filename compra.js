/* ── MODAL DE COMPRA RÁPIDA (contenido de elenacuidadocapilar.com, apariencia de sahet.co) ──
   Se abre SOLO para "Comprar contra entrega" — buyNowFicha() (tienda.js) intercepta "Comprar
   por WhatsApp" antes de llegar aquí y va directo a wa.me vía waConsultaFicha() (carrito.js):
   ese botón no necesita datos de envío, el vendedor los levanta por chat. Este modal flota SOBRE
   la ficha del producto (no la cierra) — calcado de sahet.co (revisado en vivo por DOM,
   2026-09-03): UNA tarjeta con DOS pestañas que comparten el mismo estado:
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

let bmIntent=null,bmCtx=null,bmGwSelected=null,bmTab='pagar',bmMethod=null;

// Iconos de línea (mismo template SVG que ya usa rPayChoice() en carrito.js: viewBox 24x24,
// stroke=currentColor) — sahet.co usa iconos de contorno minimalistas, no emoji.
const BM_SV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';
const BM_ICONS={
  cedula:BM_SV+'<rect x="2" y="5.5" width="20" height="13" rx="2"/><circle cx="8" cy="12" r="1.8"/><path d="M13 10.3h6M13 13.7h4"/></svg>',
  nombre:BM_SV+'<circle cx="12" cy="8" r="3.3"/><path d="M5 20c0-4 3.1-6.6 7-6.6s7 2.6 7 6.6"/></svg>',
  // Logo real de WhatsApp (burbuja+teléfono), no un ícono de llamada genérico — extraído del
  // sprite SVG real de sahet.co (assets/general-*.svg, icon-whatsapp-lines) y trasladado a nuestro
  // viewBox 0-24 (coordenadas relativas intactas, solo se desplazó el punto de inicio M).
  whatsapp:BM_SV+'<path d="M3.679,15.932c-0.772,-1.256 -1.218,-2.735 -1.218,-4.316c0,-4.557 3.7,-8.257 8.257,-8.257c4.557,0 8.257,3.7 8.257,8.257c0,4.557 -3.7,8.257 -8.257,8.257c-1.572,0 -3.042,-0.44 -4.293,-1.204l-2.917,1.361c-0.248,0.116 -0.542,0.072 -0.746,-0.111c-0.204,-0.183 -0.279,-0.47 -0.191,-0.729l1.108,-3.258Z"/><path d="M8.842,13.819c-1.172,-1.131 -1.878,-1.922 -2.3,-2.925c-0.42,-1 -0.243,-2.628 0.652,-3.472c0.895,-0.844 1.681,0.193 1.912,0.694c0.231,0.501 0.767,1.098 0.192,1.735c-0.575,0.636 -0.339,1.237 -0.089,1.677c0.25,0.44 0.934,1.035 0.934,1.035c0,0 0.632,0.676 1.08,0.91c0.449,0.235 0.953,0.349 1.569,-0.248c0.616,-0.597 1.231,-0.082 1.74,0.131c0.509,0.213 1.573,0.963 0.76,1.886c-0.812,0.924 -2.434,1.158 -3.447,0.773c-1.017,-0.386 -1.832,-1.065 -3.003,-2.196Z"/></svg>',
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
  bmMethod=null;
  // Ahora que este modal también es el destino del ícono flotante y de /carrito (bmIntent==='full'),
  // puede abrirse con la bolsa VACÍA — en ese caso arranca en BOLSA (su estado vacío), no en PAGAR:
  // no hay nada que pagar ni formulario que llenar todavía.
  const hayItems=!!Object.keys(cart).length;
  bmTab=hayItems?'pagar':'bolsa';
  // Limpia el csheet clásico: si quedó renderizado detrás (ej. el cliente había abierto el
  // carrito antes), sus inputs #fn/#fc/... duplicarían los ids del formulario de este modal y
  // $('fn') tomaría el primero en el DOM (el del csheet, que precede a #buyModal) — vacío o
  // desactualizado. openCart() ya re-renderiza siempre, así que esto es inocuo.
  {const cb=$('cbody');if(cb)cb.innerHTML='';const cf=$('cfoot');if(cf)cf.innerHTML='';}
  syncDescuentosAuto();
  // InitiateCheckout/reached_payment son señales de "llegó a pagar" — con la bolsa vacía (ej. tocar
  // el ícono del carrito sin haber agregado nada) no hay checkout que iniciar, dispararlos sería un
  // dato falso para Meta/analítica.
  if(hayItems){
    fireInitiateCheckout();
    trackEvent('reached_payment');
  }
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
  // Bolsa vacía calcada de sahet.co (revisado en vivo por DOM): una sola línea de texto en
  // mayúscula, alineada a la izquierda, sin ícono ni texto de ayuda — nada del emoji/mensaje
  // centrado que usa el carrito clásico (#csheet .cempty).
  if(!Object.keys(cart).length){
    return `<div class="sf-empty">NO HAY ARTÍCULOS EN TU BOLSA</div>`;
  }
  const rows=Object.values(cart);
  return `<div id="srList">${bmProductosListHTML()}</div><div id="srEscalera">${escaleraAhorro(rows,cartPricing(rows))}</div>`;
}
// Recalcula la escalera "COMPRA MÁS, AHORRA MÁS" con la cantidad ACTUAL del carrito — separada de
// bmRefreshProductos() porque el +/- de cantidad (bmChQty) cambia cuántos pares hay en la bolsa,
// y la escalera (niveles/ahorro) depende de ese total, no solo de la lista de productos.
function bmRefreshEscalera(){
  const box=$('srEscalera');if(!box)return;
  const rows=Object.values(cart);
  box.innerHTML=escaleraAhorro(rows,cartPricing(rows));
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
  bmRefreshEscalera();
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
  bmRefreshEscalera();
  bmRefreshTotales();
  bmRefreshMediosPago();
  if($('bmFoot')&&bmTab==='bolsa')$('bmFoot').innerHTML=bmBolsaFooterHTML();
}

// ── PAGAR — ① Datos de envío: icono + etiqueta chica arriba + input abajo (revisado en vivo en
// sahet.co por DOM: NO es un placeholder que desaparece al escribir — es una etiqueta fija de
// verdad, siempre visible, con el valor escrito debajo). Mismos ids que formEnvioHTML()
// (carrito.js), así que enviarWA/pagarWompi/pagarBold/leerFormEnvio los leen igual. ──
function formEnvioSahetHTML(){
  const f=(id,ph,ic,val,type,extra,oninput)=>{
    const filled=!!String(val||'').trim();
    const stateCls=filled?' sf-fld-ok':' sf-fld-bad';
    const chain=`bmFieldValidate(this);${oninput||'bmRefreshDatosStep()'}`;
    return `<div class="sf-fld${stateCls}"><span class="sf-ic">${ic}</span><div class="sf-fld-b"><label class="sf-lbl" for="${id}">${ph}</label><input id="${id}" type="${type||'text'}" ${extra||''} oninput="${chain}" value="${escHtml(val||'')}"></div></div>`;
  };
  return `<div class="sf-sec" id="sfSecDatos">
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

// Verde al llenar, rojo al vaciar — por campo, calcado de sahet.co (revisado en vivo por DOM:
// clase "validate"/"not-empty" cambia el color del border-bottom en tiempo real al escribir o
// borrar). Puramente visual, no bloquea nada — la validación real sigue en leerFormEnvio().
function bmFieldValidate(input){
  const fld=input.closest('.sf-fld');
  if(!fld)return;
  const filled=!!input.value.trim();
  fld.classList.toggle('sf-fld-ok',filled);
  fld.classList.toggle('sf-fld-bad',!filled);
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
  // UN solo link (calcado de sahet.co: "...las cuales puedes ver haciendo clic aquí") que abre
  // TODA la información — antes eran 2 links a 2 sistemas distintos (openLegal + openInfo).
  return `<label class="sf-consent" for="fconsent">
    <input id="fconsent" type="checkbox" ${checked?'checked':''}>
    <span>Al dar clic en el siguiente botón aceptas haber leído nuestras Políticas de Datos, Compras, Cambios y Garantías, las cuales puedes ver haciendo clic <a href="#" onclick="openLegal('todas');return false"><strong>aquí</strong></a>.</span>
  </label>`;
}

// ── PAGAR — ② Medios de pago: si no hace falta elegir pasarela, solo el método ya tocado en la
// ficha (WhatsApp/Contra entrega). Si el envío tiene costo, se elige Wompi o Bold — igual que
// sahet.co (revisado en vivo: elegir un método solo lo SELECCIONA, colapsa el resto y deja un
// link "Cambiar"; el pago real se dispara con un botón "Pagar $X" aparte, al final) tocar
// Wompi/Bold aquí NO paga todavía — solo marca bmGwSelected. El botón del pie (bmFooterHTML) es
// el que valida y llama a pagarWompi/pagarBold, ya con la pasarela elegida. ──
// Botones chicos solo-logo — EXACTAMENTE el estilo que ya tenía "Contra entrega" para elegir
// Wompi/Bold (.sf-gw), aplicado ahora también al selector de 6 métodos: mismo tamaño y forma en
// los dos lugares del modal. contra_entrega/whatsapp no tienen logo de pasarela → usan una
// etiqueta corta (.sf-gw-lbl) en su lugar, mismo tamaño de caja.
function bmMetodoInner(method){
  const logos={wompi:'Wompi',bold:'Bold',addi:'Addi',sistecredito:'Sistecrédito'};
  if(logos[method])return `<img src="/logos/${method}.png" alt="${logos[method]}" class="sf-gw-logo">`;
  return `<span class="sf-gw-lbl">Contra entrega</span>`;
}

// Selector de métodos — mismo componente .sf-gw que ya usaba "Contra entrega" para Wompi/Bold.
// Calcado de la sección "MEDIOS DE PAGO" real de sahet.co: solo logos, sin monto debajo de cada
// uno (el monto ya se ve arriba, en la pestaña "Pagar $X" y en la Confirmación). Sin WhatsApp —
// ese método no vive en esta pantalla, solo en el botón directo de la ficha.
// Solo aparece cuando bmIntent==='full' (camino general: grilla, ícono del carrito, /carrito) y
// aún no se eligió método. "Contra entrega" cae en bmChooseMethod() al flujo de flete de siempre.
function bmMethodPickerHTML(){
  const orden=['contra_entrega','wompi','bold','addi','sistecredito'];
  const btns=orden.map(m=>`<button class="sf-gw" onclick="bmChooseMethod('${m}')">${bmMetodoInner(m)}</button>`).join('');
  return `<div class="sf-gw-row" style="flex-wrap:wrap">${btns}</div>`;
}

// Método ya elegido (whatsapp/wompi/bold/addi/sistecredito) — MISMO patrón sf-gw-sel + "Cambiar"
// que ya tenía "Contra entrega" al elegir Wompi/Bold.
function bmMetodoElegidoHTML(){
  const {sub}=cartPricing();
  return `<div class="sf-gw-row">
      <button class="sf-gw sf-gw-sel" disabled>${bmMetodoInner(bmMethod)}<span class="sf-gw-tot">${fmt(sub)}</span></button>
      <button type="button" class="sf-gw-cambiar" onclick="bmVerTodosMetodos()">Cambiar</button>
    </div>${bmConsentHTML()}`;
}

function bmChooseMethod(method){
  bmMethod=method;
  if(method==='contra_entrega')bmIntent='contra_entrega';
  renderBuyModal();
}

// Escape "ver todas las formas de pago" — a diferencia de antes, YA NO cierra este modal ni abre
// el csheet clásico: se queda en el mismo modal, mostrando el selector de 6 métodos.
function bmVerTodosMetodos(){
  bmIntent='full';bmMethod=null;bmGwSelected=null;
  renderBuyModal();
}

function bmPagarWA(){
  const d=leerFormEnvio();if(!d)return;
  cData=d;captureLead(d);
  enviarWA('pago_anticipado');
}
function bmPagarGwFull(gw){
  const d=leerFormEnvio();if(!d)return;
  cData=d;captureLead(d);
  if(gw==='wompi')pagarWompi();else pagarBold();   // SIN "true" = cobra el total, no el flete
}
// pagarAddi()/pagarSistecredito() reales (carrito.js), si faltan campos, hacen goStep(1) — válido
// solo dentro del csheet clásico. Se pre-valida acá TODO lo que ellas exigen (mismo regex de email
// que usa pagarAddi() internamente) para que ese camino de error de emergencia nunca se dispare
// viniendo de este modal.
function bmPagarAddiSafe(){
  const d=leerFormEnvio();if(!d)return;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email||'')){
    const e=$('ferr');if(e){e.textContent='Para pagar con Addi necesitamos un correo electrónico válido';e.classList.add('show');}
    const em=$('fem');if(em)em.focus();
    return;
  }
  cData=d;captureLead(d);
  pagarAddi();
}
function bmPagarSistecreditoSafe(){
  const d=leerFormEnvio();if(!d)return;
  cData=d;captureLead(d);
  pagarSistecredito();
}

function bmMediosPagoBodyHTML(){
  if(bmIntent==='full')return bmMethod?bmMetodoElegidoHTML():bmMethodPickerHTML();
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
  const foot=$('bmInlineFoot');if(foot&&bmTab==='pagar')foot.innerHTML=bmFooterHTML();
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

// El botón principal va con el número "④" en la misma fila — calcado de sahet.co (revisado en
// vivo: el paso 4 de su lista de pasos ES el propio botón de pagar, no un botón aparte debajo).
// Seguimos dejando "Pagar" en un pie fijo (para que nunca se pierda al hacer scroll) — lo que
// cambia acá es que ahora el número que sigue a la línea de ①②③ vive pegado al botón real, no
// como un círculo suelto sin nada al lado.
function bmFooterHTML(){
  let btn,back='';
  if(bmIntent==='full'){
    // Nada elegido todavía en el selector de 6 métodos: el "④" y el botón siguen presentes (como
    // en sahet), solo que deshabilitado — nunca queda el número solo, sin nada al lado.
    if(!bmMethod)return `<div class="sf-foot-row"><span class="sf-num">4</span><button class="btnmain" disabled>Elige arriba ↑</button></div>`;
    const {sub}=cartPricing();
    back=`<button class="btnback" onclick="bmVerTodosMetodos()">‹ Cambiar método de pago</button>`;
    if(bmMethod==='whatsapp')btn=`<button class="btnmain" onclick="bmPagarWA()">Continuar por WhatsApp</button>`;
    else if(bmMethod==='wompi'||bmMethod==='bold')btn=`<button class="btnmain" onclick="bmPagarGwFull('${bmMethod}')">Pagar ${fmt(sub)}</button>`;
    else if(bmMethod==='addi')btn=`<button class="btnmain" onclick="bmPagarAddiSafe()">Continuar con Addi</button>`;
    else if(bmMethod==='sistecredito')btn=`<button class="btnmain" onclick="bmPagarSistecreditoSafe()">Continuar con Sistecrédito</button>`;
  }else if(bmNeedsGateway()){
    const {pares,sub}=cartPricing();
    const ciudadViva=(($('fci')||{}).value)||(cData&&cData.ciudad)||'';
    const flete=calcFlete(pares,ciudadViva,sub);
    const dis=bmGwSelected?'':' disabled';
    btn=`<button class="btnmain"${dis} onclick="bmPagarGw()">Pagar ${fmt(flete)}</button>`;
    back=`<button class="btnback" onclick="bmVerTodosMetodos()">Ver todas las formas de pago (tarjeta, PSE, Addi…)</button>`;
  }else{
    btn=`<button class="btnmain" onclick="bmPagar()">🚚 Continuar con contra entrega</button>`;
    back=`<button class="btnback" onclick="bmVerTodosMetodos()">Ver todas las formas de pago (tarjeta, PSE, Addi…)</button>`;
  }
  return `<div class="sf-foot-row"><span class="sf-num">4</span>${btn}</div>${back}`;
}

function renderBuyModal(){
  $('bmTabs').innerHTML=bmTabsHTML();
  if(bmTab==='bolsa'){
    $('bmBody').innerHTML=bmBolsaHTML();
    $('bmFoot').innerHTML=bmBolsaFooterHTML();
    $('bmFoot').style.display='';
  }else{
    // El botón "Pagar" (④) va DENTRO del scroll, no en el pie fijo — calcado de sahet.co
    // (revisado en vivo: ahí el paso 4 se desplaza con el resto de la lista, no queda pegado
    // abajo). #bmFoot se deja vacío/oculto en esta pestaña; bmRefreshMediosPago() actualiza
    // #bmInlineFoot cuando cambia la ciudad o la pasarela elegida.
    $('bmBody').innerHTML=formEnvioSahetHTML()+bmMediosPagoHTML()+bmConfirmacionHTML()+`<div id="bmInlineFoot">${bmFooterHTML()}</div>`;
    $('bmFoot').innerHTML='';
    $('bmFoot').style.display='none';
    bmRefreshDatosStep();
  }
}

// Solo se llega aquí cuando el envío es gratis (sin costo que cobrar por adelantado) — con
// flete>0 el botón principal ni se muestra (bmFooterHTML), el cliente paga tocando Wompi/Bold
// directo en ② Medios de pago vía bmValidarYPagar().
function bmPagar(){
  const d=leerFormEnvio();
  if(!d)return;
  cData=d;
  captureLead(d);
  enviarWA('contra_entrega');
}
