/**
 * Simple in-memory message queue for background processing
 * Prevents webhook timeouts by processing messages asynchronously
 */

class MessageQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.maxQueueSize = 100;
    this.processingErrors = 0;
    this.successfullyProcessed = 0;
  }

  /**
   * Add a message to the queue for background processing
   * @param {Object} messageData - The message data to process
   * @param {Function} processFunction - The function to process the message
   */
  async enqueue(messageData, processFunction) {
    // Prevent queue overflow
    if (this.queue.length >= this.maxQueueSize) {
      console.warn(`⚠️ Message queue full (${this.maxQueueSize} items), dropping oldest message`);
      this.queue.shift(); // Remove oldest message
    }

    this.queue.push({
      messageData,
      processFunction,
      enqueuedAt: Date.now()
    });

    console.log(`📥 Message queued for background processing (queue size: ${this.queue.length})`);
    
    // Start processing if not already running (with race condition protection)
    if (!this.processing) {
      // Set flag immediately to prevent race condition
      this.processing = true;
      // Start processing asynchronously
      setImmediate(() => this.startProcessing());
    }
  }

  /**
   * Start processing messages from the queue
   */
  async startProcessing() {
    // Already set to true in enqueue, just verify
    if (!this.processing) {
      this.processing = true;
    }
    
    console.log('🔄 Starting background message processing...');

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      
      try {
        const processingTime = Date.now() - item.enqueuedAt;
        console.log(`⏳ Processing queued message (waited ${processingTime}ms in queue)`);
        
        await item.processFunction(item.messageData);
        this.successfullyProcessed++;
        
        console.log(`✅ Background processing complete (${this.queue.length} remaining in queue)`);
      } catch (error) {
        this.processingErrors++;
        console.error('❌ Error in background processing:', error.message);
        console.error('Stack:', error.stack);
        
        // Log failed message details for debugging
        console.error('Failed message ID:', item.messageData?.messageId);
        console.error('Failed message type:', item.messageData?.messageType);
        
        // TODO: In production, consider sending to dead letter queue or alerting
        // For now, continue processing other messages to avoid blocking
      }
      
      // Small delay between processing to avoid overwhelming the system
      if (this.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    this.processing = false;
    console.log('✅ Background processing queue empty');
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.processing,
      successfullyProcessed: this.successfullyProcessed,
      processingErrors: this.processingErrors
    };
  }

  /**
   * Clear the queue (for emergency use)
   */
  clear() {
    const clearedCount = this.queue.length;
    this.queue = [];
    console.log(`🗑️ Cleared ${clearedCount} messages from queue`);
    return clearedCount;
  }
}

// Singleton instance
const messageQueue = new MessageQueue();

export default messageQueue;