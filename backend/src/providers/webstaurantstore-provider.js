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
    
    // Debug das variáveis de ambiente no construtor
    logger.info('=== DEBUG WebstaurantstoreProvider constructor ===');
    logger.info(`WEBSTAURANTSTORE_STOCK_LEVEL (env): ${process.env.WEBSTAURANTSTORE_STOCK_LEVEL}`);
    logger.info(`WEBSTAURANTSTORE_BATCH_SIZE (env): ${process.env.WEBSTAURANTSTORE_BATCH_SIZE}`);
    logger.info(`WEBSTAURANTSTORE_REQUESTS_PER_SECOND (env): ${process.env.WEBSTAURANTSTORE_REQUESTS_PER_SECOND}`);
    logger.info(`WEBSTAURANTSTORE_HANDLING_TIME (env): ${process.env.WEBSTAURANTSTORE_HANDLING_TIME}`);
    logger.info(`WEBSTAURANTSTORE_HANDLING_TIME_OMD (env): ${process.env.WEBSTAURANTSTORE_HANDLING_TIME_OMD}`);
    logger.info(`WEBSTAURANTSTORE_UPDATE_FLAG_VALUE (env): ${process.env.WEBSTAURANTSTORE_UPDATE_FLAG_VALUE}`);
    logger.info(`LEAD_TIME_OMD (global env): ${process.env.LEAD_TIME_OMD}`);
    
    // Usar prioritariamente as variáveis específicas do provider, com fallback para variáveis genéricas
    this.stockLevel = parseInt(process.env.WEBSTAURANTSTORE_STOCK_LEVEL || process.env.STOCK_LEVEL || '32', 10);
    this.batchSize = parseInt(process.env.WEBSTAURANTSTORE_BATCH_SIZE || process.env.BATCH_SIZE || '240', 10);
    this.handlingTimeOmd = parseInt(process.env.WEBSTAURANTSTORE_HANDLING_TIME_OMD || process.env.LEAD_TIME_OMD || '2', 10);
    this.webstaurantstoreHandlingTime = parseInt(process.env.WEBSTAURANTSTORE_HANDLING_TIME || '3', 10);
    this.requestsPerSecond = parseInt(process.env.WEBSTAURANTSTORE_REQUESTS_PER_SECOND || process.env.REQUESTS_PER_SECOND || '1', 10);
    this.updateFlagValue = parseInt(process.env.WEBSTAURANTSTORE_UPDATE_FLAG_VALUE || '5', 10);
    
    // Debug dos valores após parse
    logger.info('Valores utilizados após parsear:');
    logger.info(`- stockLevel: ${this.stockLevel}`);
    logger.info(`- batchSize: ${this.batchSize}`);
    logger.info(`- handlingTimeOmd: ${this.handlingTimeOmd}`);
    logger.info(`- webstaurantstoreHandlingTime: ${this.webstaurantstoreHandlingTime}`);
    logger.info(`- requestsPerSecond: ${this.requestsPerSecond}`);
    logger.info(`- updateFlagValue: ${this.updateFlagValue}`);
    logger.info('==============================');
    
    // Contadores para estatísticas
    this.inStockCount = 0;
    this.outOfStockCount = 0;
    this.retryCount = 0;
    this.dbInitialized = false;
    
    // Log configuration
    logger.info(`Webstaurantstore Provider initialized with:`);
    logger.info(`API Base URL: ${this.apiBaseUrl}`);
    logger.info(`Stock Level: ${this.stockLevel}`);
    logger.info(`Handling Time OMD: ${this.handlingTimeOmd}`);
    logger.info(`Handling Time Webstaurantstore: ${this.webstaurantstoreHandlingTime}`);
    logger.info(`Requests Per Second: ${this.requestsPerSecond}`);
    logger.info(`Update Flag Value: ${this.updateFlagValue}`);
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
      this.inStockCount++;
    } else {
      this.outOfStockCount++;
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
      this.inStockCount = 0;
      this.outOfStockCount = 0;
      this.retryCount = 0;
      
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
          }
          
          return true;
        } catch (error) {
          progress.errorCount++;
          
          // Se estamos pulando produtos problemáticos, apenas log
          if (skipProblematic) {
            logger.warn(`Skipping problematic product ${product.sku}: ${error.message}`);
            return false;
          }
          
          // Para erros específicos da API, marcar como fora de estoque mas continuar
          if (error.message.includes('status code 500') || 
              error.message.includes('status code 404') || 
              error.message.includes('timeout')) {
            try {
              logger.info(`Produto ${product.sku} com erro da API: Marcando como fora de estoque (quantity=0)`);
              
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
                
                logger.info(`Produto ${product.sku} marcado como fora de estoque após erro da API`);
              }
              
              return false;
            } catch (updateError) {
              logger.error(`Erro ao marcar produto ${product.sku} como fora de estoque: ${updateError.message}`);
              return false;
            }
          }
          
          throw error; // Para outros tipos de erros, repassamos para tratamento externo
        }
      };
      
      // Processamento em lotes, respeitando o número máximo de requisições por segundo
      const batchSize = rateLimit * 2; // Tamanho do lote como múltiplo do rate limit
      
      // Processa produtos em lotes
      for (let i = 0; i < products.length; i += batchSize) {
        // Check if the process should be cancelled before each batch
        if (checkCancellation && checkCancellation()) {
          logger.info('Phase 1 cancelled by user');
          return {
            success: false,
            message: 'Operation cancelled by user',
            inStockCount: this.inStockCount,
            outOfStockCount: this.outOfStockCount,
            totalProducts: progress.totalProducts,
            processedProducts: progress.processedProducts,
            updatedProducts: progress.updatedProducts,
            errorCount: progress.errorCount,
            retryCount: this.retryCount,
            elapsedTime: Date.now() - startTime
          };
        }
        
        const batch = products.slice(i, i + batchSize);
        logger.info(`Processando lote ${Math.floor(i/batchSize) + 1}/${Math.ceil(products.length/batchSize)} (${batch.length} produtos)`);
        
        // Processa o lote atual com limitação de concorrência
        const promises = batch.map((product, index) => {
          const delayMs = Math.floor(index / rateLimit) * 1000; // Agrupa requests por segundo
          return new Promise(resolve => {
            setTimeout(async () => {
              try {
                await processProduct(product);
              } catch (error) {
                logger.error(`Erro no processamento do produto ${product.sku}: ${error.message}`);
              } finally {
                progress.processedProducts++;
                if (updateProgress) {
                  updateProgress(progress);
                }
                resolve();
              }
            }, delayMs);
          });
        });
        
        // Aguarda a conclusão de todo o lote
        await Promise.all(promises);
      }
      
      // 3. Return results
      const endTime = Date.now();
      const elapsedTime = endTime - startTime;
      
      logger.info(`Phase 1 completed in ${elapsedTime}ms`);
      logger.info(`Processed ${progress.processedProducts} of ${progress.totalProducts} products`);
      logger.info(`Updated ${progress.updatedProducts} products`);
      logger.info(`In stock: ${this.inStockCount}, Out of stock: ${this.outOfStockCount}`);
      logger.info(`Errors: ${progress.errorCount}, Retries: ${this.retryCount}`);
      
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
}

module.exports = WebstaurantstoreProvider; 