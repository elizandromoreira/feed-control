/**
 * Test script for HomeDepotApiService price check
 */

const HomeDepotApiService = require('./src/services/homeDepotApi');

// Create an instance of the API service
const api = new HomeDepotApiService();

// Test with price = 0
const resultWithZeroPrice = api.calculateQuantity(10, true, 'test-sku', 0);
console.log('Test with price=0:', resultWithZeroPrice);

// Test with price = 10
const resultWithNormalPrice = api.calculateQuantity(10, true, 'test-sku', 10);
console.log('Test with price=10:', resultWithNormalPrice);

// Test with price = null
const resultWithNullPrice = api.calculateQuantity(10, true, 'test-sku', null);
console.log('Test with price=null:', resultWithNullPrice);