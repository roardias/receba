# Mapeamento API Omie → Sistema de Cobranças

> Documento para mapear os campos que vêm da API Omie e definir o que iremos usar no sistema.

---

## 1. Endpoints principais

| Endpoint | Método | Uso no sistema |
|----------|--------|----------------|
| `/api/v1/financas/contareceber/` | **ListarContasReceber** | Buscar títulos em aberto |
| `/api/v1/financas/contareceber/` | **ConsultarContaReceber** | Detalhe de um título (se necessário) |
| `/api/v1/geral/clientes/` | **ListarClientes** ou **ConsultarCliente** | Dados do cliente (nome, CNPJ, contatos) |

**Filtro importante:** `filtrar_apenas_titulos_em_aberto = "S"` — traz só títulos a receber (não baixados).

---

## 2. Campos do `conta_receber_cadastro` (retorno da ListarContasReceber)

### 2.1 Campos essenciais para cobrança (prioridade alta)

| Campo Omie | Tipo | Uso no sistema | Campo Supabase (sugerido) |
|------------|------|----------------|---------------------------|
| `codigo_lancamento_omie` | integer | ID único no Omie | `omie_id` |
| `codigo_lancamento_integracao` | string | ID do sistema integrador | `codigo_integracao` |
| `codigo_cliente_fornecedor` | integer | Código do cliente no Omie | `omie_cliente_id` |
| `numero_documento` | string | Nº do documento | `numero_documento` |
| `numero_parcela` | string | Ex: "1/3", "2/3" | `numero_parcela` |
| `data_vencimento` | string (dd/mm/yyyy) | Data de vencimento | `data_vencimento` |
| `valor_documento` | decimal | Valor do título | `valor` |
| `status_titulo` | string | Status no Omie | `status_omie` (referência) |
| `bloqueado` | string (S/N) | Se está bloqueado | `bloqueado_omie` |
| `numero_pedido` | string | Nº do pedido | `numero_pedido` |
| `numero_documento_fiscal` | string | NF, etc. | `numero_nf` |
| `data_emissao` | string | Data emissão | `data_emissao` |
| `observacao` | text | Observação do título | `observacao_omie` |

### 2.2 Campos úteis (prioridade média)

| Campo Omie | Tipo | Uso no sistema | Campo Supabase |
|------------|------|----------------|----------------|
| `codigo_categoria` | string | Categoria contábil | `categoria` |
| `data_previsao` | string | Previsão de recebimento | `data_previsao` |
| `codigo_vendedor` | integer | Vendedor responsável | `vendedor_id` |
| `codigo_tipo_documento` | string | Tipo do doc | `tipo_documento` |
| `chave_nfe` | string | Chave da NF-e | `chave_nfe` |

### 2.3 Campos que provavelmente NÃO usaremos

- Impostos (valor_pis, valor_cofins, valor_csll, valor_ir, valor_iss, valor_inss)
- Rateio de categoria/departamento
- Boleto (código de barras, etc.) — a menos que queira exibir
- Repetição, distribuição
- Campos de conciliação, baixa automática

*(Podemos incluir depois se necessário.)*

---

## 3. Dados do cliente (endpoint Clientes) — definido

**Campos mapeados para o sistema:**

| Campo no sistema | Origem Omie | Observação |
|------------------|-------------|------------|
| empresa | tenant_empresa | Identificador do tenant |
| cnpj_cpf | cnpj_cpf | CNPJ/CPF |
| codigo_cliente_omie | codigo_cliente_omie | ID do cliente no Omie |
| email | email | E-mail |
| contato | contato | Nome para contato |
| nome_fantasia | nome_fantasia | Nome fantasia |
| razao_social | razao_social | Razão social |
| telefone1 | telefone1_ddd + telefone1_numero | Apenas dígitos (sem espaços ou caracteres especiais) |
| telefone2 | telefone2_ddd + telefone2_numero | Apenas dígitos (sem espaços ou caracteres especiais) |
| chave_unica | empresa + codigo_cliente_omie | Gerada automaticamente no Supabase — UNIQUE |

**Chave única:** `chave_unica = empresa || '_' || codigo_cliente_omie` — garante um cliente por código Omie por tenant.

---

## 4. Estrutura sugerida para validação

### Passo 1 — Documentar (este arquivo)
- [ ] Revisar lista de campos essenciais acima
- [ ] Marcar o que sua operação realmente precisa
- [ ] Adicionar campos que faltaram

### Passo 2 — Obter dados reais
- [ ] Rodar `ListarContasReceber` com `filtrar_apenas_titulos_em_aberto = "S"`
- [ ] Salvar resposta JSON em arquivo (ex.: `sample_titulos.json`)
- [ ] Opcional: exportar para CSV apenas para abrir no Excel e validar
- [ ] Conferir se os campos mapeados existem e vêm preenchidos

### Passo 3 — Definir schema Supabase
- [ ] Tabela `titulos` (ou `contas_receber`) com os campos escolhidos
- [ ] Tabela `clientes` com dados do Omie
- [ ] Relacionamento título → cliente
- [ ] Campo `empresa_id` em todas (multi-tenant)

### Passo 4 — Implementar sync
- [ ] Omie API → Supabase (direto, sem CSV em produção)

---

## 5. CSV: quando usar

- **Para mapeamento:** Sim — exportar uma vez para CSV (a partir do JSON da API) para abrir no Excel, validar campos com a equipe e ajustar este mapeamento.
- **Para produção:** Não — o fluxo deve ser Omie API → Supabase diretamente.
- **Para backup/auditoria:** Opcional — gerar CSV em exportações manuais do sistema.

---

## 6. Próximo passo prático

1. **Você tem credenciais Omie (app_key, app_secret)?** Se sim, podemos criar um script simples que:
   - Chama `ListarContasReceber` com filtro de títulos em aberto
   - Salva o JSON em arquivo
   - Opcionalmente gera um CSV para você abrir e validar

2. **Revise a tabela da seção 2.1** e indique:
   - Quais campos são obrigatórios para você
   - Quais campos faltam

Depois disso, definimos o schema do Supabase e a lógica de sincronização.
