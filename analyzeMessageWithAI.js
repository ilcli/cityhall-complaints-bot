import fetch from 'node-fetch';
import { safeJSONParse, validateAIResponse, mergeWithDefaults } from './utils/jsonParser.js';
import { ExternalServiceError } from './utils/errors.js';

/**
 * Analyzes complaint with retry logic
 * @param {object} params - Analysis parameters
 * @param {number} retryCount - Current retry attempt
 * @returns {object} - Analysis result
 */
export async function analyzeComplaint({ message, timestamp, imageUrl }, retryCount = 0) {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  
  // Validate API key exists
  if (!OPENROUTER_API_KEY) {
    console.error('❌ OPENROUTER_API_KEY environment variable is missing');
    return createFallbackResponse({ message, timestamp, imageUrl });
  }
  
  const model = process.env.OPENROUTER_MODEL || 'openrouter/auto';

  const prompt = `
אתה עוזר ווירטואלי מומחה לעירייה ישראלית המנתח פניות ציבור. 
נתח את הפנייה הבאה וסווג אותה בדקדקנות לפי הקטגוריות והמחלקות העירוניות.

קטגוריות אפשריות ומחלקות אחראיות:
🔌 תאורה → חשמל ותאורה (תאורת רחוב, עמודי תאורה פגומים, תאורה חסרה)
⚡ חשמל → חשמל ותאורה (בעיות בחשמל ציבורי, קווי חשמל)
💧 מים → מחלקת מים (דליפות מים, לחץ מים נמוך, אספקת מים)
🚿 ביוב → מחלקת מים (סתימת ביוב, ריח ביוב, הצפות)
🛣️ כבישים → מהנדס העיר (בורות בכביש, אספלט פגום, סדקים)
🚶 מדרכות → מהנדס העיר (מדרכות שבורות, אבנים רופפות)
🏗️ תשתיות → מהנדס העיר (עבודות ציבוריות, פיתוח)
🧹 ניקיון → תברואה (זבל ברחובות, ניקיון לקוי)
🗑️ זבל → תברואה (פחי זבל מלאים, איסוף זבל)
🌳 גינון → גינון ונוף (גיזום עצים, דשא, עצים מסוכנים)
🌸 פארקים → גינון ונוף (תחזוקת פארקים, מתקני משחקים)
🚗 חניה → פיקוח עירוני (הפרות חניה, חניה בלתי חוקית)
🔊 רעש → פיקוח עירוני (הפרעת שקט, עסקים רועשים)
🛡️ ביטחון → ביטחון ופיקוח (ביטחון ציבורי, הפרעת סדר)
💰 ארנונה → גביה (תשלומי ארנונה, חשבונות)
📋 רישוי → רישוי (רישיון עסקים, היתרים)

דוגמאות לסיווג נכון:
- "יש בור גדול ברחוב יפו שמסכן לרכבים" → קטגוריה: כבישים, מחלקה: מהנדס העיר, דחיפות: גבוהה
- "תאורת הרחוב לא עובדת בלילה" → קטגוריה: תאורה, מחלקה: חשמל ותאורה, דחיפות: רגילה  
- "פח זבל מלא מזה שבוע ומסריח" → קטגוריה: זבל, מחלקה: תברואה, דחיפות: רגילה
- "עץ מסוכן שעלול ליפול על הכביש" → קטגוריה: גינון, מחלקה: גינון ונוף, דחיפות: מיידית
- "רכב חונה על המדרכה וחוסם מעבר" → קטגוריה: חניה, מחלקה: פיקוח עירוני, דחיפות: רגילה

רמות דחיפות:
- מיידית: מסכן חיים (עצים מסוכנים, בורות עמוקים, חשמל חשוף)
- גבוהה: פוגע בביטחון או תנועה (תאורה חסרה, מדרכות שבורות)
- רגילה: מטרדים או בעיות שגרתיות (זבל, ניקיון, גינון)

החזר תשובה בפורמט JSON עם השדות הבאים:
- "שם הפונה": אם נמסר בגוף ההודעה (אחרת ריק)
- "קטגוריה": סיווג מדויק מהרשימה למעלה
- "רמת דחיפות": רגילה / גבוהה / מיידית לפי המסוכנות
- "תוכן הפנייה": הטקסט המקורי של הפנייה
- "תאריך ושעה": "${timestamp}"
- "טלפון": מספר הטלפון אם נמסר (אחרת ריק)
- "קישור לתמונה": "${imageUrl || ''}"
- "סוג הפנייה": תלונה / בקשה / מחמאה / אחר
- "מחלקה אחראית": המחלקה המתאימה מהרשימה למעלה
- "סטטוס טיפול": "טרם טופל"
- "הערות": הערות קצרות על הפנייה (למשל: "דורש טיפול מיידי", "בעיה חוזרת")
- "גורם מטפל": ריק (יושלם על ידי הצוות)

הודעה לניתוח: """${message}"""
  `;

  const maxRetries = 3;
  const timeout = 15000 + (retryCount * 5000); // Start with 15s, increase by 5s per retry (max 30s)
  
  try {
    console.log(`🤖 Making request to OpenRouter API... (attempt ${retryCount + 1}/${maxRetries + 1})`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://cityhall-complaints-bot.up.railway.app',
        'X-Title': 'City Hall Complaints Bot'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        max_tokens: 1000,
        temperature: 0.1
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`❌ OpenRouter API error ${response.status}: ${response.statusText}`);
      console.error(`❌ Error details: ${errorText}`);
      
      // Retry on 5xx errors or rate limiting
      if ((response.status >= 500 || response.status === 429) && retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff
        console.log(`⏳ Retrying after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return analyzeComplaint({ message, timestamp, imageUrl }, retryCount + 1);
      }
      
      throw new ExternalServiceError(
        'OpenRouter',
        `API returned ${response.status}`,
        { status: response.status, errorText }
      );
    }

    const data = await response.json();
    console.log('✅ OpenRouter API response received');
    
    // Validate response structure
    if (!data?.choices?.[0]?.message?.content) {
      console.error('❌ Invalid OpenRouter response structure:', data);
      return createFallbackResponse({ message, timestamp, imageUrl });
    }

    const rawText = data.choices[0].message.content.trim();
    console.log('🔍 Raw AI response:', rawText);
    
    // Use robust JSON parsing
    const parseResult = safeJSONParse(rawText);
    
    if (!parseResult.success) {
      console.error('❌ Failed to parse AI response:', parseResult.error);
      
      // Retry on parse errors (AI might have had a temporary issue)
      if (retryCount < maxRetries) {
        const delay = 2000;
        console.log(`⏳ Retrying due to parse error after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return analyzeComplaint({ message, timestamp, imageUrl }, retryCount + 1);
      }
      
      return createFallbackResponse({ message, timestamp, imageUrl });
    }
    
    // Validate the response
    const validation = validateAIResponse(parseResult.data);
    
    if (!validation.valid) {
      console.warn('⚠️ AI response validation issues:', validation.errors);
      // Continue with the response but log the issues
    }
    
    console.log('✅ Successfully parsed and validated AI response');
    
    // Validate and enhance the AI response with smart fallback logic
    const enhancedResponse = validateAndEnhanceResponse(parseResult.data, { message, timestamp, imageUrl });
    
    console.log('🔧 Enhanced AI response:', {
      category: enhancedResponse['קטגוריה'],
      department: enhancedResponse['מחלקה אחראית'], 
      urgency: enhancedResponse['רמת דחיפות'],
      notes: enhancedResponse['הערות']
    });
    
    return enhancedResponse;
    
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`❌ OpenRouter API request timed out after ${timeout/1000} seconds`);
      
      // Retry on timeout
      if (retryCount < maxRetries) {
        const delay = 2000;
        console.log(`⏳ Retrying after timeout (${delay}ms)...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return analyzeComplaint({ message, timestamp, imageUrl }, retryCount + 1);
      }
    } else if (err instanceof ExternalServiceError) {
      // Already logged, just return fallback
    } else {
      console.error('❌ Unexpected error calling OpenRouter API:', err.message);
    }
    
    return createFallbackResponse({ message, timestamp, imageUrl });
  }
}

// Category to department mapping for validation and fallback
const categoryToDepartment = {
  'תאורה': 'חשמל ותאורה',
  'חשמל': 'חשמל ותאורה',
  'מים': 'מחלקת מים', 
  'ביוב': 'מחלקת מים',
  'כבישים': 'מהנדס העיר',
  'מדרכות': 'מהנדס העיר',
  'תשתיות': 'מהנדס העיר',
  'ניקיון': 'תברואה',
  'זבל': 'תברואה',
  'גינון': 'גינון ונוף',
  'פארקים': 'גינון ונוף',
  'חניה': 'פיקוח עירוני',
  'רעש': 'פיקוח עירוני',
  'ביטחון': 'ביטחון ופיקוח',
  'ארנונה': 'גביה',
  'רישוי': 'רישוי'
};

/**
 * Validates and enhances AI response with smart fallback logic
 */
function validateAndEnhanceResponse(aiResponse, { message, timestamp, imageUrl }) {
  const enhanced = { ...aiResponse };
  
  // Ensure all required fields exist
  enhanced['שם הפונה'] = enhanced['שם הפונה'] || '';
  enhanced['טלפון'] = enhanced['טלפון'] || '';
  enhanced['תוכן הפנייה'] = enhanced['תוכן הפנייה'] || message || '';
  enhanced['תאריך ושעה'] = enhanced['תאריך ושעה'] || timestamp || '';
  enhanced['קישור לתמונה'] = enhanced['קישור לתמונה'] || imageUrl || '';
  enhanced['סוג הפנייה'] = enhanced['סוג הפנייה'] || 'תלונה';
  enhanced['סטטוס טיפול'] = enhanced['סטטוס טיפול'] || 'טרם טופל';
  enhanced['הערות'] = enhanced['הערות'] || '';
  enhanced['גורם מטפל'] = enhanced['גורם מטפל'] || '';
  
  // Validate and fix category
  const category = enhanced['קטגוריה'];
  if (!category || !categoryToDepartment[category]) {
    // Try to detect category from message text
    const detectedCategory = detectCategoryFromText(message);
    enhanced['קטגוריה'] = detectedCategory || 'כללי';
  }
  
  // Auto-assign department based on category
  const finalCategory = enhanced['קטגוריה'];
  if (categoryToDepartment[finalCategory]) {
    enhanced['מחלקה אחראית'] = categoryToDepartment[finalCategory];
  } else {
    enhanced['מחלקה אחראית'] = enhanced['מחלקה אחראית'] || 'לא זוהתה';
  }
  
  // Validate urgency level
  const urgency = enhanced['רמת דחיפות'];
  if (!['רגילה', 'גבוהה', 'מיידית'].includes(urgency)) {
    enhanced['רמת דחיפות'] = 'רגילה';
  }
  
  return enhanced;
}

/**
 * Detects category from Hebrew text using keyword matching
 */
function detectCategoryFromText(text) {
  if (!text) return null;
  
  const textLower = text.toLowerCase();
  
  // Keywords for each category
  const categoryKeywords = {
    'תאורה': ['תאורה', 'תאור', 'עמוד', 'נורה', 'פנס', 'חושך', 'אפל'],
    'חשמל': ['חשמל', 'קו חשמל', 'חוט', 'זרם'],
    'מים': ['מים', 'דליפה', 'דולף', 'לחץ מים', 'ברז', 'צינור'],
    'ביוב': ['ביוב', 'ביב', 'סתום', 'ריח', 'הצפה', 'שופכין'],
    'כבישים': ['כביש', 'בור', 'חור', 'אספלט', 'דרך', 'סדק'],
    'מדרכות': ['מדרכה', 'אבן', 'רצפה', 'מדרכ'],
    'ניקיון': ['ניקיון', 'זבל', 'לכלוך', 'זוהמה', 'מלוכלך'],
    'זבל': ['פח זבל', 'פח', 'אשפה', 'זבל', 'איסוף'],
    'גינון': ['עץ', 'עצים', 'ענף', 'גיזום', 'דשא', 'צמח'],
    'פארקים': ['פארק', 'גינה', 'מתקן משחק', 'מתקנים'],
    'חניה': ['חניה', 'חונה', 'רכב', 'מכונית', 'מדרכה חסומה'],
    'רעש': ['רעש', 'רועש', 'שקט', 'הפרעה', 'מוסיקה'],
    'ביטחון': ['ביטחון', 'מסוכן', 'בטיחות', 'אלימות']
  };
  
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (keywords.some(keyword => textLower.includes(keyword))) {
      return category;
    }
  }
  
  return null;
}

// Helper function to create consistent fallback responses
function createFallbackResponse({ message, timestamp, imageUrl }) {
  console.log('🔄 Creating fallback response for failed AI analysis');
  
  const detectedCategory = detectCategoryFromText(message);
  const category = detectedCategory || 'כללי';
  const department = categoryToDepartment[category] || 'לא זוהתה';
  
  return {
    'שם הפונה': '',
    'קטגוריה': category,
    'רמת דחיפות': 'רגילה',
    'תוכן הפנייה': message || '',
    'תאריך ושעה': timestamp || '',
    'טלפון': '',
    'קישור לתמונה': imageUrl || '',
    'סוג הפנייה': 'תלונה',
    'מחלקה אחראית': department,
    'סטטוס טיפול': 'טרם טופל',
    'הערות': 'ניתוח אוטומטי - ללא AI',
    'גורם מטפל': ''
  };
}
