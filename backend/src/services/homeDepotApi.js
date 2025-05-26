/**
 * Serviço de API do Home Depot
 * 
 * Este módulo fornece uma classe para interagir com a API do Home Depot.
 * Equivalente à classe HomeDepotAPI do script Python original.
 */

const axios = require('axios');
const retry = require('async-retry');
const logger = require('../config/logging')();
const HomeDepotCartApi = require('./homeDepotCartApi');
require('dotenv').config();

// Carrega variáveis de ambiente - Usando preferencialmente as variáveis específicas da loja
const HOMEDEPOT_STOCK_LEVEL = process.env.HOMEDEPOT_STOCK_LEVEL ? parseInt(process.env.HOMEDEPOT_STOCK_LEVEL, 10) : 7;
const STOCK_LEVEL = HOMEDEPOT_STOCK_LEVEL; // Para compatibilidade com o código existente

// Log para mostrar qual valor está sendo usado
console.log(`Usando valor de estoque específico Home Depot (HOMEDEPOT_STOCK_LEVEL): ${HOMEDEPOT_STOCK_LEVEL}`);

// Preferir as variáveis específicas da loja 
const HOMEDEPOT_HANDLING_TIME_OMD = process.env.HOMEDEPOT_HANDLING_TIME_OMD 
  ? parseInt(process.env.HOMEDEPOT_HANDLING_TIME_OMD, 10) 
  : (process.env.LEAD_TIME_OMD ? parseInt(process.env.LEAD_TIME_OMD, 10) : 2);

const LEAD_TIME_OMD = HOMEDEPOT_HANDLING_TIME_OMD; // Para compatibilidade com o código existente

console.log(`Usando tempo de manuseio OMD específico Home Depot (HOMEDEPOT_HANDLING_TIME_OMD): ${HOMEDEPOT_HANDLING_TIME_OMD}`);

// Outras variáveis de ambiente
const HOMEDEPOT_REQUESTS_PER_SECOND = process.env.HOMEDEPOT_REQUESTS_PER_SECOND 
  ? parseInt(process.env.HOMEDEPOT_REQUESTS_PER_SECOND, 10) 
  : (process.env.REQUESTS_PER_SECOND ? parseInt(process.env.REQUESTS_PER_SECOND, 10) : 7);

const REQUESTS_PER_SECOND = HOMEDEPOT_REQUESTS_PER_SECOND; // Para compatibilidade com o código existente

const MAX_RETRIES = process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES, 10) : 3;
const API_BASE_URL = process.env.API_BASE_URL || 'http://167.114.223.83:3005/hd/api';

// Usar um controle de taxa estático para compartilhar entre todas as instâncias
const rateLimiter = {
  lastRequestTimes: [],
  requestDelay: 1000 / REQUESTS_PER_SECOND
};

/**
 * Classe para interagir com a API do Home Depot
 */
class HomeDepotApiService {
  /**
   * Cria uma nova instância do serviço de API do Home Depot
   * @param {string} baseUrl - URL base da API
   * @param {number} requestsPerSecond - Número máximo de requisições por segundo
   */
  constructor(baseUrl = API_BASE_URL, requestsPerSecond = REQUESTS_PER_SECOND) {
    this.baseUrl = baseUrl;
    this.requestsPerSecond = requestsPerSecond;
    // Atualizar o delay compartilhado com base no valor configurado
    rateLimiter.requestDelay = 1000 / requestsPerSecond;
    // Inicializar o serviço de API do carrinho
    this.cartApi = new HomeDepotCartApi();
    logger.info(`HomeDepotApiService iniciado com ${requestsPerSecond} requisições por segundo (delay: ${rateLimiter.requestDelay.toFixed(2)}ms)`);
  }

  /**
   * Aguarda o tempo necessário para respeitar o limite de requisições por segundo
   * @returns {Promise<void>}
   */
  async throttleRequest() {
    // Implementação mais estrita do rate limiting - semelhante à WhiteCapProvider
    const now = Date.now();
    
    // Limpar timestamps antigos (mais de 1 segundo)
    rateLimiter.lastRequestTimes = rateLimiter.lastRequestTimes.filter(
      time => now - time < 1000
    );
    
    // Se já atingimos o limite de requisições por segundo, esperar
    if (rateLimiter.lastRequestTimes.length >= this.requestsPerSecond) {
      // Calcular o tempo para aguardar para que a requisição mais antiga saia da janela de 1 segundo
      const oldestRequest = rateLimiter.lastRequestTimes[0];
      const timeToWait = Math.max(0, 1000 - (now - oldestRequest));
      
      if (timeToWait > 0) {
        logger.debug(`Rate limiting: aguardando ${timeToWait}ms para respeitar o limite de ${this.requestsPerSecond} requisições por segundo`);
        await new Promise(resolve => setTimeout(resolve, timeToWait));
      }
    }
    
    // Registrar esta requisição
    rateLimiter.lastRequestTimes.push(Date.now());
  }

  /**
   * Busca dados de um produto na API do Home Depot
   * @param {string} sku - SKU do produto
   * @returns {Promise<Object|null>} - Dados do produto ou null se não encontrado
   */
  async fetchProductData(sku) {
    await this.throttleRequest();
    
    try {
      // Construir URL da API
      const url = `${this.baseUrl}/${sku}`;
      
      logger.info(`Buscando dados do produto ${sku} em ${url}`);
      
      const response = await axios.get(url, {
        timeout: 20000, // Aumentando o timeout para 20 segundos
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      });
      
      // Implementar verificação mais tolerante com os dados
      // Se tivermos qualquer tipo de resposta, tentamos processar
      if (!response.data) {
        logger.warn(`Dados vazios recebidos para o SKU ${sku}`);
        return null;
      }
      
      // Log dos dados brutos recebidos para depuração
      logger.debug(`Dados brutos recebidos para SKU ${sku}: ${JSON.stringify(response.data)}`);
      
      // Retornar os dados brutos da API - o mapeamento será feito em fetchProductDataWithRetry
      return response.data;
    } catch (error) {
      // Tratamento de erro mais tolerante
      // Se obtivermos qualquer resposta parcial, tentamos usá-la
      if (error.response && error.response.data) {
        logger.warn(`Erro com resposta parcial para SKU ${sku}: ${error.message}, tentando usar dados parciais`);
        try {
          const partialData = error.response.data;
          // Adicionar o SKU aos dados parciais
          return { ...partialData, sku };
        } catch (parseError) {
          logger.error(`Não foi possível usar dados parciais para SKU ${sku}: ${parseError.message}`);
        }
      }
      
      // Tratamento de erro normal
      if (error.response) {
        // Erro de resposta da API
        const status = error.response.status;
        if (status === 404) {
          logger.warn(`Produto com SKU ${sku} não encontrado (404)`);
        } else {
          logger.error(`Erro de API para SKU ${sku}: ${status} ${error.response.statusText}`);
        }
      } else if (error.request) {
        // Erro de requisição (sem resposta)
        logger.error(`Erro de requisição para SKU ${sku}: ${error.message}`);
      } else {
        // Erro de configuração
        logger.error(`Erro ao buscar dados do produto para SKU ${sku}: ${error.message}`);
      }
      
      throw error;
    }
  }

  /**
   * Busca dados de um produto na API do Home Depot com retry
   * @param {string} sku - SKU do produto
   * @returns {Promise<Object|null>} - Dados do produto ou null se não encontrado
   */
  async fetchProductDataWithRetry(sku) {
    try {
      const result = await retry(
        async () => {
          const result = await this.fetchProductData(sku);
          
          // Validação mais rigorosa dos dados retornados
          if (!result || typeof result !== 'object') {
            throw new Error('Dados ausentes ou formato inválido da API');
          }
          
          // Verificar se temos pelo menos preço ou estoque - dados essenciais
          if (result.price === undefined && result.stock === undefined) {
            throw new Error('Dados incompletos da API: faltam informações essenciais');
          }
          
          return result;
        },
        {
          retries: MAX_RETRIES,
          minTimeout: 1000,
          maxTimeout: 5000,
          onRetry: (error, attempt) => {
            logger.warn(`Tentativa ${attempt} para SKU ${sku} devido a: ${error.message}`);
          }
        }
      );
      
      // Mapear os dados da API para o formato do banco de dados
      // Agora usando o método async que pode verificar o preço no carrinho
      return await this.mapApiDataToProductData(result, sku);
      
    } catch (error) {
      logger.error(`Falha ao buscar dados do produto para SKU ${sku} após ${MAX_RETRIES} tentativas: ${error.message}`);
      // Não retornar null, mas um objeto de erro para tratamento adequado
      return { error: true, message: error.message, sku };
    }
  }

  /**
   * Mapeia dados da API para o formato do banco de dados
   * @param {Object} apiData - Dados da API
   * @param {string} sku - SKU do produto
   * @returns {Object} - Dados do produto no formato do banco de dados
   */
  /**
   * Converte um valor para número de ponto flutuante de forma segura
   * @param {any} value - Valor a ser convertido
   * @returns {number} - Valor convertido ou 0 se inválido
   */
  safeParseFloat(value) {
    if (value === undefined || value === null) return 0;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Converte um valor para número inteiro de forma segura
   * @param {any} value - Valor a ser convertido
   * @returns {number} - Valor convertido ou 0 se inválido
   */
  safeParseInt(value) {
    if (value === undefined || value === null) return 0;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Converte um valor para booleano de forma segura e flexível
   * @param {any} value - Valor a ser convertido
   * @returns {boolean} - Valor convertido
   */
  safeParseBoolean(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lowered = value.toLowerCase();
      return lowered === 'true' || lowered === 'yes' || lowered === 'y' || lowered === '1';
    }
    if (typeof value === 'number') return value > 0;
    return Boolean(value);
  }

  /**
   * Mapeia dados da API para o formato do banco de dados
   * Implementação mais robusta com melhor tratamento de campos ausentes ou inválidos
   * @param {Object} apiData - Dados da API
   * @param {string} sku - SKU do produto
   * @returns {Object} - Dados do produto no formato do banco de dados
   */
  /**
   * Verifica o preço de um produto no carrinho quando o preço retornado pela API é 0
   * @param {string} itemId - ID do produto
   * @returns {Promise<number>} - Preço do produto ou 0 se não for possível obter
   */
  async checkPriceInCart(itemId) {
    try {
      logger.info(`Produto ${itemId} tem preço 0, tentando verificar preço no carrinho`);
      
      // Usar o serviço de API do carrinho para verificar o preço
      const cartResult = await this.cartApi.checkPriceInCart(itemId);
      
      if (cartResult && cartResult.success && cartResult.price > 0) {
        logger.info(`Preço obtido com sucesso para ${itemId} via carrinho: $${cartResult.price}`);
        return cartResult.price;
      } else {
        const errorMessage = cartResult ? (cartResult.message || 'Preço ainda é 0') : 'Resposta vazia do carrinho';
        logger.warn(`Não foi possível obter preço via carrinho para ${itemId}: ${errorMessage}`);
        return 0;
      }
    } catch (error) {
      logger.error(`Erro ao verificar preço no carrinho para ${itemId}: ${error.message}`);
      return 0;
    }
  }

  async mapApiDataToProductData(apiData, sku) {
    // Log dos dados recebidos para diagnóstico
    logger.debug(`[DIAGNÓSTICO] Mapeando dados para SKU ${sku}: ${JSON.stringify(apiData)}`);
    
    // Extrair e converter o preço para uso posterior
    let price = this.safeParseFloat(apiData.price);
    
    // Se o preço for 0, tentar verificar o preço no carrinho
    if (price === 0 && apiData.id) {
      price = await this.checkPriceInCart(apiData.id);
    }
    
    // Mapeamento explícito de campos com verificação de existência
    const mappedData = {
      sku,
      price: price,
      shipping_cost: this.safeParseFloat(apiData.shippingCost), // Corrigir nome do campo
      available: this.safeParseBoolean(apiData.available),
      stock: this.safeParseInt(apiData.stock),
      brand: apiData.brand || '',
      min_delivery_date: apiData.minDeliveryDate || null,
      max_delivery_date: apiData.maxDeliveryDate || null,
      lead_time: LEAD_TIME_OMD,
      lead_time_2: 0,
      total_price: price + this.safeParseFloat(apiData.shippingCost),
      last_update: new Date().toISOString()
    };
    
    // Log detalhado para diagnóstico dos dados mapeados
    logger.debug(`[DIAGNÓSTICO] Dados mapeados para SKU ${sku}: ${JSON.stringify(mappedData)}`);
    
    return mappedData;
  }

  /**
   * Calcula a quantidade e disponibilidade de um produto
   * @param {number} stock - Estoque do produto
   * @param {boolean} available - Disponibilidade do produto
   * @returns {Object} - Objeto com quantidade e disponibilidade
   */
  calculateQuantity(stock, available, sku = 'unknown', price = null) {
    // Buscar o valor atualizado no process.env toda vez que a função é chamada
    const currentStockLevel = process.env.HOMEDEPOT_STOCK_LEVEL
      ? parseInt(process.env.HOMEDEPOT_STOCK_LEVEL, 10)
      : 7;
      
    // Melhorar o log para diagnóstico com informações de tipo
    logger.debug(`[DIAGNÓSTICO] Produto ${sku}: Calculando quantidade - stock=${stock} (${typeof stock}), available=${available} (${typeof available}), price=${price} (${typeof price}), stockLevel=${currentStockLevel}`);
    
    // Conversão mais robusta de tipos
    let stockNum = 0;
    if (stock !== undefined && stock !== null) {
      if (typeof stock === 'string') {
        stockNum = parseInt(stock, 10);
      } else if (typeof stock === 'number') {
        stockNum = stock;
      }
    }
    
    // Conversão mais robusta de disponibilidade
    const isAvailable = available === true ||
                        available === 'true' ||
                        available === 1 ||
                        available === '1' ||
                        available === 'yes' ||
                        available === 'y';
    
    // VERIFICAÇÃO CRÍTICA: Se o preço for 0, marcar como indisponível independentemente do estoque
    if (price !== null && (price === 0 || price === '0' || price === 0.0)) {
      logger.info(`Produto ${sku} com preço zero (${price}), marcando como indisponível independente do estoque`);
      return { quantity: 0, availability: 'outOfStock' };
    }
    
    // Se o produto não estiver disponível, retornar quantidade 0
    if (!isAvailable) {
      logger.debug(`Produto ${sku} marcado como indisponível: available=${isAvailable}`);
      return { quantity: 0, availability: 'outOfStock' };
    }
    
    // NOVA LÓGICA: Tratamento granular do estoque
    
    // 1. Estoque menor que 3: marcar como indisponível (quantidade 0)
    if (isNaN(stockNum) || stockNum < 3) {
      logger.debug(`Produto ${sku} com estoque baixo: stock=${stockNum} < 3, marcando como indisponível`);
      return { quantity: 0, availability: 'outOfStock' };
    }
    
    // 2. Estoque entre 4 e HOMEDEPOT_STOCK_LEVEL: manter o valor real retornado pela API
    if (stockNum <= currentStockLevel) {
      logger.debug(`Produto ${sku} com estoque dentro do limite: stock=${stockNum}, mantendo valor real`);
      return { quantity: stockNum, availability: 'inStock' };
    }
    
    // 3. Estoque maior que HOMEDEPOT_STOCK_LEVEL: usar o valor máximo configurado
    logger.debug(`Produto ${sku} com estoque acima do limite: stock=${stockNum} > ${currentStockLevel}, limitando ao máximo configurado`);
    return { quantity: currentStockLevel, availability: 'inStock' };
  }

  /**
   * Calcula o tempo de entrega com base nas datas de entrega mínima e máxima
   * @param {string} minDeliveryDate - Data mínima de entrega
   * @param {string} maxDeliveryDate - Data máxima de entrega
   * @returns {number} - Tempo de entrega em dias
   */
  /**
   * Obtém o tempo de entrega padrão com base nas variáveis de ambiente
   * @returns {number} Tempo de entrega padrão em dias
   */
  getDefaultLeadTime() {
    const defaultLeadTime = process.env.HOMEDEPOT_HANDLING_TIME_OMD
      ? parseInt(process.env.HOMEDEPOT_HANDLING_TIME_OMD, 10)
      : (process.env.LEAD_TIME_OMD ? parseInt(process.env.LEAD_TIME_OMD, 10) : 2);
    
    return defaultLeadTime;
  }

  /**
   * Calcula o tempo de entrega com base nas datas de entrega mínima e máxima
   * Implementação mais robusta com melhor tratamento de erros e valores inválidos
   * @param {string} minDeliveryDate - Data mínima de entrega
   * @param {string} maxDeliveryDate - Data máxima de entrega
   * @param {string} sku - SKU do produto para log
   * @returns {number} - Tempo de entrega em dias
   */
  calculateDeliveryTime(minDeliveryDate, maxDeliveryDate, sku = 'unknown') {
    // Validação mais robusta de datas
    if (!minDeliveryDate || !maxDeliveryDate ||
        minDeliveryDate === '' || maxDeliveryDate === '') {
      const defaultTime = this.getDefaultLeadTime();
      logger.debug(`[DIAGNÓSTICO] Produto ${sku}: Datas de entrega vazias, usando tempo padrão: ${defaultTime}`);
      return defaultTime;
    }
    
    try {
      const minDate = new Date(minDeliveryDate);
      const maxDate = new Date(maxDeliveryDate);
      
      // Verificar se as datas são válidas
      if (isNaN(minDate.getTime()) || isNaN(maxDate.getTime())) {
        const defaultTime = this.getDefaultLeadTime();
        logger.debug(`[DIAGNÓSTICO] Produto ${sku}: Datas de entrega inválidas: min=${minDeliveryDate}, max=${maxDeliveryDate}, usando padrão: ${defaultTime}`);
        return defaultTime;
      }
      
      // Calcular a data média entre a data mínima e máxima de entrega
      const avgDeliveryTime = new Date((minDate.getTime() + maxDate.getTime()) / 2);
      
      // Calcular a diferença em dias entre a data atual e a data média de entrega
      const now = new Date();
      const diffTime = avgDeliveryTime.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      // Se a diferença for negativa ou zero, usar o mínimo de 1 dia
      const leadTime = Math.max(1, diffDays);
      
      logger.debug(`[DIAGNÓSTICO] Produto ${sku}: Tempo de entrega calculado: ${leadTime} dias (min_date: ${minDeliveryDate}, max_date: ${maxDeliveryDate}, avg_date: ${avgDeliveryTime.toISOString()}, now: ${now.toISOString()})`);
      
      // Retornar o tempo de entrega (mínimo 1 dia)
      return leadTime;
    } catch (error) {
      // Em caso de qualquer erro no cálculo, usar o valor padrão
      const defaultTime = this.getDefaultLeadTime();
      logger.error(`[DIAGNÓSTICO] Produto ${sku}: Erro ao calcular tempo de entrega: ${error.message}, usando padrão: ${defaultTime}`);
      return defaultTime;
    }
  }
}

module.exports = HomeDepotApiService;
