const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');

/**
 * GET /api/logs/recent
 * Retorna logs recentes importantes para a UI
 */
router.get('/recent/:storeId?', async (req, res) => {
  try {
    const { storeId } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const level = req.query.level || 'all'; // all, error, warn, info
    
    // Determinar arquivo de log para ler
    const today = new Date().toISOString().split('T')[0];
    const logFile = level === 'error' 
      ? path.join(LOG_DIR, `error-${today}.log`)
      : path.join(LOG_DIR, `combined-${today}.log`);
    
    // Verificar se arquivo existe
    try {
      await fs.access(logFile);
    } catch {
      return res.json({ logs: [], message: 'No logs available for today' });
    }
    
    // Ler arquivo de log
    const content = await fs.readFile(logFile, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    // Filtrar logs importantes
    let logs = [];
    for (const line of lines.slice(-limit)) {
      try {
        // Extrair componentes do log
        const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) - (\w+) - \[([^\]]+)\] - (.+)$/);
        if (!match) continue;
        
        const [, timestamp, logLevel, service, message] = match;
        
        // Filtrar por nível se especificado
        if (level !== 'all' && logLevel.toLowerCase() !== level.toLowerCase()) continue;
        
        // Filtrar por storeId se especificado
        if (storeId && !message.toLowerCase().includes(storeId.toLowerCase())) continue;
        
        // Identificar logs importantes para UI
        const isImportant = 
          logLevel === 'ERROR' ||
          logLevel === 'WARN' ||
          message.includes('Request completed') ||
          message.includes('REQUEST-MONITOR') ||
          message.includes('API ERROR') ||
          message.includes('TIMEOUT') ||
          message.includes('NETWORK ERROR') ||
          message.includes('Product Update:') ||
          message.includes('Phase 1 finished') ||
          message.includes('Final Update Summary') ||
          message.includes('Stock status:') ||
          message.includes('Problematic products') ||
          message.includes('Failed to fetch') ||
          message.includes('marked as problematic');
        
        if (isImportant) {
          logs.push({
            timestamp,
            level: logLevel,
            service,
            message,
            type: categorizeLog(message, logLevel)
          });
        }
      } catch (err) {
        // Ignorar linhas mal formatadas
        continue;
      }
    }
    
    // Retornar logs mais recentes primeiro
    logs.reverse();
    
    res.json({ 
      logs,
      total: logs.length,
      filter: { storeId, level, limit }
    });
    
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ error: 'Failed to read logs' });
  }
});

/**
 * GET /api/logs/stats
 * Retorna estatísticas de logs e requests
 */
router.get('/stats/:storeId?', async (req, res) => {
  try {
    const { storeId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `combined-${today}.log`);
    
    try {
      await fs.access(logFile);
    } catch {
      return res.json({ stats: {
        totalRequests: 0,
        completedRequests: 0,
        failedRequests: 0,
        pendingRequests: 0,
        errors: 0,
        warnings: 0,
        productUpdates: 0
      }});
    }
    
    const content = await fs.readFile(logFile, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    const stats = {
      totalRequests: 0,
      completedRequests: 0,
      failedRequests: 0,
      pendingRequests: 0,
      errors: 0,
      warnings: 0,
      productUpdates: 0,
      timeouts: 0,
      apiErrors: 0,
      networkErrors: 0
    };
    
    const pendingRequests = new Map();
    
    for (const line of lines) {
      // Filtrar por storeId se especificado
      if (storeId && !line.toLowerCase().includes(storeId.toLowerCase())) continue;
      
      if (line.includes('Starting request for SKU')) {
        stats.totalRequests++;
        const reqMatch = line.match(/\[REQ-(\d+)\]/);
        if (reqMatch) {
          pendingRequests.set(reqMatch[1], true);
        }
      }
      
      if (line.includes('Request completed')) {
        const reqMatch = line.match(/\[REQ-(\d+)\]/);
        if (reqMatch) {
          pendingRequests.delete(reqMatch[1]);
          if (line.includes('Success: true')) {
            stats.completedRequests++;
          } else {
            stats.failedRequests++;
          }
        }
      }
      
      if (line.includes('- ERROR -')) stats.errors++;
      if (line.includes('- WARN -')) stats.warnings++;
      if (line.includes('Product Update:')) stats.productUpdates++;
      if (line.includes('TIMEOUT')) stats.timeouts++;
      if (line.includes('API ERROR') || line.includes('API FAILURE')) stats.apiErrors++;
      if (line.includes('NETWORK ERROR')) stats.networkErrors++;
    }
    
    stats.pendingRequests = pendingRequests.size;
    
    res.json({ stats });
    
  } catch (error) {
    console.error('Error calculating stats:', error);
    res.status(500).json({ error: 'Failed to calculate stats' });
  }
});

/**
 * GET /api/logs/request-monitor
 * Retorna status atual de requests pendentes
 */
router.get('/request-monitor', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `combined-${today}.log`);
    
    const content = await fs.readFile(logFile, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    // Rastrear requests pendentes
    const requests = new Map();
    
    for (const line of lines) {
      const reqMatch = line.match(/\[REQ-(\d+)\]/);
      if (!reqMatch) continue;
      
      const requestId = reqMatch[1];
      
      if (line.includes('Starting request')) {
        const skuMatch = line.match(/SKU (\S+)/);
        const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
        
        requests.set(requestId, {
          id: requestId,
          sku: skuMatch ? skuMatch[1] : 'Unknown',
          startTime: timeMatch ? timeMatch[1] : 'Unknown',
          status: 'pending',
          duration: null,
          error: null
        });
      }
      
      if (line.includes('Request completed')) {
        const request = requests.get(requestId);
        if (request) {
          const durationMatch = line.match(/Total duration: (\d+)ms/);
          const successMatch = line.match(/Success: (true|false)/);
          
          request.status = successMatch && successMatch[1] === 'true' ? 'completed' : 'failed';
          request.duration = durationMatch ? parseInt(durationMatch[1]) : null;
        }
      }
      
      if (line.includes('ERROR') && reqMatch) {
        const request = requests.get(requestId);
        if (request) {
          request.error = line.substring(line.indexOf(' - ') + 3);
        }
      }
    }
    
    // Converter para array e filtrar apenas pendentes se solicitado
    const allRequests = Array.from(requests.values());
    const pendingOnly = req.query.pending === 'true';
    const results = pendingOnly 
      ? allRequests.filter(r => r.status === 'pending')
      : allRequests;
    
    res.json({
      requests: results.slice(-50), // Últimas 50 requests
      total: results.length,
      pending: allRequests.filter(r => r.status === 'pending').length
    });
    
  } catch (error) {
    console.error('Error monitoring requests:', error);
    res.status(500).json({ error: 'Failed to monitor requests' });
  }
});

// Função auxiliar para categorizar logs
function categorizeLog(message, level) {
  if (level === 'ERROR') return 'error';
  if (level === 'WARN') return 'warning';
  
  if (message.includes('Starting request')) return 'request_start';
  if (message.includes('Request completed')) return 'request_end';
  if (message.includes('Product Update:')) return 'product_update';
  if (message.includes('Phase') && message.includes('finished')) return 'phase_complete';
  if (message.includes('Final Update Summary')) return 'summary';
  if (message.includes('REQUEST-MONITOR')) return 'monitor';
  
  return 'info';
}

module.exports = router;
