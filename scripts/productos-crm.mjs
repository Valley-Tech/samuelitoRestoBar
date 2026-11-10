/**
 * Genera docs/productos-crm-samuelito.csv: la lista de platos para la búsqueda
 * con IA del CRM (Chatbots → SamuelitoBot → IA y conocimiento → Catálogo de
 * productos → Subir CSV). Vuelve a ejecutarlo cuando cambies src/data/catalogo.js
 * o docs/catalogo-meta-samuelito.csv (de ahí salen los precios):
 *
 *   npm run productos-crm
 */
import { writeFileSync } from 'node:fs';
import { csvParaCrm } from '../src/services/busquedaPlatos.js';

const salida = new URL('../docs/productos-crm-samuelito.csv', import.meta.url);
const csv = csvParaCrm();
writeFileSync(salida, '﻿' + csv + '\n');
console.log(`✔ ${csv.split('\n').length - 1} productos → docs/productos-crm-samuelito.csv`);
process.exit(0);
