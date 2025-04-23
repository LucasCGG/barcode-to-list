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
import db from '../config/firebase.js';
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
import { getTranslator } from './localization.js';
import { getUserLanguage, setUserLanguage, isLanguageSupported, getSupportedLanguages } from './userLanguageService.js';
import admin from 'firebase-admin';
import { matchesCommand, extractCommandArgs } from '../utils/commandMatcher.js';

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
    // Get user's language preference
    const userLanguage = await getUserLanguage(userId);
    const t = await getTranslator(userLanguage);
    
    const ctx = await getFamilyContext(userId);
    
    if (ctx && profileName) {
      await updateMemberName(ctx.familyId, userId, profileName);
    }
    
    // Handle language change command
    if (matchesCommand(body, t, 'change_language')) {
      const langCode = extractCommandArgs(body, t, 'change_language').split(' ')[0]?.toLowerCase();
      if (langCode) {
        if (isLanguageSupported(langCode)) {
          await setUserLanguage(userId, langCode);
          await sendWhatsAppMessage(userId, t('language_changed', { language: langCode }));
        } else {
          await sendWhatsAppMessage(userId, t('language_not_supported', { 
            availableLanguages: getSupportedLanguages() 
          }));
        }
        return;
      }
    }
    
    if (numMedia > 0) {
      if (!ctx) {
        await sendWhatsAppMessage(userId, t('not_in_family'));
        return;
      }
      
      for (let i = 0; i < numMedia; i++) {
        const mediaUrl = messageData['MediaUrl' + i];
        const contentType = messageData['MediaContentType' + i];
        if (contentType.startsWith('image/')) {
          await handleImageMessage(userId, mediaUrl, contentType, t);
        }
      }
      return;
    }
    
    if (ctx) {
      const pendingBarcode = await getPendingBarcode(ctx.familyId, userId);
      if (pendingBarcode) {
        await handlePendingBarcodeResponse(ctx.familyId, userId, rawBody, pendingBarcode, t);
        return;
      }
    } else if (!isJoinCommand(body, t)) {
      await sendJoinHint(userId, t);
      return;
    }
    
    let result = null;
    
    // Command type 1: Commands with special prefixes
    if (body.startsWith('+')) {
      result = await handleAddItem(userId, rawBody, ctx, t);
    } else if (body.startsWith('löschen ') || body.startsWith('lösche ') || 
               body.startsWith('delete ') || body.startsWith('remove ') || 
               body.startsWith('-')) {
      result = await handleRemoveItem(userId, body, rawBody, ctx, t);
    } 
    // Command type 2: Commands that match translated keywords
    else if (matchesCommand(body, t, 'create_family')) {
      result = await handleCreateFamily(userId, rawBody, ctx, t);
    } else if (matchesCommand(body, t, 'join_family')) {
      result = await handleJoinFamily(userId, rawBody, t);
    } else if (matchesCommand(body, t, 'invite_member')) {
      result = await handleInviteMember(userId, rawBody, ctx, t);
    } else if (matchesCommand(body, t, 'remove_member')) {
      result = await handleRemoveMember(userId, rawBody, ctx, t);
    } else if (matchesCommand(body, t, 'promote_member')) {
      result = await handlePromoteMember(userId, rawBody, ctx, t);
    } else if (matchesCommand(body, t, 'demote_member')) {
      result = await handleDemoteMember(userId, rawBody, ctx, t);
    }
    // Command type 3: Exact match commands
    else if (matchesCommand(body, t, 'shopping_list')) {
      if (!ctx) return await sendJoinHint(userId, t);
      await handleShoppingListRequest(ctx.familyId, userId, t);
      return;
    } else if (matchesCommand(body, t, 'clear_list')) {
      if (!ctx) return await sendJoinHint(userId, t);
      await clearShoppingList(ctx.familyId);
      result = { message: t('list_cleared') };
    } else if (matchesCommand(body, t, 'show_members')) {
      result = await handleMembersCommand(userId, ctx, t);
    } else if (matchesCommand(body, t, 'show_id')) {
      if (!ctx) return await sendJoinHint(userId, t);
      result = { 
        message: t('family_id', { id: ctx.familyId }) 
      };
    } else if (matchesCommand(body, t, 'leave_family')) {
      result = await handleLeaveFamily(userId, ctx, t);
    }
    
    if (result) {
      await sendWhatsAppMessage(userId, result.message);
      return;
    }
    
    await sendHelpMessage(userId, ctx, t);
    
  } catch (error) {
    console.error('Error handling message:', error);
    const t = await getTranslator(await getUserLanguage(userId));
    await sendWhatsAppMessage(userId, t('error_occurred'));
  }
}

/**
 * Handle a request for the shopping list
 * @param {string} familyId - The family ID
 * @param {string} userId - The WhatsApp user ID
 * @returns {Promise<void>}
 */
async function handleShoppingListRequest(familyId, userId, t) {
  try {
    const shoppingList = await getShoppingList(familyId);
    console.log(`Processing shopping list request for user: ${userId}`);
    console.log('Translation function available:', !!t);
    
    // Log the translation key and result for debugging
    const titleTranslation = t('shopping_list_title');
    console.log(`Translation of 'shopping_list_title': '${titleTranslation}'`);

    const items = shoppingList.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    const message = items.length > 0 
      ? `${t('shopping_list_title')}\n${items}`
      : t('shopping_list_empty');
    
    console.log(`Final message: ${message.substring(0, 50)}...`);
    await sendWhatsAppMessage(userId, message);
  } catch (error) {
    console.error('Error handling shopping list request:', {
      errorMessage: error.message,
      familyId,
      userId
    });
    await sendWhatsAppMessage(userId, t('shopping_list_error'));
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
async function handleImageMessage(userId, mediaUrl, contentType, t) {
  try {
    console.log(`Processing image from user: ${userId}`);
    
    const ctx = await getFamilyContext(userId);
    if (!ctx) {
      await sendJoinHint(userId, t);
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

async function sendJoinHint(userId, t) {
  return sendWhatsAppMessage(
    userId,
    t('join_hint')
  );
}

async function handlePendingBarcodeResponse(familyId, userId, productName, barcode, t) {
  try {
    await saveCustomProduct(familyId, barcode, productName);
    await addItemToShoppingList(familyId, productName);
    await clearPendingBarcode(familyId, userId);
    await sendWhatsAppMessage(
      userId,
      t('product_saved', { productName, barcode })
    );
  } catch (error) {
    console.error('Error handling barcode response:', error);
    await sendWhatsAppMessage(userId, t('product_save_error'));
  }
}

// Helper functions
function isJoinCommand(body, t) {
  return matchesCommand(body, t, 'create_family') || 
         matchesCommand(body, t, 'join_family');
}

async function handleAddItem(userId, rawBody, ctx, t) {
  if (!ctx) return { message: await sendJoinHint(userId, t) };
  
  const itemToAdd = rawBody.slice(1).trim();
  if (!itemToAdd) {
    return { message: t('add_item_prompt') };
  }
  
  await addItemToShoppingList(ctx.familyId, itemToAdd);
  return { message: t('item_added', { item: itemToAdd }) };
}

async function handleRemoveItem(userId, body, rawBody, ctx, t) {
  if (!ctx) return { message: await sendJoinHint(userId, t) };
  
  const prefixLength = body.startsWith('löschen ') ? 8 : body.startsWith('lösche ') ? 7 : body.startsWith('delete ') ? 6 : body.startsWith('remove ') ? 7 : 1;
  const itemToDelete = rawBody.slice(prefixLength).trim();
  
  if (!itemToDelete) {
    return { 
      message: t('delete_item_prompt') 
    };
  }
  
  const shoppingList = await getShoppingList(ctx.familyId);
  
  const exactItem = shoppingList.items.find(
    item => item.toLowerCase() === itemToDelete.toLowerCase()
  );
  
  if (exactItem) {
    await removeItemFromShoppingList(ctx.familyId, exactItem);
    return { message: t('item_removed', { item: exactItem }) };
  } else {
    const partialMatches = shoppingList.items.filter(
      item => item.toLowerCase().includes(itemToDelete.toLowerCase())
    );
    
    if (partialMatches.length === 1) {
      const partialMatch = partialMatches[0];
      await removeItemFromShoppingList(ctx.familyId, partialMatch);
      return { message: t('item_removed_partial', { item: partialMatch }) };
    } else if (partialMatches.length > 1) {
      return { 
        message: t('multiple_matches', { item: itemToDelete, matches: partialMatches.map(item => `• ${item}`).join('\n') }) 
      };
    }
    
    return { message: t('item_not_found', { item: itemToDelete }) };
  }
}

async function handleCreateFamily(userId, rawBody, ctx, t) {
  if (ctx) {
    return { message: t('already_in_family') };
  }
  
  const familyName = extractCommandArgs(rawBody.toLowerCase(), t, 'create_family').trim();
  if (!familyName) {
    return { message: t('create_family_prompt') };
  }
  
  try {
    const familyId = await createFamily({
      name: familyName,
      creatorPhone: userId
    });
    
    return { 
      message: t('family_created', { name: familyName, id: familyId })
    };
  } catch (error) {
    console.error('Error creating family:', error);
    return { message: t('error_occurred') };
  }
}

async function handleJoinFamily(userId, rawBody, t) {
  const joinId = rawBody.split(' ')[1];
  if (!joinId) {
    return { message: t('join_family_prompt') };
  }
  
  const doc = await getFamilyById(joinId);
  if (!doc) {
    return { message: t('family_not_found') };
  }
  
  await addUserToFamily(joinId, userId);
  return { message: t('joined_family', { name: doc.name }) };
}

async function handleInviteMember(userId, rawBody, ctx, t) {
  if (!ctx) return { message: await sendJoinHint(userId, t) };
  if (!ctx.isAdmin) {
    return { message: t('admin_only', { action: t('invite_member') }) };
  }
  
  const parts = rawBody.split(' ');
  if (parts.length < 2) {
    return { message: t('invite_format') };
  }
  
  const phonePart = parts[1];
  if (!phonePart || !phonePart.match(/^\+?\d/)) {
    return { message: t('invalid_number') };
  }
  
  const namePart = parts.length > 2 ? parts.slice(2).join(' ') : null;
  const cleanNumber = cleanPhoneNumber(phonePart);
  
  const familyDoc = await getFamilyById(ctx.familyId);
  if (!familyDoc) {
    return { message: t('family_not_found') };
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
    ? t('member_invited', { name: namePart, phone: cleanNumber })
    : t('phone_invited', { phone: cleanNumber });
    
  return { message };
}

async function handleRemoveMember(userId, rawBody, ctx, t) {
  if (!ctx) return { message: await sendJoinHint(userId, t) };
  if (!ctx.isAdmin) {
    return { message: t('admin_only', { action: t('remove_member') }) };
  }
  
  const namePart = rawBody.split(' ').slice(1).join(' ').trim();
  if (!namePart) {
    return { message: t('remove_member_prompt') };
  }
  
  const userPhone = await findUserByNameOrPhone(ctx.familyId, namePart);
  if (!userPhone) {
    return { message: t('member_not_found') };
  }
  
  if (userPhone === userId) {
    return { message: t('use_leave_command') };
  }
  
  await removeUserFromFamily(ctx.familyId, userPhone);
  const userName = namePart.includes('+') ? userPhone : namePart;
  return { message: t('member_removed', { name: userName }) };
}

async function handlePromoteMember(userId, rawBody, ctx, t) {
  if (!ctx) return { message: await sendJoinHint(userId, t) };
  if (!ctx.isAdmin) {
    return { message: t('admin_only', { action: t('promote_member') }) };
  }
  
  const namePart = rawBody.split(' ').slice(1).join(' ').trim();
  if (!namePart) {
    return { message: t('promote_member_prompt') };
  }
  
  const userPhone = await findUserByNameOrPhone(ctx.familyId, namePart);
  if (!userPhone) {
    return { message: t('member_not_found') };
  }
  
  const familyDoc = await getFamilyById(ctx.familyId);
  if (!familyDoc || !familyDoc.members.includes(userPhone)) {
    return { message: t('not_family_member') };
  }
  
  if (familyDoc.admins.includes(userPhone)) {
    const userName = familyDoc.memberNames?.[userPhone] || userPhone;
    return { message: t('already_admin', { name: userName }) };
  }
  
  await promoteUserToAdmin(ctx.familyId, userPhone);
  const userName = familyDoc.memberNames?.[userPhone] || userPhone;
  return { message: t('promoted_to_admin', { name: userName }) };
}

async function handleDemoteMember(userId, rawBody, ctx, t) {
  if (!ctx) return { message: await sendJoinHint(userId, t) };
  if (!ctx.isAdmin) {
    return { message: t('admin_only', { action: t('demote_member') }) };
  }
  
  const namePart = rawBody.split(' ').slice(1).join(' ').trim();
  if (!namePart) {
    return { message: t('demote_member_prompt') };
  }
  
  const userPhone = await findUserByNameOrPhone(ctx.familyId, namePart);
  if (!userPhone) {
    return { message: t('member_not_found') };
  }
  
  const familyDoc = await getFamilyById(ctx.familyId);
  if (!familyDoc || !familyDoc.members.includes(userPhone)) {
    return { message: t('not_family_member') };
  }
  
  if (!familyDoc.admins.includes(userPhone)) {
    const userName = familyDoc.memberNames?.[userPhone] || userPhone;
    return { message: t('not_admin', { name: userName }) };
  }
  
  if (userPhone === userId) {
    return { message: t('cannot_demote_self') };
  }
  
  if (familyDoc.admins.length <= 1) {
    return { message: t('need_one_admin') };
  }
  
  await demoteUserFromAdmin(ctx.familyId, userPhone);
  const userName = familyDoc.memberNames?.[userPhone] || userPhone;
  return { message: t('demoted_from_admin', { name: userName }) };
}

async function handleMembersCommand(userId, ctx, t) {
  if (!ctx) return { message: await sendJoinHint(userId, t) };
  
  const memberList = await listFamilyMembers(ctx.familyId);
  return { 
    message: memberList.length
      ? t('family_members_title') + '\n\n' + memberList.join('\n')
      : t('no_family_members')
  };
}

async function handleLeaveFamily(userId, ctx, t) {
  if (!ctx) return { message: await sendJoinHint(userId, t) };
  
  const familyDoc = await getFamilyById(ctx.familyId);
  if (!familyDoc) {
    return { message: t('family_not_found') };
  }
  
  const members = familyDoc.members || [];
  
  if (ctx.isAdmin) {
    if (members.length === 1) {
      await deleteFamily(ctx.familyId);
      return { message: t('family_deleted') };
    } else {
      const otherMembers = members.filter(m => m !== userId);
      const newAdmin = otherMembers[0];
      await promoteUserToAdmin(ctx.familyId, newAdmin);
    }
  }
  
  await removeUserFromFamily(ctx.familyId, userId);
  return { message: t('left_family') };
}

function cleanPhoneNumber(phone) {
  return phone.replace(/^whatsapp:/i, '')
    .replace(/^00/, '+') 
    .replace(/^0/, '+41')
    .replace(/^(\d)/, '+$1');
}

async function sendHelpMessage(userId, ctx, t) {
  const baseCommands = t('commands.base', { returnObjects: true });
  const adminCommands = ctx?.isAdmin ? t('commands.admin', { returnObjects: true }) : [];

  const helpMessage = [
    t('unknown_command'),
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

// Test translation function
export async function testTranslations() {
  const languages = ['de', 'en', 'pt'];
  
  for (const lang of languages) {
    console.log(`Testing translations for language: ${lang}`);
    const t = await getTranslator(lang);
    
    // Test a few key translations
    const keys = [
      'shopping_list_title',
      'shopping_list_empty',
      'item_added',
      'unknown_command'
    ];
    
    for (const key of keys) {
      console.log(`  ${key}: "${t(key)}"`);
    }
    console.log('---');
  }
}

// Call this function on startup
testTranslations().catch(console.error);

