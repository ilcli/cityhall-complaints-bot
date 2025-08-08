import { google } from 'googleapis';
import fs from 'fs';
import { ConfigurationError } from './utils/errors.js';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const credsPath = './creds/service-account.json';

let auth = null;
let initialized = false;

function initializeGoogleAuth() {
  if (initialized) return;

  const SHEET_ID = process.env.SHEET_ID;
  
  if (!SHEET_ID) {
    throw new ConfigurationError('SHEET_ID environment variable is required');
  }

  // 🔐 Write creds file from env variable if needed
  if (!fs.existsSync('./creds')) {
    fs.mkdirSync('./creds', { recursive: true });
  }

  if (!fs.existsSync(credsPath)) {
    if (!process.env.SERVICE_ACCOUNT_JSON) {
      throw new ConfigurationError('SERVICE_ACCOUNT_JSON env var is missing');
    }
    
    try {
      // Validate JSON format before writing
      JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
      fs.writeFileSync(credsPath, process.env.SERVICE_ACCOUNT_JSON, {
        mode: 0o600 // Restrict file permissions
      });
      console.log('✅ service-account.json written from env var with restricted permissions');
    } catch (error) {
      throw new ConfigurationError(`Invalid SERVICE_ACCOUNT_JSON format: ${error.message}`);
    }
  }

  try {
    const credentials = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: SCOPES,
    });
    initialized = true;
  } catch (error) {
    throw new ConfigurationError(`Failed to initialize Google Auth: ${error.message}`);
  }
}

/**
 * Appends a row to the Google Sheet
 * @param {object} row - Row data to append
 * @throws {Error} - If sheet update fails
 */
export async function appendToSheet(row) {
  try {
    // Initialize Google Auth if not already done
    initializeGoogleAuth();
    
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

    console.log('Appending row:', JSON.stringify(values, null, 2));

    const response = await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: 'A:J',
      valueInputOption: 'USER_ENTERED', // Safer than RAW for user input
      insertDataOption: 'INSERT_ROWS',
      resource: { values },
    });

    console.log(`📥 Sheet updated with entry from ${row['טלפון']} - ${response.data.updates?.updatedRows} rows added`);
    
    return response.data;
  } catch (error) {
    console.error('❌ Failed to append to Google Sheet:', error.message);
    throw error;
  }
}
