# Workflow: Migração de Feeds para Banco de Dados

## Objetivo
Migrar o sistema de armazenamento de feeds JSON locais para o banco de dados Supabase, mantendo auditoria completa e melhorando a performance.

## Etapas do Workflow

### Fase 1: Preparação do Banco de Dados
- [x] 1.1 Conectar ao Supabase projeto 'prep' (ID: bvbnofnnbfdlnpuswlgy)
- [x] 1.2 Criar tabela `amazon_feeds` com estrutura definida
- [x] 1.3 Criar índices para otimização de consultas
- [x] 1.4 Testar conexão e permissões

### Fase 2: Implementação do Serviço de Feeds
- [x] 2.1 Criar arquivo `backend/src/services/feedService.js`
- [x] 2.2 Implementar função `saveFeed()` para inserir feeds
- [x] 2.3 Implementar função `getFeedsByTypeAndStore()` para consultas
- [x] 2.4 Implementar função `getFeedById()` para buscar feed específico
- [x] 2.5 Implementar função `updateFeedStatus()` para atualizar status
- [x] 2.6 Adicionar tratamento de erros e logging

### Fase 3: Modificação do Código Existente
- [x] 3.1 Atualizar `backend/src/phases/phase2.js`:
  - [x] 3.1.1 Importar `feedService`
  - [x] 3.1.2 Modificar `saveFeedLocally()` para salvar no DB
  - [x] 3.1.3 Modificar `processAndDownloadFeedResults()` para salvar resultados
- [x] 3.2 Adicionar parâmetro `storeId` onde necessário
- [x] 3.3 Manter compatibilidade com sistema atual (dual-save)

### Fase 4: Script de Migração
- [x] 4.1 Criar arquivo `backend/migrate-feeds.js`
- [x] 4.2 Implementar leitura de arquivos do diretório `feeds/`
- [x] 4.3 Implementar parser para diferentes tipos de feed
- [x] 4.4 Implementar processamento em lotes
- [x] 4.5 Adicionar relatório de progresso
- [x] 4.6 Implementar modo dry-run para teste

### Fase 5: Testes
- [ ] 5.1 Testar criação de novos feeds no banco
- [ ] 5.2 Testar migração com subset de arquivos
- [ ] 5.3 Verificar integridade dos dados migrados
- [ ] 5.4 Testar performance de consultas
- [ ] 5.5 Validar dual-save (arquivo + DB)

### Fase 6: Migração Completa
- [ ] 6.1 Fazer backup dos arquivos de feed
- [ ] 6.2 Executar migração completa
- [ ] 6.3 Verificar contagem e integridade
- [ ] 6.4 Criar relatório de migração

### Fase 7: Limpeza e Otimização
- [ ] 7.1 Remover arquivos locais após confirmação
- [ ] 7.2 Atualizar scripts de deploy para excluir feeds/
- [ ] 7.3 Criar rotina de limpeza de feeds antigos no DB
- [ ] 7.4 Documentar novo sistema

## Estrutura da Tabela

```sql
CREATE TABLE amazon_feeds (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  feed_id TEXT,
  feed_type TEXT NOT NULL CHECK (feed_type IN ('inventory', 'result')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  store_id TEXT NOT NULL,
  content JSONB NOT NULL,
  summary JSONB,
  status TEXT DEFAULT 'processed',
  item_count INTEGER,
  file_path TEXT,
  
  -- Índices
  CONSTRAINT idx_unique_feed_id UNIQUE (feed_id)
);

CREATE INDEX idx_amazon_feeds_store_id ON amazon_feeds(store_id);
CREATE INDEX idx_amazon_feeds_timestamp ON amazon_feeds(timestamp);
CREATE INDEX idx_amazon_feeds_feed_type ON amazon_feeds(feed_type);
CREATE INDEX idx_amazon_feeds_status ON amazon_feeds(status);
```

## Configurações Necessárias

### Conexão Supabase
```javascript
// Já configurado em backend/src/config/db.js
const pool = new Pool({
  user: 'postgres.bvbnofnnbfdlnpuswlgy',
  host: 'aws-0-us-east-1.pooler.supabase.com',
  database: 'postgres',
  password: 'Bi88An6B9L0EIihL',
  port: 6543,
});
```

## Notas Importantes

1. **Dual-Save**: Durante a transição, salvar tanto em arquivo quanto no banco
2. **Rollback**: Manter arquivos originais até confirmação completa
3. **Performance**: Processar migração em lotes de 100 arquivos
4. **Monitoramento**: Adicionar logs detalhados em cada etapa
5. **Segurança**: Não expor credenciais em logs

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| Perda de dados | Backup completo antes da migração |
| Falha na migração | Implementar transações e rollback |
| Performance degradada | Processar em lotes, adicionar índices |
| Incompatibilidade | Manter dual-save temporariamente |

## Métricas de Sucesso

- [ ] 100% dos feeds migrados sem perda
- [ ] Tempo de consulta < 100ms
- [ ] Zero downtime durante migração
- [ ] Redução de 90% no espaço em disco

## Status Atual

**Fase Atual**: Testes
**Próxima Ação**: Testar criação de novos feeds no banco
**Última Atualização**: 2025-06-13 15:47
