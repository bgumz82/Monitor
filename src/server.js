/**
 * Servidor web para gerenciamento da aplicação
 */

const express = require('express');
const logger = require('./logger');
const config = require('./config');

class WebServer {
  constructor(apiClient, monitor) {
    this.app = express();
    this.apiClient = apiClient;
    this.monitor = monitor;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static('public'));
    
    // Log de requisições
    this.app.use((req, res, next) => {
      logger.debug(`${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    // Status da aplicação
    this.app.get('/api/status', async (req, res) => {
      try {
        let dbStats = null;
        try {
          dbStats = await this.apiClient.getTableStats();
        } catch (error) {
          logger.warn('Erro ao obter estatísticas da API:', error);
        }
        
        res.json({
        status: 'online',
        monitor: this.monitor.getStats(),
        database: {
          connected: this.apiClient.isConnected,
          tableName: 'cte_documentos',
          stats: dbStats
        },
        timestamp: new Date().toISOString()
        });
      } catch (error) {
        logger.error('Erro ao obter status:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Controle do monitor
    this.app.post('/api/monitor/start', (req, res) => {
      this.monitor.start();
      res.json({ message: 'Monitor iniciado' });
    });

    this.app.post('/api/monitor/stop', (req, res) => {
      this.monitor.stop();
      res.json({ message: 'Monitor parado' });
    });

    this.app.post('/api/monitor/restart', (req, res) => {
      this.monitor.restart();
      res.json({ message: 'Monitor reiniciado' });
    });

    // Inserir registro de teste
    this.app.post('/api/test/insert', async (req, res) => {
      try {
        const dados = req.body || {};
        
        const id = await this.apiClient.insertTestRecord(dados);
        res.json({ 
          message: 'Registro de teste inserido na tabela cte_documentos',
          id: id,
          dados: dados
        });
      } catch (error) {
        logger.error('Erro ao inserir registro de teste:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Testar conexão com banco
    this.app.get('/api/database/test', async (req, res) => {
      try {
        const testResult = await this.apiClient.testConnection();
        res.json({
          success: testResult.success,
          message: testResult.message
        });
      } catch (error) {
        logger.error('Erro no teste de conexão:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Obter estatísticas da tabela
    this.app.get('/api/database/stats', async (req, res) => {
      try {
        const stats = await this.apiClient.getTableStats();
        res.json(stats);
      } catch (error) {
        logger.error('Erro ao obter estatísticas:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Atualizar intervalo de verificação
    this.app.post('/api/config/interval', (req, res) => {
      try {
        const { interval } = req.body;
        if (interval && interval >= 10000 && interval <= 3600000) {
          config.api.checkInterval = interval;
          this.monitor.updateInterval(interval);
          res.json({ message: `Intervalo atualizado para ${interval/1000}s` });
        } else {
          res.status(400).json({ error: 'Intervalo deve estar entre 10 e 3600 segundos' });
        }
      } catch (error) {
        logger.error('Erro ao atualizar intervalo:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Interface web simples
    this.app.get('/', (req, res) => {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Monitor de Banco de Dados</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; }
            .button { background: #007cba; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; margin: 5px; }
            .button:hover { background: #005a8b; }
            .button.success { background: #28a745; }
            .button.success:hover { background: #218838; }
            .status { background: #e8f5e8; padding: 15px; border-radius: 4px; margin: 10px 0; }
            .info { background: #e8f4f8; padding: 15px; border-radius: 4px; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🔍 Monitor de Documentos CTE</h1>
            <div class="info">
              <strong>Status:</strong> Aplicação em execução<br>
              <strong>Porta:</strong> ${config.server.port}<br>
              <strong>Intervalo de verificação:</strong> ${(config.api ? config.api.checkInterval : 'N/A')}ms<br>
              <strong>API:</strong> PostgreSQL via API REST<br>
              <strong>Tabela:</strong> cte_documentos
            </div>
            
            <h2>Controles</h2>
            <button class="button" onclick="controlMonitor('start')">▶️ Iniciar Monitor</button>
            <button class="button" onclick="controlMonitor('stop')">⏹️ Parar Monitor</button>
            <button class="button" onclick="controlMonitor('restart')">🔄 Reiniciar Monitor</button>
            <button class="button" onclick="getStatus()">📊 Status</button>
            <button class="button" onclick="testDatabase()">🔌 Testar Conexão DB</button>
            <button class="button" onclick="getDbStats()">📈 Estatísticas DB</button>
            
            <h2>Log de Atividades</h2>
            <div id="log" style="background: #f8f8f8; padding: 15px; border-radius: 4px; height: 300px; overflow-y: auto; font-family: monospace; font-size: 12px; white-space: pre-line; line-height: 1.4;"></div>
            
            <script>
              function log(message) {
                const logDiv = document.getElementById('log');
                const timestamp = new Date().toLocaleTimeString();
                const logLine = timestamp + ' - ' + message;
                
                // Adicionar nova linha
                if (logDiv.textContent) {
                  logDiv.textContent += '\\n' + logLine;
                } else {
                  logDiv.textContent = logLine;
                }
                
                // Manter apenas as últimas 100 linhas
                const lines = logDiv.textContent.split('\\n');
                if (lines.length > 100) {
                  logDiv.textContent = lines.slice(-100).join('\\n');
                }
                
                logDiv.scrollTop = logDiv.scrollHeight;
              }
              
              async function controlMonitor(action) {
                try {
                  const response = await fetch(\`/api/monitor/\${action}\`, { method: 'POST' });
                  const result = await response.json();
                  log('✅ ' + result.message);
                } catch (error) {
                  log('❌ Erro: ' + error.message);
                }
              }
              
              async function getStatus() {
                try {
                  const response = await fetch('/api/status');
                  const status = await response.json();
                  log('📊 Status: Monitor ' + (status.monitor.isRunning ? 'ATIVO' : 'INATIVO') + 
                      ', Processados: ' + status.monitor.processedCount + 
                      ', Tabela: ' + status.database.tableName);
                } catch (error) {
                  log('❌ Erro ao obter status: ' + error.message);
                }
              }
              
              async function testDatabase() {
                try {
                  const response = await fetch('/api/database/test');
                  const result = await response.json();
                  log('🔌 ' + result.message);
                } catch (error) {
                  log('❌ Erro no teste de conexão API: ' + error.message);
                }
              }
              
              async function getDbStats() {
                try {
                  const response = await fetch('/api/database/stats');
                  const stats = await response.json();
                  log('📈 Estatísticas CTE: Total=' + stats.total + 
                      ', Pendentes=' + stats.pendentes + 
                      ', Emitidos=' + stats.emitidos + 
                      ', Cancelados=' + stats.cancelados);
                } catch (error) {
                  log('❌ Erro ao obter estatísticas: ' + error.message);
                }
              }
              
              // Atualizar status automaticamente
              setInterval(getStatus, 10000);
              log('🚀 Interface carregada');
            </script>
          </div>
        </body>
        </html>
      `);
    });
  }

  start() {
    if (!config.server.enabled) {
      logger.info('Servidor web desabilitado na configuração');
      return;
    }

    this.app.listen(config.server.port, () => {
      logger.info(`Servidor web rodando na porta ${config.server.port}`);
      logger.info(`Interface de gerenciamento: http://localhost:${config.server.port}`);
    });
  }
}

module.exports = WebServer;