/**
 * Integration tests for City Hall Complaints Bot
 * Run with: npm test
 */

import assert from 'assert';
import crypto from 'crypto';
import { 
  validateWebhookPayload, 
  isValidPhoneNumber, 
  isValidUrl,
  isValidTimestamp,
  sanitizeText,
  sanitizeForSheets
} from '../utils/validation.js';
import { 
  extractJSON, 
  safeJSONParse, 
  validateAIResponse 
} from '../utils/jsonParser.js';
import { verifyWebhookSignature } from '../middleware/security.js';
import messageStore from '../utils/messageStore.js';

console.log('🧪 Running City Hall Complaints Bot Tests...\n');

// Test webhook signature verification
function testWebhookSignature() {
  console.log('Testing webhook signature verification...');
  
  const secret = 'test-secret-key';
  const payload = JSON.stringify({ test: 'data' });
  const correctSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  // Test valid signature
  assert.strictEqual(
    verifyWebhookSignature(payload, correctSignature, secret),
    true,
    'Valid signature should pass'
  );
  
  // Test invalid signature
  assert.strictEqual(
    verifyWebhookSignature(payload, 'invalid-signature', secret),
    false,
    'Invalid signature should fail'
  );
  
  // Test missing signature
  assert.strictEqual(
    verifyWebhookSignature(payload, '', secret),
    false,
    'Empty signature should fail'
  );
  
  console.log('✅ Webhook signature tests passed\n');
}

// Test phone number validation
function testPhoneValidation() {
  console.log('Testing phone number validation...');
  
  // Valid phone numbers
  assert.strictEqual(isValidPhoneNumber('+972501234567'), true, 'Israeli number should be valid');
  assert.strictEqual(isValidPhoneNumber('972501234567'), true, 'Number without + should be valid');
  assert.strictEqual(isValidPhoneNumber('+14155552671'), true, 'US number should be valid');
  
  // Invalid phone numbers
  assert.strictEqual(isValidPhoneNumber(''), false, 'Empty string should be invalid');
  assert.strictEqual(isValidPhoneNumber('abc'), false, 'Letters should be invalid');
  assert.strictEqual(isValidPhoneNumber('123'), false, 'Too short should be invalid');
  assert.strictEqual(isValidPhoneNumber('+1234567890123456'), false, 'Too long should be invalid');
  
  console.log('✅ Phone validation tests passed\n');
}

// Test URL validation
function testUrlValidation() {
  console.log('Testing URL validation...');
  
  // Valid URLs
  assert.strictEqual(isValidUrl('https://example.com'), true, 'HTTPS URL should be valid');
  assert.strictEqual(isValidUrl('http://example.com'), true, 'HTTP URL should be valid');
  assert.strictEqual(isValidUrl('https://example.com/path?query=value'), true, 'URL with path should be valid');
  
  // Invalid URLs
  assert.strictEqual(isValidUrl(''), false, 'Empty string should be invalid');
  assert.strictEqual(isValidUrl('not-a-url'), false, 'Plain text should be invalid');
  assert.strictEqual(isValidUrl('ftp://example.com'), false, 'FTP protocol should be invalid');
  assert.strictEqual(isValidUrl('javascript:alert(1)'), false, 'JavaScript protocol should be invalid');
  
  console.log('✅ URL validation tests passed\n');
}

// Test webhook payload validation
function testPayloadValidation() {
  console.log('Testing webhook payload validation...');
  
  // Valid text message payload
  const validTextPayload = {
    type: 'message',
    payload: {
      type: 'text',
      payload: { text: 'Test message' },
      sender: { phone: '+972501234567' },
      timestamp: Date.now().toString()
    }
  };
  
  let result = validateWebhookPayload(validTextPayload);
  assert.strictEqual(result.valid, true, 'Valid text payload should pass');
  assert.strictEqual(result.errors.length, 0, 'Valid payload should have no errors');
  
  // Valid image message payload
  const validImagePayload = {
    type: 'message',
    payload: {
      type: 'image',
      payload: { 
        url: 'https://example.com/image.jpg',
        caption: 'Test caption'
      },
      sender: { phone: '+972501234567' },
      timestamp: Date.now().toString()
    }
  };
  
  result = validateWebhookPayload(validImagePayload);
  assert.strictEqual(result.valid, true, 'Valid image payload should pass');
  
  // Invalid payload - missing sender
  const invalidPayload = {
    type: 'message',
    payload: {
      type: 'text',
      payload: { text: 'Test' },
      timestamp: Date.now().toString()
    }
  };
  
  result = validateWebhookPayload(invalidPayload);
  assert.strictEqual(result.valid, false, 'Payload without sender should fail');
  assert(result.errors.includes('Missing sender phone'), 'Should report missing sender');
  
  console.log('✅ Payload validation tests passed\n');
}

// Test JSON extraction
function testJsonExtraction() {
  console.log('Testing JSON extraction...');
  
  // Test simple JSON extraction
  const text1 = 'Some text before {"key": "value"} and after';
  const extracted1 = extractJSON(text1);
  assert.strictEqual(extracted1, '{"key": "value"}', 'Should extract simple JSON');
  
  // Test nested JSON
  const text2 = 'Text {"outer": {"inner": "value"}} more text';
  const extracted2 = extractJSON(text2);
  assert.strictEqual(extracted2, '{"outer": {"inner": "value"}}', 'Should extract nested JSON');
  
  // Test JSON with escaped quotes
  const text3 = 'Before {"text": "He said \\"hello\\""} after';
  const extracted3 = extractJSON(text3);
  assert.strictEqual(extracted3, '{"text": "He said \\"hello\\""}', 'Should handle escaped quotes');
  
  // Test no JSON
  const text4 = 'No JSON here';
  const extracted4 = extractJSON(text4);
  assert.strictEqual(extracted4, null, 'Should return null when no JSON');
  
  console.log('✅ JSON extraction tests passed\n');
}

// Test JSON parsing
function testJsonParsing() {
  console.log('Testing safe JSON parsing...');
  
  // Test direct JSON
  let result = safeJSONParse('{"key": "value"}');
  assert.strictEqual(result.success, true, 'Direct JSON should parse');
  assert.deepStrictEqual(result.data, {key: 'value'}, 'Should return correct data');
  
  // Test JSON with extra text
  result = safeJSONParse('Response: {"key": "value"} Done');
  assert.strictEqual(result.success, true, 'Should extract and parse JSON');
  assert.deepStrictEqual(result.data, {key: 'value'}, 'Should return correct extracted data');
  
  // Test invalid JSON
  result = safeJSONParse('Not JSON');
  assert.strictEqual(result.success, false, 'Invalid JSON should fail');
  assert(result.error, 'Should provide error message');
  
  console.log('✅ JSON parsing tests passed\n');
}

// Test AI response validation
function testAiResponseValidation() {
  console.log('Testing AI response validation...');
  
  // Valid response
  const validResponse = {
    'שם הפונה': 'יוסי כהן',
    'קטגוריה': 'תאורה',
    'רמת דחיפות': 'גבוהה',
    'תוכן הפנייה': 'פנס שבור',
    'סוג הפנייה': 'תלונה'
  };
  
  let result = validateAIResponse(validResponse);
  assert.strictEqual(result.valid, true, 'Valid response should pass');
  
  // Invalid urgency level
  const invalidUrgency = {
    ...validResponse,
    'רמת דחיפות': 'invalid'
  };
  
  result = validateAIResponse(invalidUrgency);
  assert.strictEqual(result.valid, false, 'Invalid urgency should fail');
  
  // Too few fields
  const tooFewFields = {
    'קטגוריה': 'תאורה'
  };
  
  result = validateAIResponse(tooFewFields);
  assert.strictEqual(result.valid, false, 'Too few fields should fail');
  
  console.log('✅ AI response validation tests passed\n');
}

// Test text sanitization
function testSanitization() {
  console.log('Testing text sanitization...');
  
  // Test control character removal
  const textWithControl = 'Hello\x00World\x1F';
  assert.strictEqual(sanitizeText(textWithControl), 'HelloWorld', 'Should remove control characters');
  
  // Test length limiting
  const longText = 'a'.repeat(6000);
  assert.strictEqual(sanitizeText(longText).length, 5000, 'Should limit to 5000 chars');
  
  // Test sheet sanitization
  assert.strictEqual(sanitizeForSheets('=FORMULA()'), "'=FORMULA()", 'Should escape formulas');
  assert.strictEqual(sanitizeForSheets('+1234'), "'+1234", 'Should escape plus sign');
  assert.strictEqual(sanitizeForSheets('Normal text'), 'Normal text', 'Should not modify normal text');
  
  console.log('✅ Sanitization tests passed\n');
}

// Test message store
function testMessageStore() {
  console.log('Testing message store...');
  
  // Clear store for testing
  messageStore.clear();
  
  // Test message storage and retrieval
  const sender = '+972501234567';
  const message = 'Test message';
  const timestamp = Date.now();
  
  messageStore.storeMessage(sender, message, timestamp);
  
  // Should retrieve within time window
  const retrieved = messageStore.getRecentMessage(sender, timestamp + 30000);
  assert.strictEqual(retrieved, message, 'Should retrieve recent message');
  
  // Should not retrieve outside time window
  const notRetrieved = messageStore.getRecentMessage(sender, timestamp + 70000);
  assert.strictEqual(notRetrieved, null, 'Should not retrieve old message');
  
  // Test deduplication
  const messageId = 'test-message-123';
  assert.strictEqual(messageStore.isProcessed(messageId), false, 'New message should not be processed');
  
  messageStore.markProcessed(messageId);
  assert.strictEqual(messageStore.isProcessed(messageId), true, 'Marked message should be processed');
  
  console.log('✅ Message store tests passed\n');
}

// Test timestamp validation
function testTimestampValidation() {
  console.log('Testing timestamp validation...');
  
  // Valid timestamps
  assert.strictEqual(isValidTimestamp(Date.now().toString()), true, 'Current timestamp should be valid');
  assert.strictEqual(isValidTimestamp('1609459200000'), true, 'Past timestamp should be valid');
  
  // Invalid timestamps
  assert.strictEqual(isValidTimestamp('not-a-number'), false, 'Non-numeric should be invalid');
  assert.strictEqual(isValidTimestamp('1000000000000000'), false, 'Far future should be invalid');
  assert.strictEqual(isValidTimestamp('1000000000'), false, 'Too old should be invalid');
  
  console.log('✅ Timestamp validation tests passed\n');
}

// Run all tests
function runAllTests() {
  try {
    testWebhookSignature();
    testPhoneValidation();
    testUrlValidation();
    testPayloadValidation();
    testJsonExtraction();
    testJsonParsing();
    testAiResponseValidation();
    testSanitization();
    testMessageStore();
    testTimestampValidation();
    
    console.log('🎉 All tests passed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runAllTests();