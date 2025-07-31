// index.js

import express from 'express';
import dotenv from 'dotenv';
import { logComplaintToSheet } from './googleSheets.js';

dotenv.config();

const app = express();
app.use(express.json());

// ✅ Webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;

    // Log the raw webhook for debugging
    console.log("📬 Incoming webhook:");
    console.log(JSON.stringify(payload, null, 2));

    // Basic validation
    if (!payload || !payload.payload || !payload.payload.payload) {
      console.warn('⚠️ Invalid payload structure');
      return res.status(400).send('Invalid webhook format');
    }

    const msg = payload.payload.payload;

    const data = {
      from: msg.sender?.phone || 'Unknown',
      message: msg.text || JSON.stringify(msg),
      chatName: msg.sender?.name || 'Unknown',
      timestamp: new Date().toISOString()
    };

    console.log('✅ Parsed complaint:', data);
    await logComplaintToSheet(data);

    res.status(200).send("Complaint logged successfully");
  } catch (err) {
    console.error('❌ Error processing webhook:', err);
    res.sendStatus(500);
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}/webhook`);
});
