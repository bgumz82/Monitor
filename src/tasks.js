/**
 * Sistema de execução de tarefas
 */

const logger = require('./logger');
const config = require('./config');
const fs = require('fs').promises;
const path = require('path');

class TaskExecutor {
  constructor() {
    this.runningTasks = new Map();
    this.processingFiles = new Map(); // Arquivos aguardando processamento
    this.setupDirectories();
  }

  // Configurar diretórios necessários
  async setupDirectories() {
    try {
      const dirs = [
        config.xmlProcessing.sourceFolder,
        config.xmlProcessing.cnpjBasePath
      ];
      
      for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
      }
      
      logger.info('Diretórios XML configurados');
    } catch (error) {
      logger.error('Erro ao configurar diretórios:', error);
    }
  }

  // Executar tarefa para um registro específico
  async executeTask(record) {
    const taskId = `task_${record.id}_${Date.now()}`;
    
    try {
      logger.info(`Iniciando execução da tarefa para registro ID: ${record.id}`);
      this.runningTasks.set(taskId, { recordId: record.id, startTime: new Date() });

      // Simular execução de tarefas baseadas no registro
      await this.processRecord(record);

      // Executar tarefas específicas baseadas no tipo/dados
      await this.executeSpecificTasks(record);

      this.runningTasks.delete(taskId);
      logger.info(`Tarefa concluída com sucesso para registro ID: ${record.id}`);
      
      return { success: true, recordId: record.id };
    } catch (error) {
      this.runningTasks.delete(taskId);
      logger.error(`Erro na execução da tarefa para registro ${record.id}:`, error);
      
      // Implementar retry se configurado
      return await this.handleTaskFailure(record, error);
    }
  }

  // Processar registro específico
  async processRecord(record) {
    logger.info(`Processando documento CTE: ID=${record.id}, Status=${record.status}`);
    
    // Extrair CNPJ da chave de acesso
    const cnpj = this.extractCNPJFromChaveAcesso(record.numero_cte);
    if (!cnpj) {
      throw new Error(`Não foi possível extrair CNPJ da chave de acesso: ${record.numero_cte}`);
    }
    
    logger.info(`CNPJ extraído: ${cnpj}`);
    
    // Processar baseado no status
    switch (record.status) {
      case 'pendente':
        await this.handlePendingDocument(record, cnpj);
        break;
      default:
        logger.warn(`Status desconhecido: ${record.status}`);
    }
  }

  // Extrair CNPJ da chave de acesso do CTE
  extractCNPJFromChaveAcesso(chaveAcesso) {
    try {
      // Chave de acesso do CTE tem 44 dígitos
      // Posições 6-19 contêm o CNPJ (14 dígitos)
      if (!chaveAcesso || chaveAcesso.length !== 44) {
        logger.warn(`Chave de acesso inválida: ${chaveAcesso}`);
        return null;
      }
      
      const cnpj = chaveAcesso.substring(6, 20);
      
      // Validar se é um CNPJ válido (14 dígitos numéricos)
      if (!/^\d{14}$/.test(cnpj)) {
        logger.warn(`CNPJ extraído inválido: ${cnpj}`);
        return null;
      }
      
      return cnpj;
    } catch (error) {
      logger.error('Erro ao extrair CNPJ da chave de acesso:', error);
      return null;
    }
  }

  // Lidar com documentos CTE pendentes
  async handlePendingDocument(record, cnpj) {
    logger.info(`Processando documento CTE pendente: ${record.numero_cte} (CNPJ: ${cnpj})`);
    
    // Fluxo simplificado:
    // 1. Mover XML existente para pasta do CNPJ
    // 2. Aguardar arquivo processado pelo aplicativo externo
    // 3. Verificar autorização e atualizar status
    
    await this.moveExistingXMLToCNPJFolder(record, cnpj);
    await this.waitForProcessedFile(record, cnpj);
  }

  // Mover XML existente para pasta do CNPJ
  async moveExistingXMLToCNPJFolder(record, cnpj) {
    try {
      const fileName = `${record.numero_cte}.xml`;
      const sourcePath = path.join(config.xmlProcessing.sourceFolder, fileName);
      
      // Verificar se arquivo XML existe na pasta de origem
      const sourceExists = await this.fileExists(sourcePath);
      if (!sourceExists) {
        throw new Error(`Arquivo XML não encontrado: ${sourcePath}`);
      }
      
      // Criar pasta do CNPJ se não existir
      const cnpjFolder = path.join(config.xmlProcessing.cnpjBasePath, cnpj);
      await fs.mkdir(cnpjFolder, { recursive: true });
      
      // Criar subpasta 'processados' se não existir
      const processedFolder = path.join(cnpjFolder, config.xmlProcessing.processedFolder);
      await fs.mkdir(processedFolder, { recursive: true });
      
      const targetPath = path.join(cnpjFolder, fileName);
      
      // Mover arquivo
      await fs.rename(sourcePath, targetPath);
      logger.info(`XML movido para pasta do CNPJ: ${targetPath}`);
      
      return targetPath;
    } catch (error) {
      logger.error(`Erro ao mover XML para pasta do CNPJ ${cnpj}:`, error);
      throw error;
    }
  }

  // Aguardar arquivo processado
  async waitForProcessedFile(record, cnpj) {
    const fileName = `${record.numero_cte}.xml`;
    const processedPath = path.join(
      config.xmlProcessing.cnpjBasePath, 
      cnpj, 
      config.xmlProcessing.processedFolder, 
      fileName
    );
    
    logger.info(`Aguardando arquivo processado: ${processedPath}`);
    
    // Registrar arquivo para monitoramento
    this.processingFiles.set(record.id, {
      recordId: record.id,
      numeroCtE: record.numero_cte,
      cnpj: cnpj,
      processedPath: processedPath,
      startTime: new Date()
    });
    
    // Iniciar verificação periódica se ainda não estiver rodando
    this.startProcessedFileMonitoring();
  }

  // Iniciar monitoramento de arquivos processados
  startProcessedFileMonitoring() {
    if (this.processedFileInterval) {
      return; // Já está rodando
    }
    
    this.processedFileInterval = setInterval(async () => {
      await this.checkProcessedFiles();
    }, config.xmlProcessing.checkProcessedInterval);
    
    logger.info('Monitoramento de arquivos processados iniciado');
  }

  // Verificar arquivos processados
  async checkProcessedFiles() {
    if (this.processingFiles.size === 0) {
      return;
    }
    
    logger.info(`Verificando ${this.processingFiles.size} arquivo(s) aguardando processamento...`);
    
    for (const [recordId, fileInfo] of this.processingFiles.entries()) {
      try {
        // Verificar se arquivo processado existe
        const exists = await this.fileExists(fileInfo.processedPath);
        
        if (exists) {
          logger.info(`Arquivo processado encontrado para CTE ${fileInfo.numeroCtE}: ${fileInfo.processedPath}`);
          
          // Ler conteúdo do arquivo para verificar se foi autorizado
          const authorized = await this.checkIfAuthorized(fileInfo.processedPath);
          
          if (authorized) {
            // Marcar como processado no banco
            await this.markCTEAsEmitted(recordId);
            this.processingFiles.delete(recordId);
            logger.info(`CTE ${fileInfo.numeroCtE} marcado como emitido`);
          } else {
            logger.warn(`CTE ${fileInfo.numeroCtE} processado mas não autorizado`);
          }
        } else {
          // Verificar timeout
          const elapsed = Date.now() - fileInfo.startTime.getTime();
          if (elapsed > config.xmlProcessing.processingTimeout) {
            logger.error(`Timeout aguardando processamento do CTE ${fileInfo.numeroCtE}`);
            this.processingFiles.delete(recordId);
          }
        }
      } catch (error) {
        logger.error(`Erro ao verificar arquivo processado para CTE ${fileInfo.numeroCtE}:`, error);
      }
    }
  }

  // Verificar se arquivo existe
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Verificar se CTE foi autorizado
  async checkIfAuthorized(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      
      // Verificar se contém tag de autorização
      // Pode ser <cStat>100</cStat> ou similar dependendo do formato
      const isAuthorized = content.includes('<cStat>100</cStat>') || 
                          content.includes('autorizado') ||
                          content.includes('Autorizado');
      
      return isAuthorized;
    } catch (error) {
      logger.error('Erro ao verificar autorização do XML:', error);
      return false;
    }
  }

  // Marcar CTE como emitido
  async markCTEAsEmitted(recordId) {
    try {
      await this.apiClient.markAsProcessed(recordId);
      logger.info(`CTE ID ${recordId} marcado como emitido na API`);
    } catch (error) {
      logger.error(`Erro ao marcar CTE ${recordId} como emitido:`, error);
      throw error;
    }
  }

  // Obter estatísticas de arquivos em processamento
  getProcessingStats() {
    const stats = {
      filesWaiting: this.processingFiles.size,
      files: []
    };
    // Esta função será implementada no database.js
    this.processingFiles.forEach((fileInfo, recordId) => {
      stats.files.push({
        recordId: recordId,
        numeroCtE: fileInfo.numeroCtE,
        cnpj: fileInfo.cnpj,
        waitingTime: Date.now() - fileInfo.startTime.getTime()
      });
    });
    
    return stats;
  }
  // Executar tarefas específicas (simplificado)
  async executeSpecificTasks(record) {
    // Tarefas específicas podem ser adicionadas aqui se necessário
    logger.debug(`Executando tarefas específicas para CTE ${record.numero_cte}`);
  }
  // Parar monitoramento de arquivos processados
  stopProcessedFileMonitoring() {
    if (this.processedFileInterval) {
      clearInterval(this.processedFileInterval);
      this.processedFileInterval = null;
      logger.info('Monitoramento de arquivos processados parado');
    }
  }

  // Obter tarefas em execução (incluindo arquivos aguardando)
  getRunningTasks() {
    const tasks = [];
    
    // Tarefas ativas
    this.runningTasks.forEach((task, taskId) => {
      tasks.push({
        taskId,
        recordId: task.recordId,
        startTime: task.startTime,
        duration: Date.now() - task.startTime.getTime(),
        type: 'processing'
      });
    });
    
    // Arquivos aguardando processamento
    this.processingFiles.forEach((fileInfo, recordId) => {
      tasks.push({
        taskId: `waiting_${recordId}`,
        recordId: recordId,
        numeroCtE: fileInfo.numeroCtE,
        cnpj: fileInfo.cnpj,
        startTime: fileInfo.startTime,
        duration: Date.now() - fileInfo.startTime.getTime(),
        type: 'waiting_processing'
      });
    });
    
    return tasks;
  }

  // Lidar com falhas na execução
  async handleTaskFailure(record, error) {
    const maxRetries = config.tasks.retryAttempts;
    const retryKey = `retry_${record.id}`;
    
    // Simular contador de tentativas (em produção, isso deveria ser persistido)
    if (!this.retryCounters) {
      this.retryCounters = new Map();
    }
    
    const currentRetries = this.retryCounters.get(retryKey) || 0;
    
    if (currentRetries < maxRetries) {
      this.retryCounters.set(retryKey, currentRetries + 1);
      logger.warn(`Tentativa ${currentRetries + 1} de ${maxRetries} para CTE ${record.numero_cte} (ID: ${record.id})`);
      
      // Aguardar antes de tentar novamente
      await this.delay(config.tasks.retryDelay);
      
      // Tentar executar novamente
      return await this.executeTask(record);
    } else {
      logger.error(`Falha definitiva na tarefa para CTE ${record.numero_cte} (ID: ${record.id}) após ${maxRetries} tentativas`);
      this.retryCounters.delete(retryKey);
      return { success: false, recordId: record.id, error: error.message };
    }
  }

  // Função utilitária para delay
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup ao parar a aplicação
  cleanup() {
    this.stopProcessedFileMonitoring();
    this.processingFiles.clear();
    this.runningTasks.clear();
  }
}

module.exports = TaskExecutor;