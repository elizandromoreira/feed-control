/**
 * Utilidades para Validação
 * 
 * Este módulo fornece funções para validação de dados, especialmente para
 * validação de schema JSON.
 * 
 * Equivalente às funções de validação do script Python original.
 */

const fs = require('fs').promises;
const path = require('path');
const { Validator } = require('jsonschema');
const logger = require('../config/logging')();

/**
 * Carrega um schema JSON de um arquivo
 * @param {string} schemaFilename - Nome do arquivo de schema
 * @returns {Promise<Object|null>} - Schema carregado ou null em caso de erro
 */
async function loadSchema(schemaFilename) {
  try {
    const schemaPath = path.join(process.cwd(), 'schemas', schemaFilename);
    const schemaContent = await fs.readFile(schemaPath, 'utf8');
    return JSON.parse(schemaContent);
  } catch (error) {
    logger.error(`Error loading schema ${schemaFilename}: ${error.message}`, { error });
    return null;
  }
}

/**
 * Valida um objeto JSON contra um schema
 * @param {Object} data - Dados a serem validados
 * @param {Object} schema - Schema para validação
 * @returns {Object} - Resultado da validação com propriedades valid e errors
 */
function validateAgainstSchema(data, schema) {
  const validator = new Validator();
  const result = validator.validate(data, schema);
  
  return {
    valid: result.valid,
    errors: result.errors.map(err => ({
      property: err.property,
      message: err.message,
      stack: err.stack
    }))
  };
}

/**
 * Valida um feed JSON contra o schema oficial
 * @param {Object} feedJson - Feed JSON a ser validado
 * @param {Object} schema - Schema para validação
 * @returns {boolean} - true se o feed for válido, false caso contrário
 */
function validateFeedJson(feedJson, schema) {
  try {
    const result = validateAgainstSchema(feedJson, schema);
    
    if (result.valid) {
      logger.info('Feed JSON validated successfully against schema');
      return true;
    } else {
      const errors = result.errors.map(err => err.stack).join('; ');
      logger.error(`Feed JSON validation failed: ${errors}`);
      return false;
    }
  } catch (error) {
    logger.error(`Error validating feed JSON: ${error.message}`, { error });
    return false;
  }
}

module.exports = {
  loadSchema,
  validateAgainstSchema,
  validateFeedJson
};
