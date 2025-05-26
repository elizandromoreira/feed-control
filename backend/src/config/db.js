/**
 * Configuração do banco de dados
 * 
 * Este módulo contém as configurações de conexão com o banco de dados PostgreSQL.
 * Equivalente às configurações SYNC_DB_CONFIG e ASYNC_DB_CONFIG do script Python original.
 */

// Carrega variáveis de ambiente se existirem
require('dotenv').config();

// Configuração do banco de dados para operações síncronas e assíncronas
const DB_CONFIG = {
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.bvbnofnnbfdlnpuswlgy',
  password: process.env.DB_PASSWORD || 'Bi88An6B9L0EIihL',
  host: process.env.DB_HOST || 'aws-0-us-east-1.pooler.supabase.com',
  port: parseInt(process.env.DB_PORT || '6543', 10),
  // Parâmetros adicionais para o pool de conexões
  max: 20, // Tamanho máximo do pool
  idleTimeoutMillis: 30000, // Tempo máximo que uma conexão pode ficar inativa
  connectionTimeoutMillis: 10000 // Tempo máximo para estabelecer uma conexão
};

// Configuração da API do Home Depot
const API_CONFIG = {
  baseUrl: process.env.API_BASE_URL || 'http://167.114.223.83:3005/hd/api',
  requestsPerSecond: parseFloat(process.env.REQUESTS_PER_SECOND || '7'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10)
};

// Configurações de estoque e handling time
const STOCK_CONFIG = {
  stockLevel: parseInt(process.env.STOCK_LEVEL || '7', 10),
  leadTimeOmd: parseInt(process.env.LEAD_TIME_OMD || '2', 10),
  fixedLeadTimeOutOfStock: parseInt(process.env.FIXED_LEAD_TIME_OUTOFSTOCK || '20', 10)
};

module.exports = {
  DB_CONFIG,
  API_CONFIG,
  STOCK_CONFIG
};
