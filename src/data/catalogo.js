/**
 * Productos de Samuelito RestoBar (v3.5).
 *
 * Los IDs son los "ID de contenido" (retailer_id) del catálogo de Meta 899362489478649
 * y los _id de Loggro. Antes la lista estaba dentro de webhookController.js (ID → nombre);
 * ahora vive aquí y la usan el pedido, la búsqueda de platos y el carrusel.
 *
 * product_names: NOMBRE → ID. nombrePorId: ID → NOMBRE (se arma sola).
 * CATALOGOS: las mismas secciones de las cartas (menuCarta, menuCarta2, menuCarta3);
 * la búsqueda usa la sección para agrupar familias ("perros" → los 3 perros).
 * Para agregar un plato: ponlo en product_names y en su sección.
 */

export const product_names = {
  "Chips de Plátano con Suero": "5de86e87205aba0e1c990910",
  "Patacones de la Casa": "654ffcee0779b105ec6ac3bd",
  "Don Chicharrón": "5dbcae51c557e50e67febfcc",
  "Canastas del Mar": "5dbcad3fc557e50e67febfac",
  "Cóctel de Camarones": "5dbcae00c557e50e67febfc0",
  "Chorizo Artesanal Santarrosano": "5dbcb083c557e50e67febfdb",
  "Chorizo Artesanal Mexicano": "6888523e6fb8ea242c06a0bb",
  "Baby en Salsa de Champiñones": "67981c57bd2f74e33cfce707",
  "Lomo imperial con Fettuccine a los 4 Quesos": "66ef02fa4ff68adb785f09f8",
  "Lomito Mar y Tierra": "619e8bd01880235f6d5b27e5",
  "Baby Beef": "5dbcb308c557e50e67febff9",
  "Churrasco de Res": "5dbcb38cc557e50e67febffc",
  "Churrasco de Cerdo": "5dc733ad7c14810dfd3fec3f",
  "Churrasco de Cerdo en Salsa con Tocineta": "68203e8d7f735e5e48b7ec3b",
  "Steak Pimienta": "5e5ae290338d200e065c3577",
  "Cazuela de Mariscos": "5dcf187deea63f0df843be1e",
  "Costillas BBQ Premium": "5dbcb3d9c557e50e67fec005",
  "Churrasco de Cerdo Gratinado": "6311736932c31c05fbf10f89",
  "Pechuga al Grill": "5dbcb5a6c557e50e67fec022",
  "Pechuga Gratinada": "5de84c6e205aba0e1c9907d0",
  "Pechuga en Salsa con Tocineta": "68203ef70ae0923d28d06765",
  "Parrillada Mixta": "5dbcb57ec557e50e67fec01f",
  "New York Steak": "654ff6380779b105ec6ac20a",
  "Rib Eye Steak": "654ff7ba33294a05ef9f32f7",
  "Picada de la Casa (Para 2)": "61a10ddf1fd14430485f8cb9",
  "Picada de la Casa (Para 4)": "61a2657c1fd14430485f9f0e",
  "Mini Burger x3": "6550028ec2087c73f3b7775e",
  "Chicken Fingers": "61a118171fd14430485f8d78",
  "Salmón Pepper Pink": "619d6d801880235f6d5b1c36",
  "Pastas al Ajillo": "632df4983bcfe31bedde0e45",
  "Pastas Alfred": "5dd9dc26b928d20df3b63e49",
  "Camarones al Ajillo": "5e34ebb51ffca60e28d763ef",
  "Arroz Samuelito": "61a110b91880235f6d5b45a3",
  "Arroz de Camarones": "5f9b5233ef1e265d296b0f8d",
  "Club Sándwich": "6796793106b0703ef18a9f72",
  "Ensalada con Atún": "61a119621880235f6d5b4644",
  "Ensalada con Pollo": "61a119421fd14430485f8d96",
  "Sushi Samuelito Rolls": "618b0decad2f690565ff0342",
  "Clasic Burger": "5f9b5636ef1e265d296b0fd3",
  "Hamburguesa Felipa": "5dbcb612c557e50e67fec02b",
  "Samuelito Burger": "5dbcb645c557e50e67fec02e",
  "Perro Hawaiano": "67981bf757fc699d06fbe11c",
  "Perro Clásico": "5ef55e5619721c49eb8bb24a",
  "Perro Suizo": "5dbcb6a5c557e50e67fec03e",
  "Salchipupera": "5dbcb67cc557e50e67fec031",
  "Salchipapa Tradicional": "5dc7332e7c14810dfd3fec34",
  "Desgranado de la Casa": "5f9b3922ef1e265d296b0d95",
  "Desgranado Pupero": "5dc7337b7c14810dfd3fec38",
  "Caja Barrilera": "6133f09d5af774183ce25e0f",
  "Chicharrón al Barril": "6133e891d145504ca38cbeeb",
  "Costillas BBQ al barril": "6133f070d145504ca38cbf3a",
  "Frutos Amarillos": "5dc099e151aceb0dd757c620",
  "Frutos Rojos": "5dbe24b354eef30e209928e8",
  "Maracumango": "6a330907fcb370a10498d9ac",
  "Limonada cerezada": "5dc0a48751aceb0dd757c6fa",
  "Hierba Buena": "5dc0a48751aceb0dd757c6fb",
  "Limonada de coco": "5dc0a48751aceb0dd757c6fc",
  "Limonada Natural": "5dc0a60f51aceb0dd757c70f",
  "Brownie con Helado": "5dc4ce4651aceb0dd757e786",
  "Malteada de Oreo": "639c9b7d3c1b5a05f0d8fb97",
  "Panacota de Frutos Rojos": "5f9b455cef1e265d296b0eab",
  "Malteada de Nutela": "639c9ba452617c1b981ee446",
  "Malteada de Milo": "65500860c2087c73f3b778a3",
  "Malteada de Café": "6133e235d145504ca38cbd7e",
};

export const nombrePorId = Object.fromEntries(Object.entries(product_names).map(([nombre, id]) => [id, nombre]));

// Precios: se toman del CSV del catálogo de Meta (docs/catalogo-meta-samuelito.csv, columna price) si existe.
// Aquí puedes fijar uno a mano: "Perro Clásico": 15000.
export const precios = {};

// soloDomingo: la sección solo se ofrece los domingos (BARRIL_SOLO_DOMINGO=false lo desactiva).
export const CATALOGOS = {
  picar_fuertes: {
    header: "Para Picar 🍤 y Platos Fuertes 🍝🍲",
    marca: "Samuelito RestoBar",
    sections: [
      { title: "ASADOS AL BARRIL", soloDomingo: true, productos: [
        "Caja Barrilera",
        "Chicharrón al Barril",
        "Costillas BBQ al barril",
      ] },
      { title: "PARA PICAR", productos: [
        "Chips de Plátano con Suero",
        "Patacones de la Casa",
        "Don Chicharrón",
        "Canastas del Mar",
        "Cóctel de Camarones",
        "Chorizo Artesanal Santarrosano",
        "Chorizo Artesanal Mexicano",
      ] },
      { title: "PLATOS FUERTES", productos: [
        "Baby en Salsa de Champiñones",
        "Lomo imperial con Fettuccine a los 4 Quesos",
        "Lomito Mar y Tierra",
        "Baby Beef",
        "Churrasco de Res",
        "Churrasco de Cerdo",
        "Churrasco de Cerdo Gratinado",
        "Churrasco de Cerdo en Salsa con Tocineta",
        "Steak Pimienta",
        "Costillas BBQ Premium",
        "Pechuga al Grill",
        "Pechuga Gratinada",
        "Pechuga en Salsa con Tocineta",
        "Parrillada Mixta",
        "New York Steak",
        "Rib Eye Steak",
        "Picada de la Casa (Para 2)",
        "Picada de la Casa (Para 4)",
      ] },
      { title: "MENÚ INFANTIL", productos: [
        "Mini Burger x3",
        "Chicken Fingers",
      ] },
    ],
  },
  rapidas_mariscos: {
    header: "Pastas, Arroces, Comidas Rápidas 🍔 y Mariscos 🍤",
    marca: "Samuelito RestoBar",
    sections: [
      { title: "PASTAS", productos: [
        "Pastas al Ajillo",
        "Pastas Alfred",
      ] },
      { title: "PESCADOS Y MARISCOS", productos: [
        "Salmón Pepper Pink",
        "Cazuela de Mariscos",
        "Camarones al Ajillo",
      ] },
      { title: "ARROCES", productos: [
        "Arroz Samuelito",
        "Arroz de Camarones",
      ] },
      { title: "SÁNDWICHES", productos: [
        "Club Sándwich",
      ] },
      { title: "ENSALADAS", productos: [
        "Ensalada con Atún",
        "Ensalada con Pollo",
      ] },
      { title: "SUSHI", productos: [
        "Sushi Samuelito Rolls",
      ] },
      { title: "COMIDAS RÁPIDAS", productos: [
        "Clasic Burger",
        "Hamburguesa Felipa",
        "Samuelito Burger",
        "Perro Hawaiano",
        "Perro Clásico",
        "Perro Suizo",
        "Salchipupera",
        "Salchipapa Tradicional",
        "Desgranado de la Casa",
        "Desgranado Pupero",
      ] },
    ],
  },
  bebidas_postres: {
    header: "Jugos 🍹cócteles 🍸 y bebidas 🍺",
    marca: "Samuelito RestoBar",
    sections: [
      { title: "BEBIDAS y JUGOS", productos: [
        "Frutos Amarillos",
        "Frutos Rojos",
        "Maracumango",
        "Limonada cerezada",
        "Hierba Buena",
        "Limonada de coco",
        "Limonada Natural",
      ] },
      { title: "POSTRES y MALTEADAS", productos: [
        "Brownie con Helado",
        "Malteada de Oreo",
        "Panacota de Frutos Rojos",
        "Malteada de Nutela",
        "Malteada de Milo",
        "Malteada de Café",
      ] },
    ],
  },
};

// Palabras que nombran un tipo de plato aunque no sean la primera del nombre
// ("Clasic Burger", "Steak Pimienta"): con ellas el bot entiende que el cliente pide un plato.
export const PALABRAS_PLATO = ['burger', 'steak', 'barril', 'sandwich', 'rolls'];

// Samuelito no usa grupos de variantes en Meta (cada producto es una tarjeta).
export const grupoPorId = {};
export const tituloGrupo = {};
