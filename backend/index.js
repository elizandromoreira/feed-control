/**
 * Feed Control - Aplicação Node.js
 * 
 * Este é o ponto de entrada principal da aplicação que sincroniza dados
 * entre diferentes fornecedores e a Amazon Seller API.
 * 
 * Versão modularizada para suportar múltiplos fornecedores.
 */

const express = require('express');
const { Command } = require('commander');
const path = require('path');
const fs = require('fs').promises;
const configureLogging = require('./src/config/logging');
const cron = require('node-cron');
const { getStoreConfig, getAllStoreConfigs, updateStoreConfig } = require('./src/services/storeConfigService');
const { syncStoreWithProvider, runStorePhase } = require('./src/sync/sync-service');

const app = express();
const PORT = process.env.PORT || 7005;
const HOST = process.env.HOST || '0.0.0.0';

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Variável global para controlar a frequência de logs
let lastLogTime = {};

// Middleware para logar requisições, com filtro para reduzir logs de polling
app.use((req, res, next) => {
    // Verificar se é uma requisição de polling que não precisa ser logada toda vez
    const isPollingRequest = req.method === 'GET' && (
        req.originalUrl.includes('/api/stores') && !req.query.verbose ||
        req.originalUrl.includes('/api/stores/') && req.originalUrl.includes('/progress') && !req.query.verbose
    );
    
    const now = Date.now();
    const endpoint = `${req.method} ${req.originalUrl}`;
    const lastTime = lastLogTime[endpoint] || 0;
    const logInterval = 60000; // Logar no máximo uma vez por minuto por endpoint
    
    // Registrar apenas se passou tempo suficiente desde o último log deste endpoint
    // ou se não é uma requisição de polling ou se houver um parâmetro verbose=true
    if (!isPollingRequest || (now - lastTime > logInterval)) {
        logger.info(`[REQUEST] ${req.method} ${req.originalUrl}`);
        if (Object.keys(req.body).length > 0) {
            logger.info(`[REQUEST BODY] ${JSON.stringify(req.body, null, 2)}`);
        }
        lastLogTime[endpoint] = now;
    }
    next();
});

app.use((req, res, next) => {
    const corsOriginEnv = process.env.CORS_ORIGIN || '*';
    if (corsOriginEnv === '*') {
        res.header('Access-Control-Allow-Origin', '*');
    } else {
        const allowedOrigins = corsOriginEnv.split(',').map(origin => origin.trim());
        const origin = req.headers.origin;
        if (origin && allowedOrigins.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
        } else {
            res.header('Access-Control-Allow-Origin', '*');
        }
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Estado em memória (agora para tarefas e progresso, não mais para configuração)
const scheduledTasks = {};
const cancellationFlags = {};
const progressInfo = {};

const LOG_DIR = path.join(__dirname, 'logs');
fs.mkdir(LOG_DIR, { recursive: true }).catch(err => console.error('Erro ao criar diretório de logs:', err));

let logger = configureLogging();
logger.info("Iniciando a aplicação Feed Control.");

/**
 * Lógica de sincronização principal para uma loja.
 * @param {string} storeId - ID da loja.
 */
async function syncStore(storeId) {
    try {
        const storeConfig = await getStoreConfig(storeId);
        if (!storeConfig) {
            logger.error(`[syncStore] Configuração para a loja ${storeId} não encontrada.`);
            return;
        }

        cancellationFlags[storeId] = false;
        progressInfo[storeId] = {
            isRunning: true,
            percentage: 0,
            // ... outros campos de progresso
        };
        
        // Atualizar tanto o status quanto o is_sync_running no banco de dados
        await updateStoreConfig(storeId, { 
            status: 'Executando',
            is_sync_running: true
        });
        
        logger.info(`[syncStore] Iniciando sincronização para ${storeId}. DB flag is_sync_running set to true.`);

        const checkCancellation = () => cancellationFlags[storeId];
        const updateProgress = (progressUpdate) => {
            // Log para ver o que está chegando do provedor
            logger.info(`[Index UpdateProgress] Received update for ${storeId} (processed: ${progressUpdate?.processedProducts}): ${JSON.stringify(progressUpdate)}`);
            
            // Mantém o isRunning do estado global a menos que o progressUpdate explicitamente o defina
            const currentIsRunning = progressInfo[storeId]?.isRunning;
            progressInfo[storeId] = {
                ...progressInfo[storeId],
                ...progressUpdate,
                isRunning: progressUpdate.isRunning !== undefined ? progressUpdate.isRunning : currentIsRunning,
                lastUpdateTime: new Date().toISOString()
            };
            logger.info(`[Index UpdateProgress] progressInfo for ${storeId} AFTER update (processed: ${progressInfo[storeId]?.processedProducts}): ${JSON.stringify(progressInfo[storeId])}`);
        };

        const result = await syncStoreWithProvider(
            storeId,
            false,
            storeConfig.requestsPerSecond || 7,
            storeConfig.batchSize || 9990,
            checkCancellation,
            updateProgress
        );
        
        await updateStoreConfig(storeId, { 
            status: result ? 'Inativo' : 'Erro',
            last_sync_at: new Date().toISOString()
        });

    } catch (error) {
        logger.error(`Erro catastrófico na sincronização da loja ${storeId}: ${error.message}`, { error });
        await updateStoreConfig(storeId, { 
            status: 'Erro',
            is_sync_running: false 
        });
    } finally {
        progressInfo[storeId] = { ...progressInfo[storeId], isRunning: false };
        // Garantir que is_sync_running seja definido como false e last_sync_at seja atualizado no banco de dados quando a sincronização terminar
        try {
            const currentTime = new Date().toISOString();
            await updateStoreConfig(storeId, { 
                is_sync_running: false,
                last_sync_at: currentTime
            });
            logger.info(`[syncStore] Finalized sync for ${storeId}. DB flag is_sync_running set to false and last_sync_at updated to ${currentTime}`);
        } catch (finalError) {
            logger.error(`[syncStore] Error updating final sync status for ${storeId}: ${finalError.message}`);
        }
    }
}

/**
 * Agenda uma tarefa cron para uma loja ou a atualiza se já existir.
 * @param {Object} storeConfig - Objeto de configuração da loja do banco de dados.
 */
function scheduleTask(storeConfig) {
    const { storeId, scheduleIntervalHours } = storeConfig;

    if (scheduledTasks[storeId]) {
        scheduledTasks[storeId].stop();
        logger.info(`Parando tarefa agendada existente para a loja ${storeId} antes de reagendar.`);
    }

    // Validação para garantir que o intervalo é válido para o cron
    if (!scheduleIntervalHours || scheduleIntervalHours < 1) {
        logger.warn(`Intervalo de agendamento inválido (${scheduleIntervalHours}) para a loja ${storeId}. A tarefa não será agendada.`);
        return;
    }

    const task = cron.schedule(`0 */${scheduleIntervalHours} * * *`, async () => {
        logger.info(`[CRON] Executando sincronização agendada para a loja: ${storeId}`);
        if (progressInfo[storeId]?.isRunning) {
            logger.warn(`[CRON] Sincronização para a loja ${storeId} já está em andamento. Pulando esta execução.`);
            return;
        }
        await syncStore(storeId);
    });

    scheduledTasks[storeId] = task;
    logger.info(`Sincronização para a loja ${storeId} agendada para rodar a cada ${scheduleIntervalHours} horas.`);
}


// --- ROTAS DA API ---

// Variável para controlar a frequência de logs do endpoint /api/stores
let lastStoresLogTime = 0;
const STORES_LOG_INTERVAL = 60000; // 60 segundos entre logs detalhados

app.get('/api/stores', async (req, res) => {
    try {
        const stores = await getAllStoreConfigs();
        const now = Date.now();
        const shouldLog = now - lastStoresLogTime > STORES_LOG_INTERVAL || req.query.verbose === 'true';
        
        if (shouldLog) {
            lastStoresLogTime = now;
            logger.info(`[API /stores GET] Processando requisição para ${stores.length} lojas`);
        }
        
        const storesWithProgress = stores.map(store => {
            const progress = progressInfo[store.storeId] || {};
            
            // Verificar o status de sincronização do banco de dados
            const isSyncRunning = store.isSyncRunning === true;
            
            // Determinar o status real combinando o banco de dados e o estado em memória
            const isRunningSyncStatus = isSyncRunning || (progress.isRunning === true);
            
            // Traduzir o status para inglês
            let statusText = isRunningSyncStatus ? 'running' : 'stopped';
            
            // Logar apenas se estiver no modo verbose ou se passou o intervalo de tempo
            if (shouldLog && (isRunningSyncStatus || store.isScheduleActive)) {
                logger.info(`[API /stores GET] Store ${store.storeId} - Status: ${statusText}, Schedule: ${store.isScheduleActive ? 'active' : 'inactive'}`);
            }
            
            return {
                id: store.storeId,
                name: store.displayName,
                status: statusText,
                lastSync: store.lastSyncAt,
                schedule: {
                    isActive: store.isScheduleActive,
                    interval: store.scheduleIntervalHours,
                },
                progress: {
                    percentage: progress.percentage || 0,
                },
                is_sync_running: isRunningSyncStatus
            };
        });
        res.json(storesWithProgress);
    } catch (error) {
        logger.error(`Error fetching stores: ${error.message}`, { error });
        res.status(500).json({ message: 'Error fetching stores' });
    }
});

// Variável para controlar a frequência de logs do endpoint /api/stores/:storeId/config
let lastConfigLogTime = {};
const CONFIG_LOG_INTERVAL = 60000; // 60 segundos entre logs detalhados

app.get('/api/stores/:storeId/config', async (req, res) => {
    const { storeId } = req.params;
    try {
        const config = await getStoreConfig(storeId);
        if (!config) return res.status(404).json({ message: 'Store not found' });
        
        // Verificar o status de sincronização do banco de dados
        const isSyncRunning = config.isSyncRunning === true;
        
        // Verificar também o estado em memória
        const memoryProgress = progressInfo[storeId] || {};
        const memoryIsRunning = memoryProgress.isRunning === true;
        
        // Determinar o status real combinando o banco de dados e o estado em memória
        const isRunningSyncStatus = isSyncRunning || memoryIsRunning;
        
        // Controle de logs para reduzir volume
        const now = Date.now();
        const lastTime = lastConfigLogTime[storeId] || 0;
        const shouldLog = now - lastTime > CONFIG_LOG_INTERVAL || req.query.verbose === 'true';
        
        if (shouldLog) {
            lastConfigLogTime[storeId] = now;
            logger.info(`[API /config GET] Store ${storeId} - Status: ${isRunningSyncStatus ? 'running' : 'stopped'}, Schedule: ${config.isScheduleActive ? 'active' : 'inactive'}`);
        }
        
        // Garantir que is_sync_running esteja presente e traduzir status para inglês
        const responseData = {
            ...config,
            // Garantir que is_sync_running seja booleano e reflita o status real
            is_sync_running: isRunningSyncStatus,
            // Traduzir status para inglês
            status: isRunningSyncStatus ? 'Running' : 'Inactive',
            // Adicionar um campo explícito para o frontend usar
            syncStatus: isRunningSyncStatus ? 'running' : 'stopped'
        };
        
        res.json(responseData);
    } catch (error) {
        logger.error(`Error fetching configuration for ${storeId}: ${error.message}`);
        res.status(500).json({ message: 'Error fetching configuration' });
    }
});

// Função auxiliar para traduzir status para inglês
function translateStatusToEnglish(status) {
    const statusMap = {
        'Executando': 'Running',
        'Inativo': 'Inactive',
        'Erro': 'Error',
        'Ativo': 'Active'
    };
    return statusMap[status] || status;
}

app.get('/api/stores/:storeId/logs', async (req, res) => {
    // Rota stub para compatibilidade. Retorna um array vazio.
    res.json([]);
});

// Variável para controlar a frequência de logs do endpoint /api/stores/:storeId/progress
let lastProgressLogTime = {};
const PROGRESS_LOG_INTERVAL = 60000; // 60 segundos entre logs detalhados

app.get('/api/stores/:storeId/progress', async (req, res) => {
    const { storeId } = req.params;
    
    try {
        // Buscar o status de sincronização do banco de dados
        const storeConfig = await getStoreConfig(storeId);
        const dbSyncRunning = storeConfig?.isSyncRunning === true;
        
        // Obter informações de progresso da memória
        const currentProgress = progressInfo[storeId];
        const memoryIsRunning = currentProgress?.isRunning === true;
        
        // Determinar o status real de sincronização combinando o banco de dados e o estado em memória
        const isRunningSyncStatus = dbSyncRunning || memoryIsRunning;
        
        // Controle de logs para reduzir volume
        const now = Date.now();
        const lastTime = lastProgressLogTime[storeId] || 0;
        const shouldLog = (now - lastTime > PROGRESS_LOG_INTERVAL || req.query.verbose === 'true') && 
                         (currentProgress || dbSyncRunning);
        
        // Só logar se houver progresso em memória ou se a sincronização estiver ativa no banco
        // E se passou o tempo mínimo entre logs ou estiver em modo verbose
        if (shouldLog) {
            lastProgressLogTime[storeId] = now;
            
            // Calcular porcentagem para o log
            let percentage = 0;
            if (currentProgress?.totalProducts > 0 && typeof currentProgress?.processedProducts === 'number') {
                percentage = Math.round((currentProgress.processedProducts / currentProgress.totalProducts) * 100);
            }
            
            logger.info(`[API /progress GET] Store ${storeId} - Status: ${isRunningSyncStatus ? 'running' : 'stopped'}, Progress: ${percentage}%`);
        }
        
        // Se não está rodando em nenhum lugar (nem banco nem memória), sinalizar para parar o polling
        const shouldStopPolling = !isRunningSyncStatus;
        
        // Se temos informações de progresso em memória
        if (currentProgress) {
            // Calcula a porcentagem se não estiver presente ou precisar ser recalculada
            let percentage = currentProgress.percentage || 0;
            if (currentProgress.totalProducts > 0 && typeof currentProgress.processedProducts === 'number') {
                percentage = Math.round((currentProgress.processedProducts / currentProgress.totalProducts) * 100);
            }
            
            res.json({
                ...currentProgress,
                percentage: isNaN(percentage) ? 0 : Math.min(100, Math.max(0, percentage)),
                isRunning: isRunningSyncStatus,
                phase: currentProgress.phase || 1,
                totalProducts: currentProgress.totalProducts || 0,
                processedProducts: currentProgress.processedProducts || 0,
                successCount: currentProgress.successCount || 0,
                failCount: currentProgress.failCount || 0,
                status: isRunningSyncStatus ? 'Running' : 'Inactive',
                shouldStopPolling: shouldStopPolling // Sempre incluir este campo
            });
        } else {
            // Se não houver informações de progresso, verificar o status do banco de dados
            res.json({
                isRunning: isRunningSyncStatus,
                percentage: 0,
                phase: 1,
                totalProducts: 0,
                processedProducts: 0,
                successCount: 0,
                failCount: 0,
                status: isRunningSyncStatus ? 'Running' : 'Inactive',
                shouldStopPolling: shouldStopPolling // Sempre incluir este campo
            });
        }
    } catch (error) {
        logger.error(`[API /progress GET] Error fetching progress for ${storeId}: ${error.message}`);
        res.status(500).json({
            isRunning: false,
            error: `Error fetching progress: ${error.message}`,
            percentage: 0,
            shouldStopPolling: true // Sinalizar para o frontend parar o polling em caso de erro
        });
    }
});

app.post('/api/stores/:storeId/config', async (req, res) => {
    const { storeId } = req.params;
    // O corpo da requisição (req.body) já chega no formato snake_case esperado pelo banco de dados.
    // A lógica de conversão foi removida para evitar conflitos.
    const configData = req.body;

    try {
        const updatedConfig = await updateStoreConfig(storeId, configData);
        res.json(updatedConfig);
    } catch (error) {
        logger.error(`Erro ao salvar configuração para ${storeId}: ${error.message}`);
        res.status(500).json({ message: 'Erro ao salvar configuração' });
    }
});

app.post('/api/stores/:storeId/sync', async (req, res) => {
    const { storeId } = req.params;
    
    try {
        // Verificar se já está em execução na memória ou no banco de dados
        const storeConfig = await getStoreConfig(storeId);
        if (!storeConfig) {
            return res.status(404).json({ message: 'Store not found' });
        }
        
        if (progressInfo[storeId]?.isRunning || storeConfig.is_sync_running === true) {
            return res.status(409).json({ message: 'Synchronization for this store is already in progress.' });
        }

        // Atualizar o status no banco de dados ANTES de iniciar o processo
        await updateStoreConfig(storeId, { 
            is_sync_running: true,
            status: 'Running' // Já em inglês
        });
        
        logger.info(`[API /sync POST] Updated DB is_sync_running=true for store ${storeId}`);

        // Inicializa o progresso em memória
        progressInfo[storeId] = {
            isRunning: true,
            percentage: 0,
            totalProducts: 0,
            processedProducts: 0,
            successCount: 0,
            failCount: 0,
            phase: 1,
            message: 'Synchronization started...',
            lastUpdateTime: new Date().toISOString()
        };
        
        // Dispara a sincronização real de forma assíncrona
        syncStore(storeId).catch(async (err) => {
            logger.error(`Error in manual syncStore for ${storeId}: ${err.message}`);
            
            // Atualiza o progresso em memória para refletir o erro
            progressInfo[storeId] = {
                ...progressInfo[storeId],
                isRunning: false,
                error: `Failed to start synchronization: ${err.message}`,
                percentage: 100,
                completed: true
            };
            
            // Garantir que o status no banco de dados seja atualizado em caso de erro
            try {
                await updateStoreConfig(storeId, { 
                    is_sync_running: false,
                    status: 'Error'
                });
                logger.info(`[API /sync POST ERROR] Updated DB is_sync_running=false for store ${storeId} due to error`);
            } catch (dbError) {
                logger.error(`Failed to update DB status after sync error for ${storeId}: ${dbError.message}`);
            }
        });

        res.status(202).json({ message: 'Manual synchronization started.' });
    } catch (error) {
        logger.error(`Error starting sync for ${storeId}: ${error.message}`);
        res.status(500).json({ message: 'Error starting synchronization.' });
    }
});

app.post('/api/stores/:storeId/sync/stop', async (req, res) => {
    const { storeId } = req.params;
    try {
        // Definir flag de cancelamento
        cancellationFlags[storeId] = true;
        
        // Atualizar o status no banco de dados
        await updateStoreConfig(storeId, { 
            is_sync_running: false,
            status: 'Inactive'
        });
        
        // Limpar o progresso em memória
        if (progressInfo[storeId]) {
            progressInfo[storeId].isRunning = false;
            progressInfo[storeId].completed = true;
        }
        
        logger.info(`Sinal de cancelamento enviado para a loja ${storeId}. Status atualizado no banco de dados.`);
        res.json({ message: 'Sinal de cancelamento enviado e status atualizado.' });
    } catch (error) {
        logger.error(`Erro ao parar sincronização para ${storeId}: ${error.message}`);
        res.status(500).json({ message: 'Erro ao parar sincronização.' });
    }
});

app.get('/api/stores/:storeId/schedule/status', async (req, res) => {
    const { storeId } = req.params;
    try {
        const config = await getStoreConfig(storeId);
        if (!config) return res.status(404).json({ message: 'Loja não encontrada' });
        res.json({ active: config.is_schedule_active, interval: config.schedule_interval_hours });
    } catch (error) {
        logger.error(`Erro ao verificar status para ${storeId}: ${error.message}`);
        res.status(500).json({ message: 'Erro ao verificar status.' });
    }
});

// Variável para controlar a frequência de logs do endpoint /api/stores/:storeId/next-sync
let lastNextSyncLogTime = {};
const NEXT_SYNC_LOG_INTERVAL = 60000; // 60 segundos entre logs detalhados

app.get('/api/stores/:storeId/next-sync', async (req, res) => {
    const { storeId } = req.params;
    try {
        // Controle de logs para reduzir volume
        const now = Date.now();
        const lastTime = lastNextSyncLogTime[storeId] || 0;
        const shouldLog = now - lastTime > NEXT_SYNC_LOG_INTERVAL || req.query.verbose === 'true';
        
        if (shouldLog) {
            lastNextSyncLogTime[storeId] = now;
            logger.info(`[API /next-sync GET] Processing request for store ${storeId}`);
        }
        
        const config = await getStoreConfig(storeId);
        if (!config || !config.is_schedule_active) {
            return res.json({ scheduled: false, message: "Agendamento inativo." });
        }
        if (progressInfo[storeId]?.isRunning) {
            return res.json({ scheduled: true, isRunning: true, message: "Sincronização em andamento." });
        }
        
        const task = scheduledTasks[storeId];
        if(task) {
            const nextRun = task.nextDates();
            
            if (shouldLog) {
                logger.info(`[API /next-sync GET] Store ${storeId} - Next sync scheduled for: ${nextRun.toLocaleString()}`);
            }
            
            res.json({
                scheduled: true,
                isRunning: false,
                nextSyncTimestamp: nextRun.getTime(),
                message: `Próxima execução em: ${nextRun.toLocaleString()}`
            });
        } else {
            res.json({ scheduled: true, isRunning: false, message: "Agendado, aguardando próximo ciclo." });
        }
       
    } catch (error) {
        logger.error(`Erro em next-sync para ${storeId}: ${error.message}`);
        res.status(500).json({ message: 'Erro em next-sync.' });
    }
});

app.post('/api/stores/:storeId/schedule', async (req, res) => {
    const { storeId } = req.params;
    const { interval } = req.body;
    const intInterval = parseInt(interval);

    if (!intInterval || intInterval <= 0) {
        return res.status(400).json({ message: 'O intervalo deve ser um número inteiro positivo.' });
    }

    try {
        const updatedConfig = await updateStoreConfig(storeId, {
            is_schedule_active: true,
            schedule_interval_hours: intInterval,
        });

        // Após atualizar o BD, precisamos recriar/atualizar a tarefa cron em memória
        const fullConfig = await getStoreConfig(storeId);
        if(fullConfig) {
            scheduleTask(fullConfig); // Reagenda a tarefa com a nova configuração
            logger.info(`Tarefa para a loja ${storeId} reagendada com sucesso para cada ${intInterval} horas.`);
        } else {
            logger.warn(`Não foi possível encontrar a configuração completa para a loja ${storeId} após a atualização do agendamento.`);
        }

        res.json({ message: `Agendamento para a loja ${storeId} atualizado para cada ${intInterval} horas.` });
    } catch (error) {
        logger.error(`Erro ao atualizar agendamento para ${storeId}: ${error.message}`);
        res.status(500).json({ message: 'Erro ao atualizar o agendamento.' });
    }
});

app.post('/api/stores/:storeId/schedule/cancel', async (req, res) => {
    const { storeId } = req.params;
    try {
        await updateStoreConfig(storeId, { is_schedule_active: false });

        if (scheduledTasks[storeId]) {
            scheduledTasks[storeId].stop();
            delete scheduledTasks[storeId];
            logger.info(`Agendamento em memória para a loja ${storeId} foi interrompido.`);
        }

        res.json({ message: 'Agendamento cancelado com sucesso.' });
    } catch (error) {
        logger.error(`Erro ao cancelar agendamento para a loja ${storeId}: ${error.message}`);
        res.status(500).json({ message: 'Erro ao cancelar o agendamento.' });
    }
});

app.post('/api/stores/:storeId/schedule/stop', async (req, res) => {
    const { storeId } = req.params;
    try {
        // Para a tarefa em memória
        if (scheduledTasks[storeId]) {
            scheduledTasks[storeId].stop();
            delete scheduledTasks[storeId];
            logger.info(`Tarefa agendada para a loja ${storeId} foi parada.`);
        }

        // Atualiza o status no banco de dados
        await updateStoreConfig(storeId, { is_schedule_active: false });

        res.json({ message: `Agendamento para a loja ${storeId} foi desativado.` });
    } catch (error) {
        logger.error(`Erro ao parar agendamento para ${storeId}: ${error.message}`);
        res.status(500).json({ message: 'Erro ao parar o agendamento.' });
    }
});

/**
 * Inicializa os agendamentos a partir do banco de dados na inicialização.
 */
async function initializeSchedulesFromDB() {
    logger.info('Inicializando agendamentos a partir do banco de dados...');
    try {
        const allConfigs = await getAllStoreConfigs();
        const activeSchedules = allConfigs.filter(c => c.is_schedule_active);

        logger.info(`Encontrados ${activeSchedules.length} agendamentos ativos para restaurar.`);
        activeSchedules.forEach(scheduleTask);
        
    } catch (error) {
        logger.error('Falha ao inicializar agendamentos do banco de dados:', error);
    }
}

/**
 * Reseta o status de sincronização de todas as lojas quando o servidor é iniciado
 * Isso garante que não haja status inconsistentes após reiniciar o servidor
 */
async function resetAllSyncStatus() {
    try {
        const stores = await getAllStoreConfigs();
        let resetCount = 0;
        
        for (const store of stores) {
            if (store.isSyncRunning === true) {
                logger.info(`Resetando status de sincronização para a loja ${store.storeId} (estava como running)`);
                await updateStoreConfig(store.storeId, { 
                    is_sync_running: false,
                    status: 'Inactive'
                });
                resetCount++;
            }
        }
        
        if (resetCount > 0) {
            logger.info(`Status de sincronização resetado para ${resetCount} lojas`);
        } else {
            logger.info('Nenhuma loja precisou ter o status de sincronização resetado');
        }
        
        // Limpar também o objeto progressInfo em memória
        // Resetar o objeto sem reatribuir a variável constante
        Object.keys(progressInfo).forEach(key => delete progressInfo[key]);
        
    } catch (error) {
        logger.error(`Erro ao resetar status de sincronização: ${error.message}`);
    }
}

async function main() {
    // ... (lógica de argumentos da CLI pode ser adicionada aqui se necessário)

    // Inicializar o servidor
    const PORT = process.env.PORT || 7005;
    app.listen(PORT, '0.0.0.0', async () => {
        logger.info(`Servidor rodando em http://0.0.0.0:${PORT}`);
        
        // Resetar status de sincronização de todas as lojas
        await resetAllSyncStatus();
        
        // Restaurar agendamentos ativos do banco de dados
        logger.info('Inicializando agendamentos a partir do banco de dados...');
        initializeSchedulesFromDB();
    });
}

main();
