import { google } from 'googleapis';
import fs from 'fs';

const SHEET_ID = process.env.SHEET_ID;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// Load your service account credentials
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(fs.readFileSync('./creds/service-account.json', 'utf-8')),
  scopes: SCOPES
});

export async function logComplaintToSheet({ from, message, chatName, timestamp }) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const values = [[timestamp, from, message, chatName]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Sheet1!A:D',
    valueInputOption: 'RAW',
    resource: { values }
  });

  console.log('✅ Complaint logged to Google Sheet.');
}
