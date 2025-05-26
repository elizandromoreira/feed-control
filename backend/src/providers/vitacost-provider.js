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
const retry = require('async-retry');

/**
 * Vitacost Provider implementation
 */
class VitacostProvider extends BaseProvider {
  /**
   * @param {Object} config - Provider configuration
   */
  constructor(config = {}) {
    super(config);
    this.apiBaseUrl = config.apiBaseUrl || process.env.VITACOST_API_BASE_URL || 'http://167.114.223.83:3005/vc';
    this.dbService = new DatabaseService(DB_CONFIG);
    
    // Debug das variáveis de ambiente no construtor
    logger.info('=== DEBUG VitacostProvider constructor ===');
    logger.info(`VITACOST_STOCK_LEVEL (env): ${process.env.VITACOST_STOCK_LEVEL}`);
    logger.info(`VITACOST_BATCH_SIZE (env): ${process.env.VITACOST_BATCH_SIZE}`);
    logger.info(`VITACOST_REQUESTS_PER_SECOND (env): ${process.env.VITACOST_REQUESTS_PER_SECOND}`);
    logger.info(`VITACOST_HANDLING_TIME (env): ${process.env.VITACOST_HANDLING_TIME}`);
    logger.info(`VITACOST_HANDLING_TIME_OMD (env): ${process.env.VITACOST_HANDLING_TIME_OMD}`);
    logger.info(`VITACOST_UPDATE_FLAG_VALUE (env): ${process.env.VITACOST_UPDATE_FLAG_VALUE}`);
    logger.info(`LEAD_TIME_OMD (global env): ${process.env.LEAD_TIME_OMD}`);
    
    // Usar prioritariamente as variáveis específicas do provider, com fallback para variáveis genéricas
    this.stockLevel = parseInt(process.env.VITACOST_STOCK_LEVEL || process.env.STOCK_LEVEL || '5', 10);
    this.batchSize = parseInt(process.env.VITACOST_BATCH_SIZE || process.env.BATCH_SIZE || '240', 10);
    this.handlingTimeOmd = parseInt(process.env.VITACOST_HANDLING_TIME_OMD || process.env.LEAD_TIME_OMD || '2', 10);
    this.vitacostHandlingTime = parseInt(process.env.VITACOST_HANDLING_TIME || '2', 10);
    this.requestsPerSecond = parseInt(process.env.VITACOST_REQUESTS_PER_SECOND || process.env.REQUESTS_PER_SECOND || '7', 10);
    this.updateFlagValue = parseInt(process.env.VITACOST_UPDATE_FLAG_VALUE || '2', 10);
    
    // Debug dos valores após parse
    logger.info('Valores utilizados após parsear:');
    logger.info(`- stockLevel: ${this.stockLevel}`);
    logger.info(`- batchSize: ${this.batchSize}`);
    logger.info(`- handlingTimeOmd: ${this.handlingTimeOmd}`);
    logger.info(`- vitacostHandlingTime: ${this.vitacostHandlingTime}`);
    logger.info(`- requestsPerSecond: ${this.requestsPerSecond}`);
    logger.info(`- updateFlagValue: ${this.updateFlagValue}`);
    logger.info('==============================');
    
    // Contadores para estatísticas de estoque
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
    return 'vitacost';
  }

  /**
   * Get provider name
   * @returns {string} Provider name
   */
  getName() {
    return 'Vitacost';
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
   * @returns {Promise<Object>} Product data
   * @private
   */
  async _fetchProductData(sku) {
    try {
      const url = `${this.apiBaseUrl}/${sku}`;
      logger.info(`Fetching Vitacost product data: ${url}`);
      
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
            logger.warn(`Retry fetching Vitacost data for SKU ${sku}: ${error.message}`);
          }
        }
      );
      
      if (!response.data || !response.data.success) {
        throw new Error('Empty response data or unsuccessful response');
      }
      
      // Transform API response to our internal format
      return this._transformProductData(response.data.data, sku);
      
    } catch (error) {
      logger.error(`Error fetching Vitacost product data for SKU ${sku}: ${error.message}`);
      throw error;
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
    // Vitacost doesn't provide stock information directly
    // We'll assume it's in stock if status is "OK"
    let quantity = 0;
    const isAvailable = apiData.status === "OK";
    
    if (isAvailable) {
      // Since we don't have actual stock numbers, use stock level as the quantity
      quantity = this.stockLevel;
      this.inStockCount++;
    } else {
      // Se não está disponível, quantidade deve ser SEMPRE zero
      // Garantir que quantidade seja estritamente zero para produtos indisponíveis
      quantity = 0;
      this.outOfStockCount++;
    }
    
    // Usar apenas o tempo de manuseio específico da Vitacost
    // O handling_time_amz (tempo total) será calculado no momento da atualização do banco de dados
    const vitacostHandlingTime = this.vitacostHandlingTime;
    
    // Parse price from string (remove $ and convert to number)
    let price = 0;
    if (apiData.price && typeof apiData.price === 'string') {
      price = parseFloat(apiData.price.replace('$', ''));
    } else if (apiData.salePrice) {
      price = apiData.salePrice;
    }
    
    // Return transformed data
    return {
      sku: sku,
      price: price,
      quantity: quantity,
      vitacostHandlingTime: vitacostHandlingTime,
      omdHandlingTime: this.handlingTimeOmd,
      available: isAvailable,
      discontinued: apiData.status !== "OK",
      title: apiData.name || '',
      brand: apiData.brand || '',
      upc: sku,
      mfn: '',
      url: apiData.url || '',
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
        WHERE source = 'Vitacost' 
        ORDER BY last_update ASC
      `;
      
      const products = await this.dbService.fetchRowsWithRetry(query);
      logger.info(`Found ${products.length} Vitacost products to process`);
      
      // Initialize progress
      let progress = {
        totalProducts: products.length,
        processedProducts: 0,
        successCount: 0,
        failCount: 0,
        percentage: 0
      };
      
      // Update progress if callback provided
      if (updateProgress) {
        updateProgress(progress);
      }
      
      // Rate limiter setup
      const rateLimiter = {
        lastRequestTime: Date.now(),
        requestDelay: 1000 / (requestsPerSecond || this.requestsPerSecond)
      };
      
      // 2. Process each product
      for (let i = 0; i < products.length; i++) {
        // Check for cancellation
        if (checkCancellation && checkCancellation()) {
          logger.info('Cancellation requested, stopping Vitacost provider Phase 1');
          break;
        }
        
        const product = products[i];
        
        try {
          // Apply rate limiting
          const now = Date.now();
          const elapsed = now - rateLimiter.lastRequestTime;
          if (elapsed < rateLimiter.requestDelay) {
            await new Promise(resolve => setTimeout(resolve, rateLimiter.requestDelay - elapsed));
          }
          rateLimiter.lastRequestTime = Date.now();
          
          // Fetch data from Vitacost API
          const productData = await apiService.fetchProductDataWithRetry(product.sku);
          
          // Buscar os dados atuais do produto antes de atualizar
          const currentProductQuery = `
            SELECT supplier_price, quantity, handling_time_amz, brand
            FROM produtos
            WHERE sku2 = $1 AND source = 'Vitacost'
          `;
          
          const currentProductData = await this.dbService.fetchRowsWithRetry(currentProductQuery, [product.sku2]);
          const currentProduct = currentProductData[0] || {};
          
          // Calcular o handling time como a soma para comparação
          const calculatedHandlingTime = productData.vitacostHandlingTime + productData.omdHandlingTime;
          
          // Comparar e logar as diferenças
          let hasChanges = false;
          let changesLog = [];
          
          if (currentProduct) {
            // Normaliza os valores de preço para evitar problemas de comparação de ponto flutuante
            const currentPrice = parseFloat(Number(currentProduct.supplier_price || 0).toFixed(2));
            const newPrice = parseFloat(Number(productData.price || 0).toFixed(2));
            
            if (currentPrice !== newPrice) {
              changesLog.push(`Preço: ${currentPrice} → ${newPrice}`);
              hasChanges = true;
            }
            
            if (Number(currentProduct.quantity) !== Number(productData.quantity)) {
              changesLog.push(`Quantidade: ${currentProduct.quantity} → ${productData.quantity}`);
              hasChanges = true;
            }
            
            // Normalizar handling time para comparação
            const currentHandlingTime = Number(currentProduct.handling_time_amz || 0);
            
            if (currentHandlingTime !== calculatedHandlingTime) {
              changesLog.push(`Handling Time: ${currentHandlingTime} → ${calculatedHandlingTime}`);
              hasChanges = true;
            }
            
            if (currentProduct.brand !== productData.brand) {
              changesLog.push(`Marca: ${currentProduct.brand || 'N/A'} → ${productData.brand}`);
              hasChanges = true;
            }
            
            // Log somente se houver mudanças, com todas as mudanças em uma única linha
            if (hasChanges) {
              logger.info(`Produto ${product.sku2}: Alterações - ${changesLog.join(', ')}`);
            }
          } else {
            // Se o produto não existe no banco ainda, consideramos como uma mudança
            hasChanges = true;
            logger.info(`Produto ${product.sku2}: Novo produto adicionado`);
          }
          
          // Atualiza o banco de dados apenas se houver mudanças
          if (hasChanges) {
            // Calcular o handling_time_amz como a soma dos dois tempos de manuseio
            // Limitar a 29 dias para evitar erro "Value for 'Fulfillment Availability' is greater than the allowed maximum '30'"
            let handlingTimeAmz = productData.vitacostHandlingTime + productData.omdHandlingTime;
            if (handlingTimeAmz > 29) {
              logger.warn(`Tempo de entrega para ${product.sku} excede o limite máximo: ${handlingTimeAmz} dias. Limitando a 29 dias.`);
              handlingTimeAmz = 29;
            }
            
            // Update database with fetched data
            // Garantir que availability seja sempre definido com base na quantidade
            // Produtos com quantidade > 0 devem ser sempre 'inStock'
            // Produtos com quantidade = 0 devem ser sempre 'outOfStock'
            const availability = productData.quantity > 0 ? 'inStock' : 'outOfStock';
            
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
                availability = $8
              WHERE sku2 = $9 AND source = 'Vitacost'
            `;
            
            await this.dbService.executeWithRetry(updateQuery, [
              productData.price,
              productData.quantity,
              productData.omdHandlingTime.toString(),  // lead_time (OMD handling time)
              productData.vitacostHandlingTime,        // lead_time_2 (Vitacost handling time)
              handlingTimeAmz,                         // handling_time_amz (soma dos dois)
              this.updateFlagValue,
              productData.brand,
              availability,                            // availability baseado na quantidade
              product.sku2
            ]);
            
            progress.successCount++;
          } else {
            // Se não houver mudanças, apenas atualizamos a data da última verificação
            const updateLastCheckQuery = `
              UPDATE produtos 
              SET 
                last_update = NOW()
              WHERE sku2 = $1 AND source = 'Vitacost'
            `;
            
            await this.dbService.executeWithRetry(updateLastCheckQuery, [product.sku2]);
          }
          
        } catch (error) {
          logger.error(`Erro no produto ${product.sku}: ${error.message}`);
          progress.failCount++;
          
          // Marcar produto como fora de estoque em caso de erro da API
          if (error.message.includes('status code 500') || 
              error.message.includes('status code 404') || 
              error.message.includes('timeout') ||
              error.message.includes('Empty response data')) {
            try {
              logger.info(`Produto ${product.sku} com erro da API: Marcando como fora de estoque (quantity=0)`);
              
              // Buscar produto atual para obter dados necessários
              const currentProduct = await this.dbService.fetchRowWithRetry(
                'SELECT supplier_price, lead_time, lead_time_2, brand FROM produtos WHERE sku2 = $1 AND source = $2',
                [product.sku2, 'Vitacost']
              );
              
              if (currentProduct) {
                // Preparar dados para atualização
                const lead_time = currentProduct.lead_time || this.handlingTimeOmd.toString();
                const lead_time_2 = currentProduct.lead_time_2 || this.vitacostHandlingTime;
                
                // Calcular handling_time_amz
                let handlingTimeAmz = parseInt(lead_time_2, 10) + parseInt(lead_time, 10);
                if (handlingTimeAmz > 29) {
                  handlingTimeAmz = 29;
                }
                
                // Atualizar para quantidade zero (fora de estoque)
                // Quando a quantidade é zero, availability deve ser sempre 'outOfStock'
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
                  WHERE sku2 = $5 AND source = 'Vitacost'
                `;
                
                await this.dbService.executeWithRetry(updateQuery, [
                  lead_time,
                  lead_time_2,
                  handlingTimeAmz,
                  this.updateFlagValue,
                  product.sku2
                ]);
              }
            } catch (dbError) {
              logger.error(`Erro ao marcar produto ${product.sku} como fora de estoque: ${dbError.message}`);
            }
          }
          
          // Log failed product for later analysis
          try {
            const logQuery = `
              INSERT INTO failed_products (sku, source, error, timestamp)
              VALUES ($1, 'Vitacost', $2, NOW())
              ON CONFLICT (sku, source) 
              DO UPDATE SET error = $2, timestamp = NOW()
            `;
            
            await this.dbService.executeWithRetry(logQuery, [
              product.sku,
              error.message
            ]);
          } catch (logError) {
            logger.error(`Error logging failed product: ${logError.message}`);
          }
        }
        
        // Update progress
        progress.processedProducts++;
        progress.percentage = Math.floor((progress.processedProducts / progress.totalProducts) * 100);
        
        if (updateProgress) {
          updateProgress(progress);
        }
        
        // Imprimir progresso a cada 100 produtos ou ao final
        if (progress.processedProducts % 100 === 0 || progress.processedProducts === progress.totalProducts) {
          logger.info(`Progresso: ${progress.processedProducts}/${progress.totalProducts} (${progress.percentage}%)`);
        }
      }
      
      // Calcular métricas finais
      const endTime = Date.now();
      const processingTime = (endTime - startTime) / 1000;
      const apiCallCount = progress.processedProducts;
      const requestsPerSecondRate = apiCallCount > 0 ? apiCallCount / processingTime : 0;
      
      // Log detalhado de métricas em formato mais conciso
      logger.info(`
RESUMO ${this.getName()}: ${progress.successCount}/${progress.totalProducts} produtos atualizados em ${(processingTime / 60).toFixed(2)} min
Taxa: ${requestsPerSecondRate.toFixed(2)} produtos/s | Em estoque: ${this.inStockCount} | Fora: ${this.outOfStockCount} | Falhas: ${progress.failCount}
`);
      
      return {
        success: true,
        totalProducts: progress.totalProducts,
        successCount: progress.successCount,
        failCount: progress.failCount,
        inStockCount: this.inStockCount,
        outOfStockCount: this.outOfStockCount,
        processingTime,
        requestsPerSecondRate
      };
      
    } catch (error) {
      logger.error(`Error in ${this.getName()} Phase 1: ${error.message}`, { error });
      throw error;
    } finally {
      // Garantir que a conexão com o banco de dados seja fechada
      await this.close();
      logger.info(`Database connection closed after Phase 1 for ${this.getName()}`);
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
      logger.error(`Error in ${this.getName()} Phase 2: ${error.message}`, { error });
      throw error;
    } finally {
      // Garantir que a conexão com o banco de dados seja fechada
      await this.close();
      logger.info(`Database connection closed after Phase 2 for ${this.getName()}`);
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
      
      logger.info(`Reset updated status for ${result.affectedRows || 0} ${this.getName()} products`);
      return result;
    } catch (error) {
      logger.error(`Error resetting updated products for ${this.getName()}: ${error.message}`, { error });
      throw error;
    } finally {
      // Garantir que a conexão com o banco de dados seja fechada
      await this.close();
      logger.info(`Database connection closed after resetting updated products for ${this.getName()}`);
    }
  }
}

module.exports = VitacostProvider; 