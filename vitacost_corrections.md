# Correções do Provider Vitacost (13/06/2025)

## Problemas Identificados e Corrigidos:

### 1. **Uso Incorreto de SKU vs SKU2**
- **Problema**: Provider estava usando `sku2` (formato "SEVC658010120623") para fazer requisições à API
- **Correção**: Mudado para usar `sku` (formato "658010120623") para API e manter `sku2` apenas para operações no banco

```javascript
// Antes (incorreto)
const apiData = await this._fetchProductData(sku2);

// Depois (correto)
const { sku, sku2 } = product;
const apiData = await this._fetchProductData(sku);
```

### 2. **URL da API Incorreta**
- **Problema**: Provider usando `http://localhost:${this.port}/api/vitacost/product/${sku}`
- **Correção**: Usar a URL correta da API externa

```javascript
// Antes
`http://localhost:${this.port}/api/vitacost/product/${sku}`

// Depois
`${this.apiBaseUrl}/${sku}` // http://167.114.223.83:3005/vc/658010120623
```

### 3. **Acesso Incorreto aos Dados da API**
- **Problema**: API retorna dados dentro de `data` mas código acessava diretamente
- **Correção**: Extrair dados do objeto correto

```javascript
// Estrutura da API:
{
  "success": true,
  "data": {
    "brand": "Garden of Life",
    "price": "$42.69",
    "status": "OK"
  }
}

// Correção implementada:
const productData = apiData.data || apiData;
// Agora usa productData.price, productData.brand, etc.
```

### 4. **Sistema de Retry Robusto**
- Implementado retry manual com 3 tentativas
- Delay de 2 segundos entre tentativas
- Logs detalhados para debug
- Marca produtos problemáticos quando falha

### 5. **Respeito às Configurações do Banco**
Todas as configurações agora vêm do banco de dados:
- **OMD Handling Time**: 2 dias
- **Provider Handling Time**: 3 dias
- **Stock Level**: 15 unidades
- **Requests Per Second**: 6
- **Update Flag**: 2

### 6. **Fluxo de Atualização de Preços**
1. **Busca preço atual**: Do banco de dados (`supplier_price`)
2. **Busca novo preço**: Da API Vitacost
3. **Compara**: Se diferente, marca para atualização
4. **Atualiza**: Salva novo preço no banco

## Logs de Exemplo (Funcionamento Correto):
```
00:57:11 - info [vitacost] - === Product Update: SEVC658010120623 ===
00:57:11 - info [vitacost] -   ✓ price: $40.00 → $42.69
00:57:11 - info [vitacost] -   ✓ quantity: 5 → 15
00:57:11 - info [vitacost] -   ✓ availability: outOfStock → inStock
00:57:11 - info [vitacost] -   ✓ brand: "" → "Garden of Life"
```

## Limite de 29 Dias para Handling Time
- **Regra de Negócio da Amazon**: Tempo máximo de manuseio é 29 dias
- Todos os providers aplicam essa regra automaticamente
- Se `handlingTimeAmz > 29`, sistema limita para 29 e gera warning

## Arquivos Modificados:
- `/backend/src/providers/vitacost-provider.js`
  - `processProduct`: Usa `sku` para API, `sku2` para banco
  - `_fetchProductData`: URL correta da API
  - `_transformProductData`: Acesso correto aos dados dentro de `data`
  - `updateProductInDb`: Comparação e atualização de preços
