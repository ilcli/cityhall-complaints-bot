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
 * Forces complete dashboard recreation with Hebrew interface
 */
export async function recreateDashboard() {
  try {
    initializeGoogleAuth();
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    
    // Delete existing Dashboard sheet if it exists
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: process.env.SHEET_ID
    });
    
    const dashboardSheet = spreadsheet.data.sheets.find(
      sheet => sheet.properties.title === 'Dashboard'
    );
    
    if (dashboardSheet) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: process.env.SHEET_ID,
        resource: {
          requests: [{
            deleteSheet: {
              sheetId: dashboardSheet.properties.sheetId
            }
          }]
        }
      });
      console.log('🗑️ לוח בקרה ישן נמחק');
    }
    
    // Create new Dashboard sheet
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.SHEET_ID,
      resource: {
        requests: [{
          addSheet: {
            properties: {
              title: 'Dashboard',
              index: 0 // Place at beginning
            }
          }
        }]
      }
    });
    
    console.log('✅ לוח בקרה חדש בעברית נוצר');
    
    // Set up dashboard structure
    await setupDashboardLayout(sheets);
    
    // Add conditional formatting for visual enhancement
    await addDashboardFormatting(sheets);
    
  } catch (error) {
    console.error('❌ יצירת מחדש של לוח הבקרה נכשלה:', error.message);
    throw error;
  }
}

/**
 * Creates or updates the Dashboard sheet with initial structure
 */
export async function initializeDashboardSheet() {
  try {
    initializeGoogleAuth();
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    
    // Check if Dashboard sheet exists
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: process.env.SHEET_ID
    });
    
    const dashboardExists = spreadsheet.data.sheets.some(
      sheet => sheet.properties.title === 'Dashboard'
    );
    
    if (!dashboardExists) {
      // Create Dashboard sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: process.env.SHEET_ID,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: 'Dashboard',
                index: 0 // Place at beginning
              }
            }
          }]
        }
      });
      
      console.log('✅ לוח בקרה נוצר');
    }
    
    // Set up dashboard structure
    await setupDashboardLayout(sheets);
    
    // Add conditional formatting for visual enhancement
    await addDashboardFormatting(sheets);
    
  } catch (error) {
    console.error('❌ אתחול לוח הבקרה נכשל:', error.message);
    throw error;
  }
}

/**
 * Sets up the dashboard layout with headers and sections
 */
async function setupDashboardLayout(sheets) {
  const dashboardData = [
    ['📊 לוח בקרה - פניות ציבור עירייה', '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['📈 סיכום יומי', '', '📊 פילוח קטגוריות', '', '⚡ רמות דחיפות', ''],
    ['תאריך', 'סה״כ פניות', 'קטגוריה', 'כמות', 'רמה', 'כמות'],
    ['=TODAY()', '=COUNTIFS(Complaints!A:A,">="&TODAY(),Complaints!A:A,"<"&TODAY()+1)', 'תאורה', '=COUNTIF(Complaints!F:F,"תאורה")', 'מיידית', '=COUNTIF(Complaints!G:G,"מיידית")'],
    ['=TODAY()-1', '=COUNTIFS(Complaints!A:A,">="&TODAY()-1,Complaints!A:A,"<"&TODAY())', 'ניקיון', '=COUNTIF(Complaints!F:F,"ניקיון")', 'גבוהה', '=COUNTIF(Complaints!G:G,"גבוהה")'],
    ['=TODAY()-2', '=COUNTIFS(Complaints!A:A,">="&TODAY()-2,Complaints!A:A,"<"&TODAY()-1)', 'תחבורה', '=COUNTIF(Complaints!F:F,"תחבורה")', 'רגילה', '=COUNTIF(Complaints!G:G,"רגילה")'],
    ['', '', 'ביטחון', '=COUNTIF(Complaints!F:F,"ביטחון")', '', ''],
    ['', '', 'גינון', '=COUNTIF(Complaints!F:F,"גינון")', '', ''],
    ['', '', '', '', '', ''],
    ['🤖 ביצועי המערכת', '', '📱 ניתוח מקורות', '', '📋 עומס מחלקות', ''],
    ['מדד', 'ערך', 'מקור', 'כמות', 'מחלקה', 'פניות'],
    ['עדכון אחרון', '=NOW()', 'וואטסאפ', '=COUNTIF(Complaints!J:J,"whatsapp*")', 'תברואה', '=COUNTIF(Complaints!I:I,"תברואה")'],
    ['סה״כ מעובד', '0', 'גופשופ', '=COUNTIF(Complaints!J:J,"gupshup*")', 'חשמל', '=COUNTIF(Complaints!I:I,"חשמל")'],
    ['אחוז הצלחה', '0%', 'אמינות גבוהה', '=COUNTIF(Complaints!J:J,"*:high")', 'גינון', '=COUNTIF(Complaints!I:I,"גינון")'],
    ['זמן תגובה ממוצע', '0 שניות', 'הודעות מקושרות', '=COUNTIF(Complaints!J:J,"*paired*")', 'מהנדס העיר', '=COUNTIF(Complaints!I:I,"מהנדס העיר")'],
    ['', '', '', '', '', ''],
    ['📅 מגמות שבועיות', '', '', '', '', ''],
    ['שבוע', 'פניות', 'ממוצע יומי', 'יום שיא', 'קטגוריות', 'נושא מוביל'],
    ['השבוע', '=COUNTIFS(Complaints!A:A,">="&TODAY()-WEEKDAY(TODAY())+2)', '=B19/7', '', '', ''],
    ['שבוע שעבר', '=COUNTIFS(Complaints!A:A,">="&TODAY()-WEEKDAY(TODAY())-5,Complaints!A:A,"<"&TODAY()-WEEKDAY(TODAY())+2)', '=B20/7', '', '', '']
  ];
  
  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SHEET_ID,
    range: 'Dashboard!A1:F21',
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: dashboardData
    }
  });
  
  console.log('✅ פריסת לוח הבקרה הוגדרה עם נוסחאות');
}

/**
 * Adds conditional formatting and styling to the dashboard
 */
async function addDashboardFormatting(sheets) {
  try {
    const sheetId = await getDashboardSheetId(sheets);
    
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.SHEET_ID,
      resource: {
        requests: [
          // Header formatting
          {
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 6
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.2, green: 0.6, blue: 1.0 },
                  textFormat: {
                    foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 },
                    fontSize: 14,
                    bold: true
                  },
                  horizontalAlignment: 'CENTER'
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
            }
          },
          // Section headers formatting
          {
            repeatCell: {
              range: {
                sheetId: sheetId,
                startRowIndex: 2,
                endRowIndex: 3,
                startColumnIndex: 0,
                endColumnIndex: 6
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                  textFormat: { bold: true },
                  horizontalAlignment: 'CENTER'
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
            }
          },
          // Conditional formatting for urgency levels
          {
            addConditionalFormatRule: {
              rule: {
                ranges: [{
                  sheetId: sheetId,
                  startRowIndex: 4,
                  endRowIndex: 8,
                  startColumnIndex: 4,
                  endColumnIndex: 6
                }],
                booleanRule: {
                  condition: {
                    type: 'TEXT_CONTAINS',
                    values: [{ userEnteredValue: 'מיידית' }]
                  },
                  format: {
                    backgroundColor: { red: 1.0, green: 0.4, blue: 0.4 },
                    textFormat: { foregroundColor: { red: 1.0, green: 1.0, blue: 1.0 } }
                  }
                }
              },
              index: 0
            }
          },
          {
            addConditionalFormatRule: {
              rule: {
                ranges: [{
                  sheetId: sheetId,
                  startRowIndex: 4,
                  endRowIndex: 8,
                  startColumnIndex: 4,
                  endColumnIndex: 6
                }],
                booleanRule: {
                  condition: {
                    type: 'TEXT_CONTAINS',
                    values: [{ userEnteredValue: 'גבוהה' }]
                  },
                  format: {
                    backgroundColor: { red: 1.0, green: 0.8, blue: 0.4 }
                  }
                }
              },
              index: 1
            }
          }
        ]
      }
    });
    
    console.log('🎨 עיצוב לוח הבקרה הוחל');
  } catch (error) {
    console.warn('⚠️ עיצוב לוח הבקרה נכשל:', error.message);
  }
}

/**
 * Gets the Dashboard sheet ID
 */
async function getDashboardSheetId(sheets) {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: process.env.SHEET_ID
  });
  
  const dashboardSheet = spreadsheet.data.sheets.find(
    sheet => sheet.properties.title === 'Dashboard'
  );
  
  return dashboardSheet ? dashboardSheet.properties.sheetId : 0;
}

/**
 * Updates dashboard with real-time bot statistics
 * @param {object} stats - Bot performance statistics
 */
export async function updateDashboardStats(stats = {}) {
  try {
    initializeGoogleAuth();
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    
    const statsData = [
      ['=NOW()'], // עדכון אחרון
      [stats.totalProcessed || '0'],
      [`${stats.successRate || 0}%`],
      [`${stats.avgResponseTime || 0} שניות`] // Hebrew for "seconds"
    ];
    
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SHEET_ID,
      range: 'Dashboard!B12:B15',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: statsData
      }
    });
    
    console.log('📊 סטטיסטיקות לוח הבקרה עודכנו');
  } catch (error) {
    console.error('❌ עדכון סטטיסטיקות לוח הבקרה נכשל:', error.message);
    // Don't throw - dashboard updates should not break main flow
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
      range: 'Complaints!A:J',
      valueInputOption: 'USER_ENTERED', // Safer than RAW for user input
      insertDataOption: 'INSERT_ROWS',
      resource: { values },
    });

    console.log(`📥 Sheet updated with entry from ${row['טלפון']} - ${response.data.updates?.updatedRows} rows added`);
    
    // Update dashboard after each complaint (async, don't block main flow)
    setTimeout(() => {
      updateDashboardStats(row.performanceStats).catch(err => 
        console.warn('⚠️ עדכון לוח הבקרה נכשל:', err.message)
      );
    }, 1000);
    
    return response.data;
  } catch (error) {
    console.error('❌ Failed to append to Google Sheet:', error.message);
    throw error;
  }
}
