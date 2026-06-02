import messageHandler from '../services/messageHandler.js';

const SCREEN_RESPONSES = {
  SUMMARY: {
    screen: "SUMMARY",
    data: {},
  },
  SUCCESS: {
    screen: "SUCCESS",
    data: {},
  },
};

export const getNextScreen = async (decryptedBody, productos, total, pedidoStr, numero) => {
  const { screen, data, version, action, flow_token } = decryptedBody;
  // handle health check request
  if (action === "ping") {
    return {
      data: {
        status: "active",
      },
    };
  }

  // handle error notification
  if (data?.error) {
    console.warn("Received client error:", data);
    return {
      data: {
        acknowledged: true,
      },
    };
  }

  if (action === "data_exchange") {
    let result;
    let details;
    switch (screen) {
      case "DETAILS":
        if (data.recomendacion && data.address) {
          (total += 3000).toLocaleString('es-CO');
          details = `Nombre:    ${data.name}\n
Pedido: 
${pedidoStr}\n
Total: $${total} (Domicilio: $3.000)\n
Dirección:    ${data.address}\n
Celular de contacto:    ${data.phone}\n
Medio de pago:    ${data.pago}\n
Recomendaciones:    ${data.recomendacion}`;
        }
        else if (data.address) {
          (total += 3000).toLocaleString('es-CO');
          details = `Nombre:    ${data.name}\n
Pedido: 
${pedidoStr}\n
Total: $${total} (Domicilio: $3.000)\n
Dirección:    ${data.address}\n
Celular de contacto:    ${data.phone}\n
Medio de pago:    ${data.pago}`;
        }
        else if (data.recomendacion) {
          details = `Nombre:    ${data.name}\n
Pedido: 
${pedidoStr}\n
Total: $${total.toLocaleString('es-CO')}\n
Celular de contacto:    ${data.phone}\n
Medio de pago:    ${data.pago}\n
Recomendaciones:    ${data.recomendacion}`;
        }
         else {
          details = `Nombre:    ${data.name}\n
Pedido: 
${pedidoStr}\n
Total: $${total.toLocaleString('es-CO')}\n
Celular de contacto:    ${data.phone}\n
Medio de pago:    ${data.pago}`;
        }
        result = {
          ...SCREEN_RESPONSES.SUMMARY,
          data: {
            details,
            ...data,
            screen
          },
        };
        break;
      case "SUMMARY":
        messageHandler.completeHiring(pedidoStr, data, numero);
        messageHandler.completeOrder(productos, data);
        result = {
          ...SCREEN_RESPONSES.SUCCESS,
          data: {
            extension_message_response: {
              params: {
                flow_token,
              },
            },
          },
        };
        break;
      default:
          break;
    } return result;
  }

  console.error("Unhandled request body:", decryptedBody);
  throw new Error(
    "Unhandled endpoint request. Make sure you handle the request action & screen logged above."
  );
};
