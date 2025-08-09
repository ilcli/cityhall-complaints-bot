/**
 * Thread-safe message store for pairing text messages with images
 * Includes deduplication and proper cleanup
 */

class MessageStore {
  constructor() {
    this.recentMessages = new Map();
    this.recentImages = new Map();
    this.processedMessages = new Set();
    this.maxMessageAge = 60000; // 60 seconds
    this.maxProcessedSize = 10000; // Maximum processed IDs to track
    this.cleanupInterval = null;
  }

  /**
   * Starts the cleanup interval
   */
  startCleanup() {
    if (this.cleanupInterval) {
      return;
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 30000); // Run every 30 seconds
  }

  /**
   * Stops the cleanup interval
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Checks if a message has been processed (for deduplication)
   * @param {string} messageId - Unique message ID
   * @returns {boolean} - Whether message was already processed
   */
  isProcessed(messageId) {
    return this.processedMessages.has(messageId);
  }

  /**
   * Marks a message as processed
   * @param {string} messageId - Unique message ID
   */
  markProcessed(messageId) {
    this.processedMessages.add(messageId);
    
    // Prevent unbounded growth of processed set
    if (this.processedMessages.size > this.maxProcessedSize) {
      const toDelete = this.processedMessages.size - this.maxProcessedSize;
      const iterator = this.processedMessages.values();
      for (let i = 0; i < toDelete; i++) {
        this.processedMessages.delete(iterator.next().value);
      }
    }
  }

  /**
   * Stores a text message for potential pairing with an image
   * @param {string} sender - Sender phone number
   * @param {string} message - Message text
   * @param {number} timestamp - Message timestamp
   */
  storeMessage(sender, message, timestamp) {
    if (!sender || !message) {
      return;
    }
    
    // Store with timestamp for cleanup
    this.recentMessages.set(sender, {
      message: message.substring(0, 1000), // Limit stored message size
      timestamp: timestamp || Date.now()
    });
  }

  /**
   * Retrieves a recent message for pairing
   * @param {string} sender - Sender phone number
   * @param {number} currentTimestamp - Current message timestamp
   * @returns {object|null} - Recent message object or null
   */
  getRecentMessage(sender, currentTimestamp) {
    if (!this.recentMessages.has(sender)) {
      return null;
    }
    
    const recent = this.recentMessages.get(sender);
    
    // Check if message is within time window
    if (Math.abs(currentTimestamp - recent.timestamp) <= this.maxMessageAge) {
      return { text: recent.message, timestamp: recent.timestamp };
    }
    
    // Message is too old, remove it
    this.recentMessages.delete(sender);
    return null;
  }

  /**
   * Stores an image for potential pairing with text messages
   * @param {string} sender - Sender phone number
   * @param {string} imageUrl - Image URL
   * @param {string} caption - Image caption
   * @param {number} timestamp - Image timestamp
   */
  storeImage(sender, imageUrl, caption, timestamp) {
    if (!sender || !imageUrl) {
      return;
    }
    
    // Store with timestamp for cleanup
    this.recentImages.set(sender, {
      url: imageUrl,
      caption: caption || '',
      timestamp: timestamp || Date.now()
    });
  }

  /**
   * Retrieves a recent image for pairing
   * @param {string} sender - Sender phone number
   * @param {number} currentTimestamp - Current message timestamp
   * @returns {object|null} - Recent image object or null
   */
  getRecentImage(sender, currentTimestamp) {
    if (!this.recentImages.has(sender)) {
      return null;
    }
    
    const recent = this.recentImages.get(sender);
    
    // Check if image is within time window
    if (Math.abs(currentTimestamp - recent.timestamp) <= this.maxMessageAge) {
      return { url: recent.url, caption: recent.caption, timestamp: recent.timestamp };
    }
    
    // Image is too old, remove it
    this.recentImages.delete(sender);
    return null;
  }

  /**
   * Cleans up expired messages and images
   */
  cleanup() {
    try {
      const now = Date.now();
      const expiredMessageSenders = [];
      const expiredImageSenders = [];
      
      // Clean up expired text messages
      for (const [sender, data] of this.recentMessages) {
        if (now - data.timestamp > this.maxMessageAge) {
          expiredMessageSenders.push(sender);
        }
      }
      
      for (const sender of expiredMessageSenders) {
        this.recentMessages.delete(sender);
      }
      
      // Clean up expired images
      for (const [sender, data] of this.recentImages) {
        if (now - data.timestamp > this.maxMessageAge) {
          expiredImageSenders.push(sender);
        }
      }
      
      for (const sender of expiredImageSenders) {
        this.recentImages.delete(sender);
      }
      
      if (expiredMessageSenders.length > 0 || expiredImageSenders.length > 0) {
        console.log(`🧹 Cleaned up ${expiredMessageSenders.length} expired messages, ${expiredImageSenders.length} expired images`);
      }
    } catch (error) {
      console.error('❌ Error during message cleanup:', error);
    }
  }

  /**
   * Gets current store statistics
   * @returns {object} - Store statistics
   */
  getStats() {
    return {
      recentMessages: this.recentMessages.size,
      recentImages: this.recentImages.size,
      processedMessages: this.processedMessages.size
    };
  }

  /**
   * Clears all stored data
   */
  clear() {
    this.recentMessages.clear();
    this.recentImages.clear();
    this.processedMessages.clear();
  }
}

// Singleton instance
const messageStore = new MessageStore();
messageStore.startCleanup();

export default messageStore;