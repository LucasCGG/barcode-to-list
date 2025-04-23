import twilio from 'twilio';
import { 
  getShoppingList, 
  getPendingBarcode,
  addItemToShoppingList,
  saveCustomProduct,
  clearPendingBarcode,
  removeItemFromShoppingList,
  clearShoppingList
} from './firestoreService.js';
import { downloadAndProcessImage } from '../utils/imageHandler.js';
import db  from '../config/firebase.js';
import { 
  addUserToFamily,
  getFamilyById,
  createFamily,
  listFamilyMembers,
  removeUserFromFamily,
  promoteUserToAdmin,
  deleteFamily,
  demoteUserFromAdmin
} from './familyService.js';
import admin from 'firebase-admin';

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
  const profileName = messageData.ProfileName;

  console.log(`Received message from ${userId}: ${rawBody}`);
  console.log(`Media count: ${numMedia}`);
  if (profileName) {
    console.log(`Profile name: ${profileName}`);
  }

  try {
    const ctx = await getFamilyContext(userId);
    
    if (ctx && profileName) {
      await updateMemberName(ctx.familyId, userId, profileName);
    }
    
    if (numMedia > 0) {
      if (!ctx) {
        await sendWhatsAppMessage(userId, '⚠️ Du bist keiner Familie zugeordnet. Bitte erstelle oder trete einer Familie bei.');
        return;
      }
      
      for (let i = 0; i < numMedia; i++) {
        const mediaUrl = messageData['MediaUrl' + i];
        const contentType = messageData['MediaContentType' + i];
        if (contentType.startsWith('image/')) {
          await handleImageMessage(userId, mediaUrl, contentType);
        }
      }
      return;
    }
    
    if (ctx) {
      const pendingBarcode = await getPendingBarcode(ctx.familyId, userId);
      if (pendingBarcode) {
        await handlePendingBarcodeResponse(ctx.familyId, userId, rawBody, pendingBarcode);
        return;
      }
    } else if (!isJoinCommand(body)) {
      await sendJoinHint(userId);
      return;
    }
    
    let result = null;
    
    // Command type 1: Commands with special prefixes
    if (body.startsWith('+')) {
      result = await handleAddItem(userId, rawBody, ctx);
    } else if (body.startsWith('löschen ') || body.startsWith('lösche ') || body.startsWith('-')) {
      result = await handleRemoveItem(userId, body, rawBody, ctx);
    } 
    // Command type 2: Commands that start with a keyword
    else if (body.startsWith('create ')) {
      result = await handleCreateFamily(userId, rawBody, ctx);
    } else if (body.startsWith('beitreten ')) {
      result = await handleJoinFamily(userId, rawBody);
    } else if (body.startsWith('einladen ')) {
      result = await handleInviteMember(userId, rawBody, ctx);
    } else if (body.startsWith('entfernen ')) {
      result = await handleRemoveMember(userId, rawBody, ctx);
    } else if (body.startsWith('promote ')) {
      result = await handlePromoteMember(userId, rawBody, ctx);
    } else if (body.startsWith('demote ')) {
      result = await handleDemoteMember(userId, rawBody, ctx);
    }
    // Command type 3: Exact match commands
    else if (body === 'einkaufsliste') {
      if (!ctx) return await sendJoinHint(userId);
      await handleShoppingListRequest(ctx.familyId, userId);
      return;
    } else if (body === 'liste leeren') {
      if (!ctx) return await sendJoinHint(userId);
      await clearShoppingList(ctx.familyId);
      result = { message: '🧹 Die Einkaufsliste wurde geleert.' };
    } else if (body === 'members') {
      result = await handleMembersCommand(userId, ctx);
    } else if (body === 'id') {
      if (!ctx) return await sendJoinHint(userId);
      result = { 
        message: `🔑 Deine Familien-ID: ${ctx.familyId}\n\nTeile diesen Code zum Beitreten: *beitreten ${ctx.familyId}*` 
      };
    } else if (body === 'verlassen') {
      result = await handleLeaveFamily(userId, ctx);
    }
    
    if (result) {
      await sendWhatsAppMessage(userId, result.message);
      return;
    }
    
    await sendHelpMessage(userId, ctx);
    
  } catch (error) {
    console.error('Error handling message:', error);
    await sendWhatsAppMessage(userId, '⚠️ Es ist ein Fehler aufgetreten. Bitte versuche es später erneut.');
  }
}

/**
 * Handle a request for the shopping list
 * @param {string} familyId - The family ID
 * @param {string} userId - The WhatsApp user ID
 * @returns {Promise<void>}
 */
async function handleShoppingListRequest(familyId, userId) {
  try {
    const shoppingList = await getShoppingList(familyId);
    console.log(`Processing shopping list request for user: ${userId}`);

    const items = shoppingList.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    const message = items.length > 0 
      ? `*Einkaufsliste:*\n${items}`
      : 'Die Einkaufsliste ist leer.';
    
    await sendWhatsAppMessage(userId, message);
  } catch (error) {
    console.error('Error handling shopping list request:', {
      errorMessage: error.message,
      familyId,
      userId
    });
    await sendWhatsAppMessage(userId, '⚠️ Es gab ein Problem beim Abrufen der Einkaufsliste');
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
    
    const ctx = await getFamilyContext(userId);
    if (!ctx) {
      await sendJoinHint(userId);
      return;
    }

    await downloadAndProcessImage(mediaUrl, userId, ctx.familyId);
    
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

async function getFamilyContext(userId) {
  const snap = await db.collection('families')
    .where('members', 'array-contains', userId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const isAdmin = doc.data().admins.includes(userId);
  return { familyId: doc.id, isAdmin, familyData: doc.data() };
}

async function sendJoinHint(userId) {
  return sendWhatsAppMessage(
    userId,
    '⚠️ Du bist keiner Familie zugeordnet. Erstelle mit *create NAME* eine oder trete mit *beitreten ID* bei.'
  );
}

async function handlePendingBarcodeResponse(familyId, userId, productName, barcode) {
  try {
    await saveCustomProduct(familyId, barcode, productName);
    await addItemToShoppingList(familyId, productName);
    await clearPendingBarcode(familyId, userId);
    await sendWhatsAppMessage(
      userId,
      `✅ "${productName}" wurde als Name für Barcode ${barcode} gespeichert und zur Liste hinzugefügt!`
    );
  } catch (error) {
    console.error('Error handling barcode response:', error);
    await sendWhatsAppMessage(userId, '⚠️ Fehler beim Speichern des Produktnamens');
  }
}

// Helper functions
function isJoinCommand(body) {
  return body.startsWith('create ') || body.startsWith('beitreten ');
}

async function handleAddItem(userId, rawBody, ctx) {
  if (!ctx) return { message: await sendJoinHint(userId) };
  
  const itemToAdd = rawBody.slice(1).trim();
  if (!itemToAdd) {
    return { message: '❓ Bitte gib einen Produktnamen nach dem + ein. Beispiel: *+ Milch*' };
  }
  
  await addItemToShoppingList(ctx.familyId, itemToAdd);
  return { message: `✅ "${itemToAdd}" wurde zur Einkaufsliste hinzugefügt.` };
}

async function handleRemoveItem(userId, body, rawBody, ctx) {
  if (!ctx) return { message: await sendJoinHint(userId) };
  
  const prefixLength = body.startsWith('löschen ') ? 8 : body.startsWith('lösche ') ? 7 : 1;
  const itemToDelete = rawBody.slice(prefixLength).trim();
  
  if (!itemToDelete) {
    return { 
      message: '❓ Welches Produkt möchtest du löschen? Beispiele:\n*• lösche Milch*\n*• löschen Käse*\n*• - Brot*' 
    };
  }
  
  const shoppingList = await getShoppingList(ctx.familyId);
  
  const exactItem = shoppingList.items.find(
    item => item.toLowerCase() === itemToDelete.toLowerCase()
  );
  
  if (exactItem) {
    await removeItemFromShoppingList(ctx.familyId, exactItem);
    return { message: `🗑️ "${exactItem}" wurde von der Einkaufsliste entfernt.` };
  } else {
    const partialMatch = shoppingList.items.find(
      item => item.toLowerCase().includes(itemToDelete.toLowerCase())
    );
    
    if (partialMatch) {
      await removeItemFromShoppingList(ctx.familyId, partialMatch);
      return { message: `🗑️ "${partialMatch}" wurde von der Einkaufsliste entfernt.` };
    }
    
    return { message: `❌ "${itemToDelete}" wurde nicht in der Einkaufsliste gefunden.` };
  }
}

async function handleCreateFamily(userId, rawBody, ctx) {
  if (ctx) {
    return { message: '⚠️ Du bist bereits in einer Familie!' };
  }
  
  const familyName = rawBody.split(' ').slice(1).join(' ').trim();
  if (!familyName) {
    return { message: '❌ Bitte gib einen Namen an: *create Familienname*' };
  }
  
  const newFamilyId = await createFamily({ name: familyName, creatorPhone: userId });
  return { 
    message: `✅ Familie "${familyName}" erstellt! ID: ${newFamilyId}\n\n` +
             `Teile diese ID zum Beitreten: *beitreten ${newFamilyId}*` 
  };
}

async function handleJoinFamily(userId, rawBody) {
  const joinId = rawBody.split(' ')[1];
  if (!joinId) {
    return { message: '❌ Bitte gib eine Familien-ID an: *beitreten FAMILIEN_ID*' };
  }
  
  const doc = await getFamilyById(joinId);
  if (!doc) {
    return { message: '❌ Familie nicht gefunden. Überprüfe die ID.' };
  }
  
  await addUserToFamily(joinId, userId);
  return { message: `✅ Du bist der Familie "${doc.name}" beigetreten!` };
}

async function handleInviteMember(userId, rawBody, ctx) {
  if (!ctx) return { message: await sendJoinHint(userId) };
  if (!ctx.isAdmin) {
    return { message: '⚠️ Nur Admins können Mitglieder einladen.' };
  }
  
  const parts = rawBody.split(' ');
  if (parts.length < 2) {
    return { message: '❌ Bitte gib eine Telefonnummer an: *einladen +41794657076 [Name]*' };
  }
  
  const phonePart = parts[1];
  if (!phonePart || !phonePart.match(/^\+?\d/)) {
    return { message: '❌ Ungültige Nummer. Format: *einladen +41794657076 [Name]*' };
  }
  
  const namePart = parts.length > 2 ? parts.slice(2).join(' ') : null;
  const cleanNumber = cleanPhoneNumber(phonePart);
  
  const familyDoc = await getFamilyById(ctx.familyId);
  if (!familyDoc) {
    return { message: '❌ Familie nicht gefunden.' };
  }
  
  await db.collection('families').doc(ctx.familyId).update({
    members: admin.firestore.FieldValue.arrayUnion(cleanNumber)
  });
  
  if (namePart) {
    const memberNamesUpdate = {};
    memberNamesUpdate[`memberNames.${cleanNumber}`] = namePart;
    
    await db.collection('families').doc(ctx.familyId).update(memberNamesUpdate);
  }
  
  const message = namePart 
    ? `✅ ${namePart} (${cleanNumber}) wurde erfolgreich eingeladen!`
    : `✅ ${cleanNumber} wurde erfolgreich eingeladen!`;
    
  return { message };
}

async function handleRemoveMember(userId, rawBody, ctx) {
  if (!ctx) return { message: await sendJoinHint(userId) };
  if (!ctx.isAdmin) {
    return { message: '⚠️ Nur Admins können Mitglieder entfernen.' };
  }
  
  const namePart = rawBody.split(' ').slice(1).join(' ').trim();
  if (!namePart) {
    return { message: '❌ Bitte gib einen Namen oder eine Nummer an: *entfernen Max* oder *entfernen +41794657076*' };
  }
  
  const userPhone = await findUserByNameOrPhone(ctx.familyId, namePart);
  if (!userPhone) {
    return { message: '❌ Kein Mitglied mit diesem Namen oder dieser Nummer gefunden.' };
  }
  
  if (userPhone === userId) {
    return { message: '❌ Um die Familie zu verlassen, nutze den Befehl *verlassen*' };
  }
  
  await removeUserFromFamily(ctx.familyId, userPhone);
  const userName = namePart.includes('+') ? userPhone : namePart;
  return { message: `✅ ${userName} wurde aus der Familie entfernt.` };
}

async function handlePromoteMember(userId, rawBody, ctx) {
  if (!ctx) return { message: await sendJoinHint(userId) };
  if (!ctx.isAdmin) {
    return { message: '⚠️ Nur Admins können Mitglieder befördern.' };
  }
  
  const namePart = rawBody.split(' ').slice(1).join(' ').trim();
  if (!namePart) {
    return { message: '❌ Bitte gib einen Namen oder eine Nummer an: *promote Max* oder *promote +41794657076*' };
  }
  
  const userPhone = await findUserByNameOrPhone(ctx.familyId, namePart);
  if (!userPhone) {
    return { message: '❌ Kein Mitglied mit diesem Namen oder dieser Nummer gefunden.' };
  }
  
  const familyDoc = await getFamilyById(ctx.familyId);
  if (!familyDoc || !familyDoc.members.includes(userPhone)) {
    return { message: '❌ Diese Person gehört nicht zu deiner Familie.' };
  }
  
  if (familyDoc.admins.includes(userPhone)) {
    const userName = familyDoc.memberNames?.[userPhone] || userPhone;
    return { message: `⚠️ ${userName} ist bereits Admin.` };
  }
  
  await promoteUserToAdmin(ctx.familyId, userPhone);
  const userName = familyDoc.memberNames?.[userPhone] || userPhone;
  return { message: `👑 ${userName} wurde zum Admin befördert.` };
}

async function handleDemoteMember(userId, rawBody, ctx) {
  if (!ctx) return { message: await sendJoinHint(userId) };
  if (!ctx.isAdmin) {
    return { message: '⚠️ Nur Admins können Admin-Rechte entziehen.' };
  }
  
  const namePart = rawBody.split(' ').slice(1).join(' ').trim();
  if (!namePart) {
    return { message: '❌ Bitte gib einen Namen oder eine Nummer an: *demote Max* oder *demote +41794657076*' };
  }
  
  const userPhone = await findUserByNameOrPhone(ctx.familyId, namePart);
  if (!userPhone) {
    return { message: '❌ Kein Mitglied mit diesem Namen oder dieser Nummer gefunden.' };
  }
  
  const familyDoc = await getFamilyById(ctx.familyId);
  if (!familyDoc || !familyDoc.members.includes(userPhone)) {
    return { message: '❌ Diese Person gehört nicht zu deiner Familie.' };
  }
  
  if (!familyDoc.admins.includes(userPhone)) {
    const userName = familyDoc.memberNames?.[userPhone] || userPhone;
    return { message: `⚠️ ${userName} ist kein Admin.` };
  }
  
  if (userPhone === userId) {
    return { message: '❌ Du kannst dich nicht selbst degradieren.' };
  }
  
  if (familyDoc.admins.length <= 1) {
    return { message: '❌ Es muss mindestens ein Admin in der Familie bleiben.' };
  }
  
  await demoteUserFromAdmin(ctx.familyId, userPhone);
  const userName = familyDoc.memberNames?.[userPhone] || userPhone;
  return { message: `👤 ${userName} ist nun kein Admin mehr.` };
}

async function handleMembersCommand(userId, ctx) {
  if (!ctx) return { message: await sendJoinHint(userId) };
  
  const memberList = await listFamilyMembers(ctx.familyId);
  return { 
    message: memberList.length
      ? `👥 Mitglieder deiner Familie:\n\n${memberList.join('\n')}`
      : '🚫 Deine Familie hat momentan keine Mitglieder.'
  };
}

async function handleLeaveFamily(userId, ctx) {
  if (!ctx) return { message: await sendJoinHint(userId) };
  
  const familyDoc = await getFamilyById(ctx.familyId);
  if (!familyDoc) {
    return { message: '❌ Familie nicht gefunden' };
  }
  
  const members = familyDoc.members || [];
  
  if (ctx.isAdmin) {
    if (members.length === 1) {
      await deleteFamily(ctx.familyId);
      return { message: '✅ Familie wurde gelöscht, da du das letzte Mitglied warst.' };
    } else {
      const otherMembers = members.filter(m => m !== userId);
      const newAdmin = otherMembers[0];
      await promoteUserToAdmin(ctx.familyId, newAdmin);
    }
  }
  
  await removeUserFromFamily(ctx.familyId, userId);
  return { message: '✅ Du hast die Familie erfolgreich verlassen.' };
}

function cleanPhoneNumber(phone) {
  return phone.replace(/^whatsapp:/i, '')
    .replace(/^00/, '+') 
    .replace(/^0/, '+41')
    .replace(/^(\d)/, '+$1');
}

async function sendHelpMessage(userId, ctx) {
  const baseCommands = [
    '*einkaufsliste* Aktuelle Liste',
    '*id* Zeige Familien-ID',
    '*members* Mitglieder anzeigen',
    '*beitreten ID* Familie beitreten',
    '*verlassen* Familie verlassen',
    '*liste leeren* Liste löschen',
    '*create Familienname* Familie erstellen',
    '*+* Produkt hinzufügen',
    '*-* Produkt löschen',
    '*lösche* Produkt löschen'
  ];

  const adminCommands = ctx?.isAdmin ? [
    '*einladen NUM* Mitglied einladen',
    '*entfernen NAME/NUM* Mitglied entfernen',
    '*promote NAME/NUM* Zum Admin befördern',
    '*demote NAME/NUM* Admin-Rechte entziehen'
  ] : [];

  const helpMessage = [
    'Unbekannter Befehl. Verfügbare Befehle:',
    ...baseCommands,
    ...adminCommands
  ].join('\n    ');

  await sendWhatsAppMessage(userId, helpMessage);
}

async function findUserByNameOrPhone(familyId, nameOrPhone) {
  console.log(`Searching for member: "${nameOrPhone}" in family ${familyId}`);
  
  if (nameOrPhone.includes('+') || /^\d{10,}$/.test(nameOrPhone)) {
    const cleanNumber = cleanPhoneNumber(nameOrPhone);
    console.log(`Identified as phone number: ${cleanNumber}`);
    return cleanNumber;
  }
  
  const familyDoc = await getFamilyById(familyId);
  if (!familyDoc) {
    console.log('Family not found');
    return null;
  }
  
  console.log('Family members:', familyDoc.members);
  console.log('Member names:', familyDoc.memberNames);
  
  if (!familyDoc.memberNames) {
    console.log('No memberNames found in family document, initializing it');
    
    await db.collection('families').doc(familyId).update({
      memberNames: {}
    });
    
    for (const phone of familyDoc.members || []) {
      if (phone.toLowerCase().includes(nameOrPhone.toLowerCase())) {
        console.log(`Found match in phone number: ${phone}`);
        return phone;
      }
    }
    
   
    return null;
  }
  
  const searchName = nameOrPhone.toLowerCase();
  console.log(`Searching for name: "${searchName}"`);
  
  for (const [phone, name] of Object.entries(familyDoc.memberNames)) {
    if (name && name.toLowerCase() === searchName) {
      console.log(`Found exact name match: ${name} (${phone})`);
      return phone;
    }
  }
  
  for (const [phone, name] of Object.entries(familyDoc.memberNames)) {
    if (name && name.toLowerCase().includes(searchName)) {
      console.log(`Found partial name match: ${name} (${phone})`);
      return phone;
    }
  }
  
  for (const phone of familyDoc.members || []) {
    if (phone.toLowerCase().includes(searchName)) {
      console.log(`Found match in phone number: ${phone}`);
      return phone;
    }
  }
  
  console.log('No match found');
  return null;
}

async function updateMemberName(familyId, userId, name) {
  try {
    const familyDoc = await getFamilyById(familyId);
    
    if (!familyDoc.memberNames || 
        !familyDoc.memberNames[userId] || 
        familyDoc.memberNames[userId] !== name) {
      
      console.log(`Updating name for ${userId} to "${name}"`);
      
      const update = {};
      if (!familyDoc.memberNames) {
        update.memberNames = { [userId]: name };
      } else {
        update[`memberNames.${userId}`] = name;
      }
      
      await db.collection('families').doc(familyId).update(update);
    }
  } catch (error) {
    console.error('Error updating member name:', error);
  }
}

