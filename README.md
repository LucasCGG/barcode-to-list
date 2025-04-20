# WhatsApp Shopping List Bot

A Node.js application that connects WhatsApp (via Twilio) to Firebase Firestore for managing shopping lists.

## Features

- Receive and process WhatsApp messages via Twilio webhook
- Store shopping lists in Firebase Firestore
- Track when users last checked the shopping list
- Handle image uploads and barcode processing (placeholder functionality)
- ES6+ syntax with modular code structure

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your credentials:
   ```
   cp .env.example .env
   ```
4. Start the development server:
   ```
   npm run dev
   ```

## Environment Variables

- `PORT`: The port for the Express server (default: 3000)
- `TWILIO_ACCOUNT_SID`: Your Twilio account SID
- `TWILIO_AUTH_TOKEN`: Your Twilio auth token
- `TWILIO_PHONE_NUMBER`: Your Twilio WhatsApp number
- `FIREBASE_PROJECT_ID`: Your Firebase project ID
- `FIREBASE_CLIENT_EMAIL`: Your Firebase client email
- `FIREBASE_PRIVATE_KEY`: Your Firebase private key
- `FIREBASE_DATABASE_URL`: Your Firebase database URL

## Twilio Webhook Setup

1. Set up a Twilio WhatsApp sandbox or number
2. Configure the webhook URL to point to your `/webhook` endpoint
3. Ensure your server is accessible via HTTPS (required by Twilio)

## Usage

- Send "einkaufsliste" to get the current shopping list
- Send an image to process it (e.g., a barcode image)

## Database Structure

### Collections

- `shoppingList`: Stores the current shopping list
  - Document: `current`
    - `items`: Array of shopping list items
    - `last_updated`: Timestamp of the last update

- `userLastChecked`: Tracks when users last checked the list
  - Document ID: User's WhatsApp number
    - `timestamp`: When they last checked

- `images`: Logs uploaded images
  - Document ID: Auto-generated
    - `userId`: User's WhatsApp number
    - `mediaUrl`: URL of the uploaded image
    - `contentType`: Content type of the image
    - `timestamp`: When the image was uploaded