/* ═══ STRANGE SNEAKERS — EXTRAS (carga bajo demanda) ═══
   Guía de cuidado + páginas legales + vista de pedido del vendedor.
   Lo carga el stub loadExtras() de index.html en el primer uso (link ?regalo=cuidado,
   links del footer/checkout, ?pedido=). Comparte scope global con el script principal.
   Inyecta su markup como HIJOS DIRECTOS de <body> (el print CSS de la guía depende de eso). ═══ */

document.body.insertAdjacentHTML('beforeend',JSON.parse("\"<!-- GUÍA DE CUIDADO -->\\r\\n<div class=\\\"guia-modal\\\" id=\\\"guiaModal\\\">\\r\\n  <div class=\\\"guia-scrim\\\" onclick=\\\"closeGuia()\\\"></div>\\r\\n  <div class=\\\"guia-wrap\\\" id=\\\"guiaWrap\\\">\\r\\n    <button class=\\\"guia-close\\\" onclick=\\\"closeGuia()\\\">✕</button>\\r\\n    <div class=\\\"guia-head\\\">\\r\\n      <div class=\\\"guia-logo\\\">STRANGE<sup>®</sup></div>\\r\\n      <div class=\\\"guia-kicker\\\">🎁 Regalo de tu compra</div>\\r\\n      <h2 class=\\\"guia-title\\\">Guía de cuidado de tus sneakers</h2>\\r\\n      <p class=\\\"guia-sub\\\">Cuídalos bien y te durarán como nuevos.<br>Síguela en 5 minutos.</p>\\r\\n    </div>\\r\\n    <div class=\\\"guia-body\\\">\\r\\n\\r\\n      <div class=\\\"guia-step\\\">\\r\\n        <div class=\\\"guia-num\\\">1</div>\\r\\n        <div class=\\\"guia-step-h\\\">🧼 Limpieza según el material</div>\\r\\n      </div>\\r\\n      <div class=\\\"guia-mats\\\">\\r\\n        <div class=\\\"guia-mat\\\">\\r\\n          <div class=\\\"guia-mat-ico\\\">🕸️</div>\\r\\n          <div class=\\\"guia-mat-t\\\">Malla / Tela</div>\\r\\n          <div class=\\\"guia-mat-d\\\">Cepillo suave con agua tibia y jabón neutro. Sin frotar fuerte.</div>\\r\\n        </div>\\r\\n        <div class=\\\"guia-mat\\\">\\r\\n          <div class=\\\"guia-mat-ico\\\">🟤</div>\\r\\n          <div class=\\\"guia-mat-t\\\">Cuero / Sintético</div>\\r\\n          <div class=\\\"guia-mat-d\\\">Paño húmedo y jabón neutro. <b>Nunca sumergir</b>. Seca con paño.</div>\\r\\n        </div>\\r\\n        <div class=\\\"guia-mat\\\">\\r\\n          <div class=\\\"guia-mat-ico\\\">🦫</div>\\r\\n          <div class=\\\"guia-mat-t\\\">Gamuza / Nobuk</div>\\r\\n          <div class=\\\"guia-mat-d\\\">Cepillo seco especial. <b>Nunca agua</b>. Borrador para manchas.</div>\\r\\n        </div>\\r\\n      </div>\\r\\n\\r\\n      <div class=\\\"guia-step\\\">\\r\\n        <div class=\\\"guia-num\\\">2</div>\\r\\n        <div class=\\\"guia-step-h\\\">💧 Secado correcto</div>\\r\\n      </div>\\r\\n      <div class=\\\"guia-card\\\">\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">🌤️</span><div>Siempre <b>a la sombra</b> y ventilado. Nunca al sol directo ni secadora (deforman y amarillean).</div></div>\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">📰</span><div>Rellénalos con <b>papel</b> para que mantengan su forma mientras secan.</div></div>\\r\\n      </div>\\r\\n\\r\\n      <div class=\\\"guia-step\\\">\\r\\n        <div class=\\\"guia-num\\\">3</div>\\r\\n        <div class=\\\"guia-step-h\\\">👟 Almacenamiento</div>\\r\\n      </div>\\r\\n      <div class=\\\"guia-card\\\">\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">🏠</span><div>Lugar <b>seco y ventilado</b>, lejos de humedad.</div></div>\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">🧦</span><div>Usa horma o papel dentro para conservar la forma.</div></div>\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">🔄</span><div><b>Alterna entre 2 pares:</b> dejarlos descansar un día alarga mucho su vida.</div></div>\\r\\n      </div>\\r\\n\\r\\n      <div class=\\\"guia-card guia-no\\\">\\r\\n        <div class=\\\"guia-card-h\\\">🚫 Lo que NUNCA debes hacer</div>\\r\\n        <div class=\\\"guia-pills\\\">\\r\\n          <span class=\\\"guia-pill\\\">🧺 Lavadora / secadora</span>\\r\\n          <span class=\\\"guia-pill\\\">☀️ Sol directo</span>\\r\\n          <span class=\\\"guia-pill\\\">🧪 Blanqueador</span>\\r\\n          <span class=\\\"guia-pill\\\">💦 Guardarlos húmedos</span>\\r\\n        </div>\\r\\n      </div>\\r\\n\\r\\n      <div class=\\\"guia-card guia-tip\\\">\\r\\n        <div class=\\\"guia-card-h\\\">💡 Tips de experto</div>\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">🛡️</span><div>Aplica <b>impermeabilizante</b> a la gamuza desde el estreno: repele agua y manchas.</div></div>\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">⭐</span><div>Rotar entre pares + limpieza suave semanal = sneakers como nuevos por años.</div></div>\\r\\n      </div>\\r\\n\\r\\n      <div class=\\\"guia-cupon\\\">🎁 Recuerda: usa el código <b>GRACIAS5</b> y obtén <b>5% en tu próxima compra</b></div>\\r\\n\\r\\n      <div class=\\\"guia-foot\\\">\\r\\n        ¿Dudas sobre tu par?<br>\\r\\n        <a class=\\\"guia-wa\\\" id=\\\"guiaWa\\\" href=\\\"#\\\" target=\\\"_blank\\\">💬 Escríbenos por WhatsApp</a>\\r\\n        <span>— El equipo de Strange Sneakers 👟</span>\\r\\n      </div>\\r\\n    </div>\\r\\n    <div class=\\\"guia-actions\\\">\\r\\n      <button class=\\\"guia-dl\\\" onclick=\\\"descargarGuia()\\\">⬇ Descargar guía</button>\\r\\n    </div>\\r\\n  </div>\\r\\n</div>\\r\\n\\r\""));
document.body.insertAdjacentHTML('beforeend',JSON.parse("\"<!-- MODAL LEGAL (privacidad / términos / cookies / garantías) -->\\r\\n<div id=\\\"legalModal\\\" style=\\\"display:none;position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.55);overscroll-behavior:contain\\\" onclick=\\\"if(event.target===this)closeLegal()\\\">\\r\\n  <div style=\\\"position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(680px,92vw);max-height:86vh;overflow-y:auto;background:var(--white);border-radius:16px;padding:26px 24px;box-shadow:0 20px 60px rgba(0,0,0,.35)\\\">\\r\\n    <button onclick=\\\"closeLegal()\\\" aria-label=\\\"Cerrar\\\" style=\\\"position:absolute;right:14px;top:12px;background:none;border:none;font-size:26px;line-height:1;color:var(--ink2);cursor:pointer\\\">×</button>\\r\\n    <div id=\\\"legalBody\\\" style=\\\"font-size:13.5px;line-height:1.6;color:var(--ink)\\\"></div>\\r\\n  </div>\\r\\n</div>\\r\\n\\r\""));

/* ── PÁGINAS LEGALES (modal) ── Email de contacto/responsable: cámbialo en UNA línea (LEGAL_EMAIL). */
const LEGAL_EMAIL='juansebastianrincon95@gmail.com';
const LEGAL_UPDATED='9 de junio de 2026';
function legalContent(){
  const marca=STORE_NAME||'Strange Sneakers';
  const h=t=>`<h2 style="font-size:18px;margin:0 0 4px">${t}</h2><div style="font-size:11px;color:var(--ink3);margin-bottom:14px">Última actualización: ${LEGAL_UPDATED}</div>`;
  return {
    privacidad: h('Política de Privacidad y Tratamiento de Datos')+
      `<p>En <strong>${marca}</strong> protegemos tus datos personales conforme a la <strong>Ley 1581 de 2012</strong> y el Decreto 1377 de 2013 (Colombia).</p>
      <p style="margin-top:10px"><strong>Responsable:</strong> ${marca} · <strong>Contacto:</strong> <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a></p>
      <p style="margin-top:10px"><strong>Datos que recolectamos:</strong> nombre, cédula, teléfono, dirección, ciudad, barrio, correo, talla/género y datos de navegación (cookies, identificadores de Meta Pixel y analítica) cuando realizas un pedido o navegas el sitio.</p>
      <p style="margin-top:10px"><strong>Finalidad:</strong> procesar y entregar tus pedidos, contactarte por tu compra, prevenir fraude, mejorar el catálogo y enviarte comunicaciones comerciales solo si lo autorizas.</p>
      <p style="margin-top:10px"><strong>Tus derechos:</strong> conocer, actualizar, rectificar y suprimir tus datos, y revocar la autorización, escribiendo a <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>.</p>
      <p style="margin-top:10px"><strong>Terceros:</strong> compartimos datos solo con proveedores necesarios para operar (pasarelas de pago Wompi/Bold, mensajería de entrega, Meta y Google para medición). No vendemos tus datos.</p>`,
    terminos: h('Términos y Condiciones')+
      `<p>Al comprar en <strong>${marca}</strong> aceptas estos términos.</p>
      <p style="margin-top:10px"><strong>Precios:</strong> en pesos colombianos (COP), pueden cambiar sin previo aviso. El precio válido es el mostrado al confirmar el pedido.</p>
      <p style="margin-top:10px"><strong>Pagos:</strong> aceptamos pago en línea (Wompi/Bold) y pago contra entrega según disponibilidad de la zona.</p>
      <p style="margin-top:10px"><strong>Envíos:</strong> despachamos a todo Colombia; los tiempos dependen de la transportadora y la ciudad de destino.</p>
      <p style="margin-top:10px"><strong>Disponibilidad:</strong> los productos están sujetos a inventario; si un artículo no está disponible te contactaremos para reembolso o cambio.</p>
      <p style="margin-top:10px">Contacto: <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>.</p>`,
    cookies: h('Política de Cookies')+
      `<p>Usamos cookies y tecnologías similares para que el sitio funcione, recordar tu carrito y medir el rendimiento.</p>
      <p style="margin-top:10px"><strong>Tipos:</strong> técnicas (necesarias para el funcionamiento), de analítica (Google Analytics) y de publicidad/medición (Meta Pixel), que nos ayudan a entender el tráfico y mostrar anuncios relevantes.</p>
      <p style="margin-top:10px">Puedes bloquear o eliminar las cookies desde la configuración de tu navegador. Si las desactivas, algunas funciones podrían no operar correctamente.</p>`,
    garantias: h('Cambios y Garantías')+
      `<p>Queremos que ames tus sneakers. Si hay un problema, escríbenos.</p>
      <p style="margin-top:10px"><strong>Derecho de retracto:</strong> conforme a la Ley 1480 de 2011 (Estatuto del Consumidor), tienes hasta <strong>5 días hábiles</strong> tras recibir el producto para retractarte en compras a distancia, siempre que el producto esté sin uso y en su empaque original.</p>
      <p style="margin-top:10px"><strong>Cambios de talla:</strong> sujetos a disponibilidad; el producto debe estar nuevo, sin uso y con su empaque.</p>
      <p style="margin-top:10px"><strong>Garantía:</strong> cubre defectos de fabricación. No cubre desgaste normal ni mal uso.</p>
      <p style="margin-top:10px">Para gestionar un cambio o garantía escribe a <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>${WA?` o por WhatsApp al <a href="https://wa.me/${WA}" target="_blank" rel="noopener">+${WA}</a>`:''}.</p>`
  };
}
function openLegal(key){
  const m=$('legalModal'),b=$('legalBody');if(!m||!b)return;
  b.innerHTML=(legalContent()[key]||'');
  m.style.display='';document.body.style.overflow='hidden';
  const _lt={privacidad:'Política de Privacidad',terminos:'Términos y Condiciones',cookies:'Política de Cookies',garantias:'Cambios y Garantías'};
  navPush('legal','/legal/'+key,(_lt[key]||'Legal')+' — '+STORE_NAME,closeLegal);
}
function closeLegal(){if(!_navPopping)navRemove('legal');const m=$('legalModal');if(m)m.style.display='none';document.body.style.overflow='';}

/* ── GUÍA DE CUIDADO ── */
function openGuia(){
  // WhatsApp clickeable con el número de la tienda
  const wa=$('guiaWa');
  if(wa)wa.href=`https://wa.me/${WA}?text=${encodeURIComponent('¡Hola '+STORE_NAME+'! Tengo una duda sobre el cuidado de mis sneakers 👟')}`;
  {const _gm=$('guiaModal');const _ya=_gm.classList.contains('on');_gm.classList.add('on');if(!_ya)lockScroll();}   // un bloqueo por capa
  navPush('guia',null,null,closeGuia);
}
function closeGuia(){if(!_navPopping)navRemove('guia');$('guiaModal').classList.remove('on');unlockScroll();}
// Descargar la guía: abre el diálogo de impresión con SOLO la guía (Guardar como PDF).
function descargarGuia(){
  document.body.classList.add('printing-guia');
  setTimeout(()=>{ window.print(); document.body.classList.remove('printing-guia'); },80);
}

/* ── VER PEDIDO (un solo link con fotos para el vendedor): ?pedido=29x1t40,30x2,L5x1 ──
   El sufijo `t<talla>` es OPCIONAL: los links viejos (29x1) siguen abriendo igual, solo que
   sin talla. Sin esto la vista mostraba las fotos pero no QUÉ TALLA se vendió, que es justo
   lo que hay que alistar para despachar. */
function _pedidoViewReal(code){
  let list=[],total=0,tot=0;
  code.split(',').map(s=>s.trim()).filter(Boolean).forEach(seg=>{
    const m=/^(L?)(\d+)x(\d+)(?:t([\w.]{1,6}))?$/i.exec(seg);if(!m)return;
    const isLiq=!!m[1],id=parseInt(m[2]),qty=Math.min(parseInt(m[3])||1,50);
    const p=(isLiq?liqs:prods).find(x=>x.id===id);if(!p)return;
    list.push({p,qty,isLiq,talla:m[4]||''});total+=p.price*qty;tot+=qty;
  });
  if(!list.length)return;
  const rowsHtml=list.map(({p,qty,isLiq,talla})=>{
    // Preferir el modelo real; "Mujer"/"Hombre" solo cuando el producto no tiene nombre.
    const lbl=p.modelo||(isLiq?'Liquidación':(p.g==='h'?'Hombre':p.g==='m'?'Mujer':'Unisex'));
    const marca=p.brand?(BRAND_LABELS[p.brand]||p.brand):'';
    const nom=(marca&&!lbl.toLowerCase().includes(marca.toLowerCase()))?marca+' · '+lbl:lbl;
    const img=p.img?`<img src="${escHtml(p.img)}" alt="${altProd(p)}">`:'👟';
    const sub=(talla?`<b>Talla ${escHtml(talla)}</b> · `:'')+`Cantidad: ${qty} · ${fmt(p.price)} c/u`;
    return `<div class="ped-row"><div class="ped-img">${img}</div><div class="ped-info"><div class="ped-name">${escHtml(nom)} · #${p.id}</div><div class="ped-q">${sub}</div></div><div class="ped-pr">${fmt(p.price*qty)}</div></div>`;
  }).join('');
  const ov=document.createElement('div');
  ov.className='ped-view';
  ov.innerHTML=`<div class="ped-bar"><span class="ped-logo">CATALOGO SNEAKERS</span><span class="ped-sub">Pedido del cliente</span></div><div class="ped-body"><div class="ped-head">📦 Pedido · ${tot} ${tot===1?'par':'pares'}</div>${rowsHtml}<div class="ped-total"><span>Total</span><span>${fmt(total)}</span></div><a class="ped-cta" href="https://strangesneakers.com/">Ver catálogo completo →</a></div>`;
  document.body.appendChild(ov);
  document.body.style.overflow='hidden';
  return true;
}

window._extrasReady=true;
