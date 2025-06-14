/**
 * Best Buy Provider - VERSÃO SIMPLIFICADA
 * 
 * Implementação simples e direta sem over-engineering.
 * Foca apenas no essencial: buscar dados da API e atualizar o banco.
 */

const BaseProvider = require('./provider-interface');
const DatabaseService = require('../services/database');
const { DB_CONFIG } = require('../config/db');
const logger = require('../config/logging')();
const SimpleQueue = require('../utils/SimpleQueue');
const axios = require('axios');

class BestBuyProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.apiBaseUrl = config.apiBaseUrl || process.env.BESTBUY_API_BASE_URL || 'http://167.114.223.83:3005/bb/api';
    this.dbService = new DatabaseService(DB_CONFIG);
    
    // Configurações simples
    this.stockLevel = config.stockLevel ?? 5; // Use value from config
    this.handlingTimeOmd = config.handlingTimeOmd ?? 1;
    this.providerSpecificHandlingTime = config.providerSpecificHandlingTime ?? 3;
    this.updateFlagValue = config.updateFlagValue ?? 4;
    
    logger.info('--- BestBuy Provider Simple Initialized ---');
    logger.info(`- Stock Level: ${this.stockLevel}`);
    logger.info(`- OMD Handling Time: ${this.handlingTimeOmd}`);
    logger.info(`- Provider Handling Time: ${this.providerSpecificHandlingTime}`);
    
    this.dbInitialized = false;
    
    // State tracking
    this.problematicProducts = [];
    this.inStockSet = new Set();
    this.outOfStockSet = new Set();
    
    // Request tracking
    this.requestCounter = 0;
    this.pendingRequests = new Map();
    
    // Statistics
    this.updateStats = {
        priceChanges: 0,
        quantityChanges: 0,
        availabilityChanges: 0,
        brandChanges: 0,
        handlingTimeChanges: 0
    };
  }

  async init() {
    if (!this.dbInitialized) {
      await this.dbService.init();
      this.dbInitialized = true;
      logger.info('Database connection initialized for Best Buy provider');
    }
  }

  async close() {
    if (this.dbInitialized) {
      await this.dbService.close();
      this.dbInitialized = false;
      logger.info('Database connection closed for Best Buy provider');
    }
  }

  getId() {
    return 'bestbuy';
  }

  getName() {
    return 'Best Buy';
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
      logger.info(`[REQ-${requestId}] Request completed for SKU ${requestInfo.sku} - Total duration: ${duration}ms, Success: ${success}`);
      this.pendingRequests.delete(requestId);
    }
  }

  checkPendingRequests() {
    const now = Date.now();
    const staleThreshold = 30000; // 30 segundos
    
    for (const [requestId, info] of this.pendingRequests) {
      const age = now - info.startTime;
      if (age > staleThreshold) {
        logger.warn(`[REQUEST-MONITOR] REQ-${requestId}: SKU ${info.sku}, Age: ${age}ms, URL: ${info.url}`);
      }
    }
  }

  /**
   * Busca dados de um produto na API - VERSÃO SIMPLES
   */
  async fetchProductData(sku) {
    const requestId = this.generateRequestId();
    const url = `${this.apiBaseUrl}/${sku}`;
    const startTime = Date.now();
    
    try {
      this.trackRequest(requestId, sku, url);
      logger.info(`[REQ-${requestId}] Starting request for SKU ${sku} at ${url}`);
      
      const response = await axios.get(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'FeedControl/1.0' },
        timeout: 30000
      });

      const duration = Date.now() - startTime;
      logger.info(`[REQ-${requestId}] Response received for SKU ${sku} - Status: ${response.status}, Duration: ${duration}ms`);
      
      this.completeRequest(requestId, true);

      // Verificação da nova estrutura de resposta
      if (response.status === 200 && response.data) {
        const apiResponse = response.data;
        
        logger.info(`[${sku}] RAW API Response: ${JSON.stringify(apiResponse)}`);

        // Verificar se a API indica sucesso
        if (apiResponse.success === true && apiResponse.data) {
          const productData = apiResponse.data;
          
          // Transformar dados recebidos
          const isInStock = productData.availability === 'InStock';
          const finalAvailability = isInStock ? 'inStock' : 'outOfStock';
          const finalQuantity = isInStock ? this.stockLevel : 0;

          logger.info(`[${sku}] API Success - Availability: "${productData.availability}", Price: ${productData.price}`);
          logger.info(`[${sku}] Transformed - isInStock: ${isInStock}, Final Availability: "${finalAvailability}", Final Price: ${productData.price}, Final Qty: ${finalQuantity}`);

          return {
            sku: productData.sku,
            price: productData.price || 0,
            brand: productData.brand || '',
            quantity: finalQuantity,
            availability: finalAvailability,
            handlingTime: this.handlingTimeOmd + this.providerSpecificHandlingTime
          };
        } 
        // Produto não encontrado (success = false)
        else if (apiResponse.success === false) {
          logger.warn(`[REQ-${requestId}] API FAILURE - SKU ${sku}: Product not found (success = false)`);
          return {
            sku: sku,
            price: 0,
            brand: '',
            quantity: 0,
            availability: 'outOfStock',
            handlingTime: this.handlingTimeOmd + this.providerSpecificHandlingTime
          };
        }
        // Formato inesperado
        else {
          logger.error(`[REQ-${requestId}] INVALID FORMAT - SKU ${sku}: ${JSON.stringify(apiResponse)}`);
          throw new Error(`Unexpected API response format for SKU ${sku}`);
        }
      } else {
        throw new Error(`Invalid response status or data for SKU ${sku}`);
      }
      
    } catch (error) {
      const duration = Date.now() - startTime;
      
      if (error.response) {
        logger.error(`[REQ-${requestId}] HTTP ERROR - SKU ${sku}: Status ${error.response.status}, Duration: ${duration}ms`);
      } else if (error.code === 'ECONNABORTED') {
        logger.error(`[REQ-${requestId}] TIMEOUT - SKU ${sku}: Request timed out after ${duration}ms`);
      } else if (error.code) {
        logger.error(`[REQ-${requestId}] NETWORK ERROR - SKU ${sku}: ${error.code} - ${error.message}, Duration: ${duration}ms`);
      } else {
        logger.error(`[REQ-${requestId}] UNKNOWN ERROR - SKU ${sku}: ${error.message}, Duration: ${duration}ms`);
      }
      
      this.completeRequest(requestId, false);
      
      // Retorna produto como outOfStock em caso de erro
      return {
        sku: sku,
        price: 0,
        brand: '',
        quantity: 0,
        availability: 'outOfStock',
        handlingTime: this.handlingTimeOmd + this.providerSpecificHandlingTime
      };
    }
  }

  /**
   * Busca dados de um produto na API com retry inteligente
   */
  async fetchProductDataWithRetry(sku, maxRetries = 3) {
    let lastValidResponse = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const productData = await this.fetchProductData(sku);
        logger.info(`[${sku}] Attempt ${attempt} - Fetched Data: ${JSON.stringify(productData)}`);
        
        // Para a nova estrutura da API, considerar fazer retry se:
        // 1. O produto está OutOfStock (pode ser temporário/sobrecarga da API)
        // 2. O preço é 0 (pode indicar problema na resposta)
        const shouldRetry = productData.availability === 'outOfStock' && productData.price === 0;
        
        if (!shouldRetry) {
          // Se não precisa retry, retorna o resultado
          if (attempt > 1) {
            logger.info(`[${sku}] ✅ Valid response on attempt ${attempt}: ${productData.availability}/$${productData.price}`);
          }
          return productData;
        }
        
        // Se precisa retry e ainda tem tentativas
        if (attempt < maxRetries) {
          logger.warn(`[${sku}] ⚠️ Attempt ${attempt}: Product appears OutOfStock with $0 - may be API overload`);
          const delay = this.calculateRetryDelay(attempt, 'medium');
          logger.info(`[${sku}] 🔄 Retrying in ${delay}ms... (${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Última tentativa, retorna o que temos
          logger.warn(`[${sku}] ❌ Max retries reached - Product remains OutOfStock with $0`);
          return productData;
        }
        
      } catch (error) {
        logger.error(`[${sku}] 💥 Attempt ${attempt} failed: ${error.message}`);
        
        if (attempt < maxRetries) {
          const delay = this.calculateRetryDelay(attempt, 'high');
          logger.info(`[${sku}] 🔄 Retrying in ${delay}ms... (${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          logger.error(`[${sku}] ❌ All ${maxRetries} attempts failed, marking as outOfStock`);
          return {
            sku: sku,
            price: 0,
            brand: '',
            quantity: 0,
            availability: 'outOfStock',
            handlingTime: this.handlingTimeOmd + this.providerSpecificHandlingTime
          };
        }
      }
    }
  }

  /**
   * Analisa a qualidade da resposta da API de forma inteligente
   */
  analyzeResponse(productData, sku, attempt) {
    const analysis = {
      isValid: true,
      reason: '',
      severity: 'low',
      isBetterThan: (other) => {
        if (!other) return true; // Se não há 'other', a atual é sempre melhor

        const currentIsStock = productData.availability === 'inStock';
        const otherIsStock = other.availability === 'inStock';

        // 1. InStock é sempre melhor que OutOfStock
        if (currentIsStock && !otherIsStock) return true;
        if (!currentIsStock && otherIsStock) return false;

        // 2. Se ambas têm o mesmo status de estoque (ambas InStock ou ambas OutOfStock)
        if (currentIsStock === otherIsStock) {
          // Se ambas OutOfStock:
          if (!currentIsStock) {
            // Se a atual é OOS com $0 e a outra é OOS com preço > 0, a atual (mais recente) é melhor.
            if (productData.price === 0 && other.price > 0) return true;
            // Se a atual é OOS com preço > 0 e a outra é OOS com $0, a atual (mais recente) é melhor.
            if (productData.price > 0 && other.price === 0) return true;
            // Se ambas OOS e ambas com preço > 0, ou ambas OOS e ambas com $0, a atual (mais recente) é melhor.
            return true;
          }
          // Se ambas InStock:
          // Prefere a que tem preço, se a outra não tiver (improvável para InStock, mas para robustez)
          if (productData.price > 0 && other.price === 0) return true;
          if (productData.price === 0 && other.price > 0) return false;
          // Se ambas InStock e ambas com preço, a mais recente é melhor.
          return true;
        }
        
        // Caso padrão, se não coberto acima (embora deva ser), não prefere.
        return false;
      }
    };

    // 🚨 PADRÕES SUSPEITOS IDENTIFICADOS
    
    // Padrão 1: OutOfStock com preço > 0 (ainda pode ser suspeito, mas não invalidará a resposta por si só se for a única informação)
    // A API pode fornecer um último preço conhecido para itens OOS.
    // Vamos manter o log, mas não marcar como isValid = false imediatamente por esta razão.
    // A decisão de retry será mais influenciada por outros erros ou falta de dados.
    if (productData.availability === 'outOfStock' && productData.price > 0) {
      // analysis.isValid = false; // Não invalidar mais automaticamente
      analysis.reason = `Note: outOfStock but price $${productData.price} (last known price?)`;
      analysis.severity = 'low'; // Reduzir severidade, pois pode ser um comportamento esperado
      // Não retorna aqui, continua para outras verificações
    }
    
    // Padrão 2: Preço $0 com outOfStock - AGORA É CONSIDERADO VÁLIDO
    // Removido - esta é uma condição válida conforme nossa análise.
    
    // Padrão 3: Preço muito baixo para produtos eletrônicos (< $5)
    if (productData.price > 0 && productData.price < 5) {
      analysis.isValid = false;
      analysis.reason = `Suspicious: unusually low price $${productData.price}`;
      analysis.severity = 'medium';
      return analysis;
    }
    
    // Padrão 4: Preço muito alto (> $10000) - pode ser erro
    if (productData.price > 10000) {
      analysis.isValid = false;
      analysis.reason = `Suspicious: unusually high price $${productData.price}`;
      analysis.severity = 'low';
      return analysis;
    }

    // Se chegou aqui, a resposta parece válida
    return analysis;
  }

  /**
   * Calcula delay inteligente baseado na severidade do erro
   */
  calculateRetryDelay(attempt, severity) {
    const basedelay = 1000; // 1 segundo base
    const multiplier = attempt; // Delay progressivo
    
    const severityMultipliers = {
      'low': 1,
      'medium': 1.5,
      'high': 2
    };
    
    return basedelay * multiplier * (severityMultipliers[severity] || 1);
  }

  /**
   * Atualiza um produto no banco de dados - VERSÃO SIMPLES COM RETRY
   */
  async updateProductInDb(product) {
    try {
      // Buscar dados da API COM RETRY
      const productData = await this.fetchProductDataWithRetry(product.sku);
      
      // Buscar dados atuais do banco
      const currentQuery = `SELECT supplier_price, quantity, availability, brand, lead_time, lead_time_2, handling_time_amz FROM produtos WHERE sku = $1`;
      const currentData = await this.dbService.fetchRowWithRetry(currentQuery, [product.sku]);

      if (!currentData) {
        logger.warn(`Product ${productData.sku} not found in DB. Skipping update.`);
        return { status: 'failed', message: 'Product not found in database' };
      }

      // Check if product was not found in API (success = false)
      const isProductNotFound = productData.quantity === 0 && productData.availability === 'outOfStock' && productData.price === 0;
      
      // Os valores já vem calculados corretamente do fetchProductDataWithRetry
      // baseados na configuração da loja (this.stockLevel vem do config)
      const quantity = productData.quantity;
      const availability = productData.availability;

      if (availability === 'inStock') this.inStockSet.add(productData.sku);
      else this.outOfStockSet.add(productData.sku);

      // Use simple lead time calculation based on configuration
      const bestBuyLeadTime = this.providerSpecificHandlingTime; // Provider Handling Time (3 dias)
      
      // Calculate handling time for Amazon
      let handlingTimeAmz = this.handlingTimeOmd + bestBuyLeadTime;
      if (handlingTimeAmz > 29) {
        logger.warn(`Handling time for ${productData.sku} capped at 29 days (was ${handlingTimeAmz}).`);
        handlingTimeAmz = 29;
      }

      const newData = {
        supplier_price: productData.price || 0,
        freight_cost: productData.shipping_cost || 0,
        lead_time: this.handlingTimeOmd.toString(), // OMD handling time
        lead_time_2: bestBuyLeadTime, // Provider specific handling time
        quantity: quantity,
        availability: availability,
        brand: productData.brand || '',
        handling_time_amz: handlingTimeAmz,
        atualizado: this.updateFlagValue,
        sku_problem: isProductNotFound
      };

      let hasChanges = false;
      const changes = [];
      
      // Compare relevant fields and log detailed changes
      const oldPrice = parseFloat(currentData.supplier_price) || 0;
      const newPrice = parseFloat(newData.supplier_price) || 0;
      if (oldPrice !== newPrice) {
        changes.push(`  price: $${oldPrice} → $${newPrice}`);
        hasChanges = true;
        this.updateStats.priceChanges++;
      }

      const oldQuantity = parseInt(currentData.quantity) || 0;
      const newQuantity = parseInt(newData.quantity) || 0;
      if (oldQuantity !== newQuantity) {
        changes.push(`  quantity: ${oldQuantity} → ${newQuantity}`);
        hasChanges = true;
        this.updateStats.quantityChanges++;
      }

      if (currentData.availability !== newData.availability) {
        changes.push(`  availability: ${currentData.availability} → ${newData.availability}`);
        hasChanges = true;
        this.updateStats.availabilityChanges++;
      }

      const oldFreight = parseFloat(currentData.freight_cost) || 0;
      const newFreight = parseFloat(newData.freight_cost) || 0;
      if (oldFreight !== newFreight) {
        changes.push(`  freight_cost: $${oldFreight} → $${newFreight}`);
        hasChanges = true;
      }

      // Lead time - comparar valores numéricos
      const oldLeadTime = parseInt(currentData.lead_time) || 0;
      const newLeadTime = parseInt(newData.lead_time) || 0;
      if (oldLeadTime !== newLeadTime) {
        changes.push(`  lead_time: ${oldLeadTime} → ${newLeadTime}`);
        hasChanges = true;
      }

      // Lead time 2 - comparar valores numéricos
      const oldLeadTime2 = parseInt(currentData.lead_time_2) || 0;
      const newLeadTime2 = parseInt(newData.lead_time_2) || 0;
      if (oldLeadTime2 !== newLeadTime2) {
        changes.push(`  lead_time_2: ${oldLeadTime2} → ${newLeadTime2}`);
        hasChanges = true;
      }

      if (currentData.brand !== newData.brand) {
        changes.push(`  brand: "${currentData.brand}" → "${newData.brand}"`);
        hasChanges = true;
        this.updateStats.brandChanges++;
      }

      // Handling time - comparar valores numéricos
      const oldHandlingTime = parseInt(currentData.handling_time_amz) || 0;
      const newHandlingTime = parseInt(newData.handling_time_amz) || 0;
      if (oldHandlingTime !== newHandlingTime) {
        changes.push(`  handling_time_amz: ${oldHandlingTime} → ${newHandlingTime}`);
        hasChanges = true;
        this.updateStats.handlingTimeChanges++;
      }

      if (hasChanges) {
        logger.info(`Product ${productData.sku} updated with changes:`);
        logger.info(changes.join('\n'));
      }

      if (isProductNotFound) {
        logger.error(`❌ FAILED PRODUCT: ${product.sku} - Product not found in API`);
        this.problematicProducts.push(product.sku);
        // Removed individual DB update - will be done in batch
        return { status: 'failed', message: 'Product not found' };
      } else {
        if (hasChanges) {
          const updateQuery = `
            UPDATE produtos 
            SET supplier_price = $1, freight_cost = $2, lead_time = $3, lead_time_2 = $4, 
                quantity = $5, availability = $6, brand = $7, handling_time_amz = $8, 
                last_update = $9, atualizado = $10, sku_problem = false
            WHERE sku = $11`;

          const values = [
            newData.supplier_price,
            newData.freight_cost,
            newData.lead_time,
            newData.lead_time_2,
            newData.quantity,
            newData.availability,
            newData.brand,
            newData.handling_time_amz,
            new Date(),
            newData.atualizado,
            productData.sku
          ];

          await this.dbService.executeWithRetry(updateQuery, values);
          logger.info(`${productData.sku} ✅ Updated successfully - ${changes.length} changes`);
          
          return { status: 'updated', changes: hasChanges };
        } else {
          // Mark as processed successfully even if no changes
          const updateQuery = `
            UPDATE produtos 
            SET last_update = $1, atualizado = $2, sku_problem = false
            WHERE sku = $3`;
          
          await this.dbService.executeWithRetry(updateQuery, [new Date(), newData.atualizado, productData.sku]);
          logger.debug(`${productData.sku} ⭕ No changes detected - marked as processed`);
          return { status: 'no_changes' };
        }
      }
    } catch (error) {
      logger.error(`❌ FAILED PRODUCT: ${product.sku} - Error: ${error.message}`);
      this.problematicProducts.push(product.sku);
      return { status: 'failed', message: error.message };
    }
  }

  /**
   * Execute Phase 1 - VERSÃO SIMPLIFICADA COM BATCH_SIZE CORRETO
   */
  async executePhase1(skipProblematic, requestsPerSecond, checkCancellation, updateProgress, batchSize) {
    logger.info(`Running Phase 1 for ${this.getName()} provider (Simple Version)`);
    
    const startTime = Date.now();
    await this.init();
    
    // Iniciar monitoramento de requests
    this.startRequestMonitoring();
    
    try {
      // Buscar produtos
      const query = `SELECT sku, sku2 FROM produtos WHERE source = 'Best Buy' ORDER BY last_update ASC`;
      const products = await this.dbService.fetchRowsWithRetry(query);
      
      logger.info(`Found ${products.length} Best Buy products to process`);
      
      // 🔧 USE SIMPLE QUEUE WITH RPS LIKE HOME DEPOT STANDARD
      const concurrency = requestsPerSecond || 10; // Use RPS from config
      logger.store('bestbuy', 'info', `Using concurrency: ${concurrency} requests/second`);
      const queue = new SimpleQueue({ concurrency });
      
      let progress = {
        totalProducts: products.length,
        processedProducts: 0,
        successCount: 0,
        failCount: 0,
        updatedProducts: 0,
        startTime: startTime,
        isRunning: true,
        phase: 1,
        completed: false
      };

      if (updateProgress) {
        updateProgress(progress);
      }

      // Process all products individually with rate limiting using SimpleQueue
      const promises = [];
      let isCancelled = false;
      
      for (const product of products) {
        if (checkCancellation && checkCancellation()) {
          logger.store('bestbuy', 'info', 'Phase 1 cancelled by user.');
          isCancelled = true;
          // Clear pending tasks from queue
          const clearedTasks = queue.clear();
          logger.store('bestbuy', 'info', `Cleared ${clearedTasks} pending tasks from queue.`);
          break;
        }

        // Add to queue without await to allow parallel processing
        const promise = queue.add(async () => {
          try {
            const result = await this.updateProductInDb(product);
            
            // Update progress based on status
            progress.processedProducts++;
            if (result.status === 'failed') {
              progress.failCount++;
            } else {
              progress.successCount++;
              if (result.status === 'updated') {
                progress.updatedProducts++;
              }
            }
            
            // Update progress callback if provided
            if (updateProgress) {
              updateProgress(progress);
            }
            
          } catch (error) {
            logger.store('bestbuy', 'error', `❌ Error processing product ${product.sku}: ${error.message}`);
            progress.processedProducts++;
            progress.failCount++;
            
            if (updateProgress) {
              updateProgress(progress);
            }
          }
        });
        
        promises.push(promise);
      }

      // Wait for all tasks to complete if not cancelled
      if (!isCancelled) {
        await Promise.all(promises);
      }
      
      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      logger.info(`Phase 1 completed in ${duration.toFixed(2)} seconds`);
      logger.info(`Results: Processed=${progress.processedProducts}, Success=${progress.successCount}, Failed=${progress.failCount}, Updated=${progress.updatedProducts}`);
      
      // Add problematic products count if any
      if (this.problematicProducts && this.problematicProducts.length > 0) {
        logger.info(`Problematic products (marked): ${this.problematicProducts.length}`);
      }

      if (updateProgress) updateProgress(progress);

      this.stopRequestMonitoring();

      // Batch update all problematic products
      if (this.problematicProducts.length > 0) {
        logger.info(`❌ Updating ${this.problematicProducts.length} problematic products in database...`);
        try {
          // Create placeholders for the query
          const placeholders = this.problematicProducts.map((_, index) => `$${index + 2}`).join(', ');
          const query = `
            UPDATE produtos 
            SET sku_problem = true, atualizado = $1, last_update = NOW() 
            WHERE sku IN (${placeholders}) AND source = 'Best Buy'
          `;
          const params = [this.updateFlagValue, ...this.problematicProducts];
          
          await this.dbService.executeWithRetry(query, params);
          logger.info(`✅ Successfully marked ${this.problematicProducts.length} products as problematic`);
        } catch (error) {
          logger.error(`Failed to batch update problematic products: ${error.message}`);
        }
      }

      return {
        success: true,
        executionTime: duration,
        totalProducts: progress.totalProducts,
        processedProducts: progress.processedProducts,
        successCount: progress.successCount,
        failCount: progress.failCount,
        updatedProducts: progress.updatedProducts
      };

    } catch (error) {
      logger.error(`Error in Phase 1: ${error.message}`);
      throw error;
    } finally {
      await this.close();
    }
  }

  /**
   * Execute Phase 2 operations - CORRIGIDO PARA USAR BATCH_SIZE CORRETO
   */
  async executePhase2(batchSize, checkInterval, checkCancellation, updateProgress) {
    logger.info(`Running Phase 2 for ${this.getName()} provider`);
    
    try {
      process.env.CURRENT_PROVIDER_ID = 'bestbuy';
      process.env.BESTBUY_UPDATE_FLAG_VALUE = this.updateFlagValue.toString();
      
      await this.init();
      
      // 🔧 USAR BATCH_SIZE CORRETO DO FRONTEND
      const effectiveBatchSize = batchSize || 100; // Default 100, não 9990
      
      logger.info(`Phase 2 using batch size: ${effectiveBatchSize} (from frontend config)`);
      
      const result = await require('../phases/phase2').mainPhase2(
        effectiveBatchSize,  // 🔧 Usar o valor correto
        checkInterval,
        checkCancellation,
        updateProgress
      );
      
      return {
        success: result,
        totalProducts: updateProgress ? updateProgress.totalProducts : 0,
        successCount: updateProgress ? updateProgress.successCount : 0,
        failCount: updateProgress ? updateProgress.failCount : 0
      };
    } catch (error) {
      logger.error(`Error in Phase 2: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get Phase 2 queries
   */
  getPhase2Queries() {
    return {
      extractUpdatedData: `
        SELECT sku2, handling_time_amz, quantity 
        FROM produtos 
        WHERE atualizado = ${this.updateFlagValue} AND source = 'Best Buy'
      `,
      resetUpdatedProducts: `
        UPDATE produtos SET atualizado = 0
        WHERE atualizado = ${this.updateFlagValue} AND source = 'Best Buy'
      `
    };
  }

  /**
   * Reset updated products after Phase 2
   */
  async resetUpdatedProducts() {
    try {
      await this.init();
      const { resetUpdatedProducts } = this.getPhase2Queries();
      const result = await this.dbService.executeWithRetry(resetUpdatedProducts);
      logger.info(`Reset updated flag for ${result.rowCount} products`);
    } catch (error) {
      logger.error(`Error resetting updated products: ${error.message}`);
      throw error;
    } finally {
      await this.close();
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
}

module.exports = BestBuyProvider;