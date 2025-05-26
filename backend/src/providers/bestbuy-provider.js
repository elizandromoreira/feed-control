/**
 * Best Buy Provider
 * 
 * Implementation of the provider interface for Best Buy supplier.
 * This is completely independent from other provider implementations.
 */

const BaseProvider = require('./provider-interface');
const DatabaseService = require('../services/database');
const { DB_CONFIG } = require('../config/db');
const logger = require('../config/logging')();
const axios = require('axios');
const retry = require('async-retry');
// Usar nossa implementação simples de fila em vez de p-queue
const SimpleQueue = require('../utils/simple-queue');

/**
 * Best Buy Provider implementation
 */
class BestBuyProvider extends BaseProvider {
  /**
   * @param {Object} config - Provider configuration
   */
  constructor(config = {}) {
    super(config);
    this.apiBaseUrl = config.apiBaseUrl || process.env.BESTBUY_API_BASE_URL || 'http://167.114.223.83:3005/bb/api';
    this.dbService = new DatabaseService(DB_CONFIG);
    
    // Debug das variáveis de ambiente no construtor
    logger.info('=== DEBUG BestBuyProvider constructor ===');
    logger.info(`BESTBUY_STOCK_LEVEL (env): ${process.env.BESTBUY_STOCK_LEVEL}`);
    logger.info(`BESTBUY_BATCH_SIZE (env): ${process.env.BESTBUY_BATCH_SIZE}`);
    logger.info(`BESTBUY_REQUESTS_PER_SECOND (env): ${process.env.BESTBUY_REQUESTS_PER_SECOND}`);
    logger.info(`BESTBUY_HANDLING_TIME (env): ${process.env.BESTBUY_HANDLING_TIME}`);
    logger.info(`BESTBUY_HANDLING_TIME_OMD (env): ${process.env.BESTBUY_HANDLING_TIME_OMD}`);
    logger.info(`BESTBUY_UPDATE_FLAG_VALUE (env): ${process.env.BESTBUY_UPDATE_FLAG_VALUE}`);
    logger.info(`LEAD_TIME_OMD (global env): ${process.env.LEAD_TIME_OMD}`);
    
    // Usar prioritariamente as variáveis específicas do provider, com fallback para variáveis genéricas
    this.stockLevel = parseInt(process.env.BESTBUY_STOCK_LEVEL || process.env.STOCK_LEVEL || '30', 10);
    this.batchSize = parseInt(process.env.BESTBUY_BATCH_SIZE || process.env.BATCH_SIZE || '240', 10);
    this.handlingTimeOmd = parseInt(process.env.BESTBUY_HANDLING_TIME_OMD || process.env.LEAD_TIME_OMD || '2', 10);
    this.bestbuyHandlingTime = parseInt(process.env.BESTBUY_HANDLING_TIME || '3', 10);
    this.requestsPerSecond = parseInt(process.env.BESTBUY_REQUESTS_PER_SECOND || process.env.REQUESTS_PER_SECOND || '6', 10);
    this.updateFlagValue = parseInt(process.env.BESTBUY_UPDATE_FLAG_VALUE || '4', 10);
    
    // Debug dos valores após parse
    logger.info('Valores utilizados após parsear:');
    logger.info(`- stockLevel: ${this.stockLevel}`);
    logger.info(`- batchSize: ${this.batchSize}`);
    logger.info(`- handlingTimeOmd: ${this.handlingTimeOmd}`);
    logger.info(`- bestbuyHandlingTime: ${this.bestbuyHandlingTime}`);
    logger.info(`- requestsPerSecond: ${this.requestsPerSecond}`);
    logger.info(`- updateFlagValue: ${this.updateFlagValue}`);
    logger.info('==============================');
    
    // Contadores para estatísticas
    this.inStockCount = 0;
    this.outOfStockCount = 0;
    this.retryCount = 0;
    this.dbInitialized = false;
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
    return 'bestbuy';
  }

  /**
   * Get provider name
   * @returns {string} Provider name
   */
  getName() {
    return 'Best Buy';
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
   * Fetch product data from Best Buy API
   * @param {string} sku - Product SKU
   * @returns {Promise<Object>} Product data
   * @private
   */
  async _fetchProductData(sku) {
    try {
      const url = `${this.apiBaseUrl}/${sku}`;
      logger.info(`Fetching Best Buy product data: ${url}`);
      
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
            logger.warn(`Retry fetching Best Buy data for SKU ${sku}: ${error.message}`);
          }
        }
      );
      
      if (!response.data) {
        throw new Error('Empty response data');
      }
      
      // Verificar se a resposta tem uma estrutura aninhada com "success" e "data"
      const productData = response.data.success && response.data.data ? response.data.data : response.data;
      
      // Log da estrutura de dados para depuração
      logger.debug(`Product data structure for SKU ${sku}: ${JSON.stringify(productData)}`);
      
      // Transform API response to our internal format
      return this._transformProductData(productData, sku);
      
    } catch (error) {
      logger.error(`Error fetching Best Buy product data for SKU ${sku}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transform Best Buy API data to our internal format
   * @param {Object} apiData - API response data
   * @param {string} sku - Product SKU
   * @returns {Object} Transformed product data
   * @private
   */
  _transformProductData(apiData, sku) {
    // Log para depuração da estrutura de dados recebida
    logger.debug(`Transforming data for SKU ${sku}: ${JSON.stringify(apiData)}`);

    // Verificar disponibilidade do produto
    let quantity = 0;
    const isAvailable = apiData.availability === "InStock";
    
    if (isAvailable) {
      // Como não temos números específicos de estoque, use o nível de estoque configurado
      quantity = this.stockLevel;
      this.inStockCount++;
    } else {
      // Se não está disponível, quantidade deve ser SEMPRE zero
      quantity = 0;
      this.outOfStockCount++;
    }
    
    // Usar tempos de handling específicos
    const bestbuyHandlingTime = this.bestbuyHandlingTime;
    const omdHandlingTime = this.handlingTimeOmd;
    
    // Extrair preço
    let price = 0;
    if (apiData.price) {
      price = parseFloat(apiData.price);
    }
    
    // Definir valor de availability explicitamente
    const availability = isAvailable ? 'inStock' : 'outOfStock';
    
    // Retornar dados transformados
    return {
      sku: sku,
      price: price,
      quantity: quantity,
      bestbuyHandlingTime: bestbuyHandlingTime,
      omdHandlingTime: omdHandlingTime,
      available: isAvailable,
      discontinued: apiData.availability !== "InStock",
      title: apiData.product_name || '',
      brand: apiData.brand || '',
      upc: apiData.ean || sku,
      mfn: apiData.model || '',
      url: apiData.product_url || '',
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
      this.inStockCount = 0;
      this.outOfStockCount = 0;
      this.retryCount = 0;
      
      // 1. Get products from database
      const query = `
        SELECT 
          sku, sku2 
        FROM produtos 
        WHERE source = 'Best Buy' 
        ORDER BY last_update ASC
      `;
      
      const products = await this.dbService.fetchRowsWithRetry(query);
      logger.info(`Found ${products.length} Best Buy products to process`);
      
      // Initialize progress
      let progress = {
        totalProducts: products.length,
        processedProducts: 0,
        successCount: 0,
        failCount: 0,
        updatedProducts: 0,
        startTime: startTime
      };
      
      if (updateProgress) {
        updateProgress(progress);
      }

      // Define a concorrência máxima baseada no requestsPerSecond
      const concurrency = requestsPerSecond || this.requestsPerSecond;
      logger.info(`Using concurrency of ${concurrency} parallel requests`);
      
      // Processar produtos em lotes concorrentes
      const batchSize = 20; // Tamanho de cada lote
      for (let i = 0; i < products.length; i += batchSize) {
        // Verificar cancelamento antes de cada lote
        if (checkCancellation && checkCancellation()) {
          logger.info('Cancellation requested, stopping Phase 1');
          break;
        }
        
        const batch = products.slice(i, i + batchSize);
        logger.info(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(products.length/batchSize)} (${batch.length} products)`);
        
        // Criar um array de promessas para processamento paralelo
        const promisesToProcess = batch.map(async (product) => {
          try {
            const productData = await apiService.fetchProductDataWithRetry(product.sku);
            
            // Get current product from database for comparison
            const currentProduct = await this.dbService.fetchRowWithRetry(
              'SELECT supplier_price, quantity, lead_time, lead_time_2, handling_time_amz, brand FROM produtos WHERE sku2 = $1 AND source = $2',
              [product.sku2, 'Best Buy']
            );
            
            // Check if product data has changed
            let hasChanges = false;
            
            if (currentProduct) {
              // Convert values for comparison
              const currentPrice = parseFloat(currentProduct.supplier_price || 0);
              const currentQuantity = parseInt(currentProduct.quantity || 0, 10);
              const currentBrand = currentProduct.brand || '';
              
              // Normalizar handling time para comparação
              const currentLeadTime = parseInt(currentProduct.lead_time || 0, 10);
              const currentLeadTime2 = parseInt(currentProduct.lead_time_2 || 0, 10);
              const currentHandlingTime = parseInt(currentProduct.handling_time_amz || 0, 10);
              
              // Calcular o novo handling_time_amz como a soma dos dois tempos de handling
              let handlingTimeAmz = productData.bestbuyHandlingTime + productData.omdHandlingTime;
              if (handlingTimeAmz > 29) {
                logger.warn(`Handling time for SKU ${product.sku} exceeds maximum limit: ${handlingTimeAmz} days. Limiting to 29 days.`);
                handlingTimeAmz = 29;
              }
              
              // Compare values to detect changes
              if (Math.abs(currentPrice - productData.price) > 0.01) {
                logger.info(`Product ${product.sku}: Price changed: ${currentPrice} ----> ${productData.price}`);
                hasChanges = true;
              }
              
              if (currentQuantity !== productData.quantity) {
                logger.info(`Product ${product.sku}: Quantity changed: ${currentQuantity} ----> ${productData.quantity}`);
                hasChanges = true;
              }
              
              if (currentLeadTime !== productData.omdHandlingTime) {
                logger.info(`Product ${product.sku}: OMD Handling Time changed: ${currentLeadTime} ----> ${productData.omdHandlingTime}`);
                hasChanges = true;
              }
              
              if (currentLeadTime2 !== productData.bestbuyHandlingTime) {
                logger.info(`Product ${product.sku}: Best Buy Handling Time changed: ${currentLeadTime2} ----> ${productData.bestbuyHandlingTime}`);
                hasChanges = true;
              }
              
              if (currentHandlingTime !== handlingTimeAmz) {
                logger.info(`Product ${product.sku}: Total Handling Time changed: ${currentHandlingTime} ----> ${handlingTimeAmz}`);
                hasChanges = true;
              }
              
              if ((currentBrand === '' || currentBrand === null) && productData.brand !== '') {
                logger.info(`Product ${product.sku}: Brand added: ${productData.brand}`);
                hasChanges = true;
              } else if (currentBrand !== productData.brand && productData.brand !== '') {
                // Only log if the new brand is not empty
                logger.info(`Product ${product.sku}: Brand changed: ${currentBrand} ----> ${productData.brand}`);
                hasChanges = true;
              }
            } else {
              // Product not found in DB, likely an error or new product, consider logging
              logger.warn(`Product SKU ${product.sku} (SKU2: ${product.sku2}) not found in the database for comparison.`);
              // Decide if this should be treated as a change or an error
              // For now, let's assume it's not a change we update
              hasChanges = false; // Or perhaps true if you want to insert it
              // If treating as error:
              // progress.failCount++;
              // throw new Error(`Product SKU ${product.sku} not found in DB`);
            }

            // Update product if changes detected
            if (hasChanges) {
              const updateQuery = `
                UPDATE produtos 
                SET 
                  supplier_price = $1, 
                  quantity = $2, 
                  availability = $3,
                  lead_time = $4, 
                  lead_time_2 = $5, 
                  handling_time_amz = $6,
                  atualizado = $7,
                  last_update = NOW(),
                  brand = $8
                WHERE sku2 = $9 AND source = 'Best Buy'
              `;

              // Calculate new handling time and availability
              let newQuantity = productData.quantity;
              let newAvailability = (newQuantity > 0) ? 'inStock' : 'outOfStock';
              let handlingTimeAmz = productData.bestbuyHandlingTime + productData.omdHandlingTime;
              if (handlingTimeAmz > 29) handlingTimeAmz = 29; // Apply limit

              const params = [
                productData.price,
                newQuantity,
                newAvailability,
                productData.omdHandlingTime,
                productData.bestbuyHandlingTime,
                handlingTimeAmz,
                this.updateFlagValue, // Mark as updated
                productData.brand,
                product.sku2
              ];

              logger.info(`UPDATE para ${product.sku}: Definindo 'atualizado' = ${this.updateFlagValue} (BESTBUY_UPDATE_FLAG_VALUE = ${this.updateFlagValue})`);
              await this.dbService.executeWithRetry(updateQuery, params);
              progress.updatedProducts++;
            }

            // Update stock counts
            if (productData.quantity > 0) {
              this.inStockCount++;
            } else {
              this.outOfStockCount++;
            }

            progress.successCount++;

          } catch (error) {
            logger.error(`Failed to process Best Buy SKU ${product.sku}: ${error.message}`, { sku: product.sku, error });
            progress.failCount++;
          } finally {
            // Increment processed count and update progress AFTER EACH product
            progress.processedProducts++;
            if (updateProgress) {
              updateProgress(progress);
            }
          }
        });

        // Aguardar todas as promessas do lote serem resolvidas
        await Promise.allSettled(promisesToProcess);

        // Pequena pausa entre lotes para não sobrecarregar APIs ou DB
        await new Promise(resolve => setTimeout(resolve, 100)); // Pausa de 100ms
      }

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      logger.info(`Phase 1 for ${this.getName()} completed in ${duration.toFixed(2)} seconds`);
      logger.info(`Stats: Processed=${progress.processedProducts}, Success=${progress.successCount}, Fail=${progress.failCount}, Updated=${progress.updatedProducts}`);
      logger.info(`Stock Stats: In Stock=${this.inStockCount}, Out of Stock=${this.outOfStockCount}, Retries=${this.retryCount}`);

      // Final progress update
      if (updateProgress) {
        updateProgress(progress);
      }

      // Return result
      return {
        success: true,
        executionTime: duration,
        totalProducts: progress.totalProducts,
        processedProducts: progress.processedProducts,
        successCount: progress.successCount,
        failCount: progress.failCount,
        updatedProducts: progress.updatedProducts,
        inStock: this.inStockCount,
        outOfStock: this.outOfStockCount,
        retries: this.retryCount
      };
      
    } catch (error) {
      logger.error(`Error in Phase 1 for ${this.getName()}: ${error.message}`, { error });
      throw error;
    } finally {
      // Ensure database connection is closed
      await this.close();
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
    // Isso garante compatibilidade com as regras da Amazon SP-API
    const fixedBatchSize = 9990;
    if (batchSize !== fixedBatchSize) {
      logger.info(`Adjusting batch size from ${batchSize} to fixed value of ${fixedBatchSize} for Amazon compatibility`);
      batchSize = fixedBatchSize;
    }
    
    try {
      // Definir a variável de ambiente para o phase2.js
      process.env.CURRENT_PROVIDER_ID = 'bestbuy';
      process.env.BESTBUY_UPDATE_FLAG_VALUE = this.updateFlagValue.toString();
      
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
        WHERE atualizado = ${this.updateFlagValue} AND source = 'Best Buy'
      `,
      resetUpdatedProducts: `
        UPDATE produtos
        SET atualizado = 0
        WHERE atualizado = ${this.updateFlagValue} AND source = 'Best Buy'
      `
    };
  }

  /**
   * Reset updated products after Phase 2
   * @returns {Promise<void>}
   */
  async resetUpdatedProducts() {
    try {
      logger.info(`Resetting updated products flag for ${this.getName()}`);
      
      // Ensure database connection is initialized
      await this.init();
      
      // Get query for resetting updated products
      const { resetUpdatedProducts } = this.getPhase2Queries();
      
      // Execute query
      const result = await this.dbService.executeWithRetry(resetUpdatedProducts);
      
      logger.info(`Reset updated flag for ${result.rowCount} products for ${this.getName()}`);
    } catch (error) {
      logger.error(`Error resetting updated products for ${this.getName()}: ${error.message}`, { error });
      throw error;
    } finally {
      // Ensure database connection is closed
      await this.close();
    }
  }
}

module.exports = BestBuyProvider;