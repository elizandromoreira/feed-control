/**
 * Home Depot Provider
 *
 * This module implements the provider interface for the Home Depot supplier,
 * encapsulating all logic for fetching and updating Home Depot products.
 */

const fs = require('fs').promises;
const path = require('path');
const BaseProvider = require('./provider-interface');
const DatabaseService = require('../services/database');
const HomeDepotApiService = require('../services/homeDepotApi');
const { DB_CONFIG } = require('../config/db');
const logger = require('../config/logging')();
const SimpleQueue = require('../utils/simple-queue');

// Define constants for file paths to avoid magic strings
const LOG_DIR_PATH = path.join(__dirname, '../../logs');

class HomeDepotProvider extends BaseProvider {
    /**
     * @param {Object} config - Provider configuration from the database.
     */
    constructor(config = {}) {
        super(config);
        
        // --- Configuration from DB or fallbacks ---
        this.apiBaseUrl = config.apiBaseUrl || process.env.API_BASE_URL;
        this.handlingTimeOmd = config.handlingTimeOmd ?? 1;
        this.providerSpecificHandlingTime = config.providerSpecificHandlingTime ?? 2; // Not used - calculated from API dates
        this.updateFlagValue = config.updateFlagValue ?? 1; // Default to '1' for Home Depot
        this.stockLevel = config.stockLevel ?? 7; // Use value from config
        const requestsPerSecond = config.requestsPerSecond; // DEVE vir do banco de dados

        // --- Services ---
        this.dbService = new DatabaseService(DB_CONFIG);
        this.apiService = new HomeDepotApiService(this.apiBaseUrl, requestsPerSecond, this.stockLevel);

        // --- State Management ---
        this.emptyDataSkus = [];
        this.problematicProducts = [];
        this.failedProducts = [];
        this.processedCount = 0;
        this.successCount = 0;
        this.errorCount = 0;
        this.inStockSet = new Set();
        this.outOfStockSet = new Set();
        this.totalRetries = 0;

        // Statistics tracking
        this.updateStats = {
            priceChanges: 0,
            quantityChanges: 0,
            availabilityChanges: 0,
            freightChanges: 0,
            leadTimeChanges: 0,
            brandChanges: 0,
            totalUpdates: 0
        };

        this.storeName = 'homedepot';
        this.logger = logger;
        this.logger.store(this.storeName, 'info', '--- HomeDepotProvider Configured Values ---');
        this.logger.store(this.storeName, 'info', `- Source: ${config.storeId ? 'Database' : 'Fallback/Env'}`);
        this.logger.store(this.storeName, 'info', `- OMD Handling Time: ${this.handlingTimeOmd}`);
        this.logger.store(this.storeName, 'info', `- Provider Handling Time: ${this.providerSpecificHandlingTime} (not used - calculated from API dates)`);
        this.logger.store(this.storeName, 'info', `- Update Flag Value: ${this.updateFlagValue}`);
        this.logger.store(this.storeName, 'info', `- Stock Level: ${this.stockLevel}`);
        this.logger.store(this.storeName, 'info', `- Stock Threshold: 4 (stock < 4 = outOfStock)`);
        this.logger.store(this.storeName, 'info', '-------------------------------------------');
    }

    async init() {
        if (!this.dbInitialized) {
            await this.dbService.init();
            this.dbInitialized = true;
            this.logger.store(this.storeName, 'info', 'Database connection initialized for HomeDepotProvider.');
        }
    }

    async close() {
        if (this.dbInitialized) {
            await this.dbService.close();
            this.dbInitialized = false;
            this.logger.store(this.storeName, 'info', 'Database connection closed for HomeDepotProvider.');
        }
    }

    getId() {
        return 'homedepot';
    }

    getName() {
        return 'Home Depot';
    }

    // --- Core Product Processing Logic ---

    async updateProductInDb(product) {
        try {
            // Buscar dados da API
            const productData = await this.apiService.fetchProductDataWithRetry(product.sku);
            
            // Log detalhado do retorno da API
            this.logger.store(this.storeName, 'debug', 
                `Product ${product.sku} fetchProductDataWithRetry returned: ${JSON.stringify({
                    sku: productData.sku,
                    stock: productData.stock,
                    available: productData.available,
                    price: productData.price,
                    productNotFound: productData.productNotFound,
                    error: productData.error
                })}`
            );
            
            // Verificar se há erro nos dados retornados
            if (productData.error || !productData) {
                this.logger.store(this.storeName, 'error', `Error fetching data for product ${product.sku}: ${productData.error || 'No data returned'}`);
                // Marcar produto como problemático
                this.problematicProducts.push(product.sku);
                await this.dbService.executeWithRetry(
                    'UPDATE produtos SET sku_problem = 1 WHERE sku = $1',
                    [product.sku]
                );
                return { status: 'failed', message: productData.error || 'No data returned' };
            }
            
            // Buscar dados atuais do banco
            const currentQuery = 'SELECT supplier_price, quantity, availability, brand, lead_time, lead_time_2, freight_cost FROM produtos WHERE sku = $1';
            const currentResult = await this.dbService.executeWithRetry(currentQuery, [product.sku]);
            
            if (currentResult.rows.length === 0) {
                this.logger.store(this.storeName, 'warn', `Product ${productData.sku} not found in DB. Skipping update.`);
                return { status: 'failed', message: 'Product not found in database' };
            }
            
            // Check if product was not found in API
            const isProductNotFound = productData.productNotFound === true;
            
            // Log dados recebidos para diagnóstico
            this.logger.store(this.storeName, 'debug', 
                `Product ${product.sku} API data: stock=${productData.stock}, available=${productData.available}, price=${productData.price}`
            );
            
            const { quantity, availability } = this.apiService.calculateQuantity(productData.stock, productData.available, productData.sku, productData.price);
            const correctedAvailability = quantity > 0 ? 'inStock' : 'outOfStock';

            // Add to appropriate set (ensures unique counting)
            if (correctedAvailability === 'inStock') {
                this.inStockSet.add(product.sku);
            } else {
                this.outOfStockSet.add(product.sku);
            }

            const homeDepotLeadTime = this.apiService.calculateDeliveryTime(productData.min_delivery_date, productData.max_delivery_date, productData.sku);
            
            // Use handlingTimeOmd from instance config
            let handlingTimeAmz = this.handlingTimeOmd + homeDepotLeadTime;
            if (handlingTimeAmz > 29) {
                this.logger.store(this.storeName, 'warn', `Handling time for ${product.sku} capped at 29 days (was ${handlingTimeAmz}).`);
                handlingTimeAmz = 29;
            }

            const newData = {
                supplier_price: productData.price || 0,
                freight_cost: productData.shipping_cost || 0,
                lead_time: this.handlingTimeOmd.toString(), // OMD handling time
                lead_time_2: homeDepotLeadTime, // Provider specific handling time
                quantity: quantity,
                availability: correctedAvailability,
                brand: productData.brand || '',
                handling_time_amz: handlingTimeAmz,
                atualizado: this.updateFlagValue, // Use updateFlagValue from instance config
                sku_problem: isProductNotFound
            };

            let hasChanges = false;
            const changes = [];
            
            // Compare and track changes - converting to numbers for proper comparison
            const oldPrice = parseFloat(currentResult.rows[0].supplier_price) || 0;
            const newPrice = parseFloat(newData.supplier_price) || 0;
            if (oldPrice !== newPrice) {
                changes.push(`  price: $${oldPrice} → $${newPrice}`);
                hasChanges = true;
                this.updateStats.priceChanges++;
            }
            
            const oldQuantity = parseInt(currentResult.rows[0].quantity) || 0;
            const newQuantity = parseInt(newData.quantity) || 0;
            if (oldQuantity !== newQuantity) {
                changes.push(`  quantity: ${oldQuantity} → ${newQuantity}`);
                hasChanges = true;
                this.updateStats.quantityChanges++;
            }
            
            if (currentResult.rows[0].availability !== newData.availability) {
                changes.push(`  availability: ${currentResult.rows[0].availability} → ${newData.availability}`);
                hasChanges = true;
                this.updateStats.availabilityChanges++;
            }
            
            const oldFreight = parseFloat(currentResult.rows[0].freight_cost) || 0;
            const newFreight = parseFloat(newData.freight_cost) || 0;
            if (oldFreight !== newFreight) {
                changes.push(`  freight_cost: $${oldFreight} → $${newFreight}`);
                hasChanges = true;
                this.updateStats.freightChanges++;
            }
            
            const oldLeadTime = parseInt(currentResult.rows[0].lead_time) || 0;
            const newLeadTime = parseInt(newData.lead_time) || 0;
            if (oldLeadTime !== newLeadTime) {
                changes.push(`  lead_time: ${oldLeadTime} → ${newLeadTime}`);
                hasChanges = true;
                this.updateStats.leadTimeChanges++;
            }
            
            const oldLeadTime2 = parseInt(currentResult.rows[0].lead_time_2) || 0;
            const newLeadTime2 = parseInt(newData.lead_time_2) || 0;
            if (oldLeadTime2 !== newLeadTime2) {
                changes.push(`  lead_time_2: ${oldLeadTime2} → ${newLeadTime2}`);
                hasChanges = true;
            }
            
            if (currentResult.rows[0].brand !== newData.brand) {
                changes.push(`  brand: "${currentResult.rows[0].brand}" → "${newData.brand}"`);
                hasChanges = true;
                this.updateStats.brandChanges++;
            }
            
            const oldHandlingTime = parseInt(currentResult.rows[0].handling_time_amz) || 0;
            const newHandlingTime = parseInt(newData.handling_time_amz) || 0;
            if (oldHandlingTime !== newHandlingTime) {
                changes.push(`  handling_time_amz: ${oldHandlingTime} → ${newHandlingTime}`);
                hasChanges = true;
            }

            // Log the comparison details for debugging
            this.logger.store(this.storeName, 'debug', `Product ${product.sku} comparison:`, {
                hasChanges,
                isProductNotFound,
                currentData: {
                    supplier_price: currentResult.rows[0].supplier_price,
                    freight_cost: currentResult.rows[0].freight_cost,
                    quantity: currentResult.rows[0].quantity,
                    availability: currentResult.rows[0].availability
                },
                newData: {
                    supplier_price: newData.supplier_price,
                    freight_cost: newData.freight_cost,
                    quantity: newData.quantity,
                    availability: newData.availability,
                    sku_problem: newData.sku_problem
                }
            });

            if (hasChanges || isProductNotFound) {
                const updateQuery = `
                    UPDATE produtos 
                    SET supplier_price = $1, freight_cost = $2, lead_time = $3, lead_time_2 = $4, 
                        quantity = $5, availability = $6, brand = $7, handling_time_amz = $8, 
                        last_update = $9, atualizado = $10, sku_problem = $11
                    WHERE sku = $12`;

                const values = [
                    newData.supplier_price,
                    newData.freight_cost,
                    newData.lead_time,
                    newData.lead_time_2,
                    newData.quantity,
                    newData.availability,
                    newData.brand,
                    newData.handling_time_amz,
                    new Date(),
                    newData.atualizado,
                    newData.sku_problem,
                    product.sku
                ];

                await this.dbService.executeWithRetry(updateQuery, values);
                
                if (isProductNotFound) {
                    this.logger.store(this.storeName, 'info', `Product ${product.sku} marked as problematic (not found in API)`);
                } else {
                    // Log structured changes
                    if (changes.length > 0) {
                        this.logger.store(this.storeName, 'info', `=== Product Update: ${product.sku} ===`);
                        changes.forEach(change => this.logger.store(this.storeName, 'info', change));
                    } else {
                        this.logger.store(this.storeName, 'info', `Product ${product.sku} updated successfully.`);
                    }
                }
                
                // Update statistics
                this.updateStats.totalUpdates++;

                return { status: 'updated', changes: hasChanges, productNotFound: isProductNotFound };
            } else {
                this.logger.store(this.storeName, 'debug', `No changes for product ${product.sku}. Skipping DB update.`);
                return { status: 'no_update' };
            }
        } catch (error) {
            this.logger.store(this.storeName, 'error', `Error in updateProductInDb for ${product.sku}: ${error.message}`);
            return { status: 'failed', message: error.message };
        }
    }

    async processProduct(product) {
        const { sku } = product;
        if (!sku) {
            this.logger.store(this.storeName, 'warn', 'Skipping product with empty SKU.');
            return { status: 'failed', message: 'Empty SKU' };
        }

        try {
            // updateProductInDb já faz o fetch dos dados da API
            return await this.updateProductInDb(product);
        } catch (error) {
            this.logger.store(this.storeName, 'error', `Error processing product ${sku}: ${error.message}`);
            this.problematicProducts.push(product); // Keep original product object for re-processing
            return { status: 'failed', message: error.message };
        }
    }

    async fetchProductsFromDb() {
        try {
            const query = `
                SELECT sku FROM produtos 
                WHERE source = 'Home Depot' AND sku IS NOT NULL AND sku <> ''
                ORDER BY last_update ASC`;
            const result = await this.dbService.fetchRowsWithRetry(query);
            this.logger.store(this.storeName, 'info', `Fetched ${result.length} Home Depot products from database.`);
            return result; // result is an array of objects like [{sku: '...'}, ...]
        } catch (error) {
            this.logger.store(this.storeName, 'error', `Error fetching products from database: ${error.message}`);
            return [];
        }
    }
    
    // --- Main Execution Method ---

    async executePhase1(skipProblematic = false, requestsPerSecond, checkCancellation, updateProgress) {
        this.logger.store(this.storeName, 'info', 'Starting Phase 1 for Home Depot Provider.');
        const startTime = Date.now();

        await this.init();
        
        // Setup monitoring interval para requests pendentes
        const monitoringInterval = setInterval(() => {
            const stats = this.apiService.getRequestStats();
            if (stats.pendingRequests > 0) {
                this.logger.store(this.storeName, 'warn', 
                    `[REQUEST-MONITOR] ${stats.pendingRequests} requests pending. Total requests: ${stats.totalRequests}`
                );
                this.apiService.checkPendingRequests();
            }
        }, 15000); // Verificar a cada 15 segundos

        const products = await this.fetchProductsFromDb();
        if (products.length === 0) {
            this.logger.store(this.storeName, 'warn', 'No Home Depot products found to process.');
            clearInterval(monitoringInterval);
            await this.close();
            return { success: true, message: 'No products to process.' };
        }
        
        this.logger.store(this.storeName, 'info', `Processing ${products.length} products individually.`);

        const progress = {
            phase: 1,
            totalProducts: products.length,
            processedProducts: 0,
            successCount: 0,
            failCount: 0,
            updatedProducts: 0,
            status: 'processing'
        };
        if (updateProgress) updateProgress(progress);

        const concurrency = this.apiService.requestsPerSecond || 5;
        const queue = new SimpleQueue({ concurrency });
        
        // Process all products individually with rate limiting
        const tasks = products.map((product, index) => async () => {
            if (checkCancellation && checkCancellation()) return { status: 'cancelled' };
            
            const result = await this.processProduct(product);

            // Update progress counters based on result
            progress.processedProducts++;
            if (result.status === 'updated') {
                progress.successCount++;
                progress.updatedProducts++;
            } else if (result.status === 'no_update') {
                progress.successCount++;
            } else if (result.status !== 'cancelled') {
                progress.failCount++;
            }

            // Log progress every 100 products or at specific milestones
            if (progress.processedProducts % 100 === 0 || 
                progress.processedProducts === products.length ||
                progress.processedProducts === 1) {
                this.logger.store(this.storeName, 'info', 
                    `Progress: ${progress.processedProducts}/${progress.totalProducts} ` +
                    `(Success: ${progress.successCount}, Failed: ${progress.failCount}, Updated: ${progress.updatedProducts})`
                );
            }

            if (updateProgress) updateProgress(progress);
            
            return result;
        });

        // Add all tasks to the queue
        tasks.forEach(task => queue.add(task));
        
        // Wait for all tasks to complete
        await queue.onIdle();
        
        // Stop monitoring
        clearInterval(monitoringInterval);
        
        // Final check for pending requests
        const finalStats = this.apiService.getRequestStats();
        if (finalStats.pendingRequests > 0) {
            this.logger.store(this.storeName, 'error', 
                `[REQUEST-MONITOR] Phase 1 completed but ${finalStats.pendingRequests} requests still pending!`
            );
            this.apiService.checkPendingRequests();
        }
        
        if (checkCancellation && checkCancellation()) {
            this.logger.store(this.storeName, 'warn', 'Home Depot sync cancelled by user.');
            await this.close();
            return { success: false, message: 'Sync cancelled by user.' };
        }

        // Optional: Re-process problematic products
        if (!skipProblematic && this.problematicProducts.length > 0) {
            this.logger.store(this.storeName, 'info', `Reprocessing ${this.problematicProducts.length} problematic products...`);
            // This could be a separate queue run, similar to the main one.
            // For simplicity, this is omitted but can be added if needed.
        }

        const failedProductsFile = await this._saveFailedProductsToCSV();
        
        const duration = (Date.now() - startTime) / 1000;
        this.logger.store(this.storeName, 'info', `Home Depot Phase 1 finished in ${duration.toFixed(2)}s.`);
        this.logger.store(this.storeName, 'info', `Stats: Success=${progress.successCount}, Failed=${progress.failCount}, Updated=${progress.updatedProducts}`);
        
        // Log detailed update summary
        this.logger.store(this.storeName, 'info', '=== Final Update Summary ===');
        this.logger.store(this.storeName, 'info', `Total products updated: ${this.updateStats.totalUpdates}`);
        if (this.updateStats.priceChanges > 0) 
            this.logger.store(this.storeName, 'info', `  price changes: ${this.updateStats.priceChanges}`);
        if (this.updateStats.quantityChanges > 0) 
            this.logger.store(this.storeName, 'info', `  quantity changes: ${this.updateStats.quantityChanges}`);
        if (this.updateStats.availabilityChanges > 0) 
            this.logger.store(this.storeName, 'info', `  availability changes: ${this.updateStats.availabilityChanges}`);
        if (this.updateStats.freightChanges > 0) 
            this.logger.store(this.storeName, 'info', `  freight cost changes: ${this.updateStats.freightChanges}`);
        if (this.updateStats.leadTimeChanges > 0) 
            this.logger.store(this.storeName, 'info', `  lead time changes: ${this.updateStats.leadTimeChanges}`);
        if (this.updateStats.brandChanges > 0) 
            this.logger.store(this.storeName, 'info', `  brand changes: ${this.updateStats.brandChanges}`);
        this.logger.store(this.storeName, 'info', `Stock status: ${this.inStockSet.size} in stock, ${this.outOfStockSet.size} out of stock`);
        
        // Add problematic products count
        if (this.problematicProducts.length > 0) {
            this.logger.store(this.storeName, 'info', `Problematic products (marked): ${this.problematicProducts.length}`);
        }
        
        this.logger.store(this.storeName, 'info', '===========================');

        await this.close();
        
        return {
            success: true,
            executionTime: duration,
            totalProducts: progress.totalProducts,
            processedProducts: progress.processedProducts,
            failedProducts: this.errorCount,
            successfulApiCalls: this.successCount,
            failedApiCalls: this.errorCount,
            productsInStock: {
                total: this.inStockSet.size,
                withQuantity: this.inStockSet.size
            },
            productsOutOfStock: this.outOfStockSet.size,
            updatedProducts: this.updateStats.totalUpdates,
            priceChanges: this.updateStats.priceChanges,
            quantityChanges: this.updateStats.quantityChanges,
        };
    }
    
    async executePhase2(batchSize, checkInterval, checkCancellation, updateProgress) {
        this.logger.store(this.storeName, 'info', `Running Phase 2 for ${this.getName()} provider`);
        const phase2 = require('../phases/phase2'); // Lazy load phase2
        
        const fixedBatchSize = batchSize || 9990;
        
        try {
            await this.init();
            process.env.CURRENT_PROVIDER_ID = 'homedepot';
            process.env.HOMEDEPOT_UPDATE_FLAG_VALUE = this.updateFlagValue.toString();
            
            const result = await phase2.mainPhase2(
                fixedBatchSize,
                checkInterval,
                checkCancellation,
                updateProgress
            );
            
            return {
                success: result,
                totalProducts: updateProgress ? updateProgress.totalProducts : 0,
                successCount: updateProgress ? updateProgress.successCount : 0,
                failCount: updateProgress ? updateProgress.failCount : 0,
            };
        } catch (error) {
            this.logger.store(this.storeName, 'error', `Error in ${this.getName()} Phase 2: ${error.message}`, { error });
            throw error;
        } finally {
            await this.close();
        }
    }


    getPhase2Queries() {
      return {
        extractUpdatedData: `
          SELECT sku2, handling_time_amz, quantity 
          FROM produtos 
          WHERE atualizado = ${this.updateFlagValue} AND source = 'Home Depot'
        `,
        resetUpdatedProducts: `
          UPDATE produtos
          SET atualizado = 0
          WHERE atualizado = ${this.updateFlagValue} AND source = 'Home Depot'
        `
      };
    }

    async _saveFailedProductsToCSV() {
        if (this.failedProducts.length === 0) return null;
        try {
            await fs.mkdir(LOG_DIR_PATH, { recursive: true });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filePath = path.join(LOG_DIR_PATH, `failed_products_homedepot_${timestamp}.csv`);
            const headers = ['sku', 'reason', 'timestamp'];
            const rows = this.failedProducts.map(p => headers.map(h => `"${p[h] || ''}"`).join(','));
            const csvContent = [headers.join(','), ...rows].join('\n');
            await fs.writeFile(filePath, csvContent, 'utf8');
            this.logger.store(this.storeName, 'info', `Saved ${this.failedProducts.length} failed products to ${filePath}`);
            return filePath;
        } catch (error) {
            this.logger.store(this.storeName, 'error', `Error saving failed products CSV: ${error.message}`);
            return null;
        }
    }
}

module.exports = HomeDepotProvider; 