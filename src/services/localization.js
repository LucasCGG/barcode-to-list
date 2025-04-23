import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesPath = path.join(__dirname, '../../locales');

/**
 * Initialize i18next with the specified language
 * @param {string} language - The language code to use
 * @returns {Promise<i18next.i18n>} - The initialized i18next instance
 */
export async function initI18n(language = 'en') {
  // Check if locale files exist and log their paths for debugging
  const localePath = path.join(process.cwd(), 'locales');
  
  try {
    const files = fs.readdirSync(localePath);
    console.log(`Found locale files: ${files.join(', ')}`);
  } catch (error) {
    console.error(`Error reading locale directory: ${error.message}`);
  }

  const i18n = i18next.createInstance();
  
  await i18n
    .use(Backend)
    .init({
      lng: language,
      fallbackLng: 'en',
      debug: true,
      backend: {
        loadPath: path.join(localesPath, '{{lng}}.json')
      },
      interpolation: {
        escapeValue: false
      }
    });

  // Log the loaded resources for debugging
  console.log(`i18next initialized with language: ${language}`);
  console.log(`Available resources:`, Object.keys(i18n.services.resourceStore.data));
  
  return i18n;
}

/**
 * Get the translation function for the specified language
 * @param {string} language - The language code to use
 * @returns {Promise<Function>} - The translation function
 */
export async function getTranslator(language = 'de') {
  const i18n = await initI18n(language);
  
  // Create a wrapper function that logs missing translations
  const translator = (key, options) => {
    const translation = i18n.t(key, options);
    
    // If the translation is the same as the key, it might be missing
    if (translation === key) {
      console.warn(`Missing translation for key: ${key} in language: ${language}`);
    }
    
    return translation;
  };
  
  return translator;
}

// Update the test translations function to include Portuguese
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
