const HomeDepotProvider = require('./src/providers/home-depot-provider');
const storeConfigService = require('./src/services/storeConfigService');
const logger = require('./src/config/logging')();

async function testHomeDepotSpeed() {
    try {
        logger.info('Starting Home Depot speed test...');
        
        // Buscar configuração do banco
        const config = await storeConfigService.getStoreConfig('homedepot');
        logger.info(`Config loaded: requestsPerSecond=${config.requestsPerSecond}`);
        
        // Criar instância do provider
        const provider = new HomeDepotProvider(config);
        
        // Executar Phase 1
        const startTime = Date.now();
        const result = await provider.executePhase1(
            false, // skipProblematic
            config.requestsPerSecond,
            null, // checkCancellation
            (progress) => {
                logger.info(`Progress: ${progress.processedProducts}/${progress.totalProducts}`);
            }
        );
        
        const duration = (Date.now() - startTime) / 1000;
        logger.info(`Test completed in ${duration.toFixed(2)} seconds`);
        logger.info(`Result: ${JSON.stringify(result, null, 2)}`);
        
    } catch (error) {
        logger.error(`Test failed: ${error.message}`);
        console.error(error);
    }
    
    process.exit(0);
}

testHomeDepotSpeed();
