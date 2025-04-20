# WhatsApp Shopping List Bot

A Node.js application that connects WhatsApp (via Twilio) to Firebase Firestore for managing shopping lists.

## Features

- Receive and process WhatsApp messages via Twilio webhook
- Store shopping lists in Firebase Firestore
- Track when users last checked the shopping list
- Handle image uploads and barcode processing
- Custom barcode-to-product mappings
- Pending barcode tracking for unrecognized products
- ES6+ syntax with modular code structure
- Item management commands (add/remove/clear)
- Image processing with Sharp and ZXing libraries

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
- `FIREBASE_DATABASE_URL`: Your Firebase database URL (optional if not using Realtime Database)

## Twilio Webhook Setup

1. Set up a Twilio WhatsApp sandbox or number
2. Configure the webhook URL to point to your `/webhook` endpoint
3. Ensure your server is accessible via HTTPS (required by Twilio)

## Usage

- `einkaufsliste` - Get current shopping list
- `liste leeren` - Clear entire list
- `+ Item` - Manually add item (e.g. "+ Milk")
- `löschen Item` - Remove specific item (e.g. "löschen Milk")
- Send barcode image - Auto-add product if recognized
- Send any other image - Process for potential barcode

## Database Structure

### Collections

- `shoppingList`: Stores the current shopping list
  - Document: `current`
    - `items`: Array of shopping list items
    - `last_updated`: Timestamp of last update

- `userLastChecked`: Tracks when users last checked the list
  - Document ID: User's WhatsApp number
    - `timestamp`: Last check time

- `customBarcodes`: Stores user-defined barcode mappings
  - Document ID: Barcode number
    - `productName`: Custom product name
    - `createdAt`: Mapping creation timestamp

- `pendingBarcodes`: Temporary storage for unrecognized barcodes
  - Document ID: User's WhatsApp number
    - `barcode`: Scanned barcode value
    - `timestamp`: Scan time

## Image Processing Workflow

1. User sends image via WhatsApp
2. System downloads and processes image:
   - Converts to grayscale
   - Attempts barcode recognition
3. If barcode recognized:
   - Checks custom mappings
   - Adds known product or prompts for name
4. If unrecognized:
   - Stores barcode as pending
   - Requests product name from user
5. Maps barcode to product name for future use