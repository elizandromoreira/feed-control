## 2025-06-14 - Correção: SKU Problem não estava sendo marcado corretamente

### Problema Identificado
- Sincronização reportava 388 falhas mas apenas 10 produtos tinham `sku_problem = true`
- Produtos com erro não estavam sendo marcados com `atualizado = 1`
- Isso causava discrepância entre logs e banco de dados

### Análise do Banco
```sql
-- Produtos Home Depot com sku_problem
SELECT COUNT(*) FILTER (WHERE sku_problem = true) as total_sku_problems
FROM produtos WHERE source = 'Home Depot';
-- Resultado: 10 (deveria ser ~388)

-- Produtos por flag atualizado
SELECT atualizado, COUNT(*) 
FROM produtos WHERE source = 'Home Depot' 
GROUP BY atualizado;
-- Resultado: 
-- atualizado=0: 15,428 produtos
-- atualizado=1: 1,977 produtos
```

### Causa Raiz
Quando um produto falhava (não encontrado na API), o código apenas atualizava `sku_problem = true` mas não atualizava o campo `atualizado`, fazendo com que o produto permanecesse com `atualizado = 0`.

### Solução Implementada

**Arquivo: `backend/src/providers/home-depot-provider.js`**

Antes:
```javascript
await this.dbService.executeWithRetry(
    'UPDATE produtos SET sku_problem = true WHERE sku = $1',
    [product.sku]
);
```

Depois:
```javascript
await this.dbService.executeWithRetry(
    'UPDATE produtos SET sku_problem = true, atualizado = $2, last_update = NOW() WHERE sku = $1',
    [product.sku, this.updateFlagValue]
);
```

### Mudanças Aplicadas
1. Linha ~434: Atualiza `atualizado` quando marca erro genérico
2. Linha ~445: Atualiza `atualizado` quando produto não encontrado
3. Adiciona `last_update = NOW()` para rastrear quando foi marcado

### Resultado Esperado
- Produtos com falha agora serão marcados com:
  - `sku_problem = true`
  - `atualizado = 1` (ou valor atual de updateFlagValue)
  - `last_update` atualizado
- Contagem de falhas nos logs deve corresponder aos produtos com `sku_problem = true`
- Phase 2 não tentará processar produtos já marcados com problema
