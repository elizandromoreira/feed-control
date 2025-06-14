/**
 * Vitacost Provider
 * 
 * Implementation of the provider interface for Vitacost supplier.
 * This is completely independent from other provider implementations.
 */

const BaseProvider = require('./provider-interface');
const DatabaseService = require('../services/database');
const { DB_CONFIG } = require('../config/db');
const logger = require('../config/logging')();
const axios = require('axios');
const SimpleQueue = require('../utils/SimpleQueue');

/**
 * Vitacost Provider implementation
 */
class VitacostProvider extends BaseProvider {
  /**
   * @param {Object} config - Provider configuration from the database
   */
  constructor(config = {}) {
    super(config);
    
    // Configuration from DB or fallbacks
    this.apiBaseUrl = config.apiBaseUrl || process.env.VITACOST_API_BASE_URL || 'http://167.114.223.83:3005/vc';
    this.stockLevel = config.stockLevel ?? 5;
    this.batchSize = config.batchSize ?? 240;
    this.handlingTimeOmd = config.handlingTimeOmd ?? 2;
    this.providerSpecificHandlingTime = config.providerSpecificHandlingTime ?? 2;
    this.requestsPerSecond = config.requestsPerSecond ?? 7;
    this.updateFlagValue = config.updateFlagValue ?? 2;
    
    // Services
    this.dbService = new DatabaseService(DB_CONFIG);
    
    // Request tracking
    this.requestCounter = 0;
    this.pendingRequests = new Map();
    
    // State Management
    this.processedCount = 0;
    this.successCount = 0;
    this.errorCount = 0;
    this.inStockSet = new Set();
    this.outOfStockSet = new Set();
    this.totalRetries = 0;
    this.problematicProducts = [];
    this.failedProducts = [];
    
    // Update statistics
    this.updateStats = {
      newProducts: 0,
      updatedProducts: 0,
      priceChanges: 0,
      quantityChanges: 0,
      availabilityChanges: 0,
      brandChanges: 0,
      handlingTimeChanges: 0,
      errors: 0
    };
    
    // Log configuration values
    logger.store('vitacost', 'info', '--- VitacostProvider Configured Values ---');
    logger.store('vitacost', 'info', '- Source: Database');
    logger.store('vitacost', 'info', `- OMD Handling Time: ${this.handlingTimeOmd}`);
    logger.store('vitacost', 'info', `- Provider Handling Time: ${this.providerSpecificHandlingTime}`);
    logger.store('vitacost', 'info', `- Update Flag Value: ${this.updateFlagValue}`);
    logger.store('vitacost', 'info', `- Stock Level: ${this.stockLevel}`);
    logger.store('vitacost', 'info', `- Requests Per Second: ${this.requestsPerSecond}`);
    logger.store('vitacost', 'info', '-------------------------------------------');
  }

  /**
   * Initialize the database connection if not already initialized
   */
  async init() {
    if (!this.dbInitialized) {
      await this.dbService.init();
      this.dbInitialized = true;
      logger.store('vitacost', 'info', 'Database connection initialized');
    }
  }

  /**
   * Close the database connection
   */
  async close() {
    if (this.dbInitialized) {
      await this.dbService.close();
      this.dbInitialized = false;
      logger.store('vitacost', 'info', 'Database connection closed');
    }
  }

  /**
   * Get provider identifier
   * @returns {string} Provider ID
   */
  getId() {
    return 'vitacost';
  }

  /**
   * Get provider name
   * @returns {string} Provider name
   */
  getName() {
    return 'Vitacost';
  }

  generateRequestId() {
    return ++this.requestCounter;
  }

  trackRequest(requestId, sku, url) {
    this.pendingRequests.set(requestId, {
      sku,
      url,
      startTime: Date.now()
    });
  }

  completeRequest(requestId, success = true) {
    const requestInfo = this.pendingRequests.get(requestId);
    if (requestInfo) {
      const duration = Date.now() - requestInfo.startTime;
      logger.store('vitacost', 'info', `[REQ-${requestId}] Request completed for SKU ${requestInfo.sku} - Total duration: ${duration}ms, Success: ${success}`);
      this.pendingRequests.delete(requestId);
    }
  }

  checkPendingRequests() {
    const now = Date.now();
    const staleThreshold = 30000; // 30 segundos
    
    for (const [requestId, info] of this.pendingRequests) {
      const age = now - info.startTime;
      if (age > staleThreshold) {
        logger.store('vitacost', 'warn', `[REQUEST-MONITOR] REQ-${requestId}: SKU ${info.sku}, Age: ${age}ms, URL: ${info.url}`);
      }
    }
  }

  /**
   * Monitora requests pendentes e registra se alguma está demorando muito
   */
  startRequestMonitoring() {
    this.requestMonitorInterval = setInterval(() => {
      this.checkPendingRequests();
    }, 15000); // Verifica a cada 15 segundos
  }

  stopRequestMonitoring() {
    if (this.requestMonitorInterval) {
      clearInterval(this.requestMonitorInterval);
      this.requestMonitorInterval = null;
    }
  }

  /**
   * Get provider API service
   * @returns {Object} API service instance
   */
  getApiService() {
    return {
      fetchProductDataWithRetry: async (sku) => {
        return await this._fetchProductData(sku);
      }
    };
  }

  /**
   * Fetch product data from Vitacost API
   * @param {string} sku - Product SKU
   * @returns {Object} Product data
   * @private
   */
  async _fetchProductData(sku) {
    const MAX_ATTEMPTS = 2; // Changed from 3 to 2 (1 initial + 1 retry)
    const RETRY_DELAY = 2000; // 2 seconds
    const requestId = this.generateRequestId();
    const url = `${this.apiBaseUrl}/${sku}`;
    const startTime = Date.now();
    
    try {
      this.trackRequest(requestId, sku, url);
      logger.store('vitacost', 'info', `[REQ-${requestId}] Starting request for SKU ${sku} at ${url}`);
      
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          // Make request to Vitacost API through our backend endpoint
          const response = await axios.get(url, { timeout: 30000 }); // 30 second timeout
          
          const duration = Date.now() - startTime;
          logger.store('vitacost', 'info', `[REQ-${requestId}] Response received for SKU ${sku} - Status: ${response.status}, Duration: ${duration}ms`);
          
          // Log response if we get data
          if (response.data) {
            logger.store('vitacost', 'debug', `[REQ-${requestId}] SUCCESS - SKU ${sku} fetched on attempt ${attempt}`);
            
            // Check if the API response indicates success
            if (response.data.success === false) {
              logger.store('vitacost', 'warn', `[REQ-${requestId}] API FAILURE - SKU ${sku}: API returned success: false`);
              this.completeRequest(requestId, false);
              return response.data;
            }
            
            this.completeRequest(requestId, true);
            return response.data;
          }
          
          throw new Error('No data in response');
          
        } catch (error) {
          const duration = Date.now() - startTime;
          
          if (error.response) {
            logger.store('vitacost', 'error', `[REQ-${requestId}] HTTP ERROR - SKU ${sku}: Status ${error.response.status}, Duration: ${duration}ms`);
          } else if (error.code === 'ECONNABORTED') {
            logger.store('vitacost', 'error', `[REQ-${requestId}] TIMEOUT - SKU ${sku}: Request timed out after ${duration}ms`);
          } else if (error.code) {
            logger.store('vitacost', 'error', `[REQ-${requestId}] NETWORK ERROR - SKU ${sku}: ${error.code} - ${error.message}, Duration: ${duration}ms`);
          } else {
            logger.store('vitacost', 'error', `[REQ-${requestId}] UNKNOWN ERROR - SKU ${sku}: ${error.message}, Duration: ${duration}ms`);
          }
          
          logger.store('vitacost', 'warn', 
            `Attempt ${attempt}/${MAX_ATTEMPTS} failed for product ${sku}: ${error.message}. ` +
            (attempt < MAX_ATTEMPTS ? `Retrying in ${RETRY_DELAY}ms...` : '')
          );
          
          if (attempt === MAX_ATTEMPTS) {
            logger.store('vitacost', 'error', 
              `Failed to fetch product ${sku} after ${MAX_ATTEMPTS} attempts: ${error.message}`
            );
            
            this.completeRequest(requestId, false);
            
            // Return error structure
            return {
              success: false,
              error: error.message,
              sku: sku
            };
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.store('vitacost', 'error', `[REQ-${requestId}] FATAL ERROR - SKU ${sku}: ${error.message}, Duration: ${duration}ms`);
      this.completeRequest(requestId, false);
      
      return {
        success: false,
        error: error.message,
        sku: sku
      };
    }
  }

  /**
   * Transform Vitacost API data to our internal format
   * @param {Object} apiData - API response data
   * @param {string} sku - Product SKU
   * @returns {Object} Transformed product data
   * @private
   */
  _transformProductData(apiData, sku) {
    // First check if the API response is valid
    if (!apiData || apiData.success === false) {
      logger.store('vitacost', 'warn', `Product ${sku} - API returned success=false or invalid data`);
      
      // Mark as problematic if success is false
      if (apiData && apiData.success === false) {
        this.problematicProducts.push(sku);
      }
      
      return {
        sku: sku,
        price: 0,
        quantity: 0,
        availability: 'outOfStock',
        vitacostHandlingTime: this.providerSpecificHandlingTime,
        omdHandlingTime: this.handlingTimeOmd,
        available: false,
        discontinued: true,
        brand: '',
        upc: sku,
        mfn: '',
        url: '',
        rawData: apiData
      };
    }
    
    // Extract data from response - API returns data inside 'data' field
    const productData = apiData.data || apiData;
    
    // Calculate quantity and availability based on status
    let quantity = 0;
    let availability = 'outOfStock';
    
    if (productData.status === "OK" && apiData.success === true) {
      // Product is available - use stockLevel from config
      quantity = this.stockLevel;
      availability = 'inStock';
      this.inStockSet.add(sku);
      
      logger.store('vitacost', 'debug', `Product ${sku} - Available, using stockLevel: ${quantity}`);
    } else {
      // Product is not available
      quantity = 0;
      availability = 'outOfStock';
      this.outOfStockSet.add(sku);
      
      logger.store('vitacost', 'debug', `Product ${sku} - Unavailable (status: ${productData.status}), quantity: 0`);
    }
    
    // Parse price from string (remove $ and convert to number)
    let price = 0;
    if (productData.price && typeof productData.price === 'string') {
      price = parseFloat(productData.price.replace('$', ''));
    } else if (productData.salePrice) {
      price = productData.salePrice;
    }
    
    // Return transformed data
    return {
      sku: sku,
      price: price,
      quantity: quantity,
      availability: availability,
      vitacostHandlingTime: this.providerSpecificHandlingTime,
      omdHandlingTime: this.handlingTimeOmd,
      available: productData.status === "OK",
      discontinued: productData.status !== "OK",
      brand: productData.brand || '',
      upc: sku,
      mfn: '',
      url: productData.url || '',
      rawData: apiData
    };
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
    logger.store('vitacost', 'info', 'Starting Phase 1 - Individual Processing Mode');
    
    const startTime = Date.now();
    const effectiveRPS = requestsPerSecond || this.requestsPerSecond;
    
    // Initialize database connection
    await this.init();
    
    // Start request monitoring
    this.startRequestMonitoring();
    
    // Create simple queue for rate limiting
    const queue = new SimpleQueue(effectiveRPS);
    
    try {
      // Reset counters
      this.processedCount = 0;
      this.successCount = 0;
      this.errorCount = 0;
      this.inStockSet.clear();
      this.outOfStockSet.clear();
      this.totalRetries = 0;
      this.problematicProducts = [];
      this.updateStats = {
        newProducts: 0,
        updatedProducts: 0,
        priceChanges: 0,
        quantityChanges: 0,
        availabilityChanges: 0,
        brandChanges: 0,
        handlingTimeChanges: 0,
        errors: 0
      };
      
      // Get products from database
      let query = `
        SELECT sku, sku2, supplier_price, quantity, availability, brand
        FROM produtos 
        WHERE source = 'Vitacost'
      `;
      
      if (skipProblematic) {
        query += ` AND (sku_problem IS NULL OR sku_problem = 0)`;
      }
      
      query += ` ORDER BY last_update ASC`;
      
      const products = await this.dbService.fetchRowsWithRetry(query);
      logger.store('vitacost', 'info', `Found ${products.length} products to process`);
      
      // Initialize progress
      let progress = {
        totalProducts: products.length,
        processedProducts: 0,
        successCount: 0,
        failCount: 0,
        updatedProducts: 0,
        percentage: 0,
        currentBatch: 0,
        currentSku: '',
        phase: 'fetching'
      };
      
      if (updateProgress) {
        updateProgress(progress);
      }
      
      // Process products individually
      const promises = [];
      let isCancelled = false;
      
      for (let i = 0; i < products.length; i++) {
        // Check for cancellation
        if (checkCancellation && checkCancellation()) {
          logger.store('vitacost', 'info', 'Cancellation requested, stopping Phase 1');
          isCancelled = true;
          // Clear pending tasks from queue
          const clearedTasks = queue.clear();
          logger.store('vitacost', 'info', `Cleared ${clearedTasks} pending tasks from queue.`);
          break;
        }
        
        const product = products[i];
        progress.currentSku = product.sku;
        
        // Add to queue and process (without await to allow parallel processing)
        const promise = queue.add(async () => {
          // Check cancellation before processing each product
          if (checkCancellation && checkCancellation()) {
            logger.store('vitacost', 'info', `Skipping product ${product.sku} due to cancellation.`);
            return { status: 'cancelled' };
          }
          
          const result = await this.processProduct(product);
          
          if (result.status === 'updated') {
            progress.successCount++;
            progress.updatedProducts++;
            this.successCount++;
            this.updateStats.updatedProducts++;
          } else if (result.status === 'no_changes') {
            progress.successCount++;
            this.successCount++;
          } else if (result.status === 'failed') {
            progress.failCount++;
            this.errorCount++;
          }
          // Note: 'cancelled' status is not counted in any category
          
          // Update progress
          progress.processedProducts++;
          progress.percentage = Math.floor((progress.processedProducts / progress.totalProducts) * 100);
          
          if (updateProgress) {
            updateProgress(progress);
          }
        });
        
        promises.push(promise);
      }
      
      // Wait for all promises to complete
      await Promise.all(promises);
      
      // Check if cancelled after processing
      if (!isCancelled && checkCancellation && checkCancellation()) {
        isCancelled = true;
      }
      
      // Log final statistics
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      logger.store('vitacost', 'info', '======== Phase 1 Summary ========');
      logger.store('vitacost', 'info', `Total Products: ${progress.totalProducts}`);
      logger.store('vitacost', 'info', `Processed: ${this.processedCount}`);
      logger.store('vitacost', 'info', `Success: ${this.successCount}`);
      logger.store('vitacost', 'info', `Errors: ${this.errorCount}`);
      logger.store('vitacost', 'info', `In Stock: ${this.inStockSet.size}`);
      logger.store('vitacost', 'info', `Out of Stock: ${this.outOfStockSet.size}`);
      logger.store('vitacost', 'info', `Execution Time: ${duration.toFixed(2)}s`);
      
      if (isCancelled) {
        logger.store('vitacost', 'info', 'Sync was CANCELLED by user');
      }
      
      logger.store('vitacost', 'info', '');
      logger.store('vitacost', 'info', '=== Update Details ===');
      logger.store('vitacost', 'info', `Total products updated: ${this.updateStats.updatedProducts}`);
      if (this.updateStats.priceChanges > 0)
        logger.store('vitacost', 'info', `  price changes: ${this.updateStats.priceChanges}`);
      if (this.updateStats.quantityChanges > 0)
        logger.store('vitacost', 'info', `  quantity changes: ${this.updateStats.quantityChanges}`);
      if (this.updateStats.availabilityChanges > 0)
        logger.store('vitacost', 'info', `  availability changes: ${this.updateStats.availabilityChanges}`);
      if (this.updateStats.brandChanges > 0)
        logger.store('vitacost', 'info', `  brand changes: ${this.updateStats.brandChanges}`);
      logger.store('vitacost', 'info', `Stock status: ${this.inStockSet.size} in stock, ${this.outOfStockSet.size} out of stock`);
      
      // Add problematic products count
      if (this.problematicProducts.length > 0) {
        logger.store('vitacost', 'info', `Problematic products (marked): ${this.problematicProducts.length}`);
      }
      
      logger.store('vitacost', 'info', '===========================');
      
      // Batch update all problematic products
      if (this.problematicProducts.length > 0) {
        logger.store('vitacost', 'info', `❌ Updating ${this.problematicProducts.length} problematic products in database...`);
        try {
          // Create placeholders for the query
          const placeholders = this.problematicProducts.map((_, index) => `$${index + 2}`).join(', ');
          const query = `
            UPDATE produtos 
            SET sku_problem = true, atualizado = $1, last_update = NOW()
            WHERE sku2 IN (${placeholders}) AND source = 'Vitacost'
          `;
          const params = [this.updateFlagValue, ...this.problematicProducts];
          
          await this.dbService.executeWithRetry(query, params);
          logger.store('vitacost', 'info', `✅ Successfully marked ${this.problematicProducts.length} products as problematic`);
        } catch (error) {
          logger.store('vitacost', 'error', `Failed to batch update problematic products: ${error.message}`);
        }
      }
      
      // Return results
      return {
        success: !isCancelled,
        cancelled: isCancelled,
        executionTime: duration,
        totalProducts: progress.totalProducts,
        processedProducts: this.processedCount,
        successCount: this.successCount,
        failCount: this.errorCount,
        inStock: this.inStockSet.size,
        outOfStock: this.outOfStockSet.size,
        problematicProducts: this.problematicProducts,
        updateStats: this.updateStats
      };
      
    } catch (error) {
      logger.store('vitacost', 'error', `Phase 1 error: ${error.message}`, { error });
      throw error;
    } finally {
      // Stop request monitoring
      this.stopRequestMonitoring();
      
      // Clear any remaining pending requests
      this.pendingRequests.clear();
      
      // Close database connection
      await this.close();
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Log final statistics
      logger.store('vitacost', 'info', '=== VITACOST SYNC STATISTICS ===');
      logger.store('vitacost', 'info', `Total Products Processed: ${this.processedCount}`);
      logger.store('vitacost', 'info', `Successful Updates: ${this.successCount}`);
      logger.store('vitacost', 'info', `Errors: ${this.errorCount}`);
      logger.store('vitacost', 'info', `Total Duration: ${Math.round(duration / 1000)}s`);
      logger.store('vitacost', 'info', `Price Changes: ${this.updateStats.priceChanges}`);
      logger.store('vitacost', 'info', `Quantity Changes: ${this.updateStats.quantityChanges}`);
      logger.store('vitacost', 'info', `Availability Changes: ${this.updateStats.availabilityChanges}`);
      logger.store('vitacost', 'info', `Brand Changes: ${this.updateStats.brandChanges}`);
      logger.store('vitacost', 'info', `Handling Time Changes: ${this.updateStats.handlingTimeChanges}`);
      logger.store('vitacost', 'info', `In Stock: ${this.inStockSet.size}`);
      logger.store('vitacost', 'info', `Out of Stock: ${this.outOfStockSet.size}`);
      logger.store('vitacost', 'info', '===============================');
    }
  }

  /**
   * Mark product as problematic in the database
   * @param {string} sku - Product SKU
   * @private
   */
  async markProductAsProblematic(sku) {
    // Just add to array - batch update will be done at the end
    this.problematicProducts.push(sku);
    logger.store('vitacost', 'info', `❌ FAILED PRODUCT: ${sku} - Added to problematic list`);
  }

  /**
   * Process a single product
   * @param {Object} product - Product data from database
   * @returns {Object} Processing result
   */
  async processProduct(product) {
    const { sku, sku2 } = product;
    if (!sku) {
      logger.store('vitacost', 'warn', 'Skipping product with empty SKU.');
      return { status: 'failed', message: 'Empty SKU' };
    }
    
    try {
      // Fetch fresh data from API using sku (not sku2!)
      const apiData = await this._fetchProductData(sku);
      
      // Check if API returned error
      if (!apiData || apiData.success === false) {
        logger.store('vitacost', 'warn', `Product ${sku} - API error or invalid response`);
        
        // Mark as problematic using sku2
        await this.markProductAsProblematic(sku);
        
        return { status: 'failed', message: 'API error or product unavailable' };
      }
      
      // Transform and update product
      const transformedData = this._transformProductData(apiData, sku);
      const updateResult = await this.updateProductInDb({
        sku2: sku2,
        currentData: product,
        newData: transformedData
      });
      
      return updateResult; // Return the actual status from updateProductInDb
      
    } catch (error) {
      logger.store('vitacost', 'error', `Error processing product ${sku}: ${error.message}`);
      this.problematicProducts.push(sku);
      return { status: 'failed', message: error.message };
    }
  }

  /**
   * Update product in database with detailed change tracking
   * @private
   */
  async updateProductInDb({ sku2, currentData, newData }) {
    const changes = [];
    let hasChanges = false;
    
    // Compare and track price changes
    const oldPrice = parseFloat(currentData.supplier_price) || 0;
    const newPrice = parseFloat(newData.price) || 0;
    if (oldPrice !== newPrice) {
      changes.push(`  price: $${oldPrice.toFixed(2)} → $${newPrice.toFixed(2)}`);
      hasChanges = true;
      this.updateStats.priceChanges++;
    }
    
    // Compare and track quantity changes
    const oldQuantity = parseInt(currentData.quantity) || 0;
    const newQuantity = parseInt(newData.quantity) || 0;
    if (oldQuantity !== newQuantity) {
      changes.push(`  quantity: ${oldQuantity} → ${newQuantity}`);
      hasChanges = true;
      this.updateStats.quantityChanges++;
    }
    
    // Compare and track availability changes
    const oldAvailability = currentData.availability || 'outOfStock';
    const newAvailability = newData.availability || 'outOfStock';
    if (oldAvailability !== newAvailability) {
      changes.push(`  availability: ${oldAvailability} → ${newAvailability}`);
      hasChanges = true;
      this.updateStats.availabilityChanges++;
    }
    
    // Compare and track brand changes
    const oldBrand = currentData.brand || '';
    const newBrand = newData.brand || '';
    if (oldBrand !== newBrand) {
      changes.push(`  brand: "${oldBrand}" → "${newBrand}"`);
      hasChanges = true;
      this.updateStats.brandChanges++;
    }
    
    // Calculate handling time for comparison
    let handlingTimeAmz = newData.vitacostHandlingTime + newData.omdHandlingTime;
    if (handlingTimeAmz > 29) {
      handlingTimeAmz = 29;
    }
    
    // Compare and track handling time changes
    const oldHandlingTime = parseInt(currentData.handling_time_amz) || 0;
    const newHandlingTime = handlingTimeAmz;
    if (oldHandlingTime !== newHandlingTime) {
      changes.push(`  handling_time: ${oldHandlingTime} → ${newHandlingTime}`);
      hasChanges = true;
      this.updateStats.handlingTimeChanges++;
    }
    
    if (hasChanges) {
      // Status icon based on changes type
      let statusIcon = '✅'; // Success update
      if (newData.availability === 'outOfStock' && oldAvailability === 'inStock') {
        statusIcon = '⭕'; // Out of stock
      } else if (newData.availability === 'inStock' && oldAvailability === 'outOfStock') {
        statusIcon = '🔄'; // Back in stock
      }
      
      logger.info(`${statusIcon} Product ${sku2} updated with changes:`);
      logger.info(changes.join('\n'));
      
      if (handlingTimeAmz > 29) {
        logger.store('vitacost', 'warn', 
          `⚠️ Handling time for ${sku2} exceeds maximum: ${newData.vitacostHandlingTime + newData.omdHandlingTime} days. Limited to 29 days.`
        );
      }
      
      // Update database
      const updateQuery = `
        UPDATE produtos 
        SET 
          supplier_price = $1,
          quantity = $2,
          availability = $3,
          brand = $4,
          lead_time = $5,
          lead_time_2 = $6,
          handling_time_amz = $7,
          atualizado = $8,
          last_update = NOW(),
          sku_problem = false
        WHERE sku2 = $9 AND source = 'Vitacost'
      `;
      
      await this.dbService.executeWithRetry(updateQuery, [
        newData.price,
        newData.quantity,
        newData.availability,
        newData.brand,
        newData.omdHandlingTime.toString(),
        newData.vitacostHandlingTime,
        handlingTimeAmz,
        this.updateFlagValue,
        sku2
      ]);
      
      this.updateStats.updatedProducts++;
      return { status: 'updated', changes };
    } else {
      // No changes, just update last_update timestamp and mark as processed
      await this.dbService.executeWithRetry(
        `UPDATE produtos SET last_update = NOW(), sku_problem = false WHERE sku2 = $1 AND source = 'Vitacost'`,
        [sku2]
      );
      return { status: 'no_changes' };
    }
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
    logger.store('vitacost', 'info', `Running Phase 2 for ${this.getName()} provider`);
    
    // IMPORTANTE: Forçar o tamanho do batch para 9990 sempre, independente do valor passado
    // Isso garante compatibilidade com as regras da Amazon SP-API
    const fixedBatchSize = 9990;
    if (batchSize !== fixedBatchSize) {
      logger.store('vitacost', 'info', `Adjusting batch size from ${batchSize} to fixed value of ${fixedBatchSize} for Amazon compatibility`);
      batchSize = fixedBatchSize;
    }
    
    try {
      // Definir a variável de ambiente para o phase2.js saber que estamos no provedor Vitacost
      process.env.CURRENT_PROVIDER_ID = 'vitacost';
      process.env.VITACOST_UPDATE_FLAG_VALUE = this.updateFlagValue.toString();
      
      // Antes de chamar o phase2, garantir que estamos conectados ao banco
      await this.init();
      
      // Chamar a implementação padrão do Phase2 que já possui a lógica para processar o relatório
      const result = await require('../phases/phase2').mainPhase2(
        batchSize,
        checkInterval,
        checkCancellation,
        updateProgress
      );
      
      // Incluir informações adicionais no retorno
      return {
        success: result,
        totalProducts: updateProgress ? updateProgress.totalProducts : 0,
        successCount: updateProgress ? updateProgress.successCount : 0,
        failCount: updateProgress ? updateProgress.failCount : 0,
        reportJson: updateProgress && updateProgress.reportJson ? updateProgress.reportJson : null
      };
    } catch (error) {
      logger.store('vitacost', 'error', `Error in ${this.getName()} Phase 2: ${error.message}`, { error });
      throw error;
    } finally {
      // Garantir que a conexão com o banco de dados seja fechada
      await this.close();
      logger.store('vitacost', 'info', `Database connection closed after Phase 2 for ${this.getName()}`);
    }
  }

  /**
   * Create inventory feed for Amazon
   * @param {Array<Object>} products - Products to include in feed
   * @returns {Object} Amazon inventory feed
   * @private
   */
  _createInventoryFeed(products) {
    // Create feed in Amazon SP-API format
    const feed = {
      header: {
        sellerId: process.env.AMAZON_SELLER_ID || "SELLER_ID_PLACEHOLDER",
        version: "2.0",
        issueLocale: "en_US"
      },
      messages: []
    };
    
    // Add each product to feed
    products.forEach((product, index) => {
      feed.messages.push({
        messageId: index + 1,
        sku: product.sku2,
        operationType: "PARTIAL_UPDATE",
        productType: "PRODUCT",
        attributes: {
          fulfillment_availability: [
            {
              fulfillment_channel_code: "DEFAULT",
              quantity: product.quantity,
              lead_time_to_ship_max_days: product.handling_time_amz
            }
          ]
        }
      });
    });
    
    return feed;
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
        WHERE atualizado = ${this.updateFlagValue} AND source = 'Vitacost'
      `,
      resetUpdatedProducts: `
        UPDATE produtos
        SET atualizado = 0
        WHERE atualizado = ${this.updateFlagValue} AND source = 'Vitacost'
      `
    };
  }

  /**
   * Reset updated products after Phase 2
   * @returns {Promise<void>}
   */
  async resetUpdatedProducts() {
    // Inicializar conexão com o banco de dados
    await this.init();
    
    try {
      const query = this.getPhase2Queries().resetUpdatedProducts;
      const result = await this.dbService.executeWithRetry(query);
      
      logger.store('vitacost', 'info', `Reset updated status for ${result.affectedRows || 0} ${this.getName()} products`);
      return result;
    } catch (error) {
      logger.store('vitacost', 'error', `Error resetting updated products for ${this.getName()}: ${error.message}`, { error });
      throw error;
    } finally {
      // Garantir que a conexão com o banco de dados seja fechada
      await this.close();
      logger.store('vitacost', 'info', `Database connection closed after resetting updated products for ${this.getName()}`);
    }
  }
}

module.exports = VitacostProvider; 