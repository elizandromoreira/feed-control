const axios = require('axios');
const retry = require('async-retry');
const { Pool } = require('pg');

// Configuração correta do banco de dados
const pool = new Pool({
  host: 'aws-0-us-east-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.bvbnofnnbfdlnpuswlgy',
  password: 'Elizandro@2024'
});

// SKUs problemáticos identificados nos logs
const problematicSkus = ['6503950', '6541068', '6560713'];
const workingSkus = ['6490573'];
const allTestSkus = [...problematicSkus, ...workingSkus];

// Configurações de teste
const API_BASE_URL = 'http://167.114.223.83:3005/bb/api';
const STOCK_LEVEL = 33;

/**
 * Teste simplificado: Comparar API vs Logs
 */
async function testApiVsLogs() {
  console.log('\n=== TESTE: COMPARAÇÃO API vs LOGS ===');
  
  for (const sku of allTestSkus) {
    console.log(`\n--- SKU: ${sku} ---`);
    
    try {
      // 1. Testar API diretamente
      console.log('1. Testando API diretamente:');
      const response = await axios.get(`${API_BASE_URL}/${sku}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'FeedControl/1.0' },
        timeout: 30000
      });
      
      console.log(`   Status: ${response.status}`);
      console.log(`   Success: ${response.data?.success}`);
      console.log(`   Availability: ${response.data?.data?.availability}`);
      console.log(`   Price: ${response.data?.data?.price}`);
      console.log(`   Brand: ${response.data?.data?.brand}`);
      
      // 2. Simular processamento do provider
      console.log('2. Simulando processamento do provider:');
      
      // Validação da estrutura (igual ao código do provider)
      if (response.status !== 200) {
        console.log(`   ❌ FALHA: Status não é 200`);
        continue;
      }
      
      if (!response.data || !response.data.success || !response.data.data) {
        console.log(`   ❌ FALHA: Estrutura de resposta inválida`);
        continue;
      }
      
      // Transformação dos dados (igual ao código do provider)
      const apiData = response.data.data;
      const isAvailable = apiData.availability === "InStock";
      const quantity = isAvailable ? STOCK_LEVEL : 0;
      
      console.log(`   ✅ Processamento bem-sucedido:`);
      console.log(`   - API Availability: ${apiData.availability}`);
      console.log(`   - Is Available: ${isAvailable}`);
      console.log(`   - Calculated Quantity: ${quantity}`);
      console.log(`   - Expected Result: ${isAvailable ? 'IN STOCK' : 'OUT OF STOCK'}`);
      
      // 3. Verificar estado atual no banco
      console.log('3. Estado atual no banco:');
      const dbResult = await pool.query(
        'SELECT sku, quantity, availability, supplier_price, brand, atualizado, last_update FROM produtos WHERE sku = $1',
        [sku]
      );
      
      if (dbResult.rows.length > 0) {
        const row = dbResult.rows[0];
        console.log(`   - DB Quantity: ${row.quantity}`);
        console.log(`   - DB Availability: ${row.availability}`);
        console.log(`   - DB Price: ${row.supplier_price}`);
        console.log(`   - DB Brand: ${row.brand}`);
        console.log(`   - Atualizado: ${row.atualizado}`);
        console.log(`   - Last Update: ${row.last_update}`);
        
        // 4. Comparação
        console.log('4. Análise da discrepância:');
        if (isAvailable && row.quantity === 0) {
          console.log(`   ❌ PROBLEMA: API diz InStock mas DB tem quantity 0`);
        } else if (!isAvailable && row.quantity > 0) {
          console.log(`   ❌ PROBLEMA: API diz OutOfStock mas DB tem quantity > 0`);
        } else {
          console.log(`   ✅ CONSISTENTE: API e DB estão alinhados`);
        }
      } else {
        console.log(`   ❌ SKU não encontrado no banco`);
      }
      
    } catch (error) {
      console.log(`   ❌ ERRO: ${error.message}`);
      console.log(`   - Error Code: ${error.code}`);
    }
  }
}

/**
 * Teste de retry com logs detalhados
 */
async function testRetryWithDetailedLogs() {
  console.log('\n=== TESTE: RETRY COM LOGS DETALHADOS ===');
  
  // Testar apenas um SKU problemático
  const testSku = '6503950';
  console.log(`\nTestando retry detalhado para SKU: ${testSku}`);
  
  let attemptCount = 0;
  
  try {
    const result = await retry(
      async (bail) => {
        attemptCount++;
        console.log(`\n--- Tentativa ${attemptCount} ---`);
        
        const startTime = Date.now();
        const response = await axios.get(`${API_BASE_URL}/${testSku}`, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'FeedControl/1.0' },
          timeout: 30000
        });
        const endTime = Date.now();
        
        console.log(`Tempo de resposta: ${endTime - startTime}ms`);
        console.log(`Status: ${response.status}`);
        console.log(`Data type: ${typeof response.data}`);
        console.log(`Response size: ${JSON.stringify(response.data).length} chars`);
        
        // Validação detalhada
        console.log('Validações:');
        console.log(`- Status === 200: ${response.status === 200}`);
        console.log(`- response.data exists: ${!!response.data}`);
        console.log(`- response.data.success: ${response.data?.success}`);
        console.log(`- response.data.data exists: ${!!response.data?.data}`);
        
        if (response.status !== 200) {
          throw new Error(`API returned status ${response.status}`);
        }
        
        if (!response.data || !response.data.success || !response.data.data) {
          if (response.data && response.data.success === false) {
            bail(new Error(`API indicated SKU ${testSku} not found, not retrying.`));
            return;
          }
          throw new Error(`Invalid or unsuccessful API response structure for SKU ${testSku}`);
        }
        
        console.log('✅ Validação passou - resposta válida');
        return response;
      },
      {
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 5000,
        onRetry: (error, attempt) => {
          console.log(`🔄 Retry ${attempt}/3: ${error.message}`);
        }
      }
    );
    
    console.log(`\n✅ SUCESSO final após ${attemptCount} tentativas`);
    console.log(`Final availability: ${result.data?.data?.availability}`);
    
  } catch (error) {
    console.log(`\n❌ FALHA final após ${attemptCount} tentativas: ${error.message}`);
    
    // Simular o que o provider faria em caso de erro
    console.log('\nSimulando resposta de erro do provider:');
    const errorResponse = {
      sku: testSku,
      price: 0,
      brand: null,
      stock: 0,
      available: false,
      handlingTime: 4, // 1 + 3
      apiError: true
    };
    console.log('Resposta de erro:', JSON.stringify(errorResponse, null, 2));
  }
}

/**
 * Função principal
 */
async function runTests() {
  console.log('🔍 INICIANDO WORKFLOW DE TESTES FOCADOS');
  console.log('=====================================');
  
  try {
    await testApiVsLogs();
    await testRetryWithDetailedLogs();
    
    console.log('\n✅ TESTES CONCLUÍDOS');
    
  } catch (error) {
    console.error('\n❌ ERRO DURANTE OS TESTES:', error.message);
  } finally {
    await pool.end();
  }
}

// Executar os testes
runTests(); 