/**
 * Home Depot Provider
 * 
 * Implementation of the provider interface for Home Depot.
 * This adapts the existing Home Depot code to the new provider architecture.
 */

const BaseProvider = require('./provider-interface');
const HomeDepotApiService = require('../services/homeDepotApi');
const DatabaseService = require('../services/database');
const { DB_CONFIG } = require('../config/db');
const phase1 = require('../phases/phase1');
const phase2 = require('../phases/phase2');
const logger = require('../config/logging')();

/**
 * Home Depot Provider implementation
 */
class HomeDepotProvider extends BaseProvider {
  /**
   * @param {Object} config - Provider configuration
   */
  constructor(config = {}) {
    super(config);
    this.apiBaseUrl = config.apiBaseUrl || process.env.HOMEDEPOT_API_BASE_URL || 'http://167.114.223.83:3005/hd/api';
    this.dbService = new DatabaseService(DB_CONFIG);
    
    // Debug das variáveis de ambiente no construtor
    // logger.info('=== DEBUG HomeDepotProvider constructor ===');
    // logger.info(`HOMEDEPOT_STOCK_LEVEL (env): ${process.env.HOMEDEPOT_STOCK_LEVEL}`);
    // logger.info(`HOMEDEPOT_BATCH_SIZE (env): ${process.env.HOMEDEPOT_BATCH_SIZE}`);
    // logger.info(`HOMEDEPOT_REQUESTS_PER_SECOND (env): ${process.env.HOMEDEPOT_REQUESTS_PER_SECOND}`);
    // logger.info(`HOMEDEPOT_HANDLING_TIME (env): ${process.env.HOMEDEPOT_HANDLING_TIME}`);
    // logger.info(`HOMEDEPOT_HANDLING_TIME_OMD (env): ${process.env.HOMEDEPOT_HANDLING_TIME_OMD}`);
    // logger.info(`HOMEDEPOT_UPDATE_FLAG_VALUE (env): ${process.env.HOMEDEPOT_UPDATE_FLAG_VALUE}`);
    // logger.info(`LEAD_TIME_OMD (global env): ${process.env.LEAD_TIME_OMD}`);
    
    // Usar prioritariamente as variáveis específicas do provider, com fallback para variáveis genéricas
    this.dbInitialized = false;
    this.stockLevel = parseInt(process.env.HOMEDEPOT_STOCK_LEVEL || process.env.STOCK_LEVEL || '5', 10);
    this.batchSize = parseInt(process.env.HOMEDEPOT_BATCH_SIZE || process.env.BATCH_SIZE || '240', 10);
    this.handlingTimeOmd = parseInt(process.env.HOMEDEPOT_HANDLING_TIME_OMD || process.env.LEAD_TIME_OMD || '2', 10);
    this.homeDepotHandlingTime = parseInt(process.env.HOMEDEPOT_HANDLING_TIME || '2', 10);
    this.updateFlagValue = parseInt(process.env.HOMEDEPOT_UPDATE_FLAG_VALUE || '1', 10);
    this.requestsPerSecond = parseInt(process.env.HOMEDEPOT_REQUESTS_PER_SECOND || process.env.REQUESTS_PER_SECOND || '12', 10);
    
    // Debug dos valores após parse
    // logger.info('Valores utilizados após parsear:');
    // logger.info(`- stockLevel: ${this.stockLevel}`);
    // logger.info(`- batchSize: ${this.batchSize}`);
    // logger.info(`- handlingTimeOmd: ${this.handlingTimeOmd}`);
    // logger.info(`- homeDepotHandlingTime: ${this.homeDepotHandlingTime}`);
    // logger.info(`- requestsPerSecond: ${this.requestsPerSecond}`);
    // logger.info(`- updateFlagValue: ${this.updateFlagValue}`);
    // logger.info('==============================');
  }

  /**
   * Initialize database connection
   * @returns {Promise<void>}
   */
  async init() {
    if (!this.dbInitialized) {
      await this.dbService.init();
      this.dbInitialized = true;
      logger.info(`Database connection initialized for ${this.getName()} provider`);
    }
  }

  /**
   * Close database connection
   * @returns {Promise<void>}
   */
  async close() {
    if (this.dbInitialized) {
      await this.dbService.close();
      this.dbInitialized = false;
      logger.info(`Database connection closed for ${this.getName()} provider`);
    }
  }

  /**
   * Get provider identifier
   * @returns {string} Provider ID
   */
  getId() {
    return 'homedepot';
  }

  /**
   * Get provider name
   * @returns {string} Provider name
   */
  getName() {
    return 'Home Depot';
  }

  /**
   * Get provider API service
   * @returns {Object} API service instance
   */
  getApiService() {
    return new HomeDepotApiService(this.apiBaseUrl, this.requestsPerSecond);
  }

  /**
   * Execute Phase 1 operations (data fetching)
   * @param {boolean} skipProblematic - Skip problematic products
   * @param {number} requestsPerSecond - API requests per second
   * @param {Function} checkCancellation - Function to check if process should be cancelled
   * @param {Function} updateProgress - Function to update progress information
   * @returns {Promise<Object>} Result of Phase 1 operations
   */
  async executePhase1(skipProblematic, requestsPerSecond, checkCancellation, updateProgress) {
    logger.info(`Running Phase 1 for ${this.getName()} provider`);
    
    // Forçar o uso do valor de requestsPerSecond passado como parâmetro ou o valor definido no provider
    const effectiveRps = requestsPerSecond || this.requestsPerSecond;
    logger.info(`Using requests per second: ${effectiveRps}`);
    
    // Definir temporariamente a variável de ambiente para substituir qualquer valor global
    process.env.HOMEDEPOT_REQUESTS_PER_SECOND = effectiveRps.toString();
    logger.info(`Set HOMEDEPOT_REQUESTS_PER_SECOND environment variable to ${effectiveRps}`);
    
    // Inicializar conexão com o banco de dados
    await this.init();
    
    // Set environment variables for this provider
    const originalApiBaseUrl = process.env.API_BASE_URL;
    process.env.API_BASE_URL = this.apiBaseUrl;
    
    try {
      // Use the existing Phase 1 implementation
      const result = await phase1.runPhase1(
        skipProblematic,
        effectiveRps,
        checkCancellation,
        updateProgress
      );
      
      return result;
    } catch (error) {
      logger.error(`Error in ${this.getName()} Phase 1: ${error.message}`, { error });
      throw error;
    } finally {
      // Restore original environment variable
      process.env.API_BASE_URL = originalApiBaseUrl;
    }
  }

  /**
   * Execute Phase 2 of feed submission
   * @param {number} batchSize - Size of each batch to send
   * @param {number} checkInterval - Interval to check feed status in milliseconds 
   * @param {Function} checkCancellation - Function to check if process should be cancelled
   * @param {Function} updateProgress - Function to update progress information
   * @returns {Promise<Object>} Result of feed submission
   */
  async executePhase2(batchSize, checkInterval, checkCancellation, updateProgress) {
    logger.info(`Running Phase 2 for ${this.getName()} provider`);
    
    // Inicializar conexão com o banco de dados
    await this.init();
    
    try {
      // Set provider-specific environment variables for phase2
      process.env.CURRENT_PROVIDER_ID = 'homedepot';
      process.env.HOMEDEPOT_UPDATE_FLAG_VALUE = this.updateFlagValue.toString();
      
      // Call the standard Phase 2 implementation
      const result = await phase2.mainPhase2(
        batchSize,
        checkInterval,
        checkCancellation,
        updateProgress
      );
      
      return {
        success: result,
        providerInfo: {
          id: this.getId(),
          name: this.getName()
        }
      };
    } catch (error) {
      logger.error(`Error in ${this.getName()} Phase 2: ${error.message}`, { error });
      throw error;
    } finally {
      await this.close();
      logger.info(`Database connection closed after Phase 2 for ${this.getName()}`);
    }
  }

  /**
   * Reset updated products in the database
   * @returns {Promise<Object>} Result of reset operation
   */
  async resetUpdatedProducts() {
    await this.init();
    
    try {
      logger.info(`Resetting updated products for ${this.getName()}`);
      
      const query = `
        UPDATE produtos
        SET atualizado = 0
        WHERE atualizado = ${this.updateFlagValue} AND source = 'Home Depot'
        RETURNING sku
      `;
      
      const result = await this.dbService.executeWithRetry(query);
      
      const count = result?.length || 0;
      logger.info(`Reset ${count} product flags for ${this.getName()}`);
      
      return {
        success: true,
        count: count,
        message: `Reset ${count} product flags for ${this.getName()}`
      };
    } catch (error) {
      logger.error(`Error resetting updated products for ${this.getName()}: ${error.message}`, { error });
      throw error;
    } finally {
      await this.close();
    }
  }

  /**
   * Get SQL queries for extracting updated products for Phase 2
   * @returns {Object} SQL queries
   */
  getPhase2Queries() {
    return {
      extractUpdatedData: `
        SELECT 
          sku2, handling_time_amz, quantity 
        FROM produtos 
        WHERE atualizado = ${this.updateFlagValue} AND source = 'Home Depot'
      `,
      resetUpdatedProducts: `
        UPDATE produtos
        SET atualizado = 0
        WHERE atualizado = ${this.updateFlagValue} AND source = 'Home Depot'
      `
    };
  }
}

module.exports = HomeDepotProvider; 