/**
 * Script para instalar a aplicação como serviço Windows
 */

const Service = require('node-windows').Service;
const path = require('path');

// Criar objeto do serviço
const svc = new Service({
  name: 'DatabaseMonitorService',
  description: 'Serviço de monitoramento de banco de dados',
  script: path.join(__dirname, 'app.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ],
  env: [{
    name: "NODE_ENV",
    value: "production"
  }]
});

// Listener para quando o serviço for instalado
svc.on('install', () => {
  console.log('✅ Serviço instalado com sucesso!');
  console.log('Para iniciar o serviço, execute: net start DatabaseMonitorService');
  console.log('Para parar o serviço, execute: net stop DatabaseMonitorService');
  svc.start();
});

// Listener para quando o serviço for iniciado
svc.on('start', () => {
  console.log('🚀 Serviço iniciado!');
  console.log('O monitor está agora rodando como um serviço Windows.');
});

// Listener para erros
svc.on('error', (err) => {
  console.error('❌ Erro no serviço:', err);
});

console.log('Instalando serviço Windows...');
console.log('Nome: DatabaseMonitorService');
console.log('Descrição: Serviço de monitoramento de banco de dados');
console.log('Script: ' + path.join(__dirname, 'app.js'));

// Instalar o serviço
svc.install();