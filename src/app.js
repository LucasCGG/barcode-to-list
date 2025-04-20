// Express application setup
import express from 'express';
import webhookRouter from './routes/webhook.js';

const app = express();

// Middleware for parsing request bodies
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/', webhookRouter);

// Default route
app.get('/', (req, res) => {
  res.send('WhatsApp Shopping List Bot Server is running!');
});

export default app;