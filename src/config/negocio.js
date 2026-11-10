/**
 * Datos de Samuelito RestoBar que usa el chatbot (v3.5).
 * Son los mismos valores que estaban escritos dentro de messageHandler.js.
 */
import config from './env.js';

export default {
  nombre: 'Samuelito RestoBar',

  // Turno del chatbot (hora Colombia): 12:00 p. m. a 10:00 p. m. todos los días.
  horario: { apertura: config.HORA_APERTURA, cierre: config.HORA_CIERRE },
  horarioTexto: () => `*todos los días* de *${fmtHora(config.HORA_APERTURA)}* a *${fmtHora(config.HORA_CIERRE)}*`,

  // Valor del domicilio que se suma al pedido (solo si el cliente escribe una dirección en el Flow).
  domicilio: config.DOMICILIO_VALOR,

  // Números que reciben el aviso de pedido y reserva (variable NOTIFY_NUMBERS).
  numerosOficiales: config.NOTIFY_NUMBERS,
};

function fmtHora(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const ampm = h >= 12 ? 'p.m.' : 'a.m.';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}
