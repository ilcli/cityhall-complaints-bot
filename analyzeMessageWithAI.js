import fetch from 'node-fetch';

export async function analyzeComplaint({ message, timestamp, imageUrl }) {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const model = 'openrouter/auto'; // Or explicitly set model

  const prompt = `
הודעה חדשה התקבלה במערכת פניות הציבור. נתח את הטקסט הבא והחזר תשובה בפורמט JSON עם השדות הבאים:

- "שם הפונה": אם נמסר בגוף ההודעה
- "קטגוריה": סיווג הפנייה (כמו תאורה, ניקיון, תחבורה, ביטחון וכו')
- "רמת דחיפות": רגילה / גבוהה / מיידית
- "תוכן הפנייה": הטקסט המקורי
- "תאריך ושעה": פורמט HH:mm DD-MM-YY לפי שעון ישראל
- "טלפון": מספר הטלפון של הפונה
- "קישור לתמונה": אם קיים
- "סוג הפנייה": תלונה / בקשה / מחמאה / אחר
- "מחלקה אחראית": מחלקה רלוונטית בעירייה (כמו תברואה, חשמל, גינון וכו')

הודעה: """${message}"""
טלפון: ${message?.phone || 'לא צוין'}
תמונה: ${imageUrl || 'אין'}
תאריך ושעה: ${timestamp}
  `;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    console.error(`OpenRouter error: ${response.statusText}`);
    return {};
  }

  const data = await response.json();

  const rawText = data?.choices?.[0]?.message?.content;
  try {
    const parsed = JSON.parse(rawText);
    return parsed;
  } catch (err) {
    console.error('Failed to parse OpenRouter response:', rawText);
    return {
      'תוכן הפנייה': message,
      'תאריך ושעה': timestamp,
      'טלפון': message?.phone || '',
      'קישור לתמונה': imageUrl || '',
    };
  }
}
