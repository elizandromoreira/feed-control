const { Pool } = require('pg');
const { DB_CONFIG } = require('../config/db');

/**
 * Converte as chaves de um objeto de snake_case para camelCase.
 * @param {Object} obj - O objeto a ser convertido.
 * @returns {Object} O objeto com as chaves em camelCase.
 */
function toCamelCase(obj) {
    if (!obj) return null;
    const newObj = {};
    for (const key in obj) {
        const newKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
        newObj[newKey] = obj[key];
    }
    return newObj;
}

/**
 * Converte as chaves de um objeto de camelCase para snake_case.
 * @param {Object} obj - O objeto a ser convertido.
 * @returns {Object} O objeto com as chaves em snake_case.
 */
function toSnakeCase(obj) {
    if (!obj) return null;
    const newObj = {};
    for (const key in obj) {
        const newKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        newObj[newKey] = obj[key];
    }
    return newObj;
}

/**
 * Busca a configuração de uma única loja pelo ID.
 * @param {string} storeId - O ID da loja.
 * @returns {Promise<Object|null>} A configuração da loja ou null se não encontrada.
 */
async function getStoreConfig(storeId) {
    const pool = new Pool(DB_CONFIG);
    try {
        const result = await pool.query('SELECT * FROM store_configurations WHERE store_id = $1', [storeId]);
        return toCamelCase(result.rows[0]) || null;
    } catch (error) {
        console.error(`Erro ao buscar configuração para a loja ${storeId}:`, error);
        throw error;
    } finally {
        await pool.end();
    }
}

/**
 * Busca as configurações de todas as lojas.
 * @returns {Promise<Array>} Um array com as configurações de todas as lojas.
 */
async function getAllStoreConfigs() {
    const pool = new Pool(DB_CONFIG);
    try {
        const result = await pool.query('SELECT * FROM store_configurations ORDER BY display_name');
        return result.rows.map(toCamelCase);
    } catch (error) {
        console.error('Erro ao buscar todas as configurações de loja:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

/**
 * Atualiza a configuração de uma loja.
 * @param {string} storeId - O ID da loja a ser atualizada.
 * @param {Object} configData - Um objeto com os campos a serem atualizados.
 * @returns {Promise<Object>} A configuração da loja atualizada.
 */
async function updateStoreConfig(storeId, configData) {
    const pool = new Pool(DB_CONFIG);

    // Converte configData de camelCase para snake_case
    const snakeCaseData = toSnakeCase(configData);

    // Lista de todas as colunas que podem ser atualizadas.
    const updatableColumns = [
        'stock_level', 'batch_size', 'requests_per_second', 'handling_time_omd',
        'provider_specific_handling_time', // Nome genérico correto
        'update_flag_value',
        'is_schedule_active', 'schedule_interval_hours',
        'is_sync_running', 'status', 'last_sync_at' // Campos para controle de sincronização
    ];

    const fieldsToUpdate = [];
    const values = [storeId]; // O storeId é sempre o primeiro parâmetro ($1)

    // Constrói a query dinamicamente, mas de forma segura
    updatableColumns.forEach(column => {
        // Verifica se a chave existe e não é undefined no payload recebido
        if (snakeCaseData[column] !== undefined) {
            fieldsToUpdate.push(`"${column}" = $${values.length + 1}`);
            values.push(snakeCaseData[column]);
        }
    });

    if (fieldsToUpdate.length === 0) {
        return getStoreConfig(storeId); // Nada para atualizar
    }

    const setClauses = fieldsToUpdate.join(', ');

    const query = `
        UPDATE store_configurations 
        SET ${setClauses}, updated_at = NOW() 
        WHERE store_id = $1 
        RETURNING *
    `;

    try {
        const result = await pool.query(query, values);
        // Retorna o resultado no formato que o frontend espera
        return toCamelCase(result.rows[0]);
    } catch (error) {
        console.error(`[updateStoreConfig] Erro ao atualizar configuração para a loja ${storeId}:`, error);
        throw error;
    } finally {
        await pool.end();
    }
}

module.exports = {
    getStoreConfig,
    getAllStoreConfigs,
    updateStoreConfig
}; 