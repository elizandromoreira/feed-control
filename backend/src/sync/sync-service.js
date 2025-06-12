/**
 * Sync Service
 * 
 * This service manages synchronization operations using the provider architecture.
 */

const { getProviderFactory } = require('../providers/provider-factory');
const { getStoreConfig } = require('../services/storeConfigService');
const logger = require('../config/logging')();

/**
 * Sync a store using the appropriate provider
 * @param {string} storeId - Store ID
 * @param {boolean} skipProblematic - Whether to skip problematic products
 * @param {number} requestsPerSecond - API request rate limit
 * @param {number} batchSize - Batch size for Phase 2
 * @param {Function} checkCancellation - Function to check if process should be cancelled
 * @param {Function} updateProgress - Function to update progress information
 * @returns {Promise<boolean>} Whether the sync was successful
 */
async function syncStoreWithProvider(
  storeId,
  skipProblematic = false,
  requestsPerSecond,
  batchSize,
  checkCancellation = null,
  updateProgress = null
) {
  const storeConfig = await getStoreConfig(storeId);
  
  if (!storeConfig) {
    logger.error(`[Sync Service] Configuração para a loja ${storeId} não encontrada.`);
    return false;
  }
  
  const storeName = storeConfig.displayName || storeId;
  let provider;

  logger.info(`Iniciando sincronização para a loja ${storeName} (${storeId})`);
  
  try {
    const providerFactory = getProviderFactory();
    const providerId = storeId;

    if (!providerFactory.hasProvider(providerId)) {
      logger.error(`Nenhum provider registrado para a loja ${storeName} (${storeId})`);
      return false;
    }
    
    const effectiveRequestsPerSecond = requestsPerSecond ?? storeConfig.requestsPerSecond;
    const effectiveBatchSize = batchSize ?? storeConfig.batchSize ?? 9990;

    provider = providerFactory.getProvider(providerId, storeConfig);
    
    logger.info(`Usando provider ${provider.getName()} para a loja ${storeName}`);
    
    if (checkCancellation && checkCancellation()) {
      logger.info(`Sincronização para ${storeName} cancelada antes de iniciar.`);
      return false;
    }
    
    let useSkipProblematic = skipProblematic;
    if (storeId === 'bestbuy') {
      useSkipProblematic = true;
      logger.info('Usando skipProblematic=true para Best Buy para lidar com erros da API');
    }
    
    logger.info(`Iniciando Fase 1 para a loja ${storeName}`);
    const phase1Result = await provider.executePhase1(
      useSkipProblematic,
      effectiveRequestsPerSecond,
      checkCancellation,
      updateProgress,
      effectiveBatchSize
    );
    
    if (checkCancellation && checkCancellation()) {
      logger.info(`Sincronização para ${storeName} cancelada após a Fase 1.`);
      return false;
    }
    
    logger.info(`Iniciando Fase 2 para a loja ${storeName}`);
    const phase2Result = await provider.executePhase2(
      effectiveBatchSize,
      30000,
      checkCancellation,
      updateProgress
    );
    
    logger.info(`Sincronização concluída para a loja ${storeName}`);
    logger.info(`Fase 1: Processados ${phase1Result.totalProducts} produtos, ${phase1Result.successCount} sucedidos, ${phase1Result.failCount} falharam`);
    logger.info(`Fase 2: Processados ${phase2Result.totalProducts} produtos, ${phase2Result.successCount} sucedidos, ${phase2Result.failCount} falharam`);
    
    return true;

  } catch (error) {
    logger.error(`Erro ao sincronizar a loja ${storeName}: ${error.message}`, { error });
    return false;

  } finally {
    try {
      if (provider?.close) {
        await provider.close();
        logger.info(`Conexão do provider para ${storeName} fechada.`);
      }
    } catch (closeError) {
      logger.error(`Erro ao fechar a conexão do provider para ${storeName}: ${closeError.message}`);
    }
  }
}

module.exports = { syncStoreWithProvider }; 