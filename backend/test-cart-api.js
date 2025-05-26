/**
 * Test script for Home Depot Cart API
 * 
 * This script tests the functionality of checking product prices
 * by adding them to a cart for products that show price as 0.
 */

const HomeDepotCartApi = require('./src/services/homeDepotCartApi');
const logger = require('./src/config/logging')();

// Test product ID - this is the product ID from the example response
const TEST_PRODUCT_ID = '304685815'; // Sinkin Smoke/Nickel Dish Rack

async function testCartApi() {
  try {
    console.log('Starting Home Depot Cart API test...');
    
    // Create an instance of the cart API service
    const cartApi = new HomeDepotCartApi();
    
    // Test checking price in cart
    console.log(`Checking price for product ID: ${TEST_PRODUCT_ID}`);
    const result = await cartApi.checkPriceInCart(TEST_PRODUCT_ID);
    
    console.log('Result:', JSON.stringify(result, null, 2));
    
    if (result.success) {
      console.log(`✅ Success! Price: $${result.price}`);
    } else {
      console.log(`❌ Failed to get price: ${result.message}`);
    }
  } catch (error) {
    console.error('Error in test:', error.message);
  }
}

// Run the test
testCartApi().catch(err => {
  console.error('Unhandled error in test:', err);
  process.exit(1);
});