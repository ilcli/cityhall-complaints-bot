import dotenv from 'dotenv';

// Load environment variables first
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import { DateTime } from 'luxon';

import fetch from 'node-fetch';
import { analyzeComplaint } from './analyzeMessageWithAI.js';
import { appendToSheet, initializeDashboardSheet, updateDashboardStats, recreateDashboard } from './googleSheets.js';
import { webhookAuthMiddleware, captureRawBody } from './middleware/security.js';
import { rateLimitMiddleware } from './middleware/rateLimiter.js';
import { validateWebhookPayload, generateMessageId, sanitizeText, sanitizeForSheets } from './utils/validation.js';
import messageStore from './utils/messageStore.js';
import { errorHandler, asyncHandler, ValidationError, ConfigurationError } from './utils/errors.js';

// Bot performance tracking
let performanceStats = {
  totalProcessed: 0,
  successfulAnalyses: 0,
  failedAnalyses: 0,
  avgResponseTime: 0,
  responseTimes: [],
  lastUpdated: new Date()
};

/**
 * Retrieves media URL from Meta WhatsApp Business API
 * @param {string} mediaId - Media ID from WhatsApp
 * @returns {string|null} - Media URL or null if failed
 */
async function getMediaUrlFromMeta(mediaId) {
  if (!mediaId) {
    console.warn('⚠️ No media ID provided to getMediaUrlFromMeta');
    return null;
  }
  
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!accessToken) {
    console.error('❌ META_ACCESS_TOKEN not configured - cannot retrieve WhatsApp media URLs from Meta API');
    console.error('   Please add META_ACCESS_TOKEN to your Railway environment variables');
    console.error('   Get it from: https://developers.facebook.com/apps/your-app/whatsapp-business/wa-dev-console/');
    return null;
  }
  
  try {
    console.log(`🔍 Retrieving media URL for Meta Media ID: ${mediaId}`);
    
    // First, get media info from Meta API
    const mediaInfoResponse = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    
    if (!mediaInfoResponse.ok) {
      const errorText = await mediaInfoResponse.text();
      console.error(`❌ Meta Media API error (${mediaInfoResponse.status}): ${errorText}`);
      return null;
    }
    
    const mediaInfo = await mediaInfoResponse.json();
    console.log(`📄 Meta media info:`, JSON.stringify(mediaInfo, null, 2));
    
    if (!mediaInfo.url) {
      console.error(`❌ No URL in Meta media info response`);
      return null;
    }
    
    // The media URL is directly available in the media info
    const mediaUrl = mediaInfo.url;
    console.log(`✅ Retrieved Meta media URL: ${mediaUrl}`);
    
    return mediaUrl;
    
  } catch (error) {
    console.error('❌ Failed to retrieve media URL:', error.message);
    return null;
  }
}

// Validate required environment variables at startup
function validateEnvironment() {
  const required = ['OPENROUTER_API_KEY', 'SHEET_ID', 'SERVICE_ACCOUNT_JSON'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new ConfigurationError(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Warn about optional but recommended variables
  if (!process.env.WEBHOOK_SECRET) {
    console.warn('⚠️ WEBHOOK_SECRET not configured - webhook authentication disabled');
  }
  
  if (!process.env.META_ACCESS_TOKEN) {
    console.warn('⚠️ META_ACCESS_TOKEN not configured - WhatsApp media URLs cannot be retrieved');
  }
}

// Validate environment on startup (non-fatal in production)
try {
  validateEnvironment();
} catch (error) {
  console.error('❌ Configuration error:', error.message);
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  } else {
    console.warn('⚠️ Starting with incomplete configuration - some features may not work');
  }
}

const app = express();
const PORT = process.env.PORT || 8080;

// Configure body parser with raw body capture for signature verification
app.use(bodyParser.json({ 
  limit: '2mb',
  verify: captureRawBody
}));

// Apply security middleware if webhook secret is configured
if (process.env.WEBHOOK_SECRET) {
  app.use('/webhook', webhookAuthMiddleware);
}

// Apply rate limiting
app.use('/webhook', rateLimitMiddleware);

app.post('/webhook', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Log the raw body first in case JSON parsing fails
    console.log('📨 Raw webhook body type:', typeof req.body);
    console.log('📨 Raw webhook body length:', JSON.stringify(req.body).length);
    
    let parsedBody;
    try {
      // Safely log the parsed JSON
      parsedBody = req.body;
      console.log('📨 Webhook received (parsed):', JSON.stringify(parsedBody, null, 2));
    } catch (jsonError) {
      console.error('❌ JSON parsing failed:', jsonError.message);
      console.log('📨 Raw webhook body as string:', JSON.stringify(req.body));
      console.log('📨 Raw webhook body keys:', Object.keys(req.body || {}));
      
      // Try to extract whatever we can from the malformed JSON
      if (typeof req.body === 'string') {
        console.log('📨 Body is string, attempting to parse...');
        try {
          parsedBody = JSON.parse(req.body);
        } catch (stringParseError) {
          console.error('❌ Failed to parse string body:', stringParseError.message);
          return res.status(400).json({ error: 'Malformed JSON payload' });
        }
      } else {
        parsedBody = req.body;
      }
    }
    
    // Auto-detect webhook source and parse accordingly
    const { messageData, source } = parseWebhookPayload(parsedBody);
    
    if (!messageData) {
      console.log('⚠️ No valid message data found in webhook');
      return res.status(200).send('No message data');
    }

    const { messageType, sender, timestampMs, messagePayload, messageId } = messageData;
    
    // Check for duplicates
    if (messageStore.isProcessed(messageId)) {
      console.log(`⚠️ Duplicate message ignored: ${messageId}`);
      return res.status(200).send('Duplicate');
    }
    messageStore.markProcessed(messageId);

    // Format timestamp
    const timestamp = DateTime.fromMillis(timestampMs)
      .setZone('Asia/Jerusalem')
      .toFormat('HH:mm dd-MM-yy');

    // Extract message content with intelligent pairing
    const messageContent = await processMessageWithContext(messageType, messagePayload, sender, timestampMs);
    const { messageText, imageUrl, confidence } = messageContent;
    
    console.log(`📋 Message processing result: text="${messageText.substring(0, 100)}...", image=${!!imageUrl}, confidence=${confidence}`);

    // Extract phone numbers and names from message text
    const extractedInfo = extractContactInfo(messageText);
    console.log(`📋 Extracted contact info:`, extractedInfo);

    // AI analysis
    console.log(`🤖 Analyzing complaint with message: "${messageText}" and imageUrl: "${imageUrl}"`);
    const analysis = await analyzeComplaint({ message: messageText, timestamp, imageUrl });
    console.log(`🤖 AI analysis result:`, analysis);

    // Prioritize extracted info over sender data and AI analysis
    const finalName = extractedInfo.name || analysis['שם הפונה'] || '';
    const finalPhone = extractedInfo.phone || formatIsraeliPhoneNumber(sender);

    // Prepare row for Google Sheets
    const row = {
      'שם הפונה': sanitizeForSheets(finalName),
      'קטגוריה': sanitizeForSheets(analysis['קטגוריה'] || ''),
      'רמת דחיפות': sanitizeForSheets(analysis['רמת דחיפות'] || ''),
      'תוכן הפנייה': sanitizeForSheets(analysis['תוכן הפנייה'] || messageText),
      'תאריך ושעה': timestamp,
      'טלפון': finalPhone,
      'קישור לתמונה': imageUrl || '',
      'סוג הפנייה': sanitizeForSheets(analysis['סוג הפנייה'] || ''),
      'מחלקה אחראית': sanitizeForSheets(analysis['מחלקה אחראית'] || ''),
      'source': `${source}:${confidence}`,
    };

    // Log specific image URL status before sending to sheet
    if (imageUrl) {
      console.log(`🖼️ Image URL will be stored in sheet: ${imageUrl}`);
    } else {
      console.log(`⚠️ No image URL available for storage`);
    }
    
    console.log(`📝 Row data to be sent to sheet:`, row);
    
    // Add performance stats for dashboard update
    const successRate = performanceStats.totalProcessed > 0 
      ? Math.round((performanceStats.successfulAnalyses / performanceStats.totalProcessed) * 100)
      : 0;
    
    row.performanceStats = {
      totalProcessed: performanceStats.totalProcessed + 1, // +1 for current message
      successRate,
      avgResponseTime: performanceStats.avgResponseTime
    };
    
    await appendToSheet(row);
    console.log(`✅ Complaint from ${sender} logged with type: ${messageType} (source: ${source})`);
    
    // Track performance metrics
    const processingTime = Date.now() - startTime;
    performanceStats.totalProcessed++;
    performanceStats.responseTimes.push(processingTime);
    
    // Keep only last 100 response times for average calculation
    if (performanceStats.responseTimes.length > 100) {
      performanceStats.responseTimes = performanceStats.responseTimes.slice(-100);
    }
    
    performanceStats.avgResponseTime = Math.round(
      performanceStats.responseTimes.reduce((a, b) => a + b, 0) / performanceStats.responseTimes.length
    );
    
    performanceStats.successfulAnalyses++;
    performanceStats.lastUpdated = new Date();
    
    console.log(`⚡ Processing time: ${processingTime}ms | Total processed: ${performanceStats.totalProcessed}`);
    
    return res.status(200).json({ 
      status: 'success', 
      messageId,
      processingTime: `${processingTime}ms`
    });

  } catch (error) {
    console.error('❌ Webhook error:', error);
    
    // Track failed analyses
    performanceStats.failedAnalyses++;
    performanceStats.totalProcessed++;
    performanceStats.lastUpdated = new Date();
    
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to parse webhook payload from different sources
function parseWebhookPayload(body) {
  try {
    // Check if this is Meta WhatsApp Business API format
    if (body.entry && Array.isArray(body.entry) && body.entry[0]?.changes) {
      const entry = body.entry[0];
      
      if (!Array.isArray(entry.changes) || entry.changes.length === 0) {
        console.log('⚠️ Meta webhook: no changes array found');
        return { messageData: null, source: 'whatsapp' };
      }
      
      const change = entry.changes[0];
      
      // Check for errors in the webhook
      if (change?.value?.errors) {
        console.log('❌ Meta webhook contains errors:', JSON.stringify(change.value.errors, null, 2));
        return { messageData: null, source: 'whatsapp' };
      }
      
      // Check for status updates (not messages)
      if (change?.value?.statuses) {
        console.log('📊 Meta webhook status update:', JSON.stringify(change.value.statuses, null, 2));
        return { messageData: null, source: 'whatsapp' };
      }
      
      if (change?.value?.messages && Array.isArray(change.value.messages)) {
        const message = change.value.messages[0];
        
        if (!message) {
          console.log('⚠️ Meta webhook: empty messages array');
          return { messageData: null, source: 'whatsapp' };
        }
        
        const messageType = message.type;
        const sender = message.from;
        const timestampMs = parseInt(message.timestamp) * 1000; // Convert from seconds to milliseconds
        const messageId = message.id;
        
        let messagePayload = {};
        
        if (messageType === 'text') {
          messagePayload.text = message.text?.body || '';
        } else if (messageType === 'image') {
          messagePayload.caption = message.image?.caption || '';
          messagePayload.url = message.image?.link || '';
          messagePayload.id = message.image?.id || '';
          messagePayload.mimeType = message.image?.mime_type || '';
        } else {
          console.log(`⚠️ Unsupported Meta message type: ${messageType}`);
          return { messageData: null, source: 'whatsapp' };
        }
        
        console.log(`📱 Meta WhatsApp message detected: ${messageType} from ${sender}`);
        
        return {
          messageData: {
            messageType,
            sender,
            timestampMs,
            messagePayload,
            messageId
          },
          source: 'whatsapp'
        };
      }
    }
  } catch (metaError) {
    console.error('❌ Error parsing Meta webhook:', metaError.message);
    console.log('📨 Problematic Meta payload:', JSON.stringify(body, null, 2));
  }
  
  // Check if this is Gupshup format
  if (body.type === 'message-event' && body.payload) {
    const mainPayload = body.payload;
    
    // Handle failed messages
    if (mainPayload.type === 'failed') {
      console.log('❌ Gupshup message failed:', mainPayload.payload);
      return { messageData: null, source: 'gupshup' };
    }
    
    const messageType = mainPayload.type;
    const sender = mainPayload.source || '';
    const timestampMs = mainPayload.timestamp || Date.now();
    const messagePayload = mainPayload.payload || {};
    const messageId = mainPayload.id || generateMessageId(mainPayload);
    
    console.log(`📱 Gupshup message detected: ${messageType} from ${sender}`);
    
    return {
      messageData: {
        messageType,
        sender,
        timestampMs,
        messagePayload,
        messageId
      },
      source: 'gupshup'
    };
  }
  
  console.log('⚠️ Unknown webhook format, ignoring');
  return { messageData: null, source: 'unknown' };
}

// Intelligent message processing with context awareness
async function processMessageWithContext(messageType, messagePayload, sender, timestampMs) {
  let messageText = '';
  let imageUrl = null;
  let confidence = 'high';

  if (messageType === 'text') {
    messageText = sanitizeText(messagePayload.text || messagePayload || '');
    messageStore.storeMessage(sender, messageText, timestampMs);
    console.log(`📝 Text message from ${sender}: "${messageText.substring(0, 50)}..."`);
    
    // Check if there's a recent image that might be related
    const recentImage = messageStore.getRecentImage(sender, timestampMs);
    if (recentImage && isContentRelated(messageText, recentImage.caption)) {
      imageUrl = recentImage.url;
      confidence = 'paired_text_image';
      console.log(`🔗 Paired text with recent image: ${imageUrl}`);
    }

  } else if (messageType === 'image') {
    const caption = messagePayload.caption || '';
    let tempImageUrl = messagePayload.url || messagePayload.link || '';
    
    console.log(`📸 Processing image from ${sender}:`);
    console.log(`   Caption: "${caption}"`);
    console.log(`   Raw payload:`, JSON.stringify(messagePayload, null, 2));
    console.log(`   Initial Image URL: ${tempImageUrl}`);
    console.log(`   Image ID: ${messagePayload.id}`);
    
    // If we don't have a direct URL but have an ID, try to get it from Meta API
    if (!tempImageUrl && messagePayload.id) {
      console.log(`🔄 No direct URL found, attempting to retrieve from Meta API...`);
      tempImageUrl = await getMediaUrlFromMeta(messagePayload.id);
      
      if (tempImageUrl) {
        console.log(`✅ Successfully retrieved URL from Meta API: ${tempImageUrl}`);
      } else {
        console.error(`❌ Failed to retrieve URL from Meta API for ID: ${messagePayload.id}`);
      }
    } else if (tempImageUrl) {
      console.log(`✅ Using direct URL from webhook: ${tempImageUrl}`);
    } else {
      console.error(`❌ No image URL available: no direct URL and no media ID`);
    }
    
    imageUrl = tempImageUrl;
    console.log(`📷 Final Image URL for storage: ${imageUrl || 'NULL'}`);

    // Store this image for potential future pairing
    messageStore.storeImage(sender, imageUrl, caption, timestampMs);

    if (caption && caption.trim().length > 0) {
      messageText = caption;
      confidence = 'image_with_caption';
      console.log(`   Using caption as message text`);
    } else {
      // Look for recent text messages that might be related
      const recentMessage = messageStore.getRecentMessage(sender, timestampMs);
      if (recentMessage) {
        messageText = recentMessage.text;
        confidence = 'paired_image_text';
        console.log(`   Paired with recent message: "${messageText.substring(0, 50)}..."`);
      } else {
        messageText = '(תמונה ללא טקסט, לא ניתן לקשר לפנייה)';
        confidence = 'image_only';
        console.log(`   No recent messages found, using fallback`);
      }
    }
  }

  return { messageText, imageUrl, confidence };
}

// Check if text content and image caption are related
function isContentRelated(text1, text2) {
  if (!text1 || !text2) return false;
  
  // Convert to lowercase Hebrew/English for comparison
  const t1 = text1.toLowerCase();
  const t2 = text2.toLowerCase();
  
  // Check for common complaint keywords in Hebrew and English
  const complaintKeywords = [
    'בעיה', 'תקלה', 'בור', 'שבר', 'מקולקל', 'לא עובד', 'סכנה', 'מסוכן',
    'problem', 'issue', 'broken', 'damage', 'dangerous', 'not working',
    'רחוב', 'מדרכה', 'חניה', 'תאורה', 'עץ', 'אשפה', 'פח',
    'street', 'sidewalk', 'parking', 'light', 'tree', 'trash', 'garbage'
  ];
  
  // Check if both contain complaint-related keywords
  const t1HasKeywords = complaintKeywords.some(keyword => t1.includes(keyword));
  const t2HasKeywords = complaintKeywords.some(keyword => t2.includes(keyword));
  
  if (t1HasKeywords && t2HasKeywords) {
    return true;
  }
  
  // Check for shared significant words (3+ characters, Hebrew or English)
  const words1 = t1.match(/[\u0590-\u05FF]{3,}|[a-z]{3,}/g) || [];
  const words2 = t2.match(/[\u0590-\u05FF]{3,}|[a-z]{3,}/g) || [];
  
  const commonWords = words1.filter(word => words2.includes(word));
  return commonWords.length >= 2; // At least 2 common significant words
}

// Helper function to extract contact info from message text
function extractContactInfo(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    return { name: null, phone: null };
  }

  const text = messageText.toLowerCase();
  
  // Extract phone numbers - prioritize those found in text
  const phonePatterns = [
    /(?:טלפון|טל|נייד|פלאפון|מספר|קשר)[\s:]*(\d{2,3}[-\s]?\d{7,8})/gi,  // Hebrew phone keywords
    /(?:phone|mobile|tel|call|contact)[\s:]*(\d{2,3}[-\s]?\d{7,8})/gi,      // English phone keywords
    /(\b05\d[-\s]?\d{7})/g,     // Israeli mobile: 05X-XXXXXXX
    /(\b0\d[-\s]?\d{7,8})/g,    // Israeli landline: 0X-XXXXXXXX
    /(\b972\d{8,9})/g,          // International Israeli: 972XXXXXXXXX
    /\n(\d{3}[-\s]?\d{7})\s*$/gm,  // Phone number on its own line at end
    /(\d{3}[-\s]?\d{3}[-\s]?\d{4})/g  // General phone pattern: XXX-XXX-XXXX
  ];

  let extractedPhone = null;
  for (const pattern of phonePatterns) {
    const matches = messageText.match(pattern);
    if (matches && matches[0]) {
      extractedPhone = formatIsraeliPhoneNumber(matches[0].replace(/\D/g, ''));
      break;
    }
  }

  // Extract names - look for name patterns
  const namePatterns = [
    /(?:שמי|השם שלי|קוראים לי|אני)[\s:]*([\u0590-\u05FF\s]+?)(?:\s|,|\.|\n|$)/gi,  // Hebrew name patterns
    /(?:שם|מטעם|בשם)[\s:]*([\u0590-\u05FF\s]+?)(?:\s|,|\.|\n|$)/gi,                // Hebrew name contexts
    /(?:my name is|i am|name|from)[\s:]*([\w\s]+?)(?:\s|,|\.|\n|$)/gi,              // English name patterns
    /([\u0590-\u05FF]{2,}\s[\u0590-\u05FF]{2,})(?:\s*-\s*רחוב|\s*,|\s*\n)/gm,      // Hebrew name before address/comma/newline
    /^([\u0590-\u05FF]{2,}\s[\u0590-\u05FF]{2,})/gm,                              // Hebrew first/last name at start
    /^([A-Z][a-z]+\s[A-Z][a-z]+)/gm,                                               // English first/last name at start
    /\n([\u0590-\u05FF]{2,}\s[\u0590-\u05FF]{2,})(?:\s*-)/gm                       // Hebrew name after newline before dash
  ];

  let extractedName = null;
  for (const pattern of namePatterns) {
    const matches = messageText.match(pattern);
    if (matches && matches[0]) {
      // Clean up the extracted name
      extractedName = matches[0]
        .replace(/(שמי|השם שלי|קוראים לי|אני|שם|מטעם|בשם|my name is|i am|name|from)[\s:]*/gi, '')
        .replace(/[,\.!?]/g, '')
        .trim();
      
      // Validate name (at least 2 characters, not just numbers)
      if (extractedName.length >= 2 && !/^\d+$/.test(extractedName)) {
        break;
      } else {
        extractedName = null;
      }
    }
  }

  return {
    name: extractedName,
    phone: extractedPhone
  };
}

// Helper function to format Israeli phone numbers (972 -> 0)
function formatIsraeliPhoneNumber(phoneNumber) {
  if (!phoneNumber || typeof phoneNumber !== 'string') {
    return phoneNumber || '';
  }
  
  // Remove any non-digit characters first
  const digitsOnly = phoneNumber.replace(/\D/g, '');
  
  // Check if it starts with 972 (Israel country code)
  if (digitsOnly.startsWith('972')) {
    // Replace 972 with 0
    const formatted = '0' + digitsOnly.substring(3);
    console.log(`📞 Formatted phone: ${phoneNumber} -> ${formatted}`);
    return formatted;
  }
  
  // Return original if not Israeli format
  return phoneNumber;
}

// GET endpoint for Meta WhatsApp webhook verification
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  console.log('🔍 Webhook verification request:', { mode, token, challenge });
  
  // Check if this is Meta's webhook verification
  if (mode === 'subscribe') {
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    
    if (!verifyToken) {
      console.error('❌ META_WEBHOOK_VERIFY_TOKEN not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    
    if (token === verifyToken) {
      console.log('✅ Webhook verification successful');
      return res.status(200).send(challenge);
    } else {
      console.warn('❌ Invalid verify token');
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  
  // Default response for non-verification requests
  res.json({
    status: 'webhook endpoint active',
    method: 'POST required for webhook processing',
    url: req.url,
    timestamp: new Date().toISOString()
  });
});

/**
 * Starts periodic dashboard updates
 */
function startPeriodicDashboardUpdates() {
  // Update dashboard stats every 5 minutes
  setInterval(async () => {
    try {
      const successRate = performanceStats.totalProcessed > 0 
        ? Math.round((performanceStats.successfulAnalyses / performanceStats.totalProcessed) * 100)
        : 0;
        
      const stats = {
        totalProcessed: performanceStats.totalProcessed,
        successRate,
        avgResponseTime: performanceStats.avgResponseTime
      };
      
      await updateDashboardStats(stats);
      console.log(`📊 לוח בקרה עודכן אוטומטית - ${stats.totalProcessed} נעבדו, ${stats.successRate}% הצלחה`);
    } catch (error) {
      console.warn('⚠️ עדכון לוח בקרה תקופתי נכשל:', error.message);
    }
  }, 5 * 60 * 1000); // 5 minutes
  
  console.log('⏰ עדכוני לוח בקרה תקופתיים הופעלו (כל 5 דקות)');
}

// Add error handler middleware (must be last)
app.use(errorHandler);

app.get('/', (req, res) => {
  const messageStats = messageStore.getStats();
  const successRate = performanceStats.totalProcessed > 0 
    ? Math.round((performanceStats.successfulAnalyses / performanceStats.totalProcessed) * 100)
    : 0;
    
  res.json({
    status: 'running',
    service: 'City Hall Complaint Bot',
    environment: process.env.NODE_ENV || 'production',
    stats: {
      recentMessages: messageStats.recentMessages,
      recentImages: messageStats.recentImages,
      processedMessages: messageStats.processedMessages,
      dashboardUrl: `https://docs.google.com/spreadsheets/d/${process.env.SHEET_ID}/edit#gid=0`
    },
    performance: {
      totalProcessed: performanceStats.totalProcessed,
      successfulAnalyses: performanceStats.successfulAnalyses,
      failedAnalyses: performanceStats.failedAnalyses,
      successRate: `${successRate}%`,
      avgResponseTime: `${performanceStats.avgResponseTime}ms`,
      lastUpdated: performanceStats.lastUpdated.toISOString()
    },
    features: {
      intelligentPairing: 'Pairs text messages with images within 60 seconds',
      contactExtraction: 'Extracts Hebrew/English contact info from messages',
      aiAnalysis: 'OpenRouter API with retry logic and fallback',
      dualWebhooks: 'Supports both Meta WhatsApp and Gupshup',
      dashboard: 'מדדים בזמן אמת בלוח בקרה גוגל שיטס'
    }
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Special endpoint to recreate dashboard in Hebrew
app.post('/admin/recreate-dashboard', async (req, res) => {
  try {
    console.log('🔄 יוצר מחדש לוח בקרה בעברית...');
    await recreateDashboard();
    res.json({ 
      status: 'success', 
      message: 'לוח בקרה נוצר מחדש בעברית',
      dashboardUrl: `https://docs.google.com/spreadsheets/d/${process.env.SHEET_ID}/edit#gid=0`
    });
  } catch (error) {
    console.error('❌ יצירת מחדש של לוח הבקרה נכשלה:', error.message);
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

// Admin endpoint to clear message store for testing
app.post('/admin/clear-store', (req, res) => {
  try {
    const statsBefore = messageStore.getStats();
    messageStore.clear();
    console.log('🧹 Message store cleared by admin');
    res.json({ 
      status: 'success', 
      message: 'Message store cleared successfully',
      statsBefore,
      statsAfter: messageStore.getStats()
    });
  } catch (error) {
    console.error('❌ Failed to clear message store:', error.message);
    res.status(500).json({ 
      status: 'error', 
      message: error.message 
    });
  }
});

app.listen(PORT, async () => {
  console.log(`🚀 Server live on port ${PORT}`);
  console.log(`🔒 Webhook auth: ${process.env.WEBHOOK_SECRET ? 'enabled' : 'disabled'}`);
  console.log(`⏱️ Rate limiting: ${process.env.RATE_LIMIT_MAX_REQUESTS || 10} requests per ${(process.env.RATE_LIMIT_WINDOW_MS || 60000) / 1000}s`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  
  // Initialize dashboard on startup
  try {
    await initializeDashboardSheet();
    console.log(`📊 לוח הבקרה אותחל בהצלחה`);
    
    // Start periodic dashboard updates every 5 minutes
    startPeriodicDashboardUpdates();
  } catch (error) {
    console.warn(`⚠️ אתחול לוח הבקרה נכשל:`, error.message);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  messageStore.stopCleanup();
  process.exit(0);
});
