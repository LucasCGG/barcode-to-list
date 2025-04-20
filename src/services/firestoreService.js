// Firestore service for database operations
import admin from 'firebase-admin';
import db from '../config/firebase.js';

/**
 * Get the shopping list from Firestore
 * @returns {Promise<Object>} The shopping list and last updated timestamp
 */
export async function getShoppingList() {
  try {
    const docRef = db.collection('shoppingList').doc('current');
    const doc = await docRef.get();
    
    if (!doc.exists) {
      // Create a default document if it doesn't exist
      const defaultList = {
        items: [],
        last_updated: admin.firestore.FieldValue.serverTimestamp()
      };
      
      await docRef.set(defaultList);
      return defaultList;
    }
    
    return doc.data();
  } catch (error) {
    console.error('Error getting shopping list:', error);
    throw error;
  }
}

/**
 * Get the timestamp of when the user last checked the shopping list
 * @param {string} userId - The WhatsApp user ID
 * @returns {Promise<Date|null>} The timestamp or null if not found
 */
export async function getUserLastChecked(userId) {
  try {
    const docRef = db.collection('userLastChecked').doc(userId);
    const doc = await docRef.get();
    
    if (!doc.exists) {
      return null;
    }
    
    return doc.data().timestamp;
  } catch (error) {
    console.error('Error getting user last checked:', error);
    throw error;
  }
}

/**
 * Update the timestamp of when the user last checked the shopping list
 * @param {string} userId - The WhatsApp user ID
 * @returns {Promise<void>}
 */
export async function updateUserLastChecked(userId) {
  try {
    const docRef = db.collection('userLastChecked').doc(userId);
    await docRef.set({
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Error updating user last checked:', error);
    throw error;
  }
}

/**
 * Add an item to the shopping list
 * @param {string} item
 */
export async function addItemToShoppingList(item) {
  try {
    await db.runTransaction(async (transaction) => {
      const docRef = db.collection('shoppingList').doc('current');
      const doc = await transaction.get(docRef);
      let data = doc.data();

      if (!data) {
        data = {
          items: [],
          last_updated: admin.firestore.FieldValue.serverTimestamp()
        };
      }

      if (!data.items.includes(item)) {
        data.items.push(item);
        data.last_updated = admin.firestore.FieldValue.serverTimestamp();
      }

      transaction.set(docRef, data);
    });
    console.log(`Item added to shopping list: ${item}`);
  } catch (error) {
    console.error('Error adding item to list via transaction:', {
      errorMessage: error.message,
      item
    });
    throw error;
  }
}

/**
 * Save a custom product name for a barcode
 * @param {string} barcode
 * @param {string} productName
 */
export async function saveCustomProduct(barcode, productName) {
  try {
    await db.collection('customBarcodes').doc(barcode).set({ productName });
    console.log(`💾 Saved custom product "${productName}" for barcode ${barcode}`);
  } catch (error) {
    console.error('Error saving custom product:', error);
    throw error;
  }
}

/**
 * Check if a barcode has a custom saved product
 * @param {string} barcode
 * @returns {Promise<string|null>}
 */
export async function getCustomProduct(barcode) {
  try {
    const doc = await db.collection('customBarcodes').doc(barcode).get();
    return doc.exists ? doc.data().productName : null;
  } catch (error) {
    console.error('Error fetching custom product:', error);
    throw error;
  }
}


/**
 * Save a pending barcode for a user (waiting for manual product name)
 * @param {string} userId
 * @param {string} barcode
 */
export async function setPendingBarcode(userId, barcode) {
  try {
    await db.collection('pendingBarcodes').doc(userId).set({ 
      barcode,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`📌 Pending barcode (${barcode}) set for user ${userId}`);
  } catch (error) {
    console.error('Error setting pending barcode:', error);
    throw error;
  }
}

/**
 * Get a pending barcode for a user
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
export async function getPendingBarcode(userId) {
  try {
    const doc = await db.collection('pendingBarcodes').doc(userId).get();
    if (!doc.exists) return null;
    
    const data = doc.data();
    const FIVE_MINUTES = 5 * 60 * 1000; // 5 minute buffer
    if (Date.now() - data.timestamp.toDate().getTime() > FIVE_MINUTES) {
      await clearPendingBarcode(userId);
      return null;
    }
    return data.barcode;
  } catch (error) {
    console.error('Error getting pending barcode:', error);
    throw error;
  }
}

/**
 * Clear a pending barcode for a user
 * @param {string} userId
 */
export async function clearPendingBarcode(userId) {
  try {
    await db.collection('pendingBarcodes').doc(userId).delete();
    console.log(`🗑️ Cleared pending barcode for user ${userId}`);
  } catch (error) {
    console.error('Error clearing pending barcode:', error);
    throw error;
  }
}

/**
 * Remove an item from the shopping list
 * @param {string} itemName
 */
export async function removeItemFromShoppingList(itemName) {
  try {
    const docRef = db.collection('shoppingList').doc('current');
    await docRef.update({
      items: admin.firestore.FieldValue.arrayRemove(itemName),
      last_updated: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`Item removed from shopping list: ${itemName}`);
  } catch (error) {
    console.error('Error removing item from list:', error);
    throw error;
  }
}

/**
 * Clear the shopping list
 */
export async function clearShoppingList() {
  try {
    const docRef = db.collection('shoppingList').doc('current');
    await docRef.set({
      items: [],
      last_updated: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('🧹 Shopping list cleared.');
  } catch (error) {
    console.error('Error clearing shopping list:', error);
    throw error;
  }
}