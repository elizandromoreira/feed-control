/**
 * Webstaurantstore Provider
 * 
 * Implementation of the provider interface for Webstaurantstore supplier.
 * This is completely independent from other provider implementations.
 */

const BaseProvider = require('./provider-interface');
const DatabaseService = require('../services/database');
const { DB_CONFIG } = require('../config/db');
const logger = require('../config/logging')();
const SimpleQueue = require('../utils/SimpleQueue');
const axios = require('axios');
const retry = require('async-retry');

/**
 * Webstaurantstore Provider implementation
 */
class WebstaurantstoreProvider extends BaseProvider {
  /**
   * @param {Object} config - Provider configuration
   */
  constructor(config = {}) {
    super(config);
    this.apiBaseUrl = config.apiBaseUrl || process.env.WEBSTAURANTSTORE_API_BASE_URL || 'http://167.114.223.83:3005/wr/api';
    this.dbService = new DatabaseService(DB_CONFIG);
    
    // Use values from store_configurations (passed via config) instead of hardcoded .env
    this.stockLevel = config.stockLevel ?? 32; // Default 32 if not provided
    this.handlingTimeOmd = config.handlingTimeOmd ?? 1; // OMD handling time
    this.webstaurantstoreHandlingTime = config.providerSpecificHandlingTime ?? 3; // Provider specific handling time
    this.updateFlagValue = config.updateFlagValue ?? 5; // Update flag value
    this.requestsPerSecond = config.requestsPerSecond ?? 1; // Requests per second from store_configurations
    
    // Log configuration values from store_configurations
    logger.info('WebstaurantStore Provider initialized with store_configurations:');
    logger.info(`- API Base URL: ${this.apiBaseUrl}`);
    logger.info(`- Stock Level: ${this.stockLevel}`);
    logger.info(`- Handling Time OMD: ${this.handlingTimeOmd}`);
    logger.info(`- Handling Time WebstaurantStore: ${this.webstaurantstoreHandlingTime}`);
    logger.info(`- Requests Per Second: ${this.requestsPerSecond}`);
    logger.info(`- Update Flag Value: ${this.updateFlagValue}`);
    
    this.dbInitialized = false;
    
    // Array to track problematic products for batch update
    this.problematicProducts = [];
    
    // Use Sets to track unique stock counts
    this.inStockSet = new Set();
    this.outOfStockSet = new Set();
    
    // Counters for statistics
    this.retryCount = 0;
    this.inStockCount = 0;
    this.outOfStockCount = 0;
  }

  /**
   * Initialize the database connection if not already initialized
   */
  async init() {
    if (!this.dbInitialized) {
      await this.dbService.init();
      this.dbInitialized = true;
      logger.info(`Database connection initialized for ${this.getName()} provider`);
    }
  }

  /**
   * Close the database connection
   */
  async close() {
    if (this.dbInitialized) {
      try {
        await this.dbService.close();
        logger.info(`Database connection closed for ${this.getName()} provider`);
      } catch (error) {
        // Se o erro for sobre fechar a conexão mais de uma vez, apenas logamos e continuamos
        if (error.message && error.message.includes('Called end on pool more than once')) {
          logger.info(`Database connection for ${this.getName()} provider was already closed`);
        } else {
          // Se for outro tipo de erro, propagamos
          throw error;
        }
      } finally {
        // Garantimos que o estado seja atualizado independentemente do resultado
        this.dbInitialized = false;
      }
    } else {
      logger.info(`Database connection for ${this.getName()} provider was already closed or never initialized`);
    }
  }

  /**
   * Get provider identifier
   * @returns {string} Provider ID
   */
  getId() {
    return 'webstaurantstore';
  }

  /**
   * Get provider name
   * @returns {string} Provider name
   */
  getName() {
    return 'Webstaurantstore';
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
   * Fetch product data from Webstaurantstore API
   * @param {string} sku - Product SKU
   * @returns {Promise<Object>} Product data
   * @private
   */
  async _fetchProductData(sku) {
    try {
      const url = `${this.apiBaseUrl}/${sku}`;
      logger.info(`Fetching Webstaurantstore product data: ${url}`);
      
      const response = await retry(
        async () => {
          const result = await axios.get(url, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'FeedControl/1.0'
            },
            timeout: 30000
          });
          
          if (result.status !== 200) {
            throw new Error(`API returned status ${result.status}`);
          }
          
          return result;
        },
        {
          retries: 3,
          minTimeout: 1000,
          maxTimeout: 5000,
          onRetry: (error) => {
            this.retryCount++;
            logger.warn(`Retry fetching Webstaurantstore data for SKU ${sku}: ${error.message}`);
          }
        }
      );
      
      if (!response.data) {
        throw new Error('Empty response data');
      }
      
      // Transform API response to our internal format
      return this._transformProductData(response.data, sku);
      
    } catch (error) {
      logger.error(`Error fetching Webstaurantstore product data for SKU ${sku}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transform Webstaurantstore API data to our internal format
   * @param {Object} apiData - API response data
   * @param {string} sku - Product SKU
   * @returns {Object} Transformed product data
   * @private
   */
  _transformProductData(apiData, sku) {
    // Verificar disponibilidade do produto baseado em AMBOS os campos
    const isInStock = apiData.Availability === "InStock";
    const isQuickShip = apiData.isQuickShip === true; // Deve ser explicitamente true
    
    // Determinar quantidade e disponibilidade - precisa de AMBAS as condições
    let quantity = 0;
    let isAvailable = false;
    
    if (isInStock && isQuickShip) {
      // Produto está disponível apenas se AMBOS: Availability="InStock" E isQuickShip=true
      isAvailable = true;
      quantity = this.stockLevel; // Valor do .env (32)
    } else {
      // Se qualquer condição for falsa, produto fica fora de estoque
      isAvailable = false;
      quantity = 0;
    }
    
    if (isAvailable) {
      this.inStockSet.add(sku);
    } else {
      this.outOfStockSet.add(sku);
    }
    
    // Lógica de preços: priorizar Member Price, se for 0 usar Price
    let price = 0;
    const memberPrice = parseFloat(apiData["Member Price"] || 0);
    if (memberPrice > 0) {
      price = memberPrice;
    } else {
      price = parseFloat(apiData.Price || 0);
    }
    
    // Usar tempos de handling específicos do .env
    const webstaurantstoreHandlingTime = this.webstaurantstoreHandlingTime;
    const omdHandlingTime = this.handlingTimeOmd;
    
    // Definir valor de availability explicitamente
    const availability = isAvailable ? 'inStock' : 'outOfStock';
    
    // Log para debug
    logger.info(`Product ${sku}: Availability=${apiData.Availability}, isQuickShip=${apiData.isQuickShip}, Final: ${availability}, Quantity: ${quantity}, Price: ${price} (Member: ${memberPrice}, Regular: ${apiData.Price})`);
    
    // Retornar dados transformados
    return {
      sku: sku,
      price: price,
      quantity: quantity,
      webstaurantstoreHandlingTime: webstaurantstoreHandlingTime,
      omdHandlingTime: omdHandlingTime,
      available: isAvailable,
      discontinued: !isAvailable,
      title: apiData.Title || '',
      brand: apiData.Brand || '',
      upc: apiData["UPC Code"] || sku,
      mfn: apiData["Manufacturer Number"] || '',
      url: apiData.URL || '',
      availability: availability,
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
    logger.info(`Running Phase 1 for ${this.getName()} provider`);
    
    const startTime = Date.now();
    const apiService = this.getApiService();
    
    // Inicializar conexão com banco de dados se necessário
    await this.init();
    
    try {
      // Reset contadores para estatísticas
      this.inStockSet.clear();
      this.outOfStockSet.clear();
      this.retryCount = 0;
      this.problematicProducts = []; // Clear problematic products array
      
      logger.store('webstaurantstore', 'info', 'Starting Phase 1: Product synchronization');
      
      // 1. Get products from database
      const query = `
        SELECT 
          sku, sku2 
        FROM produtos 
        WHERE source = 'Webstaurantstore' 
        ORDER BY sku
      `;
      
      const products = await this.dbService.fetchRowsWithRetry(query);
      logger.info(`Found ${products.length} Webstaurantstore products in database`);
      
      if (products.length === 0) {
        return {
          success: true,
          message: 'No Webstaurantstore products found in database',
          inStockCount: 0,
          outOfStockCount: 0,
          totalProducts: 0,
          processedProducts: 0,
          errorCount: 0,
          retryCount: 0,
          elapsedTime: 0
        };
      }
      
      // Prepare progress tracking
      let progress = {
        totalProducts: products.length,
        processedProducts: 0,
        updatedProducts: 0,
        errorCount: 0,
        currentSku: null
      };
      
      // Set real request rate limit if provided
      const rateLimit = requestsPerSecond || this.requestsPerSecond;
      const requestDelay = 1000 / rateLimit;
      logger.info(`API request rate limit: ${rateLimit} req/s (delay: ${requestDelay}ms)`);
      
      // Função auxiliar para processar um produto
      const processProduct = async (product) => {
        try {
          // Update progress
          progress.currentSku = product.sku;
          
          // Obter dados atuais do produto no banco de dados para comparação
          const currentProductQuery = `
            SELECT 
              quantity, 
              supplier_price, 
              handling_time_amz
            FROM produtos 
            WHERE sku2 = $1 AND source = 'Webstaurantstore'
          `;
          
          const currentProduct = await this.dbService.fetchRowWithRetry(
            currentProductQuery, 
            [product.sku2]
          );
          
          // Processar produto
          const productData = await apiService.fetchProductDataWithRetry(product.sku);
          
          // Verificar se há mudanças para determinar se o produto deve ser atualizado
          let hasChanges = false;
          
          if (currentProduct) {
            // Normalizar valores para comparação
            const currentQuantity = Number(currentProduct.quantity || 0);
            const currentPrice = parseFloat(currentProduct.supplier_price || '0');
            const currentHandlingTime = Number(currentProduct.handling_time_amz || 0);
            
            const newQuantity = Number(productData.quantity);
            const newPrice = productData.price;
            const calculatedHandlingTime = productData.webstaurantstoreHandlingTime + productData.omdHandlingTime;
            
            // Determinar se há mudanças
            if (currentQuantity !== newQuantity) {
              logger.info(`Produto ${product.sku2}: Quantidade: ${currentQuantity} ----> ${newQuantity}`);
              hasChanges = true;
            }
            
            if (Math.abs(currentPrice - newPrice) > 0.01) {
              logger.info(`Produto ${product.sku2}: Preço: ${currentPrice} ----> ${newPrice}`);
              hasChanges = true;
            }
            
            if (currentHandlingTime !== calculatedHandlingTime) {
              logger.info(`Produto ${product.sku2}: Handling Time: ${currentHandlingTime} ----> ${calculatedHandlingTime}`);
              hasChanges = true;
            }
          } else {
            // Se o produto não existir no banco, qualquer dado é uma mudança
            hasChanges = true;
            logger.info(`Produto ${product.sku2}: Novo produto ou dados incompletos`);
          }
          
          // Se houver mudanças, atualizar o banco de dados
          if (hasChanges) {
            // Calcular o handling_time_amz como a soma dos dois tempos de manuseio
            let handlingTimeAmz = productData.webstaurantstoreHandlingTime + productData.omdHandlingTime;
            if (handlingTimeAmz > 29) {
              logger.warn(`Tempo de entrega excede o limite máximo: ${handlingTimeAmz} dias. Limitando a 29 dias.`);
              handlingTimeAmz = 29;
            }
            
            // Update database with fetched data
            const updateQuery = `
              UPDATE produtos 
              SET 
                supplier_price = $1, 
                quantity = $2,
                lead_time = $3,
                lead_time_2 = $4,
                handling_time_amz = $5,
                atualizado = $6, 
                last_update = NOW(),
                brand = $7,
                availability = $9
              WHERE sku2 = $8 AND source = 'Webstaurantstore'
            `;
            
            await this.dbService.executeWithRetry(updateQuery, [
              productData.price,
              productData.quantity,
              productData.omdHandlingTime.toString(),
              productData.webstaurantstoreHandlingTime,
              handlingTimeAmz,
              this.updateFlagValue,
              productData.brand,
              product.sku2,
              productData.availability
            ]);
            
            // Log update
            logger.info(`Updated product ${product.sku2} in database`);
            progress.updatedProducts++;
            return 'updated';
          } else {
            // No changes needed
            return 'no_changes';
          }
          
        } catch (error) {
          progress.errorCount++;
          
          // Se estamos pulando produtos problemáticos, apenas log
          if (skipProblematic) {
            logger.store('webstaurantstore', 'warn', `❌ Skipping problematic product ${product.sku}: ${error.message}`);
            return 'failed';
          }
          
          // Para erros específicos da API, marcar como fora de estoque mas continuar
          if (error.message.includes('status code 500') || 
              error.message.includes('status code 404') || 
              error.message.includes('timeout')) {
            try {
              logger.store('webstaurantstore', 'info', `❌ Product ${product.sku} API error: Setting as out of stock (quantity=0)`);
              
              // Buscar produto atual para obter dados necessários
              const currentProduct = await this.dbService.fetchRowWithRetry(
                'SELECT supplier_price, lead_time, lead_time_2, brand FROM produtos WHERE sku2 = $1 AND source = $2',
                [product.sku2, 'Webstaurantstore']
              );
              
              if (currentProduct) {
                // Preparar dados para atualização
                const lead_time = currentProduct.lead_time || this.handlingTimeOmd.toString();
                const lead_time_2 = currentProduct.lead_time_2 || this.webstaurantstoreHandlingTime;
                
                // Calcular handling_time_amz
                let handlingTimeAmz = parseInt(lead_time_2, 10) + parseInt(lead_time, 10);
                if (handlingTimeAmz > 29) {
                  handlingTimeAmz = 29;
                }
                
                // Atualizar para quantidade zero (fora de estoque)
                const updateQuery = `
                  UPDATE produtos 
                  SET 
                    quantity = 0,
                    lead_time = $1,
                    lead_time_2 = $2,
                    handling_time_amz = $3,
                    atualizado = $4,
                    availability = 'outOfStock',
                    last_update = NOW()
                  WHERE sku2 = $5 AND source = 'Webstaurantstore'
                `;
                
                await this.dbService.executeWithRetry(updateQuery, [
                  lead_time,
                  lead_time_2,
                  handlingTimeAmz,
                  this.updateFlagValue,
                  product.sku2
                ]);
                
                logger.store('webstaurantstore', 'info', `Product ${product.sku} marked as out of stock after API error`);
                this.outOfStockSet.add(product.sku2);
              }
              
              // Marcar produto como problemático
              this.markProductAsProblematic(product.sku, error.message);
              return 'failed';
            } catch (updateError) {
              logger.store('webstaurantstore', 'error', `❌ Error marking product ${product.sku} as out of stock: ${updateError.message}`);
              this.markProductAsProblematic(product.sku, updateError.message);
              return 'failed';
            }
          }
          
          // Marcar produto como problemático
          this.markProductAsProblematic(product.sku, error.message);
          logger.store('webstaurantstore', 'error', `❌ Error processing product ${product.sku}: ${error.message}`);
          return 'failed';
        }
      };
      
      // Use SimpleQueue for RPS-based processing like other providers
      const concurrency = rateLimit || this.requestsPerSecond;
      const queue = new SimpleQueue({ concurrency });
      logger.info(`Using SimpleQueue with concurrency: ${concurrency} req/s`);
      
      // Process all products through the queue
      const promises = products.map(async (product) => {
        return queue.add(async () => {
          // Check cancellation inside queue processing
          if (checkCancellation && checkCancellation()) {
            logger.info('Cancelling remaining queue tasks');
            queue.clear(); // Clear remaining tasks
            throw new Error('Cancelled by user');
          }
          
          try {
            const status = await processProduct(product);
            
            // Update progress counters based on status
            progress.processedProducts++;
            if (status === 'updated') {
              progress.updatedProducts++;
            } else if (status === 'failed') {
              progress.errorCount++;
            }
            
            if (updateProgress) {
              updateProgress(progress);
            }
            
            return status;
          } catch (error) {
            progress.errorCount++;
            progress.processedProducts++;
            
            if (updateProgress) {
              updateProgress(progress);
            }
            
            logger.store('webstaurantstore', 'error', `❌ Queue processing error for ${product.sku}: ${error.message}`);
            return 'failed';
          }
        });
      });
      
      // Track if operation was cancelled
      let isCancelled = false;
      
      // Wait for all products to be processed
      try {
        await Promise.all(promises);
      } catch (error) {
        if (error.message === 'Cancelled by user') {
          logger.info('Phase 1 cancelled by user during queue processing');
          isCancelled = true;
        } else {
          throw error;
        }
      }
      
      // Only do database operations if NOT cancelled
      if (!isCancelled && this.problematicProducts.length > 0) {
        try {
          const updateQuery = `
            UPDATE produtos 
            SET sku_problem = 1, last_update = NOW()
            WHERE sku2 = ANY($1) AND source = 'Webstaurantstore'
          `;
          
          const result = await this.dbService.executeWithRetry(updateQuery, [this.problematicProducts]);
          logger.store('webstaurantstore', 'info', `Batch updated ${result.rowCount} problematic products`);
        } catch (error) {
          logger.store('webstaurantstore', 'error', `Failed to batch update problematic products: ${error.message}`);
        }
      }
      
      // Return appropriate result based on cancellation status
      if (isCancelled) {
        return {
          success: false,
          message: 'Operation cancelled by user',
          inStockCount: this.inStockSet.size,
          outOfStockCount: this.outOfStockSet.size,
          totalProducts: progress.totalProducts,
          processedProducts: progress.processedProducts,
          updatedProducts: progress.updatedProducts,
          errorCount: progress.errorCount,
          retryCount: this.retryCount,
          elapsedTime: Date.now() - startTime
        };
      }
      
      // 3. Return results
      const endTime = Date.now();
      const elapsedTime = endTime - startTime;
      
      logger.info(`Phase 1 completed in ${elapsedTime}ms`);
      logger.info(`Processed ${progress.processedProducts} of ${progress.totalProducts} products`);
      logger.info(`Updated ${progress.updatedProducts} products`);
      logger.info(`In stock: ${this.inStockSet.size}, Out of stock: ${this.outOfStockSet.size}`);
      logger.info(`Errors: ${progress.errorCount}, Retries: ${this.retryCount}`);
      if (this.problematicProducts.length > 0) {
        logger.info(`Problematic products (marked): ${this.problematicProducts.length}`);
      }
      
      return {
        success: true,
        inStockCount: this.inStockSet.size,
        outOfStockCount: this.outOfStockSet.size,
        totalProducts: progress.totalProducts,
        processedProducts: progress.processedProducts,
        updatedProducts: progress.updatedProducts,
        errorCount: progress.errorCount,
        retryCount: this.retryCount,
        elapsedTime: elapsedTime
      };
      
    } catch (error) {
      logger.error(`Error in Phase 1: ${error.message}`, { error });
      throw error;
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
    logger.info(`Running Phase 2 for ${this.getName()} provider`);
    
    // IMPORTANTE: Forçar o tamanho do batch para 9990 sempre, independente do valor passado
    const fixedBatchSize = 9990;
    if (batchSize !== fixedBatchSize) {
      logger.info(`Adjusting batch size from ${batchSize} to fixed value of ${fixedBatchSize} for Amazon compatibility`);
      batchSize = fixedBatchSize;
    }
    
    try {
      // Definir a variável de ambiente para o phase2.js
      process.env.CURRENT_PROVIDER_ID = 'webstaurantstore';
      process.env.WEBSTAURANTSTORE_UPDATE_FLAG_VALUE = this.updateFlagValue.toString();
      
      // Antes de chamar o phase2, garantir que estamos conectados ao banco
      await this.init();
      
      // Chamar a implementação padrão do Phase2
      const result = await require('../phases/phase2').mainPhase2(
        batchSize,
        checkInterval,
        checkCancellation,
        updateProgress
      );
      
      // Retornar resultados
      return {
        success: result,
        totalProducts: updateProgress ? updateProgress.totalProducts : 0,
        successCount: updateProgress ? updateProgress.successCount : 0,
        failCount: updateProgress ? updateProgress.failCount : 0,
        reportJson: updateProgress && updateProgress.reportJson ? updateProgress.reportJson : null
      };
    } catch (error) {
      logger.error(`Error in ${this.getName()} Phase 2: ${error.message}`, { error });
      throw error;
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
        WHERE atualizado = ${this.updateFlagValue} AND source = 'Webstaurantstore'
      `,
      resetUpdatedProducts: `
        UPDATE produtos
        SET atualizado = 0
        WHERE atualizado = ${this.updateFlagValue} AND source = 'Webstaurantstore'
      `
    };
  }

  /**
   * Reset updated products after Phase 2
   * @returns {Promise<void>}
   */
  async resetUpdatedProducts() {
    // Garantir que estamos conectados ao banco
    await this.init();
    
    // Executar a consulta para resetar os produtos
    const query = this.getPhase2Queries().resetUpdatedProducts;
    const result = await this.dbService.executeWithRetry(query);
    
    logger.info(`Reset updated products for ${this.getName()}: ${result.rowCount} rows affected`);
  }

  // Mark product as problematic (add to batch list)
  markProductAsProblematic(sku, reason) {
    this.problematicProducts.push(sku);
    logger.store('webstaurantstore', 'warn', `❌ Product ${sku} marked as problematic: ${reason}`);
  }
}

module.exports = WebstaurantstoreProvider; 