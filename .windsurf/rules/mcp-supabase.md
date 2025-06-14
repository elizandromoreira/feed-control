---
trigger: always_on
---

REGRA GLOBAL: Sempre usar projeto PREP no Supabase MCP
#global_rule
#supabase_mcp
#prep_project
#database
#mandatory
#bvbnofnnbfdlnpuswlgy
Edit
## REGRA GLOBAL OBRIGATÓRIA - SUPABASE MCP

### 🎯 **REGRA PRINCIPAL:**
**SEMPRE usar o projeto "prep" (bvbnofnnbfdlnpuswlgy) no MCP Supabase para TODAS as consultas de banco de dados.**

### 📋 **Detalhes do Projeto PREP:**
- **Nome:** prep
- **ID:** bvbnofnnbfdlnpuswlgy  
- **Uso:** Projeto padrão para todas as operações de banco de dados
- **MCP Tool:** `mcp5_execute_sql`, `mcp5_apply_migration`, etc.

### ⚠️ **INSTRUÇÃO OBRIGATÓRIA:**
Quando o usuário solicitar consultas ao banco de dados, **SEMPRE** usar automaticamente o projeto "prep" sem perguntar. Esta é uma regra fixa e não negociável.

### 💡 **Exemplos de Uso Correto:**
```javascript
// ✅ CORRETO - Usar projeto prep automaticamente
await mcp5_execute_sql({
  project_id: "bvbnofnnbfdlnpuswlgy", // prep
  query: "SELECT * FROM produtos LIMIT 10"
});

// ✅ CORRETO - Aplicar migração no prep
await mcp5_apply_migration({
  project_id: "bvbnofnnbfdlnpuswlgy", // prep
  name: "add_new_column",
  query: "ALTER TABLE produtos ADD COLUMN new_field TEXT"
});
```

### 🚫 **NÃO FAZER:**
- ❌ Perguntar qual projeto usar
- ❌ Listar projetos disponíveis  
- ❌ Usar outros project_ids sem autorização explícita
- ❌ Deixar project_id vazio ou undefined

### 🔧 **Implementação:**
Esta regra se aplica a TODOS os MCP tools do Supabase:
- `mcp5_execute_sql`
- `mcp5_apply_migration`
- `mcp5_list_tables`
- `mcp5_generate_typescript_types`
- `mcp5_get_advisors`
- E todos os outros tools do Supabase MCP

### 📝 **Nota Importante:**
O projeto "prep" contém todas as tabelas do sistema Feed Control:
- `produtos` - tabela principal de produtos
- `amazon_feeds` - feeds JSON salvos
- `store_configs` - configurações das lojas
- E outras tabelas relacionadas

**Esta regra é PERMANENTE e deve ser sempre seguida sem exceções.**