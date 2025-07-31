import axios from 'axios';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "deepseek-chat"; // Optional fallback

export async function analyzeComplaint({ message, timestamp, imageUrl = '' }) {
  try {
    const prompt = `
ההודעה הבאה נשלחה לאנשי העירייה. פענח את הפרטים הרלוונטיים, החזר מבנה JSON המכיל את השדות הבאים:

- "category": התחום הרלוונטי בעירייה (תאורה, ניקיון, תחבורה, מים, פיקוח, שירות לקוחות וכו')
- "name": שם הפונה אם צויין
- "phone": מספר הטלפון של הפונה אם צויין
- "notes": הערות נוספות
- "urgency": נמוכה, בינונית, גבוהה
- "type": תלונה / בקשה / הצעה / תודה

ההודעה:
"""${message}"""
`;

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: 'אתה עוזר עירוני לניתוח פניות בעברית.' },
        { role: 'user', content: prompt }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const parsed = JSON.parse(response.data.choices[0].message.content);

    return {
      timestamp,
      message,
      chatName: parsed.name || '',
      from: parsed.phone || '',
      imageUrl,
      category: parsed.category || '',
      urgency: parsed.urgency || '',
      type: parsed.type || '',
      notes: parsed.notes || ''
    };
  } catch (err) {
    console.error('❌ שגיאה בניתוח הפנייה:', err.message);
    return {
      timestamp,
      message,
      chatName: '',
      from: '',
      imageUrl,
      category: '',
      urgency: '',
      type: '',
      notes: ''
    };
  }
}
