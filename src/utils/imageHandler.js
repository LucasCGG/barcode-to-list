// Utility for handling image downloads and processing
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCustomProduct, setPendingBarcode, addItemToShoppingList } from '../services/firestoreService.js';
import { decodeBarcodeFromImage } from './barcodeReader.js';
import { sendWhatsAppMessage } from '../services/twilioService.js';


// Get the directory name for ES modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tempDir = path.join(__dirname, '..', '..', 'temp');

// Create temp directory if it doesn't exist
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
  console.log(`📁 Created temporary directory: ${tempDir}`);
}

const UPC_ITEMDB_URL = 'https://api.upcitemdb.com/prod/trial/lookup';
const OPEN_FOOD_FACTS_URL = 'https://world.openfoodfacts.org/api/v2/product';

/**
 * Download and process an image from a Twilio media URL
 * @param {string} mediaUrl - Twilio-hosted image URL
 */
export async function downloadAndProcessImage(mediaUrl, from, familyId) {
  let tempPath = null;

  try {
    const response = await axios.get(mediaUrl, {
      responseType: 'stream',
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN
      }
    });

    const filename = `barcode_${Date.now()}.jpg`;
    tempPath = path.join(tempDir, filename);
    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const stats = await fs.promises.stat(tempPath);
    console.log(`📸 Downloaded image size: ${stats.size} bytes`);

    // Decode barcode
    const barcode = await decodeBarcodeFromImage(tempPath);
    if (!barcode) {
      console.log('🚫 No barcode found in image');
      await setPendingBarcode(familyId, from, barcode);
      await sendWhatsAppMessage(
        from,
        '❓ Der Barcode konnte nicht erkannt werden. Versuche es erneut!'
      );
      return;
    }

    console.log(`📦 Barcode detected: ${barcode}`);

    const customName = await getCustomProduct(familyId, barcode);
    if (customName) {
      await addItemToShoppingList(familyId, customName);
      await sendWhatsAppMessage(
        from,
        `✅ Der Barcode *${barcode}* wurde als "${customName}" erkannt und der Einkaufsliste hinzugefügt.`
      );
      return;
    }

    const product = await fetchProductInfo(barcode);
    if (product && product.title) {
      console.log(`✅ Product found via API: ${product.title}`);
      const brandInfo = product.brand ? ` (${product.brand})` : '';
      await addItemToShoppingList(familyId, product.title);
      await sendWhatsAppMessage(
        from,
        `✅ "${product.title}${brandInfo}" wurde der Einkaufsliste hinzugefügt.`
      );
    } else {
      console.log('🔍 Produkt nicht in UPC-Datenbank gefunden');
      await setPendingBarcode(familyId, from, barcode);
      await sendWhatsAppMessage(
        from,
        `🤔 Ich habe einen Barcode (${barcode}) erkannt, konnte aber keine Produktinformationen finden. Weißt du was es ist? Antworte mit dem Namen und ich füge es der Einkaufsliste hinzu!`
      );
    }
  } catch (error) {
    console.error('❌ Image processing error:', {
      errorMessage: error.message,
      mediaUrl
    });
    await sendWhatsAppMessage(
      from,
      '⚠️ Beim Verarbeiten deiner Bilddatei ist etwas schief gelaufen. Bitte versuche es erneut!'
    );
  } finally {
    if (tempPath) {
      fs.unlink(tempPath, () => {});
    }
  }
}


/**
 * Fetch product info from UPCItemDB
 * @param {string} upc - Barcode to look up
 * @returns {Promise<Object|null>}
 */
async function fetchProductInfo(upc) {
  try {
    // Try UPCItemDB first
    const upcResponse = await axios.get(UPC_ITEMDB_URL, { params: { upc } });
    if (upcResponse.data.items?.length > 0) {
      console.log(`Found product in UPCItemDB: ${upcResponse.data.items[0].title}`);
      return upcResponse.data.items[0];
    }

    // Fallback to Open Food Facts
    const offResponse = await axios.get(`${OPEN_FOOD_FACTS_URL}/${upc}.json`);
    if (offResponse.data.status === 1 && offResponse.data.product.product_name) {
      console.log(`Found product in Open Food Facts: ${offResponse.data.product.product_name}`);
      return {
        title: offResponse.data.product.product_name,
        brand: offResponse.data.product.brands
      };
    }

    return null;
  } catch (err) {
    console.error('Product lookup error:', {
      upc,
      error: err.message
    });
    return null;
  }
}
