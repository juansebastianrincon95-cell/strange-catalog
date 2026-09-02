/* ── MODAL DE COMPRA RÁPIDA (estilo elenacuidadocapilar.com / "RSI COD Form") ──
   Se abre desde buyNowFicha() (tienda.js) SIN cerrar la ficha del producto: resumen del pedido +
   upsell + formulario de envío + botón final de pago, todo en una sola vista con scroll.

   Reusa tal cual (sin tocarlas) las funciones reales de pago de carrito.js: enviarWA/pagarWompi/
   pagarBold leen los campos del formulario por id ($('fn')...$('fci')) sin saber en qué
   contenedor viven — por eso este modal reusa formEnvioHTML()/leerFormEnvio() con los MISMOS ids.
   rPayChoice() y el #csheet clásico NO se tocan: siguen siendo el único camino para todo lo demás
   (grid, favoritos, lanzamientos, búsqueda) vía togCard().

   window.BUY_MODAL_ON=false permite volver al flujo clásico (csheet) sin tocar código. */
const BUY_MODAL_ON=true;

let bmIntent=null,bmCtx=null;

function bmProduct(){
  if(!bmCtx)return null;
  const list=bmCtx.type==='liq'?liqs:prods;
  return list.find(x=>x.id===bmCtx.id)||null;
}

function openBuyModal(intent){
  bmIntent=intent;
  bmCtx={id:pmId,type:pmType,talla:pmTalla};
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
  if(!_navPopping)navRemove('checkout');
  $('bmScrim').classList.remove('on');
  $('buyModal').classList.remove('on');
  unlockScroll();
  $('cartBar').classList.remove('hide');
  $('bmBody').innerHTML='';$('bmFoot').innerHTML='';
  bmIntent=null;bmCtx=null;
}

function bmResumenHTML(){
  const rows=Object.values(cart);
  const pricing=cartPricing(rows);
  const filas=rows.map(({p,qty,type,talla})=>{
    const m=p.img?`<img src="${p.img}" alt="${altProd(p)}">`:`<span style="font-size:22px">${type==='liq'?'🔥':'👟'}</span>`;
    const lbl=p.modelo||(type==='liq'?'Liquidación':(p.g==='h'?'Hombre':'Mujer'));
    const tallaTag=talla?`<span class="crtalla">Talla ${escHtml(String(talla))}</span>`:'';
    return `<div class="crow"><div class="crimg">${m}</div><div class="crinfo"><div class="crname">${escHtml(lbl)}${qty>1?` ×${qty}`:''}</div>${tallaTag}<div class="crprice">${fmt(p.price*qty)}</div></div></div>`;
  }).join('');
  return `<div class="csum-t">Resumen del pedido</div>${filas}<div class="csum-total" style="margin-top:8px"><span class="l">Total</span><span class="v">${fmt(pricing.sub)}</span></div>`;
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
  $('bmBody').innerHTML=`<div class="csum" style="margin-top:10px">${bmResumenHTML()}</div>${renderBmCrossHTML()}${formEnvioHTML()}`;
  $('bmFoot').innerHTML=bmFooterHTML();
  updFleteHint();
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
  closeBuyModal();
  closePhotoBtn();
  openCart();
  goStep(1);
}
