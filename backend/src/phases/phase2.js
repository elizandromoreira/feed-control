/**
 * Phase 2: Envio de Dados para Amazon
 * 
 * Este módulo implementa a Fase 2 do processo de sincronização,
 * que consiste em enviar os dados atualizados dos produtos para a Amazon Seller API.
 * 
 * Equivalente às funções da Phase 2 do script Python original.
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const DatabaseService = require('../services/database');
const AmazonApiService = require('../services/amazonApi');
const feedService = require('../services/feedService');
const { DB_CONFIG } = require('../config/db');
const logger = require('../config/logging')();
const { validate } = require('jsonschema');
const axios = require('axios');
const zlib = require('zlib');
const util = require('util');
// Usar nossa implementação simples de fila em vez de p-queue
const SimpleQueue = require('../utils/simple-queue');

// Promisificar funções do zlib
const gunzipPromise = util.promisify(zlib.gunzip);

// Diretório para salvar feeds localmente
const FEEDS_DIR = path.join(process.cwd(), 'feeds');

/**
 * Extrai os dados atualizados do banco de dados
 * @param {string} currentProviderId - ID do provedor atual (ex: 'homedepot', 'vitacost', 'whitecap')
 * @param {number} updateFlagValue - Valor do flag de atualização para o provedor atual
 * @returns {Promise<Array<Object>>} - Lista de produtos atualizados
 */
async function extractUpdatedData(currentProviderId, updateFlagValue) {
  let dbService = null;
  
  try {
    dbService = new DatabaseService(DB_CONFIG);
    const initialized = await dbService.init();
    
    if (!initialized) {
      logger.error('Failed to initialize database connection for extracting updated data');
      return [];
    }
    
    let providerName = 'Home Depot'; // Valor padrão
    
    // Determinar o nome do provedor com base no ID
    if (currentProviderId === 'vitacost') {
      providerName = 'Vitacost';
    } else if (currentProviderId === 'whitecap') {
      providerName = 'White Cap';
    } else if (currentProviderId === 'bestbuy') {
      providerName = 'Best Buy';
    } else if (currentProviderId === 'webstaurantstore') {
      providerName = 'Webstaurantstore';
    }
    
    // Usar o updateFlagValue passado como parâmetro
    const query = `
      SELECT 
        sku2, handling_time_amz, quantity 
      FROM produtos 
      WHERE atualizado = ${updateFlagValue} AND source = '${providerName}'
    `;
    
    const result = await dbService.fetchRowsWithRetry(query);
    
    logger.info(`Extracted ${result.length} updated products from database for ${providerName}`);
    return result;
  } catch (error) {
    logger.error(`Error extracting updated data: ${error.message}`, { error });
    return [];
  } finally {
    if (dbService) {
      try {
        await dbService.close();
      } catch (closeError) {
        logger.warn(`Error closing database connection: ${closeError.message}`);
      }
    }
  }
}

/**
 * Cria um feed de inventário para a Amazon
 * @param {Array<Object>} dataSubset - Subset de dados para incluir no feed
 * @returns {Object} - Feed de inventário no formato SP-API v2.0
 */
function createInventoryFeed(dataSubset) {
  // Estrutura do feed no formato oficial SP-API v2.0 para JSON_LISTINGS_FEED
  const feed = {
    header: {
      sellerId: "SELLER_ID_PLACEHOLDER", // Será substituído ao enviar
      version: "2.0",
      issueLocale: "en_US"
    },
    messages: []
  };
  
  // Adicionar cada produto como uma mensagem no feed (formato SP-API v2.0 para JSON_LISTINGS_FEED)
  dataSubset.forEach((product, index) => {
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
 * Valida um feed JSON contra o schema oficial
 * @param {Object} feedJson - Feed JSON a ser validado
 * @returns {boolean} - true se o feed for válido, false caso contrário
 */
function validateFeedJson(feedJson) {
  try {
    // Verificar se o schema existe
    const schemaPath = path.join(__dirname, '../../schemas', 'listings-feed-schema-v2.json');
    
    if (!fs.existsSync(schemaPath)) {
      logger.error(`Schema file not found: ${schemaPath}`);
      return false;
    }
    
    // Carregar o schema
    let schema;
    try {
      schema = require(schemaPath);
    } catch (schemaError) {
      logger.error(`Error loading schema: ${schemaError.message}`);
      logger.error(`Schema path: ${schemaPath}`);
      return false;
    }
    
    // Validar o feed
    try {
      const result = validate(feedJson, schema);
      
      if (result.valid) {
        logger.info('Feed JSON validated successfully against schema');
        return true;
      } else {
        const errors = result.errors.map(err => err.stack).join('; ');
        logger.error(`Feed JSON validation failed: ${errors}`);
        // Log do feed para depuração
        logger.debug(`Feed JSON: ${JSON.stringify(feedJson, null, 2)}`);
        return false;
      }
    } catch (validationError) {
      logger.error(`Error during validation: ${validationError.message}`);
      return false;
    }
  } catch (error) {
    logger.error(`Error validating feed JSON: ${error.message}`, { error });
    return false;
  }
}

/**
 * Salva o feed localmente
 * @param {Object} feedData - Dados do feed
 * @returns {Promise<string>} - Caminho do arquivo salvo
 */
async function saveFeedLocally(feedData) {
  try {
    // Garantir que o diretório existe
    await fsPromises.mkdir(FEEDS_DIR, { recursive: true });
    
    // Gerar nome de arquivo com timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(FEEDS_DIR, `inventory_feed_${timestamp}.json`);
    
    // Salvar o feed
    await fsPromises.writeFile(filePath, JSON.stringify(feedData, null, 2));
    
    logger.info(`Feed saved locally: ${filePath}`);
    return filePath;
  } catch (error) {
    logger.error(`Error saving feed locally: ${error.message}`, { error });
    throw error;
  }
}

/**
 * Reseta a marcação de produtos atualizados no banco de dados
 * @param {string} currentProviderId - ID do provedor atual
 * @param {number} updateFlagValue - Valor do flag de atualização para o provedor atual
 * @returns {Promise<number>} - Número de produtos resetados
 */
async function resetUpdatedProductsMark(currentProviderId, updateFlagValue) {
  let dbService = null;
  
  try {
    dbService = new DatabaseService(DB_CONFIG);
    const initialized = await dbService.init();
    
    if (!initialized) {
      logger.error('Failed to initialize database connection for resetting updated products mark');
      return 0;
    }
    
    let providerName = 'Home Depot'; // Valor padrão
    
    // Determinar o nome do provedor com base no ID
    if (currentProviderId === 'vitacost') {
      providerName = 'Vitacost';
    } else if (currentProviderId === 'whitecap') {
      providerName = 'White Cap';
    } else if (currentProviderId === 'bestbuy') {
      providerName = 'Best Buy';
    } else if (currentProviderId === 'webstaurantstore') {
      providerName = 'Webstaurantstore';
    }
    
    // Usar o updateFlagValue passado como parâmetro
    const query = `
      UPDATE produtos 
      SET atualizado = 0 
      WHERE atualizado = ${updateFlagValue} AND source = '${providerName}'
    `;
    
    const result = await dbService.executeWithRetry(query);
    
    logger.info(`Reset updated flag for ${result.rowCount} products for ${providerName}`);
    return result.rowCount;
  } catch (error) {
    logger.error(`Error resetting updated products mark: ${error.message}`, { error });
    return 0;
  } finally {
    if (dbService) {
      try {
        await dbService.close();
      } catch (closeError) {
        logger.warn(`Error closing database connection: ${closeError.message}`);
      }
    }
  }
}

/**
 * Verifica o status de um feed
 * @param {string} feedId - ID do feed
 * @param {string} accessToken - Token de acesso
 * @param {AmazonApiService} amazonApi - Instância do serviço da Amazon API
 * @returns {Promise<Object>} - Status do feed
 */
async function checkFeedStatus(feedId, accessToken, amazonApi) {
  try {
    // Verificar status do feed
    const feedStatus = await amazonApi.checkFeedStatus(feedId, accessToken);
    return feedStatus;
  } catch (error) {
    logger.error(`Error checking feed status: ${error.message}`, { error });
    return null;
  }
}

/**
 * Obtém informações sobre um documento de feed
 * @param {string} documentId - ID do documento
 * @param {string} accessToken - Token de acesso
 * @param {AmazonApiService} amazonApi - Instância do serviço da Amazon API
 * @returns {Promise<Object>} - Informações do documento
 */
async function getFeedDocument(documentId, accessToken, amazonApi) {
  try {
    // Obter documento do feed
    const document = await amazonApi.getFeedDocument(documentId, accessToken);
    return document;
  } catch (error) {
    logger.error(`Error getting feed document: ${error.message}`, { error });
    return null;
  }
}

/**
 * Função auxiliar para retry de requisições
 * @param {number} maxRetries - Número máximo de tentativas
 * @param {number} delay - Atraso entre tentativas em milissegundos
 * @returns {Function} - Função para fazer requisições com retry
 */
const axiosRetry = (maxRetries = 3, delay = 1000) => {
  return async (url, config) => {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await axios(url, config);
      } catch (error) {
        lastError = error;
        if (error.response && error.response.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after'] || delay);
          logger.warn(`Taxa limite excedida. Tentando novamente em ${retryAfter} segundos.`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        } else if (i < maxRetries - 1) {
          logger.warn(`Erro na requisição (tentativa ${i+1}/${maxRetries}): ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }
    throw lastError;
  };
};

const requestWithRetry = axiosRetry();

/**
 * Baixa o conteúdo de um documento a partir da URL
 * @param {string} url - URL do documento
 * @param {AmazonApiService} amazonApi - Instância do serviço da Amazon API
 * @returns {Promise<string|Buffer>} - Conteúdo do documento
 */
async function downloadDocument(url, amazonApi) {
  try {
    // Usar axios com retry para fazer o download
    const response = await requestWithRetry(url, {
      responseType: 'arraybuffer',
      headers: {
        'Accept-Encoding': 'gzip,deflate'
      }
    });
    
    logger.info(`Downloaded document from URL, size: ${response.data.length} bytes`);
    return response.data;
  } catch (error) {
    logger.error(`Error downloading document: ${error.message}`);
    if (error.response) {
      logger.error(`Response status: ${error.response.status}`);
      logger.error(`Response headers: ${JSON.stringify(error.response.headers)}`);
    }
    return null;
  }
}

/**
 * Processa e baixa os resultados do feed
 * @param {string} feedId - ID do feed
 * @param {Object} feedDocument - Documento do feed
 * @param {string} accessToken - Token de acesso
 * @param {AmazonApiService} amazonApi - Instância do serviço da Amazon API
 * @returns {Promise<boolean>} - Status do processamento
 */
async function processAndDownloadFeedResults(feedId, feedDocument, accessToken, amazonApi) {
  try {
    // Verificar o status do feed
    const feedStatus = await checkFeedStatus(feedId, accessToken, amazonApi);
    
    if (feedStatus && feedStatus.processingStatus === 'DONE' && feedStatus.resultFeedDocumentId) {
      // Baixar os resultados do feed
      logger.info(`Feed document retrieved: ${feedStatus.resultFeedDocumentId}`);
      const resultDocument = await getFeedDocument(feedStatus.resultFeedDocumentId, accessToken, amazonApi);
      
      if (!resultDocument) {
        logger.error('Failed to get result document');
        return { success: false };
      }
      
      // Baixar o conteúdo do documento usando a URL do documento
      const url = resultDocument.url;
      const headers = {
        'Content-Type': 'application/json'
      };
      
      try {
        // Baixar o conteúdo do documento
        const downloadResponse = await requestWithRetry(url, { 
          responseType: 'arraybuffer',
          headers 
        });
        
        if (downloadResponse.status !== 200) {
          logger.error(`Error downloading feed result: ${downloadResponse.status}`);
          return { success: false };
        }
        
        logger.info(`Feed result downloaded successfully, size: ${downloadResponse.data.length} bytes`);
        
        // Processar o conteúdo do documento
        let processedContent;
        const content = downloadResponse.data;
        
        // Tentar descomprimir se for um conteúdo comprimido
        try {
          // Verificar se o conteúdo parece ser gzip (começa com os bytes mágicos 0x1f, 0x8b)
          const isGzip = content.length > 2 && 
                        content[0] === 0x1f && 
                        content[1] === 0x8b;
          
          if (isGzip) {
            logger.info('Content appears to be gzip compressed, decompressing...');
            const decompressed = await gunzipPromise(content);
            processedContent = decompressed.toString('utf-8');
            logger.info(`Successfully decompressed content to ${processedContent.length} bytes`);
          } else {
            logger.info('Content does not appear to be gzip compressed');
            processedContent = content.toString('utf-8');
          }
        } catch (decompressionError) {
          logger.error(`Error decompressing content: ${decompressionError.message}`);
          // Tentar usar o conteúdo original como string
          processedContent = content.toString('utf-8');
          logger.info('Using original content as string');
        }
        
        // Determinar o tipo de conteúdo (XML ou JSON)
        const trimmedContent = processedContent.trim();
        let isXml = false;
        let isJson = false;
        let parsedContent = null;
        let reportJson = null;
        
        // Tentar analisar como JSON primeiro
        if (trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) {
          try {
            parsedContent = JSON.parse(processedContent);
            reportJson = parsedContent; // Salvar o relatório JSON completo
            isJson = true;
            logger.info('Feed result is in JSON format');
            
            // Formatar e exibir o relatório completo
            logger.info('Conteúdo do relatório (JSON):');
            logger.info(JSON.stringify(parsedContent, null, 2));
            
            // Extrair e mostrar informações importantes
            if (parsedContent.header) {
              // Log condensado do header
              logger.info(`Feed ${parsedContent.header.feedId || feedId} - Status: ${parsedContent.header.status || 'N/A'}`);
            }
            
            // Mostrar resumo de mensagens processadas, aceitas e erros
            if (parsedContent.summary) {
              const summary = parsedContent.summary;
              
              // Log condensado do resumo
              logger.info(`Feed Summary: Processed ${summary.messagesProcessed || 0} | Accepted ${summary.messagesAccepted || 0} | Invalid ${summary.messagesInvalid || 0} | Errors ${summary.errors || 0} | Warnings ${summary.warnings || 0}`);
              
              // Indicar claramente o resultado do processamento
              if (summary.messagesAccepted > 0) {
                logger.info(`✓ SUCCESS: Amazon accepted ${summary.messagesAccepted} of ${summary.messagesProcessed} products`);
              } else {
                logger.error(`✗ FAILURE: Amazon did not accept any products. Check errors above.`);
              }
            }
            
            // Verificar erros ou avisos
            if (parsedContent.issues && parsedContent.issues.length > 0) {
              logger.error(`Found ${parsedContent.issues.length} issues in feed result`);
              parsedContent.issues.forEach((issue, index) => {
                logger.error(`Issue ${index + 1}: ${JSON.stringify(issue)}`);
              });
            } else if (parsedContent.errors && parsedContent.errors.length > 0) {
              logger.error(`Found ${parsedContent.errors.length} errors in feed result`);
              parsedContent.errors.forEach((error, index) => {
                logger.error(`Error ${index + 1}: ${JSON.stringify(error)}`);
              });
            } else {
              logger.info('No errors or issues found in feed result');
            }
          } catch (jsonError) {
            logger.error(`Error parsing JSON: ${jsonError.message}`);
          }
        }
        
        // Se não for JSON, verificar se é XML
        if (!isJson && (trimmedContent.startsWith('<?xml') || trimmedContent.startsWith('<'))) {
          isXml = true;
          logger.info('Feed result is in XML format');
          
          // Extrair informações básicas do XML (análise simples)
          try {
            // Extrair informações importantes usando expressões regulares
            const processingReportRegex = /<ProcessingReport>(.*?)<\/ProcessingReport>/s;
            const processingReportMatch = trimmedContent.match(processingReportRegex);
            
            const summaryRegex = /<ProcessingSummary>(.*?)<\/ProcessingSummary>/s;
            const summaryMatch = processingReportMatch ? processingReportMatch[1].match(summaryRegex) : null;
            
            const messagesProcessedRegex = /<MessagesProcessed>(.*?)<\/MessagesProcessed>/;
            const messagesAcceptedRegex = /<MessagesSuccessful>(.*?)<\/MessagesSuccessful>/;
            const messagesWithErrorRegex = /<MessagesWithError>(.*?)<\/MessagesWithError>/;
            const messagesWithWarningRegex = /<MessagesWithWarning>(.*?)<\/MessagesWithWarning>/;
            
            let messagesProcessed = 0;
            let messagesAccepted = 0;
            let messagesWithError = 0;
            let messagesWithWarning = 0;
            
            if (summaryMatch) {
              const summaryContent = summaryMatch[1];
              const processedMatch = summaryContent.match(messagesProcessedRegex);
              const acceptedMatch = summaryContent.match(messagesAcceptedRegex);
              const errorMatch = summaryContent.match(messagesWithErrorRegex);
              const warningMatch = summaryContent.match(messagesWithWarningRegex);
              
              messagesProcessed = processedMatch ? parseInt(processedMatch[1], 10) : 0;
              messagesAccepted = acceptedMatch ? parseInt(acceptedMatch[1], 10) : 0;
              messagesWithError = errorMatch ? parseInt(errorMatch[1], 10) : 0;
              messagesWithWarning = warningMatch ? parseInt(warningMatch[1], 10) : 0;
            }
            
            // Exibir resumo do processamento
            logger.info('----- Feed Processing Summary (XML) -----');
            logger.info(`Messages Processed: ${messagesProcessed}`);
            logger.info(`Messages Accepted: ${messagesAccepted}`);
            logger.info(`Messages With Error: ${messagesWithError}`);
            logger.info(`Messages With Warning: ${messagesWithWarning}`);
            logger.info('---------------------------------');
            
            // Indicar claramente o resultado do processamento
            if (messagesAccepted > 0) {
              logger.info(`✓ SUCCESS: Amazon accepted ${messagesAccepted} of ${messagesProcessed} products!`);
            } else {
              logger.error(`✗ FAILURE: Amazon did not accept any products. Check errors above.`);
            }
            
            // Extrair erros específicos se houver
            const resultRegex = /<Result>(.*?)<\/Result>/gs;
            let resultMatch;
            let errorCount = 0;
            
            while ((resultMatch = resultRegex.exec(trimmedContent)) !== null) {
              const resultContent = resultMatch[1];
              const resultCodeRegex = /<ResultCode>(.*?)<\/ResultCode>/;
              const resultCodeMatch = resultContent.match(resultCodeRegex);
              
              if (resultCodeMatch && resultCodeMatch[1] === 'Error') {
                errorCount++;
                const resultMessageRegex = /<ResultMessageCode>(.*?)<\/ResultMessageCode>/;
                const resultDescriptionRegex = /<ResultDescription>(.*?)<\/ResultDescription>/;
                
                const messageCodeMatch = resultContent.match(resultMessageRegex);
                const descriptionMatch = resultContent.match(resultDescriptionRegex);
                
                if (messageCodeMatch && descriptionMatch) {
                  logger.error(`Error ${errorCount}: ${messageCodeMatch[1]} - ${descriptionMatch[1]}`);
                }
              }
            }
            
            if (errorCount === 0) {
              logger.info('No specific errors found in XML response');
            }
          } catch (xmlParseError) {
            logger.error(`Error parsing XML content: ${xmlParseError.message}`);
            logger.debug(`XML content: ${trimmedContent.substring(0, 500)}...`);
          }
        }
        
        // Se não for nem JSON nem XML
        if (!isJson && !isXml) {
          logger.info('Feed result does not appear to be JSON or XML format');
          logger.info(`Content starts with: ${trimmedContent.substring(0, 50)}...`);
        }
        
        // Salvar os resultados localmente para análise
        const feedResultPath = path.join(process.cwd(), 'feeds', `result_${feedId}.json`);
        await fsPromises.writeFile(feedResultPath, processedContent);
        logger.info(`Feed result saved to ${feedResultPath}`);
        
        // Registrar uma mensagem clara sobre o sucesso ou falha do processamento
        if (isJson && parsedContent) {
          const hasErrors = parsedContent.errors && parsedContent.errors.length > 0;
          
          if (hasErrors) {
            logger.error('Feed processing completed with errors - products may not have been updated correctly');
          } else {
            logger.info('Feed processing completed successfully - products have been updated');
          }
        } else if (isXml) {
          // Para XML, já exibimos o resumo acima
          logger.info('Feed processing completed - check the summary above for details');
        } else {
          // Se não conseguimos analisar como JSON ou XML, é mais difícil determinar o sucesso
          logger.info('Feed processing completed, but unable to determine success status');
        }
        
        return { 
          success: true,
          reportJson: reportJson // Retornar o relatório JSON para uso posterior
        };
      } catch (downloadError) {
        logger.error(`Error downloading or processing feed result: ${downloadError.message}`);
        if (downloadError.response) {
          logger.error(`Status: ${downloadError.response.status}, Data: ${JSON.stringify(downloadError.response.data)}`);
        }
        return { success: false };
      }
    } else {
      logger.error(`Feed processing failed or not completed yet: ${feedStatus ? feedStatus.processingStatus : 'unknown status'}`);
      return { success: false };
    }
  } catch (error) {
    logger.error(`Error processing feed results: ${error.message}`, { error });
    return { success: false };
  }
}

/**
 * Função principal da Phase 2
 * @param {number} batchSize - Tamanho do lote
 * @param {number} checkInterval - Intervalo para verificar status do feed
 * @param {Function} checkCancellation - Função para verificar cancelamento
 * @param {Function} updateProgress - Função para atualizar progresso
 * @returns {Promise<boolean>} - true se sucesso, false se falha
 */
async function mainPhase2(batchSize, checkInterval, checkCancellation, updateProgress) {
  // Obter o provedor atual a partir da variável de ambiente
  const currentProviderId = process.env.CURRENT_PROVIDER_ID || 'homedepot';
  
  // Obter o updateFlagValue apropriado para o provedor atual
  let updateFlagValue = 1; // Padrão para Home Depot
  
  if (currentProviderId === 'vitacost') {
    updateFlagValue = parseInt(process.env.VITACOST_UPDATE_FLAG_VALUE || '2', 10);
  } else if (currentProviderId === 'whitecap') {
    updateFlagValue = parseInt(process.env.WHITECAP_UPDATE_FLAG_VALUE || '3', 10);
  } else if (currentProviderId === 'bestbuy') {
    updateFlagValue = parseInt(process.env.BESTBUY_UPDATE_FLAG_VALUE || '4', 10);
  } else if (currentProviderId === 'webstaurantstore') {
    updateFlagValue = parseInt(process.env.WEBSTAURANTSTORE_UPDATE_FLAG_VALUE || '5', 10);
  } else {
    updateFlagValue = parseInt(process.env.HOMEDEPOT_UPDATE_FLAG_VALUE || '1', 10);
  }
  
  logger.info(`Running Phase 2 for provider: ${currentProviderId} with updateFlagValue: ${updateFlagValue}`);
  
  const processTitle = `phase2_${currentProviderId}`;
  process.title = processTitle;
  
  // Inicialização do serviço de banco de dados
  let dbService = null;
  
  // Obter a instância da API da Amazon
  const amazonApi = new AmazonApiService();
  
  // Carregar credenciais da Amazon do banco de dados
  try {
    // Inicializar o serviço de banco de dados com verificação adequada
    dbService = new DatabaseService(DB_CONFIG);
    const dbInitialized = await dbService.init();
    
    if (!dbInitialized) {
      throw new Error('Não foi possível inicializar a conexão com o banco de dados');
    }
    
    // Obter credenciais da Amazon
    amazonApi.credentials = await AmazonApiService.getAmazonCredentials();
    
    if (!amazonApi.credentials || !amazonApi.credentials.seller_id) {
      throw new Error('Credenciais da Amazon não encontradas ou seller_id não definido');
    }
    
    logger.info(`Credenciais da Amazon carregadas com sucesso para o seller_id: ${amazonApi.credentials.seller_id}`);
    
    // Obter token de acesso
    amazonApi.accessToken = await amazonApi.getAccessToken();
    if (!amazonApi.accessToken) {
      throw new Error('Não foi possível obter o token de acesso da Amazon');
    }
    
    logger.info('Token de acesso da Amazon obtido com sucesso');
  } catch (error) {
    logger.error(`Erro ao inicializar API da Amazon: ${error.message}`);
    
    // Fechar conexão com o banco de dados se existir
    if (dbService) {
      try {
        await dbService.close();
      } catch (closeError) {
        logger.warn(`Erro ao fechar conexão com o banco de dados: ${closeError.message}`);
      }
    }
    
    throw new Error(`Falha ao inicializar API da Amazon: ${error.message}`);
  }
  
  // Configurar verificação de progresso
  let progressInfo = {
    totalProducts: 0,
    processedProducts: 0,
    successCount: 0,
    failCount: 0,
    percentage: 0,
    isRunning: true,
    phase: 2,
    currentBatch: 0,
    totalBatches: 0,
    errors: []
  };
  
  try {
    // Extrair dados atualizados
    const updatedData = await extractUpdatedData(currentProviderId, updateFlagValue);
    
    if (updatedData.length === 0) {
      logger.info('No updated products found. Phase 2 complete.');
      
      // Atualizar progresso
      if (updateProgress) {
        updateProgress({
          ...progressInfo,
          phase2Complete: true,
          allBatchesSuccessful: true,
          totalProductsProcessed: 0
        });
      }
      
      return true;
    }
    
    // Atualizar total de produtos no progresso
    progressInfo.totalProducts = updatedData.length;
    if (updateProgress) {
      updateProgress(progressInfo);
    }
    
    // Verificar o tamanho máximo permitido para feeds (Amazon tem limite de 20.000)
    // Mas por segurança, usaremos 9.990 para garantir que não exceda limites
    let maxBatchSize = 9990;
    
    // Se o batchSize for diferente, usar o valor fixo de 9990
    if (batchSize !== maxBatchSize) {
      logger.info(`Adjusting batch size from ${batchSize} to fixed value of ${maxBatchSize} for Amazon compatibility`);
      batchSize = maxBatchSize;
    }
    
    // Dividir produtos em lotes
    const batches = [];
    for (let i = 0; i < updatedData.length; i += batchSize) {
      batches.push(updatedData.slice(i, i + batchSize));
    }
    
    // Atualizar progresso com número total de lotes
    progressInfo.totalBatches = batches.length;
    if (updateProgress) {
      updateProgress(progressInfo);
    }
    
    logger.info(`Processing ${updatedData.length} products in ${batches.length} batches`);
    
    // Variáveis para rastrear estado geral
    let allBatchesSuccessful = true;
    let totalProcessed = 0;
    const totalProducts = updatedData.length;
    
    // Usar fila para limitar processamento paralelo
    const queue = new SimpleQueue({ concurrency: 1 });
    
    // Processar cada lote
    for (let i = 0; i < batches.length; i++) {
      // Verificar cancelamento
      if (checkCancellation && checkCancellation()) {
        logger.info('Phase 2 cancelled by user');
        break;
      }
      
      const batch = batches[i];
      
      // Enfileirar o processamento deste lote
      queue.add(async () => {
        try {
          // Atualizar progresso para este lote
          if (updateProgress) {
            updateProgress({
              ...progressInfo,
              currentBatch: i + 1,
              totalBatches: batches.length,
              batchStatus: 'processing'
            });
          }
          
          // Criar feed de inventário
          const feed = createInventoryFeed(batch);
          
          // Substituir placeholders com valores reais
          feed.header.sellerId = amazonApi.credentials.seller_id;
          
          // Validar feed
          const isValid = validateFeedJson(feed);
          
          if (!isValid) {
            logger.error("Feed validation failed, skipping batch");
            allBatchesSuccessful = false;
            
            // Atualizar progresso com erro de validação
            if (updateProgress) {
              updateProgress({
                ...progressInfo,
                currentBatch: i + 1,
                totalBatches: batches.length,
                errors: [...progressInfo.errors, {
                  message: "Feed validation failed",
                  phase: 2,
                  batch: i + 1,
                  timestamp: new Date().toISOString()
                }],
                batchStatus: 'error'
              });
            }
            
            return false;
          }
          
          // Verificar se a sincronização foi cancelada
          if (checkCancellation && checkCancellation()) {
            logger.info(`Synchronization cancelled after validating feed for batch ${i + 1}`);
            return false;
          }
          
          // Salvar feed localmente
          const feedPath = await saveFeedLocally(feed);
          
          // Salvar feed JSON na tabela amazon_feeds
          try {
            await feedService.saveFeed(
              feed,                    // feedData - JSON do feed
              'inventory',             // feedType - tipo do feed
              null,                    // feedId - será preenchido após envio para Amazon
              'amazon',                // storeId - identificador da loja
              feedPath                 // filePath - caminho do arquivo local
            );
            logger.info(`Feed JSON saved to database for batch ${i + 1}`);
          } catch (saveError) {
            logger.error(`Error saving feed to database for batch ${i + 1}: ${saveError.message}`);
            // Continuar mesmo com erro de salvamento, pois o feed ainda será enviado
          }
          
          // Atualizar progresso
          if (updateProgress) {
            updateProgress({
              ...progressInfo,
              currentBatch: i + 1,
              totalBatches: batches.length,
              batchStatus: 'uploading',
              feedPath
            });
          }
          
          // Criar documento de feed
          const feedDocument = await amazonApi.createFeedDocument(amazonApi.accessToken);
          
          // Fazer upload do feed
          await amazonApi.uploadFeedToS3(JSON.stringify(feed), feedDocument.url);
          
          // Verificar se a sincronização foi cancelada
          if (checkCancellation && checkCancellation()) {
            logger.info(`Synchronization cancelled after uploading feed for batch ${i + 1}`);
            return false;
          }
          
          // Atualizar progresso
          if (updateProgress) {
            updateProgress({
              ...progressInfo,
              currentBatch: i + 1,
              totalBatches: batches.length,
              batchStatus: 'submitted'
            });
          }
          
          // Enviar feed
          const feedId = await amazonApi.submitFeed(
            feedDocument.feedDocumentId,
            amazonApi.accessToken,
            amazonApi.credentials.marketplace_id
          );
          
          // Atualizar o registro na tabela amazon_feeds com o feedId da Amazon
          try {
            // Como não temos o ID do registro criado anteriormente, vamos buscar o mais recente
            // e atualizar com o feedId da Amazon
            const result = await feedService.updateLatestFeedWithId(feedId, 'amazon');
            if (result) {
              logger.info(`Feed record updated with Amazon feedId: ${feedId}`);
            }
          } catch (updateError) {
            logger.error(`Error updating feed record with feedId: ${updateError.message}`);
          }
          
          // Verificar status do feed a cada 30 segundos até que seja DONE
          logger.info(`Feed submitted: ${feedId}`);
          logger.info(`Waiting for feed processing. Will check status every ${checkInterval/1000} seconds...`);
          
          // Atualizar progresso
          if (updateProgress) {
            updateProgress({
              ...progressInfo,
              currentBatch: i + 1,
              totalBatches: batches.length,
              batchStatus: 'waiting',
              feedId
            });
          }
          
          let feedProcessed = false;
          let feedStatus = null;
          let waitCount = 0;
          let lastFeedStatus = null;
          
          while (!feedProcessed) {
            // Verificar se a sincronização foi cancelada
            if (checkCancellation && checkCancellation()) {
              logger.info(`Synchronization cancelled while waiting for feed ${feedId} to be processed`);
              return false;
            }
            
            // Aguardar 30 segundos antes de verificar o status
            
            // Atualizar progresso com informações de espera
            if (updateProgress) {
              updateProgress({
                ...progressInfo,
                currentBatch: i + 1,
                totalBatches: batches.length,
                batchStatus: 'waiting',
                waitTime: waitCount * checkInterval / 1000
              });
            }
            
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            waitCount++;
            
            // Verificar novamente se a sincronização foi cancelada após o tempo de espera
            if (checkCancellation && checkCancellation()) {
              logger.info(`Synchronization cancelled after waiting for feed ${feedId} status check`);
              return false;
            }
            
            // Verificar status
            feedStatus = await checkFeedStatus(feedId, amazonApi.accessToken, amazonApi);
            
            // Registrar o status para debugging
            logger.debug(`Status completo do feed: ${JSON.stringify(feedStatus)}`);
            
            // Atualizar progresso com status do feed
            if (updateProgress) {
              updateProgress({
                ...progressInfo,
                currentBatch: i + 1,
                totalBatches: batches.length,
                batchStatus: feedStatus ? feedStatus.processingStatus : 'unknown',
                feedStatus
              });
            }
            
            // Verificar se feedStatus é um objeto e tem a propriedade processingStatus
            if (feedStatus && typeof feedStatus === 'object' && feedStatus.processingStatus) {
              // Só loga mudanças de status ou a cada 5 tentativas
              const statusChanged = feedStatus.processingStatus !== lastFeedStatus;
              const shouldLogStatus = statusChanged || waitCount === 1 || waitCount % 5 === 0;
              
              if (shouldLogStatus) {
                logger.info(`Feed ${feedId} status: ${feedStatus.processingStatus} (check ${waitCount})`);
                lastFeedStatus = feedStatus.processingStatus;
              }
              
              if (feedStatus.processingStatus === 'DONE') {
                feedProcessed = true;
                logger.info(`Feed ${feedId} completed successfully`);
                
                // Atualizar progresso
                if (updateProgress) {
                  updateProgress({
                    ...progressInfo,
                    currentBatch: i + 1,
                    totalBatches: batches.length,
                    batchStatus: 'complete'
                  });
                }
                
                // Processar resultados imediatamente após DONE
                logger.info(`Processing results for feed ${feedId}...`);
                
                // Atualizar progresso
                if (updateProgress) {
                  updateProgress({
                    ...progressInfo,
                    currentBatch: i + 1,
                    totalBatches: batches.length,
                    batchStatus: 'processing_results'
                  });
                }
                
                // Baixar e processar resultados
                logger.info(`Checking results for feed ${feedId}...`);
                const resultsProcessed = await processAndDownloadFeedResults(feedId, feedDocument, amazonApi.accessToken, amazonApi);
                
                if (!resultsProcessed.success) {
                  logger.error(`Failed to process results for feed ${feedId}`);
                  allBatchesSuccessful = false;
                  totalProcessed += batch.length;
                  
                  // Atualizar progresso para esta batch
                  if (updateProgress) {
                    updateProgress({
                      ...progressInfo,
                      processedProducts: totalProcessed,
                      percentage: Math.round((totalProcessed / totalProducts) * 100),
                      currentBatch: i + 1,
                      totalBatches: batches.length,
                      batchStatus: 'error'
                    });
                  }
                } else {
                  // Salvar resultados do processamento na tabela amazon_feeds se disponível
                  if (resultsProcessed.success && resultsProcessed.reportJson) {
                    try {
                      await feedService.saveFeed(
                        resultsProcessed.reportJson,  // feedData - JSON do resultado
                        'result',                     // feedType - tipo resultado
                        feedId,                      // feedId - mesmo ID do feed original
                        'amazon',                    // storeId - identificador da loja
                        null                         // filePath - não há arquivo local para resultados
                      );
                      logger.info(`Feed results saved to database for feedId: ${feedId}`);
                    } catch (saveError) {
                      logger.error(`Error saving feed results to database: ${saveError.message}`);
                    }
                  }
                  
                  // Batch processada com sucesso
                  totalProcessed += batch.length;
                  
                  // Incluir o relatório JSON nos updates de progresso se disponível
                  if (updateProgress) {
                    updateProgress({
                      ...progressInfo,
                      processedProducts: totalProcessed,
                      percentage: Math.round((totalProcessed / totalProducts) * 100),
                      currentBatch: i + 1,
                      totalBatches: batches.length,
                      batchStatus: 'success',
                      // Adicionar relatório JSON se estiver disponível
                      reportJson: resultsProcessed.reportJson || null
                    });
                  }
                }
                
              } else if (feedStatus.processingStatus === 'CANCELLED' || feedStatus.processingStatus === 'FATAL') {
                logger.error(`Feed ${feedId} processing failed with status ${feedStatus.processingStatus}`);
                feedProcessed = true;
                allBatchesSuccessful = false;
                
                // Atualizar progresso com erro
                if (updateProgress) {
                  updateProgress({
                    ...progressInfo,
                    currentBatch: i + 1,
                    totalBatches: batches.length,
                    batchStatus: 'error',
                    errors: [...progressInfo.errors, {
                      message: `Feed processing failed with status ${feedStatus.processingStatus}`,
                      phase: 2,
                      batch: i + 1,
                      feedId,
                      timestamp: new Date().toISOString()
                    }]
                  });
                }
              } else {
                logger.info(`Feed ${feedId} is still processing, status: ${feedStatus.processingStatus}`);
              }
            } else {
              logger.warn(`Received invalid feed status format: ${JSON.stringify(feedStatus)}`);
            }
          }
          
          return false;
        } catch (error) {
          logger.error(`Error processing batch ${i + 1}: ${error.message}`);
          allBatchesSuccessful = false;
          
          // Atualizar progresso com erro
          if (updateProgress) {
            updateProgress({
              ...progressInfo,
              currentBatch: i + 1,
              totalBatches: batches.length,
              batchStatus: 'error',
              errors: [...progressInfo.errors, {
                message: error.message,
                phase: 2,
                batch: i + 1,
                timestamp: new Date().toISOString()
              }]
            });
          }
          
          return false;
        }
      });
    }
    
    // Aguardar a conclusão de todas as tarefas enfileiradas
    await queue.onIdle();
    
    // Resetar marcação de produtos atualizados
    await resetUpdatedProductsMark(currentProviderId, updateFlagValue);
    
    // Atualizar progresso com conclusão
    if (updateProgress) {
      updateProgress({
        ...progressInfo,
        phase2Complete: true,
        allBatchesSuccessful,
        totalProductsProcessed: totalProcessed
      });
    }
    
    if (allBatchesSuccessful) {
      logger.info("Phase 2 completed successfully");
      return true;
    } else {
      logger.warn("Phase 2 completed with some errors");
      return false;
    }
  } catch (error) {
    logger.error(`Error in Phase 2: ${error.message}`, { error });
    
    // Atualizar progresso com erro
    if (updateProgress) {
      updateProgress({
        ...progressInfo,
        error: error.message,
        errors: [...progressInfo.errors, {
          message: error.message,
          phase: 2,
          timestamp: new Date().toISOString()
        }]
      });
    }
    
    return false;
  } finally {
    // Garantir que a conexão com o banco de dados seja fechada
    if (dbService) {
      try {
        await dbService.close();
        logger.info('Database connection closed after Phase 2');
      } catch (closeError) {
        logger.warn(`Error closing database connection after Phase 2: ${closeError.message}`);
      }
    } else {
      logger.info('Database service was not initialized in Phase 2');
    }
  }
}

module.exports = {
  mainPhase2,
  extractUpdatedData,
  createInventoryFeed,
  validateFeedJson,
  saveFeedLocally,
  resetUpdatedProductsMark,
  processAndDownloadFeedResults,
  checkFeedStatus,
  getFeedDocument,
  downloadDocument
};
