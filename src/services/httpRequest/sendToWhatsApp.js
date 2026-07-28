import axios from "axios";
import config from '../../config/env.js';
import { logAxiosError } from '../printDetailError.js';

// Descarga la imagen de WhatsApp usando el token de Meta
export const downloadImageFromMeta = async (imageUrl) => {
    const accessToken = config.API_TOKEN; // O el nombre de tu token de WhatsApp
    const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });
    return response.data; // Buffer de la imagen
};

const sendToWhatsApp = async (data) => {
    const baseUrl = `${config.BASE_URL}/${config.API_VERSION}/${config.BUSINESS_PHONE}/messages`;
    const headers = {
        Authorization: `Bearer ${config.API_TOKEN}`
    };

    try {
        const response = await axios({
            method: 'POST',
            url: baseUrl,
            headers: headers,
            data,
        })
        return response.data; 
    } catch (error) {
        logAxiosError('Error: ', error);
        throw error;
    }
};

export default sendToWhatsApp;