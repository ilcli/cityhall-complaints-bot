import crypto from 'crypto';

/**
 * Verifies webhook signature using HMAC-SHA256
 * @param {string} payload - Raw request body
 * @param {string} signature - Signature from request header
 * @param {string} secret - Webhook secret
 * @returns {boolean} - Whether signature is valid
 */
export function verifyWebhookSignature(payload, signature, secret) {
  if (!signature || !secret) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  // Ensure both buffers have the same length for comparison
  if (signature.length !== expectedSignature.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Express middleware for webhook authentication
 */
export function webhookAuthMiddleware(req, res, next) {
  // Skip authentication in development mode if configured
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_WEBHOOK_AUTH === 'true') {
    console.warn('⚠️ Webhook authentication skipped (development mode)');
    return next();
  }

  const webhookSecret = process.env.WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.error('❌ WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Get signature from various possible headers
  const signature = req.get('X-Webhook-Signature') || 
                    req.get('X-Hub-Signature-256') ||
                    req.get('X-Gupshup-Signature');

  if (!signature) {
    console.warn('❌ Missing webhook signature header');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Get raw body for signature verification
  const rawBody = req.rawBody || JSON.stringify(req.body);
  
  if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    console.warn('❌ Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}

/**
 * Middleware to capture raw request body for signature verification
 */
export function captureRawBody(req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
}