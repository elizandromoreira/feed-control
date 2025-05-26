/**
 * Test script for Home Depot API with Cart API integration
 * 
 * This script tests both the regular API and the cart API for a product
 * that shows price as 0 in the regular API but has a real price in the cart.
 */

const HomeDepotApiService = require('./src/services/homeDepotApi');
const HomeDepotCartApi = require('./src/services/homeDepotCartApi');
const logger = require('./src/config/logging')();

// Test product ID - this is the product ID from the example response
const TEST_PRODUCT_ID = '304685815'; // Sinkin Smoke/Nickel Dish Rack

async function testCombinedApis() {
  try {
    console.log('Starting Home Depot Combined API test...');
    
    // Create instances of both API services
    const apiService = new HomeDepotApiService();
    const cartApi = new HomeDepotCartApi();
    
    // Step 1: Test the regular API first
    console.log(`\n1. Checking product via regular API: ${TEST_PRODUCT_ID}`);
    const regularApiResult = await apiService.fetchProductData(TEST_PRODUCT_ID);
    
    console.log('Regular API Result:');
    console.log('- Price:', regularApiResult.price || 0);
    console.log('- Available:', regularApiResult.available);
    console.log('- Stock:', regularApiResult.stock);
    
    // Step 2: Test the cart API directly
    console.log(`\n2. Checking price via cart API: ${TEST_PRODUCT_ID}`);
    const cartApiResult = await cartApi.checkPriceInCart(TEST_PRODUCT_ID);
    
    console.log('Cart API Result:', JSON.stringify(cartApiResult, null, 2));
    
    // Step 3: Test the combined flow (fetchProductDataWithRetry)
    console.log(`\n3. Testing combined flow with fetchProductDataWithRetry: ${TEST_PRODUCT_ID}`);
    const combinedResult = await apiService.fetchProductDataWithRetry(TEST_PRODUCT_ID);
    
    console.log('Combined Result:');
    console.log('- Price:', combinedResult.price);
    console.log('- Available:', combinedResult.available);
    console.log('- Stock:', combinedResult.stock);
    console.log('- Quantity would be:', apiService.calculateQuantity(
      combinedResult.stock, 
      combinedResult.available, 
      TEST_PRODUCT_ID, 
      combinedResult.price
    ));
    
    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Regular API Price: $${regularApiResult.price || 0}`);
    console.log(`Cart API Price: $${cartApiResult.success ? cartApiResult.price : 'N/A'}`);
    console.log(`Final Price after combined flow: $${combinedResult.price}`);
    
    if (combinedResult.price > 0) {
      console.log('✅ Success! The combined flow correctly retrieved the price.');
    } else {
      console.log('❌ The combined flow did not retrieve a price > 0.');
    }
  } catch (error) {
    console.error('Error in test:', error.message);
  }
}

// Run the test
testCombinedApis().catch(err => {
  console.error('Unhandled error in test:', err);
  process.exit(1);
});