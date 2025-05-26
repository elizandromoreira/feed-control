/**
 * Provider Factory
 * 
 * Factory pattern implementation to manage providers and their instantiation.
 */

const HomeDepotProvider = require('./home-depot-provider');
const ZoroProvider = require('./zoro-provider');
const WhiteCapProvider = require('./whitecap-provider');
const VitacostProvider = require('./vitacost-provider');
const BestBuyProvider = require('./bestbuy-provider');
const WebstaurantstoreProvider = require('./webstaurantstore-provider');
const logger = require('../config/logging')();

/**
 * Provider Factory class
 * Manages provider registration and instantiation
 */
class ProviderFactory {
  constructor() {
    this.providers = {};
    this.registerDefaultProviders();
  }

  /**
   * Register default providers
   */
  registerDefaultProviders() {
    // Register Home Depot provider
    this.registerProvider('homedepot', HomeDepotProvider);
    
    // Register Zoro provider
    this.registerProvider('zoro', ZoroProvider);
    
    // Register White Cap provider
    this.registerProvider('whitecap', WhiteCapProvider);
    
    // Register Vitacost provider
    this.registerProvider('vitacost', VitacostProvider);
    
    // Register Best Buy provider
    this.registerProvider('bestbuy', BestBuyProvider);
    
    // Register Webstaurantstore provider
    this.registerProvider('webstaurantstore', WebstaurantstoreProvider);
    
    // Future providers will be registered here or dynamically
  }

  /**
   * Register a provider
   * @param {string} providerId - Provider identifier
   * @param {Class} ProviderClass - Provider class
   */
  registerProvider(providerId, ProviderClass) {
    this.providers[providerId] = ProviderClass;
    logger.info(`Registered provider: ${providerId}`);
  }

  /**
   * Get a provider by ID
   * @param {string} providerId - Provider identifier
   * @param {Object} config - Configuration options
   * @returns {BaseProvider} Provider instance
   * @throws {Error} If provider is not found
   */
  getProvider(providerId, config = {}) {
    const ProviderClass = this.providers[providerId];
    
    if (!ProviderClass) {
      throw new Error(`Provider not found: ${providerId}`);
    }
    
    return new ProviderClass(config);
  }

  /**
   * Check if a provider exists
   * @param {string} providerId - Provider identifier
   * @returns {boolean} Whether the provider exists
   */
  hasProvider(providerId) {
    return !!this.providers[providerId];
  }

  /**
   * Get all registered provider IDs
   * @returns {Array<string>} List of provider IDs
   */
  getRegisteredProviderIds() {
    return Object.keys(this.providers);
  }
}

// Singleton instance
let factory = null;

/**
 * Get the provider factory singleton
 * @returns {ProviderFactory} Provider factory instance
 */
function getProviderFactory() {
  if (!factory) {
    factory = new ProviderFactory();
  }
  return factory;
}

module.exports = {
  getProviderFactory
}; 