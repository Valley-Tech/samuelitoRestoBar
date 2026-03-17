export function printDetailedError(error) {
  // Axios error con response.data.error
  if (error.response && error.response.data) {
    const errData = error.response.data;
    // Si tiene un campo error (como en la respuesta de Facebook)
    if (errData.error) {
      console.error("Error:", errData.error.message || errData.error);
      if (errData.error.error_data) {
        console.error("Detalles:", errData.error.error_data.details);
      }
      // Imprime todo el objeto error para referencia
      console.error("Error completo:", JSON.stringify(errData, null, 2));
    } else {
      // Si no tiene campo error, imprime todo
      console.error("Error HTTP:", JSON.stringify(errData, null, 2));
    }
  } else if (error.data) {
    console.error("Error data:", JSON.stringify(error.data, null, 2));
  } else if (typeof error === 'object') {
    console.error("Error objeto:", JSON.stringify(error, null, 2));
  } else {
    console.error("Error:", error);
  }
}