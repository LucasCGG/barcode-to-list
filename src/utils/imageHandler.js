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

/**
 * Download and process an image from a Twilio media URL
 * @param {string} mediaUrl - Twilio-hosted image URL
 */
export async function downloadAndProcessImage(mediaUrl, from) {
  let tempPath = null;

  try {
    const response = await axios.get(mediaUrl, {
      responseType: 'stream',
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
    });

    const filename = `barcode_${Date.now()}.jpg`;
    tempPath = path.join(tempDir, filename);
    const writer = fs.createWriteStream(tempPath);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    const stats = fs.statSync(tempPath);
    console.log(`📸 Downloaded image size: ${stats.size} bytes`);

    // Decode barcode
    const barcode = await decodeBarcodeFromImage(tempPath);

    if (!barcode) {
      console.log('🚫 No barcode found in image');
      await setPendingBarcode(from, barcode);
      await sendWhatsAppMessage(from, `❓ I couldn’t detect a barcode. Want to add this product manually? Just reply with the name!`);
      return;
    }

    console.log(`📦 Barcode detected: ${barcode}`);

    // ✅ Check custom database first
    const customName = await getCustomProduct(barcode);
    if (customName) {
      await addItemToShoppingList(customName);
      await sendWhatsAppMessage(from, `✅ Recognized barcode *${barcode}* as "${customName}" and added it to your list.`);
      return;
    }

    // 🌐 Check UPC database if not locally known
    const product = await fetchProductInfo(barcode);
    if (product && product.title) {
      console.log(`✅ Product found via UPC: ${product.title}`);
      await addItemToShoppingList(product.title);
      await sendWhatsAppMessage(from, `✅ Added "${product.title}" to your shopping list.`);
    } else {
      // 🕵️‍♀️ Ask user to help if nothing was found
      console.log('🔍 Product not found in UPC database');
      await setPendingBarcode(from, barcode);
      await sendWhatsAppMessage(from, `🤔 I found a barcode (${barcode}) but couldn’t find product info. Know what it is? Reply with the name and I’ll add it!`);
    }

  } catch (error) {
    console.error('❌ Image processing error:', error.message);
    await sendWhatsAppMessage(from, `⚠️ Something went wrong processing your image. Please try again!`);
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
    const response = await axios.get(UPC_ITEMDB_URL, {
      params: { upc },
    });

    const items = response.data.items;
    return items && items.length > 0 ? items[0] : null;

  } catch (err) {
    console.error('⚠️ Failed to fetch product info:', err.message);
    return null;
  }
}
