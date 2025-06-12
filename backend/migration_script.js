const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { DB_CONFIG } = require('./src/config/db');

// Mapeamento de nomes de lojas no JSON para nomes no .env
const storeEnvPrefix = {
    'homedepot': 'HOMEDEPOT',
    'whitecap': 'WHITECAP',
    'vitacost': 'VITACOST',
    'bestbuy': 'BESTBUY',
    'webstaurantstore': 'WEBSTAURANTSTORE'
};

const getStoreDisplayName = (storeId) => {
    const names = {
        homedepot: 'Home Depot',
        whitecap: 'White Cap',
        vitacost: 'Vitacost',
        bestbuy: 'Best Buy',
        webstaurantstore: 'Webstaurant Store'
    };
    return names[storeId] || storeId;
}

async function migrate() {
    const pool = new Pool(DB_CONFIG);
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. Ler o arquivo stores.json
        const storesJsonPath = path.join(__dirname, 'data', 'stores.json');
        const storesData = JSON.parse(fs.readFileSync(storesJsonPath, 'utf8'));

        // 2. Ler o arquivo .env principal
        const envPath = path.join(__dirname, '.env');
        const envConfig = dotenv.parse(fs.readFileSync(envPath, 'utf8'));

        console.log('Iniciando a migração de configurações...');

        for (const store of storesData) {
            const storeId = store.id;
            const prefix = storeEnvPrefix[storeId];
            if (!prefix) {
                console.warn(`AVISO: Prefixo de ambiente não encontrado para a loja ${storeId}. Pulando.`);
                continue;
            }

            console.log(`Processando a loja: ${storeId}`);

            const config = {
                store_id: storeId,
                display_name: getStoreDisplayName(storeId),
                status: store.status || 'Inativo',
                is_schedule_active: store.schedule?.isActive || false,
                schedule_interval_hours: store.schedule?.interval || 4,
                last_sync_at: store.lastSync ? new Date(store.lastSync).toISOString() : null,
                
                stock_level: parseInt(envConfig[`${prefix}_STOCK_LEVEL`], 10) || null,
                batch_size: parseInt(envConfig[`${prefix}_BATCH_SIZE`], 10) || null,
                requests_per_second: parseInt(envConfig[`${prefix}_REQUESTS_PER_SECOND`], 10) || null,
                handling_time_omd: parseInt(envConfig[`${prefix}_HANDLING_TIME_OMD`], 10) || null,
                provider_specific_handling_time: parseInt(envConfig[`${prefix}_HANDLING_TIME`], 10) || null,
                update_flag_value: parseInt(envConfig[`${prefix}_UPDATE_FLAG_VALUE`], 10) || null,
            };

            // Inserir ou atualizar na nova tabela
            const insertQuery = `
                INSERT INTO store_configurations (
                    store_id, display_name, status, is_schedule_active, schedule_interval_hours, last_sync_at,
                    stock_level, batch_size, requests_per_second, handling_time_omd, 
                    provider_specific_handling_time, update_flag_value
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                ON CONFLICT (store_id) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    status = EXCLUDED.status,
                    is_schedule_active = EXCLUDED.is_schedule_active,
                    schedule_interval_hours = EXCLUDED.schedule_interval_hours,
                    last_sync_at = EXCLUDED.last_sync_at,
                    stock_level = EXCLUDED.stock_level,
                    batch_size = EXCLUDED.batch_size,
                    requests_per_second = EXCLUDED.requests_per_second,
                    handling_time_omd = EXCLUDED.handling_time_omd,
                    provider_specific_handling_time = EXCLUDED.provider_specific_handling_time,
                    update_flag_value = EXCLUDED.update_flag_value,
                    updated_at = NOW();
            `;
            
            const values = [
                config.store_id, config.display_name, config.status, config.is_schedule_active,
                config.schedule_interval_hours, config.last_sync_at, config.stock_level,
                config.batch_size, config.requests_per_second, config.handling_time_omd,
                config.provider_specific_handling_time, config.update_flag_value
            ];

            await client.query(insertQuery, values);
            console.log(`Loja ${storeId} migrada com sucesso.`);
        }

        await client.query('COMMIT');
        console.log('\nMigração concluída com sucesso!');
        console.log('Todos os dados foram movidos para a tabela "store_configurations".');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('ERRO: A migração falhou. Nenhuma alteração foi feita no banco de dados.', error);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate(); 