import axios from "axios";

const LOGGRO_API_URL = "https://api.pirpos.com/orders"; // Ajusta según la docu
const LOGGRO_API_KEY = process.env.LOGGRO_API_KEY; // Guarda tu API KEY en .env

export async function enviarPedidoALoggro(pedido) {
  try {
    const response = await axios.post(
      LOGGRO_API_URL,
      pedido,
      {
        headers: {
          "Authorization": `Bearer ${LOGGRO_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error enviando pedido a Loggro:", error.response?.data || error.message);
    throw new Error("No se pudo enviar el pedido a Loggro.");
  }
}