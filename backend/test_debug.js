const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres.bvbnofnnbfdlnpuswlgy',
  host: process.env.DB_HOST || 'aws-0-us-east-1.pooler.supabase.com',
  database: process.env.DB_NAME || 'postgres',
  password: process.env.DB_PASSWORD || 'Bi88An6B9L0EIihL',
  port: process.env.DB_PORT || 6543,
});

const problematicSkus = ['6503950', '6541068', '6560713'];
const workingSkus = ['6490573'];
const allTestSkus = [...problematicSkus, ...workingSkus];
const API_BASE_URL = 'http://167.114.223.83:3005/bb/api';
const STOCK_LEVEL = 33;

async function testApiVsDatabase() {
  console.log('=== TESTE: API vs DATABASE ===\n');
  
  for (const sku of allTestSkus) {
    console.log(`--- SKU: ${sku} ---`);
    
    try {
      // 1. Testar API
      const response = await axios.get(`${API_BASE_URL}/${sku}`, {
        timeout: 30000
      });
      
      console.log(`API Response:`);
      console.log(`  Status: ${response.status}`);
      console.log(`  Success: ${response.data?.success}`);
      console.log(`  Availability: ${response.data?.data?.availability}`);
      console.log(`  Price: ${response.data?.data?.price}`);
      
      // 2. Verificar banco
      const dbResult = await pool.query(
        'SELECT sku, quantity, availability, supplier_price, atualizado FROM produtos WHERE sku = $1',
        [sku]
      );
      
      if (dbResult.rows.length > 0) {
        const row = dbResult.rows[0];
        console.log(`Database:`);
        console.log(`  Quantity: ${row.quantity}`);
        console.log(`  Availability: ${row.availability}`);
        console.log(`  Price: ${row.supplier_price}`);
        console.log(`  Atualizado: ${row.atualizado}`);
        
        // 3. Análise
        const apiAvailable = response.data?.data?.availability === 'InStock';
        const dbQuantity = row.quantity;
        
        console.log(`Analysis:`);
        console.log(`  API says: ${apiAvailable ? 'IN STOCK' : 'OUT OF STOCK'}`);
        console.log(`  DB quantity: ${dbQuantity}`);
        
        if (apiAvailable && dbQuantity === 0) {
          console.log(`  ❌ PROBLEMA: API InStock mas DB quantity 0`);
        } else if (!apiAvailable && dbQuantity > 0) {
          console.log(`  ❌ PROBLEMA: API OutOfStock mas DB quantity > 0`);
        } else {
          console.log(`  ✅ CONSISTENTE`);
        }
      } else {
        console.log(`Database: SKU não encontrado`);
      }
      
    } catch (error) {
      console.log(`❌ ERRO: ${error.message}`);
    }
    
    console.log('');
  }
}

async function run() {
  try {
    await testApiVsDatabase();
  } catch (error) {
    console.error('Erro:', error.message);
  } finally {
    await pool.end();
  }
}

run(); 