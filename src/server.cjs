const express = require('express');
const compression = require('compression');
const path = require('path');
const helmet = require('helmet');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const cors = require('cors');

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// Configurar CORS
app.use(cors());

// Configurar pool de conexão com o banco
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Pool principal para usuários e permissões (sempre frota_management)
const mainPool = pool; // O pool principal já está configurado para frota_management

// Testar conexão com o banco
pool.query('SELECT NOW()', (err) => {
  if (err) {
    console.error('Erro ao conectar ao banco de dados:', err);
  } else {
    console.log('Conexão com o banco de dados estabelecida com sucesso');
  }
});

// Middleware de segurança
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Compressão gzip
app.use(compression());

// Parse JSON bodies
app.use(express.json());

// Middleware para logging de requisições
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Servir arquivos estáticos com cache
app.use(express.static('dist', {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// Criar pasta uploads se não existir
const uploadsDir = path.join(__dirname, 'uploads');
if (!require('fs').existsSync(uploadsDir)) {
  require('fs').mkdirSync(uploadsDir, { recursive: true });
}

// Servir uploads com cache
app.use('/uploads', express.static(uploadsDir, {
  maxAge: '1d',
  etag: true,
  lastModified: true
}));

// Middleware para verificar JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso requerido' });
  }

  if (!JWT_SECRET) {
    console.error('JWT_SECRET não configurado');
    return res.status(500).json({ error: 'Erro de configuração do servidor' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido' });
    }
    req.user = user;
    next();
  });
};

// Rotas de autenticação
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    console.log('Tentativa de login para:', email);

    // Verificar se email e senha foram fornecidos
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    // Buscar usuário
    const userResult = await pool.query(`
      SELECT id, email, nome, tipo, ativo, 
             senha
      FROM usuarios
      WHERE email = $1
    `, [email]);

    if (userResult.rows.length === 0) {
      console.log('Usuário não encontrado:', email);
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const user = userResult.rows[0];

    if (!user.ativo) {
      console.log('Usuário inativo:', email);
      return res.status(401).json({ error: 'Usuário inativo' });
    }

    // Verificar se o usuário tem senha
    if (!user.senha) {
      console.error('Usuário sem senha:', email);
      return res.status(500).json({ error: 'Erro na configuração do usuário' });
    }

    // Verificar senha
    const validPassword = await bcrypt.compare(password, user.senha);
    if (!validPassword) {
      console.log('Senha inválida para:', email);
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    // Verificar se JWT_SECRET está definido
    if (!JWT_SECRET) {
      console.error('JWT_SECRET não configurado');
      return res.status(500).json({ error: 'Erro de configuração do servidor' });
    }

    // Gerar token
    const token = jwt.sign(
      { 
        id: user.id,
        email: user.email,
        tipo: user.tipo
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Remover senha do objeto de resposta
    delete user.senha;

    console.log('Login bem-sucedido para:', email);

    res.json({
      user,
      session: {
        access_token: token,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Rota para criar usuários (signup) - VERSÃO CORRIGIDA
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, nome, tipo } = req.body;

  try {
    console.log('Tentativa de criação de usuário:', email);

    // Verificar se todos os campos obrigatórios foram fornecidos
    if (!email || !password || !nome || !tipo) {
      return res.status(400).json({ error: 'Email, senha, nome e tipo são obrigatórios' });
    }

    // Verificar se o usuário já existe
    const existingUser = await pool.query(`
      SELECT id FROM usuarios WHERE email = $1
    `, [email]);

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    // Criptografar senha
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Criar usuário - deixar os triggers do banco gerenciarem as permissões
    const result = await pool.query(`
      INSERT INTO usuarios (email, nome, tipo, senha, ativo, created_at, updated_at)
      VALUES ($1, $2, $3, $4, true, NOW(), NOW())
      RETURNING id, email, nome, tipo, created_at
    `, [email, nome, tipo, hashedPassword]);

    const newUser = result.rows[0];

    console.log('Usuário criado com sucesso:', email);

    res.status(201).json({
      user: {
        id: newUser.id,
        email: newUser.email,
        nome: newUser.nome,
        tipo: newUser.tipo,
        ativo: true,
        created_at: newUser.created_at
      },
      message: 'Usuário criado com sucesso'
    });

  } catch (error) {
    console.error('Erro na criação do usuário:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.post('/api/auth/verify', async (req, res) => {
  const { token } = req.body;

  try {
    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    if (!JWT_SECRET) {
      console.error('JWT_SECRET não configurado');
      return res.status(500).json({ error: 'Erro de configuração do servidor' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const result = await pool.query(`
      SELECT id, email, nome, tipo, ativo
      FROM usuarios
      WHERE id = $1
    `, [decoded.id]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }

    const user = result.rows[0];

    if (!user.ativo) {
      return res.status(401).json({ error: 'Usuário inativo' });
    }

    res.json({
      id: user.id,
      email: user.email,
      nome: user.nome,
      tipo: user.tipo
    });
  } catch (error) {
    console.error('Erro na verificação do token:', error);
    res.status(401).json({ error: 'Token inválido' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ message: 'Logout realizado com sucesso' });
});

// Rota para alterar senha
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    console.log('🔐 Recebida requisição para alterar senha do usuário:', userId);

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Nova senha deve ter pelo menos 6 caracteres' });
    }

    // Buscar usuário atual
    const userResult = await pool.query(`
      SELECT id, email, senha
      FROM usuarios
      WHERE id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const user = userResult.rows[0];

    // Verificar senha atual
    const validCurrentPassword = await bcrypt.compare(currentPassword, user.senha);
    if (!validCurrentPassword) {
      return res.status(401).json({ error: 'Senha atual incorreta' });
    }

    // Criptografar nova senha
    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Atualizar senha no banco
    await pool.query(`
      UPDATE usuarios 
      SET senha = $1, updated_at = NOW()
      WHERE id = $2
    `, [hashedNewPassword, userId]);

    console.log('✅ Senha alterada com sucesso para usuário:', user.email);

    res.json({ 
      success: true, 
      message: 'Senha alterada com sucesso' 
    });

  } catch (error) {
    console.error('❌ Erro ao alterar senha:', error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }
    )
  }
}
)

// Rota para testar conexão com banco de dados
app.post('/api/database-config/test-connection', authenticateToken, async (req, res) => {
  try {
    const config = req.body;
    console.log('🔍 Testando conexão com banco de dados:', config.host);

    // Criar pool de conexão temporário para teste
    const { Pool } = require('pg');
    const testPool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database_name,
      user: config.username,
      password: config.password,
      ssl: config.ssl_enabled ? { rejectUnauthorized: false } : false,
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
    });

    try {
      // Testar conexão básica
      const client = await testPool.connect();
      await client.query('SELECT NOW()');

      console.log('✅ Conexão testada com sucesso, criando estrutura...');

      // Criar estrutura do banco de dados
      await createDatabaseStructure(client);

      client.release();

      console.log('✅ Estrutura do banco criada com sucesso');
      res.json({ 
        success: true, 
        message: 'Conexão testada e estrutura criada com sucesso' 
      });
    } finally {
      await testPool.end();
    }
  } catch (error) {
    console.error('❌ Erro no teste de conexão:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro ao testar conexão com banco de dados',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Função para criar estrutura completa do banco de dados
async function createDatabaseStructure(client) {
  try {
    console.log('📦 Criando extensões...');
    // 1. Criar extensões necessárias
    await createExtensions(client);

    console.log('🏷️ Criando enums...');
    // 2. Criar enums
    await createEnums(client);

    console.log('🗃️ Criando tabelas...');
    // 3. Criar tabelas principais
    await createTables(client);

    console.log('🔗 Criando foreign keys...');
    // 4. Criar foreign keys
    await createForeignKeys(client);

    console.log('📊 Criando índices...');
    // 5. Criar índices
    await createIndexes(client);

    console.log('⚙️ Criando funções e triggers...');
    // 6. Criar funções e triggers
    await createFunctionsAndTriggers(client);

    console.log('📝 Inserindo dados iniciais...');
    // 7. Inserir dados iniciais
    // 7. Inserir dados iniciais
    await insertInitialData(client);

    console.log('✅ Estrutura do banco de dados criada com sucesso!');

  } catch (error) {
    console.error('❌ Erro ao criar estrutura do banco:', error);
    throw error;
  }
}

// Função para criar extensões
async function createExtensions(client) {
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    console.log('✅ Extensão uuid-ossp criada/verificada');
  } catch (error) {
    console.log('⚠️ Erro ao criar extensão:', error.message);
  }
}

// Função para criar enums
async function createEnums(client) {
  const enums = [
    {
      name: 'tipo_usuario',
      values: ['admin', 'operador_checklist', 'operador_abastecimento']
    },
    {
      name: 'cadastro_tipo', 
      values: ['cliente', 'fornecedor', 'abastecimento']
    },
    {
      name: 'veiculo_status',
      values: ['ativo', 'inativo', 'manutencao', 'vendido']
    },
    {
      name: 'tipo_combustivel_veiculo',
      values: ['diesel_s10', 'diesel_s500', 'gasolina', 'etanol', 'flex']
    }
  ];

  for (const enumDef of enums) {
    try {
      // Verificar se o enum já existe
      const enumExists = await client.query(
        "SELECT 1 FROM pg_type WHERE typname = $1",
        [enumDef.name]
      );

      if (enumExists.rows.length === 0) {
        const enumValues = enumDef.values.map(v => `'${v}'`).join(', ');
        await client.query(`CREATE TYPE ${enumDef.name} AS ENUM (${enumValues})`);
        console.log(`✅ Enum ${enumDef.name} criado`);
      } else {
        console.log(`✅ Enum ${enumDef.name} já existe`);
      }
    } catch (error) {
      console.log(`⚠️ Erro ao criar enum ${enumDef.name}:`, error.message);
    }
  }
}

// Função para criar tabelas
async function createTables(client) {
  const tables = [
    {
      name: 'usuarios',
      query: `
        CREATE TABLE IF NOT EXISTS usuarios (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          email varchar(255) UNIQUE NOT NULL,
          nome varchar(255) NOT NULL,
          tipo tipo_usuario NOT NULL,
          senha varchar(255),
          database_config_id uuid,
          ativo boolean DEFAULT true,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `
    },
    {
      name: 'veiculos',
      query: `
        CREATE TABLE IF NOT EXISTS veiculos (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          placa varchar(10) NOT NULL UNIQUE,
          tipo varchar(50) NOT NULL CHECK (tipo IN ('carro', 'caminhao', 'maquina_pesada', 'implementos', 'onibus', 'bi_trem_1_reboque', 'bi_trem_2_reboque', 'vanderleia_3_eixos', 'vanderleia_4_eixos', 'julieta')),
          marca varchar(100) NOT NULL,
          modelo varchar(100) NOT NULL,
          ano integer NOT NULL,
          qrcode_data varchar(255) NOT NULL,
          renavam text,
          chassis text,
          uf_registro text DEFAULT 'SP',
          cor text DEFAULT 'Não informado',
          tara_kg decimal(10,2),
          carga_kg decimal(10,2),
          status veiculo_status DEFAULT 'ativo',
          tipo_combustivel tipo_combustivel_veiculo DEFAULT 'gasolina',
          validade_tacografo date,
          ativo boolean DEFAULT true,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `
    },
    {
      name: 'cadastros',
      query: `
        CREATE TABLE IF NOT EXISTS cadastros (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          tipo cadastro_tipo NOT NULL,
          razao_social text NOT NULL,
          cnpj text,
          ie text,
          endereco text NOT NULL DEFAULT '',
          cidade text NOT NULL DEFAULT '',
          estado text NOT NULL DEFAULT 'SP',
          cep text NOT NULL DEFAULT '',
          telefone text,
          emails jsonb NOT NULL DEFAULT '[]'::jsonb,
          ativo boolean NOT NULL DEFAULT true,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `
    },
    {
      name: 'abastecimentos',
      query: `
        CREATE TABLE IF NOT EXISTS abastecimentos (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          veiculo_id uuid NOT NULL,
          operador_id uuid NOT NULL,
          posto_id uuid NOT NULL,
          tipo_combustivel varchar(20) NOT NULL CHECK (tipo_combustivel IN ('gasolina', 'diesel', 'etanol', 'gnv')),
          litros decimal(10,3) NOT NULL,
          valor_total decimal(10,2) NOT NULL,
          data_abastecimento timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `
    },
    {
      name: 'manutencoes',
      query: `
        CREATE TABLE IF NOT EXISTS manutencoes (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          veiculo_id uuid NOT NULL,
          tipo varchar(100) NOT NULL,
          descricao text NOT NULL,
          data_prevista date NOT NULL,
          data_realizada date,
          alerta_enviado boolean DEFAULT false,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `
    },
    {
      name: 'checklists',
      query: `
        CREATE TABLE IF NOT EXISTS checklists (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          veiculo_id uuid NOT NULL,
          operador_id uuid NOT NULL,
          data_checklist timestamptz NOT NULL DEFAULT now(),
          itens jsonb NOT NULL,
          observacoes text,
          email_enviado boolean DEFAULT false,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `
    },
    {
      name: 'funcionarios',
      query: `
        CREATE TABLE IF NOT EXISTS funcionarios (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          nome varchar(255) NOT NULL,
          cpf varchar(14) UNIQUE NOT NULL,
          rg varchar(20) NOT NULL,
          matricula varchar(50) UNIQUE NOT NULL,
          data_admissao date NOT NULL,
          data_nascimento date NOT NULL,
          telefone varchar(20),
          foto_url text,
          funcao varchar(100) NOT NULL DEFAULT 'administrativo',
          cnh text,
          validade_cnh date,
          status varchar(20) DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'ferias')),
          ativo boolean DEFAULT true,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `
    },
    {
      name: 'user_permissions',
      query: `
        CREATE TABLE IF NOT EXISTS user_permissions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL,
          module text NOT NULL,
          can_access boolean DEFAULT true,
          can_create boolean DEFAULT false,
          can_edit boolean DEFAULT false,
          can_delete boolean DEFAULT false,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now(),
          UNIQUE(user_id, module)
        )
      `
    },
    {
      name: 'centros_custo',
      query: `
        CREATE TABLE IF NOT EXISTS centros_custo (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          nome varchar(255) NOT NULL,
          descricao text,
          ativo boolean DEFAULT true,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `
    },
    {
      name: 'contas_pagar',
      query: `
        CREATE TABLE IF NOT EXISTS contas_pagar (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          descricao text NOT NULL,
          valor decimal(10,2) NOT NULL,
          data_vencimento date NOT NULL,
          data_pagamento date,
          centro_custo_id text NOT NULL,
          fornecedor varchar(255) NOT NULL,
          status varchar(20) DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago', 'cancelado')),
          observacao text,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `
    },
    {
      name: 'contas_receber',
      query: `
        CREATE TABLE IF NOT EXISTS contas_receber (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          descricao text NOT NULL,
          valor decimal(10,2) NOT NULL,
          data_vencimento date NOT NULL,
          data_recebimento date,
          centro_custo_id text NOT NULL,
          cliente varchar(255) NOT NULL,
          status varchar(20) DEFAULT 'pendente' CHECK (status IN ('pendente', 'recebido', 'cancelado')),
          observacao text,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `
    },
    {
      name: 'registros_antt',
      query: `
        CREATE TABLE IF NOT EXISTS registros_antt (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          veiculo_id uuid NOT NULL,
          cnpj text NOT NULL,
          antt text NOT NULL,
          razao_social_proprietario text NOT NULL,
          inscricao_estadual text,
          uf_registro text NOT NULL,
          empresa_proprietario boolean NOT NULL,
          ativo boolean DEFAULT true,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `
    },
    {
      name: 'checklist_fotos',
      query: `
        CREATE TABLE IF NOT EXISTS checklist_fotos (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          checklist_id uuid NOT NULL,
          tipo varchar(50) NOT NULL,
          url text NOT NULL,
          created_at timestamptz DEFAULT now()
        )
      `
    }
  ];

  // Criar cada tabela individualmente
  for (const table of tables) {
    try {
      await client.query(table.query);
      console.log(`✅ Tabela ${table.name} criada/verificada`);
    } catch (error) {
      console.log(`⚠️ Erro na tabela ${table.name}:`, error.message);
    }
  }
}

// Função para criar foreign keys
async function createForeignKeys(client) {
  const foreignKeys = [
    {
      table: 'abastecimentos',
      column: 'veiculo_id',
      references: 'veiculos(id)',
      name: 'abastecimentos_veiculo_id_fkey'
    },
    {
      table: 'abastecimentos',
      column: 'operador_id', 
      references: 'usuarios(id)',
      name: 'abastecimentos_operador_id_fkey'
    },
    {
      table: 'abastecimentos',
      column: 'posto_id',
      references: 'cadastros(id)',
      name: 'abastecimentos_posto_id_fkey'
    },
    {
      table: 'manutencoes',
      column: 'veiculo_id',
      references: 'veiculos(id)',
      name: 'manutencoes_veiculo_id_fkey'
    },
    {
      table: 'checklists',
      column: 'veiculo_id',
      references: 'veiculos(id)',
      name: 'checklists_veiculo_id_fkey'
    },
    {
      table: 'checklists',
      column: 'operador_id',
      references: 'usuarios(id)',
      name: 'checklists_operador_id_fkey'
    },
    {
      table: 'user_permissions',
      column: 'user_id',
      references: 'usuarios(id)',
      name: 'user_permissions_user_id_fkey',
      onDelete: 'CASCADE'
    },
    {
      table: 'registros_antt',
      column: 'veiculo_id',
      references: 'veiculos(id)',
      name: 'registros_antt_veiculo_id_fkey',
      onDelete: 'CASCADE'
    },
    {
      table: 'checklist_fotos',
      column: 'checklist_id',
      references: 'checklists(id)',
      name: 'checklist_fotos_checklist_id_fkey',
      onDelete: 'CASCADE'
    }
  ];

  for (const fk of foreignKeys) {
    try {
      // Verificar se a constraint já existe
      const constraintExists = await client.query(`
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = $1 AND table_name = $2
      `, [fk.name, fk.table]);

      if (constraintExists.rows.length === 0) {
        const onDeleteClause = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '';
        await client.query(`
          ALTER TABLE ${fk.table} 
          ADD CONSTRAINT ${fk.name} 
          FOREIGN KEY (${fk.column}) REFERENCES ${fk.references}${onDeleteClause}
        `);
        console.log(`✅ Foreign key ${fk.name} criada`);
      } else {
        console.log(`✅ Foreign key ${fk.name} já existe`);
      }
    } catch (error) {
      console.log(`⚠️ Erro na foreign key ${fk.name}:`, error.message);
    }
  }
}

// Função para criar índices
async function createIndexes(client) {
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)',
    'CREATE INDEX IF NOT EXISTS idx_usuarios_tipo ON usuarios(tipo)',
    'CREATE INDEX IF NOT EXISTS idx_veiculos_placa ON veiculos(placa)',
    'CREATE INDEX IF NOT EXISTS idx_veiculos_ativo ON veiculos(ativo)',
    'CREATE INDEX IF NOT EXISTS idx_cadastros_tipo ON cadastros(tipo)',
    'CREATE INDEX IF NOT EXISTS idx_cadastros_ativo ON cadastros(ativo)',
    'CREATE INDEX IF NOT EXISTS idx_abastecimentos_data ON abastecimentos(data_abastecimento)',
    'CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_user_permissions_module ON user_permissions(module)'
  ];

  for (const indexQuery of indexes) {
    try {
      await client.query(indexQuery);
    } catch (error) {
      console.log('⚠️ Erro ao criar índice:', error.message);
    }
  }
  console.log('✅ Índices criados/verificados');
}

// Função para criar funções e triggers
async function createFunctionsAndTriggers(client) {
  try {
    // Função para permissões
    await client.query(`
      CREATE OR REPLACE FUNCTION create_user_permissions_complete(user_id_param uuid, user_type_param text)
      RETURNS INTEGER AS $$
      DECLARE
        permission_count INTEGER := 0;
        user_exists BOOLEAN := false;
        user_email TEXT;
      BEGIN
        SELECT email INTO user_email FROM usuarios WHERE id = user_id_param;
        user_exists := FOUND;

        IF NOT user_exists THEN
          RETURN 0;
        END IF;

        DELETE FROM user_permissions WHERE user_id = user_id_param;

        IF user_type_param = 'admin' THEN
          INSERT INTO user_permissions (user_id, module, can_access, can_create, can_edit, can_delete) VALUES
          (user_id_param, 'dashboard', true, false, false, false),
          (user_id_param, 'veiculos', true, true, true, true),
          (user_id_param, 'antt', true, true, true, true),
          (user_id_param, 'abastecimentos', true, true, true, true),
          (user_id_param, 'cadastros', true, true, true, true),
          (user_id_param, 'manutencoes', true, true, true, true),
          (user_id_param, 'checklists', true, true, true, true),
          (user_id_param, 'funcionarios', true, true, true, true),
          (user_id_param, 'usuarios', true, true, true, true),
          (user_id_param, 'permissoes', true, true, true, true),
          (user_id_param, 'configuracoes_banco', true, true, true, true),
          (user_id_param, 'financeiro', true, true, true, true),
          (user_id_param, 'relatorios', true, true, false, false);

          permission_count := 12;

        ELSIF user_type_param = 'operador_checklist' THEN
          INSERT INTO user_permissions (user_id, module, can_access, can_create, can_edit, can_delete) VALUES
          (user_id_param, 'dashboard', true, false, false, false),
          (user_id_param, 'checklists', true, true, false, false),
          (user_id_param, 'relatorios', true, false, false, false);

          permission_count := 3;

        ELSIF user_type_param = 'operador_abastecimento' THEN
          INSERT INTO user_permissions (user_id, module, can_access, can_create, can_edit, can_delete) VALUES
          (user_id_param, 'dashboard', true, false, false, false),
          (user_id_param, 'abastecimentos', true, true, false, false),
          (user_id_param, 'relatorios', true, false, false, false);

          permission_count := 3;
        END IF;

        RETURN permission_count;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);
    console.log('✅ Função de permissões criada');

    // Função para trigger
    await client.query(`
      CREATE OR REPLACE FUNCTION trigger_setup_user_permissions()
      RETURNS TRIGGER AS $$
      DECLARE
        result INTEGER;
      BEGIN
        SELECT create_user_permissions_complete(NEW.id, NEW.tipo) INTO result;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);

    // Trigger
    await client.query('DROP TRIGGER IF EXISTS on_user_created ON usuarios');
    await client.query(`
      CREATE TRIGGER on_user_created
        AFTER INSERT ON usuarios
        FOR EACH ROW
        EXECUTE FUNCTION trigger_setup_user_permissions()
    `);
    console.log('✅ Triggers criados');
  } catch (error) {
    console.log('⚠️ Erro ao criar funções/triggers:', error.message);
  }
}

// Função para inserir dados iniciais
async function insertInitialData(client) {
  const validHash = '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

  try {
    await client.query(`
      INSERT INTO usuarios (email, nome, tipo, senha, ativo) 
      VALUES ('admin@empresa.com', 'Administrador', 'admin', $1, true)
      ON CONFLICT (email) DO NOTHING
    `, [validHash]);
    console.log('✅ Usuário admin criado');
  } catch (error) {
    console.log('⚠️ Erro ao criar usuário admin:', error.message);
  }

  try {
    await client.query(`
      INSERT INTO veiculos (placa, tipo, marca, modelo, ano, qrcode_data, ativo) VALUES
      ('ABC-1234', 'carro', 'Honda', 'Civic', 2020, 'vehicle_ABC-1234', true),
      ('DEF-5678', 'carro', 'Toyota', 'Corolla', 2021, 'vehicle_DEF-5678', true),
      ('GHI-9012', 'caminhao', 'Toyota', 'Hilux', 2019, 'vehicle_GHI-9012', true)
      ON CONFLICT (placa) DO NOTHING
    `);
    console.log('✅ Veículos de exemplo criados');
  } catch (error) {
    console.log('⚠️ Erro ao criar veículos:', error.message);
  }

  try {
    await client.query(`
      INSERT INTO cadastros (tipo, razao_social, endereco, cidade, estado, cep, telefone, emails, ativo) VALUES
      ('abastecimento', 'Posto Shell Centro', 'Rua Principal, 123', 'São Paulo', 'SP', '01000-000', '(11) 1234-5678', '["contato@shell.com"]', true),
      ('abastecimento', 'Posto Ipiranga Norte', 'Av. Paulista, 456', 'São Paulo', 'SP', '01310-000', '(11) 8765-4321', '["info@ipiranga.com"]', true),
      ('abastecimento', 'Posto BR Sul', 'Rua das Flores, 789', 'São Paulo', 'SP', '04000-000', '(11) 5555-0000', '["atendimento@br.com"]', true)
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Postos de exemplo criados');
  } catch (error) {
    console.log('⚠️ Erro ao criar postos:', error.message);
  }

  try {
    await client.query(`
      INSERT INTO centros_custo (nome, descricao, ativo) VALUES
      ('Administrativo', 'Despesas administrativas gerais', true),
      ('Operacional', 'Despesas operacionais da frota', true),
      ('Manutenção', 'Custos de manutenção de veículos', true)
      ON CONFLICT DO NOTHING
    `);
    console.log('✅ Centros de custo criados');
  } catch (error) {
    console.log('⚠️ Erro ao criar centros de custo:', error.message);
  }
}

// Função para obter pool de conexão baseado no usuário
async function getUserDatabasePool(userId) {
  try {
    console.log('🔍 Buscando configuração de banco para usuário:', userId);

    // Buscar configuração de banco do usuário
    const userConfigResult = await pool.query(`
      SELECT dc.*
      FROM usuarios u
      JOIN database_configurations dc ON u.database_config_id = dc.id
      WHERE u.id = $1 AND dc.ativo = true
    `, [userId]);

    if (userConfigResult.rows.length === 0) {
      console.log('⚠️ Usuário sem configuração específica, usando pool padrão');
      // Se não tem configuração específica, usar pool padrão
      return pool;
    }

    const config = userConfigResult.rows[0];
    console.log('✅ Configuração encontrada:', config.nome_empresa);

    // Criar pool específico para este usuário
    const userPool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database_name,
      user: config.username,
      password: config.password,
      ssl: config.ssl_enabled ? { rejectUnauthorized: false } : false,
      max: config.max_connections || 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: (config.timeout_seconds || 30) * 1000,
    });

    console.log('🔗 Pool específico criado para:', config.nome_empresa);
    return userPool;
  } catch (error) {
    console.error('❌ Erro ao obter pool do usuário:', error);
    console.log('🔄 Retornando pool padrão como fallback');
    return pool; // Fallback para pool padrão
  }
}

// Middleware para usar banco de dados correto baseado no usuário
const withUserDatabase = (handler) => {
  return async (req, res, next) => {
    try {
      console.log('🔍 Configurando banco para usuário:', req.user.email);
      const userPool = await getUserDatabasePool(req.user.id);
      req.userPool = userPool;
      console.log('✅ Pool de banco configurado para usuário:', req.user.email);
      return handler(req, res, next);
    } catch (error) {
      console.error('❌ Erro ao configurar banco do usuário:', error);
      console.log('🔄 Usando pool padrão como fallback');
      req.userPool = pool; // Fallback
      return handler(req, res, next);
    }
  };
};

// Atualizar rota de query para usar banco correto do usuário
app.post('/api/db/query', authenticateToken, async (req, res) => {
  console.log('📡 Recebida requisição de query do usuário:', req.user.email);

  let client;

  try {
    // Obter pool correto para o usuário
    const userPool = await getUserDatabasePool(req.user.id);
    client = await userPool.connect();

    const { query, params = [] } = req.body;

    console.log('🔍 Executando query no banco específico do usuário:', req.user.email);
    console.log('📋 Query:', query);

    if (!query) {
      return res.status(400).json({ error: 'Query é obrigatória' });
    }

    const result = await client.query(query, params);

    console.log('✅ Query executada com sucesso. Registros:', result.rows.length);

    res.json({
      rows: result.rows,
      rowCount: result.rowCount
    });
  } catch (error) {
    console.error('❌ Erro na query:', error.message);
    res.status(500).json({ 
      error: 'Erro ao executar query',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Rota específica para queries no banco principal (usuários e permissões)
app.post('/api/db/query-main', authenticateToken, async (req, res) => {
  console.log('📡 Recebida requisição de query para banco PRINCIPAL do usuário:', req.user.email);

  let client;

  try {
    // SEMPRE usar o pool principal para usuários e permissões
    client = await mainPool.connect();

    const { query, params = [] } = req.body;

    console.log('🔍 Executando query no banco PRINCIPAL');
    console.log('📋 Query:', query);

    if (!query) {
      return res.status(400).json({ error: 'Query é obrigatória' });
    }

    const result = await client.query(query, params);

    console.log('✅ Query executada com sucesso no banco principal. Registros:', result.rows.length);

    res.json({
      rows: result.rows,
      rowCount: result.rowCount
    });
  } catch (error) {
    console.error('❌ Erro na query do banco principal:', error.message);
    res.status(500).json({ 
      error: 'Erro ao executar query no banco principal',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// Rota de teste do banco
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT NOW()');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

// ROTA ESPECÍFICA PARA POSTOS - DEVE VIR ANTES DAS ROTAS GENÉRICAS
app.get('/api/postos', authenticateToken, async (req, res) => {
  try {
    console.log('=== EXECUTANDO ROTA ESPECÍFICA PARA POSTOS ===');

    const query = `
      SELECT 
        id,
        nome,
        COALESCE(endereco, 'Endereço não informado') as endereco,
        COALESCE(cidade, 'Não informado') as cidade,
        COALESCE(estado, 'SP') as estado,
        COALESCE(cep, '00000-000') as cep,
        telefone,
        cnpj,
        COALESCE(ativo, true) as ativo,
        created_at,
        updated_at
      FROM postos 
      ORDER BY nome
    `;

    console.log('Query SQL para postos:', query);

    const result = await pool.query(query);

    console.log('=== RESULTADO DA QUERY POSTOS ===');
    console.log('Número de registros:', result.rows.length);

    if (result.rows.length > 0) {
      console.log('Primeiro posto completo do backend:', JSON.stringify(result.rows[0], null, 2));
      console.log('Campos do primeiro posto:', Object.keys(result.rows[0]));
    }

    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar postos:', error);
    res.status(500).json({ error: 'Erro ao buscar postos' });
  }
});

// Função para criar rotas CRUD genéricas
const createCrudRoutes = (tableName, entityName) => {
  // Get all
  app.get(`/api/${tableName}`, authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`SELECT * FROM ${tableName} ORDER BY created_at DESC`);
      res.json(result.rows);
    } catch (error) {
      console.error(`Get ${entityName} error:`, error);
      res.status(500).json({ error: `Erro ao buscar ${entityName}` });
    }
  });

  // Get by ID
  app.get(`/api/${tableName}/:id`, authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(`SELECT * FROM ${tableName} WHERE id = $1`, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: `${entityName} não encontrado` });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(`Get ${entityName} by ID error:`, error);
      res.status(500).json({ error: `Erro ao buscar ${entityName}` });
    }
  });

  // Create
  app.post(`/api/${tableName}`, authenticateToken, async (req, res) => {
    try {
      const data = req.body;
      const columns = Object.keys(data);
      const values = Object.values(data);
      const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');

      const query = `
        INSERT INTO ${tableName} (${columns.join(', ')}, created_at, updated_at)
        VALUES (${placeholders}, NOW(), NOW())
        RETURNING *
      `;

      const result = await pool.query(query, values);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error(`Create ${entityName} error:`, error);
      res.status(500).json({ error: `Erro ao criar ${entityName}` });
    }
  });

  // Update
  app.put(`/api/${tableName}/:id`, authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const data = req.body;
      const columns = Object.keys(data);
      const values = Object.values(data);

      const setClause = columns.map((col, index) => `${col} = $${index + 2}`).join(', ');

      const query = `
        UPDATE ${tableName}
        SET ${setClause}, updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `;

      const result = await pool.query(query, [id, ...values]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: `${entityName} não encontrado` });
      }

      res.json(result.rows[0]);
    } catch (error) {
      console.error(`Update ${entityName} error:`, error);
      res.status(500).json({ error: `Erro ao atualizar ${entityName}` });
    }
  });

  // Delete
  app.delete(`/api/${tableName}/:id`, authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(`DELETE FROM ${tableName} WHERE id = $1 RETURNING *`, [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: `${entityName} não encontrado` });
      }

      res.json({ message: `${entityName} deletado com sucesso` });
    } catch (error) {
      console.error(`Delete ${entityName} error:`, error);
      res.status(500).json({ error: `Erro ao deletar ${entityName}` });
    }
  });
};

// Criar rotas CRUD para diferentes entidades
createCrudRoutes('usuarios', 'usuário');
createCrudRoutes('veiculos', 'veículo');
createCrudRoutes('abastecimentos', 'abastecimento');
createCrudRoutes('manutencoes', 'manutenção');
createCrudRoutes('checklists', 'checklist');
createCrudRoutes('funcionarios', 'funcionário');
createCrudRoutes('cadastros', 'cadastro');

// Rotas específicas para o módulo financeiro
createCrudRoutes('centros_custo', 'centro de custo');
createCrudRoutes('contas_pagar', 'conta a pagar');
createCrudRoutes('contas_receber', 'conta a receber');

// Rota específica para limpar permissões órfãs
app.delete('/api/user-permissions/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    // Verificar se o usuário realmente não existe
    const userExists = await pool.query('SELECT id FROM usuarios WHERE id = $1', [userId]);

    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'Usuário ainda existe no sistema' });
    }

    // Remover permissões órfãs
    const result = await pool.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);

    res.json({ 
      message: 'Permissões órfãs removidas com sucesso',
      deletedCount: result.rowCount
    });
  } catch (error) {
    console.error('Error cleaning up orphaned permissions:', error);
    res.status(500).json({ error: 'Erro ao remover permissões órfãs' });
  }
});

// ===== ENDPOINTS PARA MONITORAMENTO CTE =====

// Buscar documentos CTE pendentes para processamento
app.get('/api/cte-documentos/pendentes', async (req, res) => {
  try {
    console.log('🔍 Buscando documentos CTE pendentes...');
    
    const result = await pool.query(`
      SELECT id, numero_cte, status,  created_at, updated_at
      FROM cte_documentos 
      WHERE status = 'pendente'
      ORDER BY numero_cte ASC
      LIMIT 10
    `);

    console.log(`✅ Encontrados ${result.rows.length} documentos CTE pendentes`);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Erro ao buscar documentos CTE pendentes:', error);
    res.status(500).json({ 
      error: 'Erro ao buscar documentos pendentes',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Atualizar status de documento CTE
app.put('/api/cte-documentos/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    console.log(`📝 Atualizando status do documento CTE ${id} para: ${status}`);
    
    if (!['pendente', 'emitido', 'cancelado'].includes(status)) {
      return res.status(400).json({ error: 'Status inválido. Use: pendente, emitido ou cancelado' });
    }

    const result = await pool.query(`
      UPDATE cte_documentos 
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, status, updated_at
    `, [status, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Documento CTE não encontrado' });
    }

    console.log(`✅ Status do documento CTE ${id} atualizado para: ${status}`);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ Erro ao atualizar status do documento CTE:', error);
    res.status(500).json({ 
      error: 'Erro ao atualizar status do documento',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Obter estatísticas da tabela CTE
app.get('/api/cte-documentos/stats', async (req, res) => {
  try {
    console.log('📊 Obtendo estatísticas dos documentos CTE...');
    
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pendente' THEN 1 END) as pendentes,
        COUNT(CASE WHEN status = 'emitido' THEN 1 END) as emitidos,
        COUNT(CASE WHEN status = 'cancelado' THEN 1 END) as cancelados
      FROM cte_documentos
    `);

    const stats = result.rows[0];
    console.log('✅ Estatísticas CTE:', stats);
    
    res.json({
      total: parseInt(stats.total),
      pendentes: parseInt(stats.pendentes),
      emitidos: parseInt(stats.emitidos),
      cancelados: parseInt(stats.cancelados),
      tableName: 'cte_documentos'
    });
  } catch (error) {
    console.error('❌ Erro ao obter estatísticas CTE:', error);
    res.status(500).json({ 
      error: 'Erro ao obter estatísticas',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Inserir documento CTE de teste
app.post('/api/cte-documentos/teste', async (req, res) => {
  try {
    console.log('📄 Inserindo documento CTE de teste...');
    
    const dados = {
      validarDocumento: true,
      gerarXML: true,
      enviarSEFAZ: true,
      ...req.body
    };

    const result = await pool.query(`
      INSERT INTO cte_documentos (status, prioridade, dados, created_at, updated_at)
      VALUES ('pendente', 5, $1, NOW(), NOW())
      RETURNING id, status, prioridade, dados, created_at
    `, [JSON.stringify(dados)]);

    const newDoc = result.rows[0];
    console.log(`✅ Documento CTE de teste criado com ID: ${newDoc.id}`);
    
    res.status(201).json({
      message: 'Documento CTE de teste inserido com sucesso',
      documento: newDoc
    });
  } catch (error) {
    console.error('❌ Erro ao inserir documento CTE de teste:', error);
    res.status(500).json({ 
      error: 'Erro ao inserir documento de teste',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Verificar se tabela CTE existe e criar se necessário
app.post('/api/cte-documentos/setup', async (req, res) => {
  try {
    console.log('🔧 Verificando/criando tabela cte_documentos...');
    
    // Verificar se a tabela existe
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'cte_documentos'
      )
    `);

    if (!tableExists.rows[0].exists) {
      console.log('📦 Criando tabela cte_documentos...');
      
      await pool.query(`
        CREATE TABLE cte_documentos (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          status varchar(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'emitido', 'cancelado')),
          prioridade integer NOT NULL DEFAULT 1,
          dados jsonb,
          created_at timestamptz DEFAULT now(),
          updated_at timestamptz DEFAULT now()
        )
      `);
      
      // Criar índices
      await pool.query(`
        CREATE INDEX idx_cte_documentos_status ON cte_documentos(status);
        CREATE INDEX idx_cte_documentos_prioridade ON cte_documentos(prioridade);
        CREATE INDEX idx_cte_documentos_created_at ON cte_documentos(created_at);
      `);
      
      console.log('✅ Tabela cte_documentos criada com sucesso');
    } else {
      console.log('✅ Tabela cte_documentos já existe');
    }

    res.json({ 
      message: 'Tabela cte_documentos verificada/criada com sucesso',
      tableExists: tableExists.rows[0].exists
    });
  } catch (error) {
    console.error('❌ Erro ao configurar tabela CTE:', error);
    res.status(500).json({ 
      error: 'Erro ao configurar tabela',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Rota para verificar inconsistências entre usuários e permissões
app.get('/api/permissions/audit', authenticateToken, async (req, res) => {
  try {
    // Buscar permissões órfãs (permissões sem usuário correspondente)
    const orphanedPermissions = await pool.query(`
      SELECT DISTINCT up.user_id, COUNT(*) as permission_count
      FROM user_permissions up
      LEFT JOIN usuarios u ON up.user_id = u.id
      WHERE u.id IS NULL
      GROUP BY up.user_id
    `);

    // Buscar usuários sem permissões
    const usersWithoutPermissions = await pool.query(`
      SELECT u.id, u.email, u.nome, u.tipo
      FROM usuarios u
      LEFT JOIN user_permissions up ON u.id = up.user_id
      WHERE up.user_id IS NULL
    `);

    res.json({
      orphanedPermissions: orphanedPermissions.rows,
      usersWithoutPermissions: usersWithoutPermissions.rows
    });
  } catch (error) {
    console.error('Error auditing permissions:', error);
    res.status(500).json({ error: 'Erro ao auditar permissões' });
  }
});

// Todas as outras rotas direcionam para o index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Endpoint para upload de arquivos XML
app.post('/api/upload-xml', async (req, res) => {
  try {
    const { content, path, filename } = req.body;
    
    if (!content || !path || !filename) {
      return res.status(400).json({ error: 'Dados incompletos' });
    }
    
    console.log("📁 Recebendo arquivo XML para salvar:", path);
    
    // Criar diretório se não existir
    const fs = require('fs').promises;
    const pathLib = require('path');
    
    const fullPath = pathLib.join(__dirname, path);
    const directory = pathLib.dirname(fullPath);
    
    // Criar diretórios recursivamente
    await fs.mkdir(directory, { recursive: true });
    
    // Salvar arquivo
    await fs.writeFile(fullPath, content, 'utf8');
    
    console.log("✅ Arquivo XML salvo com sucesso:", fullPath);
    
    res.json({ 
      success: true, 
      path: path,
      size: content.length 
    });
    
  } catch (error) {
    console.error("❌ Erro ao salvar arquivo XML:", error);
    res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error.message 
    });
  }
});

// Servir arquivos XML estáticos
app.get('/uploads/*', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  
  const filePath = path.join(__dirname, req.path);
  
  // Verificar se o arquivo existe
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo não encontrado' });
  }
  
  // Definir tipo de conteúdo baseado na extensão
  const ext = path.extname(filePath).toLowerCase();
  let contentType = 'application/octet-stream';
  
  if (ext === '.xml') {
    contentType = 'application/xml';
  } else if (ext === '.pdf') {
    contentType = 'application/pdf';
  }
  
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);
  
  // Enviar arquivo
  res.sendFile(filePath);
});

// Tratamento de erros global
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  res.status(500).json({ error: 'Erro Interno do Servidor' });
});

// Iniciar servidor
const server = app.listen(PORT, 'localhost', () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);

  // Inicializar estrutura do banco principal na inicialização
  createDatabaseStructure()
    .then(() => {
      console.log('✅ Estrutura do banco principal inicializada com sucesso');
    })
    .catch((error) => {
      console.error('❌ Erro ao inicializar estrutura do banco principal:', error);
    });
});

// Tratamento de sinais para encerramento gracioso
const gracefulShutdown = () => {
  console.log('Iniciando encerramento gracioso...');
  server.close(async () => {
    await mainPool.end();
    console.log('Servidor encerrado com sucesso');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);