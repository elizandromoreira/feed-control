/**
 * Home Depot Cart API Service
 * 
 * This service handles checking product prices by adding them to a cart
 * for products that only show their price when added to cart.
 */

const axios = require('axios');
const logger = require('../config/logging')();

class HomeDepotCartApi {
  /**
   * Create a new instance of the Home Depot Cart API service
   */
  constructor() {
    this.apiUrl = 'https://apionline.homedepot.com/federation-gateway/graphql?opname=addToCart';
    this.zipCode = process.env.HOMEDEPOT_ZIP_CODE || '32839'; // Default zip code
  }

  /**
   * Check the price of a product by adding it to cart
   * @param {string} itemId - The product ID to check
   * @returns {Promise<Object>} - Object with price information or error
   */
  async checkPriceInCart(itemId) {
    try {
      logger.info(`Checking price for product ${itemId} by adding to cart`);
      
      // Prepare the GraphQL query for adding to cart
      const data = JSON.stringify({
        query: `mutation addToCart($cartRequest: CartInfoRequest!, $requestContext: RequestContext) {
          addToCart(cartRequest: $cartRequest, requestContext: $requestContext) {
            items {
              id
              quantity
              product {
                itemId
                pricing {
                  value
                  original
                  total
                  totalWithNoDiscount
                  type
                  discount {
                    percentOff
                    dollarOff
                    __typename
                  }
                  __typename
                }
                __typename
              }
              __typename
            }
            __typename
          }
        }`,
        variables: {
          "cartRequest": {
            "filterItem": true,
            "localization": {
              "primaryStoreId": 6367
            },
            "items": {
              "delivery": [
                {
                  "itemId": itemId,
                  "quantity": "1",
                  "type": "sth",
                  "location": this.zipCode
                }
              ]
            }
          },
          "requestContext": {
            "isBrandPricingPolicyCompliant": false
          }
        }
      });

      // Configure the request
      const config = {
        method: 'post',
        url: this.apiUrl,
        headers: { 
          'accept': '*/*', 
          'content-type': 'application/json', 
          'origin': 'https://www.homedepot.com', 
          'referer': 'https://www.homedepot.com/', 
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
        },
        data: data,
        timeout: 10000 // 10 second timeout
      };

      // Make the request
      let response;
      try {
        response = await axios.request(config);
      } catch (error) {
        // Handle specific error codes
        if (error.response) {
          const status = error.response.status;
          if (status === 403) {
            logger.warn(`Access forbidden (403) when checking cart price for ${itemId}. This is expected if not authenticated.`);
            return {
              success: false,
              price: 0,
              message: 'Access forbidden - authentication required'
            };
          }
        }
        
        // Re-throw for general error handling
        throw error;
      }
      
      // Extract price information from the response
      if (response &&
          response.data &&
          response.data.data &&
          response.data.data.addToCart &&
          response.data.data.addToCart.items &&
          response.data.data.addToCart.items.length > 0) {
        
        const item = response.data.data.addToCart.items[0];
        
        if (item.product && item.product.pricing) {
          const pricing = item.product.pricing;
          
          logger.info(`Successfully retrieved price for product ${itemId}: $${pricing.value}`);
          
          return {
            success: true,
            price: parseFloat(pricing.value) || 0,
            originalPrice: parseFloat(pricing.original) || 0,
            totalPrice: parseFloat(pricing.total) || 0
          };
        }
      }
      
      // If we couldn't extract price information
      logger.warn(`Could not extract price information for product ${itemId} from cart response`);
      return {
        success: false,
        price: 0,
        message: 'Could not extract price information from response'
      };
      
    } catch (error) {
      // Log the error details
      logger.error(`Error checking price for product ${itemId} in cart: ${error.message}`);
      
      // Return a structured error response
      return {
        success: false,
        price: 0,
        message: `Error: ${error.message}`
      };
    }
  }
}

module.exports = HomeDepotCartApi;