/**
 * Constantes da aplicação
 * 
 * Este módulo define constantes utilizadas em toda a aplicação,
 * como configurações de API, banco de dados e regras de negócio.
 */

// Carrega variáveis de ambiente
require('dotenv').config();

/**
 * Configurações do banco de dados
 */
const DB_CONFIG = {
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.bvbnofnnbfdlnpuswlgy',
  password: process.env.DB_PASSWORD || 'Bi88An6B9L0EIihL',
  host: process.env.DB_HOST || 'aws-0-us-east-1.pooler.supabase.com',
  port: parseInt(process.env.DB_PORT || '6543', 10),
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
};

/**
 * Configurações da API do Home Depot
 */
const API_CONFIG = {
  // URL base da API do Home Depot
  apiBaseUrl: process.env.API_BASE_URL || 'http://167.114.223.83:3005/hd/api',
  // Configuração do banco de dados
  dbConfig: DB_CONFIG,
  // Número máximo de requisições por segundo (prioriza configuração específica da loja)
  requestsPerSecond: parseInt(process.env.HOMEDEPOT_REQUESTS_PER_SECOND || process.env.REQUESTS_PER_SECOND || '7', 10),
  // Número de requisições concorrentes
  concurrency: parseInt(process.env.HOMEDEPOT_CONCURRENCY || process.env.CONCURRENCY || '5', 10),
  // Número máximo de tentativas para requisições
  maxRetries: parseInt(process.env.HOMEDEPOT_MAX_RETRIES || process.env.MAX_RETRIES || '3', 10),
  // Tempo de espera entre tentativas (em ms)
  retryDelay: 1000,
  // Timeout para requisições (em ms)
  timeout: 10000
};

/**
 * Configurações de estoque
 */
const STOCK_CONFIG = {
  // Estoque padrão para produtos disponíveis (prioriza configuração específica da loja)
  stockLevel: parseInt(process.env.HOMEDEPOT_STOCK_LEVEL || process.env.STOCK_LEVEL || '7', 10),
  // Tempo de manuseio padrão para produtos da OMD (prioriza configuração específica da loja)
  leadTimeOmd: parseInt(process.env.HOMEDEPOT_HANDLING_TIME_OMD || process.env.LEAD_TIME_OMD || '2', 10),
  // Tempo de entrega fixo para produtos fora de estoque
  fixedLeadTimeOutOfStock: parseInt(process.env.HOMEDEPOT_FIXED_LEAD_TIME_OUTOFSTOCK || process.env.FIXED_LEAD_TIME_OUTOFSTOCK || '20', 10)
};

module.exports = {
  API_CONFIG,
  STOCK_CONFIG,
  DB_CONFIG
};
