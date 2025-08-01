import express from 'express';
import bodyParser from 'body-parser';
import { analyzeComplaint } from './analyzeComplaint.js';
import { appendToSheet } from './googleSheets.js';
import { DateTime } from 'luxon';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: '2mb' }));

app.post('/webhook', async (req, res) => {
  try {
    const { payload } = req.body;

    if (!payload || !payload.message || !payload.sender) {
      console.warn('Invalid payload received:', JSON.stringify(req.body));
      return res.status(400).send('Bad Request: Missing fields');
    }

    const messageText = payload.message.text || '';
    const senderPhone = payload.sender;
    const timestampMs = parseInt(payload.timestamp); // Unix ms

    const timestamp = DateTime.fromMillis(timestampMs)
      .setZone('Asia/Jerusalem')
      .toFormat('HH:mm dd-MM-yy');

    const analysis = await analyzeComplaint({
      message: messageText,
      timestamp,
      imageUrl: null, // Add logic if you later support media
    });

    const row = {
      'שם הפונה': analysis['שם הפונה'] || '',
      'קטגוריה': analysis['קטגוריה'] || '',
      'רמת דחיפות': analysis['רמת דחיפות'] || '',
      'תוכן הפנייה': analysis['תוכן הפנייה'] || messageText,
      'תאריך ושעה': timestamp,
      'טלפון': senderPhone,
      'קישור לתמונה': analysis['קישור לתמונה'] || '',
      'סוג הפנייה': analysis['סוג הפנייה'] || '',
      'מחלקה אחראית': analysis['מחלקה אחראית'] || '',
      'source': 'gupshup',
    };

    await appendToSheet(row);
    console.log(`✅ Complaint from ${senderPhone} logged successfully.`);

    return res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Error in /webhook handler:', err);
    return res.status(500).send('Internal Server Error');
  }
});

app.get('/', (req, res) => {
  res.send('City Hall Complaint Bot is running.');
});

app.listen(PORT, () => {
  console.log(`🚀 Server live on port ${PORT}`);
});
