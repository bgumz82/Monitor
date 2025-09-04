/**
 * Sistema de logs da aplicação
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('./config');

// Criar diretório de logs se não existir
const logDir = path.dirname(config.logging.logFile);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Configurar formatos de log
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

// Criar logger
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports: [
    // Log para arquivo
    new winston.transports.File({
      filename: config.logging.logFile,
      maxsize: config.logging.maxSize,
      maxFiles: config.logging.maxFiles,
    }),
    // Log para console (desenvolvimento)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    })
  ]
});

module.exports = logger;