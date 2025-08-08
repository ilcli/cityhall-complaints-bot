/**
 * Validation utilities for webhook payloads and data processing
 */

/**
 * Validates phone number format
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - Whether phone number is valid
 */
export function isValidPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') {
    return false;
  }
  
  // International phone number format (E.164)
  // Allows optional + prefix, followed by country code and number (7-15 total digits)
  const phoneRegex = /^\+?[1-9]\d{6,14}$/;
  return phoneRegex.test(phone);
}

/**
 * Validates URL format and protocol
 * @param {string} url - URL to validate
 * @returns {boolean} - Whether URL is valid
 */
export function isValidUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  try {
    const parsed = new URL(url);
    // Only allow http and https protocols
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Validates timestamp
 * @param {string|number} timestamp - Timestamp to validate
 * @returns {boolean} - Whether timestamp is valid
 */
export function isValidTimestamp(timestamp) {
  const ts = parseInt(timestamp);
  
  if (isNaN(ts)) {
    return false;
  }
  
  // Check if timestamp is within reasonable range
  // Not before year 2020 and not more than 1 day in the future
  const minTimestamp = new Date('2020-01-01').getTime();
  const maxTimestamp = Date.now() + (24 * 60 * 60 * 1000);
  
  return ts >= minTimestamp && ts <= maxTimestamp;
}

/**
 * Validates webhook payload structure
 * @param {object} payload - Webhook payload to validate
 * @returns {{valid: boolean, errors: string[]}} - Validation result
 */
export function validateWebhookPayload(payload) {
  const errors = [];
  
  // Check basic structure
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Invalid payload structure'] };
  }
  
  // Check webhook type
  if (!payload.type) {
    errors.push('Missing webhook type');
  }
  
  // For message webhooks, validate content
  if (payload.type === 'message') {
    const content = payload.payload;
    
    if (!content) {
      errors.push('Missing message content');
    } else {
      // Validate sender
      if (!content.sender?.phone) {
        errors.push('Missing sender phone');
      } else if (!isValidPhoneNumber(content.sender.phone)) {
        errors.push('Invalid phone number format');
      }
      
      // Validate timestamp
      if (!content.timestamp) {
        errors.push('Missing timestamp');
      } else if (!isValidTimestamp(content.timestamp)) {
        errors.push('Invalid timestamp');
      }
      
      // Validate message type
      if (!content.type) {
        errors.push('Missing message type');
      } else if (!['text', 'image'].includes(content.type)) {
        errors.push(`Unsupported message type: ${content.type}`);
      }
      
      // Type-specific validation
      if (content.type === 'text') {
        if (!content.payload?.text && !content.payload) {
          errors.push('Missing text content');
        }
        
        // Check text length
        const text = content.payload?.text || content.payload;
        if (text && text.length > 5000) {
          errors.push('Text content exceeds maximum length (5000 characters)');
        }
      }
      
      if (content.type === 'image') {
        const imageUrl = content.payload?.url;
        if (imageUrl && !isValidUrl(imageUrl)) {
          errors.push('Invalid image URL');
        }
        
        // Check caption length
        const caption = content.payload?.caption;
        if (caption && caption.length > 1000) {
          errors.push('Image caption exceeds maximum length (1000 characters)');
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Sanitizes text for safe storage and display
 * @param {string} text - Text to sanitize
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} - Sanitized text
 */
export function sanitizeText(text, maxLength = 5000) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  return text
    // Remove control characters except newlines and tabs
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Limit length
    .substring(0, maxLength)
    // Trim whitespace
    .trim();
}

/**
 * Sanitizes data for Google Sheets to prevent formula injection
 * @param {string} value - Value to sanitize
 * @returns {string} - Sanitized value
 */
export function sanitizeForSheets(value) {
  if (typeof value !== 'string') {
    return value;
  }
  
  // Prevent formula injection by escaping special characters at start
  if (/^[=+\-@]/.test(value)) {
    value = "'" + value;
  }
  
  // Remove control characters
  value = value.replace(/[\x00-\x1f\x7f-\x9f]/g, '');
  
  // Limit to Excel cell maximum (32767 characters)
  return value.substring(0, 32767);
}

/**
 * Generates a unique message ID for deduplication
 * @param {object} message - Message object
 * @returns {string} - Unique message ID
 */
export function generateMessageId(message) {
  const components = [
    message.sender?.phone || 'unknown',
    message.timestamp || Date.now(),
    message.type || 'unknown',
    message.id || Math.random()
  ];
  
  return components.join('-');
}