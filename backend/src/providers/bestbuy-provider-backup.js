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
   * @param {Object} config - Provider configuration from the database
   */
  constructor(config = {}) {
    super(config);
    this.apiBaseUrl = config.apiBaseUrl || process.env.BESTBUY_API_BASE_URL || 'http://167.114.223.83:3005/bb/api';
    this.dbService = new DatabaseService(DB_CONFIG);
    
    // Prioritize database config (from 'config' object), use .env as a fallback.
    this.stockLevel = config.stockLevel ?? 30;
    this.handlingTimeOmd = config.handlingTimeOmd ?? 1;
    this.providerSpecificHandlingTime = config.providerSpecificHandlingTime ?? 3;
    this.updateFlagValue = config.updateFlagValue ?? 4;
    
    logger.info('--- BestBuyProvider Configured Values ---');
    logger.info(`- Source: ${config.storeId ? 'Database' : 'Fallback/Env'}`);
    logger.info(`- Stock Level: ${this.stockLevel}`);
    logger.info(`- OMD Handling Time: ${this.handlingTimeOmd}`);
    logger.info(`- Provider Specific Handling Time: ${this.providerSpecificHandlingTime}`);
    logger.info('-----------------------------------------');
    
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
    const url = `${this.apiBaseUrl}/${sku}`;
    const startTime = Date.now();
    
    try {
      logger.info(`Fetching Best Buy product data: ${url}`);
      
      const response = await retry(
        async (bail) => {
          const attemptStartTime = Date.now();
          logger.info(`[${sku}] Starting API request attempt (timeout: 30s)`);
          
          const result = await axios.get(url, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'FeedControl/1.0' },
            timeout: 30000
          });
          
          const attemptEndTime = Date.now();
          logger.info(`[${sku}] API request completed in ${attemptEndTime - attemptStartTime}ms`);
          
          // Validação da estrutura da resposta - crucial
          if (result.status !== 200) {
            logger.warn(`[${sku}] API returned non-200 status: ${result.status}`);
            throw new Error(`API returned status ${result.status}`);
          }
          
          // Log detalhado da resposta para debug
          logger.info(`[${sku}] Response validation - Status: ${result.status}, Data exists: ${!!result.data}, Success: ${result.data?.success}, Data.data exists: ${!!result.data?.data}`);
          
          if (!result.data || !result.data.success || !result.data.data) {
            // Log detalhado do problema
            logger.warn(`[${sku}] Invalid response structure:`, {
              hasData: !!result.data,
              success: result.data?.success,
              hasDataData: !!result.data?.data,
              responseType: typeof result.data,
              responseKeys: result.data ? Object.keys(result.data) : 'no data'
            });
            
            // Não fazer retry para respostas inválidas, mas que indicam um SKU inexistente.
            if (result.data && result.data.success === false) {
                logger.info(`[${sku}] API explicitly indicated SKU not found - bailing out`);
                bail(new Error(`API indicated SKU ${sku} not found, not retrying.`));
                return;
            }
            throw new Error(`Invalid or unsuccessful API response structure for SKU ${sku}`);
          }
          
          // VALIDAÇÃO EXTRA: Verificar se os dados essenciais estão presentes
          const apiData = result.data.data;
          if (!apiData.sku || !apiData.availability) {
            logger.error(`[${sku}] CRITICAL: Missing essential fields in API response:`, {
              hasSku: !!apiData.sku,
              hasAvailability: !!apiData.availability,
              hasPrice: apiData.price !== undefined,
              hasBrand: !!apiData.brand,
              actualSku: apiData.sku,
              actualAvailability: apiData.availability
            });
            throw new Error(`Missing essential fields in API response for SKU ${sku}`);
          }
          
          // VALIDAÇÃO EXTRA: Verificar se o SKU retornado bate com o solicitado
          if (apiData.sku !== sku) {
            logger.error(`[${sku}] CRITICAL: SKU mismatch - requested ${sku}, got ${apiData.sku}`);
            throw new Error(`SKU mismatch for ${sku} - API returned ${apiData.sku}`);
          }
          
          logger.info(`[${sku}] Response validation passed - proceeding with data transformation`);
          return result;
        },
        {
          retries: 3,
          minTimeout: 1000,
          maxTimeout: 5000,
          onRetry: (error, attempt) => {
            this.retryCount++;
            logger.warn(`[${sku}] Retry ${attempt}/3: ${error.message} (Error type: ${error.constructor.name})`);
            
            // Log específico para timeouts
            if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
              logger.warn(`[${sku}] Timeout detected on attempt ${attempt} - this may indicate API overload`);
            }
          }
        }
      );
      
      const endTime = Date.now();
      logger.info(`[${sku}] Successfully fetched data in ${endTime - startTime}ms total`);
      
      // Se chegamos aqui, a resposta é válida.
      const responseData = response.data;
      const transformedData = this._transformProductData(responseData.data, sku);
      
      logger.info(`[${sku}] Data transformation completed - Available: ${transformedData.available}, Stock: ${transformedData.stock}, Price: ${transformedData.price}`);
      
      // VALIDAÇÃO FINAL: Detectar transformações suspeitas
      const apiData = responseData.data;
      if (apiData.availability === "InStock" && (!transformedData.available || transformedData.stock === 0)) {
        logger.error(`[${sku}] 🚨 TRANSFORMATION BUG DETECTED!`, {
          apiAvailability: apiData.availability,
          apiPrice: apiData.price,
          apiBrand: apiData.brand,
          transformedAvailable: transformedData.available,
          transformedStock: transformedData.stock,
          transformedPrice: transformedData.price
        });
        
        // Forçar correção para produtos InStock que foram transformados incorretamente
        if (apiData.availability === "InStock") {
          logger.warn(`[${sku}] FORCING CORRECTION: Converting back to InStock`);
          transformedData.available = true;
          transformedData.stock = this.stockLevel;
          transformedData.price = apiData.price || 0;
          transformedData.brand = apiData.brand || '';
        }
      }
      
      return transformedData;
      
    } catch (error) {
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      // Log detalhado do erro final
      logger.error(`[${sku}] FINAL ERROR after ${totalTime}ms and retries:`, {
        message: error.message,
        code: error.code,
        type: error.constructor.name,
        stack: error.stack?.split('\n')[0] // Primeira linha do stack trace
      });
      
      // Log específico para diferentes tipos de erro
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        logger.error(`[${sku}] TIMEOUT ERROR - API request exceeded 30 seconds`);
      } else if (error.code === 'ECONNREFUSED') {
        logger.error(`[${sku}] CONNECTION REFUSED - API server may be down`);
      } else if (error.code === 'ENOTFOUND') {
        logger.error(`[${sku}] DNS ERROR - Cannot resolve API hostname`);
      }
      
      logger.warn(`[${sku}] Returning OutOfStock fallback data due to API failure`);
      
      // Se todas as tentativas falharem, retorna um objeto "OutOfStock" para desativar o produto.
      return {
          sku: sku,
          price: 0,
          brand: null, // Será tratado como string vazia na comparação
          stock: 0,
          available: false,
          handlingTime: this.handlingTimeOmd + this.providerSpecificHandlingTime,
          apiError: true // Flag para indicar que o dado veio de uma falha de API
      };
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
    const isAvailable = apiData.availability === "InStock";
    const quantity = isAvailable ? this.stockLevel : 0;
    const totalHandlingTime = this.handlingTimeOmd + this.providerSpecificHandlingTime;

    // Apenas para estatísticas
    if(isAvailable) this.inStockCount++; else this.outOfStockCount++;

    return {
      sku: sku,
      price: apiData.price || 0,
      brand: apiData.brand || '',
      stock: quantity,
      available: isAvailable,
      handlingTime: totalHandlingTime
    };
  }

  calculateQuantity(stock, available) {
    const quantity = available ? this.stockLevel : 0;
    const availability = quantity > 0 ? 'inStock' : 'outOfStock';
    return { quantity, availability };
  }

  async updateProductInDb(product) {
    try {
        // --- DEBUG: Verificar valores de configuração no escopo deste método ---
        logger.info(`[${product.sku}] Starting updateProductInDb - OMD Handling: ${this.handlingTimeOmd}, Provider Handling: ${this.providerSpecificHandlingTime}`);

        const productData = await this._fetchProductData(product.sku);
        
        // Verificar se houve erro na API
        if (productData.apiError) {
            logger.warn(`[${product.sku}] API error detected - product will be marked as OutOfStock`);
        }

        const currentQuery = `SELECT supplier_price, quantity, availability, brand, lead_time, lead_time_2, handling_time_amz FROM produtos WHERE sku = $1`;
        const currentData = await this.dbService.fetchRowWithRetry(currentQuery, [product.sku]);

        if (!currentData) {
            logger.warn(`[${product.sku}] Product not found in database for update`);
            return { status: 'failed', message: 'Produto não encontrado' };
        }

        // --- Definição dos Novos Valores com Base na Lógica de Negócio ---
        const newPrice = productData.price;
        const newBrand = productData.brand || '';
        const newQuantity = productData.stock;
        const newAvailability = productData.available ? 'inStock' : 'outOfStock';
        const newLeadTime = this.handlingTimeOmd;
        const newLeadTime2 = this.providerSpecificHandlingTime;
        const newHandlingTimeAmz = newLeadTime + newLeadTime2;

        // Log detalhado dos dados recebidos da API
        logger.info(`[${product.sku}] API Data - Price: ${newPrice}, Brand: '${newBrand}', Stock: ${newQuantity}, Available: ${productData.available}, API Error: ${!!productData.apiError}`);
        logger.info(`[${product.sku}] Current DB - Price: ${currentData.supplier_price}, Brand: '${currentData.brand || ''}', Quantity: ${currentData.quantity}, Availability: ${currentData.availability}`);

        // --- Comparação e Detecção de Mudanças ---
        const changes = [];

        if (Number(currentData.supplier_price) !== newPrice) changes.push(`Price: ${currentData.supplier_price} -> ${newPrice}`);
        if (Number(currentData.quantity) !== newQuantity) changes.push(`Quantity: ${currentData.quantity} -> ${newQuantity}`);
        if (String(currentData.availability) !== newAvailability) changes.push(`Availability: ${currentData.availability} -> ${newAvailability}`);
        if (Number(currentData.lead_time) !== newLeadTime) changes.push(`lead_time (OMD): ${currentData.lead_time} -> ${newLeadTime}`);
        if (Number(currentData.lead_time_2) !== newLeadTime2) changes.push(`lead_time_2 (Provider): ${currentData.lead_time_2} -> ${newLeadTime2}`);
        if (Number(currentData.handling_time_amz) !== newHandlingTimeAmz) changes.push(`handling_time_amz (Total): ${currentData.handling_time_amz} -> ${newHandlingTimeAmz}`);
        if (String(currentData.brand || '') !== newBrand) changes.push(`Brand: '${currentData.brand || ''}' -> '${newBrand}'`);

        // --- Execução da Atualização ---
        if (changes.length === 0) {
            logger.info(`[${product.sku}] No changes detected - updating last_update only`);
            const updateLastCheckQuery = `UPDATE produtos SET last_update = $1 WHERE sku = $2`;
            await this.dbService.executeWithRetry(updateLastCheckQuery, [new Date(), product.sku]);
            return { status: 'no_update', message: 'No changes detected' };
        }

        logger.info(`[${product.sku}] Changes detected: ${changes.join(', ')}`);
        
        const updatedFlag = this.updateFlagValue;
        logger.info(`[${product.sku}] Updating database with atualizado = ${updatedFlag}`);

        const updateQuery = `
            UPDATE produtos SET 
                supplier_price=$1, quantity=$2, availability=$3, brand=$4,
                lead_time=$5, lead_time_2=$6, handling_time_amz=$7,
                last_update=$8, atualizado=$9
            WHERE sku = $10`;
        
        const updateResult = await this.dbService.executeWithRetry(updateQuery, [
            newPrice, newQuantity, newAvailability, newBrand,
            newLeadTime, newLeadTime2, newHandlingTimeAmz,
            new Date(), updatedFlag, product.sku
        ]);

        // Verificar se a atualização foi bem-sucedida
        if (updateResult.rowCount === 0) {
            logger.error(`[${product.sku}] Database update failed - no rows affected`);
            return { status: 'failed', message: 'Database update failed - no rows affected' };
        }

        logger.info(`[${product.sku}] ✅ Database updated successfully (${updateResult.rowCount} row affected)`);
        
        // Verificação adicional: ler o produto novamente para confirmar a atualização
        const verificationQuery = `SELECT quantity, availability FROM produtos WHERE sku = $1`;
        const verificationData = await this.dbService.fetchRowWithRetry(verificationQuery, [product.sku]);
        
        if (verificationData) {
            logger.info(`[${product.sku}] Verification - DB now shows: Quantity=${verificationData.quantity}, Availability=${verificationData.availability}`);
            
            // Alertar se a verificação não bate com o que deveria ter sido salvo
            if (Number(verificationData.quantity) !== newQuantity || String(verificationData.availability) !== newAvailability) {
                logger.error(`[${product.sku}] ⚠️  VERIFICATION MISMATCH! Expected: Quantity=${newQuantity}, Availability=${newAvailability}, Got: Quantity=${verificationData.quantity}, Availability=${verificationData.availability}`);
            }
        }

        return { status: 'updated' };
    } catch (error) {
        logger.error(`[${product.sku}] ❌ CRITICAL ERROR in updateProductInDb:`, {
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 3).join('\n'), // Primeiras 3 linhas do stack
            type: error.constructor.name
        });
        return { status: 'failed', message: error.message };
    }
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

      // Configuração otimizada com controle de concorrência mais conservador
      // Reduzir concorrência para evitar timeouts e sobrecarga da API
      const rps = requestsPerSecond > 0 ? Math.min(requestsPerSecond, 10) : 10; // Máximo 10 RPS para estabilidade
      const batchSize = Math.min(rps, 5); // Máximo 5 produtos simultâneos por lote
      const batches = Math.ceil(products.length / batchSize);
      
      logger.info(`Processing ${products.length} products in ${batches} batches of ${batchSize} (${rps} RPS with controlled concurrency)`);
      logger.info(`CONCURRENCY CONTROL: Limiting to max ${batchSize} simultaneous requests to prevent API overload`);

      // Processar produtos em lotes com controle de concorrência
      for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
        if (checkCancellation && checkCancellation()) {
          logger.info('Cancellation requested, stopping Phase 1');
          break;
        }

        const batchStart = batchIndex * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, products.length);
        const batchProducts = products.slice(batchStart, batchEnd);
        
        const batchStartTime = Date.now();
        logger.info(`Processing batch ${batchIndex + 1}/${batches}: ${batchProducts.length} products (SKUs: ${batchProducts.map(p => p.sku).join(', ')})`);
        
        // Processar produtos do lote com controle de concorrência
        const batchPromises = batchProducts.map(async (product, index) => {
          try {
            // Adicionar pequeno delay escalonado para evitar burst excessivo
            if (index > 0) {
              await new Promise(resolve => setTimeout(resolve, index * 200)); // 200ms entre cada request no lote
            }
            
            logger.info(`[BATCH ${batchIndex + 1}] Starting processing of SKU ${product.sku} (${index + 1}/${batchProducts.length})`);
            const result = await this.updateProductInDb(product);
            
            if (result.status === 'updated') {
              progress.updatedProducts++;
              progress.successCount++;
              logger.info(`[BATCH ${batchIndex + 1}] ✅ SKU ${product.sku} updated successfully`);
            } else if (result.status === 'no_update') {
              progress.successCount++;
              logger.info(`[BATCH ${batchIndex + 1}] ⚪ SKU ${product.sku} no changes needed`);
            } else {
              progress.failCount++;
              logger.warn(`[BATCH ${batchIndex + 1}] ❌ SKU ${product.sku} failed: ${result.message}`);
            }
            return result;
          } catch (err) {
            logger.error(`[BATCH ${batchIndex + 1}] ❌ Error processing SKU ${product.sku}: ${err.message}`);
            progress.failCount++;
            return { status: 'failed', message: err.message };
          } finally {
            progress.processedProducts++;
          }
        });

        // Aguardar todos os produtos do lote serem processados
        await Promise.all(batchPromises);
        
        const batchEndTime = Date.now();
        const batchDuration = (batchEndTime - batchStartTime) / 1000;
        logger.info(`[BATCH ${batchIndex + 1}] Completed in ${batchDuration.toFixed(2)}s`);
        
        // Atualizar progresso após cada lote
        if (updateProgress) {
          updateProgress(progress);
        }
        
        // Aguardar entre lotes para respeitar o limite de RPS e dar tempo para a API se recuperar
        if (batchIndex < batches - 1) {
          const delayBetweenBatches = Math.max(1000, 2000 - batchDuration * 1000); // Mínimo 1s, ideal 2s
          logger.info(`[BATCH ${batchIndex + 1}] Waiting ${delayBetweenBatches}ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
        }
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