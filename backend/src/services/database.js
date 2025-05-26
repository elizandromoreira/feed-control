/**
 * Serviço de Banco de Dados
 * 
 * Este módulo fornece uma classe para gerenciar conexões com o banco de dados PostgreSQL.
 */

const { Pool } = require('pg');
const retry = require('async-retry');
const logger = require('../config/logging')();
require('dotenv').config();

/**
 * Classe para gerenciar pool de conexões com o banco de dados PostgreSQL
 */
class DatabaseService {
  /**
   * Cria uma nova instância do serviço de banco de dados
   * @param {Object} dbConfig - Configuração do banco de dados
   * @param {number} minSize - Tamanho mínimo do pool (padrão: 5)
   * @param {number} maxSize - Tamanho máximo do pool (padrão: 20)
   */
  constructor(dbConfig, minSize = 5, maxSize = 20) {
    // Log das configurações do banco de dados (sem a senha)
    logger.info(`Connecting to database ${dbConfig.database} at ${dbConfig.host}:${dbConfig.port} as ${dbConfig.user}`);
    
    this.pool = new Pool({
      user: dbConfig.user,
      host: dbConfig.host,
      database: dbConfig.database,
      password: dbConfig.password,
      port: dbConfig.port,
      min: minSize,
      max: maxSize,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });

    // Monitoramento de erros no pool
    this.pool.on('error', (err, client) => {
      logger.error(`Unexpected error on idle client: ${err.message}`, { error: err });
    });
  }

  /**
   * Inicializa o pool de conexões
   * @returns {Promise<boolean>} - true se a inicialização for bem-sucedida, false caso contrário
   */
  async init() {
    try {
      // Teste de conexão
      const client = await this.pool.connect();
      client.release();
      logger.info('Database pool initialized successfully');
      return true;
    } catch (error) {
      logger.error(`Failed to initialize database pool: ${error.message}`);
      return false;
    }
  }

  /**
   * Fecha o pool de conexões
   * @returns {Promise<void>}
   */
  async close() {
    try {
      // Verificar se o pool ainda existe e não foi fechado
      if (this.pool && !this.pool._ending && !this.pool._closed) {
        await this.pool.end();
        logger.info('Database pool closed');
      } else if (this.pool && (this.pool._ending || this.pool._closed)) {
        logger.info('Database pool already closing or closed');
      } else {
        logger.info('Database pool not initialized');
      }
    } catch (error) {
      // Se o erro for sobre tentar fechar um pool já fechado, apenas logar
      if (error.message && error.message.includes('end on pool more than once')) {
        logger.info('Database pool was already closed');
      } else {
        // Para outros erros, logar como erro
        logger.error(`Error closing database pool: ${error.message}`);
      }
    } finally {
      // Garantir que o pool seja definido como null para evitar tentativas futuras de uso
      this.pool = null;
    }
  }

  /**
   * Executa uma consulta SQL com retry
   * @param {string} query - Consulta SQL
   * @param {Array} params - Parâmetros da consulta
   * @returns {Promise<Object>} - Resultado da consulta
   */
  async executeWithRetry(query, params = []) {
    return await retry(
      async () => {
        try {
          const client = await this.pool.connect();
          try {
            return await client.query(query, params);
          } finally {
            client.release();
          }
        } catch (error) {
          logger.warn(`Database query retry due to: ${error.message}`);
          throw error;
        }
      },
      {
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 5000,
        onRetry: (error) => {
          logger.warn(`Database query retry due to: ${error.message}`);
        }
      }
    );
  }

  /**
   * Busca linhas no banco de dados com retry
   * @param {string} query - Consulta SQL
   * @param {Array} params - Parâmetros da consulta
   * @returns {Promise<Array>} - Linhas encontradas
   */
  async fetchRowsWithRetry(query, params = []) {
    try {
      const result = await this.executeWithRetry(query, params);
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching rows: ${error.message}`);
      throw error;
    }
  }

  /**
   * Busca uma linha no banco de dados com retry
   * @param {string} query - Consulta SQL
   * @param {Array} params - Parâmetros da consulta
   * @returns {Promise<Object|null>} - Linha encontrada ou null se não encontrada
   */
  async fetchRowWithRetry(query, params = []) {
    try {
      const rows = await this.fetchRowsWithRetry(query, params);
      return rows.length > 0 ? rows[0] : null;
    } catch (error) {
      logger.error(`Error fetching row: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtém as credenciais de acesso à API da Amazon do banco de dados ou arquivo de configuração
   * @returns {Promise<Object|null>} - Credenciais da Amazon ou null se não encontradas
   */
  async getAmazonCredentials() {
    try {
      // Buscar credenciais da tabela amazon_credentials com store_id 'OMD'
      const query = `
        SELECT 
          client_id, 
          client_secret, 
          refresh_token, 
          seller_id, 
          marketplace_id
        FROM amazon_credentials
        WHERE store_id = 'OMD'
        LIMIT 1
      `;
      
      const credentials = await this.fetchRowWithRetry(query);
      
      if (credentials) {
        logger.info('Retrieved Amazon credentials from database for store_id: OMD');
        return credentials;
      }
      
      // Se não encontrar no banco, usa valores do ambiente
      logger.info('Using Amazon credentials from environment variables');
      return {
        client_id: process.env.AMAZON_CLIENT_ID,
        client_secret: process.env.AMAZON_CLIENT_SECRET,
        refresh_token: process.env.AMAZON_REFRESH_TOKEN,
        seller_id: process.env.AMAZON_SELLER_ID,
        marketplace_id: process.env.AMAZON_MARKETPLACE_ID
      };
    } catch (error) {
      logger.error(`Error getting Amazon credentials: ${error.message}`, { error });
      return null;
    }
  }

  /**
   * Obtém informações de uma loja pelo nome
   * @param {string} storeName - Nome da loja
   * @returns {Promise<Object|null>} - Informações da loja ou null se não encontrada
   */
  async getStoreByName(storeName) {
    try {
      const query = `
        SELECT *
        FROM stores
        WHERE name = $1
        LIMIT 1
      `;
      
      const store = await this.fetchRowWithRetry(query, [storeName]);
      
      if (store) {
        logger.info(`Retrieved store information for ${storeName}`);
        return store;
      } else {
        logger.warn(`Store not found: ${storeName}`);
        return null;
      }
    } catch (error) {
      logger.error(`Error getting store by name: ${error.message}`, { error });
      return null;
    }
  }
}

module.exports = DatabaseService;
