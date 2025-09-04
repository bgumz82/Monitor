# Monitor de Banco de Dados para Windows

Aplicação Node.js para monitoramento contínuo de banco de dados no Windows, executando tarefas automatizadas baseadas em condições específicas.

## 🎯 Funcionalidades

- **Monitoramento Contínuo**: Verifica a tabela do banco a cada intervalo configurado
- **Execução de Tarefas**: Executa automaticamente tarefas quando condições são atendidas
- **Serviço Windows**: Pode ser instalado como serviço Windows para execução automática
- **Interface Web**: Interface simples para monitoramento e controle
- **Logs Detalhados**: Sistema completo de logs com rotação automática
- **Sistema de Retry**: Tentativas automáticas em caso de falha
- **Shutdown Graceful**: Encerramento seguro preservando dados

## 🚀 Como Usar

### 1. Instalar Dependências
```bash
npm install
```

### 2. Configurar Aplicação

O banco de dados SQLite será criado automaticamente. Opcionalmente, edite o arquivo `.env`:

```env
# Configurações opcionais
SERVER_PORT=3001
LOG_LEVEL=info
```

**Importante**: O banco de dados será criado automaticamente em `./database/monitor.db`.

### 3. Executar em Modo Desenvolvimento
```bash
npm start
```

### 4. Acessar Interface Web
Abra seu navegador em: `http://localhost:3001`

### 5. Instalar como Serviço Windows (Opcional)
```bash
npm run install-service
```

Para desinstalar o serviço:
```bash
npm run uninstall-service
```

## ⚙️ Configuração

Edite o arquivo `src/config.js` para personalizar:

- **Intervalo de verificação**: Frequência de verificação da tabela
- **Condições de execução**: Quando as tarefas devem ser executadas
- **Configurações de log**: Nível de log e rotação de arquivos
- **Porta do servidor**: Porta da interface web

## 📊 Estrutura da Tabela SQLite

A aplicação se conecta via API a uma tabela PostgreSQL com a seguinte estrutura:

```sql
CREATE TABLE cte_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'pendente',
  prioridade INTEGER NOT NULL DEFAULT 1,
  dados TEXT,
  processado BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```


## 🔧 Personalização

### Modificar Condições de Execução

No arquivo `src/config.js`, seção `conditions.executeWhen`:

```javascript
executeWhen: {
  status: 'pendente',
  prioridade: { operator: '>', value: 3 }
}
```

### Adicionar Novas Tarefas

No arquivo `src/tasks.js`, método `executeSpecificTasks()`:

```javascript
// Adicionar nova tarefa
if (dados.minhaNovaTask) {
  await this.minhaNovaFuncao(dados);
}
```

## 📝 API Endpoints

- `GET /api/status` - Status da aplicação e monitor
- `GET /api/database/test` - Testar conexão com banco de dados
- `GET /api/database/stats` - Estatísticas da tabela
- `POST /api/monitor/start` - Iniciar monitor
- `POST /api/monitor/stop` - Parar monitor
- `POST /api/monitor/restart` - Reiniciar monitor
- `POST /api/test/insert` - Inserir registro de teste

## 📁 Estrutura de Arquivos

```
src/
├── app.js           # Aplicação principal
├── config.js        # Configurações centrais
├── database.js      # Gerenciamento do banco de dados
├── logger.js        # Sistema de logs
├── monitor.js       # Lógica de monitoramento
├── server.js        # Servidor web para gerenciamento
├── tasks.js         # Execução de tarefas
├── install-service.js   # Instalação do serviço Windows
└── uninstall-service.js # Desinstalação do serviço
```

## 🔍 Logs

Os logs são salvos em `./logs/app.log` com rotação automática. Níveis disponíveis:
- `debug`: Informações detalhadas de debug
- `info`: Informações gerais de funcionamento
- `warn`: Avisos importantes
- `error`: Erros que requerem atenção

## 🚨 Comandos de Serviço Windows

Após instalar como serviço:

```bash
# Iniciar serviço
net start DatabaseMonitorService

# Parar serviço
net stop DatabaseMonitorService

# Ver status do serviço
sc query DatabaseMonitorService
```

## 💡 Dicas de Uso

1. **Teste primeiro**: Execute em modo desenvolvimento antes de instalar como serviço
2. **Monitore os logs**: Acompanhe os logs para verificar o funcionamento
3. **Configure as condições**: Ajuste as condições de execução conforme sua necessidade
4. **Use a interface web**: Utilize a interface para controle e monitoramento
5. **Backup de configuração**: Mantenha backup do arquivo de configuração

## 🛠️ Solução de Problemas

### Problemas com banco de dados
- Verifique se há espaço em disco suficiente
- Confirme as permissões de escrita no diretório `./database/`
- Verifique os logs em `./logs/app.log` para detalhes do erro

### Serviço não inicia
- Verifique se o Node.js está instalado corretamente
- Verifique os logs em `./logs/app.log`
- Execute primeiro em modo desenvolvimento para identificar problemas

### Tarefas não executam
- Verifique se as condições estão configuradas corretamente
- Verifique se há registros na tabela que atendem às condições
- Monitore os logs para identificar possíveis erros

### Performance
- Para grandes volumes de dados, considere ajustar o `checkInterval`
- O SQLite é otimizado para aplicações locais
- Use índices adicionais se necessário para consultas específicas