/**
 * Sync Service
 * 
 * This service manages synchronization operations using the provider architecture.
 * It connects the store manager with the appropriate provider implementation.
 */

const { getProviderFactory } = require('../providers/provider-factory');
const { getStoreManager } = require('../services/storeManager');
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
  requestsPerSecond = 7,
  batchSize = 9990,
  checkCancellation = null,
  updateProgress = null
) {
  // Get store information
  const storeManager = await getStoreManager();
  const store = storeManager.getStoreById(storeId);
  
  if (!store) {
    logger.error(`Store with ID ${storeId} not found`);
    return false;
  }
  
  logger.info(`Starting synchronization for store ${store.name} (${storeId})`);
  
  try {
    // Update store status to running
    await storeManager.updateStoreStatus(storeId, 'Executando');
    
    // Get the appropriate provider
    const providerFactory = getProviderFactory();
    
    // Map store ID to provider ID (in a real implementation, this would be more robust)
    const providerId = storeId; // Assuming storeId matches providerId
    
    // Verify that the provider exists
    if (!providerFactory.hasProvider(providerId)) {
      logger.error(`No provider registered for store ${store.name} (${storeId})`);
      await storeManager.updateStoreStatus(storeId, 'Erro');
      return false;
    }
    
    // Get provider instance
    const provider = providerFactory.getProvider(providerId, {
      apiBaseUrl: store.apiBaseUrl,
      requestsPerSecond
    });
    
    logger.info(`Using provider ${provider.getName()} for store ${store.name}`);
    
    // Check cancellation before starting
    if (checkCancellation && checkCancellation()) {
      logger.info(`Sync for ${store.name} cancelled before starting`);
      await storeManager.updateStoreStatus(storeId, 'Interrompido');
      return false;
    }
    
    // Para Best Buy, sempre usar skipProblematic = true para lidar com erros da API
    let useSkipProblematic = skipProblematic;
    if (storeId === 'bestbuy') {
      useSkipProblematic = true;
      logger.info('Using skipProblematic=true for Best Buy to handle API errors');
    }
    
    // Execute Phase 1
    logger.info(`Starting Phase 1 for store ${store.name}`);
    const phase1Result = await provider.executePhase1(
      useSkipProblematic,
      requestsPerSecond,
      checkCancellation,
      updateProgress
    );
    
    // Check cancellation before Phase 2
    if (checkCancellation && checkCancellation()) {
      logger.info(`Sync for ${store.name} cancelled after Phase 1`);
      await storeManager.updateStoreStatus(storeId, 'Interrompido');
      return false;
    }
    
    // Execute Phase 2
    logger.info(`Starting Phase 2 for store ${store.name}`);
    const phase2Result = await provider.executePhase2(
      batchSize,
      30000, // checkInterval
      checkCancellation,
      updateProgress
    );
    
    // Update store status and last sync timestamp
    await storeManager.updateStoreStatus(storeId, 'Inativo');
    await storeManager.updateLastSync(storeId);
    
    logger.info(`Completed synchronization for store ${store.name}`);
    logger.info(`Phase 1: Processed ${phase1Result.totalProducts} products, ${phase1Result.successCount} successful, ${phase1Result.failCount} failed`);
    logger.info(`Phase 2: Processed ${phase2Result.totalProducts} products, ${phase2Result.successCount} successful, ${phase2Result.failCount} failed`);
    
    // Fechar a conexão mesmo em caso de erro
    try {
      if (provider && provider.dbInitialized === true) {
        await provider.close();
        logger.info(`Provider connection closed after Phase 2`);
      } else {
        logger.info('Provider connection already closed or not initialized');
      }
    } catch (closeError) {
      logger.error(`Error closing provider connection: ${closeError.message}`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error synchronizing store ${store.name}: ${error.message}`, { error });
    
    // Update store status to error
    await storeManager.updateStoreStatus(storeId, 'Erro');
    
    // Fechar a conexão mesmo em caso de erro
    try {
      if (provider && provider.dbInitialized === true) {
        await provider.close();
        logger.info(`Provider connection closed after error`);
      } else {
        logger.info('Provider connection already closed or not initialized');
      }
    } catch (closeError) {
      logger.error(`Error closing provider connection: ${closeError.message}`);
    }
    
    return false;
  }
}

/**
 * Run a specific phase for a store
 * @param {string} storeId - Store ID
 * @param {number} phase - Phase to run (1 or 2)
 * @param {boolean} skipProblematic - Whether to skip problematic products
 * @param {number} requestsPerSecond - API request rate limit
 * @param {number} batchSize - Batch size for Phase 2
 * @param {Function} checkCancellation - Function to check if process should be cancelled
 * @param {Function} updateProgress - Function to update progress information
 * @returns {Promise<boolean>} Whether the phase was successfully executed
 */
async function runStorePhase(
  storeId,
  phase,
  skipProblematic = false,
  requestsPerSecond = 7,
  batchSize = 9990,
  checkCancellation = null,
  updateProgress = null
) {
  // Get store information
  const storeManager = await getStoreManager();
  const store = storeManager.getStoreById(storeId);
  
  if (!store) {
    logger.error(`Store with ID ${storeId} not found`);
    return false;
  }
  
  logger.info(`Starting Phase ${phase} for store ${store.name} (${storeId})`);
  
  try {
    // Update store status to running
    await storeManager.updateStoreStatus(storeId, 'Executando');
    
    // Get the appropriate provider
    const providerFactory = getProviderFactory();
    
    // Map store ID to provider ID
    const providerId = storeId; // Assuming storeId matches providerId
    
    // Definir o ID do provider atual como variável de ambiente
    process.env.CURRENT_PROVIDER_ID = providerId;
    
    // Verify that the provider exists
    if (!providerFactory.hasProvider(providerId)) {
      logger.error(`No provider registered for store ${store.name} (${storeId})`);
      await storeManager.updateStoreStatus(storeId, 'Erro');
      return false;
    }
    
    // Get provider instance
    const provider = providerFactory.getProvider(providerId, {
      apiBaseUrl: store.apiBaseUrl,
      requestsPerSecond
    });
    
    logger.info(`Using provider ${provider.getName()} for store ${store.name}`);
    
    // Check cancellation before starting
    if (checkCancellation && checkCancellation()) {
      logger.info(`Phase ${phase} for ${store.name} cancelled before starting`);
      await storeManager.updateStoreStatus(storeId, 'Interrompido');
      return false;
    }
    
    let result;
    
    // Execute the requested phase
    if (phase === 1) {
      logger.info(`Executing Phase 1 for ${store.name} using ${provider.getName()} provider`);
      result = await provider.executePhase1(
        skipProblematic,
        requestsPerSecond,
        checkCancellation,
        updateProgress
      );
    } else if (phase === 2) {
      logger.info(`Executing Phase 2 for ${store.name} using ${provider.getName()} provider`);
      result = await provider.executePhase2(
        batchSize,
        30000, // checkInterval
        checkCancellation,
        updateProgress
      );
    } else {
      throw new Error(`Invalid phase: ${phase}`);
    }
    
    // Update store status and last sync timestamp
    await storeManager.updateStoreStatus(storeId, 'Inativo');
    await storeManager.updateLastSync(storeId);
    
    logger.info(`Completed Phase ${phase} for store ${store.name}`);
    logger.info(`Processed ${result.totalProducts} products, ${result.successCount} successful, ${result.failCount} failed`);
    
    // Fechar a conexão mesmo em caso de erro
    try {
      if (provider && provider.dbInitialized === true) {
        await provider.close();
        logger.info(`Provider connection closed after Phase ${phase}`);
      } else {
        logger.info('Provider connection already closed or not initialized');
      }
    } catch (closeError) {
      logger.error(`Error closing provider connection: ${closeError.message}`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error executing Phase ${phase} for store ${store.name}: ${error.message}`, { error });
    
    // Update store status to error
    await storeManager.updateStoreStatus(storeId, 'Erro');
    
    // Fechar a conexão mesmo em caso de erro
    try {
      if (provider && provider.dbInitialized === true) {
        await provider.close();
        logger.info(`Provider connection closed after error`);
      } else {
        logger.info('Provider connection already closed or not initialized');
      }
    } catch (closeError) {
      logger.error(`Error closing provider connection: ${closeError.message}`);
    }
    
    return false;
  }
}

module.exports = {
  syncStoreWithProvider,
  runStorePhase
}; 