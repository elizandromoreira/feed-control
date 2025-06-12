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
const { API_CONFIG } = require('../config/constants');
const logger = require('../config/logging')();
const SimpleQueue = require('../utils/simple-queue');

// Define constants for file paths to avoid magic strings
const SKIP_FILE_PATH = path.join(__dirname, '../../data/skip_list.json');
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
        this.updateFlagValue = config.updateFlagValue ?? 1; // Default to '1' for Home Depot
        const requestsPerSecond = config.requestsPerSecond || API_CONFIG.requestsPerSecond;

        // --- Services ---
        this.dbService = new DatabaseService(DB_CONFIG);
        this.apiService = new HomeDepotApiService(this.apiBaseUrl, requestsPerSecond);

        // --- State Management ---
        this.skipList = {};
        this.emptyDataSkus = [];
        this.problematicProducts = [];
        this.failedProducts = [];
        this.inStockCount = 0;
        this.outOfStockCount = 0;
        this.dbInitialized = false;

        logger.info('--- HomeDepotProvider Configured Values ---');
        logger.info(`- Source: ${config.storeId ? 'Database' : 'Fallback/Env'}`);
        logger.info(`- OMD Handling Time: ${this.handlingTimeOmd}`);
        logger.info(`- Update Flag Value: ${this.updateFlagValue}`);
        logger.info('-------------------------------------------');
    }

    async init() {
        if (!this.dbInitialized) {
            await this.dbService.init();
            this.dbInitialized = true;
            logger.info('Database connection initialized for HomeDepotProvider.');
        }
    }

    async close() {
        if (this.dbInitialized) {
            await this.dbService.close();
            this.dbInitialized = false;
            logger.info('Database connection closed for HomeDepotProvider.');
        }
    }

    getId() {
        return 'homedepot';
    }

    getName() {
        return 'Home Depot';
    }

    // --- Skip List and Logging Management ---

    async _loadSkipList() {
        try {
            const data = await fs.readFile(SKIP_FILE_PATH, 'utf8');
            this.skipList = JSON.parse(data);
            logger.info(`Loaded ${Object.keys(this.skipList).length} products to skip.`);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error(`Error loading skip list: ${error.message}`);
            }
            this.skipList = {};
        }
    }

    async _saveSkipList() {
        try {
            await fs.mkdir(path.dirname(SKIP_FILE_PATH), { recursive: true });
            await fs.writeFile(SKIP_FILE_PATH, JSON.stringify(this.skipList, null, 2));
            logger.info(`Saved ${Object.keys(this.skipList).length} products to skip list.`);
        } catch (error) {
            logger.error(`Error saving skip list: ${error.message}`);
        }
    }
    
    _logFailedProduct(sku, reason = 'Unknown reason') {
        this.skipList[sku] = Date.now() / 1000;
        this.failedProducts.push({ sku, reason, timestamp: new Date().toISOString() });
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
            logger.info(`Saved ${this.failedProducts.length} failed products to ${filePath}`);
            return filePath;
        } catch (error) {
            logger.error(`Error saving failed products CSV: ${error.message}`);
            return null;
        }
    }

    // --- Core Product Processing Logic ---

    async updateProductInDb(productData) {
        try {
            const currentDataQuery = `
                SELECT supplier_price, freight_cost, lead_time, lead_time_2, quantity, availability, brand, handling_time_amz
                FROM produtos WHERE sku = $1`;
            const currentData = await this.dbService.fetchRowWithRetry(currentDataQuery, [productData.sku]);

            if (!currentData) {
                logger.warn(`Product ${productData.sku} not found in DB. Skipping update.`);
                return { status: 'failed', message: 'Product not found in database' };
            }

            const { quantity, availability } = this.apiService.calculateQuantity(productData.stock, productData.available, productData.sku, productData.price);
            const correctedAvailability = quantity > 0 ? 'inStock' : 'outOfStock';

            if (correctedAvailability === 'inStock') this.inStockCount++;
            else this.outOfStockCount++;

            const homeDepotLeadTime = this.apiService.calculateDeliveryTime(productData.min_delivery_date, productData.max_delivery_date, productData.sku);
            
            // Use handlingTimeOmd from instance config
            let handlingTimeAmz = this.handlingTimeOmd + homeDepotLeadTime;
            if (handlingTimeAmz > 29) {
                logger.warn(`Handling time for ${productData.sku} capped at 29 days (was ${handlingTimeAmz}).`);
                handlingTimeAmz = 29;
            }

            const newData = {
                supplier_price: productData.price || 0,
                freight_cost: productData.shipping_cost || 0,
                lead_time: this.handlingTimeOmd.toString(), // OMD handling time
                lead_time_2: homeDepotLeadTime, // Provider specific handling time
                quantity,
                availability: correctedAvailability,
                brand: productData.brand || '',
                handling_time_amz: handlingTimeAmz
            };

            const hasChanges =
                Number(currentData.supplier_price) !== newData.supplier_price ||
                Number(currentData.freight_cost) !== newData.freight_cost ||
                String(currentData.lead_time) !== newData.lead_time ||
                Number(currentData.lead_time_2) !== newData.lead_time_2 ||
                Number(currentData.quantity) !== newData.quantity ||
                String(currentData.availability) !== newData.availability ||
                String(currentData.brand) !== newData.brand ||
                Number(currentData.handling_time_amz) !== newData.handling_time_amz;

            const now = new Date();
            if (!hasChanges) {
                await this.dbService.executeWithRetry(`UPDATE produtos SET last_update = $1 WHERE sku = $2`, [now, productData.sku]);
                return { status: 'no_update', message: 'No changes detected' };
            }

            logger.info(`Changes detected for ${productData.sku}, updating database.`);
            const updateQuery = `
                UPDATE produtos SET
                    supplier_price = $1, freight_cost = $2, lead_time = $3, lead_time_2 = $4,
                    quantity = $5, availability = $6, brand = $7, handling_time_amz = $8,
                    last_update = $9, atualizado = $10
                WHERE sku = $11`;
            
            await this.dbService.executeWithRetry(updateQuery, [
                newData.supplier_price, newData.freight_cost, newData.lead_time, newData.lead_time_2,
                newData.quantity, newData.availability, newData.brand, newData.handling_time_amz,
                now, this.updateFlagValue, productData.sku
            ]);

            return { status: 'updated' };
        } catch (error) {
            logger.error(`Error in updateProductInDb for ${productData.sku}: ${error.message}`);
            return { status: 'failed', message: error.message };
        }
    }

    async processProduct(product) {
        const { sku } = product;
        if (!sku) {
            logger.warn('Skipping product with empty SKU.');
            return { status: 'failed', message: 'Empty SKU' };
        }

        if (this.skipList[sku]) {
            const hoursSinceSkip = (Date.now() / 1000 - this.skipList[sku]) / 3600;
            if (hoursSinceSkip < 24) {
                logger.debug(`Skipping ${sku} (on skip list for ${hoursSinceSkip.toFixed(1)}h).`);
                await this.dbService.executeWithRetry('UPDATE produtos SET last_update = $1 WHERE sku = $2', [new Date(), sku]);
                return { status: 'skipped' };
            }
            delete this.skipList[sku]; // Expired from skip list
        }

        try {
            const productData = await this.apiService.fetchProductDataWithRetry(sku);
            if (productData && productData.error) {
                this._logFailedProduct(sku, productData.message);
                return { status: 'failed', message: `API Error: ${productData.message}` };
            }
            if (!productData) {
                this.emptyDataSkus.push(sku);
                this._logFailedProduct(sku, 'No data from API');
                return { status: 'failed', message: 'No data from API' };
            }
            return await this.updateProductInDb(productData);
        } catch (error) {
            logger.error(`Error processing product ${sku}: ${error.message}`);
            this._logFailedProduct(sku, error.message);
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
            logger.info(`Fetched ${result.length} Home Depot products from database.`);
            return result; // result is an array of objects like [{sku: '...'}, ...]
        } catch (error) {
            logger.error(`Error fetching products from database: ${error.message}`);
            return [];
        }
    }
    
    // --- Main Execution Method ---

    async executePhase1(skipProblematic = false, requestsPerSecond, checkCancellation, updateProgress) {
        logger.info('Starting Phase 1 for Home Depot Provider.');
        const startTime = Date.now();

        await this.init();
        await this._loadSkipList();

        const products = await this.fetchProductsFromDb();
        if (products.length === 0) {
            logger.warn('No Home Depot products found to process.');
            await this.close();
            return { success: true, message: 'No products to process.' };
        }
        
        let progress = {
            totalProducts: products.length,
            processedProducts: 0,
            successCount: 0,
            failCount: 0,
            updatedProducts: 0,
            startTime: startTime
        };
        if (updateProgress) updateProgress(progress);

        const concurrency = this.apiService.requestsPerSecond || 5;
        const queue = new SimpleQueue({ concurrency });
        
        const processTasks = products.map(product => async () => {
            if (checkCancellation && checkCancellation()) return { status: 'cancelled' };
            
            const result = await this.processProduct(product);

            // Update progress counters based on result
            progress.processedProducts++;
            if (result.status === 'updated') {
                progress.successCount++;
                progress.updatedProducts++;
            } else if (result.status === 'no_update' || result.status === 'skipped') {
                progress.successCount++;
            } else if (result.status !== 'cancelled') {
                progress.failCount++;
            }

            if (updateProgress) updateProgress(progress);
        });

        processTasks.forEach(task => queue.add(task));
        await queue.onIdle();

        if (checkCancellation && checkCancellation()) {
             logger.warn('Home Depot sync cancelled by user.');
        }

        // Optional: Re-process problematic products
        if (!skipProblematic && this.problematicProducts.length > 0) {
            logger.info(`Reprocessing ${this.problematicProducts.length} problematic products...`);
            // This could be a separate queue run, similar to the main one.
            // For simplicity, this is omitted but can be added if needed.
        }

        await this._saveSkipList();
        const failedProductsFile = await this._saveFailedProductsToCSV();
        
        const duration = (Date.now() - startTime) / 1000;
        logger.info(`Home Depot Phase 1 finished in ${duration.toFixed(2)}s.`);
        logger.info(`Stats: Success=${progress.successCount}, Failed=${progress.failCount}, Updated=${progress.updatedProducts}`);

        await this.close();
        
        return {
            success: true,
            executionTime: duration,
            totalProducts: progress.totalProducts,
            processedProducts: progress.processedProducts,
            successCount: progress.successCount,
            failCount: progress.failCount,
            updatedProducts: progress.updatedProducts,
            inStock: this.inStockCount,
            outOfStock: this.outOfStockCount,
            failedProductsFile,
        };
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
}

module.exports = HomeDepotProvider;