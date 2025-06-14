/**
 * Script Genérico de Teste de Capacidade de API
 * 
 * Este script testa diferentes configurações de RPS para descobrir
 * a capacidade ideal de qualquer endpoint de API.
 * 
 * Para usar com diferentes APIs, apenas modifique a configuração no início do arquivo.
 */

const axios = require('axios');
const { performance } = require('perf_hooks');
const { Pool } = require('pg');

// Configuração do banco de dados PostgreSQL
const pool = new Pool({
    user: process.env.DB_USER || 'postgres.bvbnofnnbfdlnpuswlgy',
    host: process.env.DB_HOST || 'aws-0-us-east-1.pooler.supabase.com',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || 'Bi88An6B9L0EIihL',
    port: process.env.DB_PORT || 6543,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

// ============================================================================
// CONFIGURAÇÃO - MODIFIQUE AQUI PARA DIFERENTES APIS
// ============================================================================

const API_CONFIG = {
    // Best Buy API
    name: 'Best Buy',
    baseUrl: 'http://167.114.223.83:3005/bb/api',
    // Função para buscar endpoints de teste do banco de dados
    fetchTestEndpoints: async () => {
        try {
            const client = await pool.connect();
            const result = await client.query(
                'SELECT sku FROM produtos WHERE source = $1 LIMIT 30',
                ['Best Buy']
            );
            client.release();
            
            if (result.rows.length === 0) {
                console.warn('Nenhum SKU encontrado no banco para Best Buy');
                console.log('Usando SKUs padrão...');
                return [
                    '6559582', '8799102', '6560191', '6522588', '6565231', 
                    '6543534', '6522074', '6571366', '6565205', '6565495',
                    '6580778', '6562314', '6567480', '6551275', '6380827',
                    '6599438', '6580242', '6539679', '6273001', '6549190'
                ];
            }
            
            const skus = result.rows.map(row => row.sku);
            console.log(`✅ Buscados ${skus.length} SKUs reais do banco de dados`);
            return skus;
        } catch (error) {
            console.warn('Erro ao conectar com banco:', error.message);
            console.log('Usando SKUs padrão...');
            return [
                '6559582', '8799102', '6560191', '6522588', '6565231', 
                '6543534', '6522074', '6571366', '6565205', '6565495',
                '6580778', '6562314', '6567480', '6551275', '6380827',
                '6599438', '6580242', '6539679', '6273001', '6549190'
            ];
        }
    },
    // Função para validar se a resposta é válida
    validateResponse: (response) => {
        return response.status === 200 && 
               response.data && 
               response.data.success === true;
    },
    // Headers customizados para a API
    headers: {
        'User-Agent': 'CapacityTest/1.0',
        'Accept': 'application/json'
    },
    // Timeout em milissegundos
    timeout: 10000
};

// Configurações alternativas para outras APIs (exemplos)
const API_CONFIGS = {
    bestbuy: {
        name: 'Best Buy',
        baseUrl: 'http://167.114.223.83:3005/bb/api',
        fetchTestEndpoints: async () => {
            try {
                const client = await pool.connect();
                const result = await client.query(
                    'SELECT sku FROM produtos WHERE source = $1 LIMIT 30',
                    ['Best Buy']
                );
                client.release();
                
                if (result.rows.length === 0) {
                    throw new Error('Nenhum SKU encontrado');
                }
                
                const skus = result.rows.map(row => row.sku);
                console.log(`✅ Buscados ${skus.length} SKUs reais do banco (Best Buy)`);
                return skus;
            } catch (error) {
                console.warn('Usando SKUs padrão para Best Buy');
                return [
                    '6559582', '8799102', '6560191', '6522588', '6565231', 
                    '6543534', '6522074', '6571366', '6565205', '6565495'
                ];
            }
        },
        validateResponse: (response) => response.status === 200 && response.data?.success === true,
        headers: { 'User-Agent': 'CapacityTest/1.0' },
        timeout: 10000
    },
    
    homedepot: {
        name: 'Home Depot',
        baseUrl: 'http://167.114.223.83:3005/hd/api',
        fetchTestEndpoints: async () => {
            try {
                const client = await pool.connect();
                const result = await client.query(
                    'SELECT sku FROM produtos WHERE source = $1 AND sku_problem IS NOT TRUE ORDER BY last_update ASC LIMIT 30',
                    ['Home Depot']
                );
                client.release();
                
                if (result.rows.length === 0) {
                    throw new Error('Nenhum SKU encontrado');
                }
                
                const skus = result.rows.map(row => row.sku);
                console.log(`✅ Buscados ${skus.length} SKUs reais do banco (Home Depot)`);
                return skus;
            } catch (error) {
                console.warn('Usando SKUs padrão para Home Depot:', error.message);
                return [
                    '312764063', '320028546', '305659754', '313872047', '317859649',
                    '314538708', '311723583', '312370507', '307949254', '311931486',
                    '320844638', '317818085', '313833271', '323676662', '311931790',
                    '325838727', '315132904', '205641025', '326738782', '325889136',
                    '322053964', '315410924', '203068909', '100597369', '202831863',
                    '313660471', '334993349', '326750753', '202554323', '314013758'
                ];
            }
        },
        validateResponse: (response) => {
            // A API do Home Depot retorna dados do produto diretamente
            return response.status === 200 && response.data && !response.data.error;
        },
        headers: { 'User-Agent': 'CapacityTest/1.0' },
        timeout: 15000
    },
    
    // Adicione outras APIs aqui conforme necessário
};

// ============================================================================
// FUNÇÕES DE TESTE
// ============================================================================

/**
 * Testa uma configuração específica de RPS
 */
async function testRPSConfiguration(config, testEndpoints, rps, testName, pattern = 'burst') {
    console.log(`\n=== Testando ${testName}: ${rps} RPS (${pattern}) ===`);
    
    const results = {
        apiName: config.name,
        rps: rps,
        pattern: pattern,
        totalRequests: 0,
        successCount: 0,
        failCount: 0,
        timeoutCount: 0,
        avgResponseTime: 0,
        minResponseTime: Infinity,
        maxResponseTime: 0,
        successRate: 0,
        errors: [],
        recommendations: []
    };
    
    const startTime = performance.now();
    const responseTimes = [];
    
    try {
        if (pattern === 'burst') {
            // Teste em rajadas: todas as requisições de uma vez
            const batchSize = rps;
            const batches = Math.ceil(testEndpoints.length / batchSize);
            
            for (let batch = 0; batch < batches; batch++) {
                const batchStart = batch * batchSize;
                const batchEnd = Math.min(batchStart + batchSize, testEndpoints.length);
                const batchEndpoints = testEndpoints.slice(batchStart, batchEnd);
                
                console.log(`  Lote ${batch + 1}/${batches}: ${batchEndpoints.length} requisições simultâneas`);
                
                const promises = batchEndpoints.map(async (endpoint) => {
                    const reqStart = performance.now();
                    try {
                        const url = `${config.baseUrl}/${endpoint}`;
                        const response = await axios.get(url, {
                            timeout: config.timeout,
                            headers: config.headers
                        });
                        
                        const reqTime = performance.now() - reqStart;
                        responseTimes.push(reqTime);
                        
                        if (config.validateResponse(response)) {
                            results.successCount++;
                            return { endpoint, status: 'success', time: reqTime };
                        } else {
                            results.failCount++;
                            return { endpoint, status: 'invalid_response', time: reqTime };
                        }
                    } catch (error) {
                        const reqTime = performance.now() - reqStart;
                        
                        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                            results.timeoutCount++;
                        } else {
                            results.failCount++;
                        }
                        
                        results.errors.push(`${endpoint}: ${error.message}`);
                        return { endpoint, status: 'error', time: reqTime, error: error.message };
                    }
                });
                
                await Promise.all(promises);
                results.totalRequests += batchEndpoints.length;
                
                // Aguarda 1 segundo antes do próximo lote
                if (batch < batches - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
        } else if (pattern === 'distributed') {
            // Teste distribuído: uma requisição a cada intervalo
            const intervalMs = 1000 / rps;
            console.log(`  Intervalo entre requisições: ${intervalMs.toFixed(2)}ms`);
            
            for (const endpoint of testEndpoints) {
                const reqStart = performance.now();
                try {
                    const url = `${config.baseUrl}/${endpoint}`;
                    const response = await axios.get(url, {
                        timeout: config.timeout,
                        headers: config.headers
                    });
                    
                    const reqTime = performance.now() - reqStart;
                    responseTimes.push(reqTime);
                    
                    if (config.validateResponse(response)) {
                        results.successCount++;
                    } else {
                        results.failCount++;
                    }
                } catch (error) {
                    const reqTime = performance.now() - reqStart;
                    
                    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
                        results.timeoutCount++;
                    } else {
                        results.failCount++;
                    }
                    
                    results.errors.push(`${endpoint}: ${error.message}`);
                }
                
                results.totalRequests++;
                
                // Aguarda o intervalo antes da próxima requisição
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }
        }
        
    } catch (error) {
        console.error(`Erro durante o teste: ${error.message}`);
    }
    
    // Calcular estatísticas
    const totalTime = performance.now() - startTime;
    
    if (responseTimes.length > 0) {
        results.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        results.minResponseTime = Math.min(...responseTimes);
        results.maxResponseTime = Math.max(...responseTimes);
    }
    
    results.successRate = results.totalRequests > 0 ? 
        (results.successCount / results.totalRequests) * 100 : 0;
    
    // Gerar recomendações baseadas nos resultados
    if (results.successRate >= 98) {
        results.recommendations.push('Excelente! Esta configuração é muito estável.');
    } else if (results.successRate >= 90) {
        results.recommendations.push('Boa configuração, mas pode haver melhorias.');
    } else if (results.successRate >= 70) {
        results.recommendations.push('Configuração instável. Considere reduzir o RPS.');
    } else {
        results.recommendations.push('Configuração inadequada. RPS muito alto para esta API.');
    }
    
    if (results.timeoutCount > 0) {
        results.recommendations.push(`${results.timeoutCount} timeouts detectados. Considere aumentar o timeout ou reduzir RPS.`);
    }
    
    if (results.avgResponseTime > 5000) {
        results.recommendations.push('Tempo de resposta alto. API pode estar sobrecarregada.');
    }
    
    // Exibir resultados
    console.log(`  Tempo total: ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`  Requisições: ${results.totalRequests}`);
    console.log(`  Sucessos: ${results.successCount}`);
    console.log(`  Falhas: ${results.failCount}`);
    console.log(`  Timeouts: ${results.timeoutCount}`);
    console.log(`  Taxa de sucesso: ${results.successRate.toFixed(1)}%`);
    console.log(`  Tempo de resposta: ${results.avgResponseTime.toFixed(0)}ms (avg), ${results.minResponseTime.toFixed(0)}ms (min), ${results.maxResponseTime.toFixed(0)}ms (max)`);
    
    if (results.errors.length > 0 && results.errors.length <= 5) {
        console.log(`  Primeiros erros: ${results.errors.slice(0, 3).join(', ')}`);
    }
    
    return results;
}

/**
 * Executa todos os testes de capacidade para uma API
 */
async function runCapacityTests(apiConfigKey = null) {
    // Determinar qual configuração usar
    let config = API_CONFIG;
    if (apiConfigKey && API_CONFIGS[apiConfigKey]) {
        config = API_CONFIGS[apiConfigKey];
    }
    
    console.log('🚀 Iniciando Testes de Capacidade de API');
    console.log(`📊 API: ${config.name}`);
    console.log(`🎯 Base URL: ${config.baseUrl}`);
    console.log(`⏱️  Timeout: ${config.timeout}ms`);
    
    // Buscar endpoints de teste
    console.log('🔍 Buscando endpoints de teste...');
    const testEndpoints = await config.fetchTestEndpoints();
    
    if (!testEndpoints || testEndpoints.length === 0) {
        console.error('❌ Nenhum endpoint encontrado para teste!');
        return;
    }
    
    console.log(`📋 Testando com ${testEndpoints.length} endpoints diferentes`);
    console.log(`📝 Primeiros endpoints: ${testEndpoints.slice(0, 5).join(', ')}${testEndpoints.length > 5 ? '...' : ''}`);
    
    const allResults = [];
    
    // Teste diferentes RPS em modo burst
    const rpsTests = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20];
    
    for (const rps of rpsTests) {
        const result = await testRPSConfiguration(config, testEndpoints, rps, `Burst ${rps}`, 'burst');
        allResults.push(result);
        
        // Pausa entre testes para não sobrecarregar
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Se a taxa de sucesso for muito baixa, pare os testes
        if (result.successRate < 50) {
            console.log(`\n⚠️  Taxa de sucesso muito baixa (${result.successRate.toFixed(1)}%). Parando testes em RPS mais altos.`);
            break;
        }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log(`📈 RESUMO DOS RESULTADOS - ${config.name}`);
    console.log('='.repeat(80));
    
    // Análise dos resultados
    console.log('\nTaxa de Sucesso por RPS:');
    allResults.forEach(result => {
        const status = result.successRate >= 95 ? '✅' : 
                      result.successRate >= 80 ? '⚠️' : '❌';
        const timeoutInfo = result.timeoutCount > 0 ? ` (${result.timeoutCount} timeouts)` : '';
        console.log(`  ${status} ${result.rps.toString().padStart(2)} RPS: ${result.successRate.toFixed(1)}% | ${result.avgResponseTime.toFixed(0)}ms avg${timeoutInfo}`);
    });
    
    // Encontrar configurações ideais
    const excellentResults = allResults.filter(r => r.successRate >= 98);
    const goodResults = allResults.filter(r => r.successRate >= 90);
    
    const idealRPS = excellentResults.length > 0 ? 
        Math.max(...excellentResults.map(r => r.rps)) : 
        goodResults.length > 0 ?
        Math.max(...goodResults.map(r => r.rps)) :
        allResults.reduce((best, current) => 
            current.successRate > best.successRate ? current : best
        ).rps;
    
    const conservativeRPS = goodResults.length > 0 ? 
        Math.max(...goodResults.map(r => r.rps)) : idealRPS;
    
    console.log(`\n🎯 RECOMENDAÇÕES PARA ${config.name}:`);
    console.log(`   RPS IDEAL (≥98% sucesso): ${idealRPS}`);
    console.log(`   RPS CONSERVADOR (≥90% sucesso): ${conservativeRPS}`);
    
    // Teste comparativo no RPS ideal
    if (idealRPS > 1) {
        console.log(`\n🔬 Teste Comparativo: Burst vs Distribuído (${idealRPS} RPS)`);
        const burstResult = await testRPSConfiguration(config, testEndpoints, idealRPS, `Burst ${idealRPS}`, 'burst');
        await new Promise(resolve => setTimeout(resolve, 3000));
        const distResult = await testRPSConfiguration(config, testEndpoints, idealRPS, `Distribuído ${idealRPS}`, 'distributed');
        
        console.log('\n📊 Comparação Final:');
        console.log(`  Burst:       ${burstResult.successRate.toFixed(1)}% sucesso | ${burstResult.avgResponseTime.toFixed(0)}ms avg`);
        console.log(`  Distribuído: ${distResult.successRate.toFixed(1)}% sucesso | ${distResult.avgResponseTime.toFixed(0)}ms avg`);
        
        const recommendedPattern = distResult.successRate > burstResult.successRate ? 'distribuído' : 'burst';
        console.log(`\n✨ CONFIGURAÇÃO FINAL RECOMENDADA:`);
        console.log(`   ${idealRPS} RPS em modo ${recommendedPattern}`);
        console.log(`   Taxa de sucesso esperada: ${(recommendedPattern === 'distribuído' ? distResult : burstResult).successRate.toFixed(1)}%`);
        
        allResults.push(burstResult, distResult);
    }
    
    // Salvar resultados em arquivo JSON para análise posterior
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `capacity_test_${config.name.toLowerCase().replace(/\s+/g, '_')}_${timestamp}.json`;
    
    const reportData = {
        timestamp: new Date().toISOString(),
        apiName: config.name,
        baseUrl: config.baseUrl,
        testConfiguration: {
            endpoints: testEndpoints.length,
            timeout: config.timeout,
            headers: config.headers,
            sampleEndpoints: testEndpoints.slice(0, 10)
        },
        recommendations: {
            idealRPS,
            conservativeRPS,
            recommendedPattern: idealRPS > 1 ? (allResults[allResults.length-1].successRate > allResults[allResults.length-2].successRate ? 'distribuído' : 'burst') : 'burst'
        },
        results: allResults
    };
    
    require('fs').writeFileSync(filename, JSON.stringify(reportData, null, 2));
    console.log(`\n💾 Relatório salvo em: ${filename}`);
    
    // Fechar conexão com banco
    await pool.end();
    
    return reportData;
}

// ============================================================================
// EXECUÇÃO
// ============================================================================

// Executar os testes se o script for chamado diretamente
if (require.main === module) {
    // Verificar se foi passado um argumento para especificar a API
    const apiKey = process.argv[2];
    
    if (apiKey && !API_CONFIGS[apiKey]) {
        console.error(`❌ API '${apiKey}' não encontrada. APIs disponíveis: ${Object.keys(API_CONFIGS).join(', ')}`);
        process.exit(1);
    }
    
    runCapacityTests(apiKey)
        .then(results => {
            console.log('\n✅ Testes concluídos com sucesso!');
            console.log(`📊 Use a configuração recomendada: ${results.recommendations.idealRPS} RPS`);
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Erro durante os testes:', error.message);
            process.exit(1);
        });
}

module.exports = { 
    runCapacityTests, 
    testRPSConfiguration, 
    API_CONFIGS,
    // Função para adicionar nova configuração de API
    addApiConfig: (key, config) => {
        API_CONFIGS[key] = config;
    }
}; 