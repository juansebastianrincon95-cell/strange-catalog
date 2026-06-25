// Adaptador de envíos con Coordinadora (Web Service directo).
// Archivo helper (prefijo _) → NO cuenta como función serverless de Vercel.
//
// ESTADO: esqueleto. La llamada REAL al Web Service se finaliza cuando se tengan las
// credenciales + el manual técnico de Coordinadora (vienen con el acuerdo comercial).
//
// Modos:
//   - COORDINADORA_SIMULACION=1  → devuelve una guía falsa para probar TODO el flujo
//     (botón → guardar → mostrar → avisar al cliente) sin API real.
//   - credenciales presentes     → (PENDIENTE) llamada real al Web Service.
//   - nada configurado           → { ok:false, error:'coordinadora_no_configurado' }.
//
// Envs que usará la integración real (se definen al activar la cuenta):
//   COORDINADORA_WS_URL, COORDINADORA_USER, COORDINADORA_PASSWORD,
//   COORDINADORA_NIT (cliente/cuenta), COORDINADORA_ORIGEN_DANE (ciudad de despacho).

function isConfigured() {
  return !!(process.env.COORDINADORA_WS_URL && process.env.COORDINADORA_USER && process.env.COORDINADORA_PASSWORD);
}

// Recaudo contra-entrega: si el pedido es contra_entrega se cobra el total; si es prepago
// (Wompi/Bold/Addi/Sistecrédito) el recaudo es 0 (el cliente no paga nada al recibir).
function recaudoDe(order) {
  return order && order.pago === 'contra_entrega' ? Math.round(Number(order.total || 0)) : 0;
}

// Genera la guía para un pedido. Devuelve:
//   { ok:true, guia, tracking_url, transportadora:'coordinadora', recaudo, simulado? }
//   { ok:false, error }
async function generarGuia(order) {
  if (!order) return { ok: false, error: 'order_requerida' };
  const recaudo = recaudoDe(order);

  // Modo simulación: prueba el flujo de punta a punta sin API real.
  if (process.env.COORDINADORA_SIMULACION === '1') {
    const guia = 'SIM' + Date.now();
    return {
      ok: true, guia,
      tracking_url: 'https://coordinadora.com/rastreo/rastreo-de-mercancia/?guias=' + guia,
      transportadora: 'coordinadora', recaudo, simulado: true
    };
  }

  if (!isConfigured()) return { ok: false, error: 'coordinadora_no_configurado' };

  // PENDIENTE (Fase 3): construir y enviar la petición real al Web Service de Coordinadora
  // con su manual. Datos del pedido disponibles para el destinatario:
  //   order.nombre, order.cedula, order.tel, order.ciudad, order.barrio, order.direccion,
  //   order.total, order.pares, order.items  +  recaudo (arriba)  +  origen (env DANE).
  // Debe devolver { ok:true, guia, tracking_url, transportadora:'coordinadora', recaudo }.
  return { ok: false, error: 'coordinadora_pendiente_integracion' };
}

module.exports = { isConfigured, recaudoDe, generarGuia };
