import dotenv from 'dotenv';

// Load environment variables first
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import { DateTime } from 'luxon';

import { analyzeComplaint } from './analyzeMessageWithAI.js';
import { appendToSheet } from './googleSheets.js';
import { webhookAuthMiddleware, captureRawBody } from './middleware/security.js';
import { rateLimitMiddleware } from './middleware/rateLimiter.js';
import { validateWebhookPayload, generateMessageId, sanitizeText, sanitizeForSheets } from './utils/validation.js';
import messageStore from './utils/messageStore.js';
import { errorHandler, asyncHandler, ValidationError, ConfigurationError } from './utils/errors.js';

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

    // Extract message content based on type
    let messageText = '';
    let imageUrl = null;

    if (messageType === 'text') {
      messageText = sanitizeText(messagePayload.text || messagePayload || '');
      messageStore.storeMessage(sender, messageText, timestampMs);
      console.log(`📝 Text message from ${sender}: "${messageText}"`);

    } else if (messageType === 'image') {
      const caption = messagePayload.caption || '';
      imageUrl = messagePayload.url || messagePayload.link || '';
      
      console.log(`📸 Processing image from ${sender}:`);
      console.log(`   Caption: "${caption}"`);
      console.log(`   Image URL: ${imageUrl}`);

      if (caption) {
        messageText = caption;
        console.log(`   Using caption as message text`);
      } else {
        const recentMessage = messageStore.getRecentMessage(sender, timestampMs);
        if (recentMessage) {
          messageText = recentMessage;
          console.log(`   Paired with recent message: "${messageText}"`);
        } else {
          messageText = '(תמונה ללא טקסט, לא ניתן לקשר לפנייה)';
          console.log(`   No recent messages found, using fallback`);
        }
      }
    }

    // AI analysis
    console.log(`🤖 Analyzing complaint with message: "${messageText}" and imageUrl: "${imageUrl}"`);
    const analysis = await analyzeComplaint({ message: messageText, timestamp, imageUrl });
    console.log(`🤖 AI analysis result:`, analysis);

    // Prepare row for Google Sheets
    const row = {
      'שם הפונה': sanitizeForSheets(analysis['שם הפונה'] || ''),
      'קטגוריה': sanitizeForSheets(analysis['קטגוריה'] || ''),
      'רמת דחיפות': sanitizeForSheets(analysis['רמת דחיפות'] || ''),
      'תוכן הפנייה': sanitizeForSheets(analysis['תוכן הפנייה'] || messageText),
      'תאריך ושעה': timestamp,
      'טלפון': sender,
      'קישור לתמונה': imageUrl || '',
      'סוג הפנייה': sanitizeForSheets(analysis['סוג הפנייה'] || ''),
      'מחלקה אחראית': sanitizeForSheets(analysis['מחלקה אחראית'] || ''),
      'source': source,
    };

    console.log(`📝 Row data to be sent to sheet:`, row);
    await appendToSheet(row);
    console.log(`✅ Complaint from ${sender} logged with type: ${messageType} (source: ${source})`);
    return res.status(200).json({ status: 'success', messageId });

  } catch (error) {
    console.error('❌ Webhook error:', error);
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

// Add error handler middleware (must be last)
app.use(errorHandler);

app.get('/', (req, res) => {
  const stats = messageStore.getStats();
  res.json({
    status: 'running',
    service: 'City Hall Complaint Bot',
    environment: process.env.NODE_ENV || 'production',
    stats: {
      recentMessages: stats.recentMessages,
      processedMessages: stats.processedMessages
    }
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server live on port ${PORT}`);
  console.log(`🔒 Webhook auth: ${process.env.WEBHOOK_SECRET ? 'enabled' : 'disabled'}`);
  console.log(`⏱️ Rate limiting: ${process.env.RATE_LIMIT_MAX_REQUESTS || 10} requests per ${(process.env.RATE_LIMIT_WINDOW_MS || 60000) / 1000}s`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  messageStore.stopCleanup();
  process.exit(0);
});
