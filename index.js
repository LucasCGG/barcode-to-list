// Main entry point for the WhatsApp Shopping List application
import 'dotenv/config';
import app from './src/app.js';
import http from 'http';

// Quick environment variable check
const requiredEnv = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL'
];
for (const envName of requiredEnv) {
  if (!process.env[envName]) {
    console.error(`Missing required environment variable: ${envName}`);
    process.exit(1);
  }
}

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
});