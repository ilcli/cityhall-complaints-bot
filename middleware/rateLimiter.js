import { RateLimitError } from '../utils/errors.js';

/**
 * Simple in-memory rate limiter per phone number
 */
class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 10) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map();
  }

  /**
   * Checks if a phone number has exceeded rate limit
   * @param {string} phoneNumber - Phone number to check
   * @returns {{allowed: boolean, retryAfter: number}} - Rate limit status
   */
  checkLimit(phoneNumber) {
    const now = Date.now();
    const phoneRequests = this.requests.get(phoneNumber) || [];
    
    // Filter out expired requests
    const validRequests = phoneRequests.filter(
      timestamp => now - timestamp < this.windowMs
    );
    
    if (validRequests.length >= this.maxRequests) {
      // Calculate when the oldest request will expire
      const oldestRequest = Math.min(...validRequests);
      const retryAfter = Math.ceil((oldestRequest + this.windowMs - now) / 1000);
      
      return {
        allowed: false,
        retryAfter: Math.max(1, retryAfter)
      };
    }
    
    // Add new request timestamp
    validRequests.push(now);
    this.requests.set(phoneNumber, validRequests);
    
    // Clean up old entries periodically
    if (this.requests.size > 1000) {
      this.cleanup();
    }
    
    return {
      allowed: true,
      retryAfter: 0
    };
  }

  /**
   * Cleans up expired entries
   */
  cleanup() {
    const now = Date.now();
    const toDelete = [];
    
    for (const [phone, timestamps] of this.requests) {
      const valid = timestamps.filter(ts => now - ts < this.windowMs);
      
      if (valid.length === 0) {
        toDelete.push(phone);
      } else {
        this.requests.set(phone, valid);
      }
    }
    
    for (const phone of toDelete) {
      this.requests.delete(phone);
    }
  }

  /**
   * Resets rate limit for a specific phone number
   * @param {string} phoneNumber - Phone number to reset
   */
  reset(phoneNumber) {
    this.requests.delete(phoneNumber);
  }

  /**
   * Gets current statistics
   * @returns {object} - Rate limiter statistics
   */
  getStats() {
    return {
      trackedPhones: this.requests.size,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests
    };
  }
}

// Create singleton instance
let rateLimiterInstance = null;

/**
 * Gets or creates the rate limiter instance
 * @returns {RateLimiter} - Rate limiter instance
 */
export function getRateLimiter() {
  if (!rateLimiterInstance) {
    const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
    const maxRequests = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10;
    rateLimiterInstance = new RateLimiter(windowMs, maxRequests);
  }
  return rateLimiterInstance;
}

/**
 * Express middleware for rate limiting by phone number
 */
export function rateLimitMiddleware(req, res, next) {
  // Skip rate limiting in test environment
  if (process.env.NODE_ENV === 'test') {
    return next();
  }

  // Extract phone number from request
  const phoneNumber = req.body?.payload?.sender?.phone;
  
  if (!phoneNumber) {
    // Can't rate limit without phone number, let validation handle it
    return next();
  }
  
  const limiter = getRateLimiter();
  const { allowed, retryAfter } = limiter.checkLimit(phoneNumber);
  
  if (!allowed) {
    console.warn(`⚠️ Rate limit exceeded for phone: ${phoneNumber}`);
    throw new RateLimitError(
      `Too many requests. Please wait ${retryAfter} seconds.`,
      retryAfter
    );
  }
  
  // Add rate limit headers
  res.set('X-RateLimit-Limit', limiter.maxRequests.toString());
  res.set('X-RateLimit-Window', (limiter.windowMs / 1000).toString());
  
  next();
}

/**
 * Clean up interval for rate limiter
 */
setInterval(() => {
  const limiter = getRateLimiter();
  limiter.cleanup();
}, 300000); // Clean up every 5 minutes