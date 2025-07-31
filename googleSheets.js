import { google } from 'googleapis';
import fs from 'fs';

const SHEET_ID = process.env.SHEET_ID;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const credsPath = './creds/service-account.json';

// 🔍 Confirm the file exists BEFORE using it
console.log('🔍 Checking for service-account.json...');
console.log('✔️ JSON file exists:', fs.existsSync(credsPath));

if (!fs.existsSync(credsPath)) {
  throw new Error('❌ service-account.json is missing at ./creds/service-account.json');
}

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(fs.readFileSync(credsPath, 'utf-8')),
  scopes: SCOPES
});

export async function logComplaintToSheet({ from, message, chatName, timestamp }) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const values = [[timestamp, from, message, chatName]];
  
  console.log("📄 SHEET_ID:", SHEET_ID);
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:D',
      valueInputOption: 'RAW',
      resource: { values }
    });
    console.log('✅ Complaint logged to Google Sheet.');
  } catch (err) {
    console.error('❌ Google Sheets API error:', err.message);
    throw err;
  }
}
