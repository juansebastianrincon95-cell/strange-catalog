/* ═══ STRANGE SNEAKERS — EXTRAS (carga bajo demanda) ═══
   Guía de cuidado + páginas legales + vista de pedido del vendedor.
   Lo carga el stub loadExtras() de index.html en el primer uso (link ?regalo=cuidado,
   links del footer/checkout, ?pedido=). Comparte scope global con el script principal.
   Inyecta su markup como HIJOS DIRECTOS de <body> (el print CSS de la guía depende de eso). ═══ */

document.body.insertAdjacentHTML('beforeend',JSON.parse("\"<!-- GUÍA DE CUIDADO -->\\r\\n<div class=\\\"guia-modal\\\" id=\\\"guiaModal\\\">\\r\\n  <div class=\\\"guia-scrim\\\" onclick=\\\"closeGuia()\\\"></div>\\r\\n  <div class=\\\"guia-wrap\\\" id=\\\"guiaWrap\\\">\\r\\n    <button class=\\\"guia-close\\\" onclick=\\\"closeGuia()\\\">✕</button>\\r\\n    <div class=\\\"guia-head\\\">\\r\\n      <div class=\\\"guia-logo\\\">STRANGE<sup>®</sup></div>\\r\\n      <div class=\\\"guia-kicker\\\">🎁 Regalo de tu compra</div>\\r\\n      <h2 class=\\\"guia-title\\\">Guía de cuidado de tus sneakers</h2>\\r\\n      <p class=\\\"guia-sub\\\">Cuídalos bien y te durarán como nuevos.<br>Síguela en 5 minutos.</p>\\r\\n    </div>\\r\\n    <div class=\\\"guia-body\\\">\\r\\n\\r\\n      <div class=\\\"guia-step\\\">\\r\\n        <div class=\\\"guia-num\\\">1</div>\\r\\n        <div class=\\\"guia-step-h\\\">🧼 Limpieza según el material</div>\\r\\n      </div>\\r\\n      <div class=\\\"guia-mats\\\">\\r\\n        <div class=\\\"guia-mat\\\">\\r\\n          <div class=\\\"guia-mat-ico\\\">🕸️</div>\\r\\n          <div class=\\\"guia-mat-t\\\">Malla / Tela</div>\\r\\n          <div class=\\\"guia-mat-d\\\">Cepillo suave con agua tibia y jabón neutro. Sin frotar fuerte.</div>\\r\\n        </div>\\r\\n        <div class=\\\"guia-mat\\\">\\r\\n          <div class=\\\"guia-mat-ico\\\">🟤</div>\\r\\n          <div class=\\\"guia-mat-t\\\">Cuero / Sintético</div>\\r\\n          <div class=\\\"guia-mat-d\\\">Paño húmedo y jabón neutro. <b>Nunca sumergir</b>. Seca con paño.</div>\\r\\n        </div>\\r\\n        <div class=\\\"guia-mat\\\">\\r\\n          <div class=\\\"guia-mat-ico\\\">🦫</div>\\r\\n          <div class=\\\"guia-mat-t\\\">Gamuza / Nobuk</div>\\r\\n          <div class=\\\"guia-mat-d\\\">Cepillo seco especial. <b>Nunca agua</b>. Borrador para manchas.</div>\\r\\n        </div>\\r\\n      </div>\\r\\n\\r\\n      <div class=\\\"guia-step\\\">\\r\\n        <div class=\\\"guia-num\\\">2</div>\\r\\n        <div class=\\\"guia-step-h\\\">💧 Secado correcto</div>\\r\\n      </div>\\r\\n      <div class=\\\"guia-card\\\">\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">🌤️</span><div>Siempre <b>a la sombra</b> y ventilado. Nunca al sol directo ni secadora (deforman y amarillean).</div></div>\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">📰</span><div>Rellénalos con <b>papel</b> para que mantengan su forma mientras secan.</div></div>\\r\\n      </div>\\r\\n\\r\\n      <div class=\\\"guia-step\\\">\\r\\n        <div class=\\\"guia-num\\\">3</div>\\r\\n        <div class=\\\"guia-step-h\\\">👟 Almacenamiento</div>\\r\\n      </div>\\r\\n      <div class=\\\"guia-card\\\">\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">🏠</span><div>Lugar <b>seco y ventilado</b>, lejos de humedad.</div></div>\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">🧦</span><div>Usa horma o papel dentro para conservar la forma.</div></div>\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">🔄</span><div><b>Alterna entre 2 pares:</b> dejarlos descansar un día alarga mucho su vida.</div></div>\\r\\n      </div>\\r\\n\\r\\n      <div class=\\\"guia-card guia-no\\\">\\r\\n        <div class=\\\"guia-card-h\\\">🚫 Lo que NUNCA debes hacer</div>\\r\\n        <div class=\\\"guia-pills\\\">\\r\\n          <span class=\\\"guia-pill\\\">🧺 Lavadora / secadora</span>\\r\\n          <span class=\\\"guia-pill\\\">☀️ Sol directo</span>\\r\\n          <span class=\\\"guia-pill\\\">🧪 Blanqueador</span>\\r\\n          <span class=\\\"guia-pill\\\">💦 Guardarlos húmedos</span>\\r\\n        </div>\\r\\n      </div>\\r\\n\\r\\n      <div class=\\\"guia-card guia-tip\\\">\\r\\n        <div class=\\\"guia-card-h\\\">💡 Tips de experto</div>\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">🛡️</span><div>Aplica <b>impermeabilizante</b> a la gamuza desde el estreno: repele agua y manchas.</div></div>\\r\\n        <div class=\\\"guia-row\\\"><span class=\\\"guia-ic\\\">⭐</span><div>Rotar entre pares + limpieza suave semanal = sneakers como nuevos por años.</div></div>\\r\\n      </div>\\r\\n\\r\\n      <div class=\\\"guia-cupon\\\">🎁 Recuerda: usa el código <b>GRACIAS5</b> y obtén <b>5% en tu próxima compra</b></div>\\r\\n\\r\\n      <div class=\\\"guia-foot\\\">\\r\\n        ¿Dudas sobre tu par?<br>\\r\\n        <a class=\\\"guia-wa\\\" id=\\\"guiaWa\\\" href=\\\"#\\\" target=\\\"_blank\\\">💬 Escríbenos por WhatsApp</a>\\r\\n        <span>— El equipo de Strange Sneakers 👟</span>\\r\\n      </div>\\r\\n    </div>\\r\\n    <div class=\\\"guia-actions\\\">\\r\\n      <button class=\\\"guia-dl\\\" onclick=\\\"descargarGuia()\\\">⬇ Descargar guía</button>\\r\\n    </div>\\r\\n  </div>\\r\\n</div>\\r\\n\\r\""));
document.body.insertAdjacentHTML('beforeend',`<!-- MODAL LEGAL (privacidad / términos / cookies / garantías) — calcado de sahet.co (revisado
     en vivo por DOM el 2026-09-02, botón real "aquí" de su paso Confirmación): overlay con scrim
     al 30% + tarjeta blanca casi a pantalla completa (inset 30px), esquinas redondeadas 22px,
     título centrado y subtítulos numerados en letra chica (11-13px). El texto va en una columna
     de lectura (max-width) en vez del ancho completo de sahet — a su escala real (~1800px) el
     texto se ve demasiado estirado para párrafos largos como los nuestros.
     z-index:700 (antes 200, un bug real): openLegal() se llama desde DENTRO del csheet (610) y
     del buy-modal (630) — con 200 el modal quedaba invisible detrás de esos al abrirse ahí. -->
<div id="legalModal" style="display:none;position:fixed;inset:0;z-index:700;background:rgba(0,0,0,.3);padding:30px;box-sizing:border-box;overscroll-behavior:contain" onclick="if(event.target===this)closeLegal()">
  <div style="position:relative;width:100%;height:100%;background:var(--white);border-radius:22px;padding:30px 28px 60px;box-sizing:border-box;overflow-y:auto">
    <button onclick="closeLegal()" aria-label="Cerrar" style="position:absolute;right:20px;top:18px;background:none;border:none;font-size:28px;line-height:1;color:var(--ink2);cursor:pointer">×</button>
    <div id="legalBody" style="font-size:12px;line-height:1.75;color:var(--ink);max-width:820px;margin:0 auto"></div>
  </div>
</div>
`);

/* ── PÁGINAS LEGALES (modal) ── Email de contacto/responsable: cámbialo en UNA línea (LEGAL_EMAIL). */
const LEGAL_EMAIL='juansebastianrincon95@gmail.com';
const LEGAL_UPDATED='9 de junio de 2026';
function legalContent(){
  const marca=STORE_NAME||'Strange Sneakers';
  const h=t=>`<h2 style="font-size:15px;font-weight:700;text-align:center;margin:0 0 6px">${t}</h2><div style="font-size:10.5px;text-align:center;color:var(--ink3);margin-bottom:26px">Última actualización: ${LEGAL_UPDATED}</div>`;
  const sec=(n,t)=>`<div style="font-size:12.5px;font-weight:700;margin:20px 0 6px">${n}. ${t}</div>`;
  const sub=(n,t)=>`<div style="font-size:12px;font-weight:700;margin:16px 0 5px">${n}. ${t}</div>`;
  // Bloques de texto reutilizados tal cual entre las 4 páginas individuales (footer, deep-links
  // /legal/<key>) y la página unificada 'todas' (el único link del checkbox de consentimiento,
  // calcado del "aceptas haber leído nuestras Políticas de Datos, Compras, Cambios y Garantías,
  // las cuales puedes ver haciendo clic aquí" de sahet.co) — se numeran distinto en cada lugar,
  // pero el texto es UNO solo para no mantenerlo por duplicado.
  const B={
    almacenamiento:`<p>Los datos personales que guardamos se usan con fines logísticos y de contacto sobre tu pedido. No se usan para enviarte publicidad a menos que lo autorices.</p>`,
    sensibles:`<p><strong>NO</strong> guardamos datos sensibles como números de tarjeta o información bancaria — esos los procesan directamente nuestras pasarelas de pago.</p>`,
    terceros:`<p>Al aceptar nuestra política de datos también aceptas la de las pasarelas a las que enviamos tus datos de pago:</p>
      <table style="border-collapse:collapse;margin-top:8px;font-size:11.5px">
        <tr><td style="padding:4px 28px 4px 0;color:var(--ink3)">Empresa</td><td style="padding:4px 0;color:var(--ink3)">Política de Datos</td></tr>
        <tr><td style="padding:5px 28px 5px 0;border-top:1px solid var(--line)">Wompi</td><td style="padding:5px 0;border-top:1px solid var(--line)"><a href="https://wompi.co" target="_blank" rel="noopener">Ver</a></td></tr>
        <tr><td style="padding:5px 28px 5px 0;border-top:1px solid var(--line)">Bold</td><td style="padding:5px 0;border-top:1px solid var(--line)"><a href="https://bold.co" target="_blank" rel="noopener">Ver</a></td></tr>
      </table>`,
    recolectados:`<p>Nombre, cédula, teléfono, dirección, ciudad, barrio, correo, talla/género y datos de navegación (cookies, identificadores de Meta Pixel y analítica) cuando realizas un pedido o navegas el sitio.</p>`,
    derechos:`<p>Conforme a la <strong>Ley 1581 de 2012</strong> y el Decreto 1377 de 2013 (Colombia), puedes conocer, actualizar, rectificar y suprimir tus datos, y revocar la autorización, escribiendo a <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>. Responsable: <strong>${marca}</strong>.</p>`,
    precios:`<p>Los precios están en pesos colombianos (COP) y pueden cambiar sin previo aviso — el precio válido es el que se muestra al confirmar el pedido. Aceptamos pago en línea (Wompi/Bold) y pago contra entrega según disponibilidad de la zona.</p>`,
    envios:`<p>Despachamos a todo Colombia; los tiempos de entrega dependen de la transportadora y la ciudad de destino.</p>`,
    disponibilidad:`<p>Los productos están sujetos a inventario. Si un artículo no está disponible tras la compra, te contactaremos para reembolso o cambio.</p>`,
    contacto:`<p>Escríbenos a <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>.</p>`,
    cookiesQueSon:`<p>Usamos cookies y tecnologías similares para que el sitio funcione, recordar tu carrito y medir el rendimiento.</p>`,
    cookiesTipos:`<p><strong>Técnicas:</strong> necesarias para el funcionamiento del sitio. <strong>Analítica:</strong> Google Analytics. <strong>Publicidad/medición:</strong> Meta Pixel — nos ayudan a entender el tráfico y mostrar anuncios relevantes.</p>`,
    cookiesDesactivar:`<p>Puedes bloquear o eliminar las cookies desde la configuración de tu navegador. Si las desactivas, algunas funciones podrían no operar correctamente.</p>`,
    retracto:`<p>Conforme a la <strong>Ley 1480 de 2011</strong> (Estatuto del Consumidor), tienes hasta <strong>5 días hábiles</strong> tras recibir el producto para retractarte en compras a distancia, siempre que el producto esté sin uso y en su empaque original.</p>`,
    cambiosTalla:`<p>Sujetos a disponibilidad; el producto debe estar nuevo, sin uso y con su empaque.</p>`,
    garantia:`<p>Cubre defectos de fabricación. No cubre desgaste normal ni mal uso.</p>`,
    gestionar:`<p>Escríbenos a <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>${WA?` o por WhatsApp al <a href="https://wa.me/${WA}" target="_blank" rel="noopener">+${WA}</a>`:''}.</p>`
  };
  return {
    privacidad: h('Política de Privacidad y Tratamiento de Datos')+
      sec(1,'Almacenamiento y Uso de Datos')+B.almacenamiento+
      sec(2,'Datos Sensibles')+B.sensibles+
      sec(3,'Manejo de Datos por Parte de Terceros')+B.terceros+
      sec(4,'Datos que Recolectamos')+B.recolectados+
      sec(5,'Tus Derechos')+B.derechos,
    terminos: h('Términos y Condiciones')+
      sec(1,'Precios y Pagos')+B.precios+
      sec(2,'Envíos')+B.envios+
      sec(3,'Disponibilidad')+B.disponibilidad+
      sec(4,'Contacto')+B.contacto,
    cookies: h('Política de Cookies')+
      sec(1,'Qué Son y Para Qué las Usamos')+B.cookiesQueSon+
      sec(2,'Tipos de Cookies')+B.cookiesTipos+
      sec(3,'Cómo Desactivarlas')+B.cookiesDesactivar,
    garantias: h('Cambios y Garantías')+
      sec(1,'Derecho de Retracto')+B.retracto+
      sec(2,'Cambios de Talla')+B.cambiosTalla+
      sec(3,'Garantía')+B.garantia+
      sec(4,'Cómo Gestionar un Cambio o Garantía')+B.gestionar,
    // Página unificada — el ÚNICO link del checkbox de consentimiento del checkout (compra.js
    // bmConsentHTML), calcado 1:1 de sahet.co: un solo "aquí" que despliega TODA la información
    // (antes eran 2 links: Política de Datos por un lado, Cambios y Garantías por otro).
    todas: h('Políticas de '+marca)+
      sec(1,'Política de Datos')+
        sub('1.1','Almacenamiento y Uso de Datos')+B.almacenamiento+
        sub('1.2','Datos Sensibles')+B.sensibles+
        sub('1.3','Manejo de Datos por Parte de Terceros')+B.terceros+
        sub('1.4','Datos que Recolectamos')+B.recolectados+
        sub('1.5','Tus Derechos')+B.derechos+
      sec(2,'Política de Compras')+
        sub('2.1','Precios y Pagos')+B.precios+
        sub('2.2','Envíos')+B.envios+
        sub('2.3','Disponibilidad')+B.disponibilidad+
      sec(3,'Política de Cookies')+
        sub('3.1','Qué Son y Para Qué las Usamos')+B.cookiesQueSon+
        sub('3.2','Tipos de Cookies')+B.cookiesTipos+
        sub('3.3','Cómo Desactivarlas')+B.cookiesDesactivar+
      sec(4,'Política de Cambios y Garantías')+
        sub('4.1','Derecho de Retracto')+B.retracto+
        sub('4.2','Cambios de Talla')+B.cambiosTalla+
        sub('4.3','Garantía')+B.garantia+
        sub('4.4','Cómo Gestionar un Cambio o Garantía')+B.gestionar
  };
}
function openLegal(key){
  const m=$('legalModal'),b=$('legalBody');if(!m||!b)return;
  b.innerHTML=(legalContent()[key]||'');
  m.style.display='';document.body.style.overflow='hidden';
  const _lt={privacidad:'Política de Privacidad',terminos:'Términos y Condiciones',cookies:'Política de Cookies',garantias:'Cambios y Garantías',todas:'Políticas'};
  navPush('legal','/legal/'+key,(_lt[key]||'Legal')+' — '+STORE_NAME,closeLegal);
}
function closeLegal(){if(!_navPopping)navRemove('legal');const m=$('legalModal');if(m)m.style.display='none';document.body.style.overflow='';}

/* ── GUÍA DE CUIDADO ── */
function openGuia(){
  // WhatsApp clickeable con el número de la tienda
  const wa=$('guiaWa');
  if(wa)wa.href=`https://wa.me/${WA}?text=${encodeURIComponent('¡Hola '+STORE_NAME+'! Tengo una duda sobre el cuidado de mis sneakers 👟')}`;
  {const _gm=$('guiaModal');const _ya=_gm.classList.contains('on');if(!_ya)lockScroll();_gm.classList.add('on');}   // un bloqueo por capa
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
