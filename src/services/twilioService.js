// Twilio service for handling WhatsApp messages
import twilio from 'twilio';
import { 
  getShoppingList, 
  getUserLastChecked, 
  updateUserLastChecked,
  getPendingBarcode,
  addItemToShoppingList,
  saveCustomProduct,
  clearPendingBarcode,
  removeItemFromShoppingList,
  clearShoppingList
} from './firestoreService.js';
import { downloadAndProcessImage } from '../utils/imageHandler.js';

// Initialize Twilio client with specific credentials
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/**
 * Handle incoming WhatsApp messages
 * @param {Object} messageData - The incoming message data from Twilio
 * @returns {Promise<void>}
 */
export async function handleIncomingMessage(messageData) {
  const from = messageData.From;
  const rawBody = messageData.Body?.trim();
  const body = rawBody?.toLowerCase();
  const numMedia = parseInt(messageData.NumMedia || '0', 10);
  const userId = from.replace('whatsapp:', '');

  console.log(`Received message from ${userId}: ${rawBody}`);
  console.log(`Media count: ${numMedia}`);

  if (numMedia > 0) {
    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = messageData['MediaUrl' + i];
      const contentType = messageData['MediaContentType' + i];
      if (contentType.startsWith('image/')) {
        await handleImageMessage(userId, mediaUrl, contentType);
      }
    }
    return;
  }

  const pendingBarcode = await getPendingBarcode(userId);
  if (pendingBarcode) {
    await addItemToShoppingList(rawBody);
    await saveCustomProduct(pendingBarcode, rawBody);
    await clearPendingBarcode(userId);
    await sendWhatsAppMessage(
      userId,
      `✅ "${rawBody}" added to your shopping list (from barcode ${pendingBarcode}).`
    );
    return;
  }

  const commands = {
    einkaufsliste: async () => {
      await handleShoppingListRequest(userId);
    },
    'liste leeren': async () => {
      await clearShoppingList();
      await sendWhatsAppMessage(userId, '🧹 Die Einkaufsliste wurde geleert.');
    }
  };

  if (body.startsWith('lösche ')) {
    const itemToDelete = rawBody.slice(7).trim();
    if (!itemToDelete) {
      await sendWhatsAppMessage(
        userId,
        '❓ Welches Produkt möchtest du löschen? Beispiel: *lösche Milch*'
      );
      return;
    }
    await removeItemFromShoppingList(itemToDelete);
    await sendWhatsAppMessage(userId, `🗑️ "${itemToDelete}" wurde von der Einkaufsliste entfernt.`);
    return;
  }

  if (commands[body]) {
    await commands[body]();
    return;
  }

  await sendWhatsAppMessage(
    userId,
    'Unbekannter Befehl. Schreibe *einkaufsliste*, um die aktuelle Liste zu sehen.'
  );
}

/**
 * Handle a request for the shopping list
 * @param {string} userId - The WhatsApp user ID
 * @returns {Promise<void>}
 */
async function handleShoppingListRequest(userId) {
  try {
    const shoppingList = await getShoppingList();
    const lastChecked = await getUserLastChecked(userId);
    
    console.log(`Processing shopping list request for user: ${userId}`);
    

    const isFirstRequest = !lastChecked;
    const isUpdated = !isFirstRequest && 
                      shoppingList.last_updated && 
                      lastChecked && 
                      shoppingList.last_updated.toDate() > lastChecked.toDate();
    
    if (isFirstRequest || isUpdated) {
      const items = shoppingList.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
      const message = items.length > 0 
        ? `*Einkaufsliste:*\n${items}`
        : 'Die Einkaufsliste ist leer.';
      
      await sendWhatsAppMessage(userId, message);
    } else {
      await sendWhatsAppMessage(userId, 'Keine Änderungen seit deinem letzten Check');
    }
    
    await updateUserLastChecked(userId);
  } catch (error) {
    console.error('Error handling shopping list request:', {
      errorMessage: error.message,
      userId
    });
    throw error;
  }
}

/**
 * Handle an incoming image message
 * @param {string} userId - The WhatsApp user ID
 * @param {string} mediaUrl - The URL of the media
 * @param {string} contentType - The content type of the media
 * @returns {Promise<void>}
 */
async function handleImageMessage(userId, mediaUrl, contentType) {
  try {
    console.log(`Processing image from user: ${userId}`);
    
    await downloadAndProcessImage(mediaUrl, userId);
    
    
    console.log(`Image processed successfully (no reply sent)`);
  } catch (error) {
    console.error('Error handling image message:', { errorMessage: error.message, mediaUrl });
    throw error;
  }
}

/**
 * Send a WhatsApp message using Twilio
 * @param {string} to - The WhatsApp number to send to (without "whatsapp:" prefix)
 * @param {string} body - The message body
 * @returns {Promise<void>}
 */
export async function sendWhatsAppMessage(to, body) {
  if (!to || typeof to !== 'string') {
    console.error('❌ Invalid "to" phone number:', to);
    return;
  }
  

  try {
    await twilioClient.messages.create({
      body,
      from: 'whatsapp:' + process.env.TWILIO_PHONE_NUMBER,
      to: 'whatsapp:' + to
    });
    console.log(`✅ Message sent to ${to}`);
  } catch (error) {
    console.error('Error sending WhatsApp message:', { errorMessage: error.message, to });
    throw error;
  }
}
