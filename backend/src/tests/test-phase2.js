/**
 * Teste isolado da Phase 2 - Envio de dados para Amazon
 * 
 * Este script executa apenas a Phase 2 do processo de sincronização,
 * que envia os dados atualizados dos produtos para a Amazon Seller API.
 */

const { mainPhase2 } = require('../phases/phase2');
const logger = require('../config/logging')();

/**
 * Função auxiliar para atualização de progresso
 * @param {Object} progress - Informações de progresso
 */
function updateProgress(progress) {
  if (progress.error) {
    logger.error(`PROGRESS ERROR: ${progress.error}`);
    return;
  }
  
  if (progress.phase2Complete) {
    logger.info('PROGRESS: Phase 2 complete');
    return;
  }
  
  if (progress.batchStatus) {
    logger.info(`PROGRESS: Batch ${progress.currentBatch}/${progress.totalBatches || 'unknown'} - Status: ${progress.batchStatus}`);
  }
  
  if (progress.percentage !== undefined) {
    logger.info(`PROGRESS: ${progress.processedProducts || 0}/${progress.totalProducts || 0} products (${progress.percentage}%)`);
  }
}

/**
 * Função principal para executar o teste
 */
async function runTest() {
  logger.info('=== STARTING PHASE 2 TEST ===');
  logger.info('This test will send inventory updates to Amazon');
  
  try {
    // Configurações para a execução
    const checkInterval = 30000; // 30 segundos entre verificações de status
    
    // Função para verificar cancelamento (sempre retorna false neste teste)
    const checkCancellation = () => false;
    
    // Executar Phase 2
    const result = await mainPhase2(
      null, // batchSize - será ignorado e substituído por 9990
      checkInterval,
      checkCancellation,
      updateProgress
    );
    
    if (result) {
      logger.info('=== PHASE 2 TEST COMPLETED SUCCESSFULLY ===');
    } else {
      logger.warn('=== PHASE 2 TEST COMPLETED WITH ERRORS ===');
    }
  } catch (error) {
    logger.error(`Test failed with error: ${error.message}`, { error });
  }
}

// Executar o teste
runTest()
  .then(() => {
    logger.info('Test script execution completed');
  })
  .catch(error => {
    logger.error(`Unhandled error in test script: ${error.message}`, { error });
  }); 