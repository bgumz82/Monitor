/**
 * Aplicação principal de monitoramento
 */

// Carregar variáveis de ambiente
require('dotenv').config();

const logger = require('./logger');
const config = require('./config');
const ApiClient = require('./database');
const TaskExecutor = require('./tasks');
const DatabaseMonitor = require('./monitor');
const WebServer = require('./server');

class MonitorApp {
  constructor() {
    this.apiClient = new ApiClient();
    this.taskExecutor = new TaskExecutor();
    this.monitor = null;
    this.webServer = null;
    this.isShuttingDown = false;
  }

  // Inicializar aplicação
  async initialize() {
    try {
      logger.info('🚀 Iniciando aplicação de monitoramento...');
      
      // Conectar à API
      await this.apiClient.connect();
      
      // Inicializar monitor
      this.monitor = new DatabaseMonitor(this.apiClient, this.taskExecutor);
      
      // Inicializar servidor web
      this.webServer = new WebServer(this.apiClient, this.monitor);
      
      // Configurar handlers de shutdown
      this.setupShutdownHandlers();
      
      logger.info('✅ Aplicação inicializada com sucesso');
      
    } catch (error) {
      logger.error('❌ Falha na inicialização:', error);
      process.exit(1);
    }
  }

  // Iniciar todos os serviços
  async start() {
    try {
      logger.info('Iniciando serviços...');
      
      // Iniciar servidor web
      if (config.server.enabled) {
        this.webServer.start();
      }
      
      // Iniciar monitor
      this.monitor.start();
      
      // Inserir alguns dados de teste
      await this.insertTestData();
      
      logger.info('🎯 Aplicação rodando. Monitoramento ativo!');
      logger.info(`📊 Interface de gerenciamento: http://localhost:${config.server.port}`);
      
    }
  }
  setupShutdownHandlers() {
    const gracefulShutdown = async (signal) => {
      if (this.isShuttingDown) {
        return;
      }
      
      this.isShuttingDown = true;
      logger.info(`Recebido sinal ${signal}. Iniciando shutdown graceful...`);
      
      try {
        // Parar monitor
        if (this.monitor) {
          this.monitor.stop();
        }
        
        // Aguardar tarefas em execução terminarem (máximo 30 segundos)
        const shutdownTimeout = setTimeout(() => {
          logger.warn('Timeout no shutdown. Forçando encerramento...');
          process.exit(1);
        }, 30000);
        
        // Aguardar tarefas terminarem
        while (this.taskExecutor.getRunningTasks().length > 0) {
          logger.info('Aguardando tarefas em execução terminarem...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        clearTimeout(shutdownTimeout);
        
        // Fechar cliente API
        this.apiClient.close();
        
        logger.info('✅ Shutdown concluído com sucesso');
        process.exit(0);
        
      } catch (error) {
        logger.error('Erro durante shutdown:', error);
        process.exit(1);
      }
    };

    // Configurar listeners para sinais de shutdown
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // Tratar erros não capturados
    process.on('uncaughtException', (error) => {
      logger.error('Erro não capturado:', error);
      gracefulShutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Promise rejeitada não tratada:', reason);
      gracefulShutdown('unhandledRejection');
    });
  }
}

// Executar aplicação
async function main() {
  const app = new MonitorApp();
  
  try {
    await app.initialize();
    await app.start();
  } catch (error) {
    logger.error('Falha crítica na aplicação:', error);
    process.exit(1);
  }
}

// Iniciar aplicação apenas se executado diretamente
if (require.main === module) {
  main();
}

module.exports = MonitorApp;