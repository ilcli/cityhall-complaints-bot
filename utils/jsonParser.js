/**
 * Robust JSON parsing utilities for AI responses
 */

/**
 * Extracts JSON from text that may contain additional content
 * @param {string} text - Text potentially containing JSON
 * @returns {string|null} - Extracted JSON string or null
 */
export function extractJSON(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  
  // Try to find JSON object boundaries with proper brace counting
  const jsonStart = text.indexOf('{');
  if (jsonStart === -1) {
    return null;
  }
  
  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let jsonEnd = -1;
  
  for (let i = jsonStart; i < text.length; i++) {
    const char = text[i];
    
    // Handle escape sequences
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    // Handle string boundaries
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    // Only count braces outside of strings
    if (!inString) {
      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        
        // Found matching closing brace
        if (braceCount === 0) {
          jsonEnd = i;
          break;
        }
      }
    }
  }
  
  if (jsonEnd === -1) {
    return null;
  }
  
  return text.substring(jsonStart, jsonEnd + 1);
}

/**
 * Safely parses JSON with fallback options
 * @param {string} text - Text to parse
 * @returns {{success: boolean, data: any, error: string|null}} - Parse result
 */
export function safeJSONParse(text) {
  if (!text) {
    return {
      success: false,
      data: null,
      error: 'Empty input'
    };
  }
  
  // First try direct parsing
  try {
    const parsed = JSON.parse(text);
    return {
      success: true,
      data: parsed,
      error: null
    };
  } catch (directError) {
    // Try extracting JSON from text
    const extracted = extractJSON(text);
    
    if (!extracted) {
      return {
        success: false,
        data: null,
        error: 'No valid JSON found in text'
      };
    }
    
    try {
      const parsed = JSON.parse(extracted);
      return {
        success: true,
        data: parsed,
        error: null
      };
    } catch (extractError) {
      return {
        success: false,
        data: null,
        error: `Failed to parse extracted JSON: ${extractError.message}`
      };
    }
  }
}

/**
 * Validates AI response against expected schema
 * @param {object} data - Parsed JSON data
 * @returns {{valid: boolean, errors: string[]}} - Validation result
 */
export function validateAIResponse(data) {
  const errors = [];
  
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errors: ['Response is not an object']
    };
  }
  
  // Expected fields for complaint analysis
  const expectedFields = [
    'שם הפונה',
    'קטגוריה',
    'רמת דחיפות',
    'תוכן הפנייה',
    'תאריך ושעה',
    'טלפון',
    'קישור לתמונה',
    'סוג הפנייה',
    'מחלקה אחראית'
  ];
  
  // Check for presence of expected fields (not all required)
  const presentFields = expectedFields.filter(field => field in data);
  
  if (presentFields.length < 5) {
    errors.push(`Response missing too many expected fields. Found: ${presentFields.length}/9`);
  }
  
  // Validate field types and values
  if (data['רמת דחיפות'] && !['רגילה', 'גבוהה', 'מיידית'].includes(data['רמת דחיפות'])) {
    errors.push(`Invalid urgency level: ${data['רמת דחיפות']}`);
  }
  
  if (data['סוג הפנייה'] && !['תלונה', 'בקשה', 'מחמאה', 'אחר'].includes(data['סוג הפנייה'])) {
    errors.push(`Invalid complaint type: ${data['סוג הפנייה']}`);
  }
  
  // Check for extremely long values that might cause issues
  for (const [field, value] of Object.entries(data)) {
    if (typeof value === 'string' && value.length > 10000) {
      errors.push(`Field "${field}" exceeds maximum length`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Merges AI response with default values
 * @param {object} aiResponse - AI response data
 * @param {object} defaults - Default values
 * @returns {object} - Merged data
 */
export function mergeWithDefaults(aiResponse, defaults) {
  const merged = { ...defaults };
  
  if (!aiResponse || typeof aiResponse !== 'object') {
    return merged;
  }
  
  // Only merge valid string values
  for (const [key, value] of Object.entries(aiResponse)) {
    if (value !== null && value !== undefined) {
      // Convert to string and trim
      const stringValue = String(value).trim();
      
      // Only set if not empty
      if (stringValue) {
        merged[key] = stringValue;
      }
    }
  }
  
  return merged;
}