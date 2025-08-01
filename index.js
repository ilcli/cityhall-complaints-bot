import express from 'express';
import bodyParser from 'body-parser';
import { analyzeComplaint } from './analyzeMessageWithAI.js';
import { appendToSheet } from './googleSheets.js';
import { DateTime } from 'luxon';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json({ limit: '2mb' }));

app.post('/webhook', async (req, res) => {
  try {
    const { payload } = req.body;

    if (
      !payload?.sender ||
      !payload?.message?.text ||
      !payload?.timestamp
    ) {
      console.warn('Invalid payload structure:', JSON.stringify(req.body));
      return res.status(400).send('Invalid payload structure');
    }

    const messageText = payload.message.text;
    const senderPhone = payload.sender;
    const timestampMs = parseInt(payload.timestamp);

    const timestamp = DateTime.fromMillis(timestampMs)
      .setZone('Asia/Jerusalem')
      .toFormat('HH:mm dd-MM-yy');

    const analysis = await analyzeComplaint({
      message: messageText,
      timestamp,
      imageUrl: null,
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
    return res.status(500).s
