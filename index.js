import express from 'express';
import { analyzeComplaint } from './analyzeMessageWithAI.js';
import { logComplaintToSheet } from './googleSheets.js';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('City Hall Complaints Bot is running.');
});

app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body.payload?.payload;
    if (!payload?.text || !payload?.sender?.phone) {
      console.error('❌ Invalid webhook payload');
      return res.status(400).send('Invalid payload');
    }

    const message = payload.text;
    const timestamp = new Date().toISOString();
    const imageUrl = ''; // Will be populated later if image-handling logic is added

    console.log('📩 New incoming message:', message);

    const structured = await analyzeComplaint({ message, timestamp, imageUrl });
    console.log('🧠 Parsed structure:', structured);

    await logComplaintToSheet(structured);

    res.send('✅ Complaint logged successfully');
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}/webhook`);
});
