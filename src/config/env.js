import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config();

/**
 * Normaliza una clave PEM leída de una variable de entorno.
 *
 * Al pegar la clave en el .env o en Railway se suelen perder los saltos de
 * línea (quedan como "\n" literales) o se cuelan las comillas. OpenSSL 3
 * entonces responde `DECODER routines::unsupported`, que no dice nada útil.
 * Aquí se arregla antes de usarla, igual que ya se hace con la clave de Google.
 */
function normalizarPem(valor) {
  let pem = String(valor ?? '').trim();
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1);
  }
  pem = pem.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '');
  return pem ? `${pem.trim()}\n` : '';
}

const PRIVATE_KEY = normalizarPem(process.env.PRIVATE_KEY);

// Aviso al arrancar: mejor enterarse aquí que cuando Meta llame al endpoint.
if (PRIVATE_KEY) {
  try {
    crypto.createPrivateKey({ key: PRIVATE_KEY, passphrase: process.env.PASSPHRASE });
    console.log('[flows] clave privada cargada correctamente ✅');
  } catch (error) {
    const codigo = error.code || error.message;
    console.error(`[flows] ❌ no se pudo leer la clave privada: ${codigo}`);
    if (codigo === 'ERR_OSSL_BAD_DECRYPT') {
      console.error('        La PASSPHRASE no coincide con la que usaste al crear private.pem.');
    } else {
      console.error('        Revisa PRIVATE_KEY: debe empezar por "-----BEGIN" y conservar los saltos de línea.');
    }
  }
} else {
  console.warn('[flows] PRIVATE_KEY vacío: el endpoint /flow no podrá descifrar.');
}

export default {
  WEBHOOK_VERIFY_TOKEN: process.env.WEBHOOK_VERIFY_TOKEN,
  API_TOKEN: process.env.API_TOKEN,
  BUSINESS_PHONE: process.env.BUSINESS_PHONE,
  API_VERSION: process.env.API_VERSION,
  PORT: process.env.PORT || 3000,
  BASE_URL: process.env.BASE_URL,
  HUGGINGFACE_API_KEY: process.env.HUGGINGFACE_API_KEY,
  NEBIUS_API_KEY: process.env.NEBIUS_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  // PRIVATE_KEY: process.env.PRIVATE_KEY,
  PRIVATE_KEY,
  APP_SECRET: process.env.APP_SECRET,
  PASSPHRASE: process.env.PASSPHRASE,
  URL_BASE_WOMPI: process.env.URL_BASE_WOMPI,
  WOMPI_PUBLIC_KEY: process.env.WOMPI_PUBLIC_KEY,
  WOMPI_PRIVATE_KEY: process.env.WOMPI_PRIVATE_KEY,
  NODE_TLS_REJECT_UNAUTHORIZED : process.env.NODE_TLS_REJECT_UNAUTHORIZED,
  LOGGRO_API_KEY : process.env.LOGGRO_API_KEY,
  SPREADSHEETID_PEDIDO: process.env.SPREADSHEETID_PEDIDO,
  SPREADSHEETID_RESERVA: process.env.SPREADSHEETID_RESERVA,
  SPREADSHEETID_SURVEY: process.env.SPREADSHEETID_SURVEY,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  AWS_REGION: process.env.AWS_REGION,
  AWS_BUCKET_NAME: process.env.AWS_BUCKET_NAME,

  // ---- v3.5: búsqueda de platos, conversación y seguimiento del pedido ----
  // Los valores por defecto son los que ya estaban en el código: no hace falta agregar variables en Railway.
  CATALOG_ID: process.env.CATALOG_ID || '899362489478649',
  FLOW_ID_PEDIDO: process.env.FLOW_ID_PEDIDO || '1667286921657383',
  FLOW_ID_RESERVA: process.env.FLOW_ID_RESERVA || '1111929481300178',
  FLOW_ID_ENCUESTA: process.env.FLOW_ID_ENCUESTA || '1847588183274663',
  // Turno del chatbot (hora Colombia). La bienvenida sale una vez por cliente en cada turno.
  HORA_APERTURA: process.env.HORA_APERTURA || '12:00',
  HORA_CIERRE: process.env.HORA_CIERRE || '22:00',
  DOMICILIO_VALOR: Number(process.env.DOMICILIO_VALOR ?? 3000),
  NOTIFY_NUMBERS: (process.env.NOTIFY_NUMBERS || '573137517489,573006342114').split(',').map((n) => n.replace(/\D/g, '')).filter(Boolean),
  RECORDATORIO_PEDIDO_MIN: Number(process.env.RECORDATORIO_PEDIDO_MIN) || 5, // cada cuántos minutos se recuerda
  RECORDATORIO_PEDIDO_MAX: Number(process.env.RECORDATORIO_PEDIDO_MAX ?? 2),  // cuántas veces como máximo (0 = nunca)
  ADICIONAL_MINUTOS: Number(process.env.ADICIONAL_MINUTOS) || 60,           // ventana para sumar un adicional a un pedido enviado
  // Carrusel de productos (2 a 10 tarjetas). TARJETAS_CARRUSEL=false → se usa la lista de productos con carrito.
  TARJETAS_CARRUSEL: !/^(0|false|no)$/i.test(process.env.TARJETAS_CARRUSEL || 'true'),
  // Carrusel y tarjeta solo con productos que tienen foto válida en Meta (docs/catalogo-meta-samuelito.csv).
  SOLO_CON_FOTO: !/^(0|false|no)$/i.test(process.env.SOLO_CON_FOTO || 'true'),
  VERIFICAR_FOTOS: !/^(0|false|no)$/i.test(process.env.VERIFICAR_FOTOS || 'true'), // revisa en línea que la foto exista
  VARIANTES_META: false, // Samuelito no usa grupos de variantes en Meta: una tarjeta por producto
  // Asados al barril: solo los domingos (false = todos los días).
  BARRIL_SOLO_DOMINGO: !/^(0|false|no)$/i.test(process.env.BARRIL_SOLO_DOMINGO || 'true'),
  // Números a los que el bot NO responde (p. ej. el personal del restaurante que escribe a la línea).
  NO_RESPONDER_A: (process.env.NO_RESPONDER_A || '').split(',').map((n) => n.replace(/\D/g, '')).filter(Boolean),
};
