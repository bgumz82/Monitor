/**
 * Sistema de monitoramento do banco de dados
 */

const logger = require('./logger');
const config = require('./config');

class DatabaseMonitor {
  constructor(apiClient, taskExecutor) {
    this.apiClient = apiClient;
    this.taskExecutor = taskExecutor;
    this.isRunning = false;
    this.monitorInterval = null;
    this.lastCheck = null;
    this.processedCount = 0;
  }

  // Iniciar monitoramento
  start() {
    if (this.isRunning) {
      logger.warn('Monitor já está em execução');
      return;
    }

    logger.info('Iniciando monitoramento do banco de dados...');
    this.isRunning = true;
    this.lastCheck = new Date();

    // Configurar intervalo de verificação
    this.monitorInterval = setInterval(async () => {
      await this.checkDatabase();
    }, config.api.checkInterval);

    // Primeira verificação imediata
    this.checkDatabase();

    logger.info(`Monitor iniciado. Verificando a cada ${config.api.checkInterval}ms`);
  }

  // Parar monitoramento
  stop() {
    if (!this.isRunning) {
      logger.warn('Monitor não está em execução');
      return;
    }

    logger.info('Parando monitoramento do banco de dados...');
    this.isRunning = false;

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    logger.info('Monitor parado');
  }

  // Atualizar intervalo de verificação
  updateInterval(newInterval) {
    if (this.isRunning) {
      logger.info(`Atualizando intervalo de ${config.api.checkInterval}ms para ${newInterval}ms`);
      
      // Parar intervalo atual
      if (this.monitorInterval) {
        clearInterval(this.monitorInterval);
      }
      
      // Configurar novo intervalo
      this.monitorInterval = setInterval(async () => {
        await this.checkDatabase();
      }, newInterval);
      
      logger.info(`Intervalo atualizado para ${newInterval/1000}s`);
    }
  }

  // Verificar banco de dados
  async checkDatabase() {
    try {
      this.lastCheck = new Date();
      logger.info('Verificando API para documentos pendentes...');

      // Buscar registros que atendem às condições
      const records = await this.apiClient.getRecordsToProcess();

      if (records.length > 0) {
        logger.info(`Encontrados ${records.length} registro(s) para processamento`);
        
        // Processar cada registro
        for (const record of records) {
          await this.processRecord(record);
        }
      } else {
        logger.info('Nenhum registro encontrado para processamento');
      }
    } catch (error) {
      logger.error('Erro durante verificação da API:', error);
    }
  }

  // Processar um registro individual
  async processRecord(record) {
    try {
      logger.info(`Processando registro ID: ${record.id}`);
      
      // Executar tarefas para o registro
      const result = await this.taskExecutor.executeTask(record);
      
      if (result.success) {
        // Marcar como processado no banco
        await this.apiClient.markAsProcessed(record.id);
        this.processedCount++;
        logger.info(`Registro ${record.id}${record.numero_cte ? ` (CTE: ${record.numero_cte})` : ''} processado com sucesso`);
      } else {
        logger.error(`Falha no processamento do registro ${record.id}${record.numero_cte ? ` (CTE: ${record.numero_cte})` : ''}: ${result.error}`);
      }
    } catch (error) {
      logger.error(`Erro ao processar registro ${record.id}:`, error);
    }
  }

  // Obter estatísticas do monitor
  getStats() {
    return {
      isRunning: this.isRunning,
      lastCheck: this.lastCheck,
      processedCount: this.processedCount,
      checkInterval: config.api.checkInterval,
      runningTasks: this.taskExecutor.getRunningTasks()
    };
  }

  // Reiniciar monitor
  restart() {
    logger.info('Reiniciando monitor...');
    this.stop();
    setTimeout(() => {
      this.start();
    }, 2000);
  }
}

module.exports = DatabaseMonitor;