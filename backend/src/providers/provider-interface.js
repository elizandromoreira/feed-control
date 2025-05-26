/**
 * Provider Interface
 * 
 * This file defines the interface that all provider implementations must follow.
 * Each provider must implement methods for Phase1 (fetch and diff) and Phase2 (Amazon updates).
 */

/**
 * Base Provider Interface
 * All provider implementations must extend this class
 */
class BaseProvider {
  /**
   * @param {Object} config - Provider configuration
   */
  constructor(config) {
    this.config = config;
    
    // Ensure this class cannot be instantiated directly
    if (this.constructor === BaseProvider) {
      throw new Error('BaseProvider is an abstract class and cannot be instantiated directly');
    }
  }

  /**
   * Initialize provider resources (e.g., database connections)
   * @returns {Promise<void>}
   */
  async init() {
    throw new Error('Method init() must be implemented');
  }

  /**
   * Close provider resources (e.g., database connections)
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('Method close() must be implemented');
  }

  /**
   * Get provider identifier
   * @returns {string} Provider ID
   */
  getId() {
    throw new Error('Method getId() must be implemented');
  }

  /**
   * Get provider name
   * @returns {string} Provider name
   */
  getName() {
    throw new Error('Method getName() must be implemented');
  }

  /**
   * Get provider API service
   * @returns {Object} API service instance
   */
  getApiService() {
    throw new Error('Method getApiService() must be implemented');
  }

  /**
   * Execute Phase 1 operations (fetch and diff)
   * @param {boolean} skipProblematic - Whether to skip problematic products
   * @param {number} requestsPerSecond - API request rate limit
   * @param {Function} checkCancellation - Function to check if process should be cancelled
   * @param {Function} updateProgress - Function to update progress information
   * @returns {Promise<Object>} Result of Phase 1 operations
   */
  async executePhase1(skipProblematic, requestsPerSecond, checkCancellation, updateProgress) {
    throw new Error('Method executePhase1() must be implemented');
  }

  /**
   * Execute Phase 2 operations (Amazon updates)
   * @param {number} batchSize - Size of each batch to send to Amazon
   * @param {number} checkInterval - Interval to check feed status in milliseconds
   * @param {Function} checkCancellation - Function to check if process should be cancelled
   * @param {Function} updateProgress - Function to update progress information
   * @returns {Promise<Object>} Result of Phase 2 operations
   */
  async executePhase2(batchSize, checkInterval, checkCancellation, updateProgress) {
    throw new Error('Method executePhase2() must be implemented');
  }

  /**
   * Get SQL queries for extracting updated products for Phase 2
   * @returns {Object} SQL queries
   */
  getPhase2Queries() {
    throw new Error('Method getPhase2Queries() must be implemented');
  }

  /**
   * Reset updated products after Phase 2
   * @returns {Promise<void>}
   */
  async resetUpdatedProducts() {
    throw new Error('Method resetUpdatedProducts() must be implemented');
  }
}

module.exports = BaseProvider; 