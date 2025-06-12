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
const axios = require('axios');

class BestBuyProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.apiBaseUrl = config.apiBaseUrl || process.env.BESTBUY_API_BASE_URL || 'http://167.114.223.83:3005/bb/api';
    this.dbService = new DatabaseService(DB_CONFIG);
    
    // Configurações simples
    this.stockLevel = config.stockLevel ?? 33;
    this.handlingTimeOmd = config.handlingTimeOmd ?? 1;
    this.providerSpecificHandlingTime = config.providerSpecificHandlingTime ?? 3;
    this.updateFlagValue = config.updateFlagValue ?? 4;
    
    logger.info('--- BestBuy Provider Simple Initialized ---');
    logger.info(`- Stock Level: ${this.stockLevel}`);
    logger.info(`- OMD Handling Time: ${this.handlingTimeOmd}`);
    logger.info(`- Provider Handling Time: ${this.providerSpecificHandlingTime}`);
    
    this.dbInitialized = false;
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

  /**
   * Busca dados de um produto na API - VERSÃO SIMPLES
   */
  async fetchProductData(sku) {
    try {
      const url = `${this.apiBaseUrl}/${sku}`;
      
      const response = await axios.get(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'FeedControl/1.0' },
        timeout: 30000
      });

      // Verificação da nova estrutura de resposta
      if (response.status === 200 && response.data) {
        const apiResponse = response.data;
        
        // 🔍 LOG DETALHADO PARA DEBUG
        logger.info(`[${sku}] RAW API Response: ${JSON.stringify(apiResponse)}`);
        
        // Verificar o campo success
        if (apiResponse.success === true && apiResponse.data) {
          const apiData = apiResponse.data;
          logger.info(`[${sku}] API Success - Availability: "${apiData.availability}", Price: ${apiData.price}`);
          
          // Transformação simples e direta
          const isInStock = apiData.availability === "InStock";
          
          const transformedData = {
            sku: sku,
            price: apiData.price || 0,
            brand: apiData.brand || '',
            quantity: isInStock ? this.stockLevel : 0,
            availability: isInStock ? 'inStock' : 'outOfStock',
            handlingTime: this.handlingTimeOmd + this.providerSpecificHandlingTime
          };
          
          // 🔍 LOG DA TRANSFORMAÇÃO
          logger.info(`[${sku}] Transformed - isInStock: ${isInStock}, Final Availability: "${transformedData.availability}", Final Price: ${transformedData.price}, Final Qty: ${transformedData.quantity}`);
          
          return transformedData;
        } else {
          // Se success é false ou não há dados, marcar como OutOfStock
          logger.warn(`[${sku}] API returned success: false - Product not found or unavailable`);
          return {
            sku: sku,
            price: 0,
            brand: '',
            quantity: 0,
            availability: 'outOfStock',
            handlingTime: this.handlingTimeOmd + this.providerSpecificHandlingTime
          };
        }
      } else {
        // Se a API não retornou status 200, marcar como OutOfStock
        logger.warn(`[${sku}] Invalid API response status: ${response.status} - marking as OutOfStock`);
        return {
          sku: sku,
          price: 0,
          brand: '',
          quantity: 0,
          availability: 'outOfStock',
          handlingTime: this.handlingTimeOmd + this.providerSpecificHandlingTime
        };
      }
    } catch (error) {
      // Em caso de erro, marcar como OutOfStock
      logger.error(`[${sku}] API error: ${error.message} - marking as OutOfStock`);
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
        logger.warn(`[${product.sku}] Product not found in database`);
        return { status: 'failed', message: 'Product not found' };
      }

      // Verificar se há mudanças
      const hasChanges = (
        Number(currentData.supplier_price) !== productData.price ||
        Number(currentData.quantity) !== productData.quantity ||
        String(currentData.availability) !== productData.availability ||
        String(currentData.brand || '') !== productData.brand ||
        Number(currentData.lead_time) !== this.handlingTimeOmd ||
        Number(currentData.lead_time_2) !== this.providerSpecificHandlingTime ||
        Number(currentData.handling_time_amz) !== productData.handlingTime
      );

      if (!hasChanges) {
        // Apenas atualizar last_update
        const updateLastCheckQuery = `UPDATE produtos SET last_update = $1 WHERE sku = $2`;
        await this.dbService.executeWithRetry(updateLastCheckQuery, [new Date(), product.sku]);
        return { status: 'no_update' };
      }

      // 🔍 LOG DETALHADO DA ATUALIZAÇÃO
      logger.info(`[${product.sku}] DB Update - Old: ${currentData.availability}/$${currentData.supplier_price}, New: ${productData.availability}/$${productData.price}`);

      // Atualizar produto
      const updateQuery = `
        UPDATE produtos SET 
          supplier_price=$1, quantity=$2, availability=$3, brand=$4,
          lead_time=$5, lead_time_2=$6, handling_time_amz=$7,
          last_update=$8, atualizado=$9
        WHERE sku = $10`;
      
      const updateResult = await this.dbService.executeWithRetry(updateQuery, [
        productData.price,
        productData.quantity,
        productData.availability,
        productData.brand,
        this.handlingTimeOmd,
        this.providerSpecificHandlingTime,
        productData.handlingTime,
        new Date(),
        this.updateFlagValue,
        product.sku
      ]);

      // 🔍 VERIFICAR SE A ATUALIZAÇÃO FOI APLICADA
      if (updateResult.rowCount === 0) {
        logger.error(`[${product.sku}] Database update failed - no rows affected`);
        return { status: 'failed', message: 'No rows updated' };
      }

      logger.info(`[${product.sku}] Updated: ${productData.availability}, Price: ${productData.price}, Qty: ${productData.quantity}`);
      return { status: 'updated' };

    } catch (error) {
      logger.error(`[${product.sku}] Update failed: ${error.message}`);
      return { status: 'failed', message: error.message };
    }
  }

  /**
   * Processa produtos em lotes com controle de concorrência simples
   */
  async processProductsBatch(products, maxConcurrent, checkCancellation) {
    const results = [];
    
    // Processar em grupos de maxConcurrent
    for (let i = 0; i < products.length; i += maxConcurrent) {
      // ✅ VERIFICAR CANCELAMENTO ANTES DE CADA LOTE
      if (checkCancellation && checkCancellation()) {
        logger.info('Cancellation requested during batch processing, stopping...');
        break;
      }
      
      const batch = products.slice(i, i + maxConcurrent);
      
      logger.info(`Processing batch ${Math.floor(i/maxConcurrent) + 1}: ${batch.length} products`);
      
      // Processar lote em paralelo
      const batchPromises = batch.map(product => this.updateProductInDb(product));
      const batchResults = await Promise.all(batchPromises);
      
      results.push(...batchResults);
      
      // ✅ VERIFICAR CANCELAMENTO APÓS CADA LOTE
      if (checkCancellation && checkCancellation()) {
        logger.info('Cancellation requested after batch completion, stopping...');
        break;
      }
      
      // Pequena pausa entre lotes para não sobrecarregar a API
      if (i + maxConcurrent < products.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return results;
  }

  /**
   * Processa produtos respeitando o batch_size do frontend
   */
  async processProductsBatchWithCorrectSize(products, batchSize, maxConcurrent, checkCancellation, progress, updateProgress) {
    // Não retorna mais 'results', pois o progresso é atualizado aqui dentro.
    
    for (let i = 0; i < products.length; i += batchSize) {
      if (checkCancellation && checkCancellation()) {
        logger.info('Cancellation requested during batch processing, stopping...');
        break;
      }
      
      const batch = products.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      
      logger.info(`Processing batch ${batchNumber}: ${batch.length} products (batch size: ${batchSize})`);
      
      const batchResults = await this.processProductsBatch(batch, maxConcurrent, checkCancellation);
      
      // ATUALIZAR PROGRESSO AQUI, APÓS CADA LOTE
      batchResults.forEach(result => {
        progress.processedProducts++;
        if (result.status === 'updated') {
          progress.updatedProducts++;
          progress.successCount++;
        } else if (result.status === 'no_update') {
          progress.successCount++;
        } else {
          progress.failCount++;
        }
      });

      if (updateProgress) {
        const percentage = progress.totalProducts > 0 ? Math.round((progress.processedProducts / progress.totalProducts) * 100) : 0;
        const progressPayload = {
          ...progress,
          percentage: Math.min(100, percentage),
          isRunning: true,
          completed: false,
        };
        logger.info(`[BB Provider] Updating progress after batch ${batchNumber}: Processed ${progress.processedProducts}/${progress.totalProducts}`);
        updateProgress(progressPayload);
      }
      
      if (checkCancellation && checkCancellation()) {
        logger.info('Cancellation requested after batch completion, stopping...');
        break;
      }
      
      if (i + batchSize < products.length) {
        logger.info(`Completed batch ${batchNumber}, pausing before next batch...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    // Não precisa retornar nada, o objeto 'progress' é modificado por referência.
  }

  /**
   * Execute Phase 1 - VERSÃO SIMPLIFICADA COM BATCH_SIZE CORRETO
   */
  async executePhase1(skipProblematic, requestsPerSecond, checkCancellation, updateProgress, batchSize) {
    logger.info(`Running Phase 1 for ${this.getName()} provider (Simple Version)`);
    
    const startTime = Date.now();
    await this.init();
    
    try {
      // Buscar produtos
      const query = `SELECT sku, sku2 FROM produtos WHERE source = 'Best Buy' ORDER BY last_update ASC`;
      const products = await this.dbService.fetchRowsWithRetry(query);
      
      logger.info(`Found ${products.length} Best Buy products to process`);
      
      // 🔧 USAR BATCH_SIZE DO FRONTEND, NÃO requestsPerSecond
      const effectiveBatchSize = batchSize || 100; // Default 100 se não especificado
      const maxConcurrent = Math.min(requestsPerSecond || 5, 10); // Concorrência para API
      
      logger.info(`Processing with batch size: ${effectiveBatchSize}, max concurrent API calls: ${maxConcurrent}`);
      
      let progress = {
        totalProducts: products.length,
        processedProducts: 0,
        successCount: 0,
        failCount: 0,
        updatedProducts: 0,
        startTime: startTime,
        isRunning: true, // Adicionar para consistência com chamadas de loop
        phase: 1,        // Adicionar para consistência
        completed: false // Adicionar para consistência
      };

      if (updateProgress) {
        logger.info(`[BB Provider] Calling initial updateProgress: ${JSON.stringify(progress)}`);
        updateProgress(progress);
      }

      // 🔧 PROCESSAR EM LOTES, AGORA PASSANDO O CONTROLE DE PROGRESSO
      await this.processProductsBatchWithCorrectSize(
        products,
        effectiveBatchSize,
        maxConcurrent,
        checkCancellation,
        progress, // Passa o objeto de progresso
        updateProgress // Passa a função de callback
      );
      
      // O loop forEach foi movido para dentro de processProductsBatchWithCorrectSize
      // e não é mais necessário aqui. O objeto 'progress' foi atualizado por referência.

      const endTime = Date.now();
      const duration = (endTime - startTime) / 1000;
      
      logger.info(`Phase 1 completed in ${duration.toFixed(2)} seconds`);
      logger.info(`Results: Processed=${progress.processedProducts}, Success=${progress.successCount}, Failed=${progress.failCount}, Updated=${progress.updatedProducts}`);

      if (updateProgress) updateProgress(progress);

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
}

module.exports = BestBuyProvider;