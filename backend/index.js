/**
 * Feed Control - Aplicação Node.js
 * 
 * Este é o ponto de entrada principal da aplicação que sincroniza dados
 * entre diferentes fornecedores e a Amazon Seller API.
 * 
 * Versão modularizada para suportar múltiplos fornecedores.
 */

require('dotenv').config();
const express = require('express');

// Debug para verificar se as variáveis de ambiente estão sendo carregadas
console.log('=== DEBUG DE VARIÁVEIS DE AMBIENTE NA INICIALIZAÇÃO ===');
console.log('VITACOST_STOCK_LEVEL:', process.env.VITACOST_STOCK_LEVEL, 
            'Tipo:', typeof process.env.VITACOST_STOCK_LEVEL, 
            'Comprimento:', process.env.VITACOST_STOCK_LEVEL ? process.env.VITACOST_STOCK_LEVEL.length : 0);
console.log('VITACOST_UPDATE_FLAG_VALUE:', process.env.VITACOST_UPDATE_FLAG_VALUE, 
            'Tipo:', typeof process.env.VITACOST_UPDATE_FLAG_VALUE, 
            'Comprimento:', process.env.VITACOST_UPDATE_FLAG_VALUE ? process.env.VITACOST_UPDATE_FLAG_VALUE.length : 0);
console.log('VITACOST_HANDLING_TIME:', process.env.VITACOST_HANDLING_TIME, 
            'Tipo:', typeof process.env.VITACOST_HANDLING_TIME, 
            'Comprimento:', process.env.VITACOST_HANDLING_TIME ? process.env.VITACOST_HANDLING_TIME.length : 0);
console.log('LEAD_TIME_OMD:', process.env.LEAD_TIME_OMD, 
            'Tipo:', typeof process.env.LEAD_TIME_OMD, 
            'Comprimento:', process.env.LEAD_TIME_OMD ? process.env.LEAD_TIME_OMD.length : 0);
console.log('=====================================================');

const { Command } = require('commander');
const path = require('path');
const fs = require('fs').promises;
const configureLogging = require('./src/config/logging');
const phase1 = require('./src/phases/phase1');
const phase2 = require('./src/phases/phase2');
const cron = require('node-cron');
const { getStoreManager } = require('./src/services/storeManager');
const { syncStoreWithProvider, runStorePhase } = require('./src/sync/sync-service');

// Configuração da aplicação
const app = express();
const PORT = process.env.PORT || 7005;
const HOST = process.env.HOST || '0.0.0.0';  // Permitir conexões de qualquer IP

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Comentando a linha que serve arquivos estáticos
// app.use(express.static(path.join(__dirname, 'public')));

// Adicionando middleware CORS para permitir solicitações do frontend React
app.use((req, res, next) => {
  // Lista de origens permitidas, dividindo a string de env por vírgula, caso seja uma lista
  const corsOriginEnv = process.env.CORS_ORIGIN || '*';
  
  // Se CORS_ORIGIN for "*", permitir todas as origens
  if (corsOriginEnv === '*') {
    res.header('Access-Control-Allow-Origin', '*');
  } else {
    // Separar a string por vírgulas e limpar espaços extras
    const configuredOrigins = corsOriginEnv.split(',').map(origin => origin.trim());
    
    const allowedOrigins = [
      ...configuredOrigins,
      'http://localhost:3000'
    ];
    
    const origin = req.headers.origin;
    
    // Verificar se a origem está na lista de origens permitidas
    if (origin && allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
    } else {
      // Para desenvolvimento, permitir qualquer origem
      res.header('Access-Control-Allow-Origin', '*');
    }
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Lidar com solicitações OPTIONS (preflight)
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// View engine (comentado, pois não vamos mais usar EJS para renderização)
// app.set('view engine', 'ejs');
// app.set('views', path.join(__dirname, 'views'));

// Armazenar tarefas agendadas para cada loja
const scheduledTasks = {};

// Armazenar sinalizadores de cancelamento para cada loja
const cancellationFlags = {};

// Armazenar informações de progresso para cada loja
const progressInfo = {};

// Variável para armazenar o cache de próximas sincronizações
// Chave: storeId, Valor: { timestamp, data }
const nextSyncCache = {};

// Garantir que o diretório de logs existe
const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdir(LOG_DIR, { recursive: true }).catch(err => console.error('Erro ao criar diretório de logs:', err));

// Configurar logger
let logger = configureLogging();
logger.info("Starting Feed Control application.");

// Parsing de argumentos de linha de comando
function parseArguments() {
  const program = new Command();
  
  program
    .option('-p, --phase <number>', 'Phase to run (1, 2 or all)', 'all')
    .option('-d, --debug', 'Enable debug mode', false)
    .option('-c, --cron', 'Run in cron mode', false)
    .option('-r, --rate <number>', 'API requests per second', '7')
    .option('-b, --batch <number>', 'Batch size for Phase 2', '9990')
    .option('-s, --skip-problematic', 'Skip problematic products', false)
    .option('-w, --web', 'Run web server', false)
    .option('-f, --provider <string>', 'Provider to use (default: homedepot)', 'homedepot');
  
  program.parse(process.argv);
  
  return program.opts();
}

/**
 * Executar a sincronização para uma loja específica
 * @param {string} storeId - ID da loja
 * @returns {Promise<boolean>} - true se a sincronização foi bem-sucedida
 */
async function syncStore(storeId) {
  // Implementação atualizada para usar a arquitetura de provedores
  try {
    const storeManager = await getStoreManager();
    const store = storeManager.getStoreById(storeId);
    
    if (!store) {
      logger.error(`Store with ID ${storeId} not found`);
      return false;
    }
    
    // Armazenar o intervalo de agendamento original antes de iniciar a sincronização
    // Isso garante que usaremos o valor correto ao reagendar
    const originalScheduleInterval = store.scheduleInterval || 4;
    logger.info(`Armazenando intervalo original de agendamento para ${storeId}: ${originalScheduleInterval} horas`);
    
    // Limpar qualquer sinalizador de cancelamento anterior
    cancellationFlags[storeId] = false;
    
    // Inicializar ou reiniciar informações de progresso
    progressInfo[storeId] = {
      totalProducts: 0,
      processedProducts: 0,
      successCount: 0,
      failCount: 0,
      percentage: 0,
      isRunning: true,
      currentBatch: 0,
      totalBatches: 0,
      errors: [],
      lastUpdateTime: new Date().toISOString(),
      originalScheduleInterval: originalScheduleInterval // Armazenar para uso posterior
    };
    
    // Função de verificação de cancelamento
    const checkCancellation = () => cancellationFlags[storeId];
    
    // Função de atualização de progresso
    const updateProgress = (progress) => {
      if (progress && typeof progress === 'object') {
        // Mesclar as informações de progresso
        progressInfo[storeId] = {
          ...progressInfo[storeId],
          ...progress,
          lastUpdateTime: new Date().toISOString()
        };
      }
    };
    
    // Usar o novo sistema de provedores
    const result = await syncStoreWithProvider(
      storeId,
      false, // skipProblematic
      parseInt(process.env.REQUESTS_PER_SECOND) || 7,
      parseInt(process.env.BATCH_SIZE) || 9990,
      checkCancellation,
      updateProgress
    );
    
    // Atualizar status da loja
    if (result) {
      await storeManager.updateStoreStatus(storeId, 'Inativo');
      
      // Atualizar a data da última sincronização no banco de dados
      try {
        // Importar biblioteca pg e configuração
        const { Pool } = require('pg');
        const { DB_CONFIG } = require('./src/config/db');
        const pool = new Pool(DB_CONFIG);
        
        try {
          // Verificar se existe um registro para esta loja na tabela sync_schedule
          const checkResult = await pool.query(
            'SELECT COUNT(*) FROM sync_schedule WHERE store_id = $1',
            [storeId]
          );
          
          // Correção específica para Best Buy - FORÇAR intervalo de 4 horas
          // e fazer GARANTIA DUPLA de que o valor nunca muda
          if (storeId === 'bestbuy') {
            let currentInterval = progressInfo[storeId]?.originalScheduleInterval || store.scheduleInterval || 4;
            logger.info(`USANDO INTERVALO PARA BEST BUY: ${currentInterval} horas`);
            
            // DIAGNÓSTICO: Verificar qual é o intervalo atual no banco
            const diagnosisResult = await pool.query(
              'SELECT interval_hours FROM sync_schedule WHERE store_id = $1',
              ['bestbuy']
            );
            
            if (diagnosisResult.rows && diagnosisResult.rows.length > 0) {
              const currentInterval = diagnosisResult.rows[0].interval_hours;
              logger.info(`⚠️ DIAGNÓSTICO: Intervalo atual para Best Buy no banco é ${currentInterval} horas antes da atualização`);
              
              if (false) {
                logger.warn(`⚠️ ALERTA: O intervalo de Best Buy (${currentInterval}h) foi atualizado`);
              }
            }
            
            if (checkResult.rows[0].count > 0) {
              // Atualizar o registro existente com intervalo FIXO de 4 horas
              await pool.query(
                'UPDATE sync_schedule SET last_sync_at = CURRENT_TIMESTAMP, interval_hours = interval_hours, updated_at = NOW() WHERE store_id = $1 RETURNING last_sync_at, interval_hours',
                ['bestbuy']
              ).then(result => {
                if (result.rows && result.rows.length > 0) {
                  const lastSyncAt = result.rows[0].last_sync_at;
                  const intervalHours = result.rows[0].interval_hours;
                  logger.info(`GARANTIA DUPLA: Updated lastSync for Best Buy: ${new Date(lastSyncAt).toISOString()} com intervalo=${intervalHours} horas`);
                }
              });
              
              // GARANTIA TRIPLA: Executar uma segunda query para confirmar o valor
              await pool.query(
                'UPDATE sync_schedule SET interval_hours = interval_hours WHERE store_id = $1 RETURNING interval_hours',
                ['bestbuy']
              ).then(result => {
                if (result.rows && result.rows.length > 0) {
                  logger.info(`GARANTIA TRIPLA: Confirmado intervalo para Best Buy: ${result.rows[0].interval_hours} horas`);
                }
              });
              
              // DIAGNÓSTICO FINAL: Verificar qual é o intervalo após todas as atualizações
              const finalResult = await pool.query(
                'SELECT interval_hours FROM sync_schedule WHERE store_id = $1',
                ['bestbuy']
              );
              
              if (finalResult.rows && finalResult.rows.length > 0) {
                const finalInterval = finalResult.rows[0].interval_hours;
                logger.info(`✅ DIAGNÓSTICO FINAL: Intervalo para Best Buy no banco é ${finalInterval} horas após atualizações`);
              }
            } else {
              // Inserir um novo registro com intervalo FIXO de 4 horas
              await pool.query(
                'INSERT INTO sync_schedule (store_id, interval_hours, last_sync_at, is_active, created_at, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP, true, NOW(), NOW()) RETURNING last_sync_at, interval_hours',
                ['bestbuy', currentInterval]
              ).then(result => {
                if (result.rows && result.rows.length > 0) {
                  const lastSyncAt = result.rows[0].last_sync_at;
                  const intervalHours = result.rows[0].interval_hours;
                  logger.info(`GARANTIA DUPLA: Created new Best Buy record with lastSync=${new Date(lastSyncAt).toISOString()} e intervalo=${intervalHours} horas`);
                }
              });
            }
            
            // Forçar a atualização na loja
            await storeManager.updateStore('bestbuy', { scheduleInterval: currentInterval });
            logger.info(`GARANTIA DUPLA: Forçado update do scheduleInterval para ${currentInterval} na instância da loja`);
          } else {
            // Para outras lojas que não são Best Buy
            let storeInterval = progressInfo[storeId]?.originalScheduleInterval || store.scheduleInterval || 4;
            
            logger.info(`Usando intervalo fixo de ${storeInterval} horas para ${storeId} ao atualizar o banco de dados`);
            
            if (checkResult.rows[0].count > 0) {
              // Atualizar a coluna last_sync_at na tabela sync_schedule
              // Usar CURRENT_TIMESTAMP para garantir que o timestamp seja gerado pelo banco de dados
              // Também atualizar o intervalo_hours com o valor correto para garantir consistência
              await pool.query(
                'UPDATE sync_schedule SET last_sync_at = CURRENT_TIMESTAMP, interval_hours = $2 WHERE store_id = $1 RETURNING last_sync_at, interval_hours',
                [storeId, storeInterval]
              ).then(result => {
                if (result.rows && result.rows.length > 0) {
                  const lastSyncAt = result.rows[0].last_sync_at;
                  const intervalHours = result.rows[0].interval_hours;
                  logger.info(`Updated lastSync for store ${storeId}: ${new Date(lastSyncAt).toISOString()} com intervalo=${intervalHours} horas`);
                }
              });
            } else {
              // Inserir um novo registro se não existir
              // Usar CURRENT_TIMESTAMP para garantir que o timestamp seja gerado pelo banco de dados
              await pool.query(
                'INSERT INTO sync_schedule (store_id, interval_hours, last_sync_at, is_active) VALUES ($1, $2, CURRENT_TIMESTAMP, true) RETURNING last_sync_at, interval_hours',
                [storeId, storeInterval]
              ).then(result => {
                if (result.rows && result.rows.length > 0) {
                  const lastSyncAt = result.rows[0].last_sync_at;
                  const intervalHours = result.rows[0].interval_hours;
                  logger.info(`Created new sync_schedule record for store ${storeId} with lastSync=${new Date(lastSyncAt).toISOString()} e intervalo=${intervalHours} horas`);
                }
              });
            }
          }
        } finally {
          // Fechar o pool de conexões
          await pool.end();
        }
      } catch (error) {
        logger.error(`Error updating last_sync_at for store ${storeId}: ${error.message}`, { error });
      }
      
      // Limpar o cache do próximo agendamento para forçar recálculo
      delete nextSyncCache[storeId];
    } else {
      await storeManager.updateStoreStatus(storeId, cancellationFlags[storeId] ? 'Interrompido' : 'Erro');
    }
    
    // Atualizar informações de progresso
    progressInfo[storeId].isRunning = false;
    
    return result;
  } catch (error) {
    logger.error(`Error in syncStore: ${error.message}`, { error });
    return false;
  }
}

/**
 * Agendar sincronização para uma loja
 * @param {string} storeId - ID da loja
 * @param {number} interval - Intervalo em horas
 */
async function scheduleSync(storeId, interval) {
  try {
    // Cancelar agendamento existente
    cancelScheduledSync(storeId);
    
    // Criar novo agendamento
    // Calcular o próximo horário de execução com base na última sincronização
    let nextRunTime;
    
    // Obter a última sincronização do banco de dados
    const { Pool } = require('pg');
    const { DB_CONFIG } = require('./src/config/db');
    const pool = new Pool(DB_CONFIG);
    
    try {
      // Atualizar o intervalo no banco de dados ANTES de configurar o próximo agendamento
      // Verificar se já existe um registro para esta loja
      const checkResult = await pool.query(
        'SELECT * FROM sync_schedule WHERE store_id = $1',
        [storeId]
      );
      
      if (checkResult.rows.length > 0) {
        // Atualizar o registro existente com o novo intervalo
        await pool.query(
          'UPDATE sync_schedule SET is_active = true, interval_hours = $1, updated_at = NOW() WHERE store_id = $2 RETURNING interval_hours',
          [interval, storeId]
        );
        logger.info(`Atualizado intervalo de agendamento no banco para ${storeId}: ${interval} horas`);
      } else {
        // Criar um novo registro com o intervalo fornecido
        await pool.query(
          'INSERT INTO sync_schedule (store_id, is_active, interval_hours, created_at, updated_at) VALUES ($1, true, $2, NOW(), NOW())',
          [storeId, interval]
        );
        logger.info(`Criado novo registro de agendamento para ${storeId} com intervalo de ${interval} horas`);
      }
      
      // Agora obter a última sincronização para calcular o próximo agendamento
      const result = await pool.query('SELECT last_sync_at FROM sync_schedule WHERE store_id = $1', [storeId]);
      
      const now = new Date();
      
      if (result.rows && result.rows.length > 0 && result.rows[0].last_sync_at) {
        const lastSync = new Date(result.rows[0].last_sync_at);
        nextRunTime = new Date(lastSync.getTime() + interval * 60 * 60 * 1000);
        
        // Se a próxima execução já passou, calcular a próxima ocorrência a partir de agora
        if (nextRunTime < now) {
          const elapsedTime = now.getTime() - lastSync.getTime();
          const elapsedIntervals = Math.floor(elapsedTime / (interval * 60 * 60 * 1000));
          nextRunTime = new Date(lastSync.getTime() + (elapsedIntervals + 1) * interval * 60 * 60 * 1000);
        }
      } else {
        // Se não houver registro de última sincronização, agendar para daqui a ${interval} horas
        nextRunTime = new Date(now.getTime() + interval * 60 * 60 * 1000);
        logger.info(`No previous sync found. Scheduling first synchronization for store ${storeId} with interval ${interval} hours. Next run at ${nextRunTime.toISOString()}`);
      }
      
      // Calcular o atraso em milissegundos
      const delay = nextRunTime.getTime() - now.getTime();
      
      logger.info(`Scheduling synchronization for store ${storeId} with interval ${interval} hours. Next run at ${nextRunTime.toISOString()}`);
      
      // Agendar a próxima execução
      scheduledTasks[storeId] = setTimeout(async () => {
        try {
          await syncStore(storeId);
          // Reagendar após a conclusão usando o mesmo intervalo
          logger.info(`Rescheduling sync for ${storeId} with interval ${interval} hours`);
          scheduleSync(storeId, interval);
        } catch (error) {
          logger.error(`Error in scheduled sync for ${storeId}: ${error.message}`, { error });
          // Reagendar mesmo em caso de erro
          scheduleSync(storeId, interval);
        }
      }, delay);
      
      // Atualizar o intervalo na loja
      updateStoreInterval(storeId, interval);
      
    } finally {
      // Garantir que o pool seja fechado, independentemente do resultado
      await pool.end();
    }
  } catch (error) {
    logger.error(`Error in scheduleSync for ${storeId}: ${error.message}`, { error });
    
    // Em caso de erro, tentar agendar para daqui a ${interval} horas
    const now = new Date();
    const nextRunTime = new Date(now.getTime() + interval * 60 * 60 * 1000);
    
    logger.info(`Error in scheduling. Attempting fallback scheduling for store ${storeId} with interval ${interval} hours. Next run at ${nextRunTime.toISOString()}`);
    
    // Agendar a próxima execução como fallback
    scheduledTasks[storeId] = setTimeout(async () => {
      try {
        await syncStore(storeId);
        // Reagendar após a conclusão
        scheduleSync(storeId, interval);
      } catch (syncError) {
        logger.error(`Error in fallback scheduled sync for ${storeId}: ${syncError.message}`, { error: syncError });
        // Reagendar mesmo em caso de erro
        scheduleSync(storeId, interval);
      }
    }, interval * 60 * 60 * 1000);
  }
}

/**
 * Atualizar o intervalo de agendamento de uma loja
 * @param {string} storeId - ID da loja
 * @param {number} interval - Intervalo em horas
 */
function updateStoreInterval(storeId, interval) {
  try {
    // Atualizar o intervalo na lista de lojas padrão
    const { defaultStores } = require('./src/models/Store');
    const store = defaultStores.find(s => s.id === storeId);
    if (store) {
      store.scheduleInterval = interval;
      logger.info(`Updated schedule interval for store ${storeId} to ${interval} hours`);
    }
    
    // Se o storeManager estiver disponível, atualizar também
    if (global.storeManager && global.storeManager.stores) {
      const storeInManager = global.storeManager.stores.find(s => s.id === storeId);
      if (storeInManager) {
        storeInManager.scheduleInterval = interval;
        logger.info(`Updated schedule interval in storeManager for store ${storeId} to ${interval} hours`);
      }
    }
  } catch (error) {
    logger.error(`Error updating store interval: ${error.message}`, { error });
  }
}

/**
 * Cancelar sincronização agendada para uma loja
 * @param {string} storeId - ID da loja
 */
function cancelScheduledSync(storeId) {
  if (scheduledTasks[storeId]) {
    logger.info(`Cancelling scheduled synchronization for store ${storeId}`);
    clearTimeout(scheduledTasks[storeId]);
    delete scheduledTasks[storeId];
    
    // Salvar o estado do agendamento no banco de dados
    saveScheduleState(storeId, false).catch(error => {
      logger.error(`Error saving schedule state for ${storeId}: ${error.message}`, { error });
    });
  }
}

/**
 * Salvar o estado do agendamento no banco de dados
 * @param {string} storeId - ID da loja
 * @param {boolean} isActive - Se o agendamento está ativo
 * @param {number} [interval] - Intervalo em horas (opcional)
 */
async function saveScheduleState(storeId, isActive, interval) {
  // Criar um único pool de conexão para esta operação
  const { Pool } = require('pg');
  const { DB_CONFIG } = require('./src/config/db');
  const pool = new Pool(DB_CONFIG);
  
  try {
    // Verificar se já existe um registro para esta loja
    const checkResult = await pool.query(
      'SELECT * FROM sync_schedule WHERE store_id = $1',
      [storeId]
    );
    
    if (checkResult.rows.length > 0) {
      // Se o intervalo foi fornecido, usar esse valor, caso contrário manter o valor atual
      const newInterval = interval !== undefined ? interval : checkResult.rows[0].interval_hours;
      
      // Atualizar o registro existente
      await pool.query(
        'UPDATE sync_schedule SET is_active = $1, interval_hours = $2, updated_at = NOW() WHERE store_id = $3',
        [isActive, newInterval, storeId]
      );
      
      logger.info(`Updated schedule for store ${storeId}: active=${isActive}, interval=${newInterval} hours`);
    } else if (isActive) {
      // Criar um novo registro apenas se estiver ativando o agendamento
      const newInterval = interval !== undefined ? interval : 4; // Valor padrão
      
      await pool.query(
        'INSERT INTO sync_schedule (store_id, is_active, interval_hours, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())',
        [storeId, isActive, newInterval]
      );
      
      logger.info(`Created schedule for store ${storeId}: active=${isActive}, interval=${newInterval} hours`);
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in saveScheduleState: ${error.message}`, { error });
    throw error;
  } finally {
    // Garantir que o pool seja sempre fechado, independentemente do resultado
    try {
      await pool.end();
    } catch (closeError) {
      logger.error(`Error closing database pool in saveScheduleState: ${closeError.message}`);
    }
  }
}

/**
 * Restaurar agendamentos salvos do banco de dados
 */
async function restoreScheduledTasks() {
  logger.info('Restoring scheduled tasks from database...');
  
  // Criar um único pool de conexão para esta operação
  const { Pool } = require('pg');
  const { DB_CONFIG } = require('./src/config/db');
  const pool = new Pool(DB_CONFIG);
  
  try {
    // Buscar todos os agendamentos ativos
    const result = await pool.query(
      'SELECT store_id, interval_hours, last_sync_at FROM sync_schedule WHERE is_active = true'
    );
    
    if (result.rows && result.rows.length > 0) {
      logger.info(`Found ${result.rows.length} active schedules to restore`);
      
      // Restaurar cada agendamento
      for (const row of result.rows) {
        const storeId = row.store_id;
        const interval = row.interval_hours || 4; // Valor padrão
        const lastSyncAt = row.last_sync_at;
        
        // Cancelar agendamento existente
        if (scheduledTasks[storeId]) {
          clearTimeout(scheduledTasks[storeId]);
          delete scheduledTasks[storeId];
        }
        
        // Calcular o próximo horário de execução
        const now = new Date();
        let nextRunTime;
        
        if (lastSyncAt) {
          const lastSync = new Date(lastSyncAt);
          nextRunTime = new Date(lastSync.getTime() + interval * 60 * 60 * 1000);
          
          // Se a próxima execução já passou, calcular a próxima ocorrência a partir de agora
          if (nextRunTime < now) {
            const elapsedTime = now.getTime() - lastSync.getTime();
            const elapsedIntervals = Math.floor(elapsedTime / (interval * 60 * 60 * 1000));
            nextRunTime = new Date(lastSync.getTime() + (elapsedIntervals + 1) * interval * 60 * 60 * 1000);
          }
        } else {
          // Se não houver registro de última sincronização, agendar para daqui a ${interval} horas
          nextRunTime = new Date(now.getTime() + interval * 60 * 60 * 1000);
        }
        
        // Calcular o atraso em milissegundos
        const delay = nextRunTime.getTime() - now.getTime();
        
        logger.info(`Restoring schedule for store ${storeId} with interval ${interval} hours. Next run at ${nextRunTime.toISOString()}`);
        
        // Agendar a próxima execução usando uma função assíncrona
        scheduledTasks[storeId] = setTimeout(async () => {
          try {
            await syncStore(storeId);
            // Reagendar após a conclusão usando o mesmo intervalo
            // Consultar o intervalo atual no banco de dados para garantir consistência
            const { Pool } = require('pg');
            const { DB_CONFIG } = require('./src/config/db');
            const dbPool = new Pool(DB_CONFIG);
            
            try {
              const intervalResult = await dbPool.query(
                'SELECT interval_hours FROM sync_schedule WHERE store_id = $1',
                [storeId]
              );
              
              const currentInterval = intervalResult.rows && intervalResult.rows.length > 0 && intervalResult.rows[0].interval_hours
                ? Number(intervalResult.rows[0].interval_hours)
                : interval;
                
              logger.info(`Rescheduling sync for ${storeId} with interval ${currentInterval} hours from database`);
              await scheduleSync(storeId, currentInterval);
            } catch (dbError) {
              logger.error(`Error getting interval from database: ${dbError.message}`, { error: dbError });
              // Em caso de erro, usar o intervalo original
              await scheduleSync(storeId, interval);
            } finally {
              await dbPool.end();
            }
          } catch (error) {
            logger.error(`Error in scheduled sync for ${storeId}: ${error.message}`, { error });
            // Reagendar mesmo em caso de erro
            await scheduleSync(storeId, interval);
          }
        }, delay);
        
        // Atualizar o intervalo na loja
        updateStoreInterval(storeId, interval);
        
        // Registrar no log que o agendamento foi restaurado
        logger.info(`Successfully restored schedule for store ${storeId}`);
      }
    } else {
      logger.info('No active schedules found in database');
    }
    
    return true;
  } catch (error) {
    logger.error(`Error restoring scheduled tasks: ${error.message}`, { error });
    return false;
  } finally {
    // Garantir que o pool seja sempre fechado, independentemente do resultado
    try {
      await pool.end();
      logger.info('Database connection closed after restoring scheduled tasks');
    } catch (closeError) {
      logger.error(`Error closing database pool in restoreScheduledTasks: ${closeError.message}`);
    }
  }
}

// Rotas para o dashboard web - COMENTADAS para desabilitar o dashboard antigo

// Página inicial - lista de lojas
/* app.get('/', async (req, res) => {
  try {
    const storeManager = await getStoreManager();
    const stores = storeManager.getAllStores();
    res.render('index', { stores });
  } catch (error) {
    logger.error(`Error rendering dashboard: ${error.message}`, { error });
    res.status(500).send('Erro ao carregar o dashboard');
  }
}); */

// Página de controle de uma loja específica
/* app.get('/store/:storeId', async (req, res) => {
  try {
    const storeManager = await getStoreManager();
    const store = storeManager.getStoreById(req.params.storeId);
    
    if (!store) {
      return res.status(404).send('Loja não encontrada');
    }
    
    res.render('store', { store });
  } catch (error) {
    logger.error(`Error rendering store control: ${error.message}`, { error });
    res.status(500).send('Erro ao carregar o controle da loja');
  }
}); */

// Redirecionando a rota raiz para a API
app.get('/', (req, res) => {
  res.json({
    message: 'Home Depot Sync API Server',
    endpoints: {
      stores: '/api/stores',
      storeDetails: '/api/stores/:storeId',
      startSync: '/api/stores/:storeId/sync',
      stopSync: '/api/stores/:storeId/sync/stop',
      scheduleSync: '/api/stores/:storeId/schedule',
      cancelSchedule: '/api/stores/:storeId/schedule/cancel',
      logs: '/api/stores/:storeId/logs',
      progress: '/api/stores/:storeId/progress'
    }
  });
});

// API para gerenciar lojas

// Listar lojas
app.get('/api/stores', async (req, res) => {
  try {
    const storeManager = await getStoreManager();
    const stores = storeManager.getAllStores();
    res.json(stores);
  } catch (error) {
    logger.error(`Error listing stores: ${error.message}`, { error });
    res.status(500).json({ message: error.message });
  }
});

// Adicionar nova loja
app.post('/api/stores', async (req, res) => {
  try {
    const { id, name, apiBaseUrl, scheduleInterval } = req.body;
    
    if (!id || !name || !apiBaseUrl) {
      return res.status(400).json({ message: 'ID, nome e URL da API são obrigatórios' });
    }
    
    const storeManager = await getStoreManager();
    
    // Verificar se já existe uma loja com este ID
    if (storeManager.getStoreById(id)) {
      return res.status(400).json({ message: 'Já existe uma loja com este ID' });
    }
    
    // Criar nova loja
    const { Store } = require('./src/models/Store');
    const store = new Store(
      id,
      name,
      apiBaseUrl,
      'Inativo',
      scheduleInterval || 4
    );
    
    await storeManager.addStore(store);
    res.status(201).json(store);
  } catch (error) {
    logger.error(`Error adding store: ${error.message}`, { error });
    res.status(500).json({ message: error.message });
  }
});

// Atualizar configurações de uma loja
app.post('/api/stores/:storeId/config', async (req, res) => {
  const { storeId } = req.params;
  const { 
    stockLevel, 
    batchSize, 
    requestsPerSecond, 
    handlingTimeOmd, 
    homeDepotHandlingTime, 
    whiteCapHandlingTime, 
    vitacostHandlingTime,
    bestbuyHandlingTime,
    webstaurantstoreHandlingTime,
    updateFlagValue
  } = req.body;
  
  // Validar que os valores são números válidos
  const validParams = ['stockLevel', 'batchSize', 'requestsPerSecond', 'handlingTimeOmd', 'updateFlagValue'];
  const providerParams = {
    'homedepot': 'homeDepotHandlingTime',
    'whitecap': 'whiteCapHandlingTime',
    'vitacost': 'vitacostHandlingTime',
    'bestbuy': 'bestbuyHandlingTime',
    'webstaurantstore': 'webstaurantstoreHandlingTime'
  };
  
  // Verificar parâmetros gerais
  for (const param of validParams) {
    if (req.body[param] !== undefined && isNaN(req.body[param])) {
      return res.status(400).json({
        message: `O valor de ${param} deve ser um número válido`
      });
    }
  }
  
  // Verificar o parâmetro específico do provider
  const providerParam = providerParams[storeId];
  if (providerParam && req.body[providerParam] !== undefined && isNaN(req.body[providerParam])) {
    return res.status(400).json({
      message: `O valor de ${providerParam} deve ser um número válido`
    });
  }
  
  // Verificar se a loja existe
  const storeManager = await getStoreManager();
  const store = storeManager.getStoreById(storeId);
  
  if (!store) {
    return res.status(404).json({ message: 'Loja não encontrada' });
  }
  
  // Determinar o arquivo .env correto baseado no ambiente
  const isProduction = process.env.NODE_ENV === 'production';
  const envFileName = isProduction ? '.env.production' : '.env';
  const envFilePath = path.join(__dirname, envFileName);
  
  logger.info(`Atualizando configurações no arquivo ${envFileName} para o provider ${storeId}`);
  
  try {
    // Ler o arquivo .env existente
    const fs = require('fs');
    const dotenv = require('dotenv');
    
    let envData = '';
    try {
      envData = fs.readFileSync(envFilePath, 'utf8');
    } catch (readError) {
      // Se o arquivo não existir, criar um novo
      if (readError.code === 'ENOENT') {
        envData = '';
        logger.warn(`Arquivo ${envFileName} não encontrado. Criando novo arquivo.`);
      } else {
        throw readError;
      }
    }
    
    // Parse o conteúdo atual do arquivo .env
    const envConfig = dotenv.parse(envData);
    
    // Salvar configurações específicas da loja (formato padrão)
    const storePrefix = storeId.toUpperCase().replace(/-/g, '_');
    
    // Atualizar apenas os valores que foram fornecidos na requisição
    if (stockLevel !== undefined) {
      envConfig[`${storePrefix}_STOCK_LEVEL`] = stockLevel.toString();
    }
    
    if (batchSize !== undefined) {
      envConfig[`${storePrefix}_BATCH_SIZE`] = batchSize.toString();
    }
    
    if (requestsPerSecond !== undefined) {
      envConfig[`${storePrefix}_REQUESTS_PER_SECOND`] = requestsPerSecond.toString();
    }
    
    if (handlingTimeOmd !== undefined) {
      envConfig[`${storePrefix}_HANDLING_TIME_OMD`] = handlingTimeOmd.toString();
      // Manter LEAD_TIME_OMD apenas para compatibilidade com código existente
      envConfig.LEAD_TIME_OMD = handlingTimeOmd.toString();
    }
    
    if (updateFlagValue !== undefined) {
      envConfig[`${storePrefix}_UPDATE_FLAG_VALUE`] = updateFlagValue.toString();
    }
    
    // Adicionar campos específicos para cada fornecedor
    if (storeId === 'homedepot' && homeDepotHandlingTime !== undefined) {
      envConfig.HOMEDEPOT_HANDLING_TIME = homeDepotHandlingTime.toString();
    } else if (storeId === 'whitecap' && whiteCapHandlingTime !== undefined) {
      envConfig.WHITECAP_HANDLING_TIME = whiteCapHandlingTime.toString();
    } else if (storeId === 'vitacost' && vitacostHandlingTime !== undefined) {
      envConfig.VITACOST_HANDLING_TIME = vitacostHandlingTime.toString();
    } else if (storeId === 'bestbuy' && bestbuyHandlingTime !== undefined) {
      envConfig.BESTBUY_HANDLING_TIME = bestbuyHandlingTime.toString();
    } else if (storeId === 'webstaurantstore' && webstaurantstoreHandlingTime !== undefined) {
      envConfig.WEBSTAURANTSTORE_HANDLING_TIME = webstaurantstoreHandlingTime.toString();
    }
    
    // Converter o objeto de volta para o formato de arquivo .env
    const newEnvContent = Object.entries(envConfig)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    
    // Garantir que o arquivo seja escrito de forma síncrona
    fs.writeFileSync(envFilePath, newEnvContent);
    logger.info(`Configurações atualizadas com sucesso no arquivo ${envFileName}`);
    
    // Recarregar as configurações no processo atual
    Object.keys(envConfig).forEach(key => {
      process.env[key] = envConfig[key];
    });
    
    // Forçar a recarga das configurações em todo o sistema
    try {
      // Recarregar o módulo dotenv para atualizar as variáveis de ambiente
      delete require.cache[require.resolve('dotenv')];
      require('dotenv').config({ path: envFilePath });
      
      // Recarregar os módulos que dependem das variáveis de ambiente
      Object.keys(require.cache).forEach(key => {
        if (key.includes('/src/providers/') || key.includes('/src/services/')) {
          delete require.cache[key];
        }
      });
      
      logger.info(`Módulos de provider recarregados com sucesso para ${storeId}`);
    } catch (reloadError) {
      logger.error(`Erro ao recarregar módulos: ${reloadError.message}`, { error: reloadError });
    }
    
    // Log das alterações feitas
    const changes = [];
    if (stockLevel !== undefined) changes.push(`Stock Level: ${stockLevel}`);
    if (handlingTimeOmd !== undefined) changes.push(`Handling Time OMD: ${handlingTimeOmd}`);
    if (batchSize !== undefined) changes.push(`Batch Size: ${batchSize}`);
    if (requestsPerSecond !== undefined) changes.push(`Requests Per Second: ${requestsPerSecond}`);
    if (updateFlagValue !== undefined) changes.push(`Update Flag Value: ${updateFlagValue}`);
    
    // Adicionar configuração específica do fornecedor
    if (storeId === 'homedepot' && homeDepotHandlingTime !== undefined) {
      changes.push(`Home Depot Handling Time: ${homeDepotHandlingTime}`);
    } else if (storeId === 'whitecap' && whiteCapHandlingTime !== undefined) {
      changes.push(`White Cap Handling Time: ${whiteCapHandlingTime}`);
    } else if (storeId === 'vitacost' && vitacostHandlingTime !== undefined) {
      changes.push(`Vitacost Handling Time: ${vitacostHandlingTime}`);
    } else if (storeId === 'bestbuy' && bestbuyHandlingTime !== undefined) {
      changes.push(`Best Buy Handling Time: ${bestbuyHandlingTime}`);
    } else if (storeId === 'webstaurantstore' && webstaurantstoreHandlingTime !== undefined) {
      changes.push(`Webstaurantstore Handling Time: ${webstaurantstoreHandlingTime}`);
    }
    
    logger.info(`Updated configuration for store ${storeId}: ${changes.join(', ')}`);
    
    return res.json({
      message: 'Configurações atualizadas com sucesso',
      storeId,
      changes
    });
  } catch (error) {
    logger.error(`Error updating configuration: ${error.message}`);
    return res.status(500).json({
      message: 'Erro ao atualizar configurações',
      error: error.message
    });
  }
});

// Iniciar sincronização para uma loja
app.post('/api/stores/:storeId/sync', async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const storeManager = await getStoreManager();
    
    if (!storeManager.getStoreById(storeId)) {
      return res.status(404).json({ message: 'Loja não encontrada' });
    }
    
    // Iniciar sincronização assíncrona
    syncStore(storeId).catch(error => {
      logger.error(`Error in manual sync for ${storeId}: ${error.message}`, { error });
    });
    
    res.json({ message: 'Sincronização iniciada' });
  } catch (error) {
    logger.error(`Error starting sync: ${error.message}`, { error });
    res.status(500).json({ message: error.message });
  }
});

// Parar sincronização para uma loja (agora realmente interrompe o processo)
app.post('/api/stores/:storeId/sync/stop', async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const storeManager = await getStoreManager();
    
    if (!storeManager.getStoreById(storeId)) {
      return res.status(404).json({ message: 'Loja não encontrada' });
    }
    
    // Definir o sinalizador de cancelamento para esta loja
    cancellationFlags[storeId] = true;
    logger.info(`Cancellation request received for store ${storeId}`);
    
    // Atualizar status
    await storeManager.updateStoreStatus(storeId, 'Interrompendo');
    
    res.json({ message: 'Solicitação de interrupção enviada. A sincronização será interrompida assim que possível.' });
  } catch (error) {
    logger.error(`Error stopping sync: ${error.message}`, { error });
    res.status(500).json({ message: error.message });
  }
});

// Rota para executar apenas a Phase 1 para uma loja
app.post('/api/stores/:storeId/sync/phase1', async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const storeManager = await getStoreManager();
    
    if (!storeManager.getStoreById(storeId)) {
      return res.status(404).json({ message: 'Loja não encontrada' });
    }
    
    // Criar função de verificação de cancelamento
    cancellationFlags[storeId] = false;
    const checkCancellation = () => cancellationFlags[storeId] === true;
    
    // Criar função para atualizar progresso
    progressInfo[storeId] = {
      isRunning: true,
      phase: 1,
      totalProducts: 0,
      processedProducts: 0,
      successCount: 0,
      failCount: 0,
      percentage: 0,
      startTime: new Date().toISOString()
    };
    
    const updateProgress = (info) => {
      progressInfo[storeId] = {
        ...progressInfo[storeId],
        ...info,
        isRunning: true,
        phase: 1,
        lastUpdate: new Date().toISOString()
      };
    };
    
    // Iniciar phase1 assíncrona
    runStorePhase(
      storeId,
      1, // Fase 1
      false, // skipProblematic
      parseInt(process.env.REQUESTS_PER_SECOND || '7', 10),
      parseInt(process.env.BATCH_SIZE || '9990', 10),
      checkCancellation,
      updateProgress
    ).then(result => {
      logger.info(`Phase 1 completed for ${storeId} with result: ${result}`);
      progressInfo[storeId].isRunning = false;
    }).catch(error => {
      logger.error(`Error in Phase 1 for ${storeId}: ${error.message}`, { error });
      progressInfo[storeId].isRunning = false;
      progressInfo[storeId].error = error.message;
    });
    
    res.json({ message: 'Phase 1 iniciada' });
  } catch (error) {
    logger.error(`Error starting Phase 1: ${error.message}`, { error });
    res.status(500).json({ message: error.message });
  }
});

// Rota para executar apenas a Phase 2 para uma loja
app.post('/api/stores/:storeId/sync/phase2', async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const storeManager = await getStoreManager();
    
    if (!storeManager.getStoreById(storeId)) {
      return res.status(404).json({ message: 'Loja não encontrada' });
    }
    
    // Criar função de verificação de cancelamento
    cancellationFlags[storeId] = false;
    const checkCancellation = () => cancellationFlags[storeId] === true;
    
    // Criar função para atualizar progresso
    progressInfo[storeId] = {
      isRunning: true,
      phase: 2,
      totalProducts: 0,
      processedProducts: 0,
      successCount: 0,
      failCount: 0,
      percentage: 0,
      startTime: new Date().toISOString()
    };
    
    const updateProgress = (info) => {
      progressInfo[storeId] = {
        ...progressInfo[storeId],
        ...info,
        isRunning: true,
        phase: 2,
        lastUpdate: new Date().toISOString()
      };
    };
    
    // Iniciar phase2 assíncrona
    runStorePhase(
      storeId,
      2, // Fase 2
      false, // skipProblematic
      parseInt(process.env.REQUESTS_PER_SECOND || '7', 10),
      parseInt(process.env.BATCH_SIZE || '9990', 10),
      checkCancellation,
      updateProgress
    ).then(result => {
      logger.info(`Phase 2 completed for ${storeId} with result: ${result}`);
      progressInfo[storeId].isRunning = false;
    }).catch(error => {
      logger.error(`Error in Phase 2 for ${storeId}: ${error.message}`, { error });
      progressInfo[storeId].isRunning = false;
      progressInfo[storeId].error = error.message;
    });
    
    res.json({ message: 'Phase 2 iniciada' });
  } catch (error) {
    logger.error(`Error starting Phase 2: ${error.message}`, { error });
    res.status(500).json({ message: error.message });
  }
});

// Agendar sincronização para uma loja
app.post('/api/stores/:storeId/schedule', async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const interval = parseInt(req.body.interval);
    
    if (isNaN(interval) || interval < 1) {
      return res.status(400).json({ message: 'Intervalo inválido' });
    }
    
    const storeManager = await getStoreManager();
    const store = storeManager.getStoreById(storeId);
    
    if (!store) {
      return res.status(404).json({ message: 'Loja não encontrada' });
    }
    
    // Atualizar intervalo de agendamento na loja
    await storeManager.updateStore(storeId, { scheduleInterval: interval });
    
    // Agendar sincronização
    scheduleSync(storeId, interval);
    
    res.json({ message: `Sincronização agendada a cada ${interval} horas` });
  } catch (error) {
    logger.error(`Error scheduling sync: ${error.message}`, { error });
    res.status(500).json({ message: error.message });
  }
});

// Cancelar agendamento para uma loja
app.post('/api/stores/:storeId/schedule/cancel', async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const storeManager = await getStoreManager();
    
    if (!storeManager.getStoreById(storeId)) {
      return res.status(404).json({ message: 'Loja não encontrada' });
    }
    
    // Cancelar agendamento
    cancelScheduledSync(storeId);
    
    res.json({ message: 'Agendamento cancelado' });
  } catch (error) {
    logger.error(`Error cancelling schedule: ${error.message}`, { error });
    res.status(500).json({ message: error.message });
  }
});

// Endpoint para obter logs de produtos com falha para uma loja
app.get('/api/stores/:storeId/logs', async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const logsDir = path.join(__dirname, 'logs');
    
    // Verificar se o diretório de logs existe
    try {
      await fs.access(logsDir);
    } catch (error) {
      return res.json([]);
    }
    
    // Listar arquivos no diretório de logs
    const files = await fs.readdir(logsDir);
    
    // Filtrar apenas arquivos CSV que começam com 'failed_products_'
    const failedProductsLogs = files.filter(file => 
      file.startsWith('failed_products_') && file.endsWith('.csv')
    );
    
    // Para cada arquivo, contar o número de linhas (produtos com falha)
    const logsInfo = await Promise.all(failedProductsLogs.map(async file => {
      const filePath = path.join(logsDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Descontar a linha de cabeçalho
      const count = lines.length > 0 ? lines.length - 1 : 0;
      
      // Extrair a data do nome do arquivo de forma mais segura
      let date;
      try {
        // O formato atual é: failed_products_YYYY-MM-DDTHH-MM-SS-MMMZ.csv
        // Ou: failed_products_2025-03-12T17-14-13-955Z.csv
        const dateStr = file.replace('failed_products_', '').replace('.csv', '');
        
        // Lidar com o formato que inclui T, milissegundos e Z
        if (dateStr.includes('T')) {
          // Converter hífens em dois pontos após o T
          const formattedDate = dateStr.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/, 'T$1:$2:$3.$4Z');
          date = new Date(formattedDate).toISOString();
        } else {
          // Formato antigo: YYYY-MM-DD-HH-MM-SS
          const formattedDate = dateStr.replace(/(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})/, '$1T$2:$3:$4');
          date = new Date(formattedDate).toISOString();
        }
      } catch (error) {
        // Usar data atual como fallback
        logger.warn(`Could not parse date from filename ${file}: ${error.message}`);
        date = new Date().toISOString();
      }
      
      return {
        file,
        count,
        path: filePath,
        date
      };
    }));
    
    // Ordenar por data, do mais recente para o mais antigo
    logsInfo.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    res.json(logsInfo);
  } catch (error) {
    logger.error(`Error getting logs: ${error.message}`, { error });
    res.status(500).json({ message: error.message });
  }
});

// Endpoint para obter o progresso atual da sincronização
app.get('/api/stores/:storeId/progress', async (req, res) => {
  try {
    // Adicionar cabeçalhos para evitar cache
    res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    res.header('Surrogate-Control', 'no-store');
    
    const storeId = req.params.storeId;
    
    // Usar a versão síncrona para não bloquear a resposta
    const storeManager = getStoreManagerSync();
    
    // Se o storeManager não estiver disponível, retornar os dados em cache se existirem
    if (!storeManager) {
      if (progressInfo[storeId]) {
        progressInfo[storeId].timestamp = Date.now();
        return res.json(progressInfo[storeId]);
      } else {
        return res.status(500).json({ message: 'Erro ao obter gerenciador de lojas' });
      }
    }
    
    // Verificar se a loja existe
    const store = storeManager.getStoreById(storeId);
    if (!store) {
      return res.status(404).json({ message: 'Loja não encontrada' });
    }
    
    // Se não existir informação de progresso, criar objeto inicial
    if (!progressInfo[storeId]) {
      progressInfo[storeId] = {
        totalProducts: 0,
        processedProducts: 0,
        successCount: 0,
        failCount: 0,
        percentage: 0,
        isRunning: false,
        phase: 1,
        errors: [],
        lastUpdateTime: new Date().toISOString()
      };
    }
    
    // Verificar status atual da loja
    progressInfo[storeId].isRunning = store.status === 'Executando';
    
    // Ajuste específico para Home Depot: garantir que os dados usem os campos esperados pelo frontend
    if (storeId === 'homedepot') {
      // Garantir que totalProducts seja preenchido
      if (!progressInfo[storeId].totalProducts && progressInfo[storeId].total) {
        progressInfo[storeId].totalProducts = progressInfo[storeId].total;
      }
      
      // Garantir que processedProducts seja preenchido
      if (progressInfo[storeId].processed !== undefined) {
        progressInfo[storeId].processedProducts = progressInfo[storeId].processed;
        
        // Calcular porcentagem se tivermos totalProducts e processedProducts
        if (progressInfo[storeId].totalProducts > 0) {
          progressInfo[storeId].percentage = Math.min(
            Math.round((progressInfo[storeId].processedProducts / progressInfo[storeId].totalProducts) * 100),
            100
          );
        }
      }
      
      // Garantir que isRunning esteja definido corretamente
      if (progressInfo[storeId].status === 'processing' || progressInfo[storeId].status === 'reprocessing') {
        progressInfo[storeId].isRunning = true;
      }
    }
    
    // Adicionar timestamp à resposta para garantir que o cliente perceba mudanças
    progressInfo[storeId].timestamp = Date.now();
    
    res.json(progressInfo[storeId]);
  } catch (error) {
    logger.error(`Error getting progress: ${error.message}`, { error });
    // Se houver erro, retornar os dados em cache se existirem
    if (progressInfo[req.params.storeId]) {
      progressInfo[req.params.storeId].timestamp = Date.now();
      return res.json(progressInfo[req.params.storeId]);
    }
    res.status(500).json({ message: error.message });
  }
});

// Obter configuração de uma loja
app.get('/api/stores/:storeId/config', async (req, res) => {
  try {
    const { storeId } = req.params;
    
    // Verificar se a loja existe
    const storeManager = await getStoreManager();
    const store = storeManager.getStoreById(storeId);
    
    if (!store) {
      return res.status(404).json({ message: 'Loja não encontrada' });
    }
    
    // Prefixo para variáveis específicas da loja no .env
    const storePrefix = storeId.toUpperCase().replace(/-/g, '_');
    
    // Construir objeto de configuração a partir das variáveis de ambiente
    const config = {
      stockLevel: parseInt(process.env[`${storePrefix}_STOCK_LEVEL`] || process.env.STOCK_LEVEL || '5', 10),
      batchSize: parseInt(process.env[`${storePrefix}_BATCH_SIZE`] || process.env.BATCH_SIZE || '240', 10),
      requestsPerSecond: parseInt(process.env[`${storePrefix}_REQUESTS_PER_SECOND`] || process.env.REQUESTS_PER_SECOND || '7', 10),
      handlingTimeOmd: parseInt(process.env[`${storePrefix}_HANDLING_TIME_OMD`] || process.env.LEAD_TIME_OMD || '2', 10),
      updateFlagValue: parseInt(process.env[`${storePrefix}_UPDATE_FLAG_VALUE`] || '1', 10)
    };
    
    // Adicionar configurações específicas de cada fornecedor
    if (storeId === 'homedepot') {
      config.homeDepotHandlingTime = parseInt(process.env.HOMEDEPOT_HANDLING_TIME || '2', 10);
    } else if (storeId === 'whitecap') {
      config.whiteCapHandlingTime = parseInt(process.env.WHITECAP_HANDLING_TIME || '2', 10);
    } else if (storeId === 'vitacost') {
      config.vitacostHandlingTime = parseInt(process.env.VITACOST_HANDLING_TIME || '2', 10);
    } else if (storeId === 'bestbuy') {
      config.bestbuyHandlingTime = parseInt(process.env.BESTBUY_HANDLING_TIME || '3', 10);
    } else if (storeId === 'webstaurantstore') {
      config.webstaurantstoreHandlingTime = parseInt(process.env.WEBSTAURANTSTORE_HANDLING_TIME || '3', 10);
    }
    
    logger.info(`Returning configuration for store ${storeId}`);
    res.json(config);
  } catch (error) {
    logger.error(`Error fetching configuration: ${error.message}`);
    res.status(500).json({ message: 'Erro ao obter configuração da loja', error: error.message });
  }
});

// Rotas da API
const routes = {
  stores: '/api/stores',
  storeById: '/api/stores/:storeId',
  sync: '/api/stores/:storeId/sync',
  stopSync: '/api/stores/:storeId/sync/stop',
  progress: '/api/stores/:storeId/progress',
  logs: '/api/stores/:storeId/logs',
  config: '/api/stores/:storeId/config',
  scheduleSync: '/api/stores/:storeId/schedule',
  cancelSchedule: '/api/stores/:storeId/schedule/cancel',
  scheduleStatus: '/api/stores/:storeId/schedule/status',
  nextSync: '/api/stores/:storeId/next-sync',
  startSync: '/api/stores/:storeId/start-sync',
};

/**
 * Calcular a próxima execução agendada para uma loja
 * @param {string} storeId - ID da loja
 * @returns {Object} Objeto com informações sobre a próxima sincronização
 */
async function getNextSyncInfo(storeId) {
  try {
    // Verificar se existe um agendamento ativo
    const isActive = !!scheduledTasks[storeId];
    
    if (!isActive) {
      return { 
        scheduled: false,
        message: "Não há agendamento ativo para esta loja"
      };
    }
    
    // Obter as informações da loja usando a lista de lojas padrão
    const { defaultStores } = require('./src/models/Store');
    let store = defaultStores.find(s => s.id === storeId);
    
    if (!store) {
      return {
        scheduled: false,
        error: `Loja com ID ${storeId} não encontrada`
      };
    }
    
    // Importar biblioteca pg e configuração
    const { Pool } = require('pg');
    const { DB_CONFIG } = require('./src/config/db');
    const pool = new Pool(DB_CONFIG);
    
    try {
      // Consultar o banco de dados para obter o intervalo e a data da última sincronização
      const result = await pool.query(
        'SELECT interval_hours, last_sync_at FROM sync_schedule WHERE store_id = $1',
        [storeId]
      );
      
      const now = new Date();
      // Usar o intervalo configurado na loja como padrão
      let interval = store.scheduleInterval || 4;
      let lastSyncDate = null;
      
      // Se encontrou um registro, usar os valores do banco de dados
      if (result.rows && result.rows.length > 0) {
        // Usar o intervalo do banco de dados
        if (result.rows[0].interval_hours) {
          interval = Number(result.rows[0].interval_hours);
          logger.debug(`Using interval from database for ${storeId}: ${interval} hours`);
        }
        
        lastSyncDate = result.rows[0].last_sync_at;
      } else {
        // Se não encontrou registro, criar um com o intervalo atual
        logger.debug(`No sync_schedule record found for ${storeId}, creating a new one with interval: ${interval} hours`);
        await pool.query(
          'INSERT INTO sync_schedule (store_id, interval_hours, last_sync_at, is_active) VALUES ($1, $2, NOW(), $3)',
          [storeId, interval, isActive]
        );
        
        // Obter a data que acabamos de inserir
        const newResult = await pool.query(
          'SELECT last_sync_at FROM sync_schedule WHERE store_id = $1',
          [storeId]
        );
        
        if (newResult.rows && newResult.rows.length > 0) {
          lastSyncDate = newResult.rows[0].last_sync_at;
        }
      }
      
      // Calcular a próxima execução com base no intervalo e na última sincronização
      let nextDate;
      
      if (lastSyncDate) {
        // Se já houve sincronização, a próxima será X horas após a última
        const lastSync = new Date(lastSyncDate);
        nextDate = new Date(lastSync.getTime() + interval * 60 * 60 * 1000);
        
        // Se a próxima data já passou, calcular a próxima ocorrência a partir de agora
        if (nextDate < now) {
          const elapsedTime = now.getTime() - lastSync.getTime();
          const elapsedIntervals = Math.floor(elapsedTime / (interval * 60 * 60 * 1000));
          
          // A próxima sincronização será após o próximo intervalo completo
          nextDate = new Date(lastSync.getTime() + (elapsedIntervals + 1) * interval * 60 * 60 * 1000);
        }
      } else {
        // Se nunca houve sincronização, a próxima será daqui a X horas
        nextDate = new Date(now.getTime() + interval * 60 * 60 * 1000);
      }
      
      // Calcular o tempo restante em milissegundos
      const timeRemaining = nextDate.getTime() - now.getTime();
      
      // Converter para horas, minutos e segundos
      const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
      const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
      
      // Retornar informações sobre a próxima sincronização
      return {
        scheduled: true,
        nextSync: nextDate.toISOString(),
        nextSyncTimestamp: nextDate.getTime(),
        timeRemaining,
        hours,
        minutes,
        seconds,
        formattedTimeRemaining: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
        interval,
        lastSync: lastSyncDate ? new Date(lastSyncDate).toISOString() : null
      };
    } finally {
      // Garantir que o pool seja fechado
      await pool.end();
    }
  } catch (error) {
    logger.error(`Error getting next sync info for ${storeId}: ${error.message}`, { error });
    return { 
      scheduled: false,
      error: error.message
    };
  }
}

/**
 * Versão síncrona simplificada de getStoreManager para uso interno
 * @returns {Object} Gerenciador de lojas ou null se não conseguir obter
 */
function getStoreManagerSync() {
  try {
    // Tentar obter o storeManager do objeto global
    if (global.storeManager && global.storeManager.stores) {
      return global.storeManager;
    }
    return null;
  } catch (error) {
    logger.error(`Error in getStoreManagerSync: ${error.message}`, { error });
    return null;
  }
}

// Endpoint para obter informações sobre a próxima sincronização agendada
app.get(routes.nextSync, async (req, res) => {
  const storeId = req.params.storeId;
  
  try {
    // Obter o gerenciador de lojas
    const storeManager = await getStoreManager();
    
    // Verificar se a loja existe
    const store = storeManager.getStoreById(storeId);
    if (!store) {
      return res.status(404).json({ error: `Loja com ID ${storeId} não encontrada` });
    }
    
    // Verificar se a sincronização está em execução
    // Se estiver, não fornecemos um timer de contagem regressiva
    if (store.status === 'Executando' || 
        (progressInfo[storeId] && progressInfo[storeId].isRunning)) {
      logger.info(`Store ${storeId} está em execução, timer pausado.`);
      return res.json({
        scheduled: true,
        isRunning: true,
        status: store.status,
        storeId: storeId,
        message: "Sincronização em andamento. O temporizador será retomado após a conclusão."
      });
    }
    
    // CASO ESPECIAL PARA BEST BUY - RESPEITAR INTERVALO DO BANCO DE DADOS
    if (storeId === 'bestbuy') {
      logger.info(`BEST BUY: Calculando próximo horário com intervalo do banco de dados`);
      
      // Importar biblioteca pg e configuração
      const { Pool } = require('pg');
      const { DB_CONFIG } = require('./src/config/db');
      const pool = new Pool(DB_CONFIG);
      
      try {
        // Obter a última sincronização e intervalo para Best Buy
        const result = await pool.query(
          'SELECT last_sync_at, interval_hours FROM sync_schedule WHERE store_id = $1',
          ['bestbuy']
        );
        
        const now = new Date();
        let dbInterval = 4; // Valor padrão se não encontrado no banco
        let lastSyncDate = null;
        let nextDate;
        
        if (result.rows && result.rows.length > 0) {
          if (result.rows[0].interval_hours) {
            dbInterval = Number(result.rows[0].interval_hours);
            logger.info(`BEST BUY: Usando intervalo ${dbInterval}h do banco de dados`);
          }
          
          if (result.rows[0].last_sync_at) {
            lastSyncDate = result.rows[0].last_sync_at;
            const lastSync = new Date(lastSyncDate);
            
            // Calcular próxima execução: última sincronização + intervalo do banco
            nextDate = new Date(lastSync.getTime() + dbInterval * 60 * 60 * 1000);
            
            // Se a próxima data já passou, calcular a próxima ocorrência a partir da última
            if (nextDate < now) {
              const elapsedTime = now.getTime() - lastSync.getTime();
              const elapsedIntervals = Math.floor(elapsedTime / (dbInterval * 60 * 60 * 1000));
              nextDate = new Date(lastSync.getTime() + (elapsedIntervals + 1) * dbInterval * 60 * 60 * 1000);
            }
          } else {
            // Se não há data de sincronização anterior, agendar para daqui a X horas
            nextDate = new Date(now.getTime() + dbInterval * 60 * 60 * 1000);
          }
        } else {
          // Se não há registro no banco, criar um com o intervalo padrão
          nextDate = new Date(now.getTime() + dbInterval * 60 * 60 * 1000);
          
          await pool.query(
            'INSERT INTO sync_schedule (store_id, interval_hours, is_active) VALUES ($1, $2, true)',
            ['bestbuy', dbInterval]
          );
          logger.info(`BEST BUY: Criado novo registro no banco com intervalo ${dbInterval}h`);
        }
        
        // Calcular o tempo restante em milissegundos
        const timeRemaining = nextDate.getTime() - now.getTime();
        
        // Converter para horas, minutos e segundos
        const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
        const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
        
        // Resposta personalizada para Best Buy
        const bestBuyResponse = {
          scheduled: true,
          nextSync: nextDate.toISOString(),
          nextSyncTimestamp: nextDate.getTime(),
          timeRemaining,
          hours,
          minutes,
          seconds,
          formattedTimeRemaining: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`,
          interval: dbInterval,
          lastSync: lastSyncDate ? new Date(lastSyncDate).toISOString() : null
        };
        
        logger.info(`Horário de próxima sincronização para Best Buy calculado: ${nextDate.toISOString()} (em ${hours}h ${minutes}m ${seconds}s)`);
        
        await pool.end();
        return res.json(bestBuyResponse);
      } catch (err) {
        logger.error(`Erro ao calcular próxima sincronização para Best Buy: ${err.message}`, { error: err });
        await pool.end();
      }
    }
    
    // Para outras lojas, usar a implementação normal
    const nextSyncInfo = await getNextSyncInfo(storeId);
    
    res.json(nextSyncInfo);
  } catch (error) {
    logger.error(`Error getting next sync info: ${error.message}`, { error });
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para cancelar agendamento de sincronização
app.post(routes.cancelSchedule, async (req, res) => {
  const storeId = req.params.storeId;
  
  try {
    // Verificar se a loja existe
    const store = require('./src/data/stores').find(s => s.id === storeId);
    if (!store) {
      return res.status(404).json({ error: `Loja com ID ${storeId} não encontrada` });
    }
    
    // Cancelar agendamento
    cancelScheduledSync(storeId);
    
    res.json({ success: true, message: `Agendamento cancelado para loja ${storeId}` });
  } catch (error) {
    logger.error(`Error cancelling schedule: ${error.message}`, { error });
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para verificar status do agendamento
app.get(routes.scheduleStatus, async (req, res) => {
  const storeId = req.params.storeId;
  
  try {
    // Verificar se a loja existe
    const { defaultStores } = require('./src/models/Store');
    const store = defaultStores.find(s => s.id === storeId);
    
    if (!store) {
      return res.status(404).json({ error: `Loja com ID ${storeId} não encontrada` });
    }
    
    // Verificar se existe um agendamento ativo
    const isActive = !!scheduledTasks[storeId];
    
    res.json({ 
      active: isActive,
      interval: store.scheduleInterval || 4
    });
  } catch (error) {
    logger.error(`Error checking schedule status: ${error.message}`, { error });
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para iniciar sincronização quando o timer acabar
app.post('/api/stores/:storeId/start-sync', async (req, res) => {
  try {
    const storeId = req.params.storeId;
    const storeManager = await getStoreManager();
    
    if (!storeManager.getStoreById(storeId)) {
      return res.status(404).json({ message: 'Loja não encontrada' });
    }
    
    logger.info(`Sync requested by timer for store ${storeId}`);
    
    // Garantir que todas as configurações do provider estejam presentes
    try {
      // Executar o script de verificação de configurações dos providers
      const { exec } = require('child_process');
      const scriptPath = path.join(__dirname, 'ensureProviderConfigs.sh');
      
      logger.info(`Executando verificação de configurações para ${storeId} antes de iniciar sincronização`);
      
      exec(`bash ${scriptPath}`, (error, stdout, stderr) => {
        if (error) {
          logger.error(`Erro ao verificar configurações: ${error.message}`);
          logger.error(stderr);
        } else {
          logger.info(`Verificação de configurações concluída com sucesso`);
          logger.debug(stdout);
          
          // Recarregar variáveis de ambiente do arquivo correto
          const isProduction = process.env.NODE_ENV === 'production';
          const envFileName = isProduction ? '.env.production' : '.env';
          const envFilePath = path.join(__dirname, envFileName);
          
          // Forçar recarga das variáveis
          delete require.cache[require.resolve('dotenv')];
          require('dotenv').config({ path: envFilePath });
          
          logger.info(`Variáveis de ambiente recarregadas de ${envFileName}`);
          
          // Iniciar sincronização assíncrona
          syncStore(storeId).catch(error => {
            logger.error(`Error in timer-triggered sync for ${storeId}: ${error.message}`, { error });
          });
          
          // Log das variáveis críticas para diagnóstico
          logger.info(`Variáveis críticas para ${storeId}:`);
          logger.info(`LEAD_TIME_OMD: ${process.env.LEAD_TIME_OMD}`);
          logger.info(`${storeId.toUpperCase()}_HANDLING_TIME: ${process.env[`${storeId.toUpperCase()}_HANDLING_TIME`]}`);
          logger.info(`${storeId.toUpperCase()}_STOCK_LEVEL: ${process.env[`${storeId.toUpperCase()}_STOCK_LEVEL`]}`);
        }
      });
      
      // Atualizar cache do próximo agendamento
      delete nextSyncCache[storeId];
      
      res.json({ 
        message: 'Sincronização iniciada pelo timer',
        success: true,
        timestamp: new Date().toISOString(),
        storeId: storeId
      });
    } catch (configError) {
      logger.error(`Erro ao verificar configurações antes da sincronização: ${configError.message}`);
      
      // Mesmo com erro na verificação, tentar iniciar a sincronização
      syncStore(storeId).catch(error => {
        logger.error(`Error in timer-triggered sync for ${storeId}: ${error.message}`, { error });
      });
      
      res.json({ 
        message: 'Sincronização iniciada pelo timer (com advertência)',
        success: true,
        warning: 'Erro ao verificar configurações, mas a sincronização foi iniciada',
        timestamp: new Date().toISOString(),
        storeId: storeId
      });
    }
  } catch (error) {
    logger.error(`Error starting timer-triggered sync: ${error.message}`, { error });
    res.status(500).json({ message: error.message, success: false });
  }
});

// Inicializar a aplicação
async function main() {
  try {
    // Garantir que as configurações do .env estejam carregadas
    await ensureEnvConfigLoaded();
    
    // Iniciar o servidor web
    logger.info('Starting web server...');
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || 'localhost';
    
    app.listen(port, host, () => {
      logger.info(`Server is running on ${host}:${port}`);
    });
    
    // Carregar as lojas
    const storeManager = await getStoreManager();
    global.storeManager = storeManager; // Armazenar no objeto global para acesso fácil
    
    logger.info(`Loaded ${storeManager.stores.length} stores from configuration`);
    
    // Restaurar agendamentos salvos do banco de dados
    await restoreScheduledTasks();
    
  } catch (error) {
    logger.error(`Error starting application: ${error.message}`, { error });
    process.exit(1);
  }
}

/**
 * Garantir que as configurações do .env estejam carregadas
 * @returns {Promise<void>}
 */
async function ensureEnvConfigLoaded() {
  try {
    // Verificar se estamos em ambiente de produção
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Definir o nome do arquivo .env a ser usado
    const envFileName = isProduction ? '.env.production' : '.env';
    const envFilePath = path.join(__dirname, envFileName);
    
    console.log(`=== CARREGANDO VARIÁVEIS DE AMBIENTE ===`);
    console.log(`Ambiente: ${isProduction ? 'Produção' : 'Desenvolvimento'}`);
    console.log(`Arquivo .env: ${envFileName}`);
    
    try {
      await fs.access(envFilePath);
      logger.info(`Arquivo ${envFileName} encontrado e carregado.`);
      
      // Carregar as variáveis do arquivo .env apropriado
      require('dotenv').config({ path: envFilePath });
      
      console.log(`=== VERIFICAÇÃO DE VARIÁVEIS CRÍTICAS ===`);
      
      // Verificar se as variáveis críticas foram carregadas
      const requiredVars = [
        'DB_HOST',
        'DB_PORT',
        'DB_USER',
        'DB_PASSWORD',
        'DB_NAME',
        'LEAD_TIME_OMD'
      ];
      
      const missingVars = requiredVars.filter(varName => !process.env[varName]);
      
      if (missingVars.length > 0) {
        logger.warn(`Variáveis de ambiente ausentes: ${missingVars.join(', ')}`);
        console.log(`Variáveis ausentes: ${missingVars.join(', ')}`);
      } else {
        console.log(`Todas as variáveis críticas foram carregadas.`);
      }
      
      // Mostrar os valores de algumas variáveis importantes
      console.log(`LEAD_TIME_OMD: ${process.env.LEAD_TIME_OMD}`);
      console.log(`VITACOST_HANDLING_TIME: ${process.env.VITACOST_HANDLING_TIME}`);
      console.log(`BESTBUY_HANDLING_TIME: ${process.env.BESTBUY_HANDLING_TIME}`);
      console.log(`WHITECAP_HANDLING_TIME: ${process.env.WHITECAP_HANDLING_TIME}`);
      console.log(`WEBSTAURANTSTORE_HANDLING_TIME: ${process.env.WEBSTAURANTSTORE_HANDLING_TIME}`);
      console.log(`=== FIM DA VERIFICAÇÃO DE VARIÁVEIS ===`);
      
    } catch (error) {
      // Se o arquivo não existir, criar um com valores padrão
      if (error.code === 'ENOENT') {
        logger.warn(`Arquivo ${envFileName} não encontrado. Criando com valores padrão...`);
        
        // Valores padrão para as variáveis de ambiente
        const defaultEnvContent = `
# Configurações do servidor
PORT=7005
HOST=0.0.0.0
CORS_ORIGIN=*

# Configurações de banco de dados
DB_HOST=db.supabase.co
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=sua_senha_aqui
DB_NAME=postgres

# Configurações de API
HOMEDEPOT_API_BASE_URL=https://api.homedepot.com
VITACOST_API_BASE_URL=https://api.vitacost.com
BESTBUY_API_BASE_URL=https://api.bestbuy.com
WHITECAP_API_BASE_URL=https://api.whitecap.com
WEBSTAURANTSTORE_API_BASE_URL=https://api.webstaurantstore.com

# Configurações de sincronização
HOMEDEPOT_STOCK_LEVEL=5
HOMEDEPOT_BATCH_SIZE=240
HOMEDEPOT_REQUESTS_PER_SECOND=7
HOMEDEPOT_HANDLING_TIME=2
HOMEDEPOT_UPDATE_FLAG_VALUE=1

VITACOST_STOCK_LEVEL=5
VITACOST_BATCH_SIZE=240
VITACOST_REQUESTS_PER_SECOND=7
VITACOST_HANDLING_TIME=2
VITACOST_UPDATE_FLAG_VALUE=2

WHITECAP_STOCK_LEVEL=5
WHITECAP_BATCH_SIZE=240
WHITECAP_REQUESTS_PER_SECOND=7
WHITECAP_HANDLING_TIME=2
WHITECAP_UPDATE_FLAG_VALUE=3

BESTBUY_STOCK_LEVEL=5
BESTBUY_BATCH_SIZE=240
BESTBUY_REQUESTS_PER_SECOND=7
BESTBUY_HANDLING_TIME=2
BESTBUY_UPDATE_FLAG_VALUE=4

WEBSTAURANTSTORE_STOCK_LEVEL=5
WEBSTAURANTSTORE_BATCH_SIZE=240
WEBSTAURANTSTORE_REQUESTS_PER_SECOND=7
WEBSTAURANTSTORE_HANDLING_TIME=2
WEBSTAURANTSTORE_UPDATE_FLAG_VALUE=5

# Configurações gerais
LEAD_TIME_OMD=2
`;
        
        await fs.writeFile(envFilePath, defaultEnvContent);
        
        // Carregar as variáveis do arquivo recém-criado
        require('dotenv').config({ path: envFilePath });
      } else {
        throw error;
      }
    }
  } catch (error) {
    logger.error(`Erro ao carregar configurações do ambiente: ${error.message}`, { error });
    throw error;
  }
}

// Iniciar a aplicação
main();
