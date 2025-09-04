/**
 * Script para desinstalar o serviço Windows
 */

const Service = require('node-windows').Service;
const path = require('path');

// Criar objeto do serviço (mesmo nome usado na instalação)
const svc = new Service({
  name: 'DatabaseMonitorService',
  script: path.join(__dirname, 'app.js')
});

// Listener para quando o serviço for desinstalado
svc.on('uninstall', () => {
  console.log('✅ Serviço desinstalado com sucesso!');
});

// Listener para erros
svc.on('error', (err) => {
  console.error('❌ Erro ao desinstalar serviço:', err);
});

console.log('Desinstalando serviço Windows...');
console.log('Nome: DatabaseMonitorService');

// Desinstalar o serviço
svc.uninstall();