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

  // 📸 Handle image
  if (numMedia > 0) {
    for (let i = 0; i < numMedia; i++) {
      const mediaUrl = messageData[`MediaUrl${i}`];
      const contentType = messageData[`MediaContentType${i}`];
      if (contentType.startsWith('image/')) {
        await handleImageMessage(userId, mediaUrl, contentType);
      }
    }
    return;
  }

  // ✅ Handle reply to a barcode prompt
  const pendingBarcode = await getPendingBarcode(userId);
  if (pendingBarcode) {
    await addItemToShoppingList(rawBody);
    await saveCustomProduct(pendingBarcode, rawBody); // optional, saves for future use
    await clearPendingBarcode(userId);
    await sendWhatsAppMessage(userId, `✅ "${rawBody}" added to your shopping list (from barcode ${pendingBarcode}).`);
    return;
  }


  if (body.startsWith('lösche ')) {
    const itemToDelete = messageData.Body.slice(7).trim(); // keep original case
    if (!itemToDelete) {
      await sendWhatsAppMessage(userId, '❓ Welches Produkt möchtest du löschen? Beispiel: *lösche Milch*');
      return;
    }

    await removeItemFromShoppingList(itemToDelete);
    await sendWhatsAppMessage(userId, `🗑️ "${itemToDelete}" wurde von der Einkaufsliste entfernt.`);
    return;
  }


  // ✅ Handle command
  if (body === 'einkaufsliste') {
    await handleShoppingListRequest(userId);
    return;
  }

  if (body === 'liste leeren') {
    await clearShoppingList();
    await sendWhatsAppMessage(userId, '🧹 Die Einkaufsliste wurde geleert.');
    return;
  }
  

  // ❓ Fallback
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
    
    // Check if this is the user's first request or if the list has been updated
    const isFirstRequest = !lastChecked;
    const isUpdated = !isFirstRequest && 
                      shoppingList.last_updated && 
                      lastChecked && 
                      shoppingList.last_updated.toDate() > lastChecked.toDate();
    
    if (isFirstRequest || isUpdated) {
      // Format the shopping list for WhatsApp
      const items = shoppingList.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
      const message = items.length > 0 
        ? `*Einkaufsliste:*\n${items}`
        : 'Die Einkaufsliste ist leer.';
      
      await sendWhatsAppMessage(userId, message);
    } else {
      await sendWhatsAppMessage(userId, 'Keine Änderungen seit deinem letzten Check');
    }
    
    // Update the user's last checked timestamp
    await updateUserLastChecked(userId);
  } catch (error) {
    console.error('Error handling shopping list request:', error);
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
    
    // Download and process the image
    await downloadAndProcessImage(mediaUrl, userId);
    
    
    // Note: We don't send a reply to save on message costs
    console.log(`Image processed successfully (no reply sent)`);
  } catch (error) {
    console.error('Error handling image message:', error);
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
    console.error('Error sending WhatsApp message:', error);
    throw error;
  }
}
