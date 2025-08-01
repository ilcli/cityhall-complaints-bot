import express from 'express';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { DateTime } from 'luxon';

import { analyzeComplaint } from './analyzeMessageWithAI.js';
import { appendToSheet } from './googleSheets.js';

// Store recent messages for pairing with images
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
    const { payload } = req.body;

    const inner = payload?.payload;
    const type = payload?.type;
    const messageType = inner?.type;
    const content = inner?.payload;
    const sender = inner?.payload?.sender?.phone || inner?.sender?.phone;
    const timestampMsRaw = inner?.payload?.timestamp || inner?.timestamp;
    const timestampMs = parseInt(timestampMsRaw);

    if (!sender) {
      console.warn('Missing sender');
      return res.status(400).send('Missing sender');
    }

    if (!timestampMs || isNaN(timestampMs)) {
      console.warn('Missing or invalid timestamp');
      return res.status(400).send('Invalid timestamp');
    }

    if (!content && messageType !== 'image') {
      console.warn('Invalid payload structure');
      return res.status(400).send('Invalid content');
    }

    const timestamp = DateTime.fromMillis(timestampMs)
      .setZone('Asia/Jerusalem')
      .toFormat('HH:mm dd-MM-yy');

    let messageText = '';
    let imageUrl = null;

    if (messageType === 'text') {
      messageText = content.payload;
      recentMessages.set(sender, { message: messageText, timestamp: timestampMs });

    } else if (messageType === 'image') {
      const caption = content.payload || ''; // optional
      imageUrl = content.url || content.mediaUrl || ''; // support multiple formats

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
      console.warn('Unsupported message type:', messageType);
      return res.status(400).send('Unsupported message type');
    }

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

// Periodically clear old messages
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
