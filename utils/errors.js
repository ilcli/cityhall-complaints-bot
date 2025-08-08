/**
 * Custom error classes for better error handling and logging
 */

/**
 * Base error class for application errors
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp
    };
  }
}

/**
 * Validation error for invalid input data
 */
export class ValidationError extends AppError {
  constructor(message, errors = []) {
    super(message, 400, { errors });
  }
}

/**
 * Authentication error for unauthorized requests
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

/**
 * External service error for third-party API failures
 */
export class ExternalServiceError extends AppError {
  constructor(service, message, details = {}) {
    super(`${service} error: ${message}`, 503, { service, ...details });
  }
}

/**
 * Rate limit error for too many requests
 */
export class RateLimitError extends AppError {
  constructor(message = 'Too many requests', retryAfter = 60) {
    super(message, 429, { retryAfter });
  }
}

/**
 * Configuration error for missing or invalid configuration
 */
export class ConfigurationError extends AppError {
  constructor(message) {
    super(message, 500, { type: 'configuration' });
  }
}

/**
 * Generates a unique error ID for tracking
 * @returns {string} - Unique error ID
 */
export function generateErrorId() {
  return `ERR-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
}

/**
 * Express error handler middleware
 */
export function errorHandler(err, req, res, next) {
  // Generate error ID for tracking
  const errorId = generateErrorId();
  
  // Determine if it's our custom error or system error
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  
  // Log error details
  const logDetails = {
    errorId,
    name: err.name,
    message: err.message,
    statusCode,
    path: req.path,
    method: req.method,
    ip: req.ip,
    ...(isAppError && { details: err.details }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  };
  
  // Use appropriate log level
  if (statusCode >= 500) {
    console.error('❌ Server Error:', logDetails);
  } else if (statusCode >= 400) {
    console.warn('⚠️ Client Error:', logDetails);
  } else {
    console.log('ℹ️ Error:', logDetails);
  }
  
  // Send response
  const responseBody = {
    error: isAppError ? err.message : 'Internal server error',
    errorId,
    ...(isAppError && err.details?.errors && { errors: err.details.errors }),
    ...(err instanceof RateLimitError && { retryAfter: err.details.retryAfter })
  };
  
  // Add stack trace in development
  if (process.env.NODE_ENV === 'development' && !isAppError) {
    responseBody.stack = err.stack;
  }
  
  // Set retry-after header for rate limit errors
  if (err instanceof RateLimitError) {
    res.set('Retry-After', err.details.retryAfter.toString());
  }
  
  res.status(statusCode).json(responseBody);
}

/**
 * Async route wrapper to catch errors in async routes
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}