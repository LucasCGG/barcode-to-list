// Webhook route handler for Twilio WhatsApp messages
import express from 'express';
import { handleIncomingMessage } from '../services/twilioService.js';

const router = express.Router();

/**
 * POST endpoint for Twilio webhook
 * This is the main entry point for all incoming WhatsApp messages
 */
router.post('/', (req, res) => {
  try {
    console.log('Incoming webhook request headers:', req.headers);
    console.log('Incoming webhook request body:', req.body);
    
    // Send immediate response
    res.setHeader('Content-Type', 'text/xml');
    res.send('<Response></Response>');
    
    // Process message asynchronously
    handleIncomingMessage(req.body).catch(error => {
      console.error('Error in async message handling:', error);
    });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).send('<Response></Response>');
  }
});

export default router;