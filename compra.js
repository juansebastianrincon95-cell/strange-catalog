/* ── MODAL DE COMPRA RÁPIDA (contenido de elenacuidadocapilar.com, apariencia de sahet.co) ──
   Se abre desde buyNowFicha() (tienda.js) SIN cerrar la ficha del producto: primero el resumen
   con grid de fotos + desglose de precio (estilo sahet.co), luego el formulario de envío con
   icono+etiqueta+input subrayado (también estilo sahet.co) y el botón final de pago — mismos
   campos de siempre (cédula/nombre/whatsapp/email/ciudad/dirección/barrio), todo en una sola
   vista con scroll.

   Reusa tal cual (sin tocarlas) las funciones reales de pago de carrito.js: enviarWA/pagarWompi/
   pagarBold leen los campos del formulario por id ($('fn')...$('fci')) sin saber en qué
   contenedor viven ni qué apariencia tienen — por eso formEnvioSahetHTML() usa los MISMOS ids
   que el formEnvioHTML() clásico, y leerFormEnvio() (carrito.js) se reusa sin cambios.
   rPayChoice() y el #csheet clásico NO se tocan: siguen siendo el único camino para todo lo demás
   (grid, favoritos, lanzamientos, búsqueda) vía togCard().

   window.BUY_MODAL_ON=false permite volver al flujo clásico (csheet) sin tocar código. */
const BUY_MODAL_ON=true;

let bmIntent=null,bmCtx=null,bmDetallesVisible=true;

function bmProduct(){
  if(!bmCtx)return null;
  const list=bmCtx.type==='liq'?liqs:prods;
  return list.find(x=>x.id===bmCtx.id)||null;
}

function openBuyModal(intent){
  bmIntent=intent;
  bmCtx={id:pmId,type:pmType,talla:pmTalla};
  bmDetallesVisible=true;
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

// Resumen estilo sahet.co: grid de fotos (con el badge de cantidad) + desglose de precio.
// El desglose reusa las mismas clases del resumen clásico (.csum-row/.csum-total/.free) para
// mantener la misma tipografía en todo el sitio, en vez de inventar una nueva.
function bmTotalsHTML(){
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);
  const orig=rows.reduce((s,{p,qty})=>{const act=(p.promo||promoG)&&p.was&&p.was>p.price;return s+(act?p.was:p.price)*qty;},0);
  const ahorroTotal=orig-pricing.sub;
  // Ciudad en vivo del input si ya existe (el cliente está escribiendo), si no la última guardada.
  const ciudadViva=(($('fci')||{}).value)||(cData&&cData.ciudad)||'';
  const flete=bmIntent==='contra_entrega'?calcFlete(pricing.pares,ciudadViva,pricing.sub):0;
  const totalFinal=pricing.sub+flete;
  const discRow=ahorroTotal>0?`<div class="csum-row disc"><span>${pricing.combo?escHtml(pricing.combo.nombre):escHtml(pricing.descTag||'Descuento')}</span><span class="v">−${fmt(ahorroTotal)}</span></div>`:'';
  return `<div class="csum-row"><span>Productos</span><span class="v">${fmt(orig)}</span></div>${discRow}<div class="csum-row"><span>Envío</span><span class="v${flete===0?' free':''}">${flete===0?'Gratis':fmt(flete)}</span></div><div class="csum-total"><span class="l">Total</span><span class="v">${fmt(totalFinal)}</span></div>`;
}
function bmRefreshTotales(){
  const box=$('srTotals');if(box)box.innerHTML=bmTotalsHTML();
}
function bmToggleDetalles(){
  bmDetallesVisible=!bmDetallesVisible;
  const g=$('srGrid');if(g)g.style.display=bmDetallesVisible?'':'none';
  const b=$('srToggleBtn');if(b)b.textContent=bmDetallesVisible?'Ocultar detalles':'Ver detalles';
}
function bmResumenSahetHTML(){
  const rows=Object.values(cart);
  const totalPares=rows.reduce((s,{qty})=>s+qty,0);
  const cards=rows.map(({p,qty,type,talla})=>{
    const img=p.img?`<img src="${p.img}" alt="${altProd(p)}">`:`<span style="font-size:26px">${type==='liq'?'🔥':'👟'}</span>`;
    const nom=p.modelo||(type==='liq'?'Liquidación':(p.g==='h'?'Hombre':'Mujer'));
    return `<div class="sr-card"><div class="sr-ph">${img}${qty>1?`<span class="sr-qty">${qty}</span>`:''}</div><div class="sr-nom">${escHtml(nom)}</div><div class="sr-precio">${fmt(p.price*qty)}</div>${talla?`<span class="crtalla">Talla ${escHtml(String(talla))}</span>`:''}</div>`;
  }).join('');
  return `<div class="sr-badge">${totalPares} producto${totalPares===1?'':'s'}</div>
    <div class="sr-grid" id="srGrid"${bmDetallesVisible?'':' style="display:none"'}>${cards}</div>
    <button type="button" class="sr-toggle" id="srToggleBtn" onclick="bmToggleDetalles()">${bmDetallesVisible?'Ocultar detalles':'Ver detalles'}</button>
    <div class="csum" id="srTotals">${bmTotalsHTML()}</div>
    <label class="sf-consent" for="fconsent">
      <input id="fconsent" type="checkbox" ${cData.consent?'checked':''}>
      <span>Al confirmar tu pedido aceptas haber leído nuestra <a href="#" onclick="openLegal('privacidad');return false">Política de Datos</a> y nuestras condiciones de <a href="#" onclick="openInfo('cambios');return false">Cambios y Garantías</a>.</span>
    </label>`;
}

// Formulario de datos estilo sahet.co: icono + etiqueta + input subrayado (sin caja), con los
// MISMOS ids que formEnvioHTML() (carrito.js) — enviarWA/pagarWompi/pagarBold/leerFormEnvio los
// leen igual sin saber qué apariencia tienen. El checkbox de consentimiento vive en el resumen
// (bmResumenSahetHTML), no aquí — leerFormEnvio() solo busca el id, no le importa dónde está.
function formEnvioSahetHTML(){
  const f=(id,label,ic,val,type,extra)=>`<div class="sf-fld"><span class="sf-ic">${ic}</span><div class="sf-fld-b"><label class="sf-lbl">${label}</label><input id="${id}" type="${type||'text'}" ${extra||''} value="${escHtml(val||'')}"></div></div>`;
  return `<div class="sf-sec">
    <div class="sf-head"><span class="sf-num">1</span>Datos de envío</div>
    ${f('fc','Cédula','🪪',cData.cedula,'text','inputmode="numeric" autocomplete="off"')}
    ${f('fn','Nombre completo','👤',cData.nombre,'text','autocomplete="name" autocapitalize="words"')}
    ${f('ft','WhatsApp','💬',cData.celular,'tel','inputmode="tel" autocomplete="tel"')}
    ${f('fem','Email','✉️',cData.email,'email','inputmode="email" autocomplete="email"')}
    <div class="sf-fld"><span class="sf-ic">📍</span><div class="sf-fld-b"><label class="sf-lbl">Ciudad o municipio</label><input id="fci" type="text" autocomplete="address-level2" autocapitalize="words" oninput="bmRefreshTotales()" value="${escHtml(cData.ciudad||'')}"></div></div>
    ${f('fd','Dirección','🏠',cData.direccion,'text','autocomplete="street-address"')}
    ${f('fb','Barrio','🏘️',cData.barrio,'text','autocomplete="address-level3"')}
    <div class="ferr" id="ferr">Completa todos los campos y acepta la política de datos</div>
  </div>`;
}

// Upsell dentro del modal: reusa fichaSugeridos() (tienda.js), igual criterio que "También te
// puede gustar" de la ficha. Sin tallas → "+ Agregar" directo y re-render in situ. Con tallas →
// cierra el modal y abre esa ficha (evita inventar un selector de talla inline por ahora).
function renderBmCrossHTML(){
  const p=bmProduct();if(!p)return '';
  const sug=fichaSugeridos(p,bmCtx.type);
  if(!sug.length)return '';
  const cards=sug.map(s=>{
    const m=s.img?`<img src="${s.img}" alt="${altProd(s)}" loading="lazy">`:`<span style="font-size:20px">👟</span>`;
    const nom=s.modelo||(BRAND_LABELS[s.brand]||'')||(s.g==='h'?'Hombre':'Mujer');
    const sinTallas=!tallasDe(s).length;
    const accion=sinTallas?`bmAddSug(${s.id})`:`bmVerFicha(${s.id})`;
    return `<button class="xs-card" onclick="${accion}"><div class="xs-img">${m}</div><div class="xs-nom">${escHtml(nom)}</div><div class="xs-precio">${fmt(s.price)}${sinTallas?' · +Agregar':''}</div></button>`;
  }).join('');
  return `<div class="pmx-t">También te puede gustar</div>`+crslWrap(`<div class="pmx-row" id="bmCrossRow">${cards}</div>`);
}

function bmAddSug(id){
  if(!addItemToCart(id,'cat',null))return;
  renderBuyModal();
}
function bmVerFicha(id){
  closeBuyModal();
  openPhoto(id,'cat');
}

function bmFooterHTML(){
  const label=bmIntent==='whatsapp'?'💬 Completar pedido por WhatsApp':'🚚 Continuar con contra entrega';
  return `<button class="btnmain" onclick="bmPagar()">${label}</button><button class="btnback" onclick="bmIrAlCarritoCompleto()">Ver todas las formas de pago (tarjeta, PSE, Addi…)</button>`;
}

function renderBuyModal(){
  $('bmTitle').textContent=bmIntent==='whatsapp'?'Comprar por WhatsApp':'Comprar contra entrega';
  $('bmBody').innerHTML=bmResumenSahetHTML()+renderBmCrossHTML()+formEnvioSahetHTML();
  $('bmFoot').innerHTML=bmFooterHTML();
  crslUpd();
}

function bmPagar(){
  const d=leerFormEnvio();
  if(!d)return;
  cData=d;
  captureLead(d);
  if(bmIntent==='whatsapp'){enviarWA('pago_anticipado');return;}
  const {pares,sub}=cartPricing();
  const flete=calcFlete(pares,d.ciudad,sub);
  if(flete<=0){enviarWA('contra_entrega');return;}
  bmMostrarPagoFlete(flete,sub);
}

// Espejo de elegirPagoFlete() (carrito.js) pero dentro del modal: mismo mensaje y mismos
// onclick="pagarWompi(true)"/"pagarBold(true)" (funciones agnósticas del contenedor).
function bmMostrarPagoFlete(flete,sub){
  $('bmBody').innerHTML=`<div class="paysec">
    <div class="paytit">Paga tu envío para asegurar el despacho</div>
    <div style="background:var(--bg);border-radius:12px;padding:12px 14px;margin-bottom:12px;font-size:12.5px;color:var(--ink2);line-height:1.5">
      Pagas ahora <b>solo el envío: ${fmt(flete)}</b>.<br>
      Los zapatos (<b>${fmt(sub)}</b>) los pagas <b>al recibir en casa</b> 📦
    </div>
    <div class="paychoice-list">
      <button class="paychoice" onclick="pagarWompi(true)" style="--acc:#5D2D91"><span class="pc-ic" style="background:#fff"><img src="/logos/wompi.png" alt="Wompi" class="pc-logo"></span><span class="pc-main"><span class="pc-tit">Pagar el envío — Wompi</span><span class="pc-desc">Tarjeta · PSE · Nequi · Bancolombia</span><span class="pc-tot">A pagar hoy: ${fmt(flete)}</span></span><span class="pc-arrow">›</span></button>
      <button class="paychoice" onclick="pagarBold(true)" style="--acc:#2541B2"><span class="pc-ic" style="background:#fff"><img src="/logos/bold.png" alt="Bold" class="pc-logo"></span><span class="pc-main"><span class="pc-tit">Pagar el envío — Bold</span><span class="pc-desc">Tarjeta · PSE · Botón Bancolombia</span><span class="pc-tot">A pagar hoy: ${fmt(flete)}</span></span><span class="pc-arrow">›</span></button>
    </div>
  </div>`;
  $('bmFoot').innerHTML=`<button class="btnback" onclick="renderBuyModal()">← Volver</button>`;
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
