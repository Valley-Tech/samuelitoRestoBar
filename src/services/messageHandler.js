import whatsappService from './whatsappService.js';
import appendToSheet from './googleSheetsService.js';
import geminiService, { AI_UNAVAILABLE } from './geminiService.js';
import { createWompiPaymentLink, getWompiTransactionStatus } from './wompiService.js';
import { enviarPedidoALoggro } from './loggroService.js';
import { saveUserDataByNumber } from './googleSheetsService.js';
import { logAxiosError } from './printDetailError.js';
import { downloadImageFromMeta } from './httpRequest/sendToWhatsApp.js';
import { uploadToPublicStorage } from './awsS3Service.js';
import { reportarFalla } from './reportarFallas.js';
import { sesion, tokenFlow, nuevoPedido, obtenerSesion } from './sesiones.js';
import { separarSaludo, esCortesia, esCancelar, esPreguntaGeneral, turnoActual, dentroDeHorario, esPeticionDeProducto } from './conversacion.js';
import { buscarPlatos, enviarTarjetas, hablaDePlatos, textoSinFoto, textoSoloDomingo } from './busquedaPlatos.js';
import { nombrePorId } from '../data/catalogo.js';
import config from '../config/env.js';
import negocio from '../config/negocio.js';

/**
 * v3.5 (igual que BlackStationBot): búsqueda de platos con IA y carrusel, conversación
 * coherente (bienvenida una vez por turno, "gracias" ya no reinicia el chat) y
 * seguimiento del pedido (confirmar / agregar / cambiar antes del Flow, recordatorios
 * y adicionales). El estado de cada cliente vive en sesiones.js (antes eran variables
 * globales y dos clientes a la vez se mezclaban).
 */

function isWithinBusinessHours() {
  // Hora de Colombia. Horario: HORA_APERTURA a HORA_CIERRE (por defecto 12:00 p. m. a 10:00 p. m.).
  return dentroDeHorario();
}

const cop = (n) => `$${Number(n || 0).toLocaleString('es-CO')}`;

// Botones del paso "confirmar pedido" (máx. 20 caracteres por botón).
const BOTONES_CONFIRMAR = [
  { type: 'reply', reply: { id: 'ped_ok', title: 'Confirmar pedido ✅' } },
  { type: 'reply', reply: { id: 'ped_mas', title: 'Agregar más ➕' } },
  { type: 'reply', reply: { id: 'ped_cambiar', title: 'Cambiar pedido ✏️' } },
];

// Recordatorios del pedido pendiente (un temporizador por cliente).
const temporizadores = new Map();

/** Texto sin tildes y en minúsculas, para comparar palabras. */
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

// El Flow de pedido trae la dirección solo si es a domicilio (si viene vacía, recoge en el restaurante).
const RECOGIDA = 'Recogida en restaurante';
const esDomicilio = (datos) => Boolean(String(datos?.address ?? '').trim()) && datos.address !== RECOGIDA;

// Imágenes del encabezado de las plantillas de aviso.
const IMAGEN_PEDIDO = 'https://micarta.s3.us-east-1.amazonaws.com/Copia+de+Reserva+tu+mesa.jpg';
const IMAGEN_RESERVA = 'https://micarta.s3.us-east-1.amazonaws.com/confirmacion_reserva.jpeg';

const transactionToPhoneMap = {}; // id del link de pago Wompi → número del cliente
const paymentRowMap = {};         // número → fecha y hora de la fila del pedido en Sheets
const userOrderDataMap = {};      // número → datos del pedido (para avisos y comprobante)

// Cartas por palabra clave ("tienen hamburguesas", "quiero ver los jugos"…).
const PALABRAS_CARTA = [
  [/\b(bebidas?|jugos?|limonadas?|cocteles?|malteadas?|postres?|brownie|panacota)\b/, 'bebidas_postres'],
  [/\b(comidas? rapidas?|hamburguesas?|burgers?|perros?|hot ?dogs?|salchipapas?|salchipupera|desgranados?|pastas?|mariscos?|camarones|salmon|arroz|arroces|sandwich(es)?|sanduches?|ensaladas?|sushi)\b/, 'rapidas_mariscos'],
  [/\b(para picar|picadas?|platos? fuertes?|churrascos?|steaks?|baby beef|parrilladas?|costillas?|pechugas?|lomo|lomito|rib eye|new york|chicharron(es)?|patacon(es)?|chorizos?|menu infantil|chicken fingers|asados?|barril)\b/, 'picar_fuertes'],
];

class MessageHandler {

  constructor() {
    this.appointmentState = {};
    this.assistandState = {};
  }

  async handleIncomingMessage(message, senderInfo, screen, datosReserva, datosPedido, pedidoStr) {
    try {
      const from = message.from;
      this.tocarSeguimiento(from);
      // Botones del pedido (confirmar, agregar, adicional…) y respuestas de Flows: a cualquier hora,
      // para no dejar a medias un pedido que empezó antes del cierre.
      const boton = message?.interactive?.button_reply?.id ?? message?.interactive?.list_reply?.id;
      if (!isWithinBusinessHours() && message?.type === 'interactive') {
        if (message.interactive.type === 'nfm_reply') {
          await this.respFlow(from, screen, datosReserva, datosPedido, pedidoStr);
          await whatsappService.markAsRead(message.id);
          return;
        }
        if (/^(ped_|cart_|ad_)/.test(boton ?? '')) return this.handleMenuOption(from, boton);
      }
      if (isWithinBusinessHours()) {
        if (message?.type === 'text') {
          // v3.5: saludo una vez por turno, cortesías, búsqueda de platos con IA y seguimiento del pedido.
          await this.atenderTexto(from, message, senderInfo);

        } else if (message?.type === 'interactive') {
          if (message?.interactive.type === 'nfm_reply') {
            await this.respFlow(from, screen, datosReserva, datosPedido, pedidoStr);
            await whatsappService.markAsRead(message.id);
          }
          else {
            const option = boton;
            await this.handleMenuOption(from, option);
            await whatsappService.markAsRead(message.id);
          }
        } else if (message?.type === 'image' && sesion(from).esperandoComprobante) {
          await this.recibirComprobante(message);
        }
      } else {
        // Pedido de las últimas 3 h ("¿se demora?" después del cierre): lo atiende la IA, no el aviso de horario.
        const pedido = obtenerSesion(from)?.pedido;
        if (message?.type === 'text' && pedido?.enviadoAt && Date.now() - pedido.enviadoAt < 3 * 3600 * 1000) {
          await this.handleAssistandFlow(from, message.text.body, { botones: false });
          await whatsappService.markAsRead(message.id);
          return;
        }
        // v3.4: las respuestas de Flows (reserva), botones e imágenes no traen "text".
        const incomingMessage = message?.text?.body?.toLowerCase().trim() ?? '';
        if (message?.type === 'text' && this.isQuestion(incomingMessage)) {
          this.assistandState[from] = { step: 'question' };
          await this.handleAssistand(from, incomingMessage);
        } else if (message?.type === 'text' && incomingMessage === 'ayuda') {
          await this.helpMenu(from);
        } else if (message?.type === 'text' && incomingMessage === 'carta') {
          await whatsappService.sendMessage(from, "Espera que cargue la carta... 📄");
          await this.sendMedia(from);
        } else if (incomingMessage.includes('menu') || incomingMessage.includes('menú')) {
          await this.catalogo(from);
        } else if (message?.type === 'text' && (incomingMessage === 'ubicacion' || incomingMessage === 'ubicación')) {
          await this.sendLocation(from);
        } else if (message?.type === 'text' && incomingMessage === 'asesor') {
          await this.sendContact(from);
        } else if (message?.type === 'text' && this.isReservation(incomingMessage)) {
          await this.handleMenuOption(from, 'option_2');
        }
        else if (message?.type === 'interactive' && message?.interactive.type === 'nfm_reply' && screen === "RESUMEN") {
          await this.respFlow(from, screen, datosReserva, datosPedido, pedidoStr);
          await whatsappService.markAsRead(message.id);
        } else if (message?.type === 'image' && sesion(from).esperandoComprobante) {
          await this.recibirComprobante(message);
        } else {
          const s = sesion(from);
          if (s.avisoCerradoAt && Date.now() - s.avisoCerradoAt < 2 * 3600 * 1000) {
            // Ya le dijimos que estamos cerrados: respuesta corta en vez de repetir todo.
            await whatsappService.sendMessage(from, `🌙 Ahora estamos cerrados. Te atendemos ${negocio.horarioTexto()} 😊`);
            return;
          }
          s.avisoCerradoAt = Date.now();
          const name = this.firstName(senderInfo);
          const msg = `¡Hola ${name}! 😊\nNuestro horario de atención es ${negocio.horarioTexto()}\nSi necesitas *Reservar* puedes hacerlo en el *botón de Reservas* o si prefieres hablar con la IA🤖 haz tu pregunta con el signo ❓\n\n ¡Gracias por escribirnos! 😊`;
          await this.menuReserva(from);
          await whatsappService.sendMessage(from, msg, message.id);
          return;
        }
      }
    } catch (error) {
      logAxiosError('Error: ', error);
      throw error;
    }
  }

  /**
   * Saludo por PALABRAS (no por pedazos de texto): antes "hi" estaba dentro de
   * "chicharrón" y "chips", "hl" en otras palabras, y "gracias" contaba como saludo:
   * el bot volvía a dar la bienvenida en vez de atender el pedido.
   */
  isGreeting(message) {
    const t = normalizar(message);
    return /^(hola|holi|hello|hi|hl|buenas|buen dia|buenos dias|buenas tardes|buenas noches|saludos|que mas|como estas)\b/.test(t)
      || /\b(hola|buenas tardes|buenas noches|buenos dias)\b/.test(t) && t.split(/\s+/).length <= 4;
  }

  async getDay() {
    // Día de la semana
  const now = new Date();
  const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const diaSemana = dias[now.getDay()];

  return diaSemana;
  }

  isOrder(message) {
    const lower = message.toLowerCase();
    return (
      lower.includes('pedir') ||
      lower.includes('pedido') ||
      lower.includes('orden') ||
      lower.includes('comprar') ||
      lower.includes('domicilio')
    );
  }

  isReservation(message) {
    const lower = message.toLowerCase();
    return (
      lower.includes('reservar') ||
      lower.includes('reserva') ||
      lower.includes('reservacion') ||
      lower.includes('reservación')
    );
  }

  isQuestion(message) {
  const lower = message.toLowerCase();
  return (
    lower.includes('que') ||
    lower.includes('qué') ||
    lower.includes('quien') ||
    lower.includes('quién') ||
    lower.includes('cual') ||
    lower.includes('cuál') ||
    lower.includes('cuando') ||
    lower.includes('cuándo') ||
    lower.includes('porque') ||
    lower.includes('por que') ||
    lower.includes('porqué') ||
    lower.includes('por qué') ||
    lower.includes('para que') ||
    lower.includes('para qué') ||
    lower.includes('donde') ||
    lower.includes('dónde') ||
    lower.includes('como') ||
    lower.includes('cómo') ||
    lower.includes('cuanto') ||
    lower.includes('cuánto') ||
    lower.includes('pregunta') ||
    lower.includes('¿') ||
    lower.includes('?')
  );
}

  /** Carta que corresponde a lo que escribió el cliente (o null). */
  cartaPorTexto(message) {
    const t = normalizar(message);
    for (const [re, key] of PALABRAS_CARTA) if (re.test(t)) return key;
    return null;
  }

  getSenderName(senderInfo) {
    return senderInfo?.profile?.name || senderInfo?.profile?.username || "Cliente";
  }

  /** Primer nombre del perfil ("~Josse" → "Josse"; con tildes y ñ). */
  firstName(senderInfo) {
    return this.getSenderName(senderInfo).replace(/^[~@]+/, '').match(/^([\p{L}\p{N}_]+)/u)?.[1] || '';
  }

  async sendWelcomeMessage(to, messageId, senderInfo) {
    try {
        const name = this.firstName(senderInfo);
        const welcomeMessage = `¡Hola 👋 ${name}!\nBienvenid@ a *Samuelito RestoBar*🌭🍔🍟\n\n¿En qué te puedo ayudar? 😊\n\nEscribe *ayuda* si la necesitas`;
        await whatsappService.sendMessage(to, welcomeMessage, messageId);
    } catch (error) {
      // (antes llamaba a printDetailedError, que no existe en este archivo)
      logAxiosError('sendWelcomeMessage', error);
    }
  }

  async sendWelcomeMenu(to) {
    const menuMessage = "Elige una Opción";
    const buttons = [
      {
        type: 'reply', reply: { id: 'option_1', title: 'Pedir 🛒' }
      },
      {
        type: 'reply', reply: { id: 'option_2', title: 'Reservar 📋' }
      },
      // {
      //   type: 'reply', reply: { id: 'option_3', title: 'Preguntar 🤖' }
      // }
    ];

    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }

  async menuOpcionalHiring(to) {
    const menuMessage = "¿Nos ayudarías respondiendo una pequeña encuesta📝?";
    const buttons = [
      {
        type: 'reply', reply: { id: 'opt1', title: 'Si, continuar ✅' }
      },
      {
        type: 'reply', reply: { id: 'option_5', title: 'No, terminar ✖' }
      }
    ];

    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }

  async botonSi(to) {
    const menuMessage = "¿Deseas bebida🍹🍸 o postre? 🍨🥞 ";
    const buttons = [
      {
        type: 'reply', reply: { id: 'si', title: 'Sí ✅' }
      }
    ];

    await whatsappService.sendInteractiveButtons(to, menuMessage, buttons);
  }

  // v3.5: cada Flow lleva un flow_token con el número del cliente ("pedido:<número>:…"),
  // así el endpoint /flow sabe de quién es aunque dos clientes lo llenen a la vez.
  async menuPedido(to, textos = {}) {
    const action = {
      name: "flow",
      parameters: {
        "flow_message_version": "3",
        "flow_id": config.FLOW_ID_PEDIDO,
        "flow_token": tokenFlow('pedido', to),
        "flow_cta": "Pedido"
      },
    }
    return await whatsappService.sendFlow(to, action, textos);
  }
  
  async menuReserva(to) {
    const action = {
      name: "flow",
      parameters: {
        "flow_message_version": "3",
        "flow_id": config.FLOW_ID_RESERVA,
        "flow_token": tokenFlow('reserva', to),
        "flow_cta": "Reserva"
      },
    }
    return await whatsappService.sendFlowReserva(to, action);
  }

  async getDia() {
    // Día de la semana
  const now = new Date();
  const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const diaSemana = dias[now.getDay()];

  return diaSemana
  }
  
async menuCarta(to) {
  let template;
  if (await this.getDia()==="Domingo") {
    template = { 
      type: "product_list",
      header: { 
          type: "text",
          text: "Para Picar 🍤 y Platos Fuertes 🍝🍲"
        },
        body: {
          text: "Da clic abajo para ver"
        },
        action: {
          catalog_id: "899362489478649",
          sections: [
            {
              "title": "ASADOS AL BARRIL",
              "product_items": [
                {
                  "product_retailer_id": "6133f09d5af774183ce25e0f"
                },
                {
                  "product_retailer_id": "6133e891d145504ca38cbeeb"
                },
                {
                  "product_retailer_id": "6133f070d145504ca38cbf3a"
                }
              ]
            },
            {
              "title": "PARA PICAR",
              "product_items": [
                {
                  "product_retailer_id": "5de86e87205aba0e1c990910"
                },
                {
                  "product_retailer_id": "654ffcee0779b105ec6ac3bd"
                },
                {
                  "product_retailer_id": "5dbcae51c557e50e67febfcc"
                },
                {
                  "product_retailer_id": "5dbcad3fc557e50e67febfac"
                },
                {
                  "product_retailer_id": "5dbcae00c557e50e67febfc0"
                },
                {
                  "product_retailer_id": "5dbcb083c557e50e67febfdb"
                },
                // {
                //   "product_retailer_id": "6888523e6fb8ea242c06a0bb"
                // }
              ]
            },
            {
              "title": "PLATOS FUERTES",
              "product_items": [
                {
                  "product_retailer_id": "67981c57bd2f74e33cfce707"
                },
                {
                  "product_retailer_id": "66ef02fa4ff68adb785f09f8"
                },
                {
                  "product_retailer_id": "619e8bd01880235f6d5b27e5"
                },
                {
                  "product_retailer_id": "5dbcb308c557e50e67febff9"
                },
                {
                  "product_retailer_id": "5dbcb38cc557e50e67febffc"
                },
                {
                  "product_retailer_id": "5dc733ad7c14810dfd3fec3f"
                },
                {
                  "product_retailer_id": "6311736932c31c05fbf10f89"
                },
                {
                  "product_retailer_id": "68203e8d7f735e5e48b7ec3b"
                },
                {
                  "product_retailer_id": "5e5ae290338d200e065c3577"
                },
                {
                  "product_retailer_id": "5dbcb3d9c557e50e67fec005"
                },
                {
                  "product_retailer_id": "5dbcb5a6c557e50e67fec022"
                },
                {
                  "product_retailer_id": "5de84c6e205aba0e1c9907d0"
                },
                {
                  "product_retailer_id": "68203ef70ae0923d28d06765"
                },
                {
                  "product_retailer_id": "5dbcb57ec557e50e67fec01f"
                },
                {
                  "product_retailer_id": "654ff6380779b105ec6ac20a"
                },
                {
                  "product_retailer_id": "654ff7ba33294a05ef9f32f7"
                },
                {
                  "product_retailer_id": "61a10ddf1fd14430485f8cb9"
                },
                {
                  "product_retailer_id": "61a2657c1fd14430485f9f0e"
                },
              ],
            },
            {
              "title": "MENÚ INFANTIL",
              "product_items": [ 
                {
                  "product_retailer_id": "6550028ec2087c73f3b7775e"
                },
                {
                  "product_retailer_id": "61a118171fd14430485f8d78"
                },
              ]
            }
          ]
        } 
  }
}
else {
    template = { 
      type: "product_list",
      header: { 
          type: "text",
          text: "Para Picar 🍤 y Platos Fuertes 🍝🍲"
        },
        body: {
          text: "Da clic abajo para ver"
        },
        action: {
          catalog_id: "899362489478649",
          sections: [
          {
            "title": "PARA PICAR",
            "product_items": [
              {
                "product_retailer_id": "5de86e87205aba0e1c990910"
              },
              {
                "product_retailer_id": "654ffcee0779b105ec6ac3bd"
              },
              {
                "product_retailer_id": "5dbcae51c557e50e67febfcc"
              },
              {
                "product_retailer_id": "5dbcad3fc557e50e67febfac"
              },
              {
                "product_retailer_id": "5dbcae00c557e50e67febfc0"
              },
              {
                "product_retailer_id": "5dbcb083c557e50e67febfdb"
              },
              {
                "product_retailer_id": "6888523e6fb8ea242c06a0bb"
              }
            ]
          },
          {
            "title": "PLATOS FUERTES",
            "product_items": [
              {
                "product_retailer_id": "67981c57bd2f74e33cfce707"
              },
              {
                "product_retailer_id": "66ef02fa4ff68adb785f09f8"
              },
              {
                "product_retailer_id": "619e8bd01880235f6d5b27e5"
              },
              {
                "product_retailer_id": "5dbcb308c557e50e67febff9"
              },
              {
                "product_retailer_id": "5dbcb38cc557e50e67febffc"
              },
              {
                "product_retailer_id": "5dc733ad7c14810dfd3fec3f"
              },
              {
                "product_retailer_id": "6311736932c31c05fbf10f89"
              },
              {
                "product_retailer_id": "68203e8d7f735e5e48b7ec3b"
              },
              {
                "product_retailer_id": "5e5ae290338d200e065c3577"
              },
              {
                "product_retailer_id": "5dbcb3d9c557e50e67fec005"
              },
              {
                "product_retailer_id": "5dbcb5a6c557e50e67fec022"
              },
              {
                "product_retailer_id": "5de84c6e205aba0e1c9907d0"
              },
              {
                "product_retailer_id": "68203ef70ae0923d28d06765"
              },
              {
                "product_retailer_id": "5dbcb57ec557e50e67fec01f"
              },
              {
                "product_retailer_id": "654ff6380779b105ec6ac20a"
              },
              {
                "product_retailer_id": "654ff7ba33294a05ef9f32f7"
              },
              {
                "product_retailer_id": "61a10ddf1fd14430485f8cb9"
              },
              {
                "product_retailer_id": "61a2657c1fd14430485f9f0e"
              },
            ],
          },
          {
            "title": "MENÚ INFANTIL",
            "product_items": [ 
              {
                "product_retailer_id": "6550028ec2087c73f3b7775e"
              },
              {
                "product_retailer_id": "61a118171fd14430485f8d78"
              },
            ]
          }
        ]
      }
    }
}
  return await whatsappService.sendMenu(to, template);
}

  async menuCarta2(to) {
    try {
      const template = {
        type: "product_list",
      header: { 
          type: "text",
          text: "Pastas, Arroces, Comidas Rápidas 🍔 y Mariscos 🍤"
        },
        body: {
          text: "Da clic abajo para ver"
        },
        action: {
          catalog_id: "899362489478649",
          sections: [
          {
            "title": "PASTAS",
            "product_items": [
              {
                "product_retailer_id": "632df4983bcfe31bedde0e45"
              },
              {
                "product_retailer_id": "5dd9dc26b928d20df3b63e49"
              },
            ]
          },
          {
            "title": "PESCADOS Y MARISCOS",
            "product_items": [
              {
                "product_retailer_id": "619d6d801880235f6d5b1c36"
              },
              {
                "product_retailer_id": "5dcf187deea63f0df843be1e"
              },
              {
                "product_retailer_id": "5e34ebb51ffca60e28d763ef"
              },
            ]
          },
          {
            "title": "ARROCES",
            "product_items": [
              {
                "product_retailer_id": "61a110b91880235f6d5b45a3"
              },
              {
                "product_retailer_id": "5f9b5233ef1e265d296b0f8d"
              },
            ]
          },
          {
            "title": "SÁNDWICHES",
            "product_items": [
              {
                "product_retailer_id": "6796793106b0703ef18a9f72"
              },
            ]
          },
          {
            "title": "ENSALADAS",
            "product_items": [
              {
                "product_retailer_id": "61a119621880235f6d5b4644"
              },
              {
                "product_retailer_id": "61a119421fd14430485f8d96"
              },
            ]
          },
          {
            "title": "SUSHI",
            "product_items": [
              {
                "product_retailer_id": "618b0decad2f690565ff0342"
              },
            ]
          },
          {
            "title": "COMIDAS RÁPIDAS",
            "product_items": [
              {
                "product_retailer_id": "5f9b5636ef1e265d296b0fd3"
              },
              {
                "product_retailer_id": "5dbcb612c557e50e67fec02b"
              },
              {
                "product_retailer_id": "5dbcb645c557e50e67fec02e"
              },
              {
                "product_retailer_id": "67981bf757fc699d06fbe11c"
              },
              {
                "product_retailer_id": "5ef55e5619721c49eb8bb24a"
              },
              {
                "product_retailer_id": "5dbcb6a5c557e50e67fec03e"
              },
              {
                "product_retailer_id": "5dbcb67cc557e50e67fec031"
              },
              {
                "product_retailer_id": "5dc7332e7c14810dfd3fec34"
              },
              {
                "product_retailer_id": "5f9b3922ef1e265d296b0d95"
              },
              {
                "product_retailer_id": "5dc7337b7c14810dfd3fec38"
              },
            ]
          },
        ]
      } 
  }
    return await whatsappService.sendMenu(to, template);
  }
  catch (error) {
      logAxiosError('menuCarta2', error); // (antes printDetailedError, que no existe: el error se perdía)
    }
}

  async menuCarta3(to) {
    const template = { 
      type: "product_list",
      header: { 
          type: "text",
          text: "Jugos 🍹cócteles 🍸 y bebidas 🍺"
        },
        body: {
          text: "Da clic abajo para ver"
        },
        action: {
          catalog_id: "899362489478649",
          sections: [
          {
            "title": "BEBIDAS y JUGOS",
              "product_items": [
                {
                  "product_retailer_id": "5dc099e151aceb0dd757c620"
                },
                {
                  "product_retailer_id": "5dbe24b354eef30e209928e8"
                },
                {
                  "product_retailer_id": "6a330907fcb370a10498d9ac"
                },
                {
                  "product_retailer_id": "5dc0a48751aceb0dd757c6fa"
                },
                {
                  "product_retailer_id": "5dc0a48751aceb0dd757c6fb"
                },
                {
                  "product_retailer_id": "5dc0a48751aceb0dd757c6fc"
                },
                {
                  "product_retailer_id": "5dc0a60f51aceb0dd757c70f"
                },
            ]
          },
          {
            "title": "POSTRES y MALTEADAS",
              "product_items": [
                {
                  "product_retailer_id": "5dc4ce4651aceb0dd757e786"
                },
                {
                  "product_retailer_id": "639c9b7d3c1b5a05f0d8fb97"
                },
                {
                  "product_retailer_id": "5f9b455cef1e265d296b0eab"
                },
                {
                  "product_retailer_id": "639c9ba452617c1b981ee446"
                },
                {
                  "product_retailer_id": "65500860c2087c73f3b778a3"
                },
                {
                  "product_retailer_id": "6133e235d145504ca38cbd7e"
                },
            ]
          }
        ]
    }
  }
    
    return await whatsappService.sendMenu(to, template);
  }

  async encuesta(to) {
    const action = {
      name: "flow",
      parameters: {
        "flow_message_version": "3",
        "flow_id": config.FLOW_ID_ENCUESTA,
        "flow_token": tokenFlow('encuesta', to),
        "flow_cta": "Encuesta"
      },
    }
    return await whatsappService.sendFlowEncuesta(to, action);
  }

  async catalogo(to) {
    const template = { 
      name: "catalogosamuelito ",
      language: { 
          code: "Es_Co" },
      components: [
          {
            type: "button",
            sub_type: "CATALOG",
            index: 0
          }
      ]
    };
    await whatsappService.sendCatalogo(to, template);
  }

  waiting = (delay, callback) => {
    setTimeout(callback, delay);
  };
  
  async handleMenuOption(to, option) {
    let response;
    // v3.5: confirmar / agregar / cambiar el pedido y adicionales.
    switch (option) {
      case 'ped_ok': return this.confirmarPedido(to);
      case 'ped_mas': return this.prepararCarrito(to, 'agregar');
      case 'ped_cambiar': return this.prepararCarrito(to, 'reemplazar');
      case 'cart_sumar': return this.usarCarritoNuevo(to, 'agregar');
      case 'cart_reemplazar': return this.usarCarritoNuevo(to, 'reemplazar');
      case 'ad_si': return this.procesarAdicional(to);
      case 'ad_no': return this.usarCarritoNuevo(to, 'nuevo');
      default: break;
    }
    // v3.5: una carta por palabra clave ("quiero ver las hamburguesas").
    if (typeof option === 'string' && option.startsWith('cat:')) {
      const key = option.slice(4);
      if (key === 'bebidas_postres') return this.menuCarta3(to);
      if (key === 'rapidas_mariscos') await this.menuCarta2(to);
      else await this.menuCarta(to);
      await this.botonSi(to);
      return;
    }
    switch (option) {
      case 'option_1':
        await this.menuCarta(to);
        await this.menuCarta2(to);
        await this.botonSi(to);
        // await this.catalogo(to);
        break;
      case 'option_2':
        await this.sendMediaEvento(to);
        await this.menuReserva(to);
        break;
      case 'option_3':
        this.assistandState[to] = { step: 'question' };
        response = 'Realiza tu pregunta: ';
        break;
      case 'option_4':
        response = "Te esperamos en nuestro restaurante! 📍";
        await this.sendLocation(to);
        break;
      case 'option_5':
        response = "Es un placer para nosotros servirte, que disfrutes de tu pedido 😊👩‍🍳\nVuelve pronto!";
        break;
      case 'op_3':
        response = 'Escribe a nuestro Whatsapp personal🤗';
        await this.sendContact(to);
        break;
      case 'opt1':
        await this.encuesta(to);
        break;
      case 'si':
        await this.menuCarta3(to);
        break;
      default:
        this.assistandState[to] = { step: 'question' };
    }
    if (response) {
      await whatsappService.sendMessage(to, response);
    }
  }

  async handleAppointmentFlow(to, message) {
    const state = this.appointmentState[to];
    delete this.appointmentState[to];
    let response;
  
    switch (state.step) {
      case 'reserva':
        await this.menuReserva(to);
        break;
      default:
        response = "Lo siento 😔 no entendí tu respuesta\nPor Favor, elige una de las opciones del menú.";
        await whatsappService.sendMessage(to, response);
      }
  }

  /** (Compatibilidad) Antes mandaba el Flow de una vez; ahora primero se confirma el pedido. */
  async handleHiringFlow(to) {
    return this.pedirConfirmacion(to);
  }

  /**
   * Cobro según el medio de pago elegido en el Flow (Efectivo, PSE o Transferencia).
   * Se usa al llenar el Flow y también para los ADICIONALES (mismos datos, sin volver a llenarlo).
   * Devuelve el texto para el cliente.
   */
  async cobrarPedido(to, datosPedido, pedidoStr, { adicional = false } = {}) {
    let response;
    const pedidoStrTemplate = String(pedidoStr ?? '').replace(/\n/g, '  |  ');
    const datos = datosPedido.datos;
    const direccion = esDomicilio(datos) ? datos.address : RECOGIDA;
    if (datos.pago === "Efectivo") {
      const templateVars = [
        datos.name,
        datos.phone,
        direccion,
        pedidoStrTemplate,
        datos.pago,
        datosPedido.monto ? datosPedido.monto.toLocaleString('es-CO') : ""
      ];
      await this.avisarNumerosOficiales("mensaje_nuevo_pedido", IMAGEN_PEDIDO, templateVars);
      response = adicional
        ? `✅ ¡Adicional recibido! Lo sumamos a tu pedido.\n*Total del adicional:* ${cop(datosPedido.monto)} (pagas en efectivo al recibir) 🤗`
        : "✅¡Pedido recibido!\nPronto nos pondremos en contacto contigo! 🤗";
    } else if (datos.pago === "PSE") {
      try {
        userOrderDataMap[to] = {
          ...datos,
          address: direccion,
          monto: datosPedido.monto,
          pedidoStr: pedidoStrTemplate
        };
        // Generar enlace de pago WOMPI (con el domicilio incluido si aplica)
        const idlink = await createWompiPaymentLink(
          datosPedido.monto * 100, // Monto en centavos
          "COP",
          pedidoStr
        );
        transactionToPhoneMap[idlink] = to;
        // Enviar mensaje con el enlace de pago
        response = `*Resumen de tu pedido*🛒:\n\n${pedidoStr}\n*Total:* $${datosPedido.monto.toLocaleString('es-CO')} COP\n\nUtiliza el siguiente *link de pago*:\n\nhttps://checkout.wompi.co/l/${idlink}\n\nLuego de realizar el pago espera unos segundos y automáticamente te lo confirmamos! 😊`;
      } catch (error) {
        response = "Hubo un problema al generar el enlace de pago. Por favor, intenta nuevamente.";
        reportarFalla(error, { to, step: 'generar el link de pago de Wompi (PSE)', monto: datosPedido.monto, pedido: pedidoStrTemplate });
      }
    } else if (datos.pago === "Transferencia") {
      userOrderDataMap[to] = {
        ...datos,
        address: direccion,
        monto: datosPedido.monto,
        pedidoStr: pedidoStrTemplate
      };
      sesion(to).esperandoComprobante = true;
      response = `*Resumen de tu pedido*🛒:\n\n${pedidoStr}\n*Total:* $${datosPedido.monto.toLocaleString('es-CO')} COP\n\n🏦Cuentas bancarias:\n\n*Nequi:* 3135364869\n*Mar** Ari***\n\n*Bancolombia Ahorros:* 70423175395\nMar** Pat** Ari**\n\n*Banco BBVA:* 0614001209\n\nLuego, envíanos el comprobante de la transferencia (captura) para confirmar tu pedido 😊`;
    }
    return response;
  }

  async respFlow(to, screen, datosReserva, datosPedido, pedidoStr) {
    let response;
    if (screen === "SUMMARY") {
      if (!datosPedido?.datos) {
        await whatsappService.sendMessage(to, 'No encontré los datos de tu pedido 😔. Vuelve a enviarlo desde el carrito, por favor.');
        return;
      }
      // Domicilio ($3.000) solo si escribió una dirección, y una sola vez aunque el Flow llegue repetido.
      if (esDomicilio(datosPedido.datos)) {
        if (!datosPedido.domicilioIncluido) {
          datosPedido.monto = Number(datosPedido.monto || 0) + negocio.domicilio;
          datosPedido.domicilioIncluido = true;
        }
      } else {
        datosPedido.datos.address = RECOGIDA;
      }
      response = await this.cobrarPedido(to, datosPedido, pedidoStr);
      if (response) await whatsappService.sendMessage(to, response);
      // En efectivo el pedido ya quedó: se ofrece la encuesta (después del "¡Pedido recibido!").
      if (datosPedido.datos.pago === "Efectivo") await this.menuOpcionalHiring(to);
      return;
    } else if (screen === "RESUMEN") {
      if (!datosReserva) {
        await whatsappService.sendMessage(to, 'No encontré los datos de tu reserva 😔. Vuelve a llenarla, por favor.');
        await this.menuReserva(to);
        return;
      }
      const horario = datosReserva.evento === "Festival Gastronomico" 
        ? 'hora' 
        : datosReserva.evento === "Cumpleaños" 
          ? 'horario'
          : datosReserva.evento === "Reserva normal"
          ? 'horanormal'
          : "";
      
      const calendario = datosReserva.evento === "Festival Gastronomico" 
        ? 'fechafestival' 
        : datosReserva.evento === "Cumpleaños" 
          ? 'fecha'
          : datosReserva.evento === "Reserva normal"
          ? 'fechanormal'
          : "";

      // Variables para la plantilla (en el orden del body)
      const templateVars = [
        datosReserva.nombre,
        datosReserva.celular,
        datosReserva.evento,
        datosReserva[calendario],
        datosReserva[horario],
        datosReserva.cuantos,
        datosReserva.donde
      ];

      for (const numero of [to, ...negocio.numerosOficiales]) {
        await whatsappService.sendTemplateReserva(numero, IMAGEN_RESERVA, templateVars);
      }
      await this.sendLocation(to);

    } else if (screen === "RATE") {
      response = "¡Recibido!\nMuchas gracias por tu opinión! 🤗";
    }
    if (response) {
      await whatsappService.sendMessage(to, response);
    }
  }

  /** Comprobante de transferencia (imagen) → S3 → aviso a los números oficiales. */
  async recibirComprobante(message) {
    const from = message.from;
    sesion(from).esperandoComprobante = false;
    const datosUsuario = userOrderDataMap[from] || {};
    let publicUrl = IMAGEN_PEDIDO;
    try {
      // 1. Descargar la imagen de Meta y 2. subirla a S3
      const imageBuffer = await downloadImageFromMeta(message.image.url);
      publicUrl = await uploadToPublicStorage(imageBuffer, message.image.mime_type);
    } catch (error) {
      logAxiosError('comprobante', error);
      reportarFalla(error, { to: from, level: 'warning', step: 'descargar el comprobante de Meta y subirlo a S3' });
    }
    // 3. Enviar la imagen a los números oficiales
    const templateVars = [
      datosUsuario.name || "",
      datosUsuario.phone || "",
      datosUsuario.address || "",
      datosUsuario.pedidoStr || "",
      datosUsuario.pago || "",
      datosUsuario.monto ? datosUsuario.monto.toLocaleString('es-CO') : "",
    ];
    await this.avisarNumerosOficiales("comprobante_pago", publicUrl, templateVars);

    const msg = "Gracias por compartirnos el comprobante de tu pago ✅\n\nPronto nos pondremos en contacto contigo para confirmar tu pedido 😊";
    await whatsappService.sendMessage(from, msg);
    await this.menuOpcionalHiring(from);
  }

  async avisarNumerosOficiales(plantilla, imagen, templateVars) {
    for (const numero of negocio.numerosOficiales) {
      await whatsappService.sendTemplateComprobantePago(numero, plantilla, imagen, templateVars);
    }
  }

  async handleWompiEvent(transaction) {
    try {
      const transactionId = transaction.id;
      const paymentLinkId = transaction.payment_link_id;
      const phone = transactionToPhoneMap[paymentLinkId];
      const spreadsheetId = process.env.SPREADSHEETID_PEDIDO;
      
      if (!phone) {
        console.error("No se encontró el número de WhatsApp para la transacción:", paymentLinkId);
        reportarFalla(new Error(`Pago de Wompi sin cliente asociado (link ${paymentLinkId}): el cliente no recibió la confirmación`), { step: 'evento de pago de Wompi', transaccion: transaction.id, estado: transaction.status });
        return;
      }
      let status;
      try {
        status = await getWompiTransactionStatus(transactionId);
      } catch (error) {
        console.error("Error consultando el estado de la transacción:", error);
        return;
      }
      console.log(`Estado de la transacción ${transactionId}: ${status}`);
      let estadoPago;
      if (status === "APPROVED") {
        estadoPago = "Pagado";
      }
      else if (status === "DECLINED" || status === "VOIDED" || status === "ERROR") {
        estadoPago = "Rechazado";
      } else if (status === "PENDING") {
        estadoPago = "Pendiente";
      } else {
        estadoPago = status;
      }
      const fechayhora = paymentRowMap[phone]
      await saveUserDataByNumber({ numero: phone, fechayhora, estado: estadoPago }, spreadsheetId);

      let statusMsg = "";
      if (status === "APPROVED") {
        // Antes se buscaba con el número del último cliente que escribió; ahora, con el de la transacción.
        const datosUsuario = userOrderDataMap[phone] || {};
        const templateVars = [
          datosUsuario.name || "",
          datosUsuario.phone || "",
          datosUsuario.address || "",
          datosUsuario.pedidoStr || "",
          datosUsuario.pago || "",
          datosUsuario.monto ? datosUsuario.monto.toLocaleString('es-CO') : "",
        ];
        await this.avisarNumerosOficiales("mensaje_nuevo_pedido", IMAGEN_PEDIDO, templateVars);

        statusMsg = "✅ ¡Pago aprobado!\nTu pedido está confirmado.\nPronto nos pondremos en contacto contigo.";
        await this.menuOpcionalHiring(phone);
      } else if (status === "DECLINED" || status === "VOIDED" || status === "ERROR") {
        statusMsg = "❌ El pago fue rechazado\nPor favor, revisa tu medio de pago. Si deseas reintentar, utiliza el mismo link de pago que te enviamos anteriormente.";
      } else if (status === "PENDING") {
        statusMsg = "⏳ Tu pago está pendiente de confirmación.\nTe avisaremos cuando se apruebe.";
      } else {
        statusMsg = `El estado de tu transacción es: ${status}`;
      }
 
      await whatsappService.sendMessage(phone, statusMsg);

    } catch (error) {
      console.error("Error en handleWompiEvent:", error);
    }
  }

  async helpMenu(to) {
    const response = "Bienvenido al menú de ayuda de *Samuelito Restobar*\n\nPara hacer una pregunta escríbela finalizando con el signo *?*\n\nSi tienes alguna consulta o requerimiento hazla con palabras interrogantes (Qué, Cómo, Por qué, etc.)\n\nPara solicitar la carta escribe *Carta*\nPara hablar con un asesor escribe *Asesor*\nPara solicitar la ubicación escribe *Ubicacion*\n\nEspero te sirva! 😊"
  
    await whatsappService.sendMessage(to, response);
  }

  async sendMedia(to) {
    const mediaUrl = 'https://micarta.s3.us-east-1.amazonaws.com/crm/7c9e0325-6a8e-4198-a2f8-0611896a6e6a/knowledge/e43b6d3a-ba68-4de7-82bf-70c1bec50f39.pdf';
    const caption = '¡Aquí tienes la carta!';
    const type = 'document';

    await whatsappService.sendMediaMessage(to, type, mediaUrl, caption);
  }
  
  async sendMediaEvento(to) {
    const mediaUrl = 'https://micarta.s3.us-east-1.amazonaws.com/Reserva+tu+mesa.jpg';
    // const caption = '¡Reserva tu mesa!';
    const type = 'image';

    await whatsappService.sendMediaMessage(to, type, mediaUrl);
  }

  completeHiring(productos, data, numero) {
    let fechayhora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    let userData;
    const spreadsheetId = process.env.SPREADSHEETID_PEDIDO;
      userData = [
        numero,
        data.name,
        productos,
        data.address,
        data.phone,
        data.pago,
        data.recomendacion,
        fechayhora,
      ]
    paymentRowMap[numero] = fechayhora;
    appendToSheet(userData, spreadsheetId);
  }
  
completeOrder(productos, data, { adicional = false } = {}) {
  const waiterOrderArea = {
    // Barril
    "6134f560fd56a10e49c4f666": [
      "6133f09d5af774183ce25e0f",
      "6133e891d145504ca38cbeeb",
      "6133f070d145504ca38cbf3a",
    ],
    // Cocina
    "5da0e17b86a93953dd2763bc": [
      "5de86e87205aba0e1c990910",
      "654ffcee0779b105ec6ac3bd",
      "5dbcae51c557e50e67febfcc",
      "5dbcad3fc557e50e67febfac",
      "5dbcae00c557e50e67febfc0",
      "5dbcb083c557e50e67febfdb",
      "6888523e6fb8ea242c06a0bb",
      "67981c57bd2f74e33cfce707",
      "66ef02fa4ff68adb785f09f8",
      "619e8bd01880235f6d5b27e5",
      "5dbcb308c557e50e67febff9",
      "5dbcb38cc557e50e67febffc",
      "5dc733ad7c14810dfd3fec3f",
      "68203e8d7f735e5e48b7ec3b",
      "5e5ae290338d200e065c3577",
      "67981d4d8460dcaf720f2284",
      "5dcf187deea63f0df843be1e",
      "5dbcb3d9c557e50e67fec005",
      "6311736932c31c05fbf10f89",
      "5dbcb5a6c557e50e67fec022",
      "5de84c6e205aba0e1c9907d0",
      "68203ef70ae0923d28d06765",
      "5dbcb57ec557e50e67fec01f",
      "654ff6380779b105ec6ac20a",
      "654ff7ba33294a05ef9f32f7",
      "61a10ddf1fd14430485f8cb9",
      "61a2657c1fd14430485f9f0e",
      "6550028ec2087c73f3b7775e",
      "61a118171fd14430485f8d78",
      "619d6d801880235f6d5b1c36",
      "632df4983bcfe31bedde0e45",
      "5dd9dc26b928d20df3b63e49",
      "5e34ebb51ffca60e28d763ef",
      "61a110b91880235f6d5b45a3",
      "5f9b5233ef1e265d296b0f8d",
      "6796793106b0703ef18a9f72",
      "61a119621880235f6d5b4644",
      "61a119421fd14430485f8d96",
      "618b0decad2f690565ff0342",
      "67981a7ca9cfd2df9753864e",
      "5f9b5636ef1e265d296b0fd3",
      "5dbcb612c557e50e67fec02b",
      "5dbcb645c557e50e67fec02e",
      "67981bf757fc699d06fbe11c",
      "5ef55e5619721c49eb8bb24a",
      "5dbcb6a5c557e50e67fec03e",
      "5dbcb67cc557e50e67fec031",
      "5dc7332e7c14810dfd3fec34",
      "5f9b3922ef1e265d296b0d95",
      "5dc7337b7c14810dfd3fec38",

    ],
    // Bar
    "5da0e1817511f32c929a0078": [
      "5dc099e151aceb0dd757c620",
      "5dbe24b354eef30e209928e8",
      "5dc0a48751aceb0dd757c6fa",
      "5dc0a48751aceb0dd757c6fb",
      "5dc0a48751aceb0dd757c6fc",
      "5dc0a60f51aceb0dd757c70f",
      "5dc4ce4651aceb0dd757e786",
      "639c9b7d3c1b5a05f0d8fb97",
      "5f9b455cef1e265d296b0eab",
      "639c9ba452617c1b981ee446",
      "65500860c2087c73f3b778a3",
      "6133e235d145504ca38cbd7e",
      "6a330907fcb370a10498d9ac"
    ]
  };

  function getWaiterOrderArea(productId) {
    for (const [areaId, productIds] of Object.entries(waiterOrderArea)) {
      if (productIds.includes(productId)) {
        return areaId;
      }
    }
    return null;
  }

  // Construye el array de orders con waiterOrderArea y solo la recomendación del cliente
  const orders = productos.map(item => ({
    product: item.product_retailer_id,
    locationStock: "5d4619b4a8337b56866de6ff",
    waiterOrderArea: getWaiterOrderArea(item.product_retailer_id),
    quantity: item.quantity,
    unit_price: item.item_price,
    notes: data.recomendacion || ""
  }));

  // Si hay domicilio, agrégalo como un producto más (en un ADICIONAL no se cobra otra vez)
  if (!adicional && esDomicilio(data)) {
    orders.push({
      product: "677ad5b1b4797f0dcba09e41",
      locationStock: "5d4619b4a8337b56866de6ff",
      quantity: 1,
      unit_price: 3000,
      notes: "Domicilio"
    });
  }

  const pedidoLoggro = {
    table: "6939640ddf7998fb29e63fab",
    groupName: `${adicional ? '➕ ADICIONAL\n' : ''}Nombre: ${data.name}\nTeléfono: ${data.phone}\nDirección: ${esDomicilio(data) ? data.address : RECOGIDA}`,
    orders
  };

  enviarPedidoALoggro(pedidoLoggro);
}

  completeSurvey(data, numeroCliente) {
    let fechayhora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    let userData;
    const spreadsheetId = process.env.SPREADSHEETID_SURVEY;
    const numero = numeroCliente || "No disponible"; // viene del flow_token (antes: el último que escribió)
      userData = [
        numero,
        data.experiencia_cliente,
        data.servicio_cliente,
        data.calidad_comida,
        data.recomendacion,
        data.comentarios,
        fechayhora,
      ]

    appendToSheet(userData, spreadsheetId);
  }

  completeAppointment(data, numeroCliente) {
    let fechayhora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    const spreadsheetId = process.env.SPREADSHEETID_RESERVA;
    const number = numeroCliente || "No disponible"; // viene del flow_token (antes: el último que escribió)
    const horario = data.evento === "Festival Gastronomico" 
      ? 'hora' 
      : data.evento === "Cumpleaños" 
        ? 'horario'
        : data.evento === "Reserva normal"
        ? 'horanormal'
        : "";
    const calendario = data.evento === "Festival Gastronomico" 
      ? 'fechafestival' 
      : data.evento === "Cumpleaños" 
        ? 'fecha'
        : data.evento === "Reserva normal"
        ? 'fechanormal'
        : "";
    const userData = [
      number,
      data.nombre,
      data.celular,
      data.evento,
      data[calendario],
      data[horario],
      data.cuantos,
      data.donde,
      fechayhora
    ]

    appendToSheet(userData, spreadsheetId);
  }

  /**
   * Respuesta de la IA del CRM. Si el cliente tiene un pedido sin terminar, después
   * de responder se le recuerda (sin perder el pedido); si no, "¿Resolví tu pregunta?"
   * solo cuando fue una pregunta.
   */
  async handleAssistandFlow(to, message, { botones = true } = {}) {
    delete this.assistandState[to];
    const response = (await geminiService(message, to)) ?? AI_UNAVAILABLE;
    await whatsappService.sendMessage(to, response);
    if (this.pedidoPendiente(to)) {
      await this.recordarPedido(to);
    } else if (botones) {
      await whatsappService.sendInteractiveButtons(to, "¿Resolví tu pregunta?", [
        { type: 'reply', reply: { id: 'option_4', title: "Si, Gracias 😊" } },
        { type: 'reply', reply: { id: 'option_3', title: 'Hacer otra pregunta' } },
        // { type: 'reply', reply: { id: 'op_3', title: 'Hablar con asesor 🤵' } }
      ]);
    }
  }

  async handleAssistand(to, message) {
    const state = this.assistandState[to];
    let response;

    switch (state?.step) {
      case 'question':
        response = (await geminiService(message, to)) ?? AI_UNAVAILABLE;
        break;
      default:
        response = "Lo siento 😔 no entendí tu respuesta\nPor Favor, elige una de las opciones del menú.";
    }

    delete this.assistandState[to];
    await whatsappService.sendMessage(to, response);
  }

  async sendContact(to) {
    const contact = {
      addresses: [
        {
          street: "Calle 10 #9-133",
          city: "La Loma",
          state: "Cesar",
          zip: "201038",
          country: "Colombia",
          country_code: "CO",
          type: "WORK"
        }
      ],
      emails: [
        {
          email: "samuelitorestobar@gmail.com",
          type: "WORK"
        }
      ],
      name: {
        formatted_name: "Samuelito RestoBar",
        first_name: "Samuelito",
        last_name: "RestoBar",
        middle_name: "",
        suffix: "",
        prefix: ""
      },
      org: {
        company: "Samuelito RestoBar",
        department: "Atención al Cliente",
        title: "Representante"
      },
      phones: [
        {
          phone: "+573153652520",
          wa_id: "573153652520",
          type: "WORK"
        }
      ],
      urls: [
        {
          url: "https://www.samuelitorestobar.com/",
          type: "WORK"
        }
      ]
    };

    await whatsappService.sendContactMessage(to, contact);
  }

  async sendLocation(to) {
    const latitude = 9.619971;
    const longitude = -73.592176;
    const name = 'Samuelito Restobar';
    const address = 'Cll 10 #9-133, La Loma, El Paso, Cesar'

    await whatsappService.sendLocationMessage(to, latitude, longitude, name, address);
  }


  // ===========================================================================
  //  v3.5 · Conversación
  // ===========================================================================

  /**
   * Texto del cliente dentro del horario.
   *  1. Saludo: la bienvenida sale UNA vez por turno; "hola, ¿se demora?" atiende la pregunta.
   *  2. "gracias", "ok" → respuesta corta (nunca la bienvenida otra vez).
   *  3. Palabras clave de siempre (ayuda, carta, menú, ubicación, asesor, reservar).
   *  4. Preguntas generales (tiempos, pagos, domicilio, estado del pedido) → IA del CRM.
   *  5. Platos ("me regalas 2 perros") → búsqueda con IA → tarjetas / carrusel
   *     (solo productos con foto en Meta; Asados al Barril solo los domingos).
   *  6. Todo lo demás → IA del CRM (antes quedaba sin respuesta).
   * Si hay un pedido sin terminar, se le recuerda después de responder.
   */
  async atenderTexto(from, message, senderInfo) {
    try {
      return await this.responderTexto(from, message, senderInfo);
    } finally {
      await whatsappService.markAsRead(message.id);
    }
  }

  async responderTexto(from, message, senderInfo) {
    const texto = String(message.text?.body ?? '').trim();
    const s = sesion(from);

    const { saludo, resto } = separarSaludo(texto);
    if (saludo) {
      const turno = turnoActual() ?? 'fuera';
      const primeraVez = s.bienvenidaTurno !== turno;
      if (primeraVez) {
        s.bienvenidaTurno = turno;
        await this.sendWelcomeMessage(from, message.id, senderInfo);
      }
      if (!resto) {
        if (!primeraVez) {
          const nombre = this.firstName(senderInfo);
          await whatsappService.sendMessage(from, `¡Hola de nuevo${nombre ? `, ${nombre}` : ''}! 😊 ¿En qué te puedo ayudar?`);
        }
        if (this.pedidoPendiente(from)) await this.recordarPedido(from);
        else if (primeraVez) await this.sendWelcomeMenu(from);
        return;
      }
    }

    const t = saludo ? resto : texto;
    const lower = t.toLowerCase().trim();
    const pregunta = this.isQuestion(lower);

    if (esCortesia(t)) {
      await whatsappService.sendMessage(from, this.pedidoPendiente(from) ? '¡Con gusto! 😊' : '¡Con gusto! 😊 Aquí estamos si necesitas algo más.');
      if (this.pedidoPendiente(from)) await this.recordarPedido(from);
      return;
    }
    if (esCancelar(t) && this.pedidoPendiente(from)) return this.cancelarPedido(from);

    // Palabras clave (igual que antes).
    if (lower === 'ayuda') return this.helpMenu(from);
    if (lower.includes('carta')) {
      await whatsappService.sendMessage(from, "Espera que cargue la carta... 📄");
      return this.sendMedia(from);
    }
    if (/\bmen[uú]\b/.test(lower) && !hablaDePlatos(t)) return this.catalogo(from);
    if (lower === 'ubicacion' || lower === 'ubicación') return this.sendLocation(from);
    if (lower === 'asesor') return this.sendContact(from);
    if (this.isReservation(lower)) return this.handleMenuOption(from, 'option_2');
    if (this.appointmentState[from]) return this.handleAppointmentFlow(from, lower);

    // "Hacer otra pregunta" o preguntas de tiempos, pagos, domicilio, estado del pedido → IA.
    if (this.assistandState[from] || esPreguntaGeneral(t)) return this.handleAssistandFlow(from, t, { botones: pregunta });

    // Platos: la IA completa el nombre y se muestran las tarjetas del catálogo.
    // v3.6: "¿qué hamburguesas tienes?", "¿tienen malteadas?" piden un producto: solo tarjetas, sin texto de la IA.
    const pideProducto = !pregunta || esPeticionDeProducto(t);
    if (hablaDePlatos(t)) {
      const { tarjetas, sinFoto, soloDomingo } = await buscarPlatos(from, t);
      const carta = this.cartaPorTexto(lower);
      if (tarjetas.length > 10 && carta && pideProducto) return this.handleMenuOption(from, `cat:${carta}`); // "quiero una pizza" → la carta completa
      if (tarjetas.length) {
        if (!pideProducto) {
          // "¿la Samuelito Burger qué trae?": responde la IA y debajo quedan las tarjetas para pedir.
          const respuesta = await geminiService(t, from);
          if (respuesta) await whatsappService.sendMessage(from, respuesta);
        }
        await enviarTarjetas(from, tarjetas, t);
        return;
      }
      if (soloDomingo?.length) {
        // "Chicharrón al barril" un martes: solo los domingos.
        await whatsappService.sendMessage(from, textoSoloDomingo(soloDomingo));
        return;
      }
      if (sinFoto?.length && pideProducto) {
        // Lo pidió, pero todavía no tiene foto en Meta (no sale en el catálogo de WhatsApp).
        await whatsappService.sendMessage(from, textoSinFoto(sinFoto));
        return;
      }
    }
    const carta = this.cartaPorTexto(lower);
    if (carta && !pregunta) return this.handleMenuOption(from, `cat:${carta}`);
    if (!pregunta && this.isOrder(lower)) {
      if (this.pedidoPendiente(from)) return this.recordarPedido(from);
      return this.handleMenuOption(from, 'option_1');
    }
    return this.handleAssistandFlow(from, t, { botones: pregunta });
  }

  // ===========================================================================
  //  v3.5 · Pedido: confirmar, agregar, cambiar, recordatorios y adicionales
  // ===========================================================================

  /** Pedido del carrito que todavía no tiene los datos del Flow. */
  pedidoPendiente(to) {
    const s = obtenerSesion(to);
    return Boolean(s?.pedido && ['confirmar', 'datos'].includes(s.pedido.estado) && s.productos?.length);
  }

  /** Nombres y total de un carrito (los nombres salen de src/data/catalogo.js). */
  resumenCarrito(items) {
    const lineas = items.map((item) => {
      const nombre = nombrePorId[item.product_retailer_id] || item.product_retailer_id;
      if (!nombrePorId[item.product_retailer_id]) console.warn('[pedido] producto sin nombre en data/catalogo.js:', item.product_retailer_id);
      return `${nombre} x${item.quantity}`;
    });
    const monto = items.reduce((t, i) => t + (Number(i.item_price) || 0) * (Number(i.quantity) || 1), 0);
    return { pedidoStr: lineas.join('\n'), monto };
  }

  /** Carrito que llega del catálogo de WhatsApp ("Pedido del catálogo"). */
  async recibirCarrito(to, order) {
    const items = (order?.product_items ?? []).map((i) => ({
      product_retailer_id: String(i.product_retailer_id),
      quantity: Number(i.quantity) || 1,
      item_price: Number(i.item_price) || 0,
      currency: i.currency,
    }));
    if (!items.length) return;
    const s = sesion(to);

    if (!isWithinBusinessHours()) {
      await whatsappService.sendMessage(to, `🌙 En este momento estamos cerrados. Recibimos pedidos ${negocio.horarioTexto()}.\nTu carrito queda guardado en WhatsApp 🛒: envíalo de nuevo cuando abramos 😊`);
      return;
    }

    // ¿Ya llenó el Flow hace poco? Puede ser un ADICIONAL a ese pedido.
    const p = s.pedido;
    if (p?.estado === 'enviado' && p.datos && Date.now() - (p.ultimoAt ?? p.enviadoAt ?? 0) < config.ADICIONAL_MINUTOS * 60000) {
      s.carritoNuevo = items;
      const { pedidoStr, monto } = this.resumenCarrito(items);
      await whatsappService.sendInteractiveButtons(to, `Recibí estos productos 🛒\n\n${pedidoStr}\n*Total:* ${cop(monto)}\n\n¿Son un *adicional* para el pedido que ya enviaste? (mismos datos de entrega y pago, sin volver a llenar el formulario)`.slice(0, 1024), [
        { type: 'reply', reply: { id: 'ad_si', title: 'Sí, es adicional' } },
        { type: 'reply', reply: { id: 'ad_no', title: 'Es un pedido nuevo' } },
      ]);
      return;
    }

    // ¿Tiene un pedido sin terminar? Se suma o se reemplaza (lo que haya elegido, o se le pregunta).
    if (this.pedidoPendiente(to)) {
      if (s.modoCarrito) {
        const modo = s.modoCarrito;
        s.modoCarrito = null;
        return this.aplicarCarrito(to, items, modo);
      }
      s.carritoNuevo = items;
      const nuevo = this.resumenCarrito(items);
      await whatsappService.sendInteractiveButtons(to, `Ya tienes un pedido sin terminar:\n\n${s.pedidoStr}\n\nY acabas de enviar:\n\n${nuevo.pedidoStr}\n\n¿Qué hago con estos productos?`.slice(0, 1024), [
        { type: 'reply', reply: { id: 'cart_sumar', title: 'Agregar al pedido' } },
        { type: 'reply', reply: { id: 'cart_reemplazar', title: 'Reemplazar pedido' } },
      ]);
      return;
    }
    return this.aplicarCarrito(to, items, 'nuevo');
  }

  /** Arma el pedido con el carrito (nuevo, sumado al anterior o reemplazándolo) y pide confirmarlo. */
  async aplicarCarrito(to, items, modo = 'nuevo') {
    const s = sesion(to);
    let lista = items;
    if (modo === 'agregar' && s.productos?.length) {
      const porId = new Map(s.productos.map((i) => [i.product_retailer_id, { ...i }]));
      for (const i of items) {
        const actual = porId.get(i.product_retailer_id);
        if (actual) actual.quantity = (Number(actual.quantity) || 0) + (Number(i.quantity) || 0);
        else porId.set(i.product_retailer_id, { ...i });
      }
      lista = [...porId.values()];
    }
    const { pedidoStr, monto } = this.resumenCarrito(lista);
    nuevoPedido(to, { productos: lista, pedidoStr, monto });
    const recordatorios = modo === 'nuevo' ? 0 : s.pedido?.recordatorios ?? 0;
    s.pedido = { estado: 'confirmar', creadoAt: Date.now(), recordatorios };
    s.carritoNuevo = null;
    s.modoCarrito = null;
    await this.pedirConfirmacion(to, { modo });
    this.programarRecordatorio(to);
  }

  /** "¿Está todo bien?" antes de mandar el Flow: confirmar, agregar más o cambiar. */
  async pedirConfirmacion(to, { modo = 'nuevo' } = {}) {
    const s = sesion(to);
    const intro = modo === 'agregar' ? '✅ Listo, lo agregué.\n\n' : modo === 'reemplazar' ? '✅ Listo, cambié tu pedido.\n\n' : '';
    const domicilio = negocio.domicilio ? `\n_(Si es a domicilio se suman ${cop(negocio.domicilio)})_` : '';
    const texto = `${intro}*Tu pedido* 🛒\n\n${s.pedidoStr}\n\n*Subtotal:* ${cop(s.datosPedido?.monto)}${domicilio}\n\n¿Está todo bien?`;
    await whatsappService.sendInteractiveButtons(to, texto.slice(0, 1024), BOTONES_CONFIRMAR);
  }

  /** Confirmó: se manda el Flow de datos (entrega y pago). */
  async confirmarPedido(to) {
    const s = sesion(to);
    if (!this.pedidoPendiente(to)) {
      await whatsappService.sendMessage(to, 'No encontré un pedido pendiente 🤔. Arma tu carrito 🛒 y envíalo, por favor.');
      return;
    }
    s.pedido.estado = 'datos';
    await this.menuPedido(to);
    this.programarRecordatorio(to);
  }

  /** "Agregar más" / "Cambiar pedido": el próximo carrito se suma o reemplaza sin preguntar. */
  async prepararCarrito(to, modo) {
    const s = sesion(to);
    if (!this.pedidoPendiente(to)) {
      await whatsappService.sendMessage(to, 'No encontré un pedido pendiente 🤔. Arma tu carrito 🛒 y envíalo, por favor.');
      return;
    }
    s.modoCarrito = modo;
    await whatsappService.sendMessage(to, modo === 'agregar'
      ? 'Perfecto 👌 Elige lo que quieras agregar y envía el carrito 🛒: lo sumo a tu pedido.'
      : 'Claro 👌 Arma tu carrito 🛒 con el pedido como lo quieres y envíalo: reemplazo el anterior.\n\n💡 En el carrito puedes cambiar cantidades o quitar productos antes de enviarlo.');
    await this.menuCarta(to);
    await this.menuCarta2(to);
    this.programarRecordatorio(to);
  }

  /** Respuesta a "¿Agregar o reemplazar?" / "¿Es adicional?" sobre el último carrito. */
  async usarCarritoNuevo(to, modo) {
    const s = sesion(to);
    if (!s.carritoNuevo?.length) {
      await whatsappService.sendMessage(to, 'No encontré los productos 🤔. Envía el carrito de nuevo, por favor.');
      return;
    }
    if (modo === 'nuevo') s.pedido = null; // pedido nuevo (el anterior ya se envió)
    return this.aplicarCarrito(to, s.carritoNuevo, modo);
  }

  /** ADICIONAL a un pedido ya enviado: mismos datos del Flow, sin domicilio otra vez. */
  async procesarAdicional(to) {
    const s = sesion(to);
    const prev = s.pedido?.datos;
    const items = s.carritoNuevo;
    if (!prev || !items?.length) {
      await whatsappService.sendMessage(to, 'No encontré tu pedido anterior 🤔. Envía el carrito de nuevo y lo tomamos como un pedido nuevo.');
      return;
    }
    const { pedidoStr, monto } = this.resumenCarrito(items);
    const datos = { ...prev, recomendacion: [prev.recomendacion, 'ADICIONAL al pedido anterior'].filter(Boolean).join(' · ') };
    this.completeHiring(`➕ ADICIONAL\n${pedidoStr}`, datos, to);   // Google Sheets
    this.completeOrder(items, datos, { adicional: true });          // Loggro (sin domicilio)
    const response = await this.cobrarPedido(to, { monto, datos: prev, domicilioIncluido: true }, `➕ *Adicional:*\n${pedidoStr}`, { adicional: true });
    if (response) await whatsappService.sendMessage(to, response);
    s.pedido.ultimoAt = Date.now();
    s.carritoNuevo = null;
  }

  /** El cliente llenó el Flow (pantalla SUMMARY): el pedido quedó enviado. Lo llama flow.js. */
  pedidoEnviado(numero, data) {
    const s = sesion(numero);
    s.pedido = { ...(s.pedido ?? {}), estado: 'enviado', enviadoAt: Date.now(), ultimoAt: Date.now(), datos: { ...data } };
    s.modoCarrito = null;
    clearTimeout(temporizadores.get(numero));
    temporizadores.delete(numero);
  }

  async cancelarPedido(to) {
    const s = sesion(to);
    s.pedido = null;
    s.productos = [];
    s.pedidoStr = '';
    s.modoCarrito = null;
    s.carritoNuevo = null;
    clearTimeout(temporizadores.get(to));
    temporizadores.delete(to);
    await whatsappService.sendMessage(to, 'Listo, cancelé tu pedido 👍. Cuando quieras, escribe *pedir* y te muestro la carta.');
  }

  /**
   * Recordatorio del pedido sin terminar: automático (cada RECORDATORIO_PEDIDO_MIN,
   * máx. RECORDATORIO_PEDIDO_MAX veces) o justo después de responderle una pregunta.
   */
  async recordarPedido(to, { automatico = false } = {}) {
    const s = obtenerSesion(to);
    if (!s || !this.pedidoPendiente(to)) return false;
    const p = s.pedido;
    if (!automatico && p.ultimoRecordatorioAt && Date.now() - p.ultimoRecordatorioAt < 60 * 1000) return false; // no repetir en ráfaga
    p.ultimoRecordatorioAt = Date.now();
    if (automatico) p.recordatorios = (p.recordatorios ?? 0) + 1;
    const ultimo = automatico && p.recordatorios >= config.RECORDATORIO_PEDIDO_MAX;
    const cierre = ultimo ? '\n\nSi ya no lo quieres, escribe *cancelar*.' : '';
    if (p.estado === 'confirmar') {
      const texto = `${automatico ? '⏰ ' : ''}Tu pedido sigue esperando 🛒\n\n${s.pedidoStr}\n\n*Subtotal:* ${cop(s.datosPedido?.monto)}\n\n¿Lo confirmamos?${cierre}`;
      await whatsappService.sendInteractiveButtons(to, texto.slice(0, 1024), BOTONES_CONFIRMAR);
    } else {
      await this.menuPedido(to, {
        header: automatico ? '⏰ ¿Seguimos con tu pedido?' : '¿Seguimos con tu pedido? 😊',
        body: `Solo falta que llenes tus datos de entrega y pago. Toca *Pedido* 👇${cierre}`,
      });
    }
    if (automatico) this.programarRecordatorio(to);
    return true;
  }

  /** Programa el próximo recordatorio (o lo cancela si ya no hace falta). */
  programarRecordatorio(to) {
    clearTimeout(temporizadores.get(to));
    temporizadores.delete(to);
    const s = obtenerSesion(to);
    if (!this.pedidoPendiente(to) || (s.pedido.recordatorios ?? 0) >= config.RECORDATORIO_PEDIDO_MAX) return;
    const t = setTimeout(() => {
      temporizadores.delete(to);
      this.recordarPedido(to, { automatico: true }).catch((error) => {
        console.error('[pedido] no se pudo enviar el recordatorio:', error.message);
        reportarFalla(error, { to, step: 'recordatorio del pedido pendiente' });
      });
    }, config.RECORDATORIO_PEDIDO_MIN * 60 * 1000);
    t.unref?.();
    temporizadores.set(to, t);
  }

  /** El cliente escribió: el recordatorio se cuenta desde ahora (no se le interrumpe mientras habla). */
  tocarSeguimiento(to) {
    if (temporizadores.has(to)) this.programarRecordatorio(to);
  }
}

export default new MessageHandler();
