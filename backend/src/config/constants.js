/**
 * Constantes da aplicação
 * 
 * Este módulo define constantes técnicas fixas utilizadas em toda a aplicação.
 * Configurações de negócio vêm do banco de dados (store_configurations).
 */

/**
 * Configurações de retry e timeout (valores técnicos fixos)
 */
const RETRY_CONFIG = {
  // Número máximo de tentativas para APIs
  maxRetries: 2,
  // Tempo de espera entre tentativas (em ms)
  retryDelay: 1000,
  // Timeout para requisições (em ms)
  requestTimeout: 10000,
  // Timeout para conexões de banco (em ms)
  dbConnectionTimeout: 10000
};

/**
 * Configurações de rate limiting (valores técnicos fixos)
 */
const RATE_LIMIT_CONFIG = {
  // Número máximo de requisições concorrentes
  maxConcurrency: 5,
  // Delay mínimo entre requisições (em ms)
  minRequestDelay: 100
};

module.exports = {
  RETRY_CONFIG,
  RATE_LIMIT_CONFIG
};
