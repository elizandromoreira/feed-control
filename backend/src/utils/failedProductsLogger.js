/**
 * Utilitário para registrar produtos que falharam durante a sincronização
 * 
 * Este módulo fornece funções para registrar produtos que falharam durante
 * o processo de sincronização e salvar esses dados em um arquivo CSV.
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../config/logging')();

// Diretório para salvar arquivos de log
const LOG_DIR = path.join(process.cwd(), 'logs');

// Lista de produtos que falharam
let failedProducts = [];

/**
 * Adiciona um produto à lista de produtos que falharam
 * @param {string} sku - SKU do produto
 * @param {string} reason - Motivo da falha
 * @param {Object} [additionalData] - Dados adicionais sobre o produto
 */
function addFailedProduct(sku, reason, additionalData = {}) {
  failedProducts.push({
    sku,
    reason,
    timestamp: new Date().toISOString(),
    ...additionalData
  });
}

/**
 * Salva a lista de produtos que falharam em um arquivo CSV
 * @returns {Promise<string>} - Caminho do arquivo salvo
 */
async function saveFailedProductsToCSV() {
  if (failedProducts.length === 0) {
    logger.info('No failed products to save');
    return null;
  }
  
  try {
    // Criar diretório de logs se não existir
    await fs.mkdir(LOG_DIR, { recursive: true });
    
    // Nome do arquivo com timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `failed_products_${timestamp}.csv`;
    const filePath = path.join(LOG_DIR, filename);
    
    // Criar cabeçalho do CSV
    const headers = ['sku', 'reason', 'timestamp', ...Object.keys(failedProducts[0]).filter(key => !['sku', 'reason', 'timestamp'].includes(key))];
    
    // Criar linhas do CSV
    const rows = failedProducts.map(product => {
      return headers.map(header => {
        const value = product[header];
        // Escapar valores com vírgulas
        return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
      }).join(',');
    });
    
    // Conteúdo completo do CSV
    const csvContent = [headers.join(','), ...rows].join('\n');
    
    // Salvar arquivo
    await fs.writeFile(filePath, csvContent, 'utf8');
    
    logger.info(`Saved ${failedProducts.length} failed products to ${filePath}`);
    
    // Limpar lista após salvar
    failedProducts = [];
    
    return filePath;
  } catch (error) {
    logger.error(`Error saving failed products to CSV: ${error.message}`, { error });
    return null;
  }
}

/**
 * Limpa a lista de produtos que falharam
 */
function clearFailedProducts() {
  failedProducts = [];
}

module.exports = {
  addFailedProduct,
  saveFailedProductsToCSV,
  clearFailedProducts
};
