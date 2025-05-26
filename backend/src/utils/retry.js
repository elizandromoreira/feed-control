/**
 * Utilidades para Retry e Rate Limiting
 * 
 * Este módulo fornece funções para gerenciar retries e rate limiting em chamadas de API.
 * Equivalente às funções de retry e ao uso de AsyncLimiter do script Python original.
 */

const Bottleneck = require('bottleneck');
const { backOff } = require('exponential-backoff');
const logger = require('../config/logging')();

/**
 * Cria um rate limiter para controlar a taxa de requisições
 * @param {number} requestsPerSecond - Número máximo de requisições por segundo
 * @param {number} [maxConcurrent=10] - Número máximo de requisições concorrentes
 * @returns {Bottleneck} - Instância configurada do rate limiter
 */
const createRateLimiter = (requestsPerSecond, maxConcurrent = 10) => {
  return new Bottleneck({
    maxConcurrent,
    minTime: 1000 / requestsPerSecond
  });
};

/**
 * Calcula o tempo de espera com jitter para retries
 * @param {number} attempt - Número da tentativa atual
 * @param {number} [base=1] - Tempo base em segundos
 * @param {number} [maxBackoff=60] - Tempo máximo de backoff em segundos
 * @returns {number} - Tempo de espera calculado em milissegundos
 */
const waitWithJitter = (attempt, base = 1, maxBackoff = 60) => {
  const calculated = Math.min(maxBackoff, Math.pow(2, attempt) * base);
  return (calculated / 2 + (calculated / 2) * Math.random()) * 1000; // Converter para ms
};

/**
 * Executa uma função com retry e backoff exponencial
 * @param {Function} requestFn - Função a ser executada
 * @param {Object} options - Opções de configuração
 * @param {number} [options.maxRetries=3] - Número máximo de tentativas
 * @param {number} [options.initialDelayMs=1000] - Delay inicial em ms
 * @param {number} [options.maxDelayMs=60000] - Delay máximo em ms
 * @returns {Promise<any>} - Resultado da função
 */
const retryRequest = async (requestFn, options = {}) => {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 60000
  } = options;

  return backOff(requestFn, {
    numOfAttempts: maxRetries,
    startingDelay: initialDelayMs,
    timeMultiple: 2,
    delayFirstAttempt: false,
    jitter: true,
    maxDelay: maxDelayMs,
    retry: (error, attemptNumber) => {
      logger.warn(`Retry attempt ${attemptNumber}/${maxRetries} due to: ${error.message}`);
      return true;
    }
  });
};

/**
 * Configura um cliente Axios com retry automático
 * @param {import('axios').AxiosInstance} axiosInstance - Instância do Axios
 * @param {Object} options - Opções de configuração
 * @param {number} [options.retries=3] - Número máximo de tentativas
 * @param {number} [options.retryDelay=1000] - Delay inicial entre tentativas
 * @param {Function} [options.retryCondition] - Função para determinar se deve tentar novamente
 * @returns {import('axios').AxiosInstance} - Instância do Axios configurada
 */
const configureAxiosRetry = (axiosInstance, options = {}) => {
  const axiosRetry = require('axios-retry');
  
  const {
    retries = 3,
    retryDelay = 1000,
    retryCondition
  } = options;
  
  axiosRetry(axiosInstance, {
    retries,
    retryDelay: (retryCount) => {
      return waitWithJitter(retryCount, retryDelay / 1000, 60);
    },
    retryCondition: retryCondition || ((error) => {
      return axiosRetry.isNetworkOrIdempotentRequestError(error) || 
             (error.response && error.response.status >= 500);
    }),
    onRetry: (retryCount, error) => {
      logger.warn(`Axios retry ${retryCount}/${retries} for ${error.config?.url}: ${error.message}`);
    }
  });
  
  return axiosInstance;
};

module.exports = {
  createRateLimiter,
  waitWithJitter,
  retryRequest,
  configureAxiosRetry
};
