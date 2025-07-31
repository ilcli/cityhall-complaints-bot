import { google } from 'googleapis';
import fs from 'fs';

const SHEET_ID = process.env.SHEET_ID;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const credsPath = './creds/service-account.json';

// 🔨 Write creds file from env variable if needed
if (!fs.existsSync('./creds')) {
  fs.mkdirSync('./creds', { recursive: true });
}

if (!fs.existsSync(credsPath)) {
  if (!process.env.SERVICE_ACCOUNT_JSON) {
    throw new Error('❌ SERVICE_ACCOUNT_JSON env var is missing');
  }
  fs.writeFileSync(credsPath, process.env.SERVICE_ACCOUNT_JSON);
  console.log('✅ service-account.json written from env var');
}

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(fs.readFileSync(credsPath, 'utf-8')),
  scopes: SCOPES,
});

export async function logComplaintToSheet({ from, message, chatName, timestamp, imageUrl = '' }) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  // Convert to Israel time (UTC+3) and format to "HH:mm DD-MM-YY"
  const israelTime = new Date(new Date(timestamp).toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const formattedDate = israelTime.toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }) + ' ' + israelTime.toLocaleDateString('he-IL');

  const values = [[
    formattedDate,            // תאריך ושעה
    message,                  // תוכן הפנייה
    chatName,                 // שם הפונה
    from,                     // טלפון
    imageUrl                  // קישור לתמונה
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'A:E',
    valueInputOption: 'RAW',
    resource: { values }
  });

  console.log('✅ הפנייה נרשמה בהצלחה לטבלת Google Sheets.');
}
