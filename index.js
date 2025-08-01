import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { DateTime } from 'luxon';

import { analyzeComplaint } from './analyzeMessageWithAI.js';
import { appendToSheet } from './googleSheets.js';

// Track recent messages to pair with incoming image-only messages
const recentMessages = new Map();
function isWithin60Seconds(oldTs, newTs) {
  return Math.abs(newTs - oldTs) <= 60000;
}

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json({ limit: '2mb' }));

app.post('/webhook', async (req, res) => {
  try {
    const { type: webhookType, payload } = req.body;

    if (webhookType !== 'message-event') {
      console.log('⚠️ Ignored non-message event:', webhookType);
      return res.status(200).send('Ignored');
    }

    const content = payload?.payload;
    const sender = content?.sender?.phone;
    const timestampMsRaw = content?.timestamp;
    const timestampMs = parseInt(timestampMsRaw);

    // Validate required fields
    if (!sender) {
      console.warn('❌ Missing sender');
      return res.status(400).send('Missing sender');
    }

    if (!timestampMs || isNaN(timestampMs)) {
      console.warn('❌ Invalid timestamp');
      return res.status(400).send('Invalid timestamp');
    }

    const timestamp = DateTime.fromMillis(timestampMs)
      .setZone('Asia/Jerusalem')
      .toFormat('HH:mm dd-MM-yy');

    // Infer message type based on content structure
    let messageType = '';
    if (content?.type) {
      messageType = content.type;
    } else if (content?.url || content?.mediaUrl) {
      messageType = 'image';
    } else if (typeof content?.payload === 'string') {
      messageType = 'text';
    } else {
      console.warn('❌ Unsupported or unknown message type');
      return res.status(400).send('Unsupported message type');
    }

    // Extract message text or image
    let messageText = '';
    let imageUrl = null;

    if (messageType === 'text') {
      messageText = content.payload;
      recentMessages.set(sender, { message: messageText, timestamp: timestampMs });

    } else if (messageType === 'image') {
      const caption = content.payload || ''; // optional
      imageUrl = content.url || content.mediaUrl || '';

      if (caption) {
        messageText = caption;
      } else if (recentMessages.has(sender)) {
        const recent = recentMessages.get(sender);
        if (isWithin60Seconds(recent.timestamp, timestampMs)) {
          messageText = recent.message;
        } else {
          messageText = '(תמונה ללא טקסט, לא ניתן לקשר לפנייה)';
        }
      } else {
        messageText = '(תמונה ללא טקסט, לא ניתן לקשר לפנייה)';
      }

    } else {
      console.warn('❌ Unsupported message type:', messageType);
      return res.status(400).send('Unsupported message type');
    }

    // AI analysis
    const analysis = await analyzeComplaint({ message: messageText, timestamp, imageUrl });

    const row = {
      'שם הפונה': analysis['שם הפונה'] || '',
      'קטגוריה': analysis['קטגוריה'] || '',
      'רמת דחיפות': analysis['רמת דחיפות'] || '',
      'תוכן הפנייה': analysis['תוכן הפנייה'] || messageText,
      'תאריך ושעה': timestamp,
      'טלפון': sender,
      'קישור לתמונה': analysis['קישור לתמונה'] || imageUrl || '',
      'סוג הפנייה': analysis['סוג הפנייה'] || '',
      'מחלקה אחראית': analysis['מחלקה אחראית'] || '',
      'source': 'gupshup',
    };

    await appendToSheet(row);
    console.log(`✅ Complaint from ${sender} logged with type: ${messageType}`);
    return res.status(200).send('OK');

  } catch (err) {
    console.error('❌ Error in /webhook handler:', err);
    return res.status(500).send('Internal Server Error');
  }
});

// Clean up expired recent messages
setInterval(() => {
  const now = Date.now();
  for (const [phone, data] of recentMessages) {
    if (!isWithin60Seconds(data.timestamp, now)) {
      recentMessages.delete(phone);
    }
  }
}, 60000);

app.get('/', (req, res) => {
  res.send('City Hall Complaint Bot is running.');
});

app.listen(PORT, () => {
  console.log(`🚀 Server live on port ${PORT}`);
});
