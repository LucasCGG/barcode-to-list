// Firebase configuration and initialization
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read the Firebase service account key file
const serviceAccount = JSON.parse(
  readFileSync(join(process.cwd(), 'firebase-key.json'), 'utf8')
);

// Initialize Firebase with service account
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase initialized successfully');
} catch (error) {
  // Prevent re-initialization errors during hot reloading
  if (!/already exists/u.test(error.message)) {
    console.error('Firebase admin initialization error', error.stack);
  }
}

const db = admin.firestore();

export default db;