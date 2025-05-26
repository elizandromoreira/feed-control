/**
 * Configuração do sistema de logging
 * 
 * Este módulo configura o sistema de logging usando Winston com rotação diária de arquivos.
 * Equivalente à função configure_logging() do script Python original.
 */

const winston = require('winston');
const { format, transports } = winston;
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs');

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
    defaultMeta: { service: 'HomeDepotSync' },
    transports: [
      // Arquivo de log com rotação diária
      new DailyRotateFile({
        filename: path.join(LOG_DIR, 'homedepot_sync_combined-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        maxFiles: '7d',
        level: logLevel,
        format: format.combine(
          format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
          format.printf(({ timestamp, level, message }) => {
            return `${timestamp} - ${level.toUpperCase()} - [HomeDepotSync] - ${message}`;
          })
        )
      }),
      // Console para output em tempo real
      new transports.Console({
        format: format.combine(
          format.colorize(),
          format.timestamp({ format: 'HH:mm:ss' }),
          format.printf(({ timestamp, level, message }) => {
            return `${timestamp} - ${level} - ${message}`;
          })
        )
      })
    ]
  });
  
  return logger;
};

module.exports = configureLogging;
