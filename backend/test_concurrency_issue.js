const axios = require('axios');
const retry = require('async-retry');
const { Pool } = require('pg');

// Configuração do banco
const pool = new Pool({
  user: process.env.DB_USER || 'postgres.bvbnofnnbfdlnpuswlgy',
  host: process.env.DB_HOST || 'aws-0-us-east-1.pooler.supabase.com',
  database: process.env.DB_NAME || 'postgres',
  password: process.env.DB_PASSWORD || 'Bi88An6B9L0EIihL',
  port: process.env.DB_PORT || 6543,
});

// Configurações
const API_BASE_URL = 'http://167.114.223.83:3005/bb/api';
const STOCK_LEVEL = 33;

// SKUs para teste
const testSkus = ['6503950', '6541068', '6560713', '6490573'];

/**
 * Simula exatamente o updateProductInDb do provider
 */
async function simulateUpdateProductInDb(sku) {
  const startTime = Date.now();
  console.log(`\n🔄 [${sku}] Iniciando updateProductInDb...`);
  
  try {
    // 1. Fetch product data (simula _fetchProductData)
    console.log(`📡 [${sku}] Fazendo requisição à API...`);
    const productData = await fetchProductDataSimulation(sku);
    
    if (productData.apiError) {
      console.log(`❌ [${sku}] API Error - retornando OutOfStock`);
      return { status: 'failed', message: 'API Error' };
    }
    
    // 2. Get current data from database
    console.log(`🗄️  [${sku}] Consultando banco de dados...`);
    const currentQuery = `SELECT supplier_price, quantity, availability, brand FROM produtos WHERE sku = $1`;
    const result = await pool.query(currentQuery, [sku]);
    
    if (result.rows.length === 0) {
      console.log(`❌ [${sku}] Produto não encontrado no banco`);
      return { status: 'failed', message: 'Produto não encontrado' };
    }
    
    const currentData = result.rows[0];
    console.log(`📊 [${sku}] Dados atuais do banco:`, currentData);
    
    // 3. Calculate new values
    const newPrice = productData.price;
    const newBrand = productData.brand;
    const newQuantity = productData.stock;
    const newAvailability = productData.available ? 'inStock' : 'outOfStock';
    
    console.log(`📊 [${sku}] Novos valores calculados:`);
    console.log(`  - Price: ${currentData.supplier_price} -> ${newPrice}`);
    console.log(`  - Quantity: ${currentData.quantity} -> ${newQuantity}`);
    console.log(`  - Availability: ${currentData.availability} -> ${newAvailability}`);
    console.log(`  - Brand: '${currentData.brand}' -> '${newBrand}'`);
    
    // 4. Detect changes
    const changes = [];
    if (Number(currentData.supplier_price) !== newPrice) changes.push(`Price: ${currentData.supplier_price} -> ${newPrice}`);
    if (Number(currentData.quantity) !== newQuantity) changes.push(`Quantity: ${currentData.quantity} -> ${newQuantity}`);
    if (String(currentData.availability) !== newAvailability) changes.push(`Availability: ${currentData.availability} -> ${newAvailability}`);
    if (String(currentData.brand || '') !== newBrand) changes.push(`Brand: '${currentData.brand || ''}' -> '${newBrand}'`);
    
    if (changes.length === 0) {
      console.log(`✅ [${sku}] Nenhuma mudança detectada`);
      return { status: 'no_update', message: 'No changes detected' };
    }
    
    console.log(`🔄 [${sku}] Mudanças detectadas: ${changes.join(', ')}`);
    
    // 5. Update database
    console.log(`💾 [${sku}] Atualizando banco de dados...`);
    const updateQuery = `
      UPDATE produtos SET 
        supplier_price=$1, quantity=$2, availability=$3, brand=$4,
        last_update=$5, atualizado=$6
      WHERE sku = $7`;
    
    await pool.query(updateQuery, [
      newPrice, newQuantity, newAvailability, newBrand,
      new Date(), 4, sku
    ]);
    
    const endTime = Date.now();
    console.log(`✅ [${sku}] Atualização concluída em ${endTime - startTime}ms`);
    
    return { status: 'updated' };
    
  } catch (error) {
    const endTime = Date.now();
    console.log(`❌ [${sku}] ERRO após ${endTime - startTime}ms: ${error.message}`);
    return { status: 'failed', message: error.message };
  }
}

/**
 * Simula _fetchProductData
 */
async function fetchProductDataSimulation(sku) {
  const url = `${API_BASE_URL}/${sku}`;
  
  try {
    const response = await retry(
      async (bail) => {
        const result = await axios.get(url, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'FeedControl/1.0' },
          timeout: 30000
        });
        
        if (result.status !== 200) {
          throw new Error(`API returned status ${result.status}`);
        }
        if (!result.data || !result.data.success || !result.data.data) {
          if (result.data && result.data.success === false) {
            bail(new Error(`API indicated SKU ${sku} not found, not retrying.`));
            return;
          }
          throw new Error(`Invalid or unsuccessful API response structure for SKU ${sku}`);
        }
        
        return result;
      },
      {
        retries: 3,
        minTimeout: 1000,
        maxTimeout: 5000
      }
    );
    
    const apiData = response.data.data;
    const isAvailable = apiData.availability === "InStock";
    const quantity = isAvailable ? STOCK_LEVEL : 0;
    
    return {
      sku: sku,
      price: apiData.price || 0,
      brand: apiData.brand || '',
      stock: quantity,
      available: isAvailable,
      apiError: false
    };
    
  } catch (error) {
    return {
      sku: sku,
      price: 0,
      brand: null,
      stock: 0,
      available: false,
      apiError: true
    };
  }
}

/**
 * Teste de processamento sequencial
 */
async function testSequentialProcessing() {
  console.log('\n🔍 TESTE: PROCESSAMENTO SEQUENCIAL');
  console.log('==================================');
  
  for (const sku of testSkus) {
    const result = await simulateUpdateProductInDb(sku);
    console.log(`📋 [${sku}] Resultado: ${result.status}`);
  }
}

/**
 * Teste de processamento simultâneo (como no provider)
 */
async function testConcurrentProcessing() {
  console.log('\n🔍 TESTE: PROCESSAMENTO SIMULTÂNEO (BURST MODE)');
  console.log('===============================================');
  
  console.log(`🚀 Processando ${testSkus.length} SKUs simultaneamente...`);
  
  const promises = testSkus.map(async (sku) => {
    const result = await simulateUpdateProductInDb(sku);
    return { sku, result };
  });
  
  const results = await Promise.all(promises);
  
  console.log('\n📋 RESULTADOS DO PROCESSAMENTO SIMULTÂNEO:');
  results.forEach(({ sku, result }) => {
    console.log(`  [${sku}]: ${result.status} ${result.message ? `(${result.message})` : ''}`);
  });
}

/**
 * Verificar estado final no banco
 */
async function checkFinalDatabaseState() {
  console.log('\n🔍 ESTADO FINAL NO BANCO DE DADOS');
  console.log('=================================');
  
  for (const sku of testSkus) {
    const result = await pool.query(
      'SELECT sku, quantity, availability, supplier_price, atualizado FROM produtos WHERE sku = $1',
      [sku]
    );
    
    if (result.rows.length > 0) {
      const row = result.rows[0];
      console.log(`[${sku}]: quantity=${row.quantity}, availability=${row.availability}, price=${row.supplier_price}, atualizado=${row.atualizado}`);
    } else {
      console.log(`[${sku}]: Não encontrado`);
    }
  }
}

/**
 * Função principal
 */
async function runConcurrencyTest() {
  console.log('🔍 TESTE DE CONDIÇÕES DE CORRIDA');
  console.log('================================');
  
  try {
    // Primeiro teste sequencial para baseline
    await testSequentialProcessing();
    
    // Aguardar um pouco
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Depois teste simultâneo para reproduzir o problema
    await testConcurrentProcessing();
    
    // Verificar estado final
    await checkFinalDatabaseState();
    
  } catch (error) {
    console.error('❌ Erro durante o teste:', error.message);
  } finally {
    await pool.end();
  }
}

// Executar teste
runConcurrencyTest(); 