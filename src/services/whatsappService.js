import sendToWhatsApp from "../services/httpRequest/sendToWhatsApp.js";
import { printDetailedError } from './printDetailError.js';

class WhatsAppService {
  async sendMessage(to, body, messageId) {
    try {
      const data = {
        messaging_product: 'whatsapp',
        to,
        text: { body },
      };

      await sendToWhatsApp(data);
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }

  async markAsRead(messageId) {
    try {
      const data = {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      };
  
      await sendToWhatsApp(data);
    } catch (error) {
      console.error('Error marking message as read:', error);
    }
  }

  async sendInteractiveButtons(to, bodyText, buttons) {
    try {
      const data = {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: "button",
          body: { text: bodyText },
          action: {
            buttons: buttons,
          },
        },
      };

      await sendToWhatsApp(data);
    } catch (error) {
      console.log("Error: ", error);
    }
  }

  async sendFlow(to, action) {
    try {
      const data = {
        recipient_type: 'individual',
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: "flow",
          header: {
            type: "text",
            text: "Datos de envío:"
          },
          body: { 
            text: "Haz clic aquí 👇" 
          },
          action
        },
      };
      
    await sendToWhatsApp(data);
    } catch (error) {
      console.log("Error: ", error);
    }
  }

  async sendTemplateReserva(to, imageUrl, variables) {
    const data = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: "confirmacion_reserva",
        language: { code: "es_CO" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: { link: imageUrl }
              }
            ]
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: variables[0] },
              { type: "text", text: variables[1] },
              { type: "text", text: variables[2] },
              { type: "text", text: variables[3] },
              { type: "text", text: variables[4] }, 
              { type: "text", text: variables[5] },
              { type: "text", text: variables[6] },
            ]
          }
        ]
      }
    };
    await sendToWhatsApp(data);
  }

  async sendTemplateComprobantePago(to, imageUrl, variables) {
    const data = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: "comprobante_pago",
        language: { code: "es_CO" },
        components: [
          {
            type: "header",
            parameters: [
              {
                type: "image",
                image: { link: imageUrl }
              }
            ]
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: variables[0] }, // Nombre del cliente
              { type: "text", text: variables[1] }, // Celular del cliente
              { type: "text", text: variables[2] }, // Dirección del cliente
              { type: "text", text: variables[3] }, // Pedido del cliente
              { type: "text", text: variables[4] }, // Monto total
            ]
          }
        ]
      }
    };
    await sendToWhatsApp(data);
  }
  
  async sendFlowReserva(to, action) {
    try {
      const data = {
        recipient_type: 'individual',
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: "flow",
          header: {
            type: "text",
            text: "Reserva tu mesa:"
          },
          body: { 
            text: "Haz clic aquí 👇" 
          },
          action
        },
      };
  
    await sendToWhatsApp(data);
    } catch (error) {
      console.log("Error: ", error);
    }
  }
  
  async sendMenu(to, template) {
    try {
      const data = {
        recipient_type: 'individual',
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: template
      };
  
    await sendToWhatsApp(data);
    } catch (error) {
      printDetailedError(error);
    }
  }
  
  async sendFlowEncuesta(to, action) {
    try {
      const data = {
        recipient_type: 'individual',
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: "flow",
          header: {
            type: "text",
            text: "Encuesta de satisfacción:"
          },
          body: { 
            text: "Diligenciala aquí 👇" 
          },
          action
        },
      };
  
    await sendToWhatsApp(data);
    } catch (error) {
      console.log("Error: ", error);
    }
  }

  async sendMediaMessage(to, type, mediaUrl, caption = '') {
    try {
      
      const mediaObject = {};
  
      switch (type) {
        case 'image':
          mediaObject.image = { link: mediaUrl, caption: caption };
          break;
        case 'audio':
          mediaObject.audio = { link: mediaUrl };
          break;
        case 'video':
          mediaObject.video = { link: mediaUrl, caption: caption };
          break;
        case 'document':
          mediaObject.document = { link: mediaUrl, caption: caption, filename: 'carta-SamuelitoRestoBar.pdf' };
          break;
        default:
          throw new Error('Not Supported Media Type');
      }
  
      const data = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: type,
        ...mediaObject,
      };
  
      await sendToWhatsApp(data);
    } catch (error) {
      console.log("Error: ", error);
    }
  }

  async sendContactMessage(to, contact) {
    try {
      const data = {
        messaging_product: 'whatsapp',
        to,
        type: 'contacts',
        contacts: [contact],
      };
  
      await sendToWhatsApp(data);
      
    } catch (error) {
      console.log("Error: ", error);
    }
  }

  async sendLocationMessage(to, latitude, longitude, name, address) {
    try {
      
      const data = {
        messaging_product: 'whatsapp',
        to,
        type: 'location',
        location: {
          latitude: latitude,
          longitude: longitude,
          name: name,
          address: address
        }
      };
      
      await sendToWhatsApp(data);
    } catch (error) {
      console.log("Error: ", error);
    }
  }
}

export default new WhatsAppService();