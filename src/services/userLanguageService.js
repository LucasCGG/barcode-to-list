import db from '../config/firebase.js';

/**
 * Get the user's preferred language
 * @param {string} userId - The user's WhatsApp ID
 * @returns {Promise<string>} - The user's preferred language code
 */
export async function getUserLanguage(userId) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists && userDoc.data().language) {
      return userDoc.data().language;
    }
    return 'de'; // Default to German
  } catch (error) {
    console.error('Error getting user language:', error);
    return 'de'; // Default to German on error
  }
}

/**
 * Set the user's preferred language
 * @param {string} userId - The user's WhatsApp ID
 * @param {string} language - The language code to set
 * @returns {Promise<void>}
 */
export async function setUserLanguage(userId, language) {
  try {
    await db.collection('users').doc(userId).set({
      language,
      updatedAt: new Date()
    }, { merge: true });
    console.log(`Language for user ${userId} set to ${language}`);
  } catch (error) {
    console.error('Error setting user language:', error);
    throw error;
  }
}

/**
 * Check if a language is supported
 * @param {string} language - The language code to check
 * @returns {boolean} - Whether the language is supported
 */
export function isLanguageSupported(language) {
  const supportedLanguages = ['de', 'en', 'fr'];
  return supportedLanguages.includes(language);
}

/**
 * Get a list of supported languages
 * @returns {string} - A formatted string of supported languages
 */
export function getSupportedLanguages() {
  return 'de (Deutsch), en (English), fr (Français)';
} 