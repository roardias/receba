# Plano do Projeto - Sistema de Controle de Cobranças

> **Documento de planejamento** — Mapa de funcionalidades e estrutura para desenvolvimento. Sem código.

---

## 1. Visão Geral do Sistema

**Nome sugerido:** Sistema de Controle de Cobranças (ou Receba)

**Objetivo:** Sistema web profissional para controle de cobranças de títulos em aberto, integrado à API do Omie, com rastreamento de contatos, níveis de permissão e status customizáveis.

**Princípios:**
- Estrutura profissional
- Aplicação web
- Fácil manutenção
- Escalável
- **Comercializável (SaaS):** cada cliente (empresa) tem seu próprio ambiente isolado

---

## 1.1 Modelo Multi-tenant (SaaS)

O sistema será **multi-tenant**, ou seja, uma única instalação atende **várias empresas** que usam Omie. Cada empresa:
- Tem seus dados completamente **isolados** (títulos, clientes, contatos, usuários)
- Configura **suas próprias** chaves de API do Omie
- Define **sua própria** marca (logo) para relatórios
- Possui **seus próprios** usuários e permissões
- Configura **seu próprio** agendamento de sincronização

### 1.2 Marca / Identidade visual da empresa
- **Logo:** campo para upload da logo da empresa (formats: PNG, JPG, SVG)
- **Uso:** exibição em relatórios, cabeçalhos, PDFs exportados
- **Armazenamento seguro:** em bucket separado com controle de acesso
- **Dimensões sugeridas:** recomendar tamanho mínimo (ex.: 200x80px) para boa qualidade em impressão

### 1.3 Parametrização por empresa
- **Chaves API Omie** (app_key, app_secret): cada empresa cadastra as suas
- Armazenamento **criptografado** (nunca em texto plano)
- Validação opcional: testar conexão antes de salvar
- Renovação/atualização de chaves quando necessário

### 1.4 Modelo de cadastro de empresas (a definir)
- **Opção A:** Super-admin cria empresas manualmente (painel interno)
- **Opção B:** Cadastro self-service (novas empresas se registram)
- **Opção C:** Híbrido (cadastro + aprovação)

---

## 2. Integração Omie (API)

### 2.1 Escopo da integração
- **Entrada de dados:** Importar títulos em aberto (contas a receber) do Omie
- **Sincronização bidirecional (se aplicável):** Verificar quais operações o Omie permite (baixa de títulos, atualização de status, etc.)
- **Dados principais a consumir:**
  - Clientes
  - Títulos em aberto (valor, vencimento, cliente, número do documento)
  - Possivelmente: histórico de pagamentos (se disponível)

### 2.2 Agendamento automático de sincronização
- O **administrador** configura quando a API será chamada
- **Dias da semana:** seleção múltipla (ex.: seg, ter, qua, qui, sex)
- **Horários:** um ou mais horários por dia (ex.: 08:00, 12:00, 18:00)
- **Execução:** Supabase Cron (nativo) dispara Edge Function — sem necessidade de serviços externos
- Log de execuções (sucesso, erro, quantidade de registros atualizados)

### 2.3 Parametrização por empresa (multi-tenant)
- **Cada empresa** configura suas credenciais Omie em área restrita (admin)
- Credenciais **criptografadas em repouso** (AES-256 ou similar)
- Chaves de criptografia em variáveis de ambiente (não no código)
- Interface para testar conexão antes de salvar
- Não exibir valores das chaves na tela (apenas mascarados ou indicador "configurado")

### 2.4 Itens a planejar
- Tratamento de erros e retentativas
- Rate limiting da API Omie (se houver)

---

## 3. Controle de Cobranças

### 3.1 Títulos em aberto
- Listagem de títulos com filtros (cliente, vencimento, valor, status)
- Informações exibidas: cliente, documento, valor, vencimento, dias em atraso, status
- Ordenação e paginação
- Visualização detalhada de cada título

### 3.2 Histórico de contatos / atualizações
- **Registro de cada contato** feito com o cliente:
  - Data e hora
  - Usuário que registrou
  - Tipo de contato (ligaçao, e-mail, WhatsApp, visita, etc.)
  - Descrição do que foi negociado ou não
  - Observações livres
- Histórico ordenado por data (mais recente primeiro)
- Vinculado ao título ou ao cliente (definir na arquitetura)

### 3.3 Status da cobrança
- Campo de status em cada título/cliente
- **Status predefinidos:** Bloqueado, Em processo judicial (podem ser exemplos iniciais)
- **Customizáveis:** Admin ou usuário com permissão cadastra os tipos de status
- Exemplos possíveis: Em negociação, Promessa de pagamento, Bloqueado, Em processo judicial, Sem contato, Em análise, etc.
- Cada status pode ter cor e ordem de exibição

---

## 4. Níveis de Usuários e Permissões

### 4.1 Papéis sugeridos (roles)
- **Administrador:** acesso total, configurações do sistema, usuários, API, status
- **Gerente / Supervisor:** visão ampla, relatórios, possível aprovação de ações
- **Operador / Cobrador:** uso diário, registro de contatos, alteração de status (conforme permissão)
- **Visualizador:** apenas leitura (se necessário)

### 4.2 Permissões granulares
- **Visualizar:** títulos, clientes, histórico de contatos
- **Editar:** alterar status, registrar contatos, editar observações
- **Excluir:** remover registros (histórico, contatos) — cuidado com auditoria
- **Configurar:** status, agendamento da API, usuários (admin)

### 4.3 Matriz de permissões (a definir)
| Ação                    | Admin | Gerente | Operador | Visualizador |
|-------------------------|-------|---------|----------|--------------|
| Ver títulos             | ✓     | ✓       | ✓        | ✓            |
| Registrar contato       | ✓     | ✓       | ✓        | —            |
| Alterar status          | ✓     | ✓       | ✓*       | —            |
| Cadastrar tipos status  | ✓     | ✓*      | —        | —            |
| Configurar API/agenda   | ✓     | —       | —        | —            |
| Gerenciar usuários      | ✓     | —       | —        | —            |

\* Pode ser configurável por perfil.

---

## 5. Módulos do Sistema

### Módulo 1 — Autenticação e usuários
- Login / logout
- Cadastro de usuários (admin)
- Perfis e permissões
- Recuperação de senha
- Auditoria de acesso (opcional)

### Módulo 2 — Integração Omie
- Configuração de credenciais
- Agendamento (dias e horários)
- Execução e logs de sincronização
- Tratamento de erros

### Módulo 3 — Títulos e clientes
- Listagem de títulos em aberto
- Detalhes do título
- Filtros e busca
- Dados do cliente (via Omie ou cópia local)

### Módulo 4 — Histórico de contatos
- Registro de contato (data, tipo, descrição)
- Listagem por título ou cliente
- Edição/exclusão (conforme permissão)

### Módulo 5 — Status de cobrança
- Cadastro de tipos de status (admin/permissoes)
- Atribuição de status aos títulos
- Filtros por status

### Módulo 6 — Configurações e administração
- **Marca da empresa:** upload de logo, visualização
- **Credenciais Omie:** app_key, app_secret (criptografadas)
- Agendamento de sincronização
- Gestão de usuários e permissões
- Cadastro de tipos de contato (opcional)
- Cadastro de tipos de status

### Módulo 7 — Relatórios e dashboard (futuro)
- Resumo de cobranças
- Títulos por status
- Contatos por período
- Métricas de efetividade
- **Cabeçalho com logo da empresa** em todos os relatórios e exportações (PDF, Excel)

---

## 6. Estrutura técnica sugerida

### 6.1 Banco de dados — Supabase (recomendado)

**Resumo:** Supabase é uma excelente escolha para este projeto.

| Aspecto | Benefício |
|---------|-----------|
| **PostgreSQL** | Banco relacional robusto, ideal para títulos, clientes, contatos, usuários |
| **Row Level Security (RLS)** | Isolamento natural entre empresas (multi-tenant) — cada query filtra por `empresa_id` |
| **Storage** | Bucket para logos das empresas, com políticas de acesso por tenant |
| **Auth (opcional)** | Pode usar Supabase Auth ou autenticação própria — flexível |
| **Escalabilidade** | Gerido pela Supabase, escala automática |
| **Custo** | Plano gratuito generoso para início; planos pagos previsíveis |
| **Desenvolvimento** | APIs REST e Realtime automáticas; SDKs em JS/TS |
| **Migrations** | Controle de schema via migrações versionadas |

**Jobs agendados — Supabase Cron (nativo):**
- O Supabase tem **Cron integrado** via extensão `pg_cron` (Postgres Module)
- Configurável pelo Dashboard (Integrations → Cron) ou via SQL
- Pode executar SQL/funções no banco **ou** fazer requisições HTTP (ex.: chamar Edge Function)
- **Não é necessário serviço externo** — assim como no Lovable, o agendamento fica dentro do próprio ecossistema
- Estratégia: um job Cron dispara em intervalos (ex.: a cada hora); a Edge Function consulta quais empresas têm sync agendado para aquele momento e executa

**Credenciais Omie:** armazenar criptografadas no PostgreSQL; a criptografia/descriptografia ocorre no backend/Edge Function.

**Veredicto:** Supabase atende bem ao modelo SaaS, multi-tenant, armazenamento de logos e jobs agendados. Recomendado.

### 6.2 Stack recomendada (a validar)
- **Banco de dados:** Supabase (PostgreSQL + Storage)
- **Frontend:** SPA (React/Next.js ou Vue/Nuxt) — responsivo, fácil manutenção
- **Backend:** API REST (Node.js/Express, Python/FastAPI ou .NET) — ou uso híbrido com Edge Functions do Supabase
- **Autenticação:** JWT + refresh token (Supabase Auth ou solução própria)
- **Jobs agendados:** Supabase Cron (nativo, pg_cron) — chama Edge Function nos horários configurados
- **Hospedagem:** Vercel, Railway, Render ou similar (frontend + backend)

### 6.3 Organização do código
- Separação frontend / backend
- Camadas: Controller → Service → Repository
- Variáveis de ambiente para credenciais
- Logs estruturados
- Testes automatizados (unitários e integração)

### 6.4 Segurança e boas práticas

**Geral:**
- HTTPS obrigatório em todo o tráfego
- Senhas com hash forte (bcrypt, Argon2 ou scrypt)
- Proteção contra CSRF, XSS, SQL Injection
- Controle de sessão e expiração de token (JWT com tempo curto + refresh)

**Multi-tenant:**
- **Isolamento de dados:** toda query deve filtrar por `empresa_id` (ou equivalente)
- **Row Level Security (RLS):** no Supabase, políticas garantem que usuário só acesse dados da própria empresa
- **Validação no backend:** nunca confiar apenas no frontend — sempre validar tenant no servidor

**Credenciais Omie:**
- Criptografia em repouso (AES-256-GCM ou similar)
- Chave mestra em variável de ambiente (nunca no código ou repositório)
- Rotação de chaves planejada para o futuro
- Logs não devem registrar valores das credenciais

**Armazenamento de logos:**
- Bucket privado ou com políticas restritas
- Validação de tipo de arquivo (apenas PNG, JPG, SVG)
- Limite de tamanho (ex.: 2 MB)
- Sanitização de nome do arquivo (evitar path traversal)

---

## 7. Entidades principais (conceitual)

> **Multi-tenant:** Todas as entidades operacionais pertencem a uma **Empresa** (exceto Empresa e Super-admin, se houver).

### 7.1 Empresa (tenant)
- Nome da empresa
- CNPJ (opcional, para cobrança)
- **Logo:** URL do arquivo no storage (Supabase Storage)
- Plano/limites (se houver tier de preços)
- Ativo/inativo

### 7.2 Usuário
- **Empresa** (vínculo) — cada usuário pertence a uma empresa
- Dados de login (e-mail, senha)
- Nome, perfil (role)
- Permissões (por role ou granular)
- Ativo/inativo

### 7.3 Cliente (espelho do Omie, por empresa)
- **Empresa** (vínculo)
- ID externo (Omie)
- Nome, CNPJ/CPF, contatos
- Status atual
- Data de última sincronização

### 7.4 Título
- **Empresa** (vínculo)
- ID externo (Omie)
- Cliente
- Número do documento, valor, vencimento
- Status da cobrança
- Data de última sincronização

### 7.5 Contato / Histórico
- **Empresa** (vínculo)
- Título ou Cliente (vínculo)
- Usuário que registrou
- Data/hora
- Tipo de contato
- Descrição / observação

### 7.6 Tipo de status (por empresa)
- **Empresa** (vínculo) — cada empresa define seus status
- Nome, cor, ordem
- Ativo/inativo

### 7.7 Configuração (por empresa)
- **Empresa** (vínculo)
- Credenciais Omie (criptografadas)
- Agendamento (dias, horários em JSON ou tabela)
- Parâmetros gerais

### 7.8 Log de sincronização
- **Empresa** (vínculo)
- Data/hora da execução
- Status (sucesso/erro)
- Quantidade de registros
- Mensagem de erro (se houver)

---

## 8. Fluxos principais

### 8.1 Onboarding de nova empresa (SaaS)
1. Cadastro da empresa (nome, CNPJ se aplicável)
2. Upload da logo (opcional na primeira etapa)
3. Criação do primeiro usuário admin
4. Login do admin

### 8.2 Primeira configuração (por empresa)
1. Admin da empresa faz login
2. Configura marca: upload da logo
3. Cadastra credenciais Omie (app_key, app_secret)
4. Define agendamento da sincronização
5. Executa primeira sincronização (manual ou aguarda job)
6. Cadastra tipos de status
7. Cria usuários e permissões

### 8.3 Uso diário (operador)
1. Login
2. Acessa lista de títulos (com filtros)
3. Seleciona título
4. Registra contato (tipo, descrição)
5. Altera status se necessário

### 8.4 Sync clientes (diário)
- API Omie ListarClientes com paginação
- UPSERT no Supabase: novo → INSERT, existente → UPDATE
- Chave de conflito: (empresa, codigo_cliente_omie)
- Batch de 100 registros por requisição
- Execução: Supabase Cron ou agendador externo

### 8.5 Sincronização automática (geral)
1. Job dispara no horário configurado
2. Verifica se o dia da semana está na lista
3. Chama API Omie
4. Atualiza/insere títulos e clientes
5. Registra log

---

## 9. Fases de desenvolvimento sugeridas

### Fase 1 — Base
- Estrutura do projeto (frontend + backend)
- Supabase: projeto, schema multi-tenant (empresa_id em todas as tabelas)
- Entidade Empresa e RLS para isolamento
- Autenticação e usuários (vinculados à empresa)
- Upload de logo (Supabase Storage)
- Módulo de configuração (credenciais Omie criptografadas, sem agendamento ainda)

### Fase 2 — Integração Omie
- Consumo da API Omie (títulos, clientes)
- Sincronização manual
- Armazenamento local dos dados
- Log de sincronização

### Fase 3 — Agendamento
- Configuração de dias e horários
- Job/cron para execução automática
- Interface para configurar agendamento

### Fase 4 — Cobranças e contatos
- Listagem de títulos
- Cadastro de tipos de status
- Registro de contatos
- Alteração de status
- Permissões por ação

### Fase 5 — Refinamentos
- Permissões granulares
- Cadastro de tipos de contato
- Filtros avançados
- Ajustes de UX
- Documentação

### Fase 6 — Extras (opcional)
- Dashboard e relatórios
- Exportação (Excel, PDF)
- Notificações
- Auditoria completa

---

## 10. Riscos e pontos de atenção

- **API Omie:** documentação, limites de requisição, mudanças de versão
- **Dados sensíveis:** credenciais e dados de clientes — criptografia e LGPD
- **Concorrência:** múltiplos usuários editando o mesmo registro
- **Performance:** muitos títulos — paginação, índices, cache se necessário
- **Multi-tenant:** garantir sempre o filtro por empresa — um bug pode vazar dados entre empresas
- **Supabase:** limite de conexões no plano gratuito; monitorar uso conforme crescimento

---

## 11. Próximos passos

1. Validar este plano com stakeholders
2. Criar projeto no Supabase e configurar estrutura multi-tenant
3. Definir stack frontend/backend (Next.js + API, ou outro)
4. Criar repositório e estrutura de pastas
5. Iniciar Fase 1 conforme o mapa acima
6. Consultar documentação oficial da API Omie para detalhar endpoints
7. Definir modelo de cadastro de empresas (1.4)

---

*Documento criado como mapa do projeto. Será atualizado conforme avanço do desenvolvimento.*
