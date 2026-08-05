/* ═══ STRANGE SNEAKERS — PANEL ADMIN ═══
   Cargado bajo demanda por el stub openAdmin() de index.html (solo con ?admin).
   Comparte el scope global con el script principal: usa sus helpers ($, fmt,
   escHtml, lockScroll, renders públicos, prods/liqs/settings) y por eso DEBE
   cargarse después (el stub lo garantiza). ═══ */

let ADMIN_OK = false;

async function adminWrite(action, payload = {}) {
  const r = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  });
  if (r.status === 401) {
    ADMIN_OK=false;
    alert('Tu sesión admin expiró. Vuelve a entrar con el PIN.');
  }
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || 'Admin error'); }
  return r.json();
}

let qC=[],qL=[];


// Editor de combos en Admin → Ofertas (settings.combos)
function renderCombosAdmin(){
  const box=$('combosAdminList');if(!box)return;
  box.innerHTML=(combos||[]).map((c,i)=>`<div style="background:var(--white);border:1px solid var(--line);border-radius:10px;padding:9px">
    <div style="display:flex;gap:6px;align-items:center">
      <input id="cbN${i}" type="text" value="${escHtml(c.nombre||'')}" placeholder="Nombre" style="flex:2;min-width:0;padding:7px 9px;background:var(--bg);border:1px solid var(--line);border-radius:7px;font-family:var(--font);font-size:12px;font-weight:700">
      <input id="cbB${i}" type="text" value="${escHtml(c.bandera||'')}" placeholder="🏳" maxlength="4" style="flex:0 0 44px;padding:7px 4px;background:var(--bg);border:1px solid var(--line);border-radius:7px;font-family:var(--font);font-size:14px;text-align:center">
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-top:6px">
      <input id="cbP${i}" type="number" value="${parseInt(c.pares)||0}" min="1" max="20" title="Pares" style="flex:0 0 58px;padding:7px 6px;background:var(--bg);border:1px solid var(--line);border-radius:7px;font-family:var(--font);font-size:12px;font-weight:700;text-align:center">
      <span style="font-size:10px;color:var(--ink3)">pares</span>
      <input id="cbV${i}" type="number" value="${parseInt(c.precio)||0}" step="1000" title="Precio total" style="flex:1;min-width:0;padding:7px 9px;background:var(--bg);border:1px solid var(--line);border-radius:7px;font-family:var(--font);font-size:12px;font-weight:700">
      <label style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:var(--ink2);cursor:pointer">🎁<input id="cbC${i}" type="checkbox" ${c.camiseta?'checked':''} title="Regalo gratis al completar el combo"></label>
      <label style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:var(--ink2);cursor:pointer">ON<input id="cbA${i}" type="checkbox" ${c.activo!==false?'checked':''} title="Activo"></label>
    </div>
    <div style="display:flex;gap:7px;align-items:center;margin-top:7px">
      ${c.img
        ? `<img src="${escHtml(c.img)}" alt="" style="width:78px;height:31px;object-fit:cover;border-radius:5px;border:1px solid var(--line);display:block;flex:0 0 auto">`
        : `<div style="width:78px;height:31px;border:1.5px dashed var(--ink3);border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:700;color:var(--ink3);flex:0 0 auto">SIN FOTO</div>`}
      <label style="flex:1;text-align:center;padding:7px 4px;border:1px solid var(--line);border-radius:6px;background:var(--bg);font-family:var(--font);font-size:10px;font-weight:700;color:var(--ink2);cursor:pointer">
        <span id="cbImgLbl${i}">${c.img?'📷 Cambiar foto':'📷 Subir foto'}</span>
        <input type="file" accept="image/*" style="display:none" onchange="comboImgUp(${i},this.files[0]);this.value=''">
      </label>
      ${c.img?`<button onclick="comboImgDel(${i})" title="Quitar la foto" style="flex:0 0 auto;border:none;background:#ffe9e6;color:var(--red);border-radius:6px;width:29px;height:29px;cursor:pointer;font-size:11px">🗑</button>`:''}
    </div>
  </div>`).join('');
}

/* ── FOTO DE LA TARJETA DEL COMBO ──
   La imagen trae TODO el diseño quemado (nombre, pares y precio); el código solo agrega debajo la
   franja "Armar Combo X →". Sin foto, la tarjeta cae al diseño por código (medalla + texto).
   Se guarda la MISMA imagen en img e img_desktop: la tarjeta es fluida (width:100%), no necesita
   dos versiones. Recomendado 1240×496 (2.5:1). */
function comboImgUp(i,file){
  if(!file||!combos[i])return;
  const lbl=$('cbImgLbl'+i);
  if(lbl)lbl.textContent='Subiendo…';
  compressImg(file,async dataUrl=>{
    try{
      const url=await uploadToStorage(dataUrl,0,false);
      combos[i].img=url;combos[i].img_desktop=url;
      await guardarCombos('✓ Foto del combo actualizada y publicada');   // persiste + re-pinta panel y tienda
    }catch(e){
      if(lbl)lbl.textContent='📷 Subir foto';
      alert('❌ No se pudo subir la foto:\n'+(e.message||e));
    }
  },false,BANNER_MAX);
}

async function comboImgDel(i){
  if(!combos[i])return;
  if(!confirm('¿Quitar la foto de este combo?\n\nLa tarjeta volverá al diseño automático (medalla + nombre + precio).'))return;
  combos[i].img=null;combos[i].img_desktop=null;
  await guardarCombos('✓ Foto quitada. La tarjeta usa el diseño automático.');
}

// msg: mensaje de confirmación a medida (lo usan las acciones de foto). Sin argumento → el genérico.
async function guardarCombos(msg){
  const nuevos=(combos||[]).map((c,i)=>({
    id:c.id,
    nombre:($('cbN'+i)||{}).value?.trim()||c.nombre,
    bandera:($('cbB'+i)||{}).value?.trim()||c.bandera||'🏆',
    pares:Math.min(Math.max(parseInt(($('cbP'+i)||{}).value)||c.pares,1),20),
    precio:Math.max(parseInt(($('cbV'+i)||{}).value)||c.precio,1000),
    img:c.img||null,
    img_desktop:c.img_desktop||null,
    camiseta:!!($('cbC'+i)||{}).checked,
    activo:!!($('cbA'+i)||{}).checked
  }));
  combos=nuevos;
  await adminWrite('upsert_settings',{data:{key:'combos',value:JSON.stringify(nuevos)}});
  renderCombos();renderCombosAdmin();
  alert(msg||'✓ Combos guardados y publicados');
}

/* ── DESCUENTOS (Admin → Ofertas · tabla discounts, migración 006) ──
   El panel solo administra filas vía api/admin.js (list/save/delete_discount); la validación
   del cobro vive entera en api/_orders.js. Los usos que se ven aquí son VENTAS CONFIRMADAS
   (el contador sube al confirmar, no al crear pendings). */
let _descuentos=[],_descEditId=null;

async function loadDescuentos(){
  if(!ADMIN_OK)return;
  try{const r=await adminWrite('list_discounts');_descuentos=r.discounts||[];}catch(e){_descuentos=[];}
  renderDescuentosAdmin();
}

// Estado operativo de la fila (para el chip de la tarjeta)
function descEstado(d){
  if(d.activo===false)return['⏸ Inactivo','#8a8a86'];
  const now=Date.now();
  if(d.desde&&now<Date.parse(d.desde))return['🕐 Programado','#b3791e'];
  if(d.hasta&&now>Date.parse(d.hasta))return['✕ Vencido','#E8200A'];
  if(d.usos_max&&(d.usos||0)>=d.usos_max)return['✕ Agotado','#E8200A'];
  return['● Vigente','#1BA94C'];
}

// Resumen humano de qué hace el descuento
function descResumen(d){
  if(d.tipo==='envio')return '🚚 Envío gratis';
  if(d.tipo==='bogo'){const b=d.bogo||{};return `🎁 Compra ${b.compra||'?'} y lleva ${b.lleva||'?'} con ${b.pct||100}% off`;}
  const v=d.valor_tipo==='pct'?`${d.valor}%`:fmt(d.valor);
  return d.tipo==='producto'?`👟 ${v} off en productos elegidos`:`💰 ${v} off en el pedido`;
}

// 'cat_29'/'liq_5' → '29'/'L5' (formato que ya usa el panel en el link Addi) y de vuelta
function _descIdsATexto(aplica){
  const ids=(aplica&&Array.isArray(aplica.ids))?aplica.ids:[];
  return ids.map(s=>s.startsWith('liq_')?'L'+s.slice(4):s.replace('cat_','')).join(', ');
}
function _descTextoAIds(txt){
  return String(txt||'').split(',').map(s=>s.trim()).filter(Boolean)
    .map(s=>/^L\d+$/i.test(s)?'liq_'+s.slice(1):(/^\d+$/.test(s)?'cat_'+s:null))
    .filter(Boolean);
}

function renderDescuentosAdmin(){
  const box=$('descAdminList');if(!box)return;
  if(!_descuentos.length){box.innerHTML='<div style="font-size:11px;color:var(--ink3)">Aún no hay descuentos. Crea el primero abajo 👇</div>';return;}
  const fF=v=>v?new Date(v).toLocaleDateString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):null;
  box.innerHTML=_descuentos.map(d=>{
    const [est,col]=descEstado(d);
    const rango=(d.desde||d.hasta)?`<div style="font-size:9.5px;color:var(--ink3);margin-top:2px">📅 ${fF(d.desde)||'desde ya'} → ${fF(d.hasta)||'sin vencimiento'}</div>`:'';
    const flags=[d.uno_por_cliente?'1 por cliente':null,d.combinable?'combinable':'no combina',d.min_monto?`mín. ${fmt(d.min_monto)}`:null,d.min_items?`mín. ${d.min_items} pares`:null].filter(Boolean).join(' · ');
    return `<div style="background:var(--white);border:1px solid var(--line);border-radius:10px;padding:9px">
      <div style="display:flex;align-items:center;gap:7px">
        <div style="flex:1;min-width:0">
          <span style="font-size:12.5px;font-weight:800;color:var(--ink)">${d.codigo?escHtml(d.codigo):'⚙️ AUTOMÁTICO'}</span>
          ${d.nombre?`<span style="font-size:10.5px;color:var(--ink3)"> · ${escHtml(d.nombre)}</span>`:''}
        </div>
        <span style="flex:0 0 auto;font-size:10px;font-weight:800;color:${col}">${est}</span>
      </div>
      <div style="font-size:11px;color:var(--ink2);font-weight:600;margin-top:3px">${descResumen(d)}</div>
      <div style="font-size:9.5px;color:var(--ink3);margin-top:2px">Usos: <b>${d.usos||0}</b>${d.usos_max?` / ${d.usos_max}`:' (sin límite)'}${flags?` · ${flags}`:''}</div>
      ${rango}
      <div style="display:flex;gap:6px;margin-top:7px">
        <button onclick="descToggle(${d.id},${d.activo===false})" style="flex:1;border:1px solid var(--line);background:var(--bg);border-radius:7px;padding:6px;cursor:pointer;font-family:var(--font);font-size:10.5px;font-weight:700;color:var(--ink2)">${d.activo===false?'▶ Activar':'⏸ Desactivar'}</button>
        <button onclick="descEdit(${d.id})" style="flex:1;border:1px solid var(--line);background:#eef4ff;border-radius:7px;padding:6px;cursor:pointer;font-family:var(--font);font-size:10.5px;font-weight:700;color:var(--ink)">✏️ Editar</button>
        <button onclick="descBorrar(${d.id})" style="flex:0 0 34px;border:none;background:#ffe9e6;color:var(--red);border-radius:7px;cursor:pointer;font-size:11px">🗑</button>
      </div>
    </div>`;
  }).join('');
}

// Mostrar/ocultar campos según el tipo elegido en el formulario
function descTipoUI(){
  const t=($('dsTipo')||{}).value;
  const rv=$('dsRowValor');if(rv)rv.style.display=(t==='pedido'||t==='producto')?'flex':'none';
  const rb=$('dsRowBogo');if(rb)rb.style.display=t==='bogo'?'flex':'none';
  const ra=$('dsRowAplica');if(ra)ra.style.display=(t==='producto'||t==='bogo')?'block':'none';
}

// ISO → valor de <input type=datetime-local> (hora LOCAL del admin, que es la del negocio)
function _descISOaLocal(v){
  if(!v)return '';
  const t=new Date(v);if(isNaN(t))return '';
  const p=n=>String(n).padStart(2,'0');
  return `${t.getFullYear()}-${p(t.getMonth()+1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}`;
}

function descNuevo(){
  _descEditId=null;
  const f=$('descForm');if(!f)return;
  $('descFormTit').textContent='Nuevo descuento';
  ['dsNombre','dsCodigo','dsValor','dsIds','dsMarcas','dsMinMonto','dsMinItems','dsUsosMax','dsDesde','dsHasta'].forEach(id=>{const el=$(id);if(el)el.value='';});
  $('dsTipo').value='pedido';$('dsValorTipo').value='pct';
  $('dsBogoX').value=2;$('dsBogoY').value=1;$('dsBogoPct').value=100;
  $('dsUno').checked=true;$('dsCombinable').checked=false;$('dsActivo').checked=true;
  descTipoUI();
  f.style.display='block';
  const b=$('descNuevoBtn');if(b)b.style.display='none';
  f.scrollIntoView({block:'center',behavior:'smooth'});
}

function descEdit(id){
  const d=_descuentos.find(x=>x.id===id);if(!d)return;
  descNuevo();                        // resetea y abre el form
  _descEditId=id;
  $('descFormTit').textContent=`Editar ${d.codigo||'descuento automático'}`;
  $('dsNombre').value=d.nombre||'';$('dsCodigo').value=d.codigo||'';
  $('dsTipo').value=d.tipo||'pedido';$('dsValorTipo').value=d.valor_tipo||'pct';$('dsValor').value=d.valor||'';
  const b=d.bogo||{};$('dsBogoX').value=b.compra||2;$('dsBogoY').value=b.lleva||1;$('dsBogoPct').value=b.pct||100;
  $('dsIds').value=_descIdsATexto(d.aplica);
  $('dsMarcas').value=(d.aplica&&Array.isArray(d.aplica.marcas))?d.aplica.marcas.join(', '):'';
  $('dsMinMonto').value=d.min_monto||'';$('dsMinItems').value=d.min_items||'';$('dsUsosMax').value=d.usos_max||'';
  $('dsDesde').value=_descISOaLocal(d.desde);$('dsHasta').value=_descISOaLocal(d.hasta);
  $('dsUno').checked=d.uno_por_cliente!==false;$('dsCombinable').checked=!!d.combinable;$('dsActivo').checked=d.activo!==false;
  descTipoUI();
}

function descCancelar(){
  _descEditId=null;
  const f=$('descForm');if(f)f.style.display='none';
  const b=$('descNuevoBtn');if(b)b.style.display='block';
}

async function guardarDescuento(btn){
  const tipo=($('dsTipo')||{}).value;
  const data={
    nombre:($('dsNombre')||{}).value||'',
    codigo:(($('dsCodigo')||{}).value||'').trim()||null,
    tipo,
    valor_tipo:($('dsValorTipo')||{}).value||'pct',
    valor:parseInt(($('dsValor')||{}).value)||0,
    bogo:tipo==='bogo'?{compra:parseInt($('dsBogoX').value)||0,lleva:parseInt($('dsBogoY').value)||0,pct:parseInt($('dsBogoPct').value)||100}:null,
    aplica:(tipo==='producto'||tipo==='bogo')?{ids:_descTextoAIds(($('dsIds')||{}).value),marcas:String(($('dsMarcas')||{}).value||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean)}:null,
    min_monto:($('dsMinMonto')||{}).value||null,
    min_items:($('dsMinItems')||{}).value||null,
    usos_max:($('dsUsosMax')||{}).value||null,
    uno_por_cliente:!!($('dsUno')||{}).checked,
    combinable:!!($('dsCombinable')||{}).checked,
    // datetime-local es hora local del admin → toISOString la vuelve UTC (lo que compara el server)
    desde:($('dsDesde')||{}).value?new Date($('dsDesde').value).toISOString():null,
    hasta:($('dsHasta')||{}).value?new Date($('dsHasta').value).toISOString():null,
    activo:!!($('dsActivo')||{}).checked
  };
  // Chequeos rápidos en el panel (el server revalida TODO igual)
  if((tipo==='pedido'||tipo==='producto')&&!(data.valor>0))return alert('Pon el valor del descuento (% o monto).');
  if(tipo==='bogo'&&(!(data.bogo.compra>0)||!(data.bogo.lleva>0)))return alert('Configura el BOGO: cuántos compra y cuántos lleva.');
  if(data.valor_tipo==='pct'&&(tipo==='pedido'||tipo==='producto')&&data.valor>100)return alert('Un porcentaje no puede ser mayor a 100.');
  if(data.desde&&data.hasta&&data.hasta<=data.desde)return alert('La fecha "hasta" debe ser posterior a "desde".');
  if(btn){btn.disabled=true;btn.textContent='Guardando…';}
  try{
    await adminWrite('save_discount',_descEditId?{id:_descEditId,data}:{data});
    descCancelar();
    await loadDescuentos();
    alert('✓ Descuento guardado'+(data.codigo?`\n🎟 Código: ${data.codigo.toUpperCase()}`:'\n⚙️ Automático: aplica solo en el carrito'));
  }catch(e){alert('❌ No se pudo guardar:\n'+(e.message||e));}
  finally{if(btn){btn.disabled=false;btn.textContent='💾 Guardar descuento';}}
}

async function descToggle(id,on){
  try{await adminWrite('save_discount',{id,data:{activo:!!on}});await loadDescuentos();}
  catch(e){alert('❌ '+(e.message||e));}
}

async function descBorrar(id){
  const d=_descuentos.find(x=>x.id===id);
  if(!confirm(`¿Borrar el descuento ${d&&d.codigo?d.codigo:'automático'}?\n\nSe borra también su registro de usos. Los pedidos ya cobrados no cambian.`))return;
  try{await adminWrite('delete_discount',{id});await loadDescuentos();}
  catch(e){alert('❌ '+(e.message||e));}
}

/* ── ZONAS DE ENVÍO (Ajustes → settings.envio_zonas + envio_gratis_desde) ──
   Réplica de los perfiles de envío de Shopify: cada zona tiene ciudades, tarifa del 1er par y
   tarifa por par adicional; la zona por defecto cobra cuando la ciudad no matchea ninguna.
   El editor trabaja sobre una COPIA (draft) y solo publica con "Guardar" — igual que los combos.
   El cobro real lo recalcula SIEMPRE el server (api/_orders.js) con lo guardado aquí. */
let _zonasDraft=null;

function _zonasBase(){
  // Arranque del editor: lo guardado en settings o, si no hay nada, la fórmula nacional de hoy
  // como única zona por defecto (guardarla tal cual no cambia ningún precio).
  if(Array.isArray(envioZonas)&&envioZonas.length)
    return envioZonas.map(z=>({nombre:z.nombre||'',ciudades:Array.isArray(z.ciudades)?z.ciudades.slice():[],base:parseInt(z.base)||0,extra:parseInt(z.extra)||0,default:!!z.default}));
  return [{nombre:'Resto del país',ciudades:[],base:25000,extra:15000,default:true}];
}

function renderEnvioAdmin(){
  const box=$('envioZonasList');if(!box)return;
  if(!_zonasDraft)_zonasDraft=_zonasBase();
  box.innerHTML=_zonasDraft.map((z,i)=>`<div style="background:var(--white);border:1px solid var(--line);border-radius:10px;padding:9px">
    <div style="display:flex;gap:6px;align-items:center">
      <input type="text" value="${escHtml(z.nombre||'')}" placeholder="Nombre (ej. Cali y área)" oninput="_zonasDraft[${i}].nombre=this.value" style="flex:1;min-width:0;padding:7px 9px;background:var(--bg);border:1px solid var(--line);border-radius:7px;font-family:var(--font);font-size:12px;font-weight:700">
      <label title="La zona que cobra cuando la ciudad no coincide con ninguna lista" style="display:flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:var(--ink2);cursor:pointer;flex:0 0 auto"><input type="radio" name="znDef" ${z.default?'checked':''} onchange="zonaSetDef(${i})">Por defecto</label>
      ${_zonasDraft.length>1?`<button onclick="zonaDel(${i})" title="Quitar zona" style="border:none;background:#ffe9e6;color:var(--red);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:11px;flex:0 0 auto">🗑</button>`:''}
    </div>
    <input type="text" value="${escHtml((z.ciudades||[]).join(', '))}" placeholder="Ciudades separadas por coma (ej. cali, palmira, jamundi)" oninput="_zonasDraft[${i}].ciudades=this.value.split(',').map(s=>s.trim()).filter(Boolean)" ${z.default?'disabled':''} style="margin-top:6px;width:100%;padding:7px 9px;background:var(--bg);border:1px solid var(--line);border-radius:7px;font-family:var(--font);font-size:11.5px;font-weight:500;color:var(--ink);${z.default?'opacity:.5':''}">
    ${z.default?`<div style="font-size:9.5px;color:var(--ink3);margin-top:3px">Aplica a TODA ciudad que no esté en otra zona — no necesita lista.</div>`:''}
    <div style="display:flex;gap:6px;align-items:center;margin-top:6px">
      <span style="font-size:10px;color:var(--ink3);flex:0 0 auto">1er par $</span>
      <input type="number" value="${parseInt(z.base)||0}" step="1000" min="0" oninput="_zonasDraft[${i}].base=parseInt(this.value)||0" style="flex:1;min-width:0;padding:7px 9px;background:var(--bg);border:1px solid var(--line);border-radius:7px;font-family:var(--font);font-size:12px;font-weight:700">
      <span style="font-size:10px;color:var(--ink3);flex:0 0 auto">par adicional +$</span>
      <input type="number" value="${parseInt(z.extra)||0}" step="1000" min="0" oninput="_zonasDraft[${i}].extra=parseInt(this.value)||0" style="flex:1;min-width:0;padding:7px 9px;background:var(--bg);border:1px solid var(--line);border-radius:7px;font-family:var(--font);font-size:12px;font-weight:700">
    </div>
  </div>`).join('');
  // El umbral de envío gratis solo se repuebla si el admin no lo está editando en este momento
  const g=$('cfgEnvioGratis');if(g&&document.activeElement!==g)g.value=envioGratisDesde>0?envioGratisDesde:'';
}

function zonaAdd(){if(!_zonasDraft)_zonasDraft=_zonasBase();_zonasDraft.push({nombre:'',ciudades:[],base:20000,extra:10000,default:false});renderEnvioAdmin();}

function zonaDel(i){
  if(!_zonasDraft||!_zonasDraft[i])return;
  if(!confirm('¿Quitar esta zona?'))return;
  _zonasDraft.splice(i,1);
  // Nunca dejar el draft sin zona por defecto (la validación de guardar la exige)
  if(_zonasDraft.length&&!_zonasDraft.some(z=>z.default))_zonasDraft[0].default=true;
  renderEnvioAdmin();
}

function zonaSetDef(i){if(!_zonasDraft)return;_zonasDraft.forEach((z,j)=>z.default=j===i);renderEnvioAdmin();}

async function guardarEnvio(){
  const zonas=_zonasDraft||_zonasBase();
  if(!zonas.length){alert('Debe existir al menos la zona por defecto.');return;}
  // EXACTAMENTE una zona por defecto: es la que respalda toda ciudad no listada
  const defs=zonas.filter(z=>z.default).length;
  if(defs!==1){alert(`Debe existir exactamente UNA zona "por defecto" (hay ${defs}). Márcala con el círculo.`);return;}
  for(const z of zonas){
    const nom=z.nombre||'(sin nombre)';
    if(!Number.isFinite(parseInt(z.base))||parseInt(z.base)<0){alert(`Tarifa del 1er par inválida en la zona "${nom}".`);return;}
    if(!z.default&&!(z.ciudades||[]).length){alert(`La zona "${nom}" no tiene ciudades: nunca aplicaría.\nAgrégale ciudades o quítala.`);return;}
    // base 0 = flete gratis en esa zona: legal, pero es margen directo → confirmar que es a propósito
    if(parseInt(z.base)===0&&!confirm(`La zona "${nom}" tiene tarifa $0: el envío contra entrega saldría GRATIS ahí.\n¿Seguro?`))return;
  }
  const limpias=zonas.map(z=>({
    nombre:String(z.nombre||'').trim()||'Zona',
    ciudades:z.default?undefined:(z.ciudades||[]).map(c=>String(c).trim()).filter(Boolean),
    base:Math.max(0,parseInt(z.base)||0),
    extra:Math.max(0,parseInt(z.extra)||0),
    default:z.default||undefined   // undefined → la clave no se serializa (JSON compacto)
  }));
  const gratis=Math.max(0,parseInt(($('cfgEnvioGratis')||{}).value)||0);
  await adminWrite('upsert_settings',{data:[
    {key:'envio_zonas',value:JSON.stringify(limpias)},
    {key:'envio_gratis_desde',value:String(gratis)}
  ]});
  envioZonas=limpias;envioGratisDesde=gratis;   // la tienda abierta pinta ya los fletes nuevos
  _zonasDraft=null;renderEnvioAdmin();
  alert('✓ Zonas de envío guardadas y publicadas'+(gratis>0?`\n🎁 Envío gratis desde ${fmt(gratis)}`:''));
}

// navegación manual reinicia el timer
/* ── HERO: admin (gestionar banners) ──
   Nota: el destino del CTA es fijo (Ofertas, estrategia de combos). El selector de destino
   por banner y heroCTA() se eliminaron — eran código muerto (hallazgo Codex #5). */
let _heroDraft={img:null,img_desktop:null};

function heroDraftImg(file,which){
  if(!file)return;
  const isD=(which==='escritorio');
  const lbl=$(isD?'heroFileLblD':'heroFileLbl');
  const baseLbl=isD?'Horizontal 2560×1280 · toca para subir':'Vertical 1080×1920 · toca para subir';
  if(lbl)lbl.textContent='Subiendo…';
  compressImg(file,async dataUrl=>{
    try{
      const url=await uploadToStorage(dataUrl,0,false);
      if(isD)_heroDraft.img_desktop=url; else _heroDraft.img=url;
      const t=$(isD?'heroDraftThumbD':'heroDraftThumb');if(t){t.src=url;t.style.display='block';}
      if(lbl)lbl.textContent=(isD?'Escritorio':'Móvil')+' lista ✓ (cambiar)';
    }catch(e){if(lbl)lbl.textContent=baseLbl;alert('❌ No se pudo subir la imagen:\n'+(e.message||e));}
  },false,BANNER_MAX);
}

async function heroAdd(){
  if(!_heroDraft.img){alert('Sube al menos la imagen MÓVIL del banner.');return;}
  // Sin versión de escritorio, en computador se muestra la vertical recortada — avisar.
  if(!_heroDraft.img_desktop&&!confirm('Este banner NO tiene imagen de ESCRITORIO 🖥\n\nEn computador se verá la imagen vertical recortada.\n¿Agregarlo igual? (puedes subirla después con "🖥 Cambiar escritorio")'))return;
  const slide={
    img:_heroDraft.img,
    titulo:($('heroTit').value||'').trim(),
    subtitulo:($('heroSub').value||'').trim()
  };
  if(_heroDraft.img_desktop)slide.img_desktop=_heroDraft.img_desktop;
  heroSlides.push(slide);
  await saveHeroSlides();
  _heroDraft={img:null,img_desktop:null};
  $('heroTit').value='';$('heroSub').value='';
  const t=$('heroDraftThumb');if(t){t.src='';t.style.display='none';}
  const td=$('heroDraftThumbD');if(td){td.src='';td.style.display='none';}
  const lbl=$('heroFileLbl');if(lbl)lbl.textContent='Vertical 1080×1920 · toca para subir';
  const lblD=$('heroFileLblD');if(lblD)lblD.textContent='Horizontal 2560×1280 · toca para subir';
}

function renderHeroAdmin(){
  const box=$('heroAdminList');if(!box)return;
  if(!heroSlides.length){box.innerHTML='<div style="font-size:11px;color:var(--ink3)">Aún no hay banners. Agrega el primero abajo 👇</div>';return;}
  box.innerHTML=heroSlides.map((s,i)=>`<div style="background:var(--white);border:1px solid var(--line);border-radius:9px;padding:6px">
    <div style="display:flex;align-items:center;gap:8px">
      <div style="display:flex;gap:4px;flex-shrink:0">
        <div style="text-align:center"><img src="${escHtml(s.img)}" alt="" style="width:30px;height:44px;object-fit:cover;border-radius:5px;display:block"><span style="font-size:8px;color:var(--ink3)">📱</span></div>
        ${s.img_desktop
          ?`<div style="text-align:center"><img src="${escHtml(s.img_desktop)}" alt="" style="width:58px;height:44px;object-fit:cover;border-radius:5px;display:block"><span style="font-size:8px;color:var(--ink3)">🖥</span></div>`
          :`<div onclick="heroPickImg(${i},'escritorio')" title="Falta la imagen de escritorio — toca para subirla" style="width:58px;height:44px;border:1.5px dashed var(--red);border-radius:5px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;color:var(--red);font-weight:700;line-height:1.15"><span style="font-size:11px">＋🖥</span><span style="font-size:7.5px">FALTA</span></div>`}
      </div>
      <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.titulo)||'(sin título)'}</div><div style="font-size:10px;color:var(--ink3)">Botón → Ofertas</div></div>
      <button onclick="heroMove(${i},-1)" ${i===0?'disabled':''} style="border:none;background:var(--bg);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px;${i===0?'opacity:.3':''}">↑</button>
      <button onclick="heroMove(${i},1)" ${i===heroSlides.length-1?'disabled':''} style="border:none;background:var(--bg);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px;${i===heroSlides.length-1?'opacity:.3':''}">↓</button>
      <button onclick="heroDel(${i})" style="border:none;background:#ffe9e6;color:var(--red);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px">🗑</button>
    </div>
    <div style="display:flex;gap:5px;margin-top:6px">
      <button onclick="heroPickImg(${i},'movil')" style="flex:1;border:1px solid var(--line);background:var(--bg);border-radius:6px;padding:5px 4px;cursor:pointer;font-family:var(--font);font-size:10px;font-weight:700;color:var(--ink2)">📱 Cambiar móvil</button>
      <button onclick="heroPickImg(${i},'escritorio')" style="flex:1;border:1px solid var(--line);background:var(--bg);border-radius:6px;padding:5px 4px;cursor:pointer;font-family:var(--font);font-size:10px;font-weight:700;color:var(--ink2)">🖥 Cambiar escritorio</button>
      <button onclick="heroEditText(${i})" style="flex:1;border:1px solid var(--line);background:var(--bg);border-radius:6px;padding:5px 4px;cursor:pointer;font-family:var(--font);font-size:10px;font-weight:700;color:var(--ink2)">✏ Texto</button>
      <button onclick="heroPos(${i})" title="Encuadre escritorio" style="border:1px solid var(--line);background:var(--bg);border-radius:6px;padding:5px 7px;cursor:pointer;font-size:10px">${s.pos==='bottom'?'🖥▼':s.pos==='top'?'🖥▲':'🖥■'}</button>
    </div>
  </div>`).join('');
}

// {i, which} del slide en edición
function heroPickImg(i,which){
  _heroEdit={i,which};
  const inp=$('heroEditFile');if(inp){inp.value='';inp.click();}
}

function heroEditFileChange(file){
  if(!file||!_heroEdit)return;
  const {i,which}=_heroEdit;_heroEdit=null;
  compressImg(file,async dataUrl=>{
    try{
      const url=await uploadToStorage(dataUrl,0,false);
      if(which==='escritorio')heroSlides[i].img_desktop=url; else heroSlides[i].img=url;
      await saveHeroSlides();
      alert('✓ Imagen '+(which==='escritorio'?'de escritorio':'móvil')+' actualizada. Ya está publicada.');
    }catch(e){alert('❌ No se pudo subir la imagen:\n'+(e.message||e));}
  },false,BANNER_MAX);
}

async function heroEditText(i){
  const s=heroSlides[i];
  const tit=prompt('Título del banner:',s.titulo||'');
  if(tit===null)return;
  const sub=prompt('Subtítulo (opcional):',s.subtitulo||'');
  if(sub===null)return;
  s.titulo=tit.trim();s.subtitulo=sub.trim();
  await saveHeroSlides();
}

async function heroPos(i){
  const order=['center','bottom','top'];
  heroSlides[i].pos=order[(order.indexOf(heroSlides[i].pos||'center')+1)%order.length];
  await saveHeroSlides();
}

async function heroMove(i,dir){
  const j=i+dir;if(j<0||j>=heroSlides.length)return;
  [heroSlides[i],heroSlides[j]]=[heroSlides[j],heroSlides[i]];
  await saveHeroSlides();
}

async function heroDel(i){
  if(!confirm('¿Quitar este banner?'))return;
  heroSlides.splice(i,1);
  await saveHeroSlides();
}

async function saveHeroSlides(){
  await adminWrite('upsert_settings',{data:{key:'hero_slides',value:JSON.stringify(heroSlides)}});
  renderHero();renderHeroAdmin();
}

function renderFeaturedAdmin(){
  const cnt=$('lanzCnt');if(cnt)cnt.textContent=`${featuredIds.length}/${LANZ_MAX} elegidos`;
  const box=$('featList');
  if(box){
    box.innerHTML=featuredIds.length?featuredIds.map((id,i)=>{
      const p=prods.find(x=>x.id===id);if(!p)return '';
      return `<div style="display:flex;align-items:center;gap:8px;background:var(--white);border:1px solid var(--line);border-radius:9px;padding:6px">
        <img src="${escHtml(p.img||'')}" alt="" style="width:34px;height:42px;object-fit:cover;border-radius:6px;flex-shrink:0">
        <div style="flex:1;min-width:0;font-size:11.5px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.modelo||prodLabel(p))}<span style="color:var(--ink3);font-weight:500"> · #${p.id}</span></div>
        <button onclick="featMove(${i},-1)" ${i===0?'disabled':''} style="border:none;background:var(--bg);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px;${i===0?'opacity:.3':''}">↑</button>
        <button onclick="featMove(${i},1)" ${i===featuredIds.length-1?'disabled':''} style="border:none;background:var(--bg);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px;${i===featuredIds.length-1?'opacity:.3':''}">↓</button>
        <button onclick="featDel(${i})" style="border:none;background:#ffe9e6;color:var(--red);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px">🗑</button>
      </div>`;
    }).join(''):'<div style="font-size:11px;color:var(--ink3)">Aún no hay lanzamientos. Toca las fotos de abajo para elegirlos 👇</div>';
  }
  const pick=$('lanzPick');if(!pick)return;
  pick.innerHTML=prods.filter(p=>!p.sold).map(p=>{
    const sel=featuredIds.includes(p.id);
    return `<div onclick="featPickTog(${p.id})" style="position:relative;cursor:pointer;border:2px solid ${sel?'var(--ink)':'var(--line)'};border-radius:10px;overflow:hidden;background:var(--white)">
      <img src="${escHtml(p.img||'')}" alt="" loading="lazy" style="display:block;width:100%;aspect-ratio:1/1;object-fit:cover">
      ${sel?'<div style="position:absolute;top:4px;right:4px;background:var(--ink);color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">✓</div>':''}
      <div style="padding:4px 5px 0;font-size:9.5px;font-weight:700;line-height:1.25;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.modelo||brandLabel(p.brand)||(genLabel(p.g)))}</div>
      <div style="padding:0 5px 5px;font-size:9px;color:var(--ink3)">#${p.id} · ${fmt(p.price)}</div>
    </div>`;
  }).join('');
}

async function featPickTog(id){
  const i=featuredIds.indexOf(id);
  if(i>=0)featuredIds.splice(i,1);
  else{
    if(featuredIds.length>=LANZ_MAX){alert(`Máximo ${LANZ_MAX} lanzamientos. Quita uno para agregar otro.`);return;}
    featuredIds.push(id);
  }
  await saveFeatured();
}

async function featMove(i,dir){const j=i+dir;if(j<0||j>=featuredIds.length)return;[featuredIds[i],featuredIds[j]]=[featuredIds[j],featuredIds[i]];await saveFeatured();}

async function featDel(i){featuredIds.splice(i,1);await saveFeatured();}

async function saveFeatured(){
  await adminWrite('upsert_settings',{data:{key:'featured_ids',value:JSON.stringify(featuredIds)}});
  renderFeatured();renderFeaturedAdmin();
}

// {img,img_desktop,titulo,subtitulo}
let _colDraft={m:{img:null,img_desktop:null}, h:{img:null,img_desktop:null}, u:{img:null,img_desktop:null}};

function colDraftImg(file,g,which){
  if(!file)return;
  const isD=(which==='escritorio');
  const lbl=$('col'+g+(isD?'LblD':'Lbl'));
  const baseLbl=isD?'Horizontal 1920×1280 · toca para subir':'Vertical 1080×1350 · toca para subir';
  if(lbl)lbl.textContent='Subiendo…';
  compressImg(file,async dataUrl=>{
    try{
      const url=await uploadToStorage(dataUrl,0,false);
      _colDraft[g][isD?'img_desktop':'img']=url;
      const t=$('col'+g+(isD?'ThumbD':'Thumb'));if(t){t.src=url;t.style.display='block';}
      if(lbl)lbl.textContent=(isD?'Escritorio':'Móvil')+' lista ✓ (cambiar)';
    }catch(e){if(lbl)lbl.textContent=baseLbl;alert('❌ No se pudo subir:\n'+(e.message||e));}
  },false,BANNER_MAX);
}

async function saveColBanner(g){
  const d=_colDraft[g], prev=(g==='m'?bannerMujer:g==='h'?bannerHombre:bannerUnisex);
  const img=d.img||(prev&&prev.img);
  if(!img){alert('Sube al menos la imagen móvil del banner.');return;}
  const banner={img, img_desktop:d.img_desktop||(prev&&prev.img_desktop)||null, titulo:($('col'+g+'Tit').value||'').trim(), subtitulo:($('col'+g+'Sub').value||'').trim(), pos:(($('col'+g+'Pos')||{}).value)||'center'};
  if(g==='m')bannerMujer=banner; else if(g==='h')bannerHombre=banner; else bannerUnisex=banner;
  const key=g==='m'?'banner_mujer':g==='h'?'banner_hombre':'banner_unisex';
  await adminWrite('upsert_settings',{data:{key,value:JSON.stringify(banner)}});
  _colDraft[g]={img:null,img_desktop:null};
  renderColBanners();
  alert('✓ Banner de '+(g==='m'?'Mujer':g==='h'?'Hombre':'Unisex')+' guardado');
}

function renderColAdmin(){
  [['m',bannerMujer],['h',bannerHombre],['u',bannerUnisex]].forEach(([g,b])=>{
    if(!b)return;
    const tit=$('col'+g+'Tit');if(tit)tit.value=b.titulo||'';
    const sub=$('col'+g+'Sub');if(sub)sub.value=b.subtitulo||'';
    const pos=$('col'+g+'Pos');if(pos){const n=parseFloat(b.pos);const v=isFinite(n)?n:({top:18,center:50,bottom:82}[b.pos]||50);pos.value=v;const lbl=$('col'+g+'PosV');if(lbl)lbl.textContent=v+'%';}
    const t=$('col'+g+'Thumb');if(t&&b.img){t.src=b.img;t.style.display='block';const l=$('col'+g+'Lbl');if(l)l.textContent='Actual cargada ✓ · toca para cambiar';}
    const td=$('col'+g+'ThumbD');if(td&&b.img_desktop){td.src=b.img_desktop;td.style.display='block';const ld=$('col'+g+'LblD');if(ld)ld.textContent='Actual cargada ✓ · toca para cambiar';}
  });
}

/* ── GUÍA DE TALLAS (2 fotos de marquilla, una sola para todos los productos) ── */
let _guiaDraft={img1:null};
function guiaDraftImg(which,file){
  if(!file)return;
  const n='1',lbl=$('guia1Lbl');
  if(lbl)lbl.textContent='Subiendo…';
  compressImg(file,async dataUrl=>{
    try{
      const url=await uploadToStorage(dataUrl,0,false);
      _guiaDraft[which]=url;
      const t=$('guia'+n+'Thumb');if(t){t.src=url;t.style.display='block';}
      if(lbl)lbl.textContent='Lista ✓ (cambiar)';
    }catch(e){if(lbl)lbl.textContent='📷 Foto '+n;alert('❌ No se pudo subir:\n'+(e.message||e));}
  },false,IMG_MAX);
}
async function saveSizeGuide(){
  const img1=_guiaDraft.img1||(sizeGuide&&sizeGuide.img1)||null;
  if(!img1){alert('Sube la foto de la marquilla.');return;}
  sizeGuide={img1};
  await adminWrite('upsert_settings',{data:{key:'size_guide',value:JSON.stringify(sizeGuide)}});
  _guiaDraft={img1:null};
  alert('✓ Guía de tallas guardada');
}
function renderSizeGuideAdmin(){
  const u=sizeGuide&&sizeGuide.img1;const t=$('guia1Thumb');
  if(t&&u){t.src=u;t.style.display='block';const l=$('guia1Lbl');if(l)l.textContent='Actual ✓ (toca para cambiar)';}
}
async function checkPixelHealth(){
  const el=$('pixelHealth');if(!el)return;
  try{
    const r=await adminWrite('pixel_health',{});
    if(!r||!r.ok){el.innerHTML='<span style="color:var(--ink3)">No se pudo comprobar.</span>';return;}
    if(!r.capi_configured){el.innerHTML='⚠️ <span style="color:#b3791e">CAPI sin pixel (META_PIXEL_ID no configurado en Vercel).</span>';return;}
    el.innerHTML = r.match
      ? `✅ <span style="color:#1BA94C">Coinciden</span> · front …${escHtml(r.front_last4)} = CAPI …${escHtml(r.capi_last4)}`
      : `❌ <span style="color:#E8200A">NO coinciden</span> · front …${escHtml(r.front_last4)} ≠ CAPI …${escHtml(r.capi_last4)} (revisa settings.pixel_id vs META_PIXEL_ID)`;
  }catch(e){el.innerHTML='<span style="color:var(--ink3)">No se pudo comprobar.</span>';}
}
async function saveSocials(){
  socials={ig:(($('cfgIg')||{}).value||'').trim(), tiktok:(($('cfgTiktok')||{}).value||'').trim(), fb:(($('cfgFb')||{}).value||'').trim()};
  await adminWrite('upsert_settings',{data:{key:'socials',value:JSON.stringify(socials)}});
  renderFooter();
}

let _testiFoto=null, _testiCap=null, _testiEditIdx=null;

function renderTestiAdmin(){
  const sel=$('testiProdSel');
  if(sel)sel.innerHTML='<option value="">(sin producto vinculado)</option>'+prods.map(p=>`<option value="${p.id}">${prodLabel(p)}</option>`).join('');
  const box=$('testiList');if(!box)return;
  if(!testimonios.length){box.innerHTML='<div style="font-size:11px;color:var(--ink3)">Aún no hay testimonios. Agrega el primero abajo 👇</div>';return;}
  box.innerHTML=testimonios.map((t,i)=>`<div style="display:flex;align-items:center;gap:8px;background:var(--white);border:1px solid var(--line);border-radius:9px;padding:6px">
    <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;color:var(--ink)">${escHtml(t.nombre||'')}${t.captura?' 🧾':''}${t.foto?' 📷':''}</div><div style="font-size:10px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(t.texto||(t.captura?'(pantallazo)':''))}</div></div>
    <button onclick="testiEdit(${i})" style="border:none;background:#eef4ff;border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px">✏️</button>
    <button onclick="testiMove(${i},-1)" ${i===0?'disabled':''} style="border:none;background:var(--bg);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px;${i===0?'opacity:.3':''}">↑</button>
    <button onclick="testiMove(${i},1)" ${i===testimonios.length-1?'disabled':''} style="border:none;background:var(--bg);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px;${i===testimonios.length-1?'opacity:.3':''}">↓</button>
    <button onclick="testiDel(${i})" style="border:none;background:#ffe9e6;color:var(--red);border-radius:6px;width:26px;height:26px;cursor:pointer;font-size:12px">🗑</button>
  </div>`).join('');
}

// Pantallazo del pedido recibido (se muestra GRANDE arriba de la tarjeta, estilo elena).
function testiCapUp(file){
  if(!file)return;
  const lbl=$('testiCapLbl');if(lbl)lbl.textContent='Subiendo…';
  compressImg(file,async d=>{try{const u=await uploadToStorage(d,0,false);_testiCap=u;if(lbl)lbl.textContent='Pantallazo listo ✓ (cambiar)';}catch(e){if(lbl)lbl.textContent='🧾 Pantallazo del pedido recibido (opcional)';alert('❌ No se pudo subir:\n'+(e.message||e));}},false);
}

function testiFotoUp(file){
  if(!file)return;
  const lbl=$('testiFotoLbl');if(lbl)lbl.textContent='Subiendo…';
  compressImg(file,async d=>{try{const u=await uploadToStorage(d,0,false);_testiFoto=u;if(lbl)lbl.textContent='Foto lista ✓ (cambiar)';}catch(e){if(lbl)lbl.textContent='📷 Foto del cliente (opcional)';alert('❌ No se pudo subir:\n'+(e.message||e));}},false);
}

async function testiAdd(){
  const nombre=($('testiNombre').value||'').trim(), texto=($('testiTexto').value||'').trim();
  // Con pantallazo, el texto es opcional (la captura ES el testimonio).
  if(!nombre||(!texto&&!_testiCap)){alert('Pon el nombre y el testimonio (o sube el pantallazo).');return;}
  const fecha=($('testiFecha').value||'').trim()||new Date().toLocaleDateString('es-CO');
  const ciudad=($('testiCiudad')||{}).value?$('testiCiudad').value.trim():'';
  const productId=parseInt(($('testiProdSel')||{}).value)||null;
  const obj={nombre,ciudad,fecha,texto,foto:_testiFoto||null,captura:_testiCap||null,productId};
  if(_testiEditIdx!==null&&testimonios[_testiEditIdx])testimonios[_testiEditIdx]=obj;   // editar en sitio
  else testimonios.push(obj);
  await saveTestimonios();
  _testiFormReset();
}

// Cargar un testimonio existente en el formulario para editarlo.
function testiEdit(i){
  const t=testimonios[i];if(!t)return;
  _testiEditIdx=i;
  $('testiNombre').value=t.nombre||'';$('testiTexto').value=t.texto||'';$('testiFecha').value=t.fecha||'';
  if($('testiCiudad'))$('testiCiudad').value=t.ciudad||'';
  if($('testiProdSel'))$('testiProdSel').value=t.productId||'';
  _testiFoto=t.foto||null;_testiCap=t.captura||null;
  const lbl=$('testiFotoLbl');if(lbl)lbl.textContent=_testiFoto?'Foto lista ✓ (cambiar)':'📷 Foto del cliente (opcional)';
  const lbc=$('testiCapLbl');if(lbc)lbc.textContent=_testiCap?'Pantallazo listo ✓ (cambiar)':'🧾 Pantallazo del pedido recibido (opcional)';
  const btn=$('testiAddBtn');if(btn)btn.textContent='💾 Guardar cambios';
  const cb=$('testiCancelBtn');if(cb)cb.style.display='block';
  const inp=$('testiNombre');if(inp)inp.scrollIntoView({block:'center',behavior:'smooth'});
}

function testiEditCancel(){_testiFormReset();}

function _testiFormReset(){
  _testiEditIdx=null;_testiFoto=null;_testiCap=null;
  $('testiNombre').value='';$('testiTexto').value='';$('testiFecha').value='';
  if($('testiCiudad'))$('testiCiudad').value='';if($('testiProdSel'))$('testiProdSel').value='';
  const lbl=$('testiFotoLbl');if(lbl)lbl.textContent='📷 Foto del cliente (opcional)';
  const lbc=$('testiCapLbl');if(lbc)lbc.textContent='🧾 Pantallazo del pedido recibido (opcional)';
  const btn=$('testiAddBtn');if(btn)btn.textContent='➕ Agregar testimonio';
  const cb=$('testiCancelBtn');if(cb)cb.style.display='none';
}

async function testiMove(i,dir){const j=i+dir;if(j<0||j>=testimonios.length)return;if(_testiEditIdx!==null)_testiFormReset();[testimonios[i],testimonios[j]]=[testimonios[j],testimonios[i]];await saveTestimonios();}

async function testiDel(i){if(_testiEditIdx!==null)_testiFormReset();testimonios.splice(i,1);await saveTestimonios();}

async function saveTestimonios(){await adminWrite('upsert_settings',{data:{key:'testimonios',value:JSON.stringify(testimonios)}});renderTestimonios();renderTestiAdmin();}

async function saveReviews(){reviewsCount=parseInt(($('cfgReviews')||{}).value)||0;await adminWrite('upsert_settings',{data:{key:'reviews_count',value:String(reviewsCount)}});renderTestimonios();}

/* ── ADMIN ── */
async function loadOrders(){
  if(!ADMIN_OK)return;
  try{
    const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list_orders'})});
    if(!r.ok)return;
    const j=await r.json();
    if(Array.isArray(j.orders)){
      orders=j.orders.map(o=>({
        id:o.id,fecha:o.fecha||o.created_at,subtotal:o.subtotal,envio:o.envio,total:o.total||0,pares:o.pares,
        pago:o.pago,ciudad:o.ciudad,barrio:o.barrio,nombre:o.nombre,tel:o.tel,
        cedula:o.cedula,direccion:o.direccion,utm:o.utm||null,combo:o.combo||null,cupon:o.cupon||null,
        wa_status:o.wa_status,temperatura:o.temperatura,motivo_no_venta:o.motivo_no_venta,nota:o.nota,seguimiento:o.seguimiento,
        items:o.items,status:o.status,reference:o.reference,seccion:o.seccion,session_id:o.session_id||null,
        guia:o.guia||null,tracking_url:o.tracking_url||null,transportadora:o.transportadora||null,estado_envio:o.estado_envio||null,recaudo:o.recaudo,
        despachado_at:o.despachado_at||null,entregado_at:o.entregado_at||null
      }));
    }
  }catch(e){}
}

function _showAdmin(){
  // El modo prueba se SINCRONIZA con la marca del equipo (Ajustes → 🧪 Este equipo es de pruebas):
  // se enciende solo donde tú lo marcaste, y se apaga solo donde no. Antes se encendía en
  // cualquier dispositivo que abriera el panel, así que el celular de trabajo quedaba atrapado
  // en modo prueba: "Salir" lo apagaba, pero al reabrir el panel volvía a prenderse.
  if(typeof setTestMode==='function'&&typeof esEquipoPruebas==='function'){
    const debe=esEquipoPruebas();
    if(!!window.__TEST__!==debe)setTestMode(debe);
  }
  loadCosts().then(()=>{if(avSec==='productos'||avSec==='ofertas')avSec==='ofertas'?renderLiqAdmin():renderAdmin();});
  renderAdmin();
  const swP=$('swPromo');if(swP)swP.checked=promoG;
  const swB=$('swBanner');if(swB)swB.checked=bannerOn;
  const swT=$('swTestEquipo');if(swT)swT.checked=(typeof esEquipoPruebas==='function'&&esEquipoPruebas());
  const cfgN=$('cfgNombre');if(cfgN)cfgN.value=STORE_NAME;
  const cfgW=$('cfgWA');if(cfgW)cfgW.value=WA;
  const cfgPx=$('cfgPixel');if(cfgPx)cfgPx.value=PIXEL_ID;
  const cfgWo=$('cfgWompi');if(cfgWo)cfgWo.value=WOMPI_PK;
  const cfgCl=$('cfgClarity');if(cfgCl)cfgCl.value=CLARITY_ID;
  _zonasDraft=null;renderEnvioAdmin();   // re-abrir el panel muestra las zonas GUARDADAS (no un draft viejo)
  checkStorageQuota();
  $('apanel').classList.add('on');lockScroll();
  setAdminSection('inicio');
}

async function _startAdminSession(pin){
  try{
    const r=await fetch('/api/admin-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});
    ADMIN_OK=!!r.ok;
    return ADMIN_OK;
  }catch(e){ADMIN_OK=false;return false;}
}

async function _openAdminReal(){
  // Si la sesión del servidor sigue viva (8h deslizantes desde la última actividad),
  // entrar DIRECTO sin pedir PIN — refrescar o salir y volver ya no obliga a reloguear.
  try{
    const r=await fetch('/api/admin-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check'})});
    if(r.ok){ADMIN_OK=true;_showAdmin();return;}
  }catch(e){}
  const input=prompt('PIN de administrador:');
  if(input===null)return;
  const ok=await _startAdminSession(input);
  if(!ok){alert('PIN incorrecto o sesión no disponible.');return;}
  _showAdmin();
}

async function logoutAdmin(){
  await fetch('/api/admin-setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout'})}).catch(()=>{});
  ADMIN_OK=false;
  closeAdmin();
  // En la app instalada (kiosko): nunca caer a la tienda → splash + re-pedir PIN.
  if((window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone){
    if(window._ssSplash)window._ssSplash(true);
    if(window._ssWatchPanel)window._ssWatchPanel();
    setTimeout(()=>openAdmin(),50);
  }
}

function closeAdmin(){$('apanel').classList.remove('on');unlockScroll();}

async function toggleBanner(on){bannerOn=on;$('banner').classList.toggle('off',!on);await adminWrite('upsert_settings',{data:{key:'banner_on',value:String(on)}});}

async function toggleGlobal(on){promoG=on;renderGrid();renderAdmin();await adminWrite('upsert_settings',{data:{key:'promo_global',value:String(on)}});}

async function toggleWelcome(on){WELCOME_ON=on;await adminWrite('upsert_settings',{data:{key:'welcome_popup',value:String(on)}});}

/* ── ADMIN "Shopify-lite": navegación por secciones (sidebar) ── */
let avSec='inicio';

function setAdminSection(name){
  avSec=name;
  document.querySelectorAll('#avMain [data-sec]').forEach(el=>{
    el.style.display=el.dataset.sec===name?(el.dataset.disp||'block'):'none';
  });
  document.querySelectorAll('#avSide .av-nav').forEach(b=>b.classList.toggle('on',b.dataset.nav===name));
  const t=$('avTitle');if(t)t.textContent=AV_TITLES[name]||name;
  toggleAvSide(false);
  const m=$('avMain');if(m)m.scrollTop=0;
  if(name==='inicio'){renderStatsTab();loadOrders().then(()=>{if(avSec==='inicio')renderStatsTab();});}
  if(name==='productos')renderAdmin();
  if(name==='ofertas'){renderLiqAdmin();loadDescuentos();}   // descuentos: se cargan al entrar a Ofertas (requiere sesión admin)
  if(name==='banners'){renderHeroAdmin();renderFeaturedAdmin();renderColAdmin();}
  if(name==='testimonios')renderTestiAdmin();
  if(name==='pedidos'){renderPedidos();loadOrders().then(()=>{if(avSec==='pedidos')renderPedidos();});}
  if(name==='clientes'){renderClientes();loadOrders().then(()=>{if(avSec==='clientes')renderClientes();});}
  if(name==='leads'){renderLeadsTab();loadOrders().then(()=>{if(avSec==='leads')renderLeadsTab();});}
  if(name==='suscriptores'){renderSubsTab();loadSubscribers().then(()=>{if(avSec==='suscriptores')renderSubsTab();});loadOrders().then(()=>{if(avSec==='suscriptores')renderSubsTab();});}
}

/* ── BÚSQUEDA GLOBAL (estilo Shopify): productos + pedidos + clientes, todo en memoria ── */
function buscarGlobal(q){
  const box=$('avSearchRes');if(!box)return;
  q=(q||'').trim().toLowerCase();
  if(q.length<2){box.classList.remove('on');box.innerHTML='';return;}
  const out=[];
  // Productos (catálogo + ofertas): por modelo, marca o #id
  const pr=[...prods.map(p=>({...p,_t:'cat'})),...liqs.map(p=>({...p,_t:'liq'}))].filter(p=>
    (p.modelo||'').toLowerCase().includes(q)
    ||(BRAND_LABELS[p.brand]||'').toLowerCase().includes(q)
    ||String(p.id)===q.replace('#','')
  ).slice(0,5);
  if(pr.length)out.push(`<div class="avs-h">📦 Productos</div>`+pr.map(p=>
    `<div class="avs-item" onclick="irProducto(${p.id},'${p._t}')"><img src="${escHtml(p.img||'')}" alt="" onerror="this.style.visibility='hidden'"><span>${escHtml(p.modelo||((BRAND_LABELS[p.brand]||'Par')+' '+(p._t==='liq'?'Oferta':(genLabel(p.g)))))} · <b>#${p.id}</b> · ${fmt(p.price)}${p.sold?' · <span style="color:var(--red)">agotado</span>':''}</span></div>`).join(''));
  // Pedidos: por nombre, teléfono, ciudad o referencia
  const stBadge=o=>o.status==='venta'?'✓ venta':o.status==='no_venta'?'✕ no venta':o.status==='abandoned'?'🛒 abandonó':'⏳ pendiente';
  const pe=orders.filter(o=>
    String(o.nombre||'').toLowerCase().includes(q)||String(o.tel||'').includes(q)
    ||String(o.ciudad||'').toLowerCase().includes(q)||String(o.reference||'').toLowerCase().includes(q)
  ).slice(0,5);
  if(pe.length)out.push(`<div class="avs-h">🧾 Pedidos</div>`+pe.map(o=>
    `<div class="avs-item" onclick="irPedido(${o.id})"><span><b>${escHtml(o.nombre||'Sin nombre')}</b> · ${fmt(o.total||0)} · ${stBadge(o)}${o.fecha?` · ${new Date(o.fecha).toLocaleDateString('es-CO',{day:'2-digit',month:'short'})}`:''}</span></div>`).join(''));
  // Clientes: por nombre, teléfono o ciudad
  const cl=buildClientes().filter(c=>
    c.nombre.toLowerCase().includes(q)||c.tel.includes(q)||c.ciudad.toLowerCase().includes(q)
  ).slice(0,5);
  if(cl.length)out.push(`<div class="avs-h">👥 Clientes</div>`+cl.map(c=>
    `<div class="avs-item" onclick="irCliente('${c.tel}')"><span><b>${escHtml(c.nombre||'Sin nombre')}</b> · ${c.tel} · ${c.pedidos.length} pedido${c.pedidos.length===1?'':'s'}${c.total?` · ${fmt(c.total)}`:''}</span></div>`).join(''));
  box.innerHTML=out.length?out.join(''):`<div style="padding:14px;font-size:12px;color:var(--ink3);text-align:center">Sin resultados para "${escHtml(q)}"</div>`;
  box.classList.add('on');
}

function cerrarBusqueda(){const b=$('avSearchRes');if(b){b.classList.remove('on');b.innerHTML='';}}

function irProducto(id,t){
  cerrarBusqueda();
  setAdminSection(t==='liq'?'ofertas':'productos');
  setTimeout(()=>{
    const btn=$('galbtn'+(t==='liq'?'liq':'cat')+id);
    const row=btn?btn.closest('.arow'):null;
    if(row){row.scrollIntoView({block:'center'});row.style.transition='background .3s';row.style.background='#fff3cd';setTimeout(()=>row.style.background='',1800);}
  },400);
}

// "Focus pendiente": la sección se re-renderiza al refrescar pedidos desde la BD (~1s después),
// así que el detalle se reabre en CADA render mientras el focus esté vivo (2.5s).
function irPedido(id){
  cerrarBusqueda();
  window._pedFocus=id;
  setTimeout(()=>{window._pedFocus=null;},2500);
  setAdminSection('pedidos');
}

function irCliente(tel){
  cerrarBusqueda();
  window._cliFocus=tel;
  setTimeout(()=>{window._cliFocus=null;},2500);
  setAdminSection('clientes');
}

function toggleAvSide(force){
  const s=$('avSide'),sc=$('avScrim');
  const abrir=typeof force==='boolean'?force:!(s&&s.classList.contains('open'));
  if(s)s.classList.toggle('open',abrir);
  if(sc)sc.classList.toggle('on',abrir);
}

/* ── PEDIDOS: lista completa con buscador ── */
let pedidosQ='';

function renderPedidos(){
  const el=$('panPedidos');if(!el)return;
  if(!el.dataset.built){
    el.dataset.built='1';
    el.innerHTML=`<div style="padding:12px 14px 8px;flex-shrink:0">
      <input type="search" placeholder="Buscar por nombre, teléfono, ciudad o referencia…" value="${escHtml(pedidosQ)}"
        oninput="pedidosQ=this.value;clearTimeout(window._pedT);window._pedT=setTimeout(renderPedidosList,200)"
        style="width:100%;padding:10px 13px;background:var(--white);border:1.5px solid var(--line);border-radius:10px;font-family:var(--font);font-size:16px;color:var(--ink);outline:none">
    </div>
    <div id="pedList" style="overflow-y:auto;flex:1;min-height:0;padding:0 14px 24px"></div>`;
  }
  renderPedidosList();
}

/* ── Agrupación temporal (Pedidos y Leads): Día / Semana / Mes, en hora Colombia ──
   Todo en memoria sobre `orders`; los encabezados muestran cuántos pedidos y cuánta plata
   hay en cada día/semana/mes para encontrar rápido "los 4 del 6 de junio". */
function _dKey(o){if(!o.fecha)return'';const d=new Date(o.fecha);return isNaN(d)?'':d.toLocaleDateString('en-CA',{timeZone:'America/Bogota'});}

function _hoyKey(off){return new Date(Date.now()-(off||0)*86400000).toLocaleDateString('en-CA',{timeZone:'America/Bogota'});}

function _semKey(k){const [y,m,d]=k.split('-').map(Number);const t=Date.UTC(y,m-1,d);const dow=new Date(t).getUTCDay();return new Date(t-((dow+6)%7)*86400000).toISOString().slice(0,10);}

function _dLabel(k){ // 'Hoy' / 'Ayer' / 'viernes, 6 jun' (+año si no es el actual)
  if(k===_hoyKey(0))return 'Hoy';
  if(k===_hoyKey(1))return 'Ayer';
  const [y,m,d]=k.split('-').map(Number);
  const s=new Date(Date.UTC(y,m-1,d)).toLocaleDateString('es-CO',{weekday:'long',day:'numeric',month:'short',timeZone:'UTC'});
  const anio=y!==new Date().getFullYear()?` ${y}`:'';
  return s.charAt(0).toUpperCase()+s.slice(1)+anio;
}

function _rangoSem(lun){ // '2 – 8 jun' del lunes dado
  const [y,m,d]=lun.split('-').map(Number);const t=Date.UTC(y,m-1,d);
  const f=ts=>new Date(ts).toLocaleDateString('es-CO',{day:'numeric',month:'short',timeZone:'UTC'});
  return `${f(t)} – ${f(t+6*86400000)}`;
}

function _gLabel(key,modo){
  if(!key)return 'Sin fecha';
  if(modo==='dia')return _dLabel(key);
  if(modo==='sem'){
    if(key===_semKey(_hoyKey(0)))return `Esta semana (${_rangoSem(key)})`;
    if(key===_semKey(_hoyKey(7)))return `Semana pasada (${_rangoSem(key)})`;
    return `Semana del ${_rangoSem(key)}`;
  }
  const [y,m]=key.split('-').map(Number);
  const s=new Date(Date.UTC(y,m-1,1)).toLocaleDateString('es-CO',{month:'long',timeZone:'UTC'});
  return s.charAt(0).toUpperCase()+s.slice(1)+' '+y;
}

function _renderGrupos(lista,modo,renderCard,unidad,hdrBg){
  const sorted=[...lista].sort((a,b)=>(new Date(b.fecha).getTime()||0)-(new Date(a.fecha).getTime()||0));
  const kOf=o=>{const k=_dKey(o);return !k?'':modo==='sem'?_semKey(k):modo==='mes'?k.slice(0,7):k;};
  let html='',curKey=null,buf=[],n=0,suma=0;
  const flush=()=>{ if(!n)return;
    html+=`<div style="position:sticky;top:0;z-index:2;background:${hdrBg};padding:10px 2px 6px;display:flex;justify-content:space-between;align-items:baseline;gap:8px">
      <span style="font-size:11.5px;font-weight:800;color:var(--ink)">📅 ${_gLabel(curKey,modo)}</span>
      <span style="font-size:10.5px;font-weight:700;color:var(--ink3);white-space:nowrap">${n} ${unidad}${n===1?'':'s'} · ${fmt(suma)}</span>
    </div>`+buf.join('');
    buf=[];n=0;suma=0;
  };
  sorted.forEach(o=>{const k=kOf(o);if(k!==curKey){flush();curKey=k;}buf.push(renderCard(o));n++;suma+=(o.total||0);});
  flush();
  return html;
}

function _vistaChips(cur,fnName){
  const b=(v,t)=>`<button onclick="${fnName}('${v}')" style="padding:5px 13px;border:1px solid ${cur===v?'var(--ink)':'var(--line)'};border-radius:14px;background:${cur===v?'var(--ink)':'var(--white)'};color:${cur===v?'#fff':'var(--ink2)'};font-family:var(--font);font-size:10.5px;font-weight:700;cursor:pointer">${t}</button>`;
  return `<div style="display:flex;gap:5px;margin:0 0 8px">${b('dia','📅 Día')}${b('sem','📆 Semana')}${b('mes','🗓 Mes')}</div>`;
}

let pedVista='dia';

function setPedVista(v){pedVista=v;renderPedidosList();}

/* Filtro por estado de envío en Pedidos (solo mira VENTAS: los demás no se despachan).
   null = sin filtro; tocar el chip activo lo apaga (toggle). */
let pedEnvioF=null;

function setPedEnvioF(v){pedEnvioF=pedEnvioF===v?null:v;renderPedidosList();}

// Navegar desde una tarea del Inicio a Pedidos con el filtro de envío puesto (como avGo con leadFilter).
function avGoEnvio(f){pedEnvioF=f;setAdminSection('pedidos');}

function renderPedidosList(){
  const box=$('pedList');if(!box)return;
  const pagoLabels={contra_entrega:'Contra entrega',pago_anticipado:'Pago anticipado',wompi:'Wompi',bold:'Bold',credito:'Crédito (Addi/Sistecrédito)',nequi:'Nequi',bancolombia:'Bancolombia',addi:'Addi',sistecredito:'Sistecrédito'};
  const badge=o=>o.status==='venta'?`<span style="background:var(--green);color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px">✓ VENTA</span>`
    :o.status==='no_venta'?`<span style="background:#E8200A;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px">✕ NO VENTA</span>`
    :o.status==='abandoned'?`<span style="background:#8A6D00;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px">🛒 ABANDONÓ</span>`
    :`<span style="background:#F2A900;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px">⏳ PENDIENTE</span>`;
  const itemsTxt=o=>Array.isArray(o.items)?o.items.map(it=>`${escHtml(it.label||'?')}${it.id?' #'+parseInt(it.id):''}${it.qty?` x${parseInt(it.qty)||1}`:''}`).join(', '):'';
  // Badge de envío en la tarjeta (solo ventas): de un vistazo se ve qué está sin despachar,
  // en la calle, cobrado o devuelto — sin abrir el detalle.
  const envBadge=o=>{
    if(o.status!=='venta')return '';
    const v=envioEfectivo(o);
    return `<span style="background:${ENVIO_COLS[v]};color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px">${ENVIO_LABELS[v]}</span>`;
  };
  const q=pedidosQ.trim().toLowerCase();
  const lista0=orders.filter(o=>!q
    ||String(o.nombre||'').toLowerCase().includes(q)
    ||String(o.tel||'').includes(q)
    ||String(o.ciudad||'').toLowerCase().includes(q)
    ||String(o.reference||'').toLowerCase().includes(q));
  // El filtro de envío se aplica DESPUÉS del buscador: ambos se combinan.
  const lista=pedEnvioF?lista0.filter(o=>o.status==='venta'&&envioEfectivo(o)===pedEnvioF):lista0;
  // Chips del filtro con contador por estado (sobre TODAS las ventas, sin el buscador):
  // el conteo de 'devuelto' es la métrica que dice si el contra entrega es rentable.
  const ventas=orders.filter(o=>o.status==='venta');
  const envChips=`<div style="display:flex;gap:5px;flex-wrap:wrap;margin:0 0 8px">${['por_despachar','enviado','entregado','devuelto'].map(v=>{
    const on=pedEnvioF===v,n=ventas.filter(o=>envioEfectivo(o)===v).length;
    return `<button onclick="setPedEnvioF('${v}')" title="Solo ventas · toca de nuevo para quitar el filtro" style="padding:5px 11px;border:1px solid ${on?ENVIO_COLS[v]:'var(--line)'};border-radius:14px;background:${on?ENVIO_COLS[v]:'var(--white)'};color:${on?'#fff':'var(--ink2)'};font-family:var(--font);font-size:10.5px;font-weight:700;cursor:pointer">${ENVIO_LABELS[v]} ${n}</button>`;
  }).join('')}</div>`;
  if(!orders.length){box.innerHTML=`<div style="padding:32px 8px;text-align:center;color:var(--ink3);font-size:13px;line-height:1.7">🧾 Aún no hay pedidos.</div>`;return;}
  const cardPed=o=>{
    const camp=o.utm&&o.utm.utm_campaign?escHtml(String(o.utm.utm_campaign).slice(0,28)):'';
    const srcA=!camp&&o.utm&&o.utm.src_app?escHtml(srcAppLabel(o.utm.src_app)):'';
    return `
    <div style="background:var(--white);border:1px solid var(--line);border-radius:12px;margin-bottom:8px;overflow:hidden">
      <div class="ped-main" onclick="togPedDetail(${o.id})" style="padding:12px 14px;cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
          <span style="font-size:13.5px;font-weight:700">${escHtml(o.nombre||'Sin nombre')}</span><span style="display:flex;gap:4px;align-items:center">${badge(o)}${envBadge(o)}</span>
        </div>
        <div style="font-size:12px;color:var(--ink2);line-height:1.6">
          ${o.tel?`📱 <a href="https://wa.me/57${String(o.tel).replace(/\D/g,'').slice(-10)}" target="_blank" onclick="event.stopPropagation()" style="color:var(--blue);text-decoration:none">${escHtml(o.tel)}</a> · `:''}${o.ciudad?`📍 ${escHtml(o.ciudad)}`:''}${camp?` · 📣 ${camp}`:srcA?` · ${srcA}`:''}${o.combo?` · <b style="color:#b3541e">🏆 ${escHtml(o.combo)}</b>`:''}<br>
          ${itemsTxt(o)?`👟 ${itemsTxt(o)}<br>`:''}
          💰 <b>${fmt(o.total||0)}</b>${o.pago?` · ${escHtml(pagoLabels[o.pago]||o.pago)}`:''}
          ${o.fecha?` · <span style="color:var(--ink3);font-size:10px">${new Date(o.fecha).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>`:''}
          <span style="float:right;color:var(--blue);font-size:11px;font-weight:700" id="pedChev${o.id}">Ver detalle ▾</span>
        </div>
      </div>
      <div id="pedDet${o.id}" style="display:none;border-top:1px solid var(--line);background:var(--bg);padding:12px 14px;font-size:12px;color:var(--ink2);line-height:1.7"></div>
    </div>`;};
  box.innerHTML=`<div style="font-size:11px;color:var(--ink3);font-weight:600;padding:2px 2px 8px">${lista.length} pedido${lista.length===1?'':'s'}${(q||pedEnvioF)?' (filtro activo)':''}</div>`
    +_vistaChips(pedVista,'setPedVista')
    +envChips
    +(lista.length?_renderGrupos(lista,pedVista,cardPed,'pedido','var(--bg)'):`<div style="padding:24px 8px;text-align:center;color:var(--ink3);font-size:12.5px">${pedEnvioF?`Sin ventas en "${ENVIO_LABELS[pedEnvioF]}"${q?` con "${escHtml(pedidosQ)}"`:''}.`:`Sin resultados para "${escHtml(pedidosQ)}"`}</div>`);
  // Focus pendiente desde la búsqueda global: abrir el detalle y centrar (sobrevive al refresh)
  if(window._pedFocus){
    const fid=window._pedFocus;
    const d=$('pedDet'+fid);
    if(d){if(d.style.display==='none')togPedDetail(fid);d.parentElement.scrollIntoView({block:'center'});}
  }
}

/* ── CLIENTES v1: agrupa los pedidos por teléfono (sin tabla nueva) ── */
let clientesQ='';

function _telKey(t){return String(t||'').replace(/\D/g,'').slice(-10);}

function _cedKey(o){const c=String(o.cedula||'').replace(/\D/g,'');return c.length>=4?c:'';}

function buildClientes(){
  const map={};
  orders.forEach(o=>{
    const k=_telKey(o.tel);if(!k)return;
    if(!map[k])map[k]={tel:k,nombre:'',ciudad:'',pedidos:[],ventas:0,total:0,ultima:0,ceds:{}};
    const c=map[k];
    c.pedidos.push(o);
    const ck=_cedKey(o);if(ck)c.ceds[ck]=1;
    const ts=new Date(o.fecha).getTime()||0;
    if(ts>=c.ultima){c.ultima=ts;c.nombre=o.nombre||c.nombre;c.ciudad=o.ciudad||c.ciudad;}
    if(o.status==='venta'){c.ventas++;c.total+=(o.subtotal!=null?o.subtotal:(o.total||0));}
  });
  // 2ª pasada: el MISMO cliente con OTRO teléfono pero la MISMA cédula = un solo perfil.
  // Se queda como "principal" el perfil de la compra más reciente; los teléfonos extra van a c.tels.
  const porCed={},final=[];
  Object.values(map).sort((a,b)=>b.ultima-a.ultima).forEach(c=>{
    c.tels=[c.tel];
    const dueno=Object.keys(c.ceds).map(k=>porCed[k]).find(Boolean);
    if(dueno){
      dueno.pedidos.push(...c.pedidos);dueno.ventas+=c.ventas;dueno.total+=c.total;
      if(!dueno.tels.includes(c.tel))dueno.tels.push(c.tel);
      Object.keys(c.ceds).forEach(k=>{porCed[k]=dueno;});
    }else{
      Object.keys(c.ceds).forEach(k=>{porCed[k]=c;});
      final.push(c);
    }
  });
  return final.sort((a,b)=>b.ultima-a.ultima);
}

function renderClientes(){
  const el=$('panClientes');if(!el)return;
  if(!el.dataset.built){
    el.dataset.built='1';
    el.innerHTML=`<div style="padding:12px 14px 8px;flex-shrink:0">
      <input type="search" placeholder="Buscar cliente por nombre, teléfono o ciudad…" value="${escHtml(clientesQ)}"
        oninput="clientesQ=this.value;clearTimeout(window._cliT);window._cliT=setTimeout(renderClientesList,200)"
        style="width:100%;padding:10px 13px;background:var(--white);border:1.5px solid var(--line);border-radius:10px;font-family:var(--font);font-size:16px;color:var(--ink);outline:none">
    </div>
    <div id="cliList" style="overflow-y:auto;flex:1;min-height:0;padding:0 14px 24px"></div>`;
  }
  renderClientesList();
}

function renderClientesList(){
  const box=$('cliList');if(!box)return;
  const clientes=buildClientes();
  const q=clientesQ.trim().toLowerCase();
  const lista=clientes.filter(c=>!q||c.nombre.toLowerCase().includes(q)||(c.tels||[c.tel]).some(t=>t.includes(q))||c.ciudad.toLowerCase().includes(q));
  if(!clientes.length){box.innerHTML=`<div style="padding:32px 8px;text-align:center;color:var(--ink3);font-size:13px;line-height:1.7">👥 Aún no hay clientes.<br>Aparecen cuando llegan pedidos con teléfono.</div>`;return;}
  box.innerHTML=`<div style="font-size:11px;color:var(--ink3);font-weight:600;padding:2px 2px 8px">${lista.length} cliente${lista.length===1?'':'s'}${q?' (filtro activo)':''}</div>`
    +(lista.length?lista.map(c=>`
    <div style="background:var(--white);border:1px solid var(--line);border-radius:12px;margin-bottom:8px;overflow:hidden">
      <div onclick="togCliDetail('${c.tel}')" style="padding:12px 14px;cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:13.5px;font-weight:700">${escHtml(c.nombre||'Sin nombre')}</span>
          ${c.ventas?`<span style="background:var(--green);color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px">${c.ventas} COMPRA${c.ventas===1?'':'S'}</span>`:`<span style="background:var(--bg);color:var(--ink3);font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px;border:1px solid var(--line)">SIN COMPRAS</span>`}
        </div>
        <div style="font-size:12px;color:var(--ink2);line-height:1.6">
          📱 <a href="https://wa.me/57${c.tel}" target="_blank" onclick="event.stopPropagation()" style="color:var(--blue);text-decoration:none">${escHtml(c.tel)}</a>
          ${c.ciudad?` · 📍 ${escHtml(c.ciudad)}`:''} · 🧾 ${c.pedidos.length} pedido${c.pedidos.length===1?'':'s'}
          ${c.total?` · 💰 <b>${fmt(c.total)}</b>`:''}
          <span style="float:right;color:var(--blue);font-size:11px;font-weight:700" id="cliChev${c.tel}">Ver perfil ▾</span>
        </div>
      </div>
      <div id="cliDet${c.tel}" style="display:none;border-top:1px solid var(--line);background:var(--bg);padding:10px 14px"></div>
    </div>`).join(''):`<div style="padding:24px 8px;text-align:center;color:var(--ink3);font-size:12.5px">Sin resultados para "${escHtml(clientesQ)}"</div>`);
  // Focus pendiente desde la búsqueda global (sobrevive al refresh de pedidos)
  if(window._cliFocus){
    const ft=window._cliFocus;
    const d=$('cliDet'+ft);
    if(d){if(d.style.display==='none')togCliDetail(ft);d.parentElement.scrollIntoView({block:'center'});}
  }
}

function togCliDetail(tel){
  const det=$('cliDet'+tel),chev=$('cliChev'+tel);if(!det)return;
  const abierto=det.style.display!=='none';
  if(abierto){det.style.display='none';if(chev)chev.textContent='Ver perfil ▾';return;}
  const c=buildClientes().find(x=>x.tel===tel);if(!c)return;
  const badge=o=>o.status==='venta'?'✓ Venta':o.status==='no_venta'?'✕ No venta':o.status==='abandoned'?'🛒 Abandonó':'⏳ Pendiente';
  const tels2=(c.tels||[]).slice(1);
  det.innerHTML=`<div style="font-size:11px;color:var(--ink3);font-weight:600;padding-bottom:6px;border-bottom:1px solid var(--line)">🧾 ${c.pedidos.length} pedido${c.pedidos.length===1?'':'s'} · ✓ ${c.ventas} venta${c.ventas===1?'':'s'}${tels2.length?` · 📱 también: ${tels2.map(escHtml).join(', ')}`:''}</div>`
    +c.pedidos.sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)).map(o=>`
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line);font-size:11.5px;color:var(--ink2)">
      <span style="flex:0 0 auto;color:var(--ink3)">${o.fecha?new Date(o.fecha).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'2-digit'}):''}</span>
      <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Array.isArray(o.items)?o.items.map(it=>escHtml(it.label||'?')).join(', '):''}</span>
      <b style="flex:0 0 auto">${fmt(o.total||0)}</b>
      <span style="flex:0 0 auto;font-weight:700;font-size:10px">${badge(o)}</span>
    </div>`).join('')
    +`<a href="https://wa.me/57${c.tel}" target="_blank" style="display:block;text-align:center;margin-top:10px;background:var(--wa);color:#fff;text-decoration:none;padding:10px;border-radius:10px;font-size:12.5px;font-weight:700">💬 Escribirle por WhatsApp</a>`;
  det.style.display='block';
  if(chev)chev.textContent='Ocultar ▴';
}

/* ── FOTOS DEL PEDIDO ── Ver QUÉ se vendió, no solo leerlo. El detalle mostraba los productos
   como texto ("Adidas #29 x1"), inútil para reconocer un par de un vistazo o para responderle
   al cliente por WhatsApp. Reusa productosDePedido(), que ya cruza los items con el catálogo.
   Cada foto abre la ficha del producto; el link de abajo abre el pedido COMPLETO con fotos
   (la misma vista ?pedido= que recibe el vendedor por WhatsApp), útil para reenviársela. */
function fotosPedido(o){
  const prods=productosDePedido(o);
  if(!prods.length)return '';
  const items=Array.isArray(o.items)?o.items:[];
  const cards=prods.map(({p,type,it})=>{
    const qty=parseInt(it.qty)||1;
    const nom=escHtml(it.label||p.modelo||('#'+p.id));
    return `<div onclick="irProducto(${p.id},'${type}')" title="Ver en Productos" style="flex:0 0 auto;width:74px;cursor:pointer">
      <div style="position:relative">
        ${p.img?`<img src="${escHtml(p.img)}" alt="" loading="lazy" style="width:74px;height:74px;object-fit:cover;border-radius:9px;border:1px solid var(--line);display:block">`
              :`<div style="width:74px;height:74px;border-radius:9px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-size:22px;background:var(--bg)">👟</div>`}
        ${qty>1?`<div style="position:absolute;top:-5px;right:-5px;background:var(--ink);color:#fff;font-size:10px;font-weight:800;min-width:19px;height:19px;border-radius:10px;display:flex;align-items:center;justify-content:center;padding:0 4px">x${qty}</div>`:''}
        ${p.sold?`<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(232,32,10,.9);color:#fff;font-size:8px;font-weight:800;text-align:center;padding:2px 0;border-radius:0 0 8px 8px">AGOTADO</div>`:''}
      </div>
      <div style="font-size:9.5px;font-weight:700;color:var(--ink2);line-height:1.2;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nom}</div>
      <div style="font-size:9px;color:var(--ink3)">#${p.id}${it.talla?' · T'+escHtml(String(it.talla)):''}</div>
    </div>`;
  }).join('');
  // Mismo formato que arma el carrito para WhatsApp: 29x1t40,L5x2 (t = talla, opcional)
  const code=items.filter(it=>it.id!=null).map(it=>{
    const t=String(it.talla==null?'':it.talla).replace(/[^\w.]/g,'').slice(0,6);
    return (it.type==='liq'?'L':'')+parseInt(it.id)+'x'+(parseInt(it.qty)||1)+(t?'t'+t:'');
  }).join(',');
  return `<div style="margin-bottom:10px">
    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch">${cards}</div>
    ${code?`<a href="https://strangesneakers.com/?pedido=${code}" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;font-size:10.5px;font-weight:700;color:var(--blue);text-decoration:none">📸 Abrir el pedido con fotos ↗</a>`:''}
  </div>`;
}

/* Detalle profundo del pedido: fotos, dirección, montos separados, campaña/atribución, contexto */
function togPedDetail(id){
  const det=$('pedDet'+id),chev=$('pedChev'+id);if(!det)return;
  const abierto=det.style.display!=='none';
  if(abierto){det.style.display='none';if(chev)chev.textContent='Ver detalle ▾';return;}
  const o=orders.find(x=>x.id===id);if(!o)return;
  const u=o.utm||{};
  const corto=v=>v?escHtml(String(v).length>26?String(v).slice(0,26)+'…':String(v)):'';
  const fila=(l,v)=>v?`<div style="display:flex;gap:8px"><span style="flex:0 0 92px;font-weight:700;color:var(--ink3);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;padding-top:1px">${l}</span><span style="flex:1;word-break:break-word">${v}</span></div>`:'';
  const utmLinea=['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].map(k=>u[k]?`<b>${k.replace('utm_','')}:</b> ${escHtml(u[k])}`:'').filter(Boolean).join(' · ');
  det.innerHTML=
    fotosPedido(o)
    +fila('Dirección',[o.direccion,o.barrio,o.ciudad].filter(Boolean).map(escHtml).join(', '))
    +fila('Cédula',o.cedula?escHtml(o.cedula):'')
    +fila('Montos',`Subtotal <b>${fmt(o.subtotal!=null?o.subtotal:o.total)}</b>${o.envio?` · Envío <b>${fmt(o.envio)}</b>`:''} · Total <b>${fmt(o.total||0)}</b>`)
    +fila('Referencia',o.reference?escHtml(o.reference):'')
    +fila('Campaña',utmLinea||`<span style="color:var(--ink3)">sin UTMs${u.src_app?' · abierto desde <b>'+escHtml(srcAppLabel(u.src_app))+'</b>':' (directo / orgánico)'}</span>`)
    +fila('Anuncio',[u.campaign_id?'campaña: '+escHtml(u.campaign_id):'',u.adset_id?'conjunto: '+escHtml(u.adset_id):'',u.ad_id?'anuncio: '+escHtml(u.ad_id):''].filter(Boolean).join(' · '))
    +fila('Meta',[u.fbclid?'fbclid: '+corto(u.fbclid):'',u.fbp?'fbp: '+corto(u.fbp):'',u.fbc?'fbc: '+corto(u.fbc):''].filter(Boolean).join(' · '))
    +fila('Contexto',[u.src_app?'Origen: '+escHtml(srcAppLabel(u.src_app)):'',u.landing?'Landing: '+escHtml(u.landing):'',u.device?'Dispositivo: '+escHtml(u.device):''].filter(Boolean).join(' · '))
    +fila('Fecha',o.fecha?new Date(o.fecha).toLocaleString('es-CO',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}):'')
    +envioBloque(o)
    +`<div style="margin-top:10px"><button id="tgBtn${o.id}" onclick="reenviarTelegram(${o.id},this)" style="border:none;cursor:pointer;background:#229ED9;color:#fff;padding:8px 13px;border-radius:8px;font-size:11.5px;font-weight:700">📲 Reenviar aviso a Telegram</button></div>`;
  det.style.display='block';
  if(chev)chev.textContent='Ocultar ▴';
}

/* Link de pago Addi desde el panel, en vez del portal (Cobrar → Paylink). Allá la venta nace
   fuera del sistema: no queda en la base, no sale en el panel y Meta nunca recibe la compra.
   Aquí el pedido nace con referencia STR- y el webhook de Addi lo confirma solo.
   El formato de productos es el MISMO del link ?pedido= (29x1t40): id x cantidad t talla. */
function parseItemsAddi(txt){
  const out=[];
  String(txt||'').split(',').map(s=>s.trim()).filter(Boolean).forEach(seg=>{
    const m=/^(L?)(\d+)x(\d+)(?:t([\w.]{1,6}))?$/i.exec(seg);
    if(!m)throw new Error('No entiendo "'+seg+'". Usa por ejemplo 29x1t40');
    const qty=parseInt(m[3]);
    // El servidor convertiría un 0 en 1 sin avisar (normalizeItems); mejor fallar de frente.
    if(!(qty>=1))throw new Error('La cantidad de "'+seg+'" debe ser al menos 1');
    out.push({type:m[1]?'liq':'cat',id:parseInt(m[2]),qty,talla:m[4]||null});
  });
  if(!out.length)throw new Error('Agrega al menos un producto');
  return out;
}

async function crearLinkAddi(btn){
  const out=$('alOut'); const v=id=>($(id)?$(id).value.trim():'');
  const pinta=(html,color)=>{if(out){out.innerHTML=html;out.style.color=color||'var(--ink2)';}};
  let items;
  try{ items=parseItemsAddi(v('alItems')); }catch(e){ pinta('⚠️ '+e.message,'#b91c1c'); return; }
  const faltan=[['alNombre','nombre'],['alCedula','cédula'],['alTel','celular'],['alEmail','correo'],['alDir','dirección'],['alCiudad','ciudad']]
    .filter(([id])=>!v(id)).map(([,n])=>n);
  if(faltan.length){ pinta('⚠️ Falta: '+faltan.join(', '),'#b91c1c'); return; }
  if(btn){btn.disabled=true;btn.textContent='Generando…';}
  pinta('Creando el pedido y pidiéndole el link a Addi…');
  try{
    const r=await adminWrite('crear_link_addi',{data:{
      nombre:v('alNombre'),cedula:v('alCedula'),tel:v('alTel'),email:v('alEmail'),
      direccion:v('alDir'),barrio:v('alBarrio'),ciudad:v('alCiudad'),items,
      test:!!window.__TEST__   // desde un equipo de pruebas NO ensucia métricas ni Meta
    }});
    const nombre=(v('alNombre').split(/\s+/)[0])||'';
    const msg=`¡Hola ${nombre}! 👋 Aquí está tu link para pagar a cuotas con Addi 💳\n\n${r.url}\n\nApenas Addi te apruebe, despachamos tu pedido 📦`;
    const wa=String(v('alTel')).replace(/\D/g,'').slice(-10);
    pinta(`<div style="padding:9px;background:#eaf6ee;border:1px solid #bfe3cc;border-radius:9px">
      <b style="color:#137a3a">✅ Link creado</b> · Pedido <b>${escHtml(r.reference)}</b> · Total <b>${fmt(r.total||0)}</b>
      <div style="margin-top:6px;word-break:break-all;font-size:10.5px"><a href="${escHtml(r.url)}" target="_blank" rel="noopener">${escHtml(r.url)}</a></div>
      ${wa.length===10?`<a href="https://wa.me/57${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;background:var(--wa);color:#fff;text-decoration:none;padding:8px 13px;border-radius:8px;font-size:11.5px;font-weight:700">💬 Enviárselo por WhatsApp</a>`:''}
      <div style="margin-top:7px;font-size:10px;color:var(--ink3)">Ya aparece en Pedidos como <b>pendiente</b>. Cuando Addi apruebe, se marca venta solo y te llega el aviso.</div>
    </div>`);
    ['alNombre','alCedula','alTel','alEmail','alDir','alBarrio','alCiudad','alItems'].forEach(id=>{if($(id))$(id).value='';});
    if(typeof loadOrders==='function')loadOrders();
  }catch(e){
    pinta('⚠️ '+(e.message||'No se pudo crear el link'),'#b91c1c');
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Generar link de pago';}
  }
}

/* Reenviar A MANO el aviso de esta venta a Telegram. El bot sigue avisando SOLO las ventas de
   pasarela de forma automática; este botón es para revisar el formato o recuperar un aviso que
   se perdió. Dice la verdad: si el bot no está configurado o Telegram rechaza, avisa que no salió. */
async function reenviarTelegram(id,btn){
  const txt='📲 Reenviar aviso a Telegram';
  if(btn){btn.disabled=true;btn.textContent='Enviando…';}
  try{
    const r=await adminWrite('reenviar_telegram',{id});
    if(btn)btn.textContent=r.enviado?'✅ Enviado — míralo en Telegram':'⚠️ No salió (revisa el bot)';
  }catch(e){
    if(btn)btn.textContent='⚠️ '+(e.message||'error');
  }finally{
    if(btn)setTimeout(()=>{btn.disabled=false;btn.textContent=txt;},5000);
  }
}

/* ── ENVÍO — bloques en el detalle del pedido ── */
/* Pipeline de entrega manual: el negocio vende CONTRA ENTREGA, así que "venta" no es plata
   hasta que el paquete llega (rechazo en puerta en Colombia: 10-25%). Estos estados se avanzan
   a mano y NO dependen de Coordinadora (dormida): hoy se despacha igual y hay que saber cuánta
   plata está en la calle. */
const ENVIO_LABELS={por_despachar:'📦 Por despachar',guia_generada:'🏷 Guía generada',enviado:'🚚 Enviado',entregado:'✅ Entregado',devuelto:'↩️ Devuelto'};

const ENVIO_COLS={por_despachar:'#B3791E',enviado:'#5D2D91',entregado:'#1BA94C',devuelto:'#E8200A'};

// Estado EFECTIVO de envío de una venta: null (ventas de antes del pipeline) y 'guia_generada'
// (legado de generar_guia: guía impresa pero el paquete aún no viaja) cuentan como
// 'por_despachar' — así ninguna venta vieja queda invisible para la tarea del Inicio.
function envioEfectivo(o){
  const e=o.estado_envio;
  return (!e||e==='guia_generada')?'por_despachar':e;
}

// Si ya hay guía: muestra guía + tracking + recaudo + botón para avisar al cliente.
// Si no: botón para generar la guía (recaudo = total si es contra-entrega, 0 si es prepago).
// En toda VENTA, además, el pipeline manual de entrega (antes de venta no hay nada que despachar).
function envioBloque(o){
  const pagoCOD=o.pago==='contra_entrega';
  let html='';
  if(o.guia){
    const wa=String(o.tel||'').replace(/\D/g,'').slice(-10);
    const nombre=(o.nombre||'').trim().split(/\s+/)[0]||'';
    const msg=`¡Hola ${nombre}! 👋 Tu pedido de ${STORE_NAME} ya va en camino 📦\nTransportadora: Coordinadora\nN° de guía: ${o.guia}\n${o.tracking_url?'Rastrea aquí: '+o.tracking_url:''}`;
    const waBtn=wa.length===10?`<a href="https://wa.me/57${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:7px;background:var(--wa);color:#fff;text-decoration:none;padding:7px 12px;border-radius:8px;font-size:11px;font-weight:700">💬 Avisar tracking al cliente</a>`:'';
    html=`<div style="margin-top:10px;padding:10px;background:#eaf6ee;border:1px solid #bfe3cc;border-radius:9px">
      <div style="font-weight:700;font-size:11px;color:#137a3a">📦 Envío — guía generada</div>
      <div style="margin-top:3px">Guía: <b>${escHtml(o.guia)}</b> · Coordinadora${o.recaudo?` · Recaudo <b>${fmt(o.recaudo)}</b>`:' · Prepago (sin recaudo)'}</div>
      ${o.tracking_url?`<div><a href="${escHtml(o.tracking_url)}" target="_blank" rel="noopener" style="color:var(--blue)">Ver rastreo ↗</a></div>`:''}
      ${waBtn}
    </div>`;
  }else{
    // El botón de generar guía está OCULTO: Coordinadora aún no tiene credenciales en Vercel
    // (COORDINADORA_WS_URL/USER/PASSWORD), así que hoy solo puede devolver error. Para reactivarlo
    // cuando llegue el manual del Web Service, cambia COORDINADORA_LISTA a true.
    const COORDINADORA_LISTA=false;
    if(COORDINADORA_LISTA)html=`<div style="margin-top:10px">
      <button onclick="generarGuiaPedido(${o.id},this)" style="border:none;cursor:pointer;background:#5D2D91;color:#fff;padding:8px 13px;border-radius:8px;font-size:11.5px;font-weight:700">📦 Generar guía Coordinadora ${pagoCOD?`(recaudo ${fmt(o.total||0)})`:'(prepago)'}</button>
    </div>`;
  }
  if(o.status==='venta')html+=envioPipeline(o);
  return html;
}

// Chips tipo SELECTOR, no ciclo como chipWa/chipTemp: el rechazo en puerta salta de 'enviado'
// a 'devuelto' SIN pasar por 'entregado', así que obligar a ciclar marcaría estados falsos.
// Cada chip fija su estado directo; el activo va coloreado.
function envioPipeline(o){
  const cur=envioEfectivo(o);
  const chips=['por_despachar','enviado','entregado','devuelto'].map(v=>{
    const on=cur===v;
    return `<button onclick="setEnvioEstado(${o.id},'${v}')" style="padding:6px 10px;border:1px solid ${on?ENVIO_COLS[v]:'var(--line)'};border-radius:14px;background:${on?ENVIO_COLS[v]:'var(--white)'};color:${on?'#fff':'var(--ink2)'};font-family:var(--font);font-size:10.5px;font-weight:700;cursor:pointer">${ENVIO_LABELS[v]}</button>`;
  }).join('');
  const f=ts=>ts?new Date(ts).toLocaleDateString('es-CO',{day:'2-digit',month:'short'}):'';
  const fechas=[o.despachado_at?`Despachado ${f(o.despachado_at)}`:'',o.entregado_at?`${cur==='devuelto'?'Devuelto':'Entregado'} ${f(o.entregado_at)}`:''].filter(Boolean).join(' · ');
  return `<div style="margin-top:10px;padding:10px;background:var(--white);border:1px solid var(--line);border-radius:9px">
    <div style="font-weight:700;font-size:11px;color:var(--ink2);margin-bottom:7px">🚚 Estado del envío${o.estado_envio==='guia_generada'?' <span style="font-weight:600;color:var(--ink3)">(guía generada, aún sin despachar)</span>':''}</div>
    <div style="display:flex;gap:5px;flex-wrap:wrap">${chips}</div>
    ${fechas?`<div style="font-size:10px;color:var(--ink3);margin-top:6px">${fechas}</div>`:''}
  </div>`;
}

// Guarda el estado de envío: espejo local optimista + rollback si el server falla (mismo patrón
// que updateOrderMeta), pero re-pintando PEDIDOS y reabriendo el detalle (el re-render lo cierra).
async function setEnvioEstado(id,estado){
  const o=orders.find(x=>x.id===id);if(!o)return;
  if(o.estado_envio===estado)return;   // ya está guardado así (tocar 'por_despachar' sobre null/guia_generada SÍ guarda: normaliza el legado)
  const prev={estado_envio:o.estado_envio,despachado_at:o.despachado_at,entregado_at:o.entregado_at};
  // Espejo de los sellos de fecha que pone el server (ver update_order_meta en api/admin.js):
  o.estado_envio=estado;
  if(estado==='enviado'){o.despachado_at=new Date().toISOString();o.entregado_at=null;}
  else if(estado==='entregado'||estado==='devuelto')o.entregado_at=new Date().toISOString();
  else{o.despachado_at=null;o.entregado_at=null;}
  _repintarPedido(id);
  try{await adminWrite('update_order_meta',{id,data:{estado_envio:estado}});}
  catch(e){Object.assign(o,prev);_repintarPedido(id);alert('No se pudo guardar: '+e.message);}
}

// Re-pinta la lista de pedidos y deja el detalle del pedido abierto (renderPedidosList lo cierra).
function _repintarPedido(id){
  renderPedidosList();
  const d=$('pedDet'+id);
  if(d&&d.style.display==='none')togPedDetail(id);
}

async function generarGuiaPedido(id,btn){
  try{
    if(btn){btn.disabled=true;btn.textContent='Generando…';}
    const r=await adminWrite('generar_guia',{id});
    const o=orders.find(x=>x.id===id);
    if(o){o.guia=r.guia;o.tracking_url=r.tracking_url;o.recaudo=r.recaudo;o.estado_envio='guia_generada';}
    const det=$('pedDet'+id);if(det){det.style.display='none';togPedDetail(id);}   // re-pinta con la guía
  }catch(e){
    const msg=e.message==='coordinadora_no_configurado'
      ?'Coordinadora aún no está configurada. Pon las credenciales en Vercel o activa COORDINADORA_SIMULACION=1 para probar.'
      :e.message==='coordinadora_pendiente_integracion'
      ?'La conexión con la API de Coordinadora está pendiente (Fase 3, falta el manual del Web Service).'
      :e.message;
    alert('No se pudo generar la guía:\n'+msg);
    if(btn){btn.disabled=false;btn.textContent='📦 Generar guía Coordinadora';}
  }
}

/* Badge de costo (privado, solo admin): verde con el monto si está puesto, rojo "Sin costo" si falta.
   Sirve para ver de un vistazo a qué zapato ya se le asignó costo y a cuál no. (c!=null permite costo 0) */
function costBadge(ptype,id){
  const c=costos[ptype+':'+id];
  return c!=null
    ? `<div class="arow-cost" style="font-size:10px;font-weight:700;color:var(--green);margin-top:2px">💰 Costo: ${fmt(c)}</div>`
    : `<div class="arow-cost" style="font-size:10px;font-weight:700;color:var(--red);margin-top:2px">⚠️ Sin costo</div>`;
}

function renderAdmin(){
  $('aTot').textContent=prods.length;
  $('aH').textContent=prods.filter(p=>p.g==='h').length;
  $('aM').textContent=prods.filter(p=>p.g==='m').length;
  {const u=$('aU');if(u)u.textContent=prods.filter(p=>p.g==='u').length;}
  $('aSold').textContent=[...prods,...liqs].filter(p=>p.sold).length;
  // Barra IA: los productos sin modelo salen al feed de Meta con título genérico DUPLICADO
  // (castiga los anuncios dinámicos). El lote solo PROPONE: cada nombre se aprueba a mano.
  const sinModelo=prods.filter(p=>!p.modelo).length+liqs.filter(p=>!p.modelo).length;
  const barIA=sinModelo?`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--white);border:1px solid var(--line);border-radius:10px;padding:9px 11px;margin-bottom:8px;font-size:11.5px;color:var(--ink2)">✨ <b>${sinModelo}</b> producto${sinModelo===1?'':'s'} sin modelo → títulos duplicados en el feed de Meta
    <button class="epbtn" id="btnSugTodos" onclick="sugerirModelosFaltantes()">✨ Sugerir modelos con IA</button></div>`:'';
  $('listCat').innerHTML=barIA+prods.map(p=>{
    const sp=p.promo||promoG;
    const m=p.img?`<img src="${escHtml(p.img||'')}" alt="">`:`<span style="font-size:20px">👟</span>`;
    return `<div class="arow">
      <div class="arow-img">${m}${p.sold?`<div class="arow-sov">Agot.</div>`:''}</div>
      <div><div class="arow-gen">${p.modelo?escHtml(p.modelo):(genLabel(p.g))}</div><div class="arow-st">${p.modelo?(genLabel(p.g)+' · '):''}${p.sold?'🔴 Agotado':'🟢 Disponible'}</div>${costBadge('cat',p.id)}</div>
      <div><div class="arow-price ${sp?'sale':''}">${fmt(p.price)}</div><button class="epbtn" onclick="startEP(${p.id},'cat')">Editar</button> <button class="epbtn" id="galbtncat${p.id}" onclick="togGal(${p.id},'cat')">📷 ${(p.imgs||[]).length}</button> <button class="epbtn" onclick="togTallas(${p.id},'cat')" title="Stock por talla">📏 ${tallasBadge(p)}</button> <button class="epbtn" onclick="togMeta(${p.id},'cat')" title="SEO y metacampos (público)">🏷 ${metaBadge(p)}</button>${p.modelo?'':` <button class="epbtn" onclick="sugerirModelo(${p.id},'cat',this)" title="La IA propone el modelo mirando la foto (tú apruebas antes de guardar)">✨ Modelo</button>`}</div>
      <button class="sold-btn ${p.sold?'on':''}" onclick="togSold(${p.id},'cat')">${p.sold?'✓ Agot.':'Agotado'}</button>
      <button class="adel" onclick="delProd(${p.id},'cat')">✕</button>
      <div class="ep-row" id="ep${p.id}" style="display:none"><input id="epi${p.id}" type="number" value="${p.price}" title="Precio de venta"><select id="epb${p.id}" class="ep-brand"><option value=""${!p.brand?' selected':''}>Sin marca</option>${Object.keys(BRAND_LABELS).map(b=>`<option value="${b}"${p.brand===b?' selected':''}>${BRAND_LABELS[b]}</option>`).join('')}</select><input id="epm${p.id}" type="text" placeholder="Modelo (ej. Nike Air Max 90)" value="${escHtml(p.modelo||'')}" style="flex-basis:100%"><input id="epc${p.id}" type="number" placeholder="Costo (privado, para margen)" value="${costos['cat:'+p.id]??''}" style="flex-basis:48%"><button class="ep-save" onclick="saveEP(${p.id},'cat')">Guardar</button><button class="ep-cancel" onclick="cancelEP()">✕</button></div>
      <div id="galcat${p.id}" style="display:none;grid-column:1/-1;padding:8px 0 4px"></div>
      <div id="tallascat${p.id}" style="display:none;grid-column:1/-1;padding:8px 0 4px"></div>
      <div id="metacat${p.id}" style="display:none;grid-column:1/-1;padding:8px 0 4px"></div>
      ${sugStrip('cat',p)}
    </div>`;
  }).join('');
}

/* ── GALERÍA en admin: fotos adicionales por producto ── */
function togGal(id,dest){
  const el=$('gal'+dest+id);if(!el)return;
  const abierto=el.style.display!=='none';
  el.style.display=abierto?'none':'block';
  if(!abierto)renderGalEditor(id,dest);
}

function renderGalEditor(id,dest){
  const list=dest==='liq'?liqs:prods;
  const p=list.find(x=>x.id===id);
  const el=$('gal'+dest+id);if(!p||!el)return;
  const ims=p.imgs||[];
  el.innerHTML=`<div style="font-size:10px;font-weight:700;color:var(--ink2);margin-bottom:6px">📷 Fotos adicionales — se ven en la ficha como carrusel (la principal no cambia)</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      ${ims.map((u,i)=>`<div style="position:relative"><img src="${escHtml(u)}" alt="" style="width:54px;height:54px;object-fit:cover;border-radius:8px;border:1px solid var(--line);display:block"><button onclick="galDel(${id},'${dest}',${i})" style="position:absolute;top:-6px;right:-6px;width:18px;height:18px;border:none;border-radius:50%;background:var(--red);color:#fff;font-size:10px;cursor:pointer;line-height:1">✕</button></div>`).join('')}
      <label id="galadd${dest}${id}" style="width:54px;height:54px;border:1.5px dashed var(--ink3);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;color:var(--ink3);cursor:pointer">＋<input type="file" accept="image/*" multiple style="display:none" onchange="galAdd(${id},'${dest}',this.files);this.value=''"></label>
    </div>`;
}

async function galAdd(id,dest,files){
  if(!files||!files.length)return;
  const list=dest==='liq'?liqs:prods;
  const p=list.find(x=>x.id===id);if(!p)return;
  const lbl=$('galadd'+dest+id);if(lbl)lbl.textContent='⏳';
  p.imgs=p.imgs||[];
  try{
    for(const f of Array.from(files).slice(0,10)){
      const dataUrl=await new Promise(res=>compressImg(f,res,true));
      const url=await uploadToStorage(dataUrl,0,false);
      p.imgs.push(url);
    }
    await galSave(id,dest,p);
  }catch(e){alert('❌ No se pudo subir la foto:\n'+(e.message||e));renderGalEditor(id,dest);}
}

async function galDel(id,dest,idx){
  const list=dest==='liq'?liqs:prods;
  const p=list.find(x=>x.id===id);if(!p||!p.imgs)return;
  p.imgs.splice(idx,1);
  await galSave(id,dest,p);
}

async function galSave(id,dest,p){
  await adminWrite('update_product',{table:dest==='liq'?'liq_products':'products',id,data:{imgs:JSON.stringify(p.imgs||[])}});
  renderGalEditor(id,dest);
  const b=$('galbtn'+dest+id);if(b)b.textContent='📷 '+(p.imgs?p.imgs.length:0);
}

function renderLiqAdmin(){
  const el=$('listLiq');if(!el)return;
  if(!liqs.length){el.innerHTML=`<div style="padding:24px;text-align:center;color:var(--ink3);font-size:12px">Sin productos de liquidación</div>`;return;}
  el.innerHTML=liqs.map(p=>{
    const m=p.img?`<img src="${escHtml(p.img||'')}" alt="">`:`<span style="font-size:20px">🔥</span>`;
    return `<div class="arow">
      <div class="arow-img">${m}${p.sold?`<div class="arow-sov">Agot.</div>`:''}</div>
      <div><div class="arow-gen" style="color:var(--red)">Liquidación</div><div class="arow-st">${p.sold?'🔴 Agotado':'🟢 Disponible'}</div>${costBadge('liq',p.id)}</div>
      <div><div class="arow-price sale">${fmt(p.price)}</div><button class="epbtn" onclick="startEP(${p.id},'liq')">Editar</button> <button class="epbtn" id="galbtnliq${p.id}" onclick="togGal(${p.id},'liq')">📷 ${(p.imgs||[]).length}</button> <button class="epbtn" onclick="togTallas(${p.id},'liq')" title="Stock por talla">📏 ${tallasBadge(p)}</button> <button class="epbtn" onclick="togMeta(${p.id},'liq')" title="SEO y metacampos (público)">🏷 ${metaBadge(p)}</button>${p.modelo?'':` <button class="epbtn" onclick="sugerirModelo(${p.id},'liq',this)" title="La IA propone el modelo mirando la foto (tú apruebas antes de guardar)">✨ Modelo</button>`}</div>
      <button class="sold-btn ${p.sold?'on':''}" onclick="togSold(${p.id},'liq')">${p.sold?'✓ Agot.':'Agotado'}</button>
      <button class="adel" onclick="delProd(${p.id},'liq')">✕</button>
      <div class="ep-row" id="epl${p.id}" style="display:none"><input id="epli${p.id}" type="number" value="${p.price}" title="Precio de venta"><input id="eplm${p.id}" type="text" placeholder="Modelo" value="${escHtml(p.modelo||'')}"><input id="eplc${p.id}" type="number" placeholder="Costo" value="${costos['liq:'+p.id]??''}"><button class="ep-save" onclick="saveEP(${p.id},'liq')">Guardar</button><button class="ep-cancel" onclick="cancelEP()">✕</button></div>
      <div id="galliq${p.id}" style="display:none;grid-column:1/-1;padding:8px 0 4px"></div>
      <div id="tallasliq${p.id}" style="display:none;grid-column:1/-1;padding:8px 0 4px"></div>
      <div id="metaliq${p.id}" style="display:none;grid-column:1/-1;padding:8px 0 4px"></div>
      ${sugStrip('liq',p)}
    </div>`;
  }).join('');
}

/* ── STATS ── */
function renderStatsTab(){
  const el=$('panStats');if(!el)return;
  if(!orders.length){
    el.innerHTML=`<div style="padding:32px 20px;text-align:center;color:var(--ink3);font-size:13px;line-height:1.7">
      📊 Aún no hay pedidos registrados.<br>Cada pedido enviado por WhatsApp<br>se guardará aquí automáticamente.
    </div>`;
    return;
  }
  // ── INICIO DE OPERADOR: tareas de hoy (lo operativo). Las métricas de negocio
  //    viven abajo en el bloque ANALYTICS, servidas por /api/dashboard (FASE K). ──
  const pendientes=orders.filter(o=>o.status!=='venta'&&o.status!=='no_venta'&&o.status!=='abandoned');
  const abandonados=orders.filter(o=>o.status==='abandoned');
  const hace24=Date.now()-24*60*60*1000;
  const aban24=abandonados.filter(o=>new Date(o.fecha).getTime()>=hace24).length;
  const allProds=[...prods,...liqs];
  const disponibles=allProds.filter(p=>!p.sold).length;
  const agotados=allProds.filter(p=>p.sold).length;
  // Tareas de hoy (solo las que tienen trabajo pendiente)
  const tareas=[];
  if(pendientes.length)tareas.push({txt:`Clasificar <b>${pendientes.length} pedido${pendientes.length===1?'':'s'} pendiente${pendientes.length===1?'':'s'}</b> como venta / no venta`,go:`avGo('leads','pending')`,ic:'⏳'});
  const sinContactar=pendientes.filter(o=>!o.wa_status||o.wa_status==='sin_contactar').length;
  if(sinContactar)tareas.push({txt:`Escribir a <b>${sinContactar} lead${sinContactar===1?'':'s'} sin contactar</b> por WhatsApp`,go:`avGo('leads','pending')`,ic:'📱'});
  const calientes=orders.filter(o=>o.temperatura==='caliente'&&o.status!=='venta'&&o.status!=='no_venta').length;
  if(calientes)tareas.push({txt:`Cerrar <b>${calientes} lead${calientes===1?'':'s'} caliente${calientes===1?'':'s'}</b> 🔥 — están listos para comprar`,go:`avGo('leads','pending')`,ic:'🔥'});
  const hoyISO=new Date().toISOString().slice(0,10);
  const seguirHoy=orders.filter(o=>o.seguimiento&&o.seguimiento<=hoyISO&&o.status!=='venta'&&o.status!=='no_venta').length;
  if(seguirHoy)tareas.push({txt:`Hacer seguimiento a <b>${seguirHoy} lead${seguirHoy===1?'':'s'}</b> con fecha cumplida 📅`,go:`avGo('leads','pending')`,ic:'📅'});
  if(aban24)tareas.push({txt:`Contactar <b>${aban24} carrito${aban24===1?'':'s'} abandonado${aban24===1?'':'s'}</b> de las últimas 24h`,go:`avGo('leads','abandoned')`,ic:'🛒'});
  // VENTAS SIN DESPACHAR: contra entrega = la plata solo entra cuando el paquete llega, y cada
  // día quieto sube el rechazo en puerta. null y 'guia_generada' cuentan (ver envioEfectivo).
  // Las ventas de prueba no cuentan: el modo prueba no es operación real.
  const ventasReales=orders.filter(o=>o.status==='venta'&&!(o.utm&&o.utm.test));
  const sinDespachar=ventasReales.filter(o=>envioEfectivo(o)==='por_despachar');
  if(sinDespachar.length){
    const n=sinDespachar.length,plata=sinDespachar.reduce((s,o)=>s+(o.total||0),0);
    tareas.push({txt:`Despachar <b>${n} venta${n===1?'':'s'} sin envío</b> (${fmt(plata)}) — la plata solo entra cuando el paquete llega`,go:`avGoEnvio('por_despachar')`,ic:'📦'});
  }
  if(agotados)tareas.push({txt:`<b>${agotados} producto${agotados===1?'':'s'} agotado${agotados===1?'':'s'}</b> — repón stock o libera la vitrina`,go:`avGo('productos')`,ic:'📦'});
  // Ventas de los últimos 7 días cuyo producto sigue SIN marcar agotado: mientras nadie lo
  // marque, el feed de Meta (solo excluye sold=true) sigue pautando un par que quizá ya no
  // existe → plata quemada en tráfico. Red de seguridad por si se omitió el confirm de venta.
  const hace7d=Date.now()-7*24*60*60*1000;
  const porRevisar=[],prVistos=new Set();
  orders.filter(o=>o.status==='venta'&&new Date(o.fecha).getTime()>=hace7d).forEach(o=>{
    productosDePedido(o).forEach(({p,type,it})=>{
      const key=type+':'+p.id;
      if(p.sold||prVistos.has(key))return;
      prVistos.add(key);porRevisar.push(it.label||p.modelo||('#'+p.id));
    });
  });
  if(porRevisar.length){
    const n=porRevisar.length,s=n===1?'':'n';
    tareas.push({txt:`Revisa si sigue${s} disponible${n===1?'':'s'}: <b>${escHtml(porRevisar.slice(0,3).join(', '))}</b>${n>3?` y ${n-3} más`:''} — se vendi${n===1?'ó':'eron'} esta semana y Meta aún lo${n===1?'':'s'} pauta`,go:`avGo('productos')`,ic:'👟'});
  }
  // Suscriptores con cupón de bienvenida por vencer (1-3 días) y sin pedido → escribirles HOY.
  if(subsData===null){loadSubscribers().then(()=>{if(avSec==='inicio')renderStatsTab();});}
  else{
    const telsPedidos=new Set(orders.map(o=>String(o.tel||'').replace(/\D/g,'').slice(-10)).filter(Boolean));
    const porVencer=subsData.filter(s=>{
      if(s.source!=='popup_bienvenida')return false;
      if(s.welcome_used_at)return false;   // cupón ya gastado → no hay nada que venza
      const v=cuponVigencia(s.welcome_issued_at||s.created_at);
      if(!v||v.vencido||v.dias>3)return false;
      const tel=String(s.whatsapp||'').replace(/\D/g,'').slice(-10);
      return tel&&!telsPedidos.has(tel);
    }).slice(0,3);
    porVencer.forEach(s=>{
      const v=cuponVigencia(s.welcome_issued_at||s.created_at);
      const names=interesadoEn(s.session_id);
      tareas.push({txt:`Escribir a <b>${escHtml(s.nombre||s.whatsapp)}</b>${names.length?` — miró <b>${escHtml(names[0])}</b>`:''}, su cupón vence en <b>${v.dias} día${v.dias===1?'':'s'}</b>`,go:`avGo('suscriptores')`,ic:'🎟'});
    });
    // Cupones YA vencidos sin compra → recuperar (reactivar el cupón + escribir).
    const vencidos=subsData.filter(s=>{
      if(s.source!=='popup_bienvenida')return false;
      if(s.welcome_used_at)return false;   // gastado ≠ vencido: si compró con él, no hay que recuperarlo
      const v=cuponVigencia(s.welcome_issued_at||s.created_at);
      if(!v||!v.vencido)return false;
      const tel=String(s.whatsapp||'').replace(/\D/g,'').slice(-10);
      return tel&&!telsPedidos.has(tel);
    }).slice(0,3);
    vencidos.forEach(s=>{
      const names=interesadoEn(s.session_id);
      tareas.push({txt:`Recuperar a <b>${escHtml(s.nombre||s.whatsapp)}</b>${names.length?` — miró <b>${escHtml(names[0])}</b>`:''}, su cupón <b>venció</b> → reactívalo`,go:`avGo('suscriptores')`,ic:'🔄'});
    });
    loadActivity([...porVencer,...vencidos].map(s=>s.session_id)).then(ok=>{if(ok&&avSec==='inicio')renderStatsTab();});
  }
  // ── SALUD DEL CONTRA ENTREGA (últimos 30 días): entregado vs devuelto. Cada devolución paga
  //    flete ida y vuelta SIN venta — esta tasa dice si el contra entrega es rentable de verdad.
  //    Se calcula en memoria sobre los pedidos ya cargados (no toca /api/dashboard); solo cuenta
  //    envíos CERRADOS (entregado/devuelto): lo que va en camino aún no se sabe.
  const hace30=Date.now()-30*24*60*60*1000;
  const cerradas=ventasReales.filter(o=>new Date(o.fecha).getTime()>=hace30&&['entregado','devuelto'].includes(envioEfectivo(o)));
  const nDev=cerradas.filter(o=>envioEfectivo(o)==='devuelto').length;
  const plataDev=cerradas.filter(o=>envioEfectivo(o)==='devuelto').reduce((s,o)=>s+(o.total||0),0);
  const tasaDev=cerradas.length?Math.round(nDev/cerradas.length*100):0;
  const envioSalud=cerradas.length?`<div style="background:var(--white);border:1px solid var(--line);border-radius:14px;padding:13px 15px;margin-bottom:14px">
      <div style="font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);margin-bottom:9px">🚚 Entregas · últimos 30 días</div>
      <div style="font-size:12.5px;color:var(--ink2);line-height:1.7">
        ✅ <b>${cerradas.length-nDev}</b> entregada${cerradas.length-nDev===1?'':'s'} · ↩️ <b style="color:${nDev?'var(--red)':'var(--ink2)'}">${nDev}</b> devuelta${nDev===1?'':'s'}${nDev?` (${fmt(plataDev)} que no entró)`:''}
        · Tasa de devolución <b style="color:${tasaDev>15?'var(--red)':'var(--green)'}">${tasaDev}%</b>
        <span style="color:var(--ink3);font-size:10.5px">(contra entrega en Colombia: 10-25% típico)</span>
      </div>
    </div>`:'';
  el.innerHTML=`<div style="padding:14px 16px 24px;overflow-y:auto;flex:1;min-height:0">
    <div style="background:var(--white);border:1px solid var(--line);border-radius:14px;padding:13px 15px;margin-bottom:14px">
      <div style="font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);margin-bottom:9px">✅ Tareas de hoy</div>
      ${tareas.length?tareas.map(t=>`<div onclick="${t.go}" style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);cursor:pointer">
        <span style="flex-shrink:0;font-size:15px">${t.ic}</span>
        <span style="flex:1;font-size:12.5px;color:var(--ink2);line-height:1.4">${t.txt}</span>
        <span style="color:var(--ink3);font-size:13px">→</span>
      </div>`).join(''):`<div style="font-size:12.5px;color:var(--green);font-weight:600;padding:4px 0">✅ Al día — no hay tareas pendientes.</div>`}
    </div>
    ${envioSalud}
    <div id="anaWrap"></div>
    <button onclick="exportOrders()" style="width:100%;padding:11px;background:var(--ink);color:#fff;border:none;border-radius:11px;font-family:var(--font);font-size:13px;font-weight:700;cursor:pointer;margin:6px 0 8px">📤 Exportar datos para IA</button>
  </div>`;
  renderAnalytics();
}

function exportOrders(){
  const data={contexto:`Historial de pedidos de ${STORE_NAME}. Exportado el ${new Date().toLocaleString('es-CO')}. Úsalo para analizar tendencias, ciudades top, métodos de pago y promedio de ticket.`,pedidos:orders};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`pedidos-${STORE_NAME.toLowerCase()}-${new Date().toISOString().slice(0,10)}.json`;
  a.click();URL.revokeObjectURL(a.href);
}

/* ══ ANALYTICS (FASE K): panel tipo Shopify servido por /api/dashboard ══
   Rango + 6 tarjetas con Δ% vs periodo anterior + gráfica SVG + desglose contable +
   embudo + clientes nuevos/recurrentes + productos ganadores + campañas con ROAS/CTR/CPC. */
let anaRango='30d',anaGroup='day',anaModelo='ultimo_clic_no_directo';   // default = el de Shopify

function setAnaRango(r){anaRango=r;renderAnalytics();}

function setAnaGroup(g){anaGroup=g;renderAnalytics();}

// Cambiar de modelo solo repinta (el JSON ya trae los 5 calculados; el cache evita refetch).
function setAnaModelo(m){anaModelo=m;renderAnalytics();}

function _anaParams(){
  const hoy=_hoyKey(0);
  if(anaRango==='hoy')return{since:hoy,until:hoy};
  if(anaRango==='ayer'){const a=_hoyKey(1);return{since:a,until:a};}
  if(anaRango==='7d')return{since:_hoyKey(6),until:hoy};
  if(anaRango==='30d')return{since:_hoyKey(29),until:hoy};
  if(anaRango==='mes')return{since:hoy.slice(0,7)+'-01',until:hoy};
  if(anaRango==='mespasado'){
    const [y,m]=hoy.split('-').map(Number);
    const fin=new Date(Date.UTC(y,m-1,1)-86400000).toISOString().slice(0,10); // último día mes anterior
    return{since:fin.slice(0,7)+'-01',until:fin};
  }
  return null; // 'all' = lifetime
}

function _abrev(n){
  n=Math.round(n||0);const a=Math.abs(n);
  if(a>=1e6)return '$'+String((n/1e6).toFixed(1)).replace('.',',').replace(/,0$/,'')+'M';
  if(a>=1e3)return '$'+Math.round(n/1e3)+'K';
  return '$'+n;
}

function _delta(cur,prev,fmtFn){
  // Δ% vs periodo anterior: ▲ verde / ▼ rojo / — gris. prev null = sin comparación.
  if(prev==null)return `<span style="font-size:10px;color:var(--ink3)">—</span>`;
  if(!prev)return cur>0?`<span style="font-size:10px;color:var(--green);font-weight:700">▲ nuevo</span>`:`<span style="font-size:10px;color:var(--ink3)">—</span>`;
  const d=(cur-prev)/prev*100;
  if(Math.abs(d)<0.5)return `<span style="font-size:10px;color:var(--ink3)">— igual</span>`;
  const up=d>0;
  return `<span title="Periodo anterior: ${fmtFn?fmtFn(prev):prev}" style="font-size:10px;font-weight:700;color:${up?'var(--green)':'var(--red)'}">${up?'▲':'▼'} ${Math.abs(d).toFixed(0)}%</span>`;
}

function _kLabel(k){
  // etiqueta corta de un bucket: día '6 jun' · semana 'sem 1 jun' · mes 'jun 26'
  if(/^\d{4}-\d{2}$/.test(k)){const [y,m]=k.split('-').map(Number);return new Date(Date.UTC(y,m-1,1)).toLocaleDateString('es-CO',{month:'short',timeZone:'UTC'})+' '+String(y).slice(2);}
  const [y,m,d]=k.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d)).toLocaleDateString('es-CO',{day:'numeric',month:'short',timeZone:'UTC'});
}

function _svgSerie(serie){
  if(!serie||!serie.length)return `<div style="padding:26px;text-align:center;color:var(--ink3);font-size:12px">Sin ventas en este rango.</div>`;
  const W=680,H=210,pL=48,pR=12,pT=14,pB=30,iw=W-pL-pR,ih=H-pT-pB;
  const maxV=Math.max(...serie.map(p=>p.netas),1);
  const maxP=Math.max(...serie.map(p=>p.pedidos),1);
  const X=i=>serie.length===1?pL+iw/2:pL+i*(iw/(serie.length-1));
  const Y=v=>pT+ih-(v/maxV)*ih, YP=v=>pT+ih-(v/maxP)*ih;
  let lin='',area=`M${X(0).toFixed(1)},${(pT+ih).toFixed(1)}`,linP='',dots='';
  serie.forEach((p,i)=>{
    const x=X(i).toFixed(1),y=Y(p.netas).toFixed(1),yp=YP(p.pedidos).toFixed(1);
    lin+=(i?' L':'M')+x+','+y; area+=` L${x},${y}`; linP+=(i?' L':'M')+x+','+yp;
    const t=`${_kLabel(p.k)} · ${fmt(p.netas)} · ${p.pedidos} pedido${p.pedidos===1?'':'s'}`;
    dots+=`<circle cx="${x}" cy="${y}" r="3.4" fill="var(--green)"><title>${escHtml(t)}</title></circle>`;
  });
  area+=` L${X(serie.length-1).toFixed(1)},${(pT+ih).toFixed(1)} Z`;
  // hasta 6 etiquetas en X
  const step=Math.max(1,Math.ceil(serie.length/6));
  let xlab='';
  serie.forEach((p,i)=>{if(i%step===0||i===serie.length-1)xlab+=`<text x="${X(i).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="9.5" fill="#8a8a85">${escHtml(_kLabel(p.k))}</text>`;});
  // 3 guías horizontales
  let guias='';[1,0.5,0].forEach(f=>{const y=(pT+ih-f*ih).toFixed(1);const lab=maxV<=1?(f===0?'$0':''):_abrev(maxV*f);guias+=`<line x1="${pL}" y1="${y}" x2="${W-pR}" y2="${y}" stroke="#eceae6" stroke-width="1"/><text x="${pL-5}" y="${+y+3}" text-anchor="end" font-size="9.5" fill="#8a8a85">${lab}</text>`;});
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
    <defs><linearGradient id="anaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1BA94C" stop-opacity=".22"/><stop offset="100%" stop-color="#1BA94C" stop-opacity="0"/></linearGradient></defs>
    ${guias}
    <path d="${area}" fill="url(#anaGrad)"/>
    <path d="${lin}" fill="none" stroke="var(--green)" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="${linP}" fill="none" stroke="#5D2D91" stroke-width="1.4" stroke-dasharray="4 3" opacity=".75"/>
    ${dots}${xlab}
  </svg>
  <div style="display:flex;gap:14px;justify-content:center;font-size:10px;color:var(--ink3);margin-top:2px">
    <span><span style="display:inline-block;width:14px;height:3px;background:var(--green);border-radius:2px;vertical-align:middle"></span> Ventas netas</span>
    <span><span style="display:inline-block;width:14px;height:0;border-top:2px dashed #5D2D91;vertical-align:middle"></span> Pedidos</span>
  </div>`;
}

function _embudo(f){
  if(!f)return '';
  const pasos=[['👀 Sesiones',f.sessions],['👟 Vieron producto',f.view_product],['🛒 Agregaron al carrito',f.add_to_cart],['💳 Iniciaron checkout',f.initiate_checkout],['💰 Llegaron a pagar',f.reached_payment],['📱 Lead WhatsApp',f.leads],['✅ Venta',f.ventas]]
    .filter(p=>p[1]!=null);   // reached_payment es null en rangos previos al 2026-06-07 → se oculta
  const max=Math.max(...pasos.map(p=>p[1]),1);
  return pasos.map((p,i)=>{
    const prev=i?pasos[i-1][1]:null;
    const tasa=prev?Math.round(p[1]/prev*100):null;
    // "Venta" viene de pedidos clasificados (no de sesiones): puede superar al paso anterior
    // si la venta se clasificó sin sesión rastreada en el rango → se muestra "100%+".
    const tasaTxt=tasa==null?'':(tasa>100?'100%+':tasa+'%');
    const w=Math.max(2,p[1]/max*100);
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0" ${tasa!=null&&tasa>100?'title="Más ventas que leads rastreados: ventas clasificadas a mano pueden no tener sesión en este rango"':''}>
      <span style="flex:0 0 148px;font-size:11px;font-weight:600;color:var(--ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p[0]}</span>
      <div style="flex:1;background:var(--bg);border-radius:6px;height:18px;overflow:hidden"><div style="width:${w}%;height:100%;background:${i===pasos.length-1?'var(--green)':'#b9b4ab'};border-radius:6px"></div></div>
      <b style="flex:0 0 44px;text-align:right;font-size:12px">${p[1]}</b>
      <span style="flex:0 0 44px;text-align:right;font-size:10px;color:${tasa!=null&&tasa<10?'var(--red)':'var(--ink3)'}">${tasaTxt}</span>
    </div>`;
  }).join('');
}

function _anaBloque(titulo,inner){
  return `<div style="background:var(--white);border:1px solid var(--line);border-radius:14px;padding:13px 15px;margin-bottom:14px">
    <div style="font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--ink2);margin-bottom:9px">${titulo}</div>${inner}</div>`;
}

async function renderAnalytics(){
  const box=$('anaWrap');if(!box)return;
  const RANGOS=[['hoy','Hoy'],['ayer','Ayer'],['7d','7 días'],['30d','30 días'],['mes','Este mes'],['mespasado','Mes pasado'],['all','Todo']];
  const chips=`<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px">${RANGOS.map(([v,t])=>`<button onclick="setAnaRango('${v}')" style="padding:6px 11px;border:1px solid ${anaRango===v?'var(--ink)':'var(--line)'};border-radius:14px;background:${anaRango===v?'var(--ink)':'var(--white)'};color:${anaRango===v?'#fff':'var(--ink2)'};font-family:var(--font);font-size:10.5px;font-weight:700;cursor:pointer">${t}</button>`).join('')}</div>`;
  const key=anaRango+'|'+anaGroup;
  window._anaCache=window._anaCache||{};
  const hit=window._anaCache[key];
  // Cache: 60s si el rango incluye HOY (datos vivos), 5 min para rangos cerrados (Codex #6)
  const ttl=(anaRango==='ayer'||anaRango==='mespasado')?5*60*1000:60*1000;
  let j=hit&&(Date.now()-hit.t<ttl)?hit.j:null;
  if(!j){
    box.innerHTML=chips+`<div style="padding:28px;text-align:center;color:var(--ink3);font-size:12px">📊 Cargando analytics…</div>`;
    try{
      const p=_anaParams();
      const qs=new URLSearchParams();if(p){qs.set('since',p.since);qs.set('until',p.until);}qs.set('group',anaGroup);
      const r=await fetch('/api/dashboard?'+qs.toString(),{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      j=await r.json();
      window._anaCache[key]={t:Date.now(),j};
    }catch(e){
      box.innerHTML=chips+`<div style="padding:22px;text-align:center;color:var(--ink3);font-size:12px">No se pudo cargar analytics (${escHtml(e.message)}).<br><button onclick="renderAnalytics()" style="margin-top:9px;padding:8px 16px;border:1px solid var(--line);border-radius:9px;background:var(--white);font-family:var(--font);font-size:12px;font-weight:700;cursor:pointer">Reintentar</button></div>`;
      return;
    }
    if(anaRango+'|'+anaGroup!==key)return; // el usuario cambió de rango mientras cargaba
  }
  const R=j.resumen||{},P=j.resumen_prev,C=j.clientes||{};
  const tcard=(lbl,val,delta,def)=>`<div title="${escHtml(def||'')}" style="background:var(--white);border:1px solid var(--line);border-radius:14px;padding:12px 13px">
      <div style="font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--ink3);margin-bottom:4px">${lbl}</div>
      <div style="font-size:20px;font-weight:700;letter-spacing:-.04em;white-space:nowrap">${val}</div>
      <div style="margin-top:3px">${delta}</div>
    </div>`;
  const cards=`<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:14px">
    ${tcard('Ventas netas',_abrev(R.ventas_netas),_delta(R.ventas_netas,P?P.ventas_netas:null,fmt),'Producto post-descuento, sin flete → base del ROAS')}
    ${tcard('Pedidos (ventas)',R.pedidos||0,_delta(R.pedidos,P?P.pedidos:null),'Solo pedidos marcados como VENTA')}
    ${tcard('Valor medio pedido',_abrev(R.aov),_delta(R.aov,P?P.aov:null,fmt),'Ventas netas ÷ pedidos (AOV)')}
    ${tcard('ROAS',j.roas_atribuido!=null?j.roas_atribuido:(j.roas_promedio!=null?j.roas_promedio:'—'),`<span style="font-size:10px;color:var(--ink3)">${j.roas_atribuido!=null&&j.roas_promedio!=null&&j.roas_atribuido!==j.roas_promedio?`cuenta: ${j.roas_promedio} · `:''}${j.inversion_atribuida!=null?'inv. '+_abrev(j.inversion_atribuida):(j.inversion_total!=null?'inv. '+_abrev(j.inversion_total):'sin dato de Meta')}</span>`,'ROAS atribuido: solo campañas con ventas cruzadas ÷ su gasto. Las campañas con gasto y 0 ventas se ven en la tabla pero no entran aquí. "cuenta" = contra el gasto de TODA la cuenta Meta')}
    ${tcard('Margen estimado',_abrev(R.margen_estimado),_delta(R.margen_estimado,P?P.margen_estimado:null,fmt),'Ventas − costo · solo ítems con costo registrado ('+Math.round((R.margen_cobertura||0)*100)+'% cubierto) → utilidad')}
    ${tcard('Clientes habituales',(C.returning_rate!=null?C.returning_rate:0)+'%',`<span style="font-size:10px;color:var(--ink3)">${C.recurrentes||0} de ${(C.nuevos||0)+(C.recurrentes||0)} clientes</span>`,'% de clientes del rango que ya habían comprado antes (returning customer rate)')}
  </div>`;
  const serieBloque=_anaBloque(`📈 Ventas a lo largo del tiempo`,
    `<div style="display:flex;gap:5px;margin-bottom:8px">${[['day','📅 Día'],['week','📆 Semana'],['month','🗓 Mes']].map(([v,t])=>`<button onclick="setAnaGroup('${v}')" style="padding:5px 12px;border:1px solid ${anaGroup===v?'var(--ink)':'var(--line)'};border-radius:14px;background:${anaGroup===v?'var(--ink)':'var(--white)'};color:${anaGroup===v?'#fff':'var(--ink2)'};font-family:var(--font);font-size:10px;font-weight:700;cursor:pointer">${t}</button>`).join('')}</div>`
    +_svgSerie(j.serie));
  const mini=(l,v,def)=>`<div title="${escHtml(def)}" style="background:var(--bg);border-radius:10px;padding:8px 10px;min-width:0">
    <div style="font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3)">${l}</div>
    <div style="font-size:13.5px;font-weight:700;white-space:nowrap">${v}</div></div>`;
  const desglose=_anaBloque('💰 Desglose contable',
    `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
      ${mini('Brutas',_abrev(R.ventas_brutas),'Productos antes de descuentos → volumen')}
      ${mini('Descuentos','−'+_abrev(R.descuentos),'Cupones y combos aplicados')}
      ${mini('Netas',_abrev(R.ventas_netas),'Producto post-descuento → para ROAS')}
      ${mini('Envíos',_abrev(R.envios),'Fletes cobrados al cliente')}
      ${mini('Total cobrado',_abrev(R.total_cobrado),'Lo que entró a caja (producto + envío)')}
      ${mini('Margen est.',_abrev(R.margen_estimado),'Utilidad estimada (ítems con costo)')}
    </div>`);
  const embudoBloque=j.funnel?_anaBloque('🔻 Embudo del rango',_embudo(j.funnel)):'';
  const V=j.visitantes||null;
  const visitantesBloque=V?_anaBloque('👀 Visitantes recurrentes',
    `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">
      ${mini('Visitantes',V.total||0,'Personas únicas que entraron en el rango (por dispositivo/navegador). Incluye anónimos.')}
      ${mini('Recurrentes',(V.recurrentes||0)+' · '+(V.recurrentes_pct||0)+'%','Volvieron en ≥2 días distintos. OJO: solo detecta el mismo dispositivo/navegador; otro celular o borrar cookies = visitante nuevo.')}
      ${mini('Volvieron hoy',V.volvieron_hoy||0,'Visitantes recurrentes que entraron también hoy.')}
    </div>
    <div style="font-size:9.5px;color:var(--ink3);margin-top:7px;line-height:1.4">Incluye anónimos (sin contacto). Para reengancharlos usa las audiencias de remarketing en Meta — no se les puede escribir.</div>`):'';
  const clientesBloque=_anaBloque('👥 Clientes',
    `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-bottom:8px">
      ${mini('Nuevos',(C.nuevos||0)+' · '+_abrev(C.ventas_nuevos),'Primera compra dentro del rango')}
      ${mini('Recurrentes',(C.recurrentes||0)+' · '+_abrev(C.ventas_recurrentes),'Ya habían comprado antes del rango')}
      ${mini('Frecuencia',(C.frecuencia_promedio||0)+' compras/cliente','Pedidos del rango ÷ clientes del rango')}
      ${mini('Entre compras',C.dias_entre_compras!=null?C.dias_entre_compras+' días':'—','Promedio histórico entre compras del mismo cliente')}
    </div>`);
  const prodBloque=(j.productos&&j.productos.length)?_anaBloque('🏆 Productos ganadores',
    `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:480px">
      <tr style="color:var(--ink3);font-size:9px;text-transform:uppercase;letter-spacing:.05em;text-align:right"><th style="text-align:left;padding:4px 6px 4px 0">Producto</th><th>Ingresos</th><th>Und.</th><th>Vistas</th><th>Carrito</th><th title="% de vistas que agregaron al carrito">V→C</th><th title="% de carritos que terminaron en venta">C→V</th></tr>
      ${j.productos.map(p=>`<tr style="border-top:1px solid var(--line);text-align:right">
        <td style="text-align:left;padding:6px 6px 6px 0;font-weight:600;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.label)} <span style="color:var(--ink3);font-weight:400">#${p.id}</span></td>
        <td style="font-weight:700;color:var(--green)">${_abrev(p.ingresos)}</td><td>${p.unidades}</td><td>${p.views}</td><td>${p.atc}</td>
        <td>${p.conv_view_cart!=null?p.conv_view_cart+'%':'—'}</td><td>${p.conv_cart_venta!=null?p.conv_cart_venta+'%':'—'}</td>
      </tr>`).join('')}
    </table></div>`):'';
  // ROAS de equilibrio derivado del margen real (null si la cobertura de costos < 30%). Se declara
  // ANTES de campBloque porque las dos tablas lo usan para colorear.
  const bk=(j&&j.breakeven!=null)?j.breakeven:null;
  const campBloque=(j.por_campana&&j.por_campana.length)?_anaBloque('📣 Campañas (Meta × ventas)',
    `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:560px">
      <tr style="color:var(--ink3);font-size:9px;text-transform:uppercase;letter-spacing:.05em;text-align:right"><th style="text-align:left;padding:4px 6px 4px 0">Campaña</th><th title="Qué dicen TODOS los modelos de atribución sobre esta campaña. Escalar = rentable bajo todos; apagar = rentable bajo ninguno">Veredicto</th><th>Gasto</th><th>Ventas</th><th>ROAS</th><th>CPA</th><th>CTR</th><th>CPC</th><th>CPM</th></tr>
      ${j.por_campana.slice(0,8).map(c=>`<tr style="border-top:1px solid var(--line);text-align:right">
        <td style="text-align:left;padding:6px 6px 6px 0;font-weight:600;max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(c.campana)}</td>
        <td style="text-align:center">${c.veredicto?`<span title="ROAS entre ${c.roas_min}x y ${c.roas_max}x según el modelo de atribución${bk!=null?` · equilibrio ${bk}x`:''}" style="display:inline-block;padding:2px 7px;border-radius:6px;font-size:9px;font-weight:700;white-space:nowrap;background:${c.veredicto==='escalar'?'#1BA94C':c.veredicto==='apagar'?'#E8200A':'#F2A900'};color:#fff">${c.veredicto==='escalar'?'▲ ESCALAR':c.veredicto==='apagar'?'▼ APAGAR':'● OBSERVAR'}</span>`:'<span style="color:var(--ink3)">—</span>'}</td>
        <td>${c.inversion?_abrev(c.inversion):'—'}</td>
        <td style="font-weight:700;color:var(--green)">${c.facturacion?_abrev(c.facturacion):'—'}<span style="color:var(--ink3);font-weight:400"> (${c.compras})</span></td>
        <td style="font-weight:700;color:${c.roas==null?'var(--ink3)':c.roas>=2?'var(--green)':c.roas>=1?'#F2A900':'var(--red)'}">${c.roas!=null?c.roas:'—'}</td>
        <td>${c.cpa!=null?_abrev(c.cpa):'—'}</td><td>${c.ctr!=null?c.ctr+'%':'—'}</td><td>${c.cpc!=null?_abrev(c.cpc):'—'}</td><td>${c.cpm!=null?_abrev(c.cpm):'—'}</td>
      </tr>`).join('')}
    </table></div>`
    +(j.meta_error?`<div style="font-size:10px;color:var(--ink3);margin-top:7px">⚠ Sin datos de inversión de Meta: ${escHtml(String(j.meta_error).slice(0,90))}</div>`:''))
    :(j.meta_error?_anaBloque('📣 Campañas',`<div style="font-size:11.5px;color:var(--ink3)">⚠ Sin conexión con Meta (${escHtml(String(j.meta_error).slice(0,90))}). Las ventas por campaña aparecerán cuando lleguen pedidos con utm_campaign.</div>`):'');
  // ── Atribución multi-toque (5 modelos Shopify, ventana 30 días) ──
  const A=j.atribucion||null;
  const MODELOS_ATR=[
    ['ultimo_clic_no_directo','Último clic no directo','Se ignora el tráfico directo; 100% del crédito al último canal en el que se hizo clic (default de Shopify)'],
    ['ultimo_clic','Último clic','100% del crédito al último canal en el que se hizo clic'],
    ['primer_clic','Primer clic','100% del crédito al primer canal en el que se hizo clic'],
    ['cualquier_clic','Cualquier clic','100% del crédito a CADA canal tocado — los % suman más de 100 a propósito'],
    ['lineal','Lineal','El crédito se reparte equitativamente entre todos los clics de la ruta'],
    // Los dos siguientes NO existen en Shopify.
    ['decaimiento','Decaimiento 7d','Reparte según lo cerca que estuvo cada toque de la compra (semivida 7 días): mide quién CERRÓ la venta. Shopify no tiene este modelo'],
    ['posicion','Posición 40/20/40','40% al primer toque, 40% al último y 20% repartido en el medio: rescata al anuncio que ABRIÓ la venta, no solo al que la cerró. Shopify no tiene este modelo']
  ];
  const filasAtr=(A&&A.modelos&&A.modelos[anaModelo])||[];
  const defAtr=(MODELOS_ATR.find(m=>m[0]===anaModelo)||[])[2]||'';
  const atrBloque=A?_anaBloque('🧭 Atribución por canal · ventana 30 días',
    `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">${MODELOS_ATR.map(([v,t,def])=>`<button onclick="setAnaModelo('${v}')" title="${escHtml(def)}" style="padding:5px 11px;border:1px solid ${anaModelo===v?'var(--ink)':'var(--line)'};border-radius:14px;background:${anaModelo===v?'var(--ink)':'var(--white)'};color:${anaModelo===v?'#fff':'var(--ink2)'};font-family:var(--font);font-size:10px;font-weight:700;cursor:pointer">${t}</button>`).join('')}</div>`
    +(filasAtr.length?`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:400px">
      <tr style="color:var(--ink3);font-size:9px;text-transform:uppercase;letter-spacing:.05em;text-align:right"><th style="text-align:left;padding:4px 6px 4px 0">Canal</th><th>Ventas</th><th title="Pedidos atribuidos (en Lineal, Decaimiento y Posición se reparten en fracciones)">Pedidos</th><th title="% de la facturación del rango atribuida al canal">%</th><th title="Gasto de Meta de esa campaña en el rango">Inv.</th><th title="Facturación atribuida ÷ inversión, SEGÚN ESTE MODELO. Shopify no puede dar esto: no conoce tu gasto publicitario">ROAS</th></tr>
      ${filasAtr.slice(0,12).map(c=>`<tr style="border-top:1px solid var(--line);text-align:right">
        <td style="text-align:left;padding:6px 6px 6px 0;font-weight:600;max-width:170px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" ${c.campaign_id?`title="campaign_id ${escHtml(c.campaign_id)}"`:''}>${escHtml(c.canal)}</td>
        <td style="font-weight:700;color:var(--green)">${_abrev(c.facturacion)}</td>
        <td>${c.compras}</td>
        <td style="font-weight:700">${c.pct!=null?c.pct+'%':'—'}</td>
        <td style="color:var(--ink3)">${c.inversion?_abrev(c.inversion):'—'}</td>
        <td style="font-weight:700;color:${c.roas==null?'var(--ink3)':(bk!=null&&c.roas>=bk?'var(--green)':'var(--red)')}">${c.roas!=null?c.roas+'x':'—'}</td>
      </tr>`).join('')}
    </table></div>`:`<div style="font-size:11.5px;color:var(--ink3)">Sin ventas en este rango — la atribución aparece cuando hay pedidos marcados como venta.</div>`)
    +`<div style="font-size:9.5px;color:var(--ink3);margin-top:7px;line-height:1.5">${escHtml(defAtr)}.
      <br>Ruta reconstruida por sesión: ${A.con_ruta||0} venta${A.con_ruta===1?'':'s'} con recorrido completo · ${A.sin_ruta||0} solo con el UTM del pedido.
      ${A.calidad&&A.calidad.rutas_medidas?` De esas, <b>${A.calidad.rutas_medidas} con clic medido</b> (distingue clic de revisita) y ${A.calidad.rutas_legacy} con el método viejo.`:''}
      ${A.puente&&(A.puente.resueltos||A.puente.sin_puente)?`<br>🔗 Pedidos de Paylink/panel: <b>${A.puente.resueltos} con identidad recuperada</b> (heredan la sesión web del cliente)${A.puente.sin_puente?` · ${A.puente.sin_puente} sin puente → cuentan como Directo`:''}.`:''}
      ${bk!=null?`<br>⚖️ Tu ROAS de equilibrio es <b>${bk}x</b> (calculado con tu margen real): por debajo de eso la campaña pierde plata.`:'<br>⚖️ Registra costos de producto para saber tu ROAS de equilibrio.'}
      ${A.parcial?' <b>⚠ Rutas posiblemente incompletas (límite de datos): usa un rango más corto.</b>':''}</div>`)
    :'';
  // ── RFM (segmentos Shopify) + export de audiencia · SIEMPRE histórico completo ──
  // El server los calcula fuera del rango a propósito: la "vida" de un cliente no cabe en 7 días.
  const RFM_COLS={'Campeones':'#1BA94C','Leales':'#2E7D32','Potenciales':'#0288D1','Nuevos':'#5D2D91','En riesgo':'#F2A900','Dormidos':'#b3541e','Perdidos':'#E8200A'};
  const RFM_DEFS={'Campeones':'Compran mucho y hace poco (R≥4 y F≥4)','Leales':'Compran seguido y siguen activos (R≥3 y F≥3)','Potenciales':'Recientes con pocas compras: candidatos a la 2ª (R≥3 y F≤2)','Nuevos':'Primera compra, muy reciente (R≥4 y F=1)','En riesgo':'Eran buenos clientes y se están enfriando (R=2 y F≥3)','Dormidos':'Compraron poco y hace rato (R=2 y F≤2)','Perdidos':'El quintil más viejo de recencia (R=1)'};
  const RF=j.rfm||null;
  const rfmBloque=(RF&&RF.clientes)?_anaBloque('🎯 Segmentos RFM · histórico completo',
    `<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:11px;min-width:420px">
      <tr style="color:var(--ink3);font-size:9px;text-transform:uppercase;letter-spacing:.05em;text-align:right"><th style="text-align:left;padding:4px 6px 4px 0">Segmento</th><th>Clientes</th><th>%</th><th>Facturación</th><th>%</th></tr>
      ${RF.segmentos.map(s=>`<tr style="border-top:1px solid var(--line);text-align:right${s.clientes?'':';opacity:.45'}">
        <td style="text-align:left;padding:6px 6px 6px 0" title="${escHtml(RFM_DEFS[s.etiqueta]||'')}"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${RFM_COLS[s.etiqueta]||'#999'};margin-right:6px"></span><b>${escHtml(s.etiqueta)}</b></td>
        <td style="font-weight:700">${s.clientes}</td><td style="color:var(--ink3)">${s.pct_clientes}%</td>
        <td style="font-weight:700;color:var(--green)">${_abrev(s.facturacion)}</td><td style="color:var(--ink3)">${s.pct_facturacion}%</td>
      </tr>`).join('')}
    </table></div>
    <div style="display:flex;gap:6px;margin-top:10px;align-items:center;flex-wrap:wrap">
      <select id="rfmExpSel" style="flex:1;min-width:150px;padding:8px 10px;border:1px solid var(--line);border-radius:9px;background:var(--white);font-family:var(--font);font-size:11.5px;color:var(--ink)">
        <option value="todos">Todos los compradores (${RF.clientes})</option>
        ${RF.segmentos.filter(s=>s.clientes).map(s=>`<option value="${escHtml(s.etiqueta)}">${escHtml(s.etiqueta)} (${s.clientes})</option>`).join('')}
      </select>
      <button id="rfmExpBtn" onclick="exportAudienciaMeta()" style="padding:8px 13px;border:none;border-radius:9px;background:var(--ink);color:#fff;font-family:var(--font);font-size:11px;font-weight:700;cursor:pointer">⬇ Exportar audiencia para Meta</button>
    </div>
    <div style="font-size:9.5px;color:var(--ink3);margin-top:7px;line-height:1.4">R = qué tan reciente compró · F = cuántas veces · M = cuánto ha gastado (puntajes 1-5 por quintiles sobre tu propia base). El CSV sale en el formato de Meta: Audiencias → Crear audiencia personalizada → Lista de clientes.</div>`):'';
  // ── Cohortes de clientes: % que recompra por mes desde su primera compra ──
  const CH=Array.isArray(j.cohortes)?j.cohortes:[];
  const maxM=CH.length?Math.min(12,Math.max(...CH.map(c=>c.retencion.length))):0;   // hasta 12 meses visibles (el JSON trae más)
  const cohBloque=CH.length?_anaBloque('📅 Cohortes de clientes · histórico completo',
    `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:10.5px;min-width:${190+maxM*46}px">
      <tr style="color:var(--ink3);font-size:9px;text-transform:uppercase;letter-spacing:.05em"><th style="text-align:left;padding:4px 8px 4px 0">1ª compra</th><th style="text-align:right;padding:0 8px">Clientes</th><th style="text-align:right;padding:0 8px" title="Ventas netas acumuladas ÷ clientes de la cohorte">LTV/cliente</th>${Array.from({length:maxM},(_,m)=>`<th style="text-align:center;padding:0 4px" title="Mes ${m} desde la primera compra">M${m}</th>`).join('')}</tr>
      ${CH.map(c=>`<tr style="border-top:1px solid var(--line)">
        <td style="text-align:left;padding:5px 8px 5px 0;font-weight:700;white-space:nowrap">${escHtml(_kLabel(c.mes))}</td>
        <td style="text-align:right;padding:0 8px">${c.clientes}</td>
        <td style="text-align:right;padding:0 8px;font-weight:700;color:var(--green)">${_abrev(c.ltv_acumulado[c.ltv_acumulado.length-1]||0)}</td>
        ${Array.from({length:maxM},(_,m)=>{
          const p=c.retencion[m];
          if(p==null)return `<td style="text-align:center;padding:4px;color:var(--line)">·</td>`;   // mes que aún no llega para esta cohorte
          return `<td title="${escHtml(_kLabel(c.mes))} +${m} mes${m===1?'':'es'}: ${p}% recompró · LTV acum. ${fmt(c.ltv_acumulado[m]||0)}" style="text-align:center;padding:4px;background:rgba(27,169,76,${(p/100*0.72+(p?0.08:0)).toFixed(2)});border-radius:4px;font-weight:${m?'400':'700'}">${Math.round(p)}%</td>`;
        }).join('')}
      </tr>`).join('')}
    </table></div>
    <div style="font-size:9.5px;color:var(--ink3);margin-top:7px;line-height:1.4">Cada fila agrupa a los clientes por el MES de su primera compra. M0 = ese mes (siempre 100%); cada celda = % de la cohorte que compró en ese mes. Se muestran hasta 12 meses.</div>`):'';
  const aviso=j.truncado?`<div style="font-size:10px;color:var(--ink3);text-align:center;padding:4px 0 10px">⚠ Datos al límite (${j.truncado.ventas?'5.000 ventas':''}${j.truncado.ventas&&j.truncado.events?' · ':''}${j.truncado.events?'20.000 eventos':''}) — usa un rango más corto para cifras completas.</div>`:'';
  box.innerHTML=chips+aviso+cards+serieBloque+desglose+embudoBloque+visitantesBloque+clientesBloque+rfmBloque+cohBloque+prodBloque+campBloque+atrBloque;
}

// Descarga el CSV de audiencia (formato Custom Audience de Meta) desde /api/admin.
// El SERVER arma y filtra la lista (action export_audiencia, misma sesión admin que todo lo
// demás); aquí solo se pide y se guarda. No usa adminWrite porque la respuesta es CSV, no JSON.
async function exportAudienciaMeta(){
  const sel=$('rfmExpSel'),btn=$('rfmExpBtn');
  const v=sel?sel.value:'todos';
  const data=v==='todos'?{tipo:'todos'}:{tipo:'rfm',etiqueta:v};
  if(btn){btn.disabled=true;btn.textContent='Generando…';}
  try{
    const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'export_audiencia',data})});
    if(r.status===401){ADMIN_OK=false;alert('Tu sesión admin expiró. Vuelve a entrar con el PIN.');return;}
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||'HTTP '+r.status);}
    const csv=await r.text();
    const n=Math.max(0,csv.split('\n').length-1);
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);
    const slug=v==='todos'?'compradores':v.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_');
    a.download='audiencia_meta_'+slug+'_'+new Date().toISOString().slice(0,10)+'.csv';
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(a.href);
    if(!n)alert('El filtro no devolvió clientes con teléfono o email: el CSV salió vacío.');
  }catch(e){alert('No se pudo exportar: '+e.message);}
  finally{if(btn){btn.disabled=false;btn.textContent='⬇ Exportar audiencia para Meta';}}
}

/* ── LEADS (Venta / No venta) ── */
let leadFilter='pending';

let leadVista='dia';

/* ── SUSCRIPTORES (popup + newsletter) — la base del remarketing ── */
let subsData=null;

// null = sin cargar; [] = cargado vacío
async function loadSubscribers(){
  try{
    const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list_subscribers'})});
    const j=await r.json();
    if(j&&j.ok)subsData=j.subscribers||[];
  }catch(e){}
  return subsData;
}

/* ── RECORRIDO DEL CLIENTE: eventos por sesión para "Interesado en" + timeline ──
   Carga BATCH (una llamada por pestaña) vía la acción session_activity de /api/admin. */
let activityBySession={};

// session_id -> [eventos desc]
const _actLoaded=new Set();

// sesiones ya pedidas (no repedir)
async function loadActivity(ids){
  const need=[...new Set((ids||[]).filter(s=>s&&!_actLoaded.has(s)))].slice(0,200);
  if(!need.length)return false;
  need.forEach(s=>_actLoaded.add(s));
  try{
    const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'session_activity',data:{session_ids:need}})});
    const j=await r.json();
    if(j&&j.ok&&Array.isArray(j.events)){
      j.events.forEach(e=>{(activityBySession[e.session_id]=activityBySession[e.session_id]||[]).push(e);});
      return true;
    }
  }catch(e){}
  return false;
}

const EV_LABELS={page_view:'Entró a la tienda',view_product:'Vio',add_to_cart:'Agregó al carrito 🛒',initiate_checkout:'Empezó el pedido',lead:'Dejó sus datos / abrió WhatsApp',purchase:'Compra confirmada ✓',popup_shown:'Vio el popup de descuento',apply_coupon:'Aplicó cupón',select_payment:'Eligió pagar con',reached_payment:'Llegó al paso de pago 💳'};

const FUENTES={ig:'Instagram',fb:'Facebook',google:'Google',wa:'WhatsApp'};

function resolveProdName(pid){
  if(!pid)return '';
  const s=String(pid);
  let m=s.match(/^combo_(.+)$/);
  if(m){const c=combos.find(x=>x.id===m[1]);return c?c.nombre:('Combo '+m[1]);}
  m=s.match(/^(?:cat_)?(\d+)$/);
  if(m){const p=prods.find(x=>String(x.id)===m[1]);if(p)return p.modelo||((BRAND_LABELS[p.brand]||'Par')+' #'+p.id);}
  m=s.match(/^(?:L|liq_)(\d+)$/i);
  if(m){const p=liqs.find(x=>String(x.id)===m[1]);if(p)return (p.modelo||'Oferta #'+p.id);}
  return s;   // detalle plano (método de pago, código de cupón…)
}

// Cupón de bienvenida: vigencia de 7 días desde welcome_issued_at.
function cuponVigencia(issued){
  if(!issued)return null;
  const vence=new Date(issued).getTime()+7*24*60*60*1000;
  const dias=Math.ceil((vence-Date.now())/(24*60*60*1000));
  return {dias,vencido:dias<=0};
}

function cuponBadge(issued){
  const v=cuponVigencia(issued);
  if(!v)return '';
  if(v.vencido)return `<span style="font-size:9.5px;font-weight:700;color:var(--ink3)">🎟 cupón vencido</span>`;
  const urgente=v.dias<=3;
  return `<span style="font-size:9.5px;font-weight:700;color:${urgente?'#E8200A':'var(--green)'}">🎟 cupón vence en ${v.dias} día${v.dias===1?'':'s'}</span>`;
}

// Productos que la persona miró/agregó en su visita (únicos, recientes primero, máx 3).
function interesadoEn(sid){
  const evs=activityBySession[sid]||[];
  const names=[];
  evs.forEach(e=>{
    if(e.type!=='view_product'&&e.type!=='add_to_cart')return;
    const n=resolveProdName(e.product_id);
    if(n&&!names.includes(n))names.push(n);
  });
  return names.slice(0,3);
}

function interesadoEnLinea(sid){
  const names=interesadoEn(sid);
  return names.length?`<div style="font-size:10.5px;color:#5D2D91;font-weight:700;margin-top:3px">👁 Interesado en: ${escHtml(names.join(', '))}</div>`:'';
}

// ── RECUPERACIÓN POR WHATSAPP: mensajes pre-escritos (1 toque → mensaje listo) ──
// Carrito abandonado / lead sin cerrar: saludo + lo que dejó + contra entrega + "¿te lo aparto?".
function waRescate(o){
  const tel=String(o.tel||'').replace(/\D/g,'').slice(-10);
  if(tel.length<10)return null;
  const nombre=(o.nombre||'').trim().split(/\s+/)[0]||'';
  const items=(Array.isArray(o.items)?o.items:[]).map(it=>{
    const mk=it.brand?(BRAND_LABELS[it.brand]||it.brand)+' ':'';
    return mk+(it.label||'')+(it.talla?` talla ${it.talla}`:'');
  }).filter(Boolean);
  const lista=items.length?items.join(', '):interesadoEn(o.session_id).join(', ');
  const saludo=nombre?`¡Hola ${nombre}! 👋`:'¡Hola! 👋';
  const vio=lista?` Vi que te interesó: ${lista} 👟`:' Vi que estuviste mirando nuestros sneakers 👟';
  const msg=`${saludo} Te escribo de ${STORE_NAME}.${vio}\n\n¿Te ayudo a completar tu pedido? 🙌 Pagando en línea el *envío es GRATIS*, o si prefieres *contra entrega* pagas solo el envío hoy y los zapatos al recibir en casa. ¿Te lo aparto?`;
  return `https://wa.me/57${tel}?text=${encodeURIComponent(msg)}`;
}
// Suscriptor con cupón de bienvenida vigente: recordatorio con su vencimiento.
function waCuponSub(s){
  const wa=String(s.whatsapp||'').replace(/\D/g,'');const tel=wa.length===10?wa:wa.slice(-10);
  if(tel.length<10)return null;
  const nombre=(s.nombre||'').trim().split(/\s+/)[0]||'';
  const v=cuponVigencia(s.welcome_issued_at||s.created_at);
  const vig=v&&!v.vencido?(v.dias<=1?'vence HOY':`vence en ${v.dias} días`):'está por vencer';
  const mira=interesadoEn(s.session_id);
  const vio=mira.length?` Vi que te gustó: ${mira.join(', ')} 👟.`:'';
  // El mensaje lleva SU código único; los suscriptores viejos (sin welcome_code) siguen con el genérico.
  const cod=s.welcome_code||'BIENVENIDO20';
  const msg=`¡Hola ${nombre}! 👋 Soy de ${STORE_NAME}.${vio}\n\nTu cupón *${cod}* de $20.000 OFF ${vig} ⏰ ¿Aprovechas y escoges tu par? Pagando en línea el *envío es GRATIS*; también puedes pedir *contra entrega* 🙌`;
  return `https://wa.me/57${tel}?text=${encodeURIComponent(msg)}`;
}
// Suscriptor con cupón VENCIDO que acabamos de REACTIVAR: mensaje win-back (le damos 7 días más).
function waRecuperarSub(s){
  const wa=String(s.whatsapp||'').replace(/\D/g,'');const tel=wa.length===10?wa:wa.slice(-10);
  if(tel.length<10)return null;
  const nombre=(s.nombre||'').trim().split(/\s+/)[0]||'';
  const mira=interesadoEn(s.session_id);
  const vio=mira.length?` Vi que te gustó: ${mira.join(', ')} 👟.`:'';
  const cod=s.welcome_code||'BIENVENIDO20';
  const msg=`¡Hola ${nombre}! 👋 Soy de ${STORE_NAME}.${vio}\n\n¡Buenas noticias! 🎉 Te REACTIVÉ tu cupón *${cod}* de $20.000 OFF por 7 días más ⏰ Sé que se te había vencido, así que aquí tienes otra oportunidad 🙌 ¿Escoges tu par? Pagando en línea el *envío es GRATIS*; también puedes pedir *contra entrega*.`;
  return `https://wa.me/57${tel}?text=${encodeURIComponent(msg)}`;
}
// Suscriptores cuyo cupón se reactivó en esta sesión del panel → muestran el mensaje win-back.
const cuponReactivado=new Set();
// ¿El suscriptor ya compró? Cruza su WhatsApp con los pedidos 'venta' (por teléfono, últimos 10
// dígitos). Devuelve {cupon} si compró: cupon = código usado (o null si compró sin descuento).
function subUsoCupon(s){
  if(typeof orders==='undefined'||!Array.isArray(orders))return null;
  const wa=String(s.whatsapp||'').replace(/\D/g,'').slice(-10);
  if(wa.length<10)return null;
  const venta=orders.find(o=>o.status==='venta'&&String(o.tel||'').replace(/\D/g,'').slice(-10)===wa);
  return venta?{cupon:venta.cupon||null}:null;
}
// Reactivar el cupón (server) y, al volver a pintar, ofrecer el botón de WhatsApp win-back.
async function reactivarCupon(id,btn){
  try{
    if(btn){btn.disabled=true;btn.textContent='Reactivando…';}
    await adminWrite('reissue_welcome',{id});
    const s=(subsData||[]).find(x=>x.id===id);
    // Espejo local de lo que hizo el server: vigencia nueva Y uso desmarcado (código reutilizable).
    if(s){s.welcome_issued_at=new Date().toISOString();s.welcome_used_at=null;}
    cuponReactivado.add(id);
    renderSubsTab();
  }catch(e){
    alert('No se pudo reactivar: '+e.message);
    if(btn){btn.disabled=false;btn.textContent='🔄 Reactivar cupón $20.000';}
  }
}
function timelineHTML(sid){
  const evs=(activityBySession[sid]||[]).slice().reverse();   // cronológico
  if(!evs.length)return `<div style="font-size:11px;color:var(--ink3);padding:8px 0">Sin actividad registrada en esa visita.</div>`;
  const fuente=evs.map(e=>e.utm_source).find(Boolean);
  const dev=evs.map(e=>e.device).find(Boolean);
  const ctx=[fuente?('📣 '+(FUENTES[fuente]||fuente)):'',dev?(dev==='movil'?'📱 móvil':'🖥 escritorio'):''].filter(Boolean).join(' · ');
  return `${ctx?`<div style="font-size:10px;color:var(--ink3);margin-bottom:5px">${escHtml(ctx)}</div>`:''}
    ${evs.map(e=>{
      const h=new Date(e.created_at).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
      const det=(e.type==='page_view'||e.type==='initiate_checkout'||e.type==='lead'||e.type==='popup_shown'||e.type==='reached_payment')?'':resolveProdName(e.product_id);
      return `<div style="display:flex;gap:8px;font-size:11px;color:var(--ink2);padding:3px 0">
        <span style="color:var(--ink3);flex:0 0 auto">${h}</span>
        <span>${EV_LABELS[e.type]||e.type}${det?` <b>${escHtml(det)}</b>`:''}${e.price&&e.type!=='page_view'?` <span style="color:var(--ink3)">(${fmt(e.price)})</span>`:''}</span>
      </div>`;
    }).join('')}`;
}

function togActividad(key){
  const d=$('act_'+key);if(!d)return;
  d.style.display=d.style.display==='none'?'block':'none';
}

function renderSubsTab(){
  const el=$('subsList');if(!el)return;
  if(subsData===null){el.innerHTML='<div style="padding:24px;text-align:center;color:var(--ink3);font-size:12px">Cargando…</div>';return;}
  if(!subsData.length){el.innerHTML='<div style="padding:24px;text-align:center;color:var(--ink3);font-size:12px">Aún no hay suscriptores.<br>Aparecen aquí cuando alguien deja sus datos en el popup de bienvenida o el newsletter.</div>';return;}
  // Recorrido: pedir la actividad de las sesiones aún no cargadas y re-pintar al llegar.
  loadActivity(subsData.map(s=>s.session_id)).then(ok=>{if(ok&&avSec==='suscriptores')renderSubsTab();});
  const fGen=g=>g==='h'?'Él':g==='m'?'Ella':'';
  const head=`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--white);z-index:1">
    <div style="font-size:12px;font-weight:800">${subsData.length} suscriptor${subsData.length===1?'':'es'}</div>
    <button class="admin-pill" style="font-size:10px;padding:6px 11px" onclick="exportSubsCSV()">⬇ CSV para Meta (Custom Audience)</button>
  </div>`;
  el.innerHTML=head+subsData.map(s=>{
    const u=s.utm||{};
    const camp=u.utm_campaign||(u.campaign_id&&!/\{\{/.test(String(u.campaign_id))?('camp '+u.campaign_id):'')||'orgánico';
    const wa=(s.whatsapp||'').replace(/\D/g,'');
    const contacto=wa
      ?`<a href="https://wa.me/${wa.length===10?'57'+wa:wa}" target="_blank" rel="noopener" style="color:var(--ink);font-weight:700;text-decoration:none">📱 ${escHtml(s.whatsapp)}</a>`
      :(s.email?'✉️ '+escHtml(s.email):'—');
    const pref=[s.talla?('👟 '+escHtml(s.talla)):'',fGen(s.genero)].filter(Boolean).join(' · ');
    const f=s.created_at?new Date(s.created_at).toLocaleDateString('es-CO',{day:'2-digit',month:'short'}):'';
    // Badge del cupón: "usado" manda sobre la vigencia (un código gastado no "vence", ya se gastó).
    const cupon=s.source==='popup_bienvenida'
      ?(s.welcome_used_at?`<span style="font-size:9.5px;font-weight:700;color:var(--green)">🎟 cupón usado ✓</span>`:cuponBadge(s.welcome_issued_at||s.created_at))
      :'';
    // Código único del suscriptor (los viejos no tienen: usan el genérico BIENVENIDO20).
    const codigoLinea=s.welcome_code
      ?`<div style="font-size:10px;color:var(--ink3);margin-top:2px">🎟 <b style="font-weight:700;color:var(--ink2)">${escHtml(s.welcome_code)}</b></div>`
      :(s.source==='popup_bienvenida'?`<div style="font-size:10px;color:var(--ink3);margin-top:2px">🎟 BIENVENIDO20 (genérico)</div>`:'');
    const compra=subUsoCupon(s);
    const compraBadge=compra?`<span style="font-size:9.5px;font-weight:700;color:var(--green)">${compra.cupon?'✅ usó '+escHtml(compra.cupon):'🛍 ya compró'}</span>`:'';
    const tieneAct=!!(activityBySession[s.session_id]||[]).length;
    return `<div style="padding:10px 14px;border-bottom:1px solid var(--line)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;${tieneAct?'cursor:pointer':''}" ${tieneAct?`onclick="togActividad('s_${s.id}')"`:''}>
        <div style="min-width:0">
          <div style="font-size:12.5px;font-weight:700">${escHtml(s.nombre||'(sin nombre)')}</div>
          <div style="font-size:11px;color:var(--ink2);margin-top:2px" onclick="event.stopPropagation()">${contacto}</div>
          ${codigoLinea}
          <div style="font-size:10px;color:var(--ink3);margin-top:2px">📣 ${escHtml(camp)}${u.src_app?' · '+escHtml(srcAppLabel(u.src_app)):''} · ${escHtml(s.source||'')}</div>
          ${interesadoEnLinea(s.session_id)}
        </div>
        <div style="text-align:right;flex:0 0 auto">
          <div style="font-size:11px;font-weight:700">${pref||'—'}</div>
          <div style="font-size:10px;color:var(--ink3);margin-top:2px">${f}</div>
          ${compraBadge?`<div style="margin-top:2px">${compraBadge}</div>`:(cupon?`<div style="margin-top:2px">${cupon}</div>`:'')}
          ${tieneAct?`<div style="font-size:9.5px;color:var(--blue);font-weight:700;margin-top:3px">👁 ver recorrido</div>`:''}
        </div>
      </div>
      ${(()=>{
        // Ya compró → no perseguir con cupón.
        if(compra)return '';
        if(s.source!=='popup_bienvenida')return '';
        const v=cuponVigencia(s.welcome_issued_at||s.created_at);
        if(!v)return '';
        const waStyle='display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;background:var(--wa);color:#fff;text-decoration:none;padding:8px;border-radius:9px;font-size:11.5px;font-weight:700';
        if(!v.vencido&&!s.welcome_used_at){
          // Vigente y sin gastar: si se acaba de reactivar, mensaje win-back; si no, recordatorio normal.
          const reac=cuponReactivado.has(s.id);
          const u=reac?waRecuperarSub(s):waCuponSub(s);
          if(!u)return '';
          return `<a href="${u}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="${waStyle}">💬 ${reac?'Escribir: ¡cupón reactivado!':'Recordar cupón por WhatsApp'}</a>`;
        }
        // Vencido O ya usado: botón para reactivar (renueva 7 días y desmarca el uso) — luego
        // aparece el de WhatsApp. "Usado" sin venta cruzada por teléfono pasa por aquí también.
        const wa=String(s.whatsapp||'').replace(/\D/g,'');
        if((wa.length===10?wa:wa.slice(-10)).length<10)return '';
        return `<button onclick="event.stopPropagation();reactivarCupon(${s.id},this)" style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;width:100%;border:none;cursor:pointer;background:#5D2D91;color:#fff;padding:8px;border-radius:9px;font-size:11.5px;font-weight:700">🔄 Reactivar cupón $20.000</button>`;
      })()}
      ${tieneAct?`<div id="act_s_${s.id}" style="display:none;margin-top:8px;padding:8px 10px;background:var(--bg);border-radius:9px">${timelineHTML(s.session_id)}</div>`:''}
    </div>`;
  }).join('');
}

// CSV con el formato de Meta Custom Audience (phone con indicativo 57, fn/ln en minúscula).
// Se sube en: Audiencias → Crear audiencia personalizada → Lista de clientes.
function exportSubsCSV(){
  const rows=subsData||[];
  const lines=['phone,fn,ln,email'];
  rows.forEach(s=>{
    const wa=(s.whatsapp||'').replace(/\D/g,'');
    const phone=wa?(wa.length===10?'57'+wa:wa):'';
    const np=String(s.nombre||'').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const fn=np[0]||'',ln=np.slice(1).join(' ');
    const email=(s.email||'').trim().toLowerCase();
    if(phone||email)lines.push([phone,fn,ln,email].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(','));
  });
  const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='suscriptores_meta_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);a.click();a.remove();
  URL.revokeObjectURL(a.href);
}

function setLeadFilter(f){leadFilter=f;renderLeadsTab();}

function setLeadVista(v){leadVista=v;renderLeadsTab();}

function renderLeadsTab(){
  const el=$('panLeads');if(!el)return;
  if(!orders.length){
    el.innerHTML=`<div style="padding:32px 20px;text-align:center;color:var(--ink3);font-size:13px;line-height:1.7">
      🎯 Aún no hay leads.<br>Cada pedido que un cliente envíe<br>aparecerá aquí para marcarlo.
    </div>`;
    return;
  }
  // Recorrido: actividad de las sesiones de los pedidos visibles (batch, re-pinta al llegar).
  loadActivity(orders.map(o=>o.session_id)).then(ok=>{if(ok&&avSec==='leads')renderLeadsTab();});
  // Pedidos de prueba (modo prueba) van aparte: no cuentan en los filtros normales ni en "Todos";
  // solo aparecen bajo el filtro 🧪 y se borran en bloque.
  const esTest=o=>!!(o.utm&&o.utm.test);
  const reales=orders.filter(o=>!esTest(o));
  const nPend=reales.filter(o=>!_isClasificado(o)&&o.status!=='abandoned').length;
  const nVta =reales.filter(o=>o.status==='venta').length;
  const nNo  =reales.filter(o=>o.status==='no_venta').length;
  const nAban=reales.filter(o=>o.status==='abandoned').length;
  const nTest=orders.filter(esTest).length;
  const lista=leadFilter==='test'?orders.filter(esTest):reales.filter(o=>leadFilter==='all'?true:leadFilter==='pending'?(!_isClasificado(o)&&o.status!=='abandoned'):o.status===leadFilter);
  const chip=(f,txt,n,col)=>`<button onclick="setLeadFilter('${f}')" style="flex:1;padding:7px 4px;border:none;border-radius:9px;font-family:var(--font);font-size:11px;font-weight:700;cursor:pointer;background:${leadFilter===f?col:'#F2F1EE'};color:${leadFilter===f?'#fff':'#6B6B67'}">${txt} ${n}</button>`;
  const pagoLabels={contra_entrega:'Contra entrega',pago_anticipado:'Pago anticipado',wompi:'Wompi',bold:'Bold',credito:'Crédito (Addi/Sistecrédito)',nequi:'Nequi',bancolombia:'Bancolombia',addi:'Addi',sistecredito:'Sistecrédito'};
  const itemsTxt=o=>Array.isArray(o.items)?o.items.map(it=>`${escHtml(it.label||'?')}${it.qty?` x${parseInt(it.qty)||1}`:''}`).join(', '):'';
  const badge=o=>o.status==='venta'?`<span style="background:var(--green);color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px">✓ VENTA</span>`
    :o.status==='no_venta'?`<span style="background:#E8200A;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px">✕ NO VENTA</span>`
    :o.status==='abandoned'?`<span style="background:#8A6D00;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px">🛒 ABANDONÓ</span>`
    :`<span style="background:#F2A900;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px">⏳ PENDIENTE</span>`;
  // Etiqueta del MOVIMIENTO del lead (entre paréntesis, al lado del nombre) para identificar en
  // qué punto del recorrido quedó: abandonó antes de pagar, está en espera (WhatsApp/contra
  // entrega) o intentó una pasarela y no la completó (rechazo de crédito / abandono en la pasarela).
  const movLead=o=>{
    let t='',c='var(--ink3)';
    if(o.status==='abandoned'){t='(abandono)';c='#8A6D00';}
    else if(o.status==='pending'){
      if(o.utm&&o.utm.gateway_result==='rejected'){t='(crédito rechazado)';c='#E8200A';}
      else if(['contra_entrega','pago_anticipado'].includes(o.pago)){t='(en espera)';c='#B3791E';}
      else if(['wompi','bold','addi','sistecredito'].includes(o.pago)){t='(pasarela sin completar)';c='#E8200A';}
      else {t='(en espera)';c='#B3791E';}
    }
    return t?` <span style="font-size:11px;font-weight:600;color:${c}">${t}</span>`:'';
  };
  // Badge del método de pago, AHORA consciente del estado: solo dice "Pagado" si es venta real.
  // Un pendiente de pasarela = intentó y no completó (antes decía "Pagado" por error).
  const pagoBadge=o=>{
    if(!o.pago)return '';
    const gw=['wompi','bold','addi','sistecredito'].includes(o.pago);
    const manual=['contra_entrega','pago_anticipado','nequi','bancolombia'].includes(o.pago);
    let pre='',bg='background:#eee;color:#666';
    if(o.status==='venta'){pre=gw?'💳 Pagado · ':'✓ Confirmado · ';bg='background:#E7F6EC;color:#1BA94C';}
    else if(gw){pre='⚠️ Sin completar · ';bg='background:#FDEAE8;color:#E8200A';}
    else if(manual){pre='⏳ Por confirmar · ';bg='background:#FFF4E0;color:#B3791E';}
    return `<br><span style="display:inline-block;margin-top:4px;font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;${bg}">${pre}${escHtml(pagoLabels[o.pago]||o.pago)}</span>`;
  };
  const cardLead=o=>`
      <div style="background:var(--bg);border-radius:12px;padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:14px;font-weight:700">${esTest(o)?'🧪 ':''}${escHtml(o.nombre||'Sin nombre')}${movLead(o)}</span>
          ${esTest(o)?`<span style="background:#b91c1c;color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px">🧪 PRUEBA</span>`:badge(o)}
        </div>
        <div style="font-size:12px;color:var(--ink2);line-height:1.6">
          ${o.tel?`📱 <a href="https://wa.me/57${String(o.tel).replace(/\D/g,'').slice(-10)}" target="_blank" style="color:var(--blue);text-decoration:none">${escHtml(o.tel)}</a><br>`:''}
          ${o.ciudad?`📍 ${escHtml(o.ciudad)}${o.barrio?', '+escHtml(o.barrio):''}<br>`:''}
          ${itemsTxt(o)?`👟 ${itemsTxt(o)}<br>`:''}
          💰 <b>${fmt(o.total||0)}</b>${o.combo?` · <b style="color:#b3541e">🏆 ${escHtml(o.combo)}</b>`:''}
          ${pagoBadge(o)}
          ${o.utm&&o.utm.utm_campaign?`<br>📣 <span style="color:#5D2D91;font-weight:600">${escHtml(o.utm.utm_campaign)}</span>${o.utm.utm_content?` · ad: ${escHtml(o.utm.utm_content)}`:''}${o.utm.src_app?` · ${escHtml(srcAppLabel(o.utm.src_app))}`:''}`:(o.utm&&o.utm.src_app?`<br>${escHtml(srcAppLabel(o.utm.src_app))}`:'')}
          ${o.fecha?`<br><span style="color:var(--ink3);font-size:10px">${new Date(o.fecha).toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>`:''}
        </div>
        ${interesadoEnLinea(o.session_id)}
        ${(activityBySession[o.session_id]||[]).length?`<div onclick="togActividad('o_${o.id}')" style="font-size:10px;color:var(--blue);font-weight:700;margin-top:5px;cursor:pointer">👁 Ver recorrido en la tienda</div>
        <div id="act_o_${o.id}" style="display:none;margin-top:6px;padding:8px 10px;background:var(--white);border-radius:9px">${timelineHTML(o.session_id)}</div>`:''}
        ${o.motivo_no_venta?`<div style="font-size:11px;color:#b3541e;background:#fdf3ec;border-radius:8px;padding:6px 9px;margin-top:7px">✕ Motivo: ${escHtml(o.motivo_no_venta)}</div>`:''}
        ${o.nota?`<div style="font-size:11px;color:var(--ink2);background:#fffbe8;border-radius:8px;padding:6px 9px;margin-top:6px">📝 ${escHtml(o.nota)}</div>`:''}
        <div style="display:flex;gap:5px;margin-top:9px;flex-wrap:wrap">
          ${chipWa(o)}${chipTemp(o)}${chipSeg(o)}
          <button onclick="leadNota(${o.id})" style="padding:6px 10px;border:1px solid var(--line);border-radius:14px;background:var(--white);font-family:var(--font);font-size:10.5px;font-weight:700;color:var(--ink2);cursor:pointer">📝 Nota</button>
        </div>
        ${(o.status!=='venta'&&o.status!=='no_venta'&&waRescate(o))?`<a href="${waRescate(o)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="display:flex;align-items:center;justify-content:center;gap:7px;margin-top:9px;background:var(--wa);color:#fff;text-decoration:none;padding:10px;border-radius:10px;font-size:12.5px;font-weight:700">💬 Recuperar por WhatsApp</a>`:''}
        <div style="display:flex;gap:6px;margin-top:9px">
          <button onclick="updateOrderStatus(${o.id},'venta')" style="flex:1;padding:9px;border:none;border-radius:9px;font-family:var(--font);font-size:12px;font-weight:700;cursor:pointer;background:${o.status==='venta'?'#1BA94C':'#E7F6EC'};color:${o.status==='venta'?'#fff':'#1BA94C'}">✓ Venta</button>
          <button onclick="updateOrderStatus(${o.id},'no_venta')" style="flex:1;padding:9px;border:none;border-radius:9px;font-family:var(--font);font-size:12px;font-weight:700;cursor:pointer;background:${o.status==='no_venta'?'#E8200A':'#FDEAE8'};color:${o.status==='no_venta'?'#fff':'#E8200A'}">✕ No venta</button>
          <button onclick="deleteOrder(${o.id})" title="Borrar pedido" style="flex:0 0 auto;padding:9px 12px;border:1px solid var(--line);border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;background:var(--white);color:#E8200A">🗑</button>
        </div>
      </div>`;
  el.innerHTML=`<div style="display:flex;gap:5px;padding:12px 14px 8px;flex-wrap:wrap">
      ${chip('pending','⏳ Por hacer',nPend,'#F2A900')}${chip('venta','✓ Ventas',nVta,'#1BA94C')}${chip('no_venta','✕',nNo,'#E8200A')}${chip('abandoned','🛒',nAban,'#8A6D00')}${chip('all','Todos',reales.length,'#0E0E0C')}${nTest?chip('test','🧪',nTest,'#b91c1c'):''}
    </div>
    ${(leadFilter==='test'&&nTest)?`<div style="padding:0 14px 8px"><button onclick="deleteAllTests()" style="width:100%;padding:10px;border:none;border-radius:10px;background:#b91c1c;color:#fff;font-family:var(--font);font-size:12.5px;font-weight:700;cursor:pointer">🗑 Borrar todas las pruebas (${nTest})</button></div>`:''}
    <div style="padding:0 14px">${_vistaChips(leadVista,'setLeadVista')}</div>
    <div style="overflow-y:auto;flex:1;min-height:0;padding:0 14px 16px">
    ${lista.length?_renderGrupos(lista,leadVista,cardLead,'lead','var(--bg)'):`<div style="padding:24px;text-align:center;color:var(--ink3);font-size:12px">No hay leads en esta categoría.</div>`}
    </div>`;
}

async function updateOrderStatus(id,status){
  const o=orders.find(x=>x.id===id);if(!o)return;
  // NO VENTA exige el MOTIVO (contexto para remarketing y para aprender qué falla).
  // Cancelar el prompt = NO se marca. Vacío = se vuelve a pedir.
  if(status==='no_venta'&&o.status!=='no_venta'){
    let motivo=null;
    while(true){
      motivo=prompt('MOTIVO de la no venta (obligatorio):\nprecio · talla · desconfianza · dejó de responder · envío · pago…',o.motivo_no_venta||'');
      if(motivo===null)return;            // canceló → no se marca
      motivo=motivo.trim();
      if(motivo)break;                    // vacío → repreguntar
    }
    await updateOrderMeta(id,{motivo_no_venta:motivo});
  }
  const prev=o.status;o.status=status;renderLeadsTab();
  try{
    await adminWrite('update_order',{id,data:{status}});
    // Venta recién cerrada → ofrecer agotar sus productos AQUÍ MISMO. Si se deja "para
    // después", nadie lo marca y el feed de Meta sigue pautando un par que ya no existe.
    if(status==='venta'&&prev!=='venta')ofrecerAgotarVendidos(o);
  }
  catch(e){o.status=prev;renderLeadsTab();alert('No se pudo guardar: '+e.message);}
}

async function deleteOrder(id){
  const o=orders.find(x=>x.id===id);
  if(!confirm('¿Borrar este pedido definitivamente?'+(o?'\n\n'+(o.nombre||'Sin nombre')+' · '+fmt(o.total||0):'')))return;
  try{
    await adminWrite('delete_order',{id});
    orders=orders.filter(x=>x.id!==id);
    renderLeadsTab();
  }catch(e){alert('No se pudo borrar: '+e.message);}
}

async function deleteAllTests(){
  const n=orders.filter(o=>o.utm&&o.utm.test).length;
  if(!n){alert('No hay pedidos de prueba.');return;}
  if(!confirm('¿Borrar TODOS los '+n+' pedidos de prueba?\nEsto no se puede deshacer.'))return;
  try{
    const r=await adminWrite('delete_test_orders',{});
    orders=orders.filter(o=>!(o.utm&&o.utm.test));
    if(leadFilter==='test')leadFilter='pending';
    renderLeadsTab();
    alert('✅ Borrados '+((r&&r.deleted!=null)?r.deleted:n)+' pedidos de prueba.');
  }catch(e){alert('No se pudo borrar: '+e.message);}
}

function cycleLeadField(id,campo){
  const o=orders.find(x=>x.id===id);if(!o)return;
  const estados=campo==='wa_status'?WA_STATES:TEMP_STATES;
  const idx=estados.indexOf(o[campo]||null);
  const nuevo=estados[(idx+1)%estados.length];
  updateOrderMeta(id,{[campo]:nuevo});
}

function leadNota(id){
  const o=orders.find(x=>x.id===id);if(!o)return;
  const nota=prompt('Nota interna del vendedor:',o.nota||'');
  if(nota===null)return;
  updateOrderMeta(id,{nota:nota.trim()||null});
}

function leadSeguimiento(id){
  const o=orders.find(x=>x.id===id);if(!o)return;
  const actual=o.seguimiento?o.seguimiento.split('-').reverse().join('/'):'';
  const v=prompt('Fecha de seguimiento (dd/mm/aaaa).\nDeja vacío para quitarla:',actual);
  if(v===null)return;
  const t=v.trim();
  if(!t){updateOrderMeta(id,{seguimiento:null});return;}
  const m=t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m){alert('Formato inválido. Usa dd/mm/aaaa (ej. 15/06/2026).');return;}
  const dd=parseInt(m[1]),mm=parseInt(m[2]),yy=parseInt(m[3]);
  const f=new Date(yy,mm-1,dd);
  if(f.getDate()!==dd||f.getMonth()!==mm-1||f.getFullYear()!==yy){alert('Esa fecha no existe.');return;}
  const iso=`${yy}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
  updateOrderMeta(id,{seguimiento:iso});
}

async function updateOrderMeta(id,campos){
  const o=orders.find(x=>x.id===id);if(!o)return;
  const prev={};Object.keys(campos).forEach(k=>prev[k]=o[k]);
  Object.assign(o,campos);renderLeadsTab();
  try{await adminWrite('update_order_meta',{id,data:campos});}
  catch(e){Object.assign(o,prev);renderLeadsTab();alert('No se pudo guardar: '+e.message);}
}

function startEP(id,type){
  document.querySelectorAll('.ep-row').forEach(r=>r.style.display='none');
  const row=$(type==='liq'?'epl'+id:'ep'+id);
  if(row){row.style.display='flex';$(type==='liq'?'epli'+id:'epi'+id).focus();}
}

async function saveEP(id,type){
  const iid=type==='liq'?'epli'+id:'epi'+id;
  const val=parseInt($(iid).value);
  if(!val||val<1000)return;
  const list=type==='liq'?liqs:prods;
  const p=list.find(x=>x.id===id);
  const data={price:val};
  // La marca solo aplica a productos del catálogo (no liquidación)
  if(type==='cat'){
    const sel=$('epb'+id);
    const brand=sel?sel.value:'';
    if(p)p.brand=brand;
    data.brand=brand||null;
  }
  // Modelo (público) — título de ficha, tarjeta, ticket de WhatsApp y feed de Meta
  const mEl=$(type==='liq'?'eplm'+id:'epm'+id);
  if(mEl){const modelo=mEl.value.trim();if(p)p.modelo=modelo;data.modelo=modelo||null;}
  // Costo (privado): LEER el input ANTES de renderAdmin(), que destruye la fila de edición.
  // (Bug histórico: se leía después del re-render → el input ya no existía → el costo no se guardaba.)
  const cEl=$(type==='liq'?'eplc'+id:'epc'+id);
  const costRaw=cEl?cEl.value.trim():null;   // null = sin input → no tocar el costo
  if(p)p.price=val;
  renderGrid();renderPreview();renderFeatured();type==='liq'?renderLiqAdmin():renderAdmin();
  await adminWrite('update_product',{table:type==='liq'?'liq_products':'products',id,data});
  // Costo → tabla product_costs vía service_role (para el margen del Inicio)
  if(costRaw!==null){
    const ptype=type==='liq'?'liq':'cat';
    const key=ptype+':'+id;
    const nuevo=costRaw===''?null:parseInt(costRaw);
    if((costos[key]??null)!==(nuevo??null)){
      if(nuevo===null)delete costos[key]; else costos[key]=nuevo;
      type==='liq'?renderLiqAdmin():renderAdmin();   // refresca el badge de costo al instante
      await adminWrite('upsert_cost',{data:{ptype,pid:id,costo:nuevo}}).catch(()=>{});
    }
  }
}

/* Costos privados: mapa 'cat:ID'/'liq:ID' → costo. Se cargan al abrir el admin. */
let costos={};

async function loadCosts(){
  try{
    const r=await adminWrite('list_costs',{});
    costos={};
    (r.costs||[]).forEach(c=>{costos[c.ptype+':'+c.pid]=c.costo;});
  }catch(e){}
}

function cancelEP(){document.querySelectorAll('.ep-row').forEach(r=>r.style.display='none');}

/* ── STOCK POR TALLA en admin ── tallas = jsonb {talla:stock}. Vacío/null = sin rastreo (la tienda
   deriva las tallas por género, todas disponibles). 0 = agotada (se muestra tachada en la ficha). */
function tallasBadge(p){
  if(p && p.tallas && typeof p.tallas==='object' && !Array.isArray(p.tallas)){
    return Object.values(p.tallas).filter(n=>Number(n)>0).length;   // nº de tallas disponibles
  }
  return '';
}
function defaultSizes(p,dest){
  if(p && p.tallas && typeof p.tallas==='object' && !Array.isArray(p.tallas)){
    const k=Object.keys(p.tallas);if(k.length)return k.sort((a,b)=>(parseFloat(a)||0)-(parseFloat(b)||0));
  }
  if(dest==='liq')return ['36','37','38','39','40','41','42','43','44'];
  if(p&&p.g==='m')return ['36','37','38','39'];
  if(p&&p.g==='h')return ['40','41','42','43','44'];
  return ['36','37','38','39','40','41','42','43','44'];   // unisex / desconocido
}
function togTallas(id,dest){
  const el=$('tallas'+dest+id);if(!el)return;
  const open=el.style.display!=='none';
  el.style.display=open?'none':'block';
  if(!open)renderTallasEditor(id,dest);
}
function renderTallasEditor(id,dest){
  const list=dest==='liq'?liqs:prods;const p=list.find(x=>x.id===id);
  const el=$('tallas'+dest+id);if(!p||!el)return;
  const cur=(p.tallas&&typeof p.tallas==='object'&&!Array.isArray(p.tallas))?p.tallas:null;
  const sizes=defaultSizes(p,dest);
  el.innerHTML=`<div style="font-size:11px;color:var(--ink3);margin-bottom:6px">Stock por talla. <b>Vacío = sin rastreo</b> (se deriva por género, todas disponibles). <b>0 = agotada</b> (se muestra tachada).</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${sizes.map(t=>`<label style="display:flex;flex-direction:column;align-items:center;font-size:10px;color:var(--ink2);font-weight:700">${escHtml(t)}<input type="number" min="0" inputmode="numeric" id="tk${dest}${id}_${escHtml(t)}" value="${cur&&cur[t]!=null?cur[t]:''}" style="width:46px;padding:5px;margin-top:2px;border:1.5px solid var(--line);border-radius:7px;text-align:center;font-family:var(--font);font-size:12px"></label>`).join('')}</div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="ep-save" onclick="saveTallas(${id},'${dest}')">Guardar stock</button>
      <button class="ep-cancel" onclick="clearTallas(${id},'${dest}')" title="Quitar rastreo de inventario">Sin rastreo</button>
    </div>`;
}
async function saveTallas(id,dest){
  const list=dest==='liq'?liqs:prods;const p=list.find(x=>x.id===id);if(!p)return;
  const sizes=defaultSizes(p,dest);const tallas={};
  sizes.forEach(t=>{const el=$('tk'+dest+id+'_'+t);const v=el?String(el.value).trim():'';if(v!=='')tallas[t]=Math.max(0,parseInt(v)||0);});
  const val=Object.keys(tallas).length?tallas:null;
  p.tallas=val;
  await adminWrite('update_product',{table:dest==='liq'?'liq_products':'products',id,data:{tallas:val}});
  togTallas(id,dest);dest==='liq'?renderLiqAdmin():renderAdmin();renderGrid();
}
async function clearTallas(id,dest){
  const list=dest==='liq'?liqs:prods;const p=list.find(x=>x.id===id);if(p)p.tallas=null;
  await adminWrite('update_product',{table:dest==='liq'?'liq_products':'products',id,data:{tallas:null}}).catch(()=>{});
  togTallas(id,dest);dest==='liq'?renderLiqAdmin():renderAdmin();renderGrid();
}

/* ── METACAMPOS + SEO por producto (columna meta jsonb, migración 007) ──
   El hueco "metafields" de Shopify: datos propios por producto sin tocar el esquema nunca más.
   Pares clave→valor libres (se ven en la ficha como "Detalles del producto") + bloque SEO
   estilo Shopify: título de página (≤70), metadescripción (≤160) e identificador de URL
   (handle). El server (limpiarMeta en api/admin.js) re-impone forma y límites por si acaso.
   ⚠️ TODO lo que se guarda aquí es PÚBLICO: la tabla products la lee cualquier visitante con
   la anon key (select *) — mismo motivo por el que el costo vive aparte en product_costs.
   Nada privado. El editor muestra el aviso a la vista. */
function _metaDe(p){return (p&&p.meta&&typeof p.meta==='object'&&!Array.isArray(p.meta))?p.meta:{};}

function metaBadge(p){   // nº de datos guardados (metacampos + 1 si hay SEO) para el botón 🏷
  const m=_metaDe(p);
  const seo=(m.seo&&typeof m.seo==='object'&&!Array.isArray(m.seo))?m.seo:null;
  const n=Object.keys(m).filter(k=>k!=='seo').length+((seo&&(seo.title||seo.description||seo.handle))?1:0);
  return n||'';
}

// Mismo slug que el front (router.js _slug) y el server (limpiarMeta): lo que se previsualiza
// aquí es EXACTAMENTE lo que quedará en la URL.
function slugSeo(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60);}

function togMeta(id,dest){
  const el=$('meta'+dest+id);if(!el)return;
  const open=el.style.display!=='none';
  el.style.display=open?'none':'block';
  if(!open)renderMetaEditor(id,dest);
}

// Contador estilo Shopify: "12 de 70 caracteres usados" (se pasa de rojo si excede, aunque
// maxlength ya lo impide al teclear — pegar texto largo sí puede exceder y ahí se recorta al guardar).
function cntSeo(el,cid,max){
  const c=$(cid);if(!c)return;
  const n=el.value.length;
  c.textContent=n+' de '+max+' caracteres usados';
  c.style.color=n>max?'#E8200A':'var(--ink3)';
}

function previewHandle(el,id,dest){
  const pv=$('mshp'+dest+id);if(!pv)return;
  pv.innerHTML='URL: strangesneakers.com/p/'+(dest==='liq'?'L':'')+id+'-<b>'+(slugSeo(el.value)||'…')+'</b>';
}

function metaParRow(k,v){
  const inp='padding:7px 9px;border:1.5px solid var(--line);border-radius:8px;font-family:var(--font);font-size:12px;color:var(--ink)';
  return `<div class="meta-par" style="display:flex;gap:6px;margin-bottom:6px">
    <input class="mk" type="text" maxlength="40" placeholder="clave (ej. material)" value="${escHtml(k)}" style="${inp};flex:0 0 36%;min-width:0">
    <input class="mv" type="text" maxlength="300" placeholder="valor (ej. cuero sintético)" value="${escHtml(String(v==null?'':v))}" style="${inp};flex:1;min-width:0">
    <button onclick="this.parentElement.remove()" title="Quitar este campo (se borra al Guardar)" style="border:none;background:none;color:#E8200A;font-weight:700;cursor:pointer;flex:0 0 auto">✕</button>
  </div>`;
}

function metaAddPar(id,dest){
  const box=$('mrows'+dest+id);if(!box)return;
  box.insertAdjacentHTML('beforeend',metaParRow('',''));
  const rows=box.querySelectorAll('.meta-par .mk');
  if(rows.length)rows[rows.length-1].focus();
}

function renderMetaEditor(id,dest){
  const list=dest==='liq'?liqs:prods;const p=list.find(x=>x.id===id);
  const el=$('meta'+dest+id);if(!p||!el)return;
  const m=_metaDe(p);
  const seo=(m.seo&&typeof m.seo==='object'&&!Array.isArray(m.seo))?m.seo:{};
  const pares=Object.entries(m).filter(([k,v])=>k!=='seo'&&v!=null&&typeof v!=='object');
  const t=typeof seo.title==='string'?seo.title:'',d=typeof seo.description==='string'?seo.description:'',h=typeof seo.handle==='string'?seo.handle:'';
  const inp='width:100%;padding:7px 9px;border:1.5px solid var(--line);border-radius:8px;font-family:var(--font);font-size:12px;color:var(--ink);box-sizing:border-box';
  const cnt='font-size:10px;color:var(--ink3);text-align:right;margin-top:2px';
  el.innerHTML=`
    <div style="font-size:11px;color:#b3541e;background:#fdf3ec;border-radius:8px;padding:7px 10px;margin-bottom:8px;line-height:1.5">⚠️ <b>Todo lo de aquí es PÚBLICO</b>: cualquier visitante de la tienda puede leerlo (la tabla de productos es de lectura abierta). Solo datos de catálogo: material, temporada, cuidado, medidas, SEO. <b>Nunca</b> costos, proveedores ni notas internas — para eso están Costo y las notas del pedido.</div>
    <div style="font-size:10.5px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">🔎 SEO de este producto</div>
    <div style="display:grid;gap:7px;margin-bottom:10px">
      <div><input id="mst${dest}${id}" type="text" maxlength="70" placeholder="Título de página (pestaña y resultado en Google)" value="${escHtml(t)}" style="${inp}" oninput="cntSeo(this,'msct${dest}${id}',70)"><div id="msct${dest}${id}" style="${cnt}">${t.length} de 70 caracteres usados</div></div>
      <div><textarea id="msd${dest}${id}" maxlength="160" rows="2" placeholder="Metadescripción (el texto gris bajo el título en Google)" style="${inp};resize:vertical" oninput="cntSeo(this,'mscd${dest}${id}',160)">${escHtml(d)}</textarea><div id="mscd${dest}${id}" style="${cnt}">${d.length} de 160 caracteres usados</div></div>
      <div><input id="msh${dest}${id}" type="text" maxlength="60" placeholder="Identificador de URL (handle) — ej. nike-air-max-90" value="${escHtml(h)}" style="${inp}" oninput="previewHandle(this,${id},'${dest}')"><div id="mshp${dest}${id}" style="font-size:10px;color:var(--ink3);margin-top:2px">URL: strangesneakers.com/p/${dest==='liq'?'L':''}${id}-<b>${slugSeo(h)||'…'}</b></div></div>
    </div>
    <div style="font-size:10.5px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px">🏷 Metacampos (salen en la ficha como "Detalles del producto")</div>
    <div id="mrows${dest}${id}">${pares.map(([k,v])=>metaParRow(k,v)).join('')||metaParRow('','')}</div>
    <button class="epbtn" onclick="metaAddPar(${id},'${dest}')">＋ Añadir campo</button>
    <div style="display:flex;gap:6px;margin-top:9px">
      <button class="ep-save" onclick="saveMeta(${id},'${dest}')">Guardar</button>
      <button class="ep-cancel" onclick="togMeta(${id},'${dest}')">✕</button>
    </div>`;
}

async function saveMeta(id,dest){
  const list=dest==='liq'?liqs:prods;const p=list.find(x=>x.id===id);if(!p)return;
  const box=$('meta'+dest+id);if(!box)return;
  const meta={};
  box.querySelectorAll('.meta-par').forEach(row=>{
    const kEl=row.querySelector('.mk'),vEl=row.querySelector('.mv');
    const k=kEl?kEl.value.trim().slice(0,40):'',v=vEl?vEl.value.trim().slice(0,300):'';
    if(k&&v&&k!=='seo')meta[k]=v;   // 'seo' como clave libre chocaría con el bloque SEO
  });
  const t=($('mst'+dest+id)||{value:''}).value.trim().slice(0,70);
  const d=($('msd'+dest+id)||{value:''}).value.trim().slice(0,160);
  const h=slugSeo(($('msh'+dest+id)||{value:''}).value);
  const seo={};
  if(t)seo.title=t;if(d)seo.description=d;if(h)seo.handle=h;
  if(Object.keys(seo).length)meta.seo=seo;
  // Todo vacío → null (no un {} que "parece" tener datos). Mismo criterio que el server.
  const val=Object.keys(meta).length?meta:null;
  const prev=('meta' in p)?p.meta:null;
  p.meta=val;
  try{
    await adminWrite('update_product',{table:dest==='liq'?'liq_products':'products',id,data:{meta:val}});
    togMeta(id,dest);dest==='liq'?renderLiqAdmin():renderAdmin();
  }catch(e){
    p.meta=prev;
    alert('No se pudo guardar: '+e.message+(String(e.message||'').includes('meta')?'\n\n¿Ya corriste la migración 007 (columna meta) en Supabase?':''));
  }
}

/* ── IA: SUGERIR MODELO ── Los productos sin modelo salen al feed de Meta con títulos genéricos
   duplicados (Meta los agrupa y castiga los anuncios dinámicos). Gemini mira la FOTO real y
   propone un nombre vía la action sugerir_modelo de /api/admin (sesión admin obligatoria).
   REGLA DE ORO: la IA solo PROPONE — nada toca la BD hasta que el admin pulsa "✓ Usar" (o
   edita y guarda). Un modelo mal identificado guardado en automático sería un dato falso en
   el catálogo y en los anuncios. Las propuestas viven solo en memoria (se pierden al recargar,
   a propósito: una propuesta sin revisar no debe sobrevivir a la sesión). */
let sugerenciasIA={};   // 'cat:ID' / 'liq:ID' → texto propuesto pendiente de aprobación

function sugStrip(type,p){
  const s=sugerenciasIA[type+':'+p.id];
  if(!s)return '';
  return `<div style="grid-column:1/-1;display:flex;gap:6px;align-items:center;flex-wrap:wrap;background:#f3fbf5;border:1px solid #bfe6c8;border-radius:8px;padding:6px 9px;font-size:11.5px;color:var(--ink)">✨ IA propone: <b>${escHtml(s)}</b>
    <button class="ep-save" onclick="aplicarSugerencia(${p.id},'${type}')">✓ Usar</button>
    <button class="epbtn" onclick="editarSugerencia(${p.id},'${type}')">✏️ Editar</button>
    <button class="ep-cancel" onclick="descartarSugerencia(${p.id},'${type}')">✕</button></div>`;
}

async function sugerirModelo(id,type,btn){
  if(btn){btn.disabled=true;btn.textContent='⏳ IA…';}
  try{
    const r=await adminWrite('sugerir_modelo',{table:type==='liq'?'liq_products':'products',id});
    if(!r.sugerencia){alert('🤷 La IA no reconoció el modelo con certeza.\nSi tú lo conoces, ponlo a mano con "Editar".');return;}
    sugerenciasIA[type+':'+id]=r.sugerencia;
    type==='liq'?renderLiqAdmin():renderAdmin();   // re-render → aparece la franja de aprobación
  }catch(e){alert('❌ IA: '+e.message);}
  finally{if(btn&&document.body.contains(btn)){btn.disabled=false;btn.textContent='✨ Modelo';}}
}

// "✓ Usar" ES la aprobación humana: recién aquí se escribe modelo en la BD (mismo camino
// update_product del editor de siempre). Si falla el guardado se revierte todo, incluida
// la propuesta, para poder reintentar.
async function aplicarSugerencia(id,type){
  const key=type+':'+id,s=sugerenciasIA[key];if(!s)return;
  const list=type==='liq'?liqs:prods;const p=list.find(x=>x.id===id);if(!p)return;
  const prev=p.modelo||null;   // para revertir sin inventar: pudo haberse editado a mano entretanto
  p.modelo=s;delete sugerenciasIA[key];
  renderGrid();type==='liq'?renderLiqAdmin():renderAdmin();
  try{await adminWrite('update_product',{table:type==='liq'?'liq_products':'products',id,data:{modelo:s}});}
  catch(e){p.modelo=prev;sugerenciasIA[key]=s;renderGrid();type==='liq'?renderLiqAdmin():renderAdmin();alert('No se pudo guardar: '+e.message);}
}

// "✏️ Editar" abre el editor de siempre con la propuesta precargada — corregir y Guardar.
function editarSugerencia(id,type){
  const s=sugerenciasIA[type+':'+id];if(!s)return;
  startEP(id,type);
  const inp=$(type==='liq'?'eplm'+id:'epm'+id);
  if(inp){inp.value=s;inp.focus();}
}

function descartarSugerencia(id,type){
  delete sugerenciasIA[type+':'+id];
  type==='liq'?renderLiqAdmin():renderAdmin();
}

// LOTE: recorre los que faltan (catálogo + liquidación) en SERIE — una llamada a la vez para
// no estrellarse contra el rate limit de Gemini ni saturar la función de Vercel. Solo junta
// propuestas; la aprobación sigue siendo fila por fila. Clic de nuevo mientras corre = parar.
let _sugBatchOn=false;
async function sugerirModelosFaltantes(){
  if(_sugBatchOn){_sugBatchOn=false;const b=$('btnSugTodos');if(b)b.textContent='⏹ Parando…';return;}
  const cola=[
    ...prods.filter(p=>!p.modelo&&!sugerenciasIA['cat:'+p.id]).map(p=>({id:p.id,type:'cat'})),
    ...liqs.filter(p=>!p.modelo&&!sugerenciasIA['liq:'+p.id]).map(p=>({id:p.id,type:'liq'}))
  ];
  if(!cola.length){renderAdmin();renderLiqAdmin();return;}
  _sugBatchOn=true;
  let ok=0,sin=0,err=0;
  for(let i=0;i<cola.length;i++){
    if(!_sugBatchOn)break;
    const b=$('btnSugTodos');if(b)b.textContent=`⏳ ${i+1}/${cola.length}… (clic = parar)`;
    try{
      const r=await adminWrite('sugerir_modelo',{table:cola[i].type==='liq'?'liq_products':'products',id:cola[i].id});
      if(r.sugerencia){sugerenciasIA[cola[i].type+':'+cola[i].id]=r.sugerencia;ok++;}else sin++;
    }catch(e){
      err++;
      if(!ADMIN_OK)break;                    // sesión vencida: seguir sería martillar 401s
      if(err>=3&&!ok){break;}                // 3 fallos seguidos sin ningún éxito = algo está roto, no insistir
    }
  }
  _sugBatchOn=false;
  renderAdmin();renderLiqAdmin();   // re-render → franjas de aprobación en cada fila
  alert(`✨ IA terminó:\n• ${ok} propuesta${ok===1?'':'s'} lista${ok===1?'':'s'} para revisar (franja verde en cada producto)\n• ${sin} sin identificar\n• ${err} error${err===1?'':'es'}\n\nNada se guardó todavía: aprueba con "✓ Usar" producto por producto.`);
}

async function delProd(id,type){
  if(type==='liq'){liqs=liqs.filter(p=>p.id!==id);delete cart['L'+id];}
  else{prods=prods.filter(p=>p.id!==id);delete cart[id];}
  syncDot();renderGrid();renderAdmin();if(type==='liq')renderLiqAdmin();
  await adminWrite('delete_product',{table:type==='liq'?'liq_products':'products',id});
}

async function togSold(id,type){
  const list=type==='liq'?liqs:prods;
  const p=list.find(x=>x.id===id);if(!p)return;
  p.sold=!p.sold;
  const key=type==='liq'?'L'+id:id;
  if(p.sold)delete cart[key];
  syncDot();renderGrid();renderAdmin();if(type==='liq')renderLiqAdmin();
  await adminWrite('update_product',{table:type==='liq'?'liq_products':'products',id,data:{sold:p.sold}});
}

/* ── AGOTADO AL CERRAR VENTA ── El feed de Meta (api/feed) solo excluye sold=true: un par
   vendido que nadie marca sigue en el catálogo de anuncios y se paga tráfico hacia un zapato
   que ya no existe. Por eso agotar es parte del gesto de cerrar la venta, no un botón aparte. */

// Cruza los items de un pedido con los productos vivos (catálogo o liquidación).
// Devuelve [{p,type,it}] sin duplicados; ignora items sin id o ya borrados del catálogo.
function productosDePedido(o){
  const out=[],vistos=new Set();
  (Array.isArray(o.items)?o.items:[]).forEach(it=>{
    if(it.id==null)return;
    const type=it.type==='liq'?'liq':'cat';
    const p=(type==='liq'?liqs:prods).find(x=>x.id===parseInt(it.id));
    const key=type+':'+parseInt(it.id);
    if(p&&!vistos.has(key)){vistos.add(key);out.push({p,type,it});}
  });
  return out;
}

// confirm simple a propósito: OK = agotar todo el pedido, Cancelar = no tocar nada (cero
// fricción). Las ventas parciales de un pedido multi-producto son raras; para esos casos
// queda el botón "Agotado" de siempre en Productos.
async function ofrecerAgotarVendidos(o){
  const cand=productosDePedido(o).filter(x=>!x.p.sold);
  if(!cand.length)return;
  const n=cand.length,s=n===1?'':'s';
  const lista=cand.map(x=>'• '+(x.it.label||x.p.modelo||'Producto')+' #'+x.p.id+(x.it.talla?' · Talla '+x.it.talla:'')).join('\n');
  if(!confirm(`✓ Venta registrada.\n\n¿Marcar AGOTADO${s.toUpperCase()} para que Meta deje de pautarlo${s}?\n\n${lista}\n\n(Cancelar = sigue${n===1?'':'n'} disponible${s} en catálogo y feed)`))return;
  // togSold reusa el camino ya probado: saca del carrito, re-renderiza y guarda sold en la BD.
  for(const x of cand)if(!x.p.sold)await togSold(x.p.id,x.type);
}

// calidad WebP (88%) — buen detalle, peso razonable
function compressImg(file,cb,square=false,max=IMG_MAX){
  const r=new FileReader();
  r.onload=e=>{
    const img=new Image();
    img.onload=()=>{
      const MAX=max;
      if(square){
        // Lienzo cuadrado con relleno blanco; el zapato se centra "contain" (sin recorte).
        const SIZE=IMG_MAX;
        const c=document.createElement('canvas');c.width=SIZE;c.height=SIZE;
        const ctx=c.getContext('2d');
        ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
        ctx.fillStyle='#fff';ctx.fillRect(0,0,SIZE,SIZE);
        const s=Math.min(SIZE/img.width,SIZE/img.height,1); // no ampliar fotos pequeñas
        const w=Math.round(img.width*s),h=Math.round(img.height*s);
        ctx.drawImage(img,Math.round((SIZE-w)/2),Math.round((SIZE-h)/2),w,h);
        cb(c.toDataURL('image/webp',IMG_Q));
        return;
      }
      // Comportamiento original: conservar proporción (lo usa la IA).
      let w=img.width,h=img.height;
      if(w>MAX||h>MAX){const s=MAX/Math.max(w,h);w=Math.round(w*s);h=Math.round(h*s);}
      const c=document.createElement('canvas');c.width=w;c.height=h;
      const ctx=c.getContext('2d');ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      ctx.drawImage(img,0,0,w,h);
      cb(c.toDataURL('image/webp',IMG_Q));
    };
    img.src=e.target.result;
  };
  r.readAsDataURL(file);
}

async function handleAIFile(file, dest){
  if(!file) return;
  const btn=$(dest==='cat'?'aiBtn':'aiBtnLiq');
  const orig='✨ IA Studio — fondo blanco profesional';
  if(btn){btn.disabled=true;btn.firstChild.textContent='⏳ Procesando con IA (~10s)…';}
  try{
    const base64=await new Promise((res,rej)=>{compressImg(file,res);});
    const r=await fetch('/api/ai-photo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({imageBase64:base64})});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw new Error(e.error||'Error del servidor');}
    const {url}=await r.json();
    const q=dest==='liq'?qL:qC;
    q.push({id:Date.now()+Math.random(),src:url,isAI:true});
    renderQ(dest);
  }catch(e){
    console.error('AI photo error:',e);
    alert('Error IA: '+e.message);
  }finally{
    if(btn){btn.disabled=false;btn.firstChild.textContent=orig;}
  }
}

function handleFiles(files,dest){
  const nuevas=Array.from(files);
  const q=dest==='liq'?qL:qC;
  if(q.length+nuevas.length>20){alert('Máximo 20 fotos por sección. Agrega las actuales primero.');return;}
  nuevas.forEach(f=>{
    compressImg(f,src=>{q.push({id:Date.now()+Math.random(),src});renderQ(dest);},true);
  });
}

function renderQ(dest){
  const isC=dest==='cat';
  const q=isC?qC:qL;
  const qEl=$(isC?'qCat':'qLiq'),optEl=$(isC?'optCat':'optLiq'),btnEl=$(isC?'btnCat':'btnLiq');
  if(!q.length){
    qEl.style.display='none';optEl.style.display='none';btnEl.style.display='none';
    return;
  }
  qEl.style.display='flex';optEl.style.display='flex';btnEl.style.display='flex';
  qEl.innerHTML=q.map(x=>`<div class="qthumb"><img src="${x.src}" alt=""><button class="qdel" onclick="rmQ('${x.id}','${dest}')">✕</button></div>`).join('');
}

function rmQ(id,dest){
  if(dest==='liq')qL=qL.filter(x=>String(x.id)!==String(id));
  else qC=qC.filter(x=>String(x.id)!==String(id));
  renderQ(dest);
}

/* ── SUPABASE STORAGE ── */
async function uploadToStorage(base64, idx, isAI){
  if(isAI) return base64; // ya está en Supabase Storage, devolver URL directo
  const r=await adminWrite('upload_image',{data:{imageBase64:base64,idx}});
  if(!r||!r.url)throw new Error('upload failed');
  return r.url;
}

// Cada foto de la cola = un producto. (Antes, en modo 360, las fotos se agrupaban en un solo
// producto con frames; esa función se retiró porque no se usaba: 0 de 177 productos la tenían.)
async function _commitQueue(dest,isC,urls){
  if(isC){
    const g=$('qGen').value,brand=($('qBrand')?.value)||'',price=Math.max(1000,parseInt($('qPrc').value)||P_DEF),was=Math.max(0,parseInt($('qAnt').value)||P_ANT);
    for(let i=0;i<urls.length;i++){
      const r=await adminWrite('insert_product',{table:'products',data:{gender:g,brand:brand||null,price,price_before:was,promo:false,sold:false,img_url:urls[i]}});
      if(r?.id)prods.push({id:r.id,g,brand,img:urls[i],price,was,promo:false,sold:false});
    }
    qC=[];
  }else{
    const price=Math.max(1000,parseInt($('lPrc').value)||99000),was=Math.max(0,parseInt($('lAnt').value)||P_ANT);
    for(let i=0;i<urls.length;i++){
      const r=await adminWrite('insert_product',{table:'liq_products',data:{price,price_before:was,sold:false,img_url:urls[i]}});
      if(r?.id)liqs.push({id:r.id,img:urls[i],price,was,sold:false});
    }
    qL=[];renderLiqAdmin();
  }
  renderQ(dest);renderGrid();renderAdmin();
}

async function addQueue(dest){
  const isC=dest==='cat';
  const q=isC?qC:qL;
  if(!q.length)return;
  const btnEl=$(isC?'btnCat':'btnLiq');
  if(btnEl){btnEl.disabled=true;btnEl.textContent='⏳ Subiendo...';}
  try{
    const urls=await Promise.all(q.map((x,i)=>uploadToStorage(x.src,i,x.isAI)));
    await _commitQueue(dest,isC,urls);
  }catch(e){
    console.error('Upload error:',e);
    if(!ADMIN_OK){
      alert('⚠️ La clave Admin no está activa.\n\nCierra el panel, vuelve a entrar con tu PIN e intenta de nuevo.');
    }else if(e.message&&(e.message.includes('storage')||e.message.includes('upload')||e.message.includes('bucket'))){
      alert('❌ Error subiendo la foto al servidor.\nRevisa tu conexión e intenta de nuevo.');
    }else{
      alert('❌ Error guardando el producto:\n'+e.message);
    }
  }finally{
    if(btnEl){btnEl.disabled=false;btnEl.textContent=isC?'➕ Añadir al catálogo':'🔥 Añadir a liquidación';}
  }
}

/* ── BACKUP ── */
function exportCatalog(){
  const data={prods,liqs,orders,config:{wa:WA,nombre:STORE_NAME,pixelId:PIXEL_ID},exportado:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`catalogo-${STORE_NAME.toLowerCase()}-${new Date().toISOString().slice(0,10)}.json`;
  a.click();URL.revokeObjectURL(a.href);
}

async function importCatalog(file){
  if(!file)return;
  if(!ADMIN_OK){alert('⚠️ Inicia sesión admin antes de importar.');return;}
  let text;try{text=await file.text();}catch{alert('No se pudo leer el archivo.');return;}
  let data;try{data=JSON.parse(text);}catch{alert('Archivo JSON inválido.');return;}
  if(!data.prods||!data.liqs){alert('Formato inválido: el backup debe tener prods y liqs.');return;}
  if(!confirm(`¿Importar a la base de datos ${data.prods.length} productos de catálogo y ${data.liqs.length} de liquidación?\n\nSe AÑADIRÁN al catálogo actual (no lo reemplaza).`))return;
  let okC=0,okL=0,fail=0;
  for(const p of data.prods){
    const r=await adminWrite('insert_product',{table:'products',data:{
      gender:(g=>g==='m'||g==='u'?g:'h')(p.g||p.gender),
      price:Math.max(1000,parseInt(p.price)||P_DEF),
      price_before:Math.max(0,parseInt(p.was??p.price_before)||0),
      promo:!!p.promo,sold:!!p.sold,
      img_url:p.img||p.img_url||'',
      imgs:JSON.stringify(p.imgs||[])
    }}).catch(()=>null);
    if(r?.id)okC++;else fail++;
  }
  for(const p of data.liqs){
    const r=await adminWrite('insert_product',{table:'liq_products',data:{
      price:Math.max(1000,parseInt(p.price)||99000),
      price_before:Math.max(0,parseInt(p.was??p.price_before)||0),
      sold:!!p.sold,
      img_url:p.img||p.img_url||'',
      imgs:JSON.stringify(p.imgs||[])
    }}).catch(()=>null);
    if(r?.id)okL++;else fail++;
  }
  if(data.config){
    if(data.config.wa)WA=data.config.wa;
    if(data.config.nombre)STORE_NAME=data.config.nombre;
    if(data.config.pixelId)PIXEL_ID=data.config.pixelId;
    await saveConfig().catch(()=>{});
  }
  applyStoreName();
  await loadState();
  renderGrid();renderAdmin();renderLiqAdmin();
  alert(`✓ Importado a la base de datos:\n• Catálogo: ${okC}\n• Liquidación: ${okL}${fail?`\n• Fallidos: ${fail}`:''}`);
}

/* ── CONFIGURACIÓN ── */
async function saveConfig(){
  localStorage.setItem('ss_config',JSON.stringify({wa:WA,nombre:STORE_NAME,pixelId:PIXEL_ID,wompiPk:WOMPI_PK,clarityId:CLARITY_ID}));
  await adminWrite('upsert_settings',{data:[
    {key:'store_name', value:STORE_NAME},
    {key:'wa',         value:WA},
    {key:'pixel_id',   value:PIXEL_ID},
    {key:'wompi_pk',   value:WOMPI_PK},
    {key:'clarity_id', value:CLARITY_ID}
  ]});
}

function checkStorageQuota(){
  try{
    let total=0;
    for(const k in localStorage)if(Object.prototype.hasOwnProperty.call(localStorage,k))total+=localStorage[k].length;
    const pct=total/(5*1024*1024)*100;
    const warn=$('storageWarn');
    if(warn)warn.style.display=pct>80?'block':'none';
    if(warn)warn.textContent=`⚠️ Almacenamiento al ${Math.round(pct)}% — considera eliminar productos con fotos pesadas.`;
  }catch(e){}
}

const AV_TITLES={inicio:'Inicio',productos:'Productos',ofertas:'Ofertas',banners:'Banners',testimonios:'Testimonios',pedidos:'Pedidos',clientes:'Clientes',leads:'Leads',suscriptores:'Suscriptores',ajustes:'Ajustes'};

// Navegar desde las tarjetas/tareas del Inicio: sección + filtro de leads opcional.
function avGo(sec,filtro){
  if(filtro)leadFilter=filtro;
  setAdminSection(sec);
}

// Cerrar el dropdown al hacer click fuera del buscador
document.addEventListener('click',e=>{if(!e.target.closest('.av-search'))cerrarBusqueda();});

/* ── Residuos del público (helpers solo-admin reubicados en paso 4) ── */
/* ── Campos de operador: estado WhatsApp, temperatura, nota ── */
const WA_STATES=[null,'sin_contactar','contactado','respondio','no_respondio'];

const WA_LABELS={sin_contactar:'📵 Sin contactar',contactado:'📤 Contactado',respondio:'💬 Respondió',no_respondio:'🔇 No respondió'};

const TEMP_STATES=[null,'frio','tibio','caliente'];

const TEMP_LABELS={frio:'🧊 Frío',tibio:'🌤 Tibio',caliente:'🔥 Caliente'};

function chipWa(o){
  const v=o.wa_status||null;
  const lbl=v?WA_LABELS[v]:'📱 Estado WA';
  const on=v?'background:var(--ink);color:#fff;border-color:var(--ink)':'background:var(--white);color:var(--ink2)';
  return `<button onclick="cycleLeadField(${o.id},'wa_status')" style="padding:6px 10px;border:1px solid var(--line);border-radius:14px;font-family:var(--font);font-size:10.5px;font-weight:700;cursor:pointer;${on}">${lbl}</button>`;
}

function chipTemp(o){
  const v=o.temperatura||null;
  const lbl=v?TEMP_LABELS[v]:'🌡 Temperatura';
  const col=v==='caliente'?'background:#E8200A;color:#fff;border-color:#E8200A':v==='tibio'?'background:#F2A900;color:#fff;border-color:#F2A900':v==='frio'?'background:#5b9bd5;color:#fff;border-color:#5b9bd5':'background:var(--white);color:var(--ink2)';
  return `<button onclick="cycleLeadField(${o.id},'temperatura')" style="padding:6px 10px;border:1px solid var(--line);border-radius:14px;font-family:var(--font);font-size:10.5px;font-weight:700;cursor:pointer;${col}">${lbl}</button>`;
}

/* Fecha de seguimiento (dd/mm/aaaa, hoy o futuro) → tarea "hacer seguimiento" en Inicio */
function chipSeg(o){
  if(!o.seguimiento)return `<button onclick="leadSeguimiento(${o.id})" style="padding:6px 10px;border:1px solid var(--line);border-radius:14px;background:var(--white);font-family:var(--font);font-size:10.5px;font-weight:700;color:var(--ink2);cursor:pointer">📅 Seguimiento</button>`;
  const hoyISO=new Date().toISOString().slice(0,10);
  const vencido=o.seguimiento<=hoyISO;
  const [y,m,d]=o.seguimiento.split('-');
  const estilo=vencido?'background:#E8200A;color:#fff;border-color:#E8200A':'background:var(--ink);color:#fff;border-color:var(--ink)';
  return `<button onclick="leadSeguimiento(${o.id})" style="padding:6px 10px;border:1px solid var(--line);border-radius:14px;font-family:var(--font);font-size:10.5px;font-weight:700;cursor:pointer;${estilo}">📅 ${d}/${m}${vencido?' ¡HOY!':''}</button>`;
}

/* ── SUBIR FOTOS ── */
const IMG_MAX=1400;

// resolución máxima de PRODUCTOS (lado mayor / lienzo cuadrado)
const BANNER_MAX=2560;

// resolución máxima de BANNERS full-bleed — nítidos en monitores grandes
const IMG_Q=0.88;

/* ── INIT del panel (corre al cargar admin.js) ──
   El markup del apanel vive en /admin.html: primero se trae e inyecta (hijo directo de body),
   y SOLO después se pintan las secciones y se cuelgan los listeners. El stub openAdmin de
   index.html espera window._adminInit antes de llamar _openAdminReal. */
window._adminInit=(async()=>{
  const r=await fetch('/admin.html');
  if(!r.ok)throw new Error('admin.html '+r.status);
  document.body.insertAdjacentHTML('beforeend',await r.text());
  renderHeroAdmin();renderCombosAdmin();renderFeaturedAdmin();renderColAdmin();renderTestiAdmin();renderSizeGuideAdmin();renderEnvioAdmin();checkPixelHealth();
(function(){ /* drag & drop de las zonas de subida */
  const uzEl=$('uzCat');
  if(uzEl){
    uzEl.addEventListener('dragover',e=>{e.preventDefault();uzEl.classList.add('drag');});
    uzEl.addEventListener('dragleave',()=>uzEl.classList.remove('drag'));
    uzEl.addEventListener('drop',e=>{e.preventDefault();uzEl.classList.remove('drag');handleFiles(e.dataTransfer.files,'cat');});
  }
  const uzLiqEl=document.querySelector('#panLiq .uz');
  if(uzLiqEl){
    uzLiqEl.addEventListener('dragover',e=>{e.preventDefault();uzLiqEl.classList.add('drag');});
    uzLiqEl.addEventListener('dragleave',()=>uzLiqEl.classList.remove('drag'));
    uzLiqEl.addEventListener('drop',e=>{e.preventDefault();uzLiqEl.classList.remove('drag');handleFiles(e.dataTransfer.files,'liq');});
  }
})();
  window._adminReady=true;
})();
