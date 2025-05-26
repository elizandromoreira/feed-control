# Code Issues Analysis

## Issue 1: Frontend not loading store configurations from .env

### Problem Description
The frontend is not properly loading store configurations from the `.env` file. Currently, the `StoreDashboard.tsx` component initializes configurations with hardcoded default values instead of fetching them from environment variables.

### Analysis
1. In `StoreDashboard.tsx`, the configuration is initialized with hardcoded values:
```typescript
const [config, setConfig] = useState<Config>({
  stockLevel: 7,
  batchSize: 240,
  requestsPerSecond: 12,
  handlingTimeOmd: 2,
  homeDepotHandlingTime: 2,
  whiteCapHandlingTime: 2,
  vitacostHandlingTime: 2,
  bestbuyHandlingTime: 4,
  webstaurantstoreHandlingTime: 2,
  updateFlagValue: id === 'webstaurantstore' ? 5 : 1
});
```

2. The backend properly loads configurations from `.env.production` and provides them through the `/api/stores/:storeId/config` endpoint.

3. The backend correctly updates the `.env.production` file when configurations are changed through the API.

### Solution
Modify the `StoreDashboard.tsx` component to load configurations from the API instead of using hardcoded values. The component already has a function to fetch store configurations, but it's not being used effectively:

```typescript
// In the fetchStoreDetails function, ensure the config is properly loaded from the API
try {
  const configResponse = await axios.get(`${API_URL}/stores/${id}/config`);
  if (configResponse.data) {
    setConfig(configResponse.data);
  }
} catch (configError) {
  console.error('Erro ao buscar configurações:', configError);
}
```

This code exists but needs to be prioritized and executed before any operations that depend on the configuration values.

## Issue 2: Status bar not updating in real-time

### Problem Description
The status bar in the frontend is not updating in real-time, preventing users from seeing the current progress of operations.

### Analysis
1. The frontend has a polling mechanism to update progress, but it's not working effectively:
```typescript
const startProgressPolling = () => {
  if (progressPolling) {
    clearInterval(progressPolling);
  }
  
  const intervalId = setInterval(async () => {
    try {
      const progressResponse = await axios.get(`${API_URL}/stores/${id}/progress`);
      // ...
    } catch (error) {
      console.error(`[ERROR] Erro ao buscar progresso para ${id}:`, error);
    }
  }, 2000);
  
  setProgressPolling(intervalId);
};
```

2. The polling is only started when the status is 'running', but there are issues with how the status is determined and updated.

3. The backend updates the progress information correctly in the `progressInfo` object, but the frontend may not be receiving these updates consistently.

### Solution
1. Improve the polling mechanism to ensure it starts correctly and continues running while operations are in progress:

```typescript
// Ensure polling starts immediately when the component mounts
useEffect(() => {
  if (!id) {
    setError('ID da loja não fornecido');
    setLoading(false);
    return;
  }
  
  fetchStoreDetails();
  startProgressPolling(); // Start polling immediately
  
  // Cleanup on unmount
  return () => {
    if (progressPolling) {
      clearInterval(progressPolling);
    }
  };
}, [id]);
```

2. Modify the progress update logic to always update the UI when new data is received, regardless of whether there are "significant" changes:

```typescript
// Remove the conditional check that might prevent updates
if (progressResponse.data) {
  // Always update the progress state with the latest data
  setProgress(progressResponse.data);
}
```

3. Ensure the backend's progress endpoint (`/api/stores/:storeId/progress`) is correctly updating the `isRunning` flag and other progress information in real-time.

## Issue 3: Backend code structure and hardcoded values

### Problem Description
The `backend/index.js` file is excessively large and contains many hardcoded values that should be in environment variables. The code is not properly modularized, which makes it difficult to maintain and extend.

### Analysis

1. **Debug code in production**: The file starts with debug console logs that should not be in production code:
```javascript
console.log('=== DEBUG DE VARIÁVEIS DE AMBIENTE NA INICIALIZAÇÃO ===');
console.log('VITACOST_STOCK_LEVEL:', process.env.VITACOST_STOCK_LEVEL, 
            'Tipo:', typeof process.env.VITACOST_STOCK_LEVEL, 
            'Comprimento:', process.env.VITACOST_STOCK_LEVEL ? process.env.VITACOST_STOCK_LEVEL.length : 0);
// ... more debug logs
```

2. **Hardcoded values**: Many values are hardcoded instead of being loaded from environment variables:
```javascript
// Hardcoded API requests per second
parseInt(process.env.REQUESTS_PER_SECOND) || 7,
// Hardcoded batch size
parseInt(process.env.BATCH_SIZE) || 9990,
// Hardcoded interval
const originalScheduleInterval = store.scheduleInterval || 4;
// Hardcoded database values
let dbInterval = 4; // Valor padrão se não encontrado no banco
```

3. **Special case handling**: There's excessive special case handling for Best Buy that should be abstracted:
```javascript
// Correção específica para Best Buy - FORÇAR intervalo de 4 horas
if (storeId === 'bestbuy') {
  // ... 30+ lines of special case code
}

// CASO ESPECIAL PARA BEST BUY - RESPEITAR INTERVALO DO BANCO DE DADOS
if (storeId === 'bestbuy') {
  // ... another 70+ lines of special case code
}
```

4. **Lack of modularization**: All route handlers are defined in the main file instead of being separated into route modules:
```javascript
// These should be in separate route files
app.get('/api/stores', async (req, res) => { /* ... */ });
app.post('/api/stores', async (req, res) => { /* ... */ });
app.post('/api/stores/:storeId/config', async (req, res) => { /* ... */ });
// ... many more route handlers
```

5. **Redundant database connections**: Database connections are created and closed multiple times throughout the code instead of using a connection pool:
```javascript
// Creating new pool in multiple functions
const { Pool } = require('pg');
const { DB_CONFIG } = require('./src/config/db');
const pool = new Pool(DB_CONFIG);
// ... code that uses the pool
await pool.end();
```

6. **Commented out code**: There's a significant amount of commented out code that should be removed:
```javascript
// View engine (comentado, pois não vamos mais usar EJS para renderização)
// app.set('view engine', 'ejs');
// app.set('views', path.join(__dirname, 'views'));

// Rotas para o dashboard web - COMENTADAS para desabilitar o dashboard antigo
/* app.get('/', async (req, res) => {
  // ...
}); */
```

7. **Excessive error handling**: Many functions have similar error handling patterns that could be abstracted into middleware:
```javascript
try {
  // ... function logic
} catch (error) {
  logger.error(`Error message: ${error.message}`, { error });
  res.status(500).json({ message: error.message });
}
```

### Solution

1. **Modularize the code**:
   - Move route handlers to separate files in a `routes` directory
   - Create controller files to handle business logic
   - Separate database operations into repository files

2. **Use environment variables consistently**:
   - Move all hardcoded values to environment variables
   - Create a config module to load and validate environment variables
   - Use default values only as fallbacks

3. **Implement middleware**:
   - Create error handling middleware
   - Add validation middleware for request parameters
   - Use authentication middleware where needed

4. **Improve database handling**:
   - Create a single database connection pool
   - Implement repository pattern for database operations
   - Use transactions for operations that require multiple queries

5. **Remove special case handling**:
   - Create a provider-specific configuration system
   - Use strategy pattern for different store types
   - Move provider-specific logic to separate modules

6. **Clean up the code**:
   - Remove commented out code
   - Remove debug console logs
   - Add proper JSDoc comments

## Implementation Recommendations

1. **Frontend Configuration Loading**:
   - Ensure the `fetchStoreDetails` function in `StoreDashboard.tsx` prioritizes loading configurations from the API.
   - Add error handling to fall back to default values only when the API request fails.

2. **Real-time Status Updates**:
   - Modify the polling interval to be shorter (e.g., 1000ms instead of 2000ms) for more responsive updates.
   - Remove conditional logic that might prevent UI updates when progress data changes.
   - Add a visual indicator when the status is being updated to provide feedback to users.

3. **Backend Improvements**:
   - Ensure the progress information is updated consistently across all API endpoints.
   - Add timestamps to progress updates to help the frontend determine if data is stale.
   - Implement WebSocket communication for real-time updates instead of polling, if possible.
   - Restructure the backend code following proper Node.js architecture patterns.
   - Move route handlers to separate files and organize by resource.
   - Create a proper configuration system for environment variables.
   - Implement a centralized error handling system.

By implementing these changes, the application will properly load configurations from environment variables, provide real-time status updates to users, and have a more maintainable and extensible codebase.