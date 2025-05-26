/**
 * Provider Unit Test
 * 
 * Basic tests to validate provider implementations
 */

const assert = require('assert');
const { getProviderFactory } = require('../../src/providers/provider-factory');
const HomeDepotProvider = require('../../src/providers/home-depot-provider');
const ZoroProvider = require('../../src/providers/zoro-provider');

describe('Provider Architecture Tests', () => {
  describe('Provider Factory', () => {
    it('should return a singleton instance', () => {
      const factory1 = getProviderFactory();
      const factory2 = getProviderFactory();
      assert.strictEqual(factory1, factory2, 'Factory should be a singleton');
    });

    it('should register default providers', () => {
      const factory = getProviderFactory();
      assert(factory.hasProvider('homedepot'), 'Home Depot provider should be registered');
      assert(factory.hasProvider('zoro'), 'Zoro provider should be registered');
    });

    it('should create provider instances', () => {
      const factory = getProviderFactory();
      const homeDepotProvider = factory.getProvider('homedepot');
      const zoroProvider = factory.getProvider('zoro');
      
      assert(homeDepotProvider instanceof HomeDepotProvider, 'Should create a Home Depot provider instance');
      assert(zoroProvider instanceof ZoroProvider, 'Should create a Zoro provider instance');
    });

    it('should throw error for non-existent provider', () => {
      const factory = getProviderFactory();
      assert.throws(() => {
        factory.getProvider('non-existent');
      }, /Provider not found/, 'Should throw error for non-existent provider');
    });
  });

  describe('Home Depot Provider', () => {
    let provider;
    
    beforeEach(() => {
      provider = new HomeDepotProvider({
        apiBaseUrl: 'http://test-api-url.com',
        requestsPerSecond: 5
      });
    });
    
    it('should return correct ID and name', () => {
      assert.strictEqual(provider.getId(), 'homedepot', 'Provider ID should be homedepot');
      assert.strictEqual(provider.getName(), 'Home Depot', 'Provider name should be Home Depot');
    });
    
    it('should create API service with correct configuration', () => {
      const apiService = provider.getApiService();
      assert(apiService, 'API service should be created');
      // Additional checks for API service would depend on implementation details
    });
    
    it('should provide SQL queries for Phase 2', () => {
      const queries = provider.getPhase2Queries();
      assert(queries.extractUpdatedData, 'Should provide extractUpdatedData query');
      assert(queries.resetUpdatedProducts, 'Should provide resetUpdatedProducts query');
      assert(queries.extractUpdatedData.includes("WHERE atualizado = 1 AND source = 'Home Depot'"), 
        'Query should filter by Home Depot source');
    });
  });

  describe('Zoro Provider', () => {
    let provider;
    
    beforeEach(() => {
      provider = new ZoroProvider({
        apiBaseUrl: 'http://test-zoro-api.com',
        requestsPerSecond: 3
      });
    });
    
    it('should return correct ID and name', () => {
      assert.strictEqual(provider.getId(), 'zoro', 'Provider ID should be zoro');
      assert.strictEqual(provider.getName(), 'Zoro', 'Provider name should be Zoro');
    });
    
    it('should provide SQL queries for Phase 2', () => {
      const queries = provider.getPhase2Queries();
      assert(queries.extractUpdatedData, 'Should provide extractUpdatedData query');
      assert(queries.resetUpdatedProducts, 'Should provide resetUpdatedProducts query');
      assert(queries.extractUpdatedData.includes("WHERE atualizado = 1 AND source = 'Zoro'"), 
        'Query should filter by Zoro source');
    });
  });
}); 