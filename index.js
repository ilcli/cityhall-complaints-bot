import express from 'express';
import dotenv from 'dotenv';
import { logComplaintToSheet } from './googleSheets.js';

dotenv.config();
const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;

    // Basic structure validation
    if (!payload || !payload.payload || !payload.payload.payload) {
      console.log('Invalid payload:', JSON.stringify(payload, null, 2));
      return res.status(400).send('Invalid webhook format');
    }

    const msg = payload.payload.payload;

    const data = {
      from: msg.sender?.phone || 'Unknown',
      message: msg.text || JSON.stringify(msg),
      chatName: msg.sender?.name || 'Unknown',
      timestamp: new Date().toISOString()
    };

    console.log('📬 Incoming complaint:', data);
    await logComplaintToSheet(data);

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error in webhook:', err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Webhook server running at http://localhost:${PORT}/webhook`);
});
