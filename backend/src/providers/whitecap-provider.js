/**
 * White Cap Provider
 * 
 * Implementation of the provider interface for White Cap supplier.
 * This is completely independent from the Home Depot implementation.
 */

const BaseProvider = require('./provider-interface');
const DatabaseService = require('../services/database');
const { DB_CONFIG } = require('../config/db');
const logger = require('../config/logging')();
const axios = require('axios');
const retry = require('async-retry');

/**
 * White Cap Provider implementation
 */
class WhiteCapProvider extends BaseProvider {
  /**
   * @param {Object} config - Provider configuration
   */
  constructor(config = {}) {
    super(config);
    this.apiBaseUrl = config.apiBaseUrl || process.env.WHITECAP_API_BASE_URL || 'http://167.114.223.83:3005/wc/api';
    this.dbService = new DatabaseService(DB_CONFIG);
    
    // Debug das variáveis de ambiente no construtor
    logger.info('=== DEBUG WhiteCapProvider constructor ===');
    logger.info(`WHITECAP_STOCK_LEVEL (env): ${process.env.WHITECAP_STOCK_LEVEL}`);
    logger.info(`WHITECAP_BATCH_SIZE (env): ${process.env.WHITECAP_BATCH_SIZE}`);
    logger.info(`WHITECAP_REQUESTS_PER_SECOND (env): ${process.env.WHITECAP_REQUESTS_PER_SECOND}`);
    logger.info(`WHITECAP_HANDLING_TIME (env): ${process.env.WHITECAP_HANDLING_TIME}`);
    logger.info(`WHITECAP_HANDLING_TIME_OMD (env): ${process.env.WHITECAP_HANDLING_TIME_OMD}`);
    logger.info(`WHITECAP_UPDATE_FLAG_VALUE (env): ${process.env.WHITECAP_UPDATE_FLAG_VALUE}`);
    logger.info(`LEAD_TIME_OMD (global env): ${process.env.LEAD_TIME_OMD}`);
    
    // Usar prioritariamente as variáveis específicas do provider, com fallback para variáveis genéricas
    this.dbInitialized = false;
    this.stockLevel = parseInt(process.env.WHITECAP_STOCK_LEVEL || process.env.STOCK_LEVEL || '5', 10);
    this.batchSize = parseInt(process.env.WHITECAP_BATCH_SIZE || process.env.BATCH_SIZE || '240', 10);
    this.handlingTimeOmd = parseInt(process.env.WHITECAP_HANDLING_TIME_OMD || process.env.LEAD_TIME_OMD || '2', 10);
    this.whiteCapHandlingTime = parseInt(process.env.WHITECAP_HANDLING_TIME || '2', 10);
    this.requestsPerSecond = parseInt(process.env.WHITECAP_REQUESTS_PER_SECOND || process.env.REQUESTS_PER_SECOND || '6', 10);
    this.updateFlagValue = parseInt(process.env.WHITECAP_UPDATE_FLAG_VALUE || '3', 10);
    
    // Debug dos valores após parse
    logger.info('Valores utilizados após parsear:');
    logger.info(`- stockLevel: ${this.stockLevel}`);
    logger.info(`- batchSize: ${this.batchSize}`);
    logger.info(`- handlingTimeOmd: ${this.handlingTimeOmd}`);
    logger.info(`- whiteCapHandlingTime: ${this.whiteCapHandlingTime}`);
    logger.info(`- requestsPerSecond: ${this.requestsPerSecond}`);
    logger.info(`- updateFlagValue: ${this.updateFlagValue}`);
    logger.info('==============================');
    
    // Contadores para estatísticas
    this.inStockCount = 0;
    this.outOfStockCount = 0;
    this.retryCount = 0;
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
   * Close database connection and other resources
   * @returns {Promise<void>}
   */
  async close() {
    logger.info(`Closing ${this.getName()} provider resources`);
    if (this.dbInitialized) {
      await this.dbService.close();
      this.dbInitialized = false;
      logger.info(`${this.getName()} database connection closed`);
    }
    logger.info(`${this.getName()} provider resources closed successfully`);
  }

  /**
   * Get provider identifier
   * @returns {string} Provider ID
   */
  getId() {
    return 'whitecap';
  }

  /**
   * Get provider name
   * @returns {string} Provider name
   */
  getName() {
    return 'White Cap';
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
   * Fetch product data from White Cap API
   * @param {string} sku - Product SKU
   * @returns {Promise<Object>} Product data
   * @private
   */
  async _fetchProductData(sku) {
    try {
      const url = `${this.apiBaseUrl}/${sku}`;
      logger.info(`Fetching White Cap product data: ${url}`);
      
      const response = await retry(
        async (bail, attemptNumber) => {
          if (attemptNumber > 1) {
            logger.info(`Retry attempt #${attemptNumber} for SKU ${sku}`);
          }
          
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
            logger.warn(`Retry fetching White Cap data for SKU ${sku}: ${error.message}`);
          }
        }
      );
      
      if (!response.data) {
        throw new Error('Empty response data');
      }
      
      // Transform API response to our internal format
      return this._transformProductData(response.data, sku);
      
    } catch (error) {
      logger.error(`Error fetching White Cap product data for SKU ${sku}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Transform White Cap API data to our internal format
   * @param {Object} apiData - API response data
   * @param {string} sku - Product SKU
   * @returns {Object} Transformed product data
   * @private
   */
  _transformProductData(apiData, sku) {
    // Calculate quantity based on stock and availability
    let quantity = 0;
    if (apiData.available && apiData.stock > 0) {
      quantity = apiData.stock;
      
      // Apply stock level threshold if configured
      if (this.stockLevel > 0 && quantity > this.stockLevel) {
        quantity = this.stockLevel;
      }
      
      this.inStockCount++;
    } else {
      this.outOfStockCount++;
    }
    
    // Usar tempos de manuseio específicos para White Cap e OMD
    // O handling_time_amz (tempo total) será calculado no momento da atualização do banco de dados
    const whiteCapHandlingTime = this.whiteCapHandlingTime;
    
    // Return transformed data
    return {
      sku: sku,
      price: apiData.price || 0,
      quantity: quantity,
      whiteCapHandlingTime: whiteCapHandlingTime, // Valor específico da White Cap
      omdHandlingTime: this.handlingTimeOmd,      // Valor específico da OMD
      available: apiData.available || false,
      discontinued: apiData.discontinued || false,
      title: apiData.title || '',
      brand: apiData.brand || '',
      upc: apiData.upc || '',
      mfn: apiData.mfn || '',
      url: apiData.url || '',
      rawData: apiData // Store raw data for reference
    };
  }

  /**
   * Execute Phase 1 of synchronization (get product data from API)
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
        WHERE source = 'White Cap' 
        ORDER BY last_update ASC
      `;
      
      const products = await this.dbService.fetchRowsWithRetry(query);
      logger.info(`Found ${products.length} White Cap products to process`);
      
      if (products.length === 0) {
        return {
          success: true,
          message: 'No White Cap products found in database',
          inStockCount: 0,
          outOfStockCount: 0,
          totalProducts: 0,
          processedProducts: 0,
          errorCount: 0,
          retryCount: 0,
          elapsedTime: 0
        };
      }
      
      // Initialize progress tracking
      let progress = {
        totalProducts: products.length,
        processedProducts: 0,
        updatedProducts: 0,
        errorCount: 0,
        currentSku: null
      };
      
      // Update progress if callback provided
      if (updateProgress) {
        updateProgress(progress);
      }
      
      // Rate limiter setup - IMPORTANTE: valor explicitamente definido
      // Use o valor passado por parâmetro ou o do .env, e garanta que seja pelo menos 1
      const rps = requestsPerSecond || this.requestsPerSecond;
      const effectiveRps = Math.max(rps, 1);
      const rateLimiter = {
        lastRequestTime: 0, // Iniciar com 0 para permitir a primeira requisição imediatamente
        requestDelay: 1000 / effectiveRps
      };
      
      logger.info(`Rate limiter configurado com ${effectiveRps} requisições por segundo (delay: ${rateLimiter.requestDelay.toFixed(2)}ms)`);
      
      // Process products
      for (const product of products) {
        // Check for cancellation if callback provided
        if (checkCancellation && checkCancellation()) {
          logger.info('Processing cancelled by user request');
          break;
        }
        
        progress.currentSku = product.sku;
        
        try {
          // Apply rate limiting
          const now = Date.now();
          const elapsed = now - rateLimiter.lastRequestTime;
          if (elapsed < rateLimiter.requestDelay) {
            const waitTime = rateLimiter.requestDelay - elapsed;
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
          rateLimiter.lastRequestTime = Date.now();
          
          // Fetch product data from API
          const apiData = await apiService.fetchProductDataWithRetry(product.sku);
          
          if (!apiData) {
            progress.errorCount++;
            continue;
          }
          
          // Buscar os dados atuais do produto antes de atualizar
          const currentProductQuery = `
            SELECT supplier_price, quantity, availability, handling_time_amz, brand, lead_time, lead_time_2
            FROM produtos
            WHERE sku = $1 AND source = 'White Cap'
          `;
          
          const currentProductData = await this.dbService.fetchRowsWithRetry(currentProductQuery, [product.sku]);
          const currentProduct = currentProductData[0] || {};
          
          // Calcular o handling time como a soma para comparação
          const calculatedHandlingTime = apiData.whiteCapHandlingTime + apiData.omdHandlingTime;
          
          // Comparar e logar as diferenças
          let hasChanges = false;
          
          if (currentProduct) {
            // Normaliza os valores de preço para evitar problemas de comparação de ponto flutuante
            const currentPrice = parseFloat(Number(currentProduct.supplier_price || 0).toFixed(2));
            const newPrice = parseFloat(Number(apiData.price || 0).toFixed(2));
            
            if (currentPrice !== newPrice) {
              logger.info(`Produto ${product.sku}: Preço: ${currentProduct.supplier_price || 'N/A'} ----> ${apiData.price}`);
              hasChanges = true;
            }
            
            if (Number(currentProduct.quantity) !== Number(apiData.quantity)) {
              logger.info(`Produto ${product.sku}: Quantidade: ${currentProduct.quantity || 'N/A'} ----> ${apiData.quantity}`);
              hasChanges = true;
            }
            
            const currentAvailability = currentProduct.availability || 'N/A';
            const newAvailability = apiData.available ? 'inStock' : 'outOfStock';
            if (currentAvailability !== newAvailability) {
              logger.info(`Produto ${product.sku}: Disponibilidade: ${currentAvailability} ----> ${newAvailability}`);
              hasChanges = true;
            }
            
            // Normalizar handling time para comparação
            const currentHandlingTime = Number(currentProduct.handling_time_amz || 0);
            
            if (currentHandlingTime !== calculatedHandlingTime) {
              logger.info(`Produto ${product.sku}: Handling Time: ${currentProduct.handling_time_amz || 'N/A'} ----> ${calculatedHandlingTime}`);
              hasChanges = true;
            }
            
            if (currentProduct.brand !== apiData.brand) {
              logger.info(`Produto ${product.sku}: Marca: ${currentProduct.brand || 'N/A'} ----> ${apiData.brand}`);
              hasChanges = true;
            }
          } else {
            // Se o produto não existe no banco ainda, consideramos como uma mudança
            hasChanges = true;
            logger.info(`Produto ${product.sku}: Novo produto adicionado`);
          }
          
          // Atualiza o banco de dados apenas se houver mudanças ou produto for novo
          if (hasChanges) {
            // Calculate handling time
            const totalHandlingTime = apiData.whiteCapHandlingTime + apiData.omdHandlingTime;
            
            // Prepare update query
            const updateQuery = `
              UPDATE produtos 
              SET 
                supplier_price = $1,
                quantity = $2,
                availability = $3,
                lead_time = $4,
                lead_time_2 = $5,
                handling_time_amz = $6,
                brand = $7,
                last_update = NOW(),
                atualizado = $8
              WHERE sku = $9
              RETURNING *
            `;
            
            const updateResult = await this.dbService.executeWithRetry(updateQuery, [
              apiData.price,
              apiData.quantity,
              apiData.available ? 'inStock' : 'outOfStock',
              apiData.whiteCapHandlingTime,
              apiData.omdHandlingTime,
              totalHandlingTime,
              apiData.brand,
              this.updateFlagValue,
              product.sku
            ]);
            
            if (updateResult && updateResult.length > 0) {
              progress.updatedProducts++;
              logger.info(`Produto ${product.sku}: Atualizado com sucesso`);
            }
          } else {
            // Se não houver mudanças, apenas atualizamos a data da última verificação
            const updateLastCheckQuery = `
              UPDATE produtos 
              SET 
                last_update = NOW()
              WHERE sku = $1 AND source = 'White Cap'
            `;
            
            await this.dbService.executeWithRetry(updateLastCheckQuery, [product.sku]);
            logger.info(`Produto ${product.sku}: Sem alterações, apenas data de verificação atualizada`);
          }
          
        } catch (error) {
          logger.error(`Error processing SKU ${product.sku}: ${error.message}`);
          progress.errorCount++;
        }
        
        progress.processedProducts++;
        
        // Update progress
        if (updateProgress) {
          updateProgress({
            ...progress,
            percentage: Math.round((progress.processedProducts / progress.totalProducts) * 100)
          });
        }
      }
      
      const endTime = Date.now();
      const elapsedTime = endTime - startTime;
      const processingTime = elapsedTime / 1000;
      const apiCallCount = progress.processedProducts;
      const requestsPerSecondRate = apiCallCount > 0 ? apiCallCount / processingTime : 0;
      
      // Log detalhado de métricas para diagnóstico
      logger.info(`
==================================================
RESUMO DE PROCESSAMENTO DE PRODUTOS (${this.getName()})
==================================================
Horário de início: ${new Date(startTime).toISOString()}
Horário de término: ${new Date(endTime).toISOString()}
Duração total: ${(processingTime / 60).toFixed(2)} minutos
Total de produtos: ${progress.totalProducts}
Produtos processados: ${progress.processedProducts}
Produtos atualizados: ${progress.updatedProducts}
Erros: ${progress.errorCount}
Retentativas: ${this.retryCount}
Velocidade média: ${requestsPerSecondRate.toFixed(2)} produtos/segundo
Tempo médio por requisição: ${apiCallCount > 0 ? (processingTime / apiCallCount).toFixed(3) : 0}s

Produtos em estoque: ${this.inStockCount} produtos
Produtos fora de estoque: ${this.outOfStockCount} produtos
Porcentagem de produtos fora de estoque: ${((this.outOfStockCount / progress.totalProducts) * 100).toFixed(1)}%
`);
      
      return {
        success: true,
        inStockCount: this.inStockCount,
        outOfStockCount: this.outOfStockCount,
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
    } finally {
      await this.close();
    }
  }

  /**
   * Execute Phase 2 of synchronization (submit feed to Amazon)
   * @param {number} batchSize - Size of each batch to send to Amazon
   * @param {number} checkInterval - Interval to check feed status in milliseconds
   * @param {Function} checkCancellation - Function to check if process should be cancelled
   * @param {Function} updateProgress - Function to update progress information
   * @returns {Promise<Object>} Result of feed submission
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
      // Definir a variável de ambiente para o phase2.js saber que estamos no provedor White Cap
      process.env.CURRENT_PROVIDER_ID = 'whitecap';
      process.env.WHITECAP_UPDATE_FLAG_VALUE = this.updateFlagValue.toString();
      
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
      logger.error(`Error in ${this.getName()} Phase 2: ${error.message}`, { error });
      throw error;
    } finally {
      // Garantir que a conexão com o banco de dados seja fechada
      await this.close();
      logger.info(`Database connection closed after Phase 2 for ${this.getName()}`);
    }
  }

  /**
   * Reset updated products
   * @returns {Promise<Object>} Result of reset operation
   */
  async resetUpdatedProducts() {
    logger.info(`Resetting updated products flags for ${this.getName()}`);
    await this.init();
    
    try {
      const queries = this.getPhase2Queries();
      const result = await this.dbService.executeWithRetry(queries.resetUpdatedProducts);
      
      const count = result?.rowCount || 0;
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
        WHERE atualizado = ${this.updateFlagValue} AND source = 'White Cap'
      `,
      resetUpdatedProducts: `
        UPDATE produtos
        SET atualizado = 0
        WHERE atualizado = ${this.updateFlagValue} AND source = 'White Cap'
      `
    };
  }
}

module.exports = WhiteCapProvider; 