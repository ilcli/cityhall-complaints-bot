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
    console.log('📨 Webhook received:', JSON.stringify(req.body, null, 2));
    
    // Simple response for now
    return res.status(200).json({ status: 'received' });
    
    /* TEMPORARILY DISABLED PROCESSING TO DEBUG STRUCTURE
    // Validate webhook payload structure
    const validation = validateWebhookPayload(req.body);
    if (!validation.valid) {
      throw new ValidationError('Invalid webhook payload', validation.errors);
    }
    
    const { type: webhookType, payload } = req.body;

    if (webhookType !== 'message' && webhookType !== 'message-event') {
      console.log('⚠️ Ignored non-message event:', webhookType);
      return res.status(200).send('Ignored');
    }

    const content = payload;
    console.log('🔍 Extracted content:', JSON.stringify(content, null, 2));
    const sender = content?.sender?.phone;
    const timestampMsRaw = content?.timestamp;
    const timestampMs = parseInt(timestampMsRaw);
    
    // Generate unique message ID for deduplication
    const messageId = generateMessageId(content);
    
    // Check for duplicate messages
    if (messageStore.isProcessed(messageId)) {
      console.log(`⚠️ Duplicate message ignored: ${messageId}`);
      return res.status(200).send('Duplicate');
    }
    
    // Mark as processed immediately to prevent race conditions
    messageStore.markProcessed(messageId);

    const timestamp = DateTime.fromMillis(timestampMs)
      .setZone('Asia/Jerusalem')
      .toFormat('HH:mm dd-MM-yy');

    // Get message type from content
    const messageType = content?.type;
    console.log('🔍 Message type:', messageType);

    // Extract message text or image
    let messageText = '';
    let imageUrl = null;

    if (messageType === 'text') {
      messageText = sanitizeText(content.payload?.text || content.payload || '');
      messageStore.storeMessage(sender, messageText, timestampMs);

    } else if (messageType === 'image') {
      const caption = content.payload?.caption || '';
      imageUrl = content.payload?.url || '';
      
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

    // Sanitize all fields for Google Sheets
    const row = {
      'שם הפונה': sanitizeForSheets(analysis['שם הפונה'] || ''),
      'קטגוריה': sanitizeForSheets(analysis['קטגוריה'] || ''),
      'רמת דחיפות': sanitizeForSheets(analysis['רמת דחיפות'] || ''),
      'תוכן הפנייה': sanitizeForSheets(analysis['תוכן הפנייה'] || messageText),
      'תאריך ושעה': timestamp,
      'טלפון': sender,
      'קישור לתמונה': analysis['קישור לתמונה'] || imageUrl || '',
      'סוג הפנייה': sanitizeForSheets(analysis['סוג הפנייה'] || ''),
      'מחלקה אחראית': sanitizeForSheets(analysis['מחלקה אחראית'] || ''),
      'source': 'gupshup',
    };

    console.log(`📝 Row data to be sent to sheet:`, row);
    await appendToSheet(row);
    console.log(`✅ Complaint from ${sender} logged with type: ${messageType}`);
    return res.status(200).json({ status: 'success', messageId });
    */
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
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
