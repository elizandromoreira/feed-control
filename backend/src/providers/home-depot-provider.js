/**
 * Home Depot Provider - REFATORADO
 *
 * Implementação padronizada seguindo o padrão Best Buy/Vitacost.
 * Toda lógica de API incluída diretamente no provider.
 */

const fs = require('fs').promises;
const path = require('path');
const BaseProvider = require('./provider-interface');
const DatabaseService = require('../services/database');
const { DB_CONFIG } = require('../config/db');
const logger = require('../config/logging')();
const SimpleQueue = require('../utils/SimpleQueue');
const axios = require('axios');
const retry = require('async-retry');
const HomeDepotCartApi = require('../services/homeDepotCartApi');

// Define constants for file paths to avoid magic strings
const LOG_DIR_PATH = path.join(__dirname, '../../logs');
const MINIMUM_STOCK = 5;
const REMOTE_API_BASE_URL = 'http://167.114.223.83:3005/hd/api';
const LOCAL_API_BASE_URL = 'http://localhost:3005/hd/api';

class HomeDepotProvider extends BaseProvider {
    /**
     * Constructor for Home Depot Provider
     */
    constructor(config = {}) {
        super(config);
        
        // --- Configuration from DB ---
        this.apiBaseUrl = config.apiBaseUrl || process.env.API_BASE_URL || REMOTE_API_BASE_URL;
        this.handlingTimeOmd = config.handlingTimeOmd ?? 1;
        this.providerSpecificHandlingTime = config.providerSpecificHandlingTime ?? 2; 
        this.updateFlagValue = config.updateFlagValue ?? 1;
        this.stockLevel = config.stockLevel ?? 7;
        this.requestsPerSecond = config.requestsPerSecond ?? 10; // Valor padrão de 10 req/s se não vier do banco

        // --- Services ---
        this.dbService = new DatabaseService(DB_CONFIG);
        this.cartApi = new HomeDepotCartApi();

        // --- State Management ---
        this.emptyDataSkus = [];
        this.problematicProducts = [];
        this.failedProducts = [];
        this.processedCount = 0;
        this.inStockSet = new Set();
        this.outOfStockSet = new Set();
        
        // Request tracking (como Best Buy/Vitacost)
        this.requestCounter = 0;
        this.pendingRequests = new Map();
        
        // Rate limiting
        this.lastRequestTimes = [];
        this.requestDelay = this.requestsPerSecond ? 1000 / this.requestsPerSecond : 140;
        
        // Update statistics
        this.updateStats = {
            totalUpdates: 0,
            priceChanges: 0,
            quantityChanges: 0,
            availabilityChanges: 0,
            brandChanges: 0,
            handlingTimeChanges: 0
        };

        // Log configuration
        logger.store(this.storeName, 'info', '--- Home Depot Provider Configured ---');
        logger.store(this.storeName, 'info', `- API Base URL: ${this.apiBaseUrl}`);
        logger.store(this.storeName, 'info', `- Stock Level: ${this.stockLevel}`);
        logger.store(this.storeName, 'info', `- OMD Handling Time: ${this.handlingTimeOmd}`);
        logger.store(this.storeName, 'info', `- Provider Handling Time: ${this.providerSpecificHandlingTime}`);
        logger.store(this.storeName, 'info', `- Update Flag Value: ${this.updateFlagValue}`);
        logger.store(this.storeName, 'info', `- Requests Per Second: ${this.requestsPerSecond}`);
        logger.store(this.storeName, 'info', '-------------------------------------------');

        this.dbInitialized = false;
    }

    async init() {
        if (!this.dbInitialized) {
            await this.dbService.init();
            this.dbInitialized = true;
            logger.store(this.storeName, 'info', 'Database connection initialized for HomeDepotProvider.');
        }
    }

    async close() {
        if (this.dbInitialized) {
            await this.dbService.close();
            this.dbInitialized = false;
            logger.store(this.storeName, 'info', 'Database connection closed for HomeDepotProvider.');
        }
    }

    getId() {
        return 'homedepot';
    }

    getName() {
        return 'Home Depot';
    }

    // --- Request Tracking (padrão Best Buy/Vitacost) ---
    generateRequestId() {
        return ++this.requestCounter;
    }

    trackRequest(requestId, sku, url) {
        this.pendingRequests.set(requestId, {
            sku,
            url,
            startTime: Date.now()
        });
    }

    completeRequest(requestId, success = true) {
        const requestInfo = this.pendingRequests.get(requestId);
        if (requestInfo) {
            const duration = Date.now() - requestInfo.startTime;
            logger.store(this.storeName, 'info', `[REQ-${requestId}] Request completed for SKU ${requestInfo.sku} - Duration: ${duration}ms, Success: ${success}`);
            this.pendingRequests.delete(requestId);
        }
    }

    checkPendingRequests() {
        const now = Date.now();
        const staleThreshold = 30000;
        
        for (const [requestId, info] of this.pendingRequests) {
            const age = now - info.startTime;
            if (age > staleThreshold) {
                logger.store(this.storeName, 'warn', `[REQUEST-MONITOR] REQ-${requestId}: SKU ${info.sku}, Age: ${age}ms`);
            }
        }
    }

    // --- Rate Limiting ---
    async throttleRequest() {
        const now = Date.now();
        
        // Limpar timestamps antigos (mais de 1 segundo)
        this.lastRequestTimes = this.lastRequestTimes.filter(time => now - time < 1000);
        
        // Se já atingimos o limite, aguardar
        if (this.lastRequestTimes.length >= this.requestsPerSecond) {
            const oldestRequest = this.lastRequestTimes[0];
            const timeToWait = Math.max(0, 1000 - (now - oldestRequest));
            
            if (timeToWait > 0) {
                await new Promise(resolve => setTimeout(resolve, timeToWait));
            }
        }
        
        // Registrar esta requisição
        this.lastRequestTimes.push(Date.now());
    }

    // --- API Methods ---
    async fetchProductData(sku) {
        const requestId = this.generateRequestId();
        const startTime = Date.now();
        const url = `${this.apiBaseUrl}/${sku}`;
        
        let responseData = null;
        let errorOccurred = null;
        
        try {
            this.trackRequest(requestId, sku, url);
            logger.store(this.storeName, 'info', `[REQ-${requestId}] Starting request for SKU ${sku}`);
            
            // await this.throttleRequest(); // Removido - SimpleQueue já controla rate limit
            
            const response = await axios.get(url, {
                timeout: 20000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            // Verificar se a requisição foi bem-sucedida -> CLEO
            if (response?.status === 200) {
                const resposta_da_api = response?.data?.data;
                logger.store(this.storeName, 'warn', `[REQ-${requestId}] SKU ${sku} - Stock: ${resposta_da_api.stock}`);
            }
            
            const duration = Date.now() - startTime;
            logger.store(this.storeName, 'info', `[REQ-${requestId}] Response received for SKU ${sku} - Status: ${response.status}, Duration: ${duration}ms`);
            
            // Verificar estrutura da resposta com campo success
            if (response.data && response.data.success === true && response.data.data) {
                const apiData = response.data.data;
                logger.store(this.storeName, 'info', `[REQ-${requestId}] SUCCESS - SKU ${sku}: Stock=${apiData.stock}, Available=${apiData.available}, Price=${apiData.price}`);
                responseData = apiData;
                
            } else if (response.data && response.data.success === false) {
                // API retornou explicitamente que falhou
                logger.store(this.storeName, 'warn', `[REQ-${requestId}] API FAILURE - SKU ${sku}: ${response.data.error || 'Unknown error'}`);
                responseData = { productNotFound: true, sku };
                
            } else {
                // Resposta em formato inesperado
                errorOccurred = new Error('Invalid API response format');
                logger.store(this.storeName, 'error', `[REQ-${requestId}] INVALID FORMAT - SKU ${sku}: ${JSON.stringify(response.data)}`);
            }
            
        } catch (error) {
            const duration = Date.now() - startTime;
            errorOccurred = error;
            
            if (error.response) {
                // Verificar se é erro 404 (produto não encontrado)
                if (error.response.status === 404) {
                    logger.store(this.storeName, 'warn', `[REQ-${requestId}] PRODUCT NOT FOUND - SKU ${sku}: HTTP 404, Duration: ${duration}ms`);
                    responseData = { productNotFound: true, sku };
                    errorOccurred = null; // Limpar erro pois foi tratado
                } else {
                    logger.store(this.storeName, 'error', `[REQ-${requestId}] HTTP ERROR - SKU ${sku}: Status ${error.response.status}, Duration: ${duration}ms`);
                }
            } else if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                logger.store(this.storeName, 'error', `[REQ-${requestId}] TIMEOUT - SKU ${sku}: Request timed out after ${duration}ms`);
            } else if (error.code) {
                logger.store(this.storeName, 'error', `[REQ-${requestId}] NETWORK ERROR - SKU ${sku}: ${error.code}, Duration: ${duration}ms`);
            } else {
                logger.store(this.storeName, 'error', `[REQ-${requestId}] UNKNOWN ERROR - SKU ${sku}: ${error.message}, Duration: ${duration}ms`);
            }
        } finally {
            logger.store(this.storeName, 'info', `[REQ-${requestId}] Request completed for SKU ${sku}`);
            this.completeRequest(requestId, !errorOccurred);
        }
        
        if (errorOccurred) {
            throw errorOccurred;
        }
        
        return responseData;
    }

    async fetchProductDataWithRetry(sku) {
        try {
            const result = await retry(
                async () => {
                    const result = await this.fetchProductData(sku);
                    
                    // Se o produto não foi encontrado, não precisa retry
                    if (result && result.productNotFound) {
                        logger.store(this.storeName, 'info', `[${sku}] Product marked as not found, stopping retries`);
                        // Usar um erro customizado ao invés de retry.StopError
                        const error = new Error('Product not found');
                        error.bail = true; // Isso faz o async-retry parar imediatamente
                        error.productNotFound = true;
                        error.sku = sku;
                        throw error;
                    }
                    
                    // Se não há resultado, forçar retry
                    if (!result) {
                        logger.store(this.storeName, 'warn', `[${sku}] No data returned from API, will retry`);
                        throw new Error('No data returned from API');
                    }
                    
                    // Processar os dados da API através do mapApiDataToProductData
                    return await this.mapApiDataToProductData(result, sku);
                },
                {
                    retries: 2,
                    factor: 2,
                    minTimeout: 500,  // Reduzido de 2000ms para 500ms
                    maxTimeout: 1000, // Reduzido de 5000ms para 1000ms
                    onRetry: (error, attempt) => {
                        logger.store(this.storeName, 'warn', `[${sku}] Retry attempt ${attempt}/2 - Error: ${error.message}`);
                    }
                }
            );
            
            return result;
            
        } catch (error) {
            // Se foi um erro de produto não encontrado, retornar status apropriado
            if (error.productNotFound || (error.bail && error.message === 'Product not found')) {
                logger.store(this.storeName, 'info', `[${sku}] Product not found, returning not found status`);
                return await this.mapApiDataToProductData({ productNotFound: true, sku }, sku);
            }
            
            logger.store(this.storeName, 'error', `[${sku}] Failed to fetch product data after 2 attempts: ❌ ${error.message}`);
            logger.store(this.storeName, 'error', `❌ FAILED PRODUCT: ${sku} - Failed after all retries: ${error.message}`);
            
            // Retornar objeto de erro ao invés de marcar como productNotFound
            return { 
                error: error.message, 
                sku,
                isNetworkError: true // Flag para indicar erro de rede/timeout
            };
        }
    }

    // --- Calculation Methods ---
    calculateQuantity(stock, available, sku = 'unknown', price = null) {
        const stockNum = parseInt(stock, 10);
        
        // 1. Estoque menor que 6: marcar como indisponível (quantidade 0)
        if (isNaN(stockNum) || stockNum <= MINIMUM_STOCK) {
            logger.store(this.storeName, 'debug', `[${sku}] Stock below threshold (${stockNum} < ${MINIMUM_STOCK}): marking as outOfStock`);
            return { quantity: 0, availability: 'outOfStock' };
        }
        
        // 2. Verificar disponibilidade
        if (!available) {
            logger.store(this.storeName, 'debug', `[${sku}] Product marked as unavailable: marking as outOfStock`);
            return { quantity: 0, availability: 'outOfStock' };
        }
        
        // 3. Produto disponível com estoque >= 3
        let finalQuantity;
        if (stockNum <= this.stockLevel) {
            // Se estoque real é menor ou igual ao limite configurado, usar valor real
            finalQuantity = stockNum;
        } else {
            // Se estoque real é maior que o limite, usar o limite
            finalQuantity = this.stockLevel;
        }
        
        logger.store(this.storeName, 'debug', `[${sku}] Stock: ${stockNum}, StockLevel: ${this.stockLevel}, Final quantity: ${finalQuantity}`);
        return { quantity: finalQuantity, availability: 'inStock' };
    }

    calculateDeliveryTime(minDeliveryDate, maxDeliveryDate, sku = 'unknown') {
        const defaultTime = this.providerSpecificHandlingTime || 2;
        
        if (!minDeliveryDate || !maxDeliveryDate) {
            return defaultTime;
        }
        
        try {
            const minDate = new Date(minDeliveryDate);
            const maxDate = new Date(maxDeliveryDate);
            
            if (isNaN(minDate.getTime()) || isNaN(maxDate.getTime())) {
                return defaultTime;
            }
            
            // Calcular a data média entre a data mínima e máxima
            const avgDeliveryTime = new Date((minDate.getTime() + maxDate.getTime()) / 2);
            const now = new Date();
            const diffTime = avgDeliveryTime.getTime() - now.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            return Math.max(1, diffDays);
        } catch (error) {
            return defaultTime;
        }
    }

    async checkPriceInCart(itemId) {
        try {
            return await this.cartApi.checkPriceInCart(itemId);
        } catch (error) {
            logger.store(this.storeName, 'warn', `Error checking price in cart for item ${itemId}: ${error.message}`);
            return 0;
        }
    }

    async mapApiDataToProductData(apiData, sku) {
        // Se produto não foi encontrado
        if (apiData.productNotFound) {
            return {
                sku,
                price: 0,
                stock: 0,
                available: false,
                brand: '',
                min_delivery_date: null,
                max_delivery_date: null,
                productNotFound: true,
                error: apiData.error || 'Product not found',
                sku_problem: Boolean(apiData.productNotFound) // Garantir que seja sempre boolean
            };
        }
        
        // Extrair e validar dados da API
        const price = parseFloat(apiData.price) || 0;
        const stock = parseInt(apiData.stock, 10) || 0;
        const available = Boolean(apiData.available);
        const brand = String(apiData.brand || '').trim();
        
        // Verificar preço no carrinho se necessário
        let finalPrice = price;
        if (price === 0 && apiData.id) {
            logger.store(this.storeName, 'debug', `Price is 0 for SKU ${sku}, checking cart price`);
            const cartPrice = await this.checkPriceInCart(apiData.id);
            if (cartPrice > 0) {
                finalPrice = cartPrice;
                logger.store(this.storeName, 'info', `Updated price from cart for SKU ${sku}: $${cartPrice}`);
            }
        }
        
        return {
            sku,
            price: finalPrice,
            stock,
            available,
            brand,
            min_delivery_date: apiData.minDeliveryDate || null,
            max_delivery_date: apiData.maxDeliveryDate || null,
            productNotFound: false,
            sku_problem: false // Garantir que sku_problem seja sempre boolean
        };
    }

    // --- Core Product Processing Logic ---
    async updateProductInDb(product) {
        const updateStartTime = Date.now();
        try {
            // Buscar dados da API
            const apiStartTime = Date.now();
            const productData = await this.fetchProductDataWithRetry(product.sku);
            const apiDuration = Date.now() - apiStartTime;
            logger.store(this.storeName, 'debug', `[${product.sku}] API fetch took ${apiDuration}ms`);
            
            // Verificar se há erro nos dados retornados
            if (productData.error || !productData) {
                logger.store(this.storeName, 'error', `Error fetching data for product ${product.sku}: ${productData.error || 'No data returned'}`);
                logger.store(this.storeName, 'error', `❌ FAILED PRODUCT: ${product.sku} - Error: ${productData.error || 'No data returned'}`);
                
                // Se for erro de rede/timeout, não marcar como sku_problem
                if (productData.isNetworkError) {
                    logger.store(this.storeName, 'warn', `Network/timeout error for SKU ${product.sku}, not marking as sku_problem`);
                    return { status: 'failed', message: productData.error || 'Network error' };
                }
                
                // Para outros erros, marcar como sku_problem
                this.problematicProducts.push(product.sku);
                return { status: 'failed', message: productData.error || 'No data returned' };
            }
            
            // Verificar se produto não foi encontrado (API retornou success: false)
            if (productData.productNotFound === true) {
                logger.store(this.storeName, 'error', `Product not found for SKU ${product.sku}`);
                logger.store(this.storeName, 'error', `❌ FAILED PRODUCT: ${product.sku} - Product not found in API`);
                this.problematicProducts.push(product.sku);
                return { status: 'failed', message: 'Product not found' };
            }
            
            // Buscar dados atuais do banco
            const currentQuery = 'SELECT supplier_price, quantity, availability, brand, lead_time, lead_time_2, handling_time_amz, freight_cost FROM produtos WHERE sku = $1';
            const currentResult = await this.dbService.executeWithRetry(currentQuery, [product.sku]);
            
            if (currentResult.rows.length === 0) {
                logger.store(this.storeName, 'warn', `Product ${productData.sku} not found in DB. Skipping update.`);
                return { status: 'failed', message: 'Product not found in database' };
            }
            
            const { quantity, availability } = this.calculateQuantity(productData.stock, productData.available, productData.sku, productData.price);
            const correctedAvailability = quantity > 0 ? 'inStock' : 'outOfStock';

            // Add to appropriate set
            if (correctedAvailability === 'inStock') {
                this.inStockSet.add(product.sku);
            } else {
                this.outOfStockSet.add(product.sku);
            }

            const homeDepotLeadTime = this.calculateDeliveryTime(productData.min_delivery_date, productData.max_delivery_date, productData.sku);
            
            let handlingTimeAmz = this.handlingTimeOmd + homeDepotLeadTime;
            if (handlingTimeAmz > 29) {
                handlingTimeAmz = 29;
            }
            
            const currentProduct = currentResult.rows[0];
            
            // Construct new data object
            const newData = {
                supplier_price: productData.price || 0,
                quantity: quantity,
                availability: correctedAvailability,
                brand: productData.brand || '',
                lead_time: this.handlingTimeOmd,
                lead_time_2: homeDepotLeadTime,
                handling_time_amz: handlingTimeAmz,
                freight_cost: 0,
                last_update: new Date().toISOString(),
                atualizado: this.updateFlagValue,
                sku_problem: false
            };
            
            // Check for changes and count them
            let hasChanges = false;
            const changes = [];
            
            Object.keys(newData).forEach(key => {
                if (key === 'last_update' || key === 'atualizado') return;
                
                const oldValue = currentProduct[key];
                const newValue = newData[key];
                
                // Comparar valores apropriadamente baseado no tipo de campo
                let hasRealChange = false;
                let displayOldValue = oldValue;
                let displayNewValue = newValue;
                
                if (key === 'supplier_price' || key === 'freight_cost') {
                    // Comparar valores monetários como float
                    const oldFloat = parseFloat(oldValue) || 0;
                    const newFloat = parseFloat(newValue) || 0;
                    hasRealChange = oldFloat !== newFloat;
                    displayOldValue = `$${oldFloat}`;
                    displayNewValue = `$${newFloat}`;
                } else if (key === 'quantity' || key === 'lead_time' || key === 'lead_time_2' || key === 'handling_time_amz') {
                    // Comparar valores inteiros
                    const oldInt = parseInt(oldValue) || 0;
                    const newInt = parseInt(newValue) || 0;
                    hasRealChange = oldInt !== newInt;
                    displayOldValue = oldInt;
                    displayNewValue = newInt;
                } else if (key === 'sku_problem') {
                    // Comparar valores booleanos
                    const oldBool = Boolean(oldValue);
                    const newBool = Boolean(newValue);
                    hasRealChange = oldBool !== newBool;
                } else {
                    // Comparar como string (brand, availability, etc.)
                    hasRealChange = String(oldValue) !== String(newValue);
                }
                
                if (hasRealChange) {
                    hasChanges = true;
                    changes.push(`${key}: ${displayOldValue} → ${displayNewValue}`);
                    
                    // Count specific types of changes
                    if (key === 'supplier_price') this.updateStats.priceChanges++;
                    if (key === 'quantity') this.updateStats.quantityChanges++;
                    if (key === 'availability') this.updateStats.availabilityChanges++;
                    if (key === 'brand') this.updateStats.brandChanges++;
                    if (key === 'lead_time_2') this.updateStats.handlingTimeChanges++;
                }
            });
            
            if (hasChanges) {
                this.updateStats.totalUpdates++;
                
                // Update the product in the database
                const updateQuery = `
                    UPDATE produtos 
                    SET supplier_price = $1, quantity = $2, availability = $3, brand = $4,
                        lead_time = $5, lead_time_2 = $6, handling_time_amz = $7,
                        freight_cost = $8,
                        last_update = $9, atualizado = $10, sku_problem = $11
                    WHERE sku = $12
                `;
                
                await this.dbService.executeWithRetry(updateQuery, [
                    newData.supplier_price,
                    newData.quantity,
                    newData.availability,
                    newData.brand,
                    newData.lead_time,
                    newData.lead_time_2,
                    newData.handling_time_amz,
                    newData.freight_cost,
                    newData.last_update,
                    newData.atualizado,
                    newData.sku_problem,
                    product.sku
                ]);
                
                const statusIcon = correctedAvailability === 'inStock' ? '✅' : '⭕';
                logger.store(this.storeName, 'info', `${statusIcon} Updated ${product.sku}: ${changes.join(', ')}`);
                
                return { status: 'updated', changes: changes.length, details: changes };
            } else {
                // No changes needed - but mark as processed successfully
                const updateQuery = `
                    UPDATE produtos 
                    SET last_update = $1, atualizado = $2, sku_problem = false, lead_time_2 = $4, handling_time_amz = $5
                    WHERE sku = $3
                `;
                
                await this.dbService.executeWithRetry(updateQuery, [
                    new Date().toISOString(),
                    this.updateFlagValue,
                    product.sku,
                    homeDepotLeadTime,
                    handlingTimeAmz
                ]);
                
                const statusIcon = correctedAvailability === 'inStock' ? '✅' : '⭕';
                logger.store(this.storeName, 'debug', `${statusIcon} No changes for ${product.sku} - marked as processed`);
                return { status: 'no_changes' };
            }
            
        } catch (error) {
            logger.store(this.storeName, 'error', `Error updating product ${product.sku}: ❌ ${error.message}`);
            this.failedProducts.push(product.sku);
            return { status: 'failed', message: error.message };
        } finally {
            const updateDuration = Date.now() - updateStartTime;
            logger.store(this.storeName, 'debug', `[${product.sku}] Update took ${updateDuration}ms`);
        }
    }

    async fetchProductsFromDb() {
        try {
            const query = `
                SELECT sku FROM produtos 
                WHERE source = 'Home Depot' AND sku IS NOT NULL AND sku <> ''
            `
            const result = await this.dbService.fetchRowsWithRetry(query);
            logger.store(this.storeName, 'info', `Fetched ${result.length} Home Depot products from database.`);
            return result;
        } catch (error) {
            logger.store(this.storeName, 'error', `Error fetching products from database: ❌ ${error.message}`);
            return [];
        }
    }

    async executePhase1(skipProblematic = false, requestsPerSecond, checkCancellation, updateProgress) {
        logger.store(this.storeName, 'info', 'Starting Phase 1 for Home Depot Provider.');
        const startTime = Date.now();

        await this.init();
        
        // Setup monitoring interval para requests pendentes
        const monitoringInterval = setInterval(() => {
            if (this.pendingRequests.size > 0) {
                logger.store(this.storeName, 'warn', 
                    `[REQUEST-MONITOR] ${this.pendingRequests.size} requests pending`
                );
                this.checkPendingRequests();
            }
        }, 15000);

        const products = await this.fetchProductsFromDb();
        if (products.length === 0) {
            logger.store(this.storeName, 'warn', 'No Home Depot products found to process.');
            clearInterval(monitoringInterval);
            await this.close();
            return { success: true, message: 'No products to process.' };
        }
        
        logger.store(this.storeName, 'info', `Processing ${products.length} products individually.`);

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

        const concurrency = this.requestsPerSecond || 5;
        logger.store(this.storeName, 'info', `Using concurrency: ${concurrency} requests/second (config: ${this.requestsPerSecond})`);
        const queue = new SimpleQueue({ concurrency });
        
        let batchStartTime = Date.now();
        let processedInBatch = 0;
        
        // Process all products individually with rate limiting
        const promises = [];
        let isCancelled = false;
        
        for (const product of products) {
            if (checkCancellation && checkCancellation()) {
                logger.store(this.storeName, 'info', 'Phase 1 cancelled by user.');
                isCancelled = true;
                // Limpar tarefas pendentes da fila
                const clearedTasks = queue.clear();
                logger.store(this.storeName, 'info', `Cleared ${clearedTasks} pending tasks from queue.`);
                break;
            }

            // Adicionar à fila sem await para permitir processamento paralelo
            const promise = queue.add(async () => {
                // Verificar cancelamento antes de processar cada produto
                if (checkCancellation && checkCancellation()) {
                    logger.store(this.storeName, 'info', `Skipping product ${product.sku} due to cancellation.`);
                    return { status: 'cancelled' };
                }
                
                try {
                    const result = await this.updateProductInDb(product);
                    
                    progress.processedProducts++;
                    
                    if (result.status === 'updated') {
                        progress.updatedProducts++;
                        progress.successCount++;
                    } else if (result.status === 'success' || result.status === 'no_changes') {
                        progress.successCount++;
                    } else if (result.status === 'failed') {
                        progress.failCount++;
                    }
                    
                    if (updateProgress) updateProgress(progress);
                    
                    processedInBatch++;
                    
                    if (processedInBatch % 100 === 0) {
                        const batchDuration = Date.now() - batchStartTime;
                        logger.store(this.storeName, 'info', `Processed batch of 100 products in ${batchDuration}ms`);
                        batchStartTime = Date.now();
                        processedInBatch = 0;
                    }
                    
                } catch (error) {
                    progress.processedProducts++;
                    progress.failCount++;
                    logger.store(this.storeName, 'error', `Error processing product ${product.sku}: ❌ ${error.message}`);
                    
                    if (updateProgress) updateProgress(progress);
                }
            });
            
            promises.push(promise);
        }

        // Aguardar todas as promessas
        await Promise.all(promises);
        
        // Limpar monitoring interval
        clearInterval(monitoringInterval);
        
        // Verificar se foi cancelado após processar
        if (!isCancelled && checkCancellation && checkCancellation()) {
            isCancelled = true;
        }

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        // Log final statistics
        logger.store(this.storeName, 'info', '=== Phase 1 Summary ===');
        logger.store(this.storeName, 'info', `Duration: ${duration.toFixed(2)}s`);
        logger.store(this.storeName, 'info', `Total products: ${progress.totalProducts}`);
        logger.store(this.storeName, 'info', `Processed: ${progress.processedProducts}`);
        logger.store(this.storeName, 'info', `Success: ${progress.successCount}`);
        logger.store(this.storeName, 'info', `Failed: ${progress.failCount}`);
        logger.store(this.storeName, 'info', `Updated: ${progress.updatedProducts}`);
        logger.store(this.storeName, 'info', `Out of Stock: ${this.outOfStockSet.size}`);
        
        if (isCancelled) {
            logger.store(this.storeName, 'info', 'Sync was CANCELLED by user');
        }

        if (updateProgress) updateProgress(progress);
        
        // Batch update all problematic products
        if (this.problematicProducts.length > 0) {
            logger.store(this.storeName, 'info', `❌ Updating ${this.problematicProducts.length} problematic products in database...`);
            try {
                // Create placeholders for the query
                const placeholders = this.problematicProducts.map((_, index) => `$${index + 2}`).join(', ');
                const query = `
                    UPDATE produtos 
                    SET sku_problem = true, atualizado = $1, last_update = NOW() 
                    WHERE sku IN (${placeholders})
                `;
                const params = [this.updateFlagValue, ...this.problematicProducts];
                
                await this.dbService.executeWithRetry(query, params);
                logger.store(this.storeName, 'info', `✅ Successfully marked ${this.problematicProducts.length} products as problematic`);
            } catch (error) {
                logger.store(this.storeName, 'error', `Failed to batch update problematic products: ❌ ${error.message}`);
            }
        }
        
        await this.close();

        return {
            success: !isCancelled,
            cancelled: isCancelled,
            executionTime: duration,
            totalProducts: progress.totalProducts,
            processedProducts: progress.processedProducts,
            successCount: progress.successCount,
            failCount: progress.failCount,
            updatedProducts: progress.updatedProducts
        };
    }

    async executePhase2(batchSize, checkInterval, checkCancellation, updateProgress) {
        logger.store(this.storeName, 'info', `Running Phase 2 for ${this.getName()} provider`);
        
        try {
            process.env.CURRENT_PROVIDER_ID = 'homedepot';
            process.env.HOMEDEPOT_UPDATE_FLAG_VALUE = this.updateFlagValue.toString();
            
            await this.init();
            
            const effectiveBatchSize = batchSize || 100;
            logger.store(this.storeName, 'info', `Phase 2 using batch size: ${effectiveBatchSize}`);
            
            const result = await require('../phases/phase2').mainPhase2(
                effectiveBatchSize,
                checkInterval,
                checkCancellation,
                updateProgress
            );
            
            return {
                success: result,
                totalProducts: updateProgress ? updateProgress.totalProducts : 0,
                successCount: updateProgress ? updateProgress.successCount : 0,
                failCount: updateProgress ? updateProgress.failCount : 0
            };
        } catch (error) {
            logger.store(this.storeName, 'error', `Error in Phase 2: ❌ ${error.message}`);
            throw error;
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
                UPDATE produtos SET atualizado = 0
                WHERE atualizado = ${this.updateFlagValue} AND source = 'Home Depot'
            `
        };
    }

    async resetUpdatedProducts() {
        try {
            await this.init();
            const { resetUpdatedProducts } = this.getPhase2Queries();
            const result = await this.dbService.executeWithRetry(resetUpdatedProducts);
            logger.store(this.storeName, 'info', `Reset updated flag for ${result.rowCount} products`);
        } catch (error) {
            logger.store(this.storeName, 'error', `Error resetting updated products: ❌ ${error.message}`);
            throw error;
        } finally {
            await this.close();
        }
    }

    // Request monitoring methods
    startRequestMonitoring() {
        this.requestMonitorInterval = setInterval(() => {
            this.checkPendingRequests();
        }, 15000);
    }

    stopRequestMonitoring() {
        if (this.requestMonitorInterval) {
            clearInterval(this.requestMonitorInterval);
            this.requestMonitorInterval = null;
        }
    }

    getRequestStats() {
        return {
            totalRequests: this.requestCounter,
            pendingRequests: this.pendingRequests.size,
            pendingRequestsInfo: Array.from(this.pendingRequests.entries()).map(([id, info]) => ({
                requestId: id,
                sku: info.sku,
                age: Date.now() - info.startTime
            }))
        };
    }
}

module.exports = HomeDepotProvider;
