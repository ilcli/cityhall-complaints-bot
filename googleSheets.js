import { google } from 'googleapis';
import fs from 'fs';

const SHEET_ID = process.env.SHEET_ID;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const credsPath = './creds/service-account.json';

// 🔐 Write creds file from env variable if needed
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

// 👇 This is what index.js is expecting
export async function appendToSheet(row) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const values = [[
    row['תאריך ושעה'] || '',
    row['תוכן הפנייה'] || '',
    row['שם הפונה'] || '',
    row['טלפון'] || '',
    row['קישור לתמונה'] || '',
    row['קטגוריה'] || '',
    row['רמת דחיפות'] || '',
    row['סוג הפנייה'] || '',
    row['מחלקה אחראית'] || '',
    row['source'] || '',
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'A:J',
    valueInputOption: 'RAW',
    resource: { values },
  });

  console.log(`📥 Sheet updated with entry from ${row['טלפון']}`);
}
