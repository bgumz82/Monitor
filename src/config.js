/**
 * Configurações centrais da aplicação
 */

const config = {
  // Configurações da API
  api: {
    baseUrl: 'https://sistema.systemtruck.com.br/api', // Altere para a URL do seu servidor
    endpoints: {
      pendentes: '/cte-documentos/pendentes',
      updateStatus: '/cte-documentos/{id}/status',
      stats: '/cte-documentos/stats',
      setup: '/cte-documentos/setup'
    },
    checkInterval: 60000, // Intervalo em milissegundos para verificar a tabela (60 segundos)
  },

  // Configurações de log
  logging: {
    level: 'info', // debug, info, warn, error
    logFile: './logs/app.log',
    maxSize: '10m',
    maxFiles: '5',
  },

  // Configurações do servidor web (para gerenciamento)
  server: {
    port: 3001,
    enabled: true,
  },

  // Configurações das tarefas
  tasks: {
    retryAttempts: 3,
    retryDelay: 2000, // milissegundos
  },

  // Configurações de processamento de arquivos XML
  xmlProcessing: {
    // Pasta onde os XMLs serão gerados inicialmente
    sourceFolder: './xml/gerados',
    // Pasta base onde ficam as pastas por CNPJ
    cnpjBasePath: './xml/cnpj',
    // Pasta onde ficam os XMLs processados/autorizados
    processedFolder: 'processados',
    // Intervalo para verificar arquivos processados (30 segundos)
    checkProcessedInterval: 30000,
    // Extensões de arquivo aceitas
    allowedExtensions: ['.xml'],
    // Timeout para aguardar processamento (10 minutos)
    processingTimeout: 600000
  },

  // Condições para execução das tarefas
  conditions: {
    // Executar tarefa quando status = 'pendente'
    executeWhen: {
      status: 'pendente'
    }
  }
};

module.exports = config;