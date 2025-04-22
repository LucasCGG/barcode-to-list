// Firebase configuration and initialization
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read the Firebase service account key file
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
};

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