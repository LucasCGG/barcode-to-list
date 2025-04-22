// Firestore service for database operations
import admin from 'firebase-admin';
import db from '../config/firebase.js';

/**
 * Optional: Central users collection for richer person metadata
 * users/{phoneNumber} = { name, joinedFamilies, preferredName }
 */

/** ------------------------------------------------------------------
 * Helper – centralise all collection paths for a given family
 * ------------------------------------------------------------------*/
function collections(familyId) {
  if (!familyId) {
    throw new Error('familyId is required for multi‑family mode');
  }
  const familyDoc = db.collection('families').doc(familyId);
  return {
    shoppingList:     familyDoc.collection('shoppingList'),
    userLastChecked:  familyDoc.collection('userLastChecked'),
    customBarcodes:   familyDoc.collection('customBarcodes'),
    pendingBarcodes:  familyDoc.collection('pendingBarcodes'),
    familyRef:        familyDoc,
  };
}

/**
 * Get the shopping list from Firestore
 * @returns {Promise<Object>} The shopping list and last updated timestamp
 */
export async function getShoppingList(familyId) {
  const { shoppingList } = collections(familyId);
  const docRef = shoppingList.doc('current');
  const snap = await docRef.get();
  if (!snap.exists) {
    const defaultList = { items: [], last_updated: admin.firestore.FieldValue.serverTimestamp() };
    await docRef.set(defaultList);
    return defaultList;
  }
  return snap.data();
}

/**
 * Add an item to the shopping list
 * @param {string} item
 */
export async function addItemToShoppingList(familyId, item) {
  const { shoppingList } = collections(familyId);
  await db.runTransaction(async (tx) => {
    const docRef = shoppingList.doc('current');
    const snap   = await tx.get(docRef);
    const data   = snap.exists ? snap.data() : { items: [], last_updated: admin.firestore.FieldValue.serverTimestamp() };
    if (!data.items.includes(item)) {
      data.items.push(item);
      data.last_updated = admin.firestore.FieldValue.serverTimestamp();
    }
    tx.set(docRef, data);
  });
}

/**
 * Save a custom product name for a barcode
 * @param {string} barcode
 * @param {string} productName
 */
export async function saveCustomProduct(familyId, barcode, productName) {
  const { customBarcodes } = collections(familyId);
  await customBarcodes.doc(barcode).set({ productName, createdAt: admin.firestore.FieldValue.serverTimestamp() });
}

/**
 * Check if a barcode has a custom saved product
 * @param {string} barcode
 * @returns {Promise<string|null>}
 */
export async function getCustomProduct(familyId, barcode) {
  const { customBarcodes } = collections(familyId);
  const snap = await customBarcodes.doc(barcode).get();
  return snap.exists ? snap.data().productName : null;
}

/**
 * Save a pending barcode for a user (waiting for manual product name)
 * @param {string} userId
 * @param {string} barcode
 */
export async function setPendingBarcode(familyId, userId, barcode) {
  const { pendingBarcodes } = collections(familyId);
  await pendingBarcodes.doc(userId).set({
    barcode,
    scannedAt: admin.firestore.FieldValue.serverTimestamp(),
    expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
  });
}

/**
 * Get a pending barcode for a user
 * @param {string} userId
 * @returns {Promise<string|null>}
 */
export async function getPendingBarcode(familyId, userId) {
  const { pendingBarcodes } = collections(familyId);
  const snap = await pendingBarcodes.doc(userId).get();
  if (!snap.exists) return null;
  return snap.data().barcode;
}

/**
 * Clear a pending barcode for a user
 * @param {string} userId
 */
export async function clearPendingBarcode(familyId, userId) {
  const { pendingBarcodes } = collections(familyId);
  await pendingBarcodes.doc(userId).delete();
}

/**
 * Remove an item from the shopping list
 * @param {string} itemName
 */
export async function removeItemFromShoppingList(familyId, item) {
  const { shoppingList } = collections(familyId);
  await shoppingList.doc('current').update({
    items: admin.firestore.FieldValue.arrayRemove(item),
    last_updated: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Clear the shopping list
 */
export async function clearShoppingList(familyId) {
  const { shoppingList } = collections(familyId);
  await shoppingList.doc('current').set({ items: [], last_updated: admin.firestore.FieldValue.serverTimestamp() });
}

/** ------------------------------------------------------------------
 *  "Last checked" helpers (optional but still scoped)
 * ------------------------------------------------------------------*/
export async function updateUserLastChecked(familyId, userId) {
  const { userLastChecked } = collections(familyId);
  await userLastChecked.doc(userId).set({ timestamp: admin.firestore.FieldValue.serverTimestamp() });
}

export async function getUserLastChecked(familyId, userId) {
  const { userLastChecked } = collections(familyId);
  const snap = await userLastChecked.doc(userId).get();
  return snap.exists ? snap.data().timestamp : null;
}