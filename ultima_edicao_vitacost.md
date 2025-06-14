## 2025-06-14 - Correções no Vitacost Provider

### Problemas Identificados (mesmos do Home Depot)

1. **Cancelamento não funcionava corretamente**
   - Verificação apenas no loop principal
   - Promises continuavam executando após cancelamento
   - Não limpava tarefas pendentes da queue

2. **SKU Problem não atualizava campo `atualizado`**
   - Produtos com erro permaneciam com `atualizado = 0`
   - Phase 2 tentaria processar produtos problemáticos

3. **Processamento sequencial desnecessário**
   - Usava `await queue.add()` que bloqueava até terminar
   - Não aproveitava paralelismo da queue

### Correções Aplicadas

#### 1. Melhorado Cancelamento (executePhase1)
- Adicionada variável `isCancelled` para rastrear estado
- Verificação de cancelamento dentro de cada promise
- Limpeza de tarefas pendentes com `queue.clear()`
- Retorno de status `cancelled` quando apropriado

#### 2. Processamento Paralelo
- Removido `await` do `queue.add()`
- Coleta todas as promises em array
- `await Promise.all(promises)` no final
- Melhor performance e resposta ao cancelamento

#### 3. Correção do SKU Problem
```javascript
// Antes:
SET sku_problem = true

// Depois:
SET sku_problem = true, atualizado = $2, last_update = NOW()
```

### Arquivos Modificados
- `backend/src/providers/vitacost-provider.js`
  - Linha ~424-477: Refatorado loop de processamento
  - Linha ~490: Adicionado log de cancelamento
  - Linha ~510: Retorno com status de cancelamento
  - Linha ~573: Atualiza `atualizado` ao marcar problema

### Resultado Esperado
- Cancelamento funciona imediatamente ao clicar "Parar"
- Produtos problemáticos são marcados corretamente
- Melhor performance com processamento paralelo
- Consistência com implementação do Home Depot
