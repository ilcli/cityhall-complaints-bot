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

🔍 זיהוי שם הפונה - חשוב מאוד:
רוב ההודעות בעברית מסתיימות עם חתימת השולח. חפש שמות פרטיים ומשפחה בסוף ההודעה.

דוגמאות נכונות לזיהוי שם:
- "...כל התושבים סובלים, מושיקו טורינו" → שם: "מושיקו טורינו"
- "...זה בעיה רצינית, שרה כהן" → שם: "שרה כהן"
- "...צריך לטפל בזה בדחיפות דודו לוי" → שם: "דודו לוי"

❌ אל תזהה כשמות:
- מילות שלילה: לא, אין, לא מצליח, don't, can't
- מילים נפוצות: אני, אתה, זה, כל, הם
- פעלים ותארים: רוצה, חושב, גדול, קטן

💡 כלל זהב: אם יש שני מילים עבריות שנראות כמו שם פרטי + משפחה בסוף ההודעה, זה כנראה השם האמיתי.

החזר תשובה בפורמט JSON עם השדות הבאים:
- "שם הפונה": השם האמיתי מסוף ההודעה (או ריק אם לא מזוהה)
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
  
  // Smart name extraction - try AI first, then fallback to pattern matching
  let detectedName = enhanced['שם הפונה'] || '';
  
  // Check if AI found a suspicious name (common Hebrew verbs/words that aren't names)
  const suspiciousWords = [
    // Negations
    'לא', 'אין', 'don\'t', 'can\'t', 'won\'t',
    // Pronouns
    'אני', 'אתה', 'את', 'הוא', 'היא',
    // Common verbs that follow "אני" (I am...)
    'מתגורר', 'גר', 'גרה', 'מתגוררת', // living/residing
    'עובד', 'עובדת', 'עושה', // working/doing  
    'רוצה', 'רוצי', 'צריך', 'צריכה', // wanting/needing
    'אוהב', 'אוהבת', 'מחפש', 'מחפשת', // loving/searching
    'כותב', 'כותבת', 'שולח', 'שולחת', // writing/sending
    'מבקש', 'מבקשת', 'פונה', 'פונית', // requesting/turning to
    'מדווח', 'מדווחת', 'מתלונן', 'מתלוננת', // reporting/complaining
    // Common descriptive words
    'תושב', 'תושבת', 'אזרח', 'אזרחית', // resident/citizen
    'בעל', 'בעלת', 'בן', 'בת' // owner/son/daughter
  ];
  
  // Clean the detected name more thoroughly (remove punctuation, prefixes)
  const cleanedName = detectedName.toLowerCase().trim()
    .replace(/^ה/, '')  // Remove Hebrew definite article prefix
    .replace(/[.,!?;:'"()[\]{}]/g, '')  // Remove common punctuation
    .trim();
  
  const isSuspicious = suspiciousWords.some(word => 
    cleanedName === word.toLowerCase()
  );
  
  // If AI didn't find a name or found a suspicious one, use backup extraction
  if (!detectedName || isSuspicious) {
    
    console.log(`🔍 AI name detection failed or suspicious ("${detectedName}"), trying backup extraction...`);
    const backupName = extractHebrewNameFromMessage(message);
    if (backupName) {
      detectedName = backupName;
      console.log(`✅ Backup name extraction found: "${backupName}"`);
    } else {
      detectedName = '';
      console.log(`⚠️ No name detected by backup extraction either`);
    }
  }
  
  // Ensure all required fields exist
  enhanced['שם הפונה'] = detectedName;
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
 * Extracts Hebrew names from end of message using intelligent pattern matching
 */
function extractHebrewNameFromMessage(text) {
  if (!text) return null;
  
  console.log(`🔍 Extracting Hebrew name from: "${text}"`);
  
  // First, try to find names after common Hebrew signature patterns
  const signaturePatterns = [
    'תודה רבה,',    // Thank you very much,
    'תודה רבה',     // Thank you very much
    'בברכה,',       // With regards,
    'בברכה',        // With regards  
    'לכבוד,',       // Respectfully,
    'לכבוד',        // Respectfully
    'בתודה,',       // With thanks,
    'בתודה'         // With thanks
  ];
  
  // Look for signature patterns and extract names following them
  for (const pattern of signaturePatterns) {
    const patternIndex = text.lastIndexOf(pattern);
    if (patternIndex !== -1) {
      const afterPattern = text.substring(patternIndex + pattern.length).trim();
      console.log(`🎯 Found signature pattern "${pattern}", text after: "${afterPattern}"`);
      
      const extractedName = extractNameFromSegment(afterPattern);
      if (extractedName) {
        console.log(`✅ Extracted name after signature pattern: "${extractedName}"`);
        return extractedName;
      }
    }
  }
  
  // Fallback: Split text by punctuation and check segments
  const segments = text.split(/[.!?;,\n\r]+/).map(s => s.trim()).filter(s => s.length > 0);
  console.log(`📋 Analyzing ${segments.length} text segments:`, segments);
  
  // Check the last few segments for potential names
  const lastSegments = segments.slice(-3);
  
  for (const segment of lastSegments.reverse()) {
    const extractedName = extractNameFromSegment(segment);
    if (extractedName) {
      console.log(`✅ Extracted name from segment "${segment}": "${extractedName}"`);
      return extractedName;
    }
  }
  
  console.log(`❌ No Hebrew name found in message`);
  return null;
}

/**
 * Helper function to extract name from a text segment
 */
function extractNameFromSegment(segment) {
  if (!segment || segment.length < 2) return null;
  
  console.log(`🔍 Analyzing segment: "${segment}"`);
  
  // Clean the segment and split into words
  const words = segment.split(/\s+/).map(word => word.trim()).filter(word => word.length > 0);
  
  // Common Hebrew words to ignore (not names)
  const stopWords = [
    // Pronouns
    'אני', 'אתה', 'את', 'הוא', 'היא', 'אנחנו', 'אתם', 'אתן', 'הם', 'הן',
    // Question words
    'זה', 'זאת', 'זו', 'אלה', 'כל', 'כמה', 'מה', 'איפה', 'מתי', 'איך',
    // Common words
    'לא', 'אין', 'כן', 'גם', 'רק', 'עוד', 'כבר', 'עדיין', 'בבקשה',
    'שלום', 'הי', 'חברים', 'תושבים', 'סובלים', 'מצליח', 'אמור', 'אומר',
    // Common verbs that follow "אני" (I am...)
    'מתגורר', 'גר', 'גרה', 'מתגוררת', // living/residing
    'עובד', 'עובדת', 'עושה', // working/doing  
    'רוצה', 'רוצי', 'צריך', 'צריכה', // wanting/needing
    'אוהב', 'אוהבת', 'מחפש', 'מחפשת', // loving/searching
    'כותב', 'כותבת', 'שולח', 'שולחת', // writing/sending
    'מבקש', 'מבקשת', 'פונה', 'פונית', // requesting/turning to
    'מדווח', 'מדווחת', 'מתלונן', 'מתלוננת', // reporting/complaining
    // Descriptive words
    'תושב', 'תושבת', 'אזרח', 'אזרחית', // resident/citizen
    'בעל', 'בעלת', 'בן', 'בת' // owner/son/daughter
  ];
  
  // Try different combinations of the first few words, preferring longer names
  let bestCandidate = null;
  
  for (let wordCount = Math.min(3, words.length); wordCount >= 1; wordCount--) {
    const candidateWords = words.slice(0, wordCount);
    
    // Clean each word: remove numbers and punctuation while preserving Hebrew
    const cleanedWords = candidateWords.map(word => {
      // Remove phone numbers and other attachments (numbers, hyphens, etc.)
      return word.replace(/[0-9\-()]+$/g, '').replace(/[.!?,;:]+$/g, '').trim();
    }).filter(word => word.length >= 2);
    
    if (cleanedWords.length === 0) continue;
    
    const candidateName = cleanedWords.join(' ').trim();
    console.log(`🧐 Testing candidate: "${candidateName}"`);
    
    // Skip if contains stop words (match whole words only)
    const nameWords = candidateName.split(/\s+/);
    const hasStopWord = nameWords.some(nameWord => 
      stopWords.some(stopWord => nameWord.toLowerCase() === stopWord.toLowerCase())
    );
    if (hasStopWord) {
      console.log(`❌ Contains stop word, skipping`);
      continue;
    }
    
    // Check if it's mostly Hebrew characters
    const hebrewChars = (candidateName.match(/[\u0590-\u05FF]/g) || []).length;
    const totalChars = candidateName.replace(/\s/g, '').length;
    const hebrewRatio = totalChars > 0 ? hebrewChars / totalChars : 0;
    
    console.log(`📊 Hebrew ratio: ${hebrewRatio} (${hebrewChars}/${totalChars})`);
    
    if (hebrewRatio > 0.8 && totalChars >= 2) {
      // Validate name structure
      const nameWords = candidateName.split(/\s+/).filter(w => w.length > 0);
      
      if (nameWords.length >= 1 && nameWords.length <= 3 && 
          nameWords.every(word => word.length >= 2 && word.length <= 20)) {
        
        // Additional validation: avoid common verb/noun endings that indicate it's not a name
        const commonEndings = ['ים', 'ות', 'תי', 'נו', 'תם', 'יש'];
        const hasCommonEnding = commonEndings.some(ending => 
          nameWords.some(word => word.endsWith(ending) && word.length > ending.length + 2)
        );
        
        if (!hasCommonEnding) {
          console.log(`✅ Valid Hebrew name found: "${candidateName}"`);
          bestCandidate = candidateName;
          // Don't return immediately - check if there's a longer valid name
          // Only return the longer name if we found one
          if (nameWords.length > 1) {
            return candidateName;
          }
        } else {
          console.log(`❌ Has common verb/noun ending, likely not a name`);
        }
      } else {
        console.log(`❌ Invalid name structure`);
      }
    } else {
      console.log(`❌ Insufficient Hebrew characters`);
    }
  }
  
  return bestCandidate;
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
  
  // Try to extract name even in fallback
  const detectedName = extractHebrewNameFromMessage(message);
  if (detectedName) {
    console.log(`🔍 Fallback name extraction found: "${detectedName}"`);
  }
  
  return {
    'שם הפונה': detectedName || '',
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
