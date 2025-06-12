const axios = require('axios');
const retry = require('async-retry');

// Configurações idênticas ao provider
const API_BASE_URL = 'http://167.114.223.83:3005/bb/api';
const STOCK_LEVEL = 33;

// SKUs problemáticos
const problematicSkus = ['6503950', '6541068', '6560713'];
const workingSkus = ['6490573'];

/**
 * Simula exatamente a função _fetchProductData do provider
 */
async function simulateFetchProductData(sku) {
  const url = `${API_BASE_URL}/${sku}`;
  
  console.log(`\n=== SIMULANDO _fetchProductData para SKU: ${sku} ===`);
  console.log(`URL: ${url}`);
  
  try {
    console.log(`📡 Iniciando retry mechanism...`);
    
    let retryCount = 0;
    const response = await retry(
      async (bail) => {
        retryCount++;
        console.log(`  🔄 Tentativa ${retryCount}: Fazendo requisição...`);
        
        const result = await axios.get(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'FeedControl/1.0' },
          timeout: 30000
        });
        
        console.log(`  📊 Status recebido: ${result.status}`);
        console.log(`  📊 Data type: ${typeof result.data}`);
        console.log(`  📊 Data exists: ${!!result.data}`);
        console.log(`  📊 Success field: ${result.data?.success}`);
        console.log(`  📊 Data.data exists: ${!!result.data?.data}`);
        
        // Validação da estrutura da resposta - EXATAMENTE como no provider
        if (result.status !== 200) {
          console.log(`  ❌ FALHA: Status não é 200`);
          throw new Error(`API returned status ${result.status}`);
        }
        
        if (!result.data || !result.data.success || !result.data.data) {
          console.log(`  ❌ FALHA: Estrutura de resposta inválida`);
          console.log(`    - result.data: ${!!result.data}`);
          console.log(`    - result.data.success: ${result.data?.success}`);
          console.log(`    - result.data.data: ${!!result.data?.data}`);
          
          // Não fazer retry para respostas inválidas, mas que indicam um SKU inexistente.
          if (result.data && result.data.success === false) {
            console.log(`  🛑 BAIL: API indicou SKU não encontrado`);
            bail(new Error(`API indicated SKU ${sku} not found, not retrying.`));
            return;
          }
          throw new Error(`Invalid or unsuccessful API response structure for SKU ${sku}`);
        }
        
        console.log(`  ✅ VALIDAÇÃO PASSOU: Resposta válida`);
        return result;
      },
      {
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 5000,
        onRetry: (error, attempt) => {
          console.log(`  🔄 Retry ${attempt}/3 para SKU ${sku}: ${error.message}`);
        }
      }
    );
    
    console.log(`✅ SUCESSO: Resposta válida obtida após ${retryCount} tentativas`);
    
    // Simular transformação dos dados
    const responseData = response.data;
    const transformedData = simulateTransformProductData(responseData.data, sku);
    
    console.log(`📦 DADOS TRANSFORMADOS:`, transformedData);
    return transformedData;
    
  } catch (error) {
    console.log(`❌ ERRO FINAL após retries: ${error.message}`);
    console.log(`📦 RETORNANDO DADOS DE ERRO (OutOfStock)`);
    
    // Se todas as tentativas falharem, retorna um objeto "OutOfStock" - EXATAMENTE como no provider
    const errorData = {
      sku: sku,
      price: 0,
      brand: null,
      stock: 0,
      available: false,
      handlingTime: 4, // 1 + 3
      apiError: true
    };
    
    console.log(`📦 DADOS DE ERRO:`, errorData);
    return errorData;
  }
}

/**
 * Simula exatamente a função _transformProductData do provider
 */
function simulateTransformProductData(apiData, sku) {
  console.log(`🔄 TRANSFORMANDO DADOS para SKU ${sku}:`);
  console.log(`  - API Data:`, apiData);
  
  const isAvailable = apiData.availability === "InStock";
  const quantity = isAvailable ? STOCK_LEVEL : 0;
  const totalHandlingTime = 1 + 3; // handlingTimeOmd + providerSpecificHandlingTime
  
  console.log(`  - Availability check: "${apiData.availability}" === "InStock" = ${isAvailable}`);
  console.log(`  - Calculated quantity: ${quantity}`);
  
  const result = {
    sku: sku,
    price: apiData.price || 0,
    brand: apiData.brand || '',
    stock: quantity,
    available: isAvailable,
    handlingTime: totalHandlingTime
  };
  
  console.log(`  - Final result:`, result);
  return result;
}

/**
 * Teste principal
 */
async function runRetrySimulation() {
  console.log('🔍 SIMULAÇÃO COMPLETA DO MECANISMO DE RETRY');
  console.log('===========================================');
  
  const allSkus = [...problematicSkus, ...workingSkus];
  
  for (const sku of allSkus) {
    try {
      const result = await simulateFetchProductData(sku);
      
      console.log(`\n📋 RESUMO para SKU ${sku}:`);
      console.log(`  - Sucesso: ${!result.apiError}`);
      console.log(`  - Available: ${result.available}`);
      console.log(`  - Stock: ${result.stock}`);
      console.log(`  - Price: ${result.price}`);
      
      if (result.apiError) {
        console.log(`  ⚠️  ESTE SKU SERÁ MARCADO COMO OUT OF STOCK NO BANCO!`);
      }
      
    } catch (error) {
      console.log(`💥 ERRO INESPERADO para SKU ${sku}: ${error.message}`);
    }
    
    console.log('\n' + '='.repeat(60));
  }
}

// Executar simulação
runRetrySimulation(); 