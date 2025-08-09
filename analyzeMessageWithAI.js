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
תמונה: ${imageUrl || 'אין'}
תאריך ושעה: ${timestamp}
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
    
    // Merge with defaults to ensure all fields exist
    const defaults = createFallbackResponse({ message, timestamp, imageUrl });
    return mergeWithDefaults(parseResult.data, defaults);
    
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

// Helper function to create consistent fallback responses
function createFallbackResponse({ message, timestamp, imageUrl }) {
  console.log('🔄 Creating fallback response for failed AI analysis');
  return {
    'שם הפונה': '',
    'קטגוריה': 'כללי',
    'רמת דחיפות': 'רגילה',
    'תוכן הפנייה': message || '',
    'תאריך ושעה': timestamp || '',
    'טלפון': '',
    'קישור לתמונה': imageUrl || '',
    'סוג הפנייה': 'אחר',
    'מחלקה אחראית': 'לא זוהתה'
  };
}
