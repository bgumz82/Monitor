/**
 * Cliente para API de banco de dados
 */

const logger = require('./logger');
const config = require('./config');

class ApiClient {
  constructor() {
    this.baseUrl = config.api.baseUrl;
    this.isConnected = false;
  }

  async connect() {
    try {
      logger.info('Conectando à API...');
      
      // Testar conexão com a API
      const testResult = await this.testConnection();
      if (testResult.success) {
        this.isConnected = true;
        logger.info('Conectado à API com sucesso');
        
        // Configurar tabela se necessário
        await this.setupTable();
        
        return true;
      } else {
        throw new Error(testResult.message);
      }
    } catch (error) {
      logger.error('Erro ao conectar à API:', error);
      this.isConnected = false;
      throw error;
    }
  }

  async setupTable() {
    try {
      const url = `${this.baseUrl}${config.api.endpoints.setup}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Sem detalhes do erro');
        throw new Error(`HTTP ${response.status}: ${response.statusText || 'Erro desconhecido'} - ${errorBody}`);
      }

      const result = await response.json();
      logger.info('Setup da tabela concluído:', result.message);
      
    } catch (error) {
      logger.warn('Erro no setup da tabela (pode já existir):', error.message);
    }
  }

  async testConnection() {
    try {
      const url = `${this.baseUrl}${config.api.endpoints.stats}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        return { 
          success: false, 
          message: `API não acessível: HTTP ${response.status}` 
        };
      }

      const stats = await response.json();
      
      return { 
        success: true, 
        message: 'Conexão com PostgreSQL via API OK'
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Erro de conexão: ${error.message}` 
      };
    }
  }

  async getRecordsToProcess() {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      const url = `${this.baseUrl}${config.api.endpoints.pendentes}`;
      logger.info(`Fazendo requisição para: ${url}`);
      
      const response = await fetch(url);

      if (!response.ok) {
        let errorDetails = 'Sem detalhes do erro';
        try {
          const errorBody = await response.text();
          errorDetails = errorBody;
        } catch (parseError) {
          errorDetails = 'Erro ao ler resposta do servidor';
        }
        
        logger.error(`ERRO ${response.status} - Falha ao buscar registros pendentes:`);
        logger.error(`URL: ${url}`);
        logger.error(`Status: ${response.status} ${response.statusText}`);
        logger.error(`Resposta: ${errorDetails}`);
        logger.error('Headers da resposta:', Object.fromEntries(response.headers.entries()));
        
        throw new Error(`ERRO ${response.status}: ${response.statusText || 'Erro desconhecido'} - ${errorDetails}`);
      }

      const records = await response.json();
      logger.info(`Recebidos ${records.length} registros da API`);
      
      // Log detalhado dos registros encontrados
      if (records.length > 0) {
        logger.info(`Registros encontrados:`);
        records.forEach(record => {
          logger.info(`  - ID: ${record.id}, Status: ${record.status}, Processado: ${record.processado}`);
        });
      } else {
        logger.info('Nenhum registro pendente encontrado na API');
      }
      
      return records;
      
    } catch (error) {
      if (error.message.includes('ERRO 500')) {
        logger.error('ERRO 500 - Possíveis causas:');
        logger.error('1. Tabela cte_documentos não existe no banco');
        logger.error('2. Erro de sintaxe SQL no endpoint /api/cte-documentos/pendentes');
        logger.error('3. Problema de conexão com PostgreSQL');
        logger.error('4. Permissões insuficientes no banco de dados');
        logger.error('Solução: Execute POST /api/cte-documentos/setup para criar a tabela');
      } else {
        logger.error('Erro ao buscar registros via API:', error.message);
      }
      throw error;
    }
  }

  async markAsProcessed(id) {
    try {
      const url = `${this.baseUrl}${config.api.endpoints.updateStatus.replace('{id}', id)}`;
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          status: 'emitido',
          processado: true,
          updated_at: new Date().toISOString()
        })
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Sem detalhes do erro');
        throw new Error(`HTTP ${response.status}: ${response.statusText || 'Erro desconhecido'} - ${errorBody}`);
      }

      const result = await response.json();
      logger.info(`Registro ID ${id} marcado como emitido na API`);
      return result.success;
      
    } catch (error) {
      logger.error('Erro ao marcar registro como processado via API:', error);
      throw error;
    }
  }

  async insertTestRecord(dados = {}) {
    try {
      const url = `${this.baseUrl}/cte-documentos/teste`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: 'pendente',
          prioridade: 5,
          dados: {
            validarDocumento: true,
            gerarXML: true,
            enviarSEFAZ: true,
            ...dados
          }
        })
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Sem detalhes do erro');
        throw new Error(`HTTP ${response.status}: ${response.statusText || 'Erro desconhecido'} - ${errorBody}`);
      }

      const result = await response.json();
      logger.info(`Novo registro inserido via API com ID: ${result.id}`);
      return result.id;
      
    } catch (error) {
      logger.error('Erro ao inserir registro de teste via API:', error);
      throw error;
    }
  }

  async getTableStats() {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      const url = `${this.baseUrl}${config.api.endpoints.stats}`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'Sem detalhes do erro');
        throw new Error(`HTTP ${response.status}: ${response.statusText || 'Erro desconhecido'} - ${errorBody}`);
      }

      const stats = await response.json();
      return {
        total: stats.total,
        pendentes: stats.pendentes,
        emitidos: stats.emitidos,
        cancelados: stats.cancelados,
        tableName: 'cte_documentos (via API)'
      };
      
    } catch (error) {
      logger.error('Erro ao obter estatísticas via API:', error);
      throw error;
    }
  }

  close() {
    this.isConnected = false;
    logger.info('Cliente API desconectado');
  }
}

module.exports = ApiClient;