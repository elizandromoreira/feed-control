// Log configuration for controlling verbosity levels

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  VERBOSE: 4
};

// Configuration for different log categories
const LOG_CONFIG = {
  // Progress updates - only log significant changes
  progress: {
    enabled: true,
    minChangePercent: 10, // Only log if progress changes by 10% or more
    maxFrequencyMs: 60000 // Maximum once per minute
  },
  
  // API endpoint logs
  api: {
    enabled: true,
    excludePaths: ['/api/stores/:storeId/progress'], // Don't log polling endpoints
    minIntervalMs: 300000 // 5 minutes between logs for same endpoint
  },
  
  // Feed processing logs
  feed: {
    enabled: true,
    showDetails: false, // Don't show full JSON objects
    statusCheckInterval: 5 // Log status every 5 checks instead of every check
  },
  
  // Database operations
  database: {
    enabled: true,
    showQueries: false, // Don't log full SQL queries
    connectionLogs: false // Don't log connection/disconnection
  },
  
  // Provider sync logs
  sync: {
    enabled: true,
    showProductDetails: false, // Don't log individual product processing
    batchSummaryOnly: true // Only show batch summaries
  }
};

// Helper function to check if should log based on config
function shouldLog(category, subcategory = null) {
  const config = LOG_CONFIG[category];
  if (!config || !config.enabled) return false;
  
  if (subcategory && config[subcategory] === false) return false;
  
  return true;
}

// Helper function to format large objects for logging
function formatForLog(obj, maxLength = 100) {
  const str = JSON.stringify(obj);
  if (str.length <= maxLength) return str;
  
  // For large objects, show summary
  const keys = Object.keys(obj);
  return `{${keys.slice(0, 3).join(', ')}... (${keys.length} keys)}`;
}

module.exports = {
  LOG_LEVELS,
  LOG_CONFIG,
  shouldLog,
  formatForLog
};
