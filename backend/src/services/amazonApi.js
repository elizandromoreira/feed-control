/**
 * Serviço de API da Amazon
 * 
 * Este módulo fornece funções para comunicação com a Amazon Seller API.
 * Equivalente às funções de API da Amazon do script Python original.
 */

const axios = require('axios');
const FormData = require('form-data');
const { promisify } = require('util');
const zlib = require('zlib');
const { configureAxiosRetry } = require('../utils/retry');
const logger = require('../config/logging')();
const DatabaseService = require('./database');
const { DB_CONFIG } = require('../config/db');

// Promisificar funções do zlib
const gzipPromise = promisify(zlib.gzip);
const gunzipPromise = promisify(zlib.gunzip);

/**
 * Classe para gerenciar comunicação com a Amazon Seller API
 */
class AmazonApiService {
  /**
   * @param {Object} credentials - Credenciais da Amazon
   * @param {string} credentials.client_id - Client ID
   * @param {string} credentials.client_secret - Client Secret
   * @param {string} credentials.refresh_token - Refresh Token
   * @param {string} credentials.seller_id - Seller ID
   * @param {string} credentials.marketplace_id - Marketplace ID
   */
  constructor(credentials) {
    this.credentials = credentials;
    this.accessToken = null;
    this.tokenExpiry = 0;
    
    // Criar cliente HTTP com retry
    this.client = axios.create({
      timeout: 30000,
      headers: {
        'User-Agent': 'HomeDepotSync/1.0 (Node.js)',
        'Accept': 'application/json'
      }
    });
    
    // Configurar retry
    configureAxiosRetry(this.client, {
      retries: 3,
      retryDelay: 1000
    });
  }

  /**
   * Obtém um token de acesso para a SP API
   * @returns {Promise<string>} - Token de acesso
   */
  async getAccessToken() {
    // Verificar se o token atual ainda é válido
    const now = Date.now() / 1000;
    if (this.accessToken && this.tokenExpiry > now + 60) {
      return this.accessToken;
    }
    
    try {
      const tokenUrl = 'https://api.amazon.com/auth/o2/token';
      
      const response = await this.client.post(tokenUrl, {
        grant_type: 'refresh_token',
        refresh_token: this.credentials.refresh_token,
        client_id: this.credentials.client_id,
        client_secret: this.credentials.client_secret
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
      
      this.accessToken = response.data.access_token;
      this.tokenExpiry = now + response.data.expires_in;
      
      logger.info('Obtained new Amazon SP API access token');
      return this.accessToken;
    } catch (error) {
      // Verificar se é um erro 429 (Too Many Requests)
      if (error.response && error.response.status === 429) {
        const delaySeconds = 300; // 5 minutos em segundos
        logger.warn(`Taxa limite excedida (429) ao solicitar token. Aguardando ${delaySeconds} segundos antes de tentar novamente.`);
        
        // Aguardar 5 minutos antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        
        // Tentar novamente após a pausa
        return this.getAccessToken();
      }
      
      logger.error(`Error getting access token: ${error.message}`, { error });
      throw new Error(`Failed to get access token: ${error.message}`);
    }
  }

  /**
   * Cria um documento de feed
   * @param {string} accessToken - Token de acesso
   * @returns {Promise<Object>} - Informações do documento de feed
   */
  async createFeedDocument(accessToken) {
    try {
      const url = 'https://sellingpartnerapi-na.amazon.com/feeds/2021-06-30/documents';
      
      const response = await this.client.post(url, {
        contentType: 'application/json'
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        }
      });
      
      logger.info(`Feed document created: ${response.data.feedDocumentId}`);
      return response.data;
    } catch (error) {
      // Verificar se é um erro 429 (Too Many Requests)
      if (error.response && error.response.status === 429) {
        const delaySeconds = 300; // 5 minutos em segundos
        logger.warn(`Taxa limite excedida (429) ao criar documento de feed. Aguardando ${delaySeconds} segundos antes de tentar novamente.`);
        
        // Aguardar 5 minutos antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        
        // Tentar novamente após a pausa
        return this.createFeedDocument(accessToken);
      }
      
      logger.error(`Error creating feed document: ${error.message}`, { error });
      throw new Error(`Failed to create feed document: ${error.message}`);
    }
  }

  /**
   * Faz upload do conteúdo do feed para o S3
   * @param {string|Buffer} feedContent - Conteúdo do feed
   * @param {string} uploadUrl - URL de upload
   * @returns {Promise<boolean>} - true se o upload for bem-sucedido
   */
  async uploadFeedToS3(feedContent, uploadUrl) {
    try {
      // Enviar o conteúdo sem compressão, como no código Python
      const content = typeof feedContent === 'string' ? feedContent : JSON.stringify(feedContent);
      
      // Fazer upload
      await this.client.put(uploadUrl, content, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      logger.info('Feed content uploaded to S3 successfully');
      return true;
    } catch (error) {
      // Verificar se é um erro 429 (Too Many Requests)
      if (error.response && error.response.status === 429) {
        const delaySeconds = 300; // 5 minutos em segundos
        logger.warn(`Taxa limite excedida (429) ao fazer upload para S3. Aguardando ${delaySeconds} segundos antes de tentar novamente.`);
        
        // Aguardar 5 minutos antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        
        // Tentar novamente após a pausa
        return this.uploadFeedToS3(feedContent, uploadUrl);
      }
      
      logger.error(`Error uploading feed to S3: ${error.message}`, { error });
      throw new Error(`Failed to upload feed to S3: ${error.message}`);
    }
  }

  /**
   * Envia um feed para a Amazon
   * @param {string} feedDocumentId - ID do documento de feed
   * @param {string} accessToken - Token de acesso
   * @param {string} marketplaceId - ID do marketplace
   * @returns {Promise<string>} - ID do feed
   */
  async submitFeed(feedDocumentId, accessToken, marketplaceId) {
    try {
      const url = 'https://sellingpartnerapi-na.amazon.com/feeds/2021-06-30/feeds';
      
      const response = await this.client.post(url, {
        feedType: 'JSON_LISTINGS_FEED',
        marketplaceIds: [marketplaceId],
        inputFeedDocumentId: feedDocumentId
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken,
          'Content-Type': 'application/json'
        }
      });
      
      logger.info(`Feed submitted: ${response.data.feedId}`);
      return response.data.feedId;
    } catch (error) {
      // Verificar se é um erro 429 (Too Many Requests)
      if (error.response && error.response.status === 429) {
        const delaySeconds = 300; // 5 minutos em segundos
        logger.warn(`Taxa limite excedida (429) ao enviar feed. Aguardando ${delaySeconds} segundos antes de tentar novamente.`);
        
        // Aguardar 5 minutos antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        
        // Tentar novamente após a pausa
        return this.submitFeed(feedDocumentId, accessToken, marketplaceId);
      }
      
      logger.error(`Error submitting feed: ${error.message}`, { error });
      throw new Error(`Failed to submit feed: ${error.message}`);
    }
  }

  /**
   * Verifica o status de um feed
   * @param {string} feedId - ID do feed
   * @param {string} accessToken - Token de acesso
   * @param {number} maxAttempts - Número máximo de tentativas
   * @param {number} delaySeconds - Delay entre tentativas em segundos
   * @returns {Promise<Object>} - Informações do feed
   */
  async checkFeedStatus(feedId, accessToken, maxAttempts = 20, delaySeconds = 30) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const url = `https://sellingpartnerapi-na.amazon.com/feeds/2021-06-30/feeds/${feedId}`;
        
        const response = await this.client.get(url, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'x-amz-access-token': accessToken
          }
        });
        
        const status = response.data.processingStatus;
        logger.info(`Feed ${feedId} status: ${status} (attempt ${attempt}/${maxAttempts})`);
        
        if (status === 'DONE' || status === 'FATAL') {
          return response.data;
        }
        
        // Aguardar antes da próxima tentativa
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      } catch (error) {
        // Verificar se é um erro 429 (Too Many Requests)
        if (error.response && error.response.status === 429) {
          const rateDelaySeconds = 300; // 5 minutos em segundos
          logger.warn(`Taxa limite excedida (429) ao verificar status do feed. Aguardando ${rateDelaySeconds} segundos antes de tentar novamente.`);
          
          // Aguardar 5 minutos antes da próxima tentativa
          await new Promise(resolve => setTimeout(resolve, rateDelaySeconds * 1000));
        } else {
          logger.error(`Error checking feed status: ${error.message}`, { error });
          
          // Aguardar antes da próxima tentativa
          await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        }
      }
    }
    
    throw new Error(`Feed status check timed out after ${maxAttempts} attempts`);
  }

  /**
   * Obtém informações sobre um documento de feed
   * @param {string} documentId - ID do documento
   * @param {string} accessToken - Token de acesso
   * @returns {Promise<Object>} - Informações do documento
   */
  async getFeedDocument(documentId, accessToken) {
    try {
      const url = `https://sellingpartnerapi-na.amazon.com/feeds/2021-06-30/documents/${documentId}`;
      
      const response = await this.client.get(url, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken
        }
      });
      
      logger.info(`Feed document retrieved: ${documentId}`);
      return response.data;
    } catch (error) {
      // Verificar se é um erro 429 (Too Many Requests)
      if (error.response && error.response.status === 429) {
        const delaySeconds = 300; // 5 minutos em segundos
        logger.warn(`Taxa limite excedida (429) ao obter documento de feed. Aguardando ${delaySeconds} segundos antes de tentar novamente.`);
        
        // Aguardar 5 minutos antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        
        // Tentar novamente após a pausa
        return this.getFeedDocument(documentId, accessToken);
      }
      
      logger.error(`Error getting feed document: ${error.message}`, { error });
      throw new Error(`Failed to get feed document: ${error.message}`);
    }
  }

  /**
   * Baixa o relatório de resultado do feed
   * @param {string} resultFeedDocumentId - ID do documento de resultado
   * @param {string} accessToken - Token de acesso
   * @returns {Promise<Object>} - Conteúdo do relatório
   */
  async downloadFeedResult(resultFeedDocumentId, accessToken) {
    try {
      // Obter URL de download
      const docUrl = `https://sellingpartnerapi-na.amazon.com/feeds/2021-06-30/documents/${resultFeedDocumentId}`;
      
      const docResponse = await this.client.get(docUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-amz-access-token': accessToken
        }
      });
      
      const downloadUrl = docResponse.data.url;
      
      // Baixar o relatório
      const response = await this.client.get(downloadUrl, {
        responseType: 'arraybuffer'
      });
      
      // Descomprimir o conteúdo se necessário
      let content = response.data;
      
      if (response.headers['content-encoding'] === 'gzip' || 
          response.headers['content-type'] === 'application/gzip') {
        content = await gunzipPromise(content);
      }
      
      // Converter para string e tentar fazer parse como JSON
      const contentStr = content.toString('utf-8');
      
      try {
        const contentJson = JSON.parse(contentStr);
        logger.info(`Feed result downloaded and parsed: ${resultFeedDocumentId}`);
        return contentJson;
      } catch (e) {
        logger.info(`Feed result downloaded but not JSON: ${resultFeedDocumentId}`);
        return { rawContent: contentStr };
      }
    } catch (error) {
      // Verificar se é um erro 429 (Too Many Requests)
      if (error.response && error.response.status === 429) {
        const delaySeconds = 300; // 5 minutos em segundos
        logger.warn(`Taxa limite excedida (429) ao baixar resultado do feed. Aguardando ${delaySeconds} segundos antes de tentar novamente.`);
        
        // Aguardar 5 minutos antes de tentar novamente
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        
        // Tentar novamente após a pausa
        return this.downloadFeedResult(resultFeedDocumentId, accessToken);
      }
      
      logger.error(`Error downloading feed result: ${error.message}`, { error });
      throw new Error(`Failed to download feed result: ${error.message}`);
    }
  }

  /**
   * Obtém as credenciais da Amazon do banco de dados
   * @returns {Promise<Object|null>} - Credenciais da Amazon
   */
  static async getAmazonCredentials() {
    const dbService = new DatabaseService(DB_CONFIG);
    await dbService.init();
    
    try {
      return await dbService.getAmazonCredentials();
    } finally {
      await dbService.close();
    }
  }
}

module.exports = AmazonApiService;
