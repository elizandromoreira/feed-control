/**
 * Rechecagem de produtos com falha
 * 
 * Este módulo implementa a funcionalidade de rechecagem de produtos que falharam
 * durante a Fase 1, antes de prosseguir para a Fase 2. O objetivo é tentar recuperar
 * o máximo de produtos possível, já que algumas falhas podem ser temporárias.
 */

const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const { createReadStream } = require('fs');
const HomeDepotApiService = require('../services/homeDepotApi');
const DatabaseService = require('../services/database');
const { DBProduct } = require('../models/DBProduct');
const logger = require('../config/logging')();
// Substituir importação direta do p-queue pelo nosso adaptador
const SimpleQueue = require('../utils/simple-queue');

// Diretório para logs
const LOG_DIR = path.join(__dirname, '../../logs');

/**
 * Obtém o arquivo de produtos com falha mais recente
 * @returns {Promise<string|null>} - Caminho para o arquivo mais recente ou null se não existir
 */
async function getMostRecentFailedProductsFile() {
  try {
    // Verificar se o diretório de logs existe
    try {
      await fs.access(LOG_DIR);
    } catch (error) {
      logger.error(`Diretório de logs não encontrado: ${error.message}`);
      return null;
    }
    
    // Listar arquivos no diretório de logs
    const files = await fs.readdir(LOG_DIR);
    
    // Filtrar apenas arquivos CSV que começam com 'failed_products_'
    const failedProductsLogs = files.filter(file => 
      file.startsWith('failed_products_') && file.endsWith('.csv')
    );
    
    if (failedProductsLogs.length === 0) {
      logger.info('Nenhum arquivo de produtos com falha encontrado');
      return null;
    }
    
    // Mapear arquivos com suas datas
    const fileInfos = failedProductsLogs.map(file => {
      let date;
      try {
        // O formato atual é: failed_products_YYYY-MM-DDTHH-MM-SS-MMMZ.csv
        const dateStr = file.replace('failed_products_', '').replace('.csv', '');
        
        if (dateStr.includes('T')) {
          // Converter hífens em dois pontos após o T
          const formattedDate = dateStr.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
          date = new Date(formattedDate);
        } else {
          // Formato antigo: YYYY-MM-DD-HH-MM-SS
          const formattedDate = dateStr.replace(/(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})/, '$1T$2:$3:$4');
          date = new Date(formattedDate);
        }
      } catch (error) {
        // Usar data atual como fallback
        logger.warn(`Não foi possível analisar a data do arquivo ${file}: ${error.message}`);
        date = new Date(0); // 1970-01-01
      }
      
      return {
        file,
        date
      };
    });
    
    // Ordenar por data, do mais recente para o mais antigo
    fileInfos.sort((a, b) => b.date - a.date);
    
    if (fileInfos.length > 0) {
      const mostRecentFile = path.join(LOG_DIR, fileInfos[0].file);
      logger.info(`Arquivo de produtos com falha mais recente: ${mostRecentFile}`);
      return mostRecentFile;
    }
    
    return null;
  } catch (error) {
    logger.error(`Erro ao buscar arquivo de produtos com falha: ${error.message}`);
    return null;
  }
}

/**
 * Lê os SKUs dos produtos com falha de um arquivo CSV
 * @param {string} filePath - Caminho para o arquivo CSV
 * @returns {Promise<Array<{sku: string, reason: string}>>} - Lista de SKUs com suas razões de falha
 */
async function readFailedProductsFromCSV(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    
    createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => results.push({
        sku: data.sku,
        reason: data.reason
      }))
      .on('end', () => {
        logger.info(`Lidos ${results.length} produtos com falha do arquivo ${filePath}`);
        resolve(results);
      })
      .on('error', (error) => {
        logger.error(`Erro ao ler arquivo CSV: ${error.message}`);
        reject(error);
      });
  });
}

/**
 * Atualiza um produto no banco de dados com os dados recuperados da API
 * @param {Object} productData - Dados do produto
 * @param {DatabaseService} dbService - Serviço de banco de dados
 * @returns {Promise<boolean>} - true se o produto foi atualizado com sucesso
 */
async function updateProductInDb(productData, dbService) {
  try {
    // Primeiro, verificar se o produto existe no banco
    const checkQuery = `SELECT sku FROM produtos WHERE sku = $1`;
    const existingProduct = await dbService.fetchRowWithRetry(checkQuery, [productData.sku]);
    
    if (!existingProduct) {
      logger.warn(`Produto ${productData.sku} não encontrado no banco de dados`);
      return false;
    }
    
    // Verificação rigorosa dos dados - substituir por uma abordagem mais tolerante
    if (productData.price === undefined) productData.price = 0;
    if (productData.available === undefined) productData.available = false;
    if (productData.stock === undefined) productData.stock = 0;
    
    // Calcular quantidade e disponibilidade de forma mais precisa
    // Buscar o valor atualizado no process.env
    const currentStockLevel = process.env.HOMEDEPOT_STOCK_LEVEL 
      ? parseInt(process.env.HOMEDEPOT_STOCK_LEVEL, 10) 
      : 7;
    
    // Calcular disponibilidade de forma mais rigorosa
    let availability = 'outOfStock';
    let quantity = 0;
    
    // Usar o valor de 3 como referência para estoque mínimo, consistente com calculateQuantity
    if (productData.available && productData.stock > 3) {
      availability = 'inStock';
      quantity = currentStockLevel;
      logger.info(`Produto ${productData.sku} marcado como disponível: estoque=${productData.stock}`);
    } else {
      logger.info(`Produto ${productData.sku} marcado como indisponível: disponível=${productData.available}, estoque=${productData.stock}`);
    }
    
    // Calcular tempo de entrega do Home Depot
    // Obter o valor atualizado de LEAD_TIME_OMD
    const omdLeadTime = process.env.HOMEDEPOT_HANDLING_TIME_OMD 
      ? parseInt(process.env.HOMEDEPOT_HANDLING_TIME_OMD, 10) 
      : (process.env.LEAD_TIME_OMD ? parseInt(process.env.LEAD_TIME_OMD, 10) : 2);
    
    // Calcular o tempo de entrega do Home Depot
    let homeDepotLeadTime = omdLeadTime; // Valor padrão
    
    if (productData.min_delivery_date && productData.max_delivery_date) {
      const minDate = new Date(productData.min_delivery_date);
      const maxDate = new Date(productData.max_delivery_date);
      
      if (!isNaN(minDate.getTime()) && !isNaN(maxDate.getTime())) {
        // Calcular a data média entre a data mínima e máxima de entrega
        const avgDeliveryTime = new Date((minDate.getTime() + maxDate.getTime()) / 2);
        
        // Calcular a diferença em dias entre a data atual e a data média de entrega
        const now = new Date();
        const diffTime = avgDeliveryTime.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        homeDepotLeadTime = Math.max(1, diffDays);
      }
    }
    
    // Calcular o tempo de manuseio total
    const handlingTimeAmz = omdLeadTime + homeDepotLeadTime;
    
    // Atualizar o produto no banco de dados
    const updateQuery = `
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
    `;
    
    const totalPrice = (parseFloat(productData.price) || 0) + 
                       (parseFloat(productData.shipping_cost) || 0);
    
    await dbService.executeWithRetry(updateQuery, [
      parseFloat(productData.price) || 0,
      parseFloat(productData.shipping_cost) || 0,
      omdLeadTime.toString(),
      homeDepotLeadTime,
      totalPrice,
      quantity,
      availability,
      productData.brand || '',
      handlingTimeAmz,
      new Date(),
      productData.sku
    ]);
    
    logger.info(`Produto ${productData.sku} recuperado e atualizado com sucesso (${availability})`);
    return true;
  } catch (error) {
    logger.error(`Erro ao atualizar produto ${productData.sku} no banco de dados: ${error.message}`);
    return false;
  }
}

/**
 * Rechecagem de produtos com falha antes de iniciar a Fase 2
 * @param {number} requestsPerSecond - Número máximo de requisições por segundo
 * @param {Function} checkCancellation - Função para verificar se a operação foi cancelada
 * @param {Function} updateProgress - Função para atualizar o progresso
 * @returns {Promise<Object>} - Resultados da rechecagem
 */
async function recheckLastFailedProducts(requestsPerSecond = 5, checkCancellation = null, updateProgress = null) {
  logger.info('Iniciando rechecagem de produtos com falha antes da Fase 2');
  
  // Inicializar contadores
  const results = {
    totalChecked: 0,
    successCount: 0,
    failCount: 0,
    inStockCount: 0,
    outOfStockCount: 0
  };
  
  try {
    // Buscar o arquivo de produtos com falha mais recente
    const failedProductsFile = await getMostRecentFailedProductsFile();
    
    if (!failedProductsFile) {
      logger.info('Nenhum arquivo de produtos com falha encontrado para rechecagem');
      return results;
    }
    
    // Ler os SKUs dos produtos com falha
    const failedProducts = await readFailedProductsFromCSV(failedProductsFile);
    
    if (failedProducts.length === 0) {
      logger.info('Nenhum produto com falha encontrado no arquivo');
      return results;
    }
    
    results.totalChecked = failedProducts.length;
    
    // Inicializar serviços
    // Usando uma taxa de requisições mais conservadora para garantir qualidade dos dados
    const apiService = new HomeDepotApiService(process.env.API_BASE_URL, Math.min(requestsPerSecond, 3));
    const dbService = new DatabaseService({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    });
    
    // Inicializar banco de dados
    await dbService.init();
    
    // Atualizar progresso inicial
    if (updateProgress) {
      updateProgress({
        recheckingPhase: 'started',
        totalFailedProducts: failedProducts.length,
        recheckingProgress: 0
      });
    }
    
    // Criar fila de processamento com controle de concorrência
    // Usando concorrência mais baixa para garantir qualidade
    const queue = new SimpleQueue({ concurrency: Math.min(requestsPerSecond, 3) });
    
    // Lista para armazenar promessas
    const promises = [];
    
    // Processar cada produto com falha
    for (let i = 0; i < failedProducts.length; i++) {
      // Verificar se a operação foi cancelada
      if (checkCancellation && checkCancellation()) {
        logger.info('Rechecagem de produtos cancelada');
        break;
      }
      
      const { sku, reason } = failedProducts[i];
      
      // Adicionar à fila de processamento
      const promise = queue.add(async () => {
        try {
          // Verificar novamente se a operação foi cancelada
          if (checkCancellation && checkCancellation()) {
            return { success: false, cancelled: true };
          }
          
          // Tentar buscar os dados do produto novamente
          logger.info(`Rechecando produto ${sku} (falha anterior: ${reason})`);
          const productData = await apiService.fetchProductDataWithRetry(sku);
          
          if (!productData) {
            logger.warn(`Rechecagem falhou: Produto ${sku} não retornou dados da API`);
            return { success: false, cancelled: false };
          }
          
          // Verificação rigorosa dos dados
          if (productData.price === undefined) productData.price = 0;
          if (productData.available === undefined) productData.available = false;
          if (productData.stock === undefined) productData.stock = 0;
          
          // Atualizar o produto no banco de dados
          const updated = await updateProductInDb(productData, dbService);
          
          // Contar produtos em estoque e fora de estoque
          if (updated) {
            if (productData.available && productData.stock > 3) {
              return { success: true, cancelled: false, inStock: true };
            } else {
              return { success: true, cancelled: false, inStock: false };
            }
          }
          
          return { success: false, cancelled: false };
        } catch (error) {
          logger.error(`Erro ao rechecar produto ${sku}: ${error.message}`);
          return { success: false, cancelled: false };
        }
      });
      
      promises.push(promise);
      
      // Atualizar progresso a cada 5 produtos ou no final
      if ((i + 1) % 5 === 0 || i === failedProducts.length - 1) {
        // Atualizar progresso
        if (updateProgress) {
          updateProgress({
            recheckingPhase: 'processing',
            totalFailedProducts: failedProducts.length,
            processedCount: i + 1,
            recheckingProgress: Math.round(((i + 1) / failedProducts.length) * 100)
          });
        }
      }
    }
    
    // Aguardar todas as promessas serem resolvidas
    const promiseResults = await Promise.all(promises);
    
    // Contabilizar resultados
    for (const result of promiseResults) {
      if (result.cancelled) continue;
      
      if (result.success) {
        results.successCount++;
        if (result.inStock) {
          results.inStockCount++;
        } else {
          results.outOfStockCount++;
        }
      } else {
        results.failCount++;
      }
    }
    
    // Fechar serviço de banco de dados
    await dbService.close();
    
    // Atualizar progresso final
    if (updateProgress) {
      updateProgress({
        recheckingPhase: 'completed',
        totalFailedProducts: failedProducts.length,
        processedCount: failedProducts.length,
        recheckingProgress: 100,
        successCount: results.successCount,
        failCount: results.failCount,
        inStockCount: results.inStockCount,
        outOfStockCount: results.outOfStockCount
      });
    }
    
    logger.info(`Rechecagem concluída: ${results.successCount} produtos recuperados (${results.inStockCount} em estoque, ${results.outOfStockCount} fora de estoque), ${results.failCount} falhas`);
    return results;
  } catch (error) {
    logger.error(`Erro durante a rechecagem de produtos: ${error.message}`);
    
    // Atualizar progresso com erro
    if (updateProgress) {
      updateProgress({
        recheckingPhase: 'error',
        error: error.message
      });
    }
    
    return results;
  }
}

module.exports = {
  recheckLastFailedProducts,
  getMostRecentFailedProductsFile,
  readFailedProductsFromCSV
}; 