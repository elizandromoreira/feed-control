/**
 * Phase 1: Atualização de Produtos
 * 
 * Este módulo implementa a Fase 1 do processo de sincronização,
 * que consiste em buscar dados atualizados dos produtos na API do Home Depot
 * e atualizar o banco de dados com essas informações.
 */

const fs = require('fs').promises;
const path = require('path');
// Usar nossa implementação simples de fila em vez de p-queue
const SimpleQueue = require('../utils/simple-queue');
const DatabaseService = require('../services/database');
const HomeDepotApiService = require('../services/homeDepotApi');
const { DBProduct } = require('../models/DBProduct');
const logger = require('../config/logging')();
const { API_CONFIG, STOCK_CONFIG } = require('../config/constants');

// Lista de produtos a serem ignorados (com timestamp de quando foram adicionados)
let skipList = {};
// Lista de SKUs que retornaram dados vazios
let emptyDataSkus = [];
// Lista de produtos problemáticos para reprocessamento
let problematicProducts = [];

// Arquivo para armazenar a lista de produtos a serem ignorados
const SKIP_FILE = path.join(__dirname, '../../data/skip_list.json');
// Diretório para logs
const LOG_DIR = path.join(__dirname, '../../logs');

/**
 * Carrega a lista de produtos a serem ignorados
 * @returns {Promise<void>}
 */
async function loadSkipList() {
  try {
    const data = await fs.readFile(SKIP_FILE, 'utf8');
    skipList = JSON.parse(data);
    logger.info(`Loaded ${Object.keys(skipList).length} products to skip`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.error(`Error loading skip list: ${error.message}`);
    }
    skipList = {};
  }
}

/**
 * Salva a lista de produtos a serem ignorados
 * @returns {Promise<void>}
 */
async function saveSkipList() {
  try {
    await fs.writeFile(SKIP_FILE, JSON.stringify(skipList, null, 2));
    logger.info(`Saved ${Object.keys(skipList).length} products to skip list`);
  } catch (error) {
    logger.error(`Error saving skip list: ${error.message}`);
  }
}

/**
 * Salva a lista de SKUs que retornaram dados vazios
 * @returns {Promise<void>}
 */
async function saveEmptyDataSkus() {
  try {
    // Criar diretório de logs se não existir
    await fs.mkdir(LOG_DIR, { recursive: true });
    
    const date = new Date().toISOString().split('T')[0];
    const filePath = path.join(LOG_DIR, `empty_data_skus_${date}.json`);
    
    await fs.writeFile(filePath, JSON.stringify(emptyDataSkus, null, 2));
    logger.info(`Saved ${emptyDataSkus.length} SKUs with empty data to ${filePath}`);
  } catch (error) {
    logger.error(`Error saving empty data SKUs: ${error.message}`);
  }
}

/**
 * Classe para sincronização de produtos
 */
class ProductSync {
  /**
   * @param {Object} dbConfig - Configuração do banco de dados
   * @param {string} apiBaseUrl - URL base da API
   * @param {number} requestsPerSecond - Número máximo de requisições por segundo
   * @param {Function} checkCancellation - Função para verificar cancelamento
   * @param {Function} updateProgress - Função para atualizar progresso
   */
  constructor(dbConfig, apiBaseUrl, requestsPerSecond = API_CONFIG.requestsPerSecond, 
              checkCancellation = null, updateProgress = null) {
    this.apiBaseUrl = apiBaseUrl;
    this.taxRate = 0.00;
    this.leadTimeOmd = STOCK_CONFIG.leadTimeOmd;
    this.dbService = new DatabaseService(dbConfig);
    this.apiService = new HomeDepotApiService(apiBaseUrl, requestsPerSecond);
    this.requestCount = 0;
    this.startTime = Date.now();
    this.failedProducts = []; // Lista para armazenar produtos que falharam com motivo
    this._checkCancellation = checkCancellation;
    this._updateProgress = updateProgress;
    
    // Contadores para estatísticas de estoque
    this.inStockCount = 0;
    this.outOfStockCount = 0;
  }
  
  /**
   * Inicializa os serviços
   * @returns {Promise<void>}
   */
  async init() {
    await this.dbService.init();
  }
  
  /**
   * Fecha os serviços
   * @returns {Promise<void>}
   */
  async close() {
    await this.dbService.close();
  }
  
  /**
   * Registra um produto como problemático
   * @param {string} sku - SKU do produto
   * @param {string} reason - Motivo da falha
   */
  logFailedProduct(sku, reason = 'Unknown reason') {
    // Adicionar à lista de skip com timestamp atual
    skipList[sku] = Date.now() / 1000;
    
    // Adicionar à lista de produtos que falharam com motivo
    this.failedProducts.push({
      sku,
      reason,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * Salva os produtos que falharam em um arquivo CSV
   * @returns {Promise<string|null>} - Caminho do arquivo salvo ou null em caso de erro
   */
  async saveFailedProductsToCSV() {
    if (this.failedProducts.length === 0) {
      logger.info('No failed products to save');
      return null;
    }

    try {
      // Criar diretório de logs se não existir
      await fs.mkdir(LOG_DIR, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `failed_products_${timestamp}.csv`;
      const filePath = path.join(LOG_DIR, filename);

      const headers = ['sku', 'reason', 'timestamp'];
      const rows = this.failedProducts.map(product =>
        headers.map(header => {
          const value = product[header] || '';
          // Escapar valores com vírgulas
          return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
        }).join(',')
      );

      const csvContent = [headers.join(','), ...rows].join('\n');
      await fs.writeFile(filePath, csvContent, 'utf8');

      logger.info(`Saved ${this.failedProducts.length} failed products to ${filePath}`);
      return filePath;
    } catch (error) {
      logger.error(`Error saving failed products to CSV: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Atualiza um produto no banco de dados
   * @param {Object} productData - Dados do produto
   * @returns {Promise<Object>} - Objeto com status e mensagem
   */
  async updateProductInDb(productData) {
    try {
      // Primeiro, buscar os dados atuais do produto no banco
      const currentDataQuery = `
        SELECT 
          supplier_price, freight_cost, lead_time, lead_time_2, 
          total_price, quantity, tax_supplier, availability, 
          customer_price_shipping, supplier_price_shipping, 
          handling_time_amz, brand 
        FROM produtos
        WHERE sku = $1
      `;
      
      const currentData = await this.dbService.fetchRowWithRetry(currentDataQuery, [productData.sku]);
      
      if (!currentData) {
        logger.warn(`Product ${productData.sku} not found in database`);
        return { updated: false, message: 'Produto não encontrado no banco de dados' };
      }
      
      // Calcular quantidade e disponibilidade - passar o SKU e preço para melhor diagnóstico
      const { quantity, availability } = this.apiService.calculateQuantity(
        productData.stock,
        productData.available,
        productData.sku,
        productData.price
      );
      
      // Garantir que produtos com quantidade > 0 sejam sempre marcados como inStock
      // e apenas produtos com quantidade = 0 sejam marcados como outOfStock
      const correctedAvailability = quantity > 0 ? 'inStock' : 'outOfStock';
      
      // Atualizar contadores de estatísticas de estoque
      if (correctedAvailability === 'inStock') {
        this.inStockCount++;
      } else {
        this.outOfStockCount++;
      }
      
      // Calcular tempo de entrega do Home Depot - passar o SKU para melhor diagnóstico
      const homeDepotLeadTime = this.apiService.calculateDeliveryTime(
        productData.min_delivery_date,
        productData.max_delivery_date,
        productData.sku
      );
      
      // Obter o valor atualizado de HOMEDEPOT_HANDLING_TIME_OMD / LEAD_TIME_OMD
      const omdLeadTime = process.env.HOMEDEPOT_HANDLING_TIME_OMD 
        ? parseInt(process.env.HOMEDEPOT_HANDLING_TIME_OMD, 10) 
        : (process.env.LEAD_TIME_OMD ? parseInt(process.env.LEAD_TIME_OMD, 10) : this.leadTimeOmd);
      
      // handling_time_amz é a soma dos dois tempos de entrega
      // Limitar a 29 dias para evitar erro "Value for 'Fulfillment Availability' is greater than the allowed maximum '30'"
      let handlingTimeAmz = omdLeadTime + homeDepotLeadTime;
      if (handlingTimeAmz > 29) {
        logger.warn(`Tempo de entrega para ${productData.sku} excede o limite máximo: ${handlingTimeAmz} dias. Limitando a 29 dias.`);
        handlingTimeAmz = 29;
      }
      
      logger.debug(`Lead times for product ${productData.sku}: OMD=${omdLeadTime} (from .env), Home Depot=${homeDepotLeadTime}, Total=${handlingTimeAmz} (limitado a 29 dias)`);
      
      // Preparar os novos dados
      const newData = {
        supplier_price: productData.price || 0,
        freight_cost: productData.shipping_cost || 0,
        lead_time: omdLeadTime.toString(),
        lead_time_2: homeDepotLeadTime,
        total_price: productData.total_price || 0,
        quantity,
        availability: correctedAvailability,
        brand: productData.brand || '',
        handling_time_amz: handlingTimeAmz
      };
      
      // Log para diagnóstico antes da comparação
      logger.debug(`[DIAGNÓSTICO] Comparação para ${productData.sku}:\nAtual: ${JSON.stringify(currentData)}\nNovo: ${JSON.stringify(newData)}`);
      
      // Verificar se houve alterações - usar conversão de tipos para comparação consistente
      const hasChanges =
        Number(currentData.supplier_price) !== Number(newData.supplier_price) ||
        Number(currentData.freight_cost) !== Number(newData.freight_cost) ||
        String(currentData.lead_time) !== String(newData.lead_time) ||
        Number(currentData.lead_time_2) !== Number(newData.lead_time_2) ||
        Number(currentData.quantity) !== Number(newData.quantity) ||
        String(currentData.availability) !== String(newData.availability) ||
        String(currentData.brand) !== String(newData.brand) ||
        Number(currentData.handling_time_amz) !== Number(newData.handling_time_amz);
      
      // Sempre atualizar a data da última verificação, independentemente de haver alterações
      const now = new Date();
      
      if (!hasChanges) {
        // Se não houver alterações, apenas atualizar last_update
        const updateLastCheckQuery = `
          UPDATE produtos SET
            last_update = $1
          WHERE sku = $2
        `;
        
        await this.dbService.executeWithRetry(updateLastCheckQuery, [now, productData.sku]);
        
        logger.debug(`Produto ${productData.sku} verificado: sem necessidade de atualização`);
        return { updated: false, message: 'Sem necessidade de atualização' };
      }
      
      // Registrar detalhes das alterações em cada campo
      const changedFields = [];
      if (currentData.supplier_price != newData.supplier_price) {
        changedFields.push(`supplier_price: ${currentData.supplier_price} ---> ${newData.supplier_price}`);
      }
      if (currentData.freight_cost != newData.freight_cost) {
        changedFields.push(`freight_cost: ${currentData.freight_cost} ---> ${newData.freight_cost}`);
      }
      if (currentData.lead_time != newData.lead_time) {
        changedFields.push(`lead_time: ${currentData.lead_time} ---> ${newData.lead_time}`);
      }
      if (currentData.lead_time_2 != newData.lead_time_2) {
        changedFields.push(`lead_time_2: ${currentData.lead_time_2} ---> ${newData.lead_time_2}`);
      }
      if (currentData.quantity != newData.quantity) {
        changedFields.push(`quantity: ${currentData.quantity} ---> ${newData.quantity}`);
      }
      if (currentData.availability != newData.availability) {
        changedFields.push(`availability: ${currentData.availability} ---> ${newData.availability}`);
      }
      if (currentData.brand != newData.brand) {
        changedFields.push(`brand: ${currentData.brand} ---> ${newData.brand}`);
      }
      if (currentData.handling_time_amz != newData.handling_time_amz) {
        changedFields.push(`handling_time_amz: ${currentData.handling_time_amz} ---> ${newData.handling_time_amz}`);
      }
      
      // Logar as alterações detalhadas
      logger.info(`Alterações detectadas para o produto ${productData.sku}, atualizando banco de dados`);
      logger.info(`Alterações detalhadas para o produto ${productData.sku}:\n${changedFields.join('\n')}`);
      
      // Atualizar o produto no banco de dados
      const query = `
        UPDATE produtos SET
          supplier_price = $1,
          freight_cost = $2,
          lead_time = $3,
          lead_time_2 = $4,
          total_price = $5,
          quantity = $6,
          availability = $7,
          brand = $8,
          handling_time_amz = $9,
          last_update = $10,
          atualizado = 1
        WHERE sku = $11
        RETURNING supplier_price, quantity, availability, brand
      `;
      
      const params = [
        newData.supplier_price,
        newData.freight_cost,
        newData.lead_time,
        newData.lead_time_2,
        newData.total_price,
        newData.quantity,
        newData.availability,
        newData.brand,
        newData.handling_time_amz,
        now,
        productData.sku
      ];
      
      const result = await this.dbService.fetchRowWithRetry(query, params);
      return { updated: !!result, message: 'Produto atualizado com sucesso' };
    } catch (error) {
      logger.error(`Erro ao atualizar produto ${productData.sku} no banco de dados: ${error.message}`);
      return { updated: false, message: `Erro: ${error.message}` };
    }
  }
  
  /**
   * Processa um produto
   * @param {DBProduct} dbProduct - Produto do banco de dados
   * @returns {Promise<Object>} - Objeto com status e mensagem
   */
  async processProduct(dbProduct) {
    const sku = dbProduct.sku;
    
    // Verificar se o SKU é válido
    if (!sku || sku.trim() === '') {
      logger.warn('Ignorando produto com SKU vazio');
      return { success: false, message: 'SKU vazio' };
    }
    
    // Verificar se o produto está na lista de skip
    if (skipList[sku]) {
      const skipTimestamp = skipList[sku];
      const now = Date.now() / 1000;
      const hoursSinceSkip = (now - skipTimestamp) / 3600;
      
      // Se o produto foi adicionado à lista de skip há menos de 24 horas, pular
      if (hoursSinceSkip < 24) {
        logger.debug(`Ignorando produto ${sku} (adicionado à lista de skip há ${hoursSinceSkip.toFixed(2)} horas)`);
        await this.updateLastCheck(sku);
        return { success: false, message: 'Produto na lista de skip' };
      } else {
        // Remover da lista de skip após 24 horas
        delete skipList[sku];
      }
    }
    
    try {
      // Buscar dados do produto na API
      logger.info(`Iniciando processamento do produto ${sku}`);
      
      const productData = await this.apiService.fetchProductDataWithRetry(sku);
      
      // Verificar se houve erro na API
      if (productData && productData.error) {
        logger.warn(`Erro na API para o produto ${sku}: ${productData.message}`);
        this.logFailedProduct(sku, productData.message);
        await this.updateLastCheck(sku);
        return { success: false, message: `Erro na API: ${productData.message}` };
      }
      
      // Verificação mais tolerante para dados vazios
      if (!productData) {
        logger.warn(`Nenhum dado retornado para o produto ${sku}`);
        emptyDataSkus.push(sku);
        this.logFailedProduct(sku, 'Nenhum dado retornado da API');
        await this.updateLastCheck(sku);
        return { success: false, message: 'Sem dados da API' };
      }
      
      // Log para depuração
      logger.info(`Dados recebidos para ${sku}: preço=${productData.price}, disponível=${productData.available}, estoque=${productData.stock}`);
      
      // Atualizar o produto no banco de dados
      const updateResult = await this.updateProductInDb(productData);
      
      if (updateResult.updated) {
        logger.info(`Produto ${sku}: Atualizado com sucesso`);
        return { success: true, message: 'Atualizado com sucesso' };
      } else {
        logger.info(`Produto ${sku}: ${updateResult.message}`);
        return { success: true, message: updateResult.message };
      }
    } catch (error) {
      logger.error(`Erro ao processar produto ${sku}: ${error.message}`);
      
      // Registrar detalhes do erro para depuração
      if (error.response) {
        logger.error(`Detalhes da resposta para ${sku}: status=${error.response.status}, data=${JSON.stringify(error.response.data)}`);
      }
      
      problematicProducts.push(dbProduct);
      this.logFailedProduct(sku, error.message);
      await this.updateLastCheck(sku);
      return { success: false, message: `Erro: ${error.message}` };
    }
  }
  
  /**
   * Atualiza a data da última verificação de um produto
   * @param {string} sku - SKU do produto
   * @returns {Promise<boolean>} - true se a atualização for bem-sucedida, false caso contrário
   */
  async updateLastCheck(sku) {
    try {
      // Atualizar apenas a data da última atualização
      const query = `
        UPDATE produtos SET
          last_update = $1
        WHERE sku = $2
      `;
      
      await this.dbService.executeWithRetry(query, [new Date(), sku]);
      return true;
    } catch (error) {
      logger.error(`Error updating last update for product ${sku}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Busca produtos do banco de dados
   * @returns {Promise<Array<DBProduct>>} - Lista de produtos
   */
  async fetchProductsFromDb() {
    try {
      const query = `
        SELECT sku, supplier_price, freight_cost, lead_time, lead_time_2, 
               total_price, quantity, tax_supplier, availability, 
               customer_price_shipping, supplier_price_shipping, 
               handling_time_amz, brand 
        FROM produtos 
        WHERE source = 'Home Depot'
          AND sku IS NOT NULL 
          AND sku <> ''
        ORDER BY last_update ASC
        
      `;
      
      const result = await this.dbService.fetchRowsWithRetry(query);
      
      if (!result || result.length === 0) {
        logger.warn('No products found in database');
        return [];
      }
      
      const products = result.map(row => new DBProduct(
        row.sku,
        row.asin,
        row.sku2,
        row.source
      ));
      
      logger.info(`Fetched ${products.length} products from database`);
      return products;
    } catch (error) {
      logger.error(`Error fetching products from database: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Processa todos os produtos
   * @param {Array<DBProduct>} products - Lista de produtos
   * @returns {Promise<Object>} - Objeto com resultados da processamento
   */
  async processProducts(products) {
    const startTime = Date.now();
    let successCount = 0;
    let noUpdateCount = 0;
    let failCount = 0;
    
    // Atualizar progresso inicial
    if (this._updateProgress) {
      const initialProgressData = {
        phase: 1,
        status: 'processing',
        totalProducts: products.length,
        processedProducts: 0,
        percentage: 0,
        successCount: 0,
        noUpdateCount: 0,
        failCount: 0,
        isRunning: true
      };
      
      this._updateProgress(initialProgressData);
    }
    
    // Criar fila de processamento com concorrência limitada
    // Usar nossa implementação simples de fila
    const queue = new SimpleQueue({ concurrency: 5 });
    
    // Adicionar cada produto à fila de processamento
    const tasks = products.map((product, index) => async () => {
      // Verificar cancelamento
      if (this._checkCancellation && this._checkCancellation()) {
        return { status: 'cancelled' };
      }
      
      try {
        const result = await this.processProduct(product);
        
        // Atualizar contadores
        if (result.status === 'updated') {
          successCount++;
        } else if (result.status === 'no_update') {
          noUpdateCount++;
        } else if (result.status === 'failed') {
          failCount++;
        }
        
        // Atualizar progresso
        if (this._updateProgress) {
          const processed = index + 1;
          const percentage = Math.floor((processed / products.length) * 100);
          
          const progressData = {
            phase: 1,
            status: 'processing',
            totalProducts: products.length,
            processedProducts: processed,
            percentage,
            successCount,
            noUpdateCount,
            failCount,
            isRunning: true
          };
          
          this._updateProgress(progressData);
        }
        
        return result;
      } catch (error) {
        logger.error(`Error processing product ${product.sku}: ${error.message}`);
        failCount++;
        return { status: 'failed', message: error.message };
      }
    });
    
    // Adicionar tarefas à fila
    tasks.forEach(task => queue.add(task));
    
    // Aguardar conclusão de todas as tarefas
    await queue.onIdle();
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    logger.info(`Processed ${products.length} products in ${duration.toFixed(2)} seconds`);
    logger.info(`Success: ${successCount}, No Update: ${noUpdateCount}, Failed: ${failCount}`);
    
    return {
      successCount,
      noUpdateCount,
      failCount,
      duration: duration.toFixed(2)
    };
  }
  
  /**
   * Reprocessa produtos problemáticos
   * @returns {Promise<Object>} - Objeto com resultados da reprocessamento
   */
  async reprocessProblematicProducts() {
    const startTime = Date.now();
    let successCount = 0;
    let noUpdateCount = 0;
    let failCount = 0;
    
    logger.info(`Reprocessing ${problematicProducts.length} problematic products`);
    
    // Atualizar progresso para indicar reprocessamento
    if (this._updateProgress) {
      const reprocessProgressData = {
        phase: 1,
        status: 'reprocessing',
        totalProducts: problematicProducts.length,
        processedProducts: 0,
        percentage: 0,
        successCount,
        noUpdateCount,
        failCount,
        isRunning: true,
        reprocessing: true,
        problematicCount: problematicProducts.length
      };
      
      this._updateProgress(reprocessProgressData);
    }
    
    // Criar fila de processamento com concorrência limitada
    // Usar nossa implementação simples de fila
    const queue = new SimpleQueue({ concurrency: 3 });
    
    // Adicionar cada produto à fila de processamento
    const tasks = problematicProducts.map((product, index) => async () => {
      // Verificar cancelamento
      if (this._checkCancellation && this._checkCancellation()) {
        return { status: 'cancelled' };
      }
      
      try {
        const result = await this.processProduct(product);
        
        // Atualizar contadores
        if (result.status === 'updated') {
          successCount++;
        } else if (result.status === 'no_update') {
          noUpdateCount++;
        } else if (result.status === 'failed') {
          failCount++;
        }
        
        // Atualizar progresso
        if (this._updateProgress) {
          const processed = index + 1;
          const percentage = Math.floor((processed / problematicProducts.length) * 100);
          
          const progressData = {
            phase: 1,
            status: 'reprocessing',
            totalProducts: problematicProducts.length,
            processedProducts: processed,
            percentage,
            successCount,
            noUpdateCount,
            failCount,
            isRunning: true
          };
          
          this._updateProgress(progressData);
        }
        
        return result;
      } catch (error) {
        logger.error(`Error reprocessing product ${product.sku}: ${error.message}`);
        failCount++;
        return { status: 'failed', message: error.message };
      }
    });
    
    // Adicionar tarefas à fila
    tasks.forEach(task => queue.add(task));
    
    // Aguardar conclusão de todas as tarefas
    await queue.onIdle();
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    logger.info(`Reprocessed ${problematicProducts.length} products in ${duration.toFixed(2)} seconds`);
    logger.info(`Success: ${successCount}, No Update: ${noUpdateCount}, Failed: ${failCount}`);
    
    return {
      successCount,
      noUpdateCount,
      failCount,
      duration: duration.toFixed(2)
    };
  }
}

/**
 * Executa a Fase 1: Atualização de produtos
 * @param {boolean} skipProblematic - Se deve ignorar o reprocessamento de produtos problemáticos
 * @param {number} requestsPerSecond - Número máximo de requisições por segundo
 * @param {function} checkCancellation - Função de verificação de cancelamento
 * @param {function} updateProgress - Função para atualizar o progresso
 * @returns {Promise<Object>} - Objeto com resultados da execução
 */
async function runPhase1(skipProblematic = false, requestsPerSecond = API_CONFIG.requestsPerSecond, checkCancellation = null, updateProgress = null) {
  logger.info('Iniciando Fase 1: Atualização de Produtos');
  
  // Carregar a lista de produtos a serem ignorados
  await loadSkipList();
  
  const startTime = Date.now();
  
  // Criar instância do serviço de sincronização
  const sync = new ProductSync(
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    },
    process.env.API_BASE_URL,
    requestsPerSecond,
    checkCancellation,
    updateProgress
  );
  
  try {
    // Inicializar serviços
    await sync.init();
    
    // Verificar se a sincronização foi cancelada
    if (checkCancellation && checkCancellation()) {
      logger.info('Sincronização cancelada antes de buscar produtos');
      return { success: false, message: 'Cancelado pelo usuário' };
    }
    
    // Buscar produtos do banco de dados
    const products = await sync.fetchProductsFromDb();
    
    if (products.length === 0) {
      logger.warn('Nenhum produto para processar');
      return { success: false, message: 'Nenhum produto encontrado' };
    }
    
    // Atualizar progresso com o total de produtos
    if (updateProgress) {
      const initialProgressData = {
        phase: 1,
        status: 'processing',
        totalProducts: products.length,
        processedProducts: 0,
        percentage: 0,
        successCount: 0,
        noUpdateCount: 0,
        failCount: 0,
        isRunning: true
      };
      
      updateProgress(initialProgressData);
    }
    
    // Verificar se a sincronização foi cancelada
    if (checkCancellation && checkCancellation()) {
      logger.info('Sincronização cancelada antes de processar produtos');
      return { success: false, message: 'Cancelado pelo usuário' };
    }
    
    // Processar produtos
    let successCount = 0;
    let noUpdateCount = 0;
    let failCount = 0;
    
    const results = await sync.processProducts(products);
    
    successCount = results.successCount || 0;
    noUpdateCount = results.noUpdateCount || 0;
    failCount = results.failCount || 0;
    
    // Verificar se a sincronização foi cancelada
    if (checkCancellation && checkCancellation()) {
      logger.info('Sincronização cancelada após processar produtos');
      return { 
        success: successCount > 0,
        successCount,
        noUpdateCount,
        failCount,
        message: 'Cancelado pelo usuário após processamento parcial'
      };
    }
    
    // Reprocessar produtos problemáticos
    if (!skipProblematic && problematicProducts.length > 0) {
      // Verificar cancelamento antes de reprocessar
      if (checkCancellation && checkCancellation()) {
        logger.info('Sincronização cancelada antes de reprocessar produtos problemáticos');
        return { 
          success: successCount > 0,
          successCount,
          noUpdateCount,
          failCount,
          message: 'Cancelado pelo usuário antes do reprocessamento'
        };
      }
      
      // Atualizar progresso para indicar reprocessamento
      if (updateProgress) {
        const reprocessProgressData = {
          phase: 1,
          status: 'reprocessing',
          totalProducts: problematicProducts.length,
          processedProducts: 0,
          percentage: 0,
          successCount,
          noUpdateCount,
          failCount,
          isRunning: true,
          reprocessing: true,
          problematicCount: problematicProducts.length
        };
        
        updateProgress(reprocessProgressData);
      }
      
      const reprocessResults = await sync.reprocessProblematicProducts();
      successCount += reprocessResults.successCount || 0;
      noUpdateCount += reprocessResults.noUpdateCount || 0;
      failCount += reprocessResults.failCount || 0;
      
      // Atualizar progresso após reprocessamento
      if (updateProgress) {
        const postReprocessProgressData = {
          phase: 1,
          status: 'completed',
          totalProducts: products.length + problematicProducts.length,
          processedProducts: products.length + problematicProducts.length,
          percentage: 100,
          successCount,
          noUpdateCount,
          failCount,
          isRunning: false,
          reprocessing: false,
          reprocessedSuccess: reprocessResults.successCount,
          completed: true
        };
        
        updateProgress(postReprocessProgressData);
      }
    }
    
    // Salvar a lista de produtos que falharam em um CSV
    const failedProductsFile = await sync.saveFailedProductsToCSV();
    
    // Salvar a lista de produtos a serem ignorados
    await saveSkipList();
    
    // Salvar a lista de SKUs que retornaram dados vazios
    await saveEmptyDataSkus();
    
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    
    logger.info(`Fase 1 concluída em ${duration.toFixed(2)} segundos`);
    logger.info(`Produtos processados: ${products.length}`);
    logger.info(`  - Atualizados: ${successCount}`);
    logger.info(`  - Sem necessidade de atualização: ${noUpdateCount}`);
    logger.info(`  - Falhas: ${failCount}`);
    logger.info(`Estatísticas de estoque:`);
    logger.info(`  - Produtos em estoque: ${sync.inStockCount}`);
    logger.info(`  - Produtos fora de estoque: ${sync.outOfStockCount}`);
    
    // Atualizar progresso final com resumo
    if (updateProgress) {
      updateProgress({
        completed: true,
        duration: duration.toFixed(2),
        percentage: 100,
        successCount,
        noUpdateCount,
        failCount,
        inStockCount: sync.inStockCount,
        outOfStockCount: sync.outOfStockCount,
        failedProductsFile
      });
    }
    
    return { 
      success: true, 
      successCount,
      noUpdateCount,
      failCount,
      inStockCount: sync.inStockCount,
      outOfStockCount: sync.outOfStockCount,
      duration: duration.toFixed(2),
      message: 'Fase 1 concluída com sucesso'
    };
  } catch (error) {
    logger.error(`Erro na Fase 1: ${error.message}`);
    
    // Atualizar progresso com erro
    if (updateProgress) {
      updateProgress({
        error: error.message,
        errors: [{
          message: error.message,
          phase: 1,
          timestamp: new Date().toISOString()
        }]
      });
    }
    
    return { 
      success: false, 
      message: `Erro: ${error.message}`
    };
  } finally {
    // Fechar serviços
    await sync.close();
  }
}

module.exports = {
  runPhase1,
  ProductSync,
  loadSkipList,
  saveSkipList,
  saveEmptyDataSkus
};