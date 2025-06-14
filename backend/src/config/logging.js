/**
 * Configuração do sistema de logging
 * 
 * Este módulo configura o sistema de logging usando Winston com rotação diária de arquivos.
 * Salva todos os logs da aplicação em arquivos para facilitar debugging e auditoria.
 */

const winston = require('winston');
const { format, transports } = winston;
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

const LOG_DIR = path.join(process.cwd(), 'logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Configura o sistema de logging com modo de debug opcional
 * @param {boolean} debug - Se verdadeiro, configura o nível de log para debug
 * @returns {winston.Logger} - Instância configurada do logger
 */
const configureLogging = (debug = false) => {
  const logLevel = debug ? 'debug' : 'info';
  
  const logger = winston.createLogger({
    level: logLevel,
    format: format.combine(
      format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      format.errors({ stack: true }),
      format.splat(),
      format.json()
    ),
    defaultMeta: { service: 'feed-control' },
    transports: [
      // Combined log - all logs
      new DailyRotateFile({
        filename: path.join(LOG_DIR, 'combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: '14d', // Keep logs for 14 days
        level: logLevel,
        format: format.combine(
          format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          format.printf(({ timestamp, level, message, service, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} - ${level.toUpperCase()} - [${service}] - ${message}${metaStr}`;
          })
        )
      }),
      
      // Error log - only errors
      new DailyRotateFile({
        filename: path.join(LOG_DIR, 'error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: '30d', // Keep error logs for 30 days
        level: 'error',
        format: format.combine(
          format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          format.printf(({ timestamp, level, message, service, stack, ...meta }) => {
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            const stackStr = stack ? `\nStack: ${stack}` : '';
            return `${timestamp} - ${level.toUpperCase()} - [${service}] - ${message}${metaStr}${stackStr}`;
          })
        )
      }),
      
      // Store-specific logs (for sync operations)
      new DailyRotateFile({
        filename: path.join(LOG_DIR, 'sync-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: '7d',
        level: logLevel,
        format: format.combine(
          format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          format.printf(({ timestamp, level, message, store, ...meta }) => {
            const storeStr = store ? ` [${store}]` : '';
            const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} - ${level.toUpperCase()}${storeStr} - ${message}${metaStr}`;
          })
        ),
        // Only log messages that have a 'store' metadata
        filter: format((info) => info.store ? info : false)()
      }),
      
      // Console for real-time output
      new transports.Console({
        format: format.combine(
          format.colorize(),
          format.timestamp({ format: 'HH:mm:ss' }),
          format.printf(({ timestamp, level, message, store, ...meta }) => {
            const storeStr = store ? ` [${store}]` : '';
            const metaStr = Object.keys(meta).length && logLevel === 'debug' ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} - ${level}${storeStr} - ${message}${metaStr}`;
          })
        )
      })
    ]
  });
  
  // Add method to log with store context
  logger.store = function(storeName, level, message, meta = {}) {
    this.log(level, message, { store: storeName, ...meta });
  };
  
  return logger;
};

module.exports = configureLogging;
