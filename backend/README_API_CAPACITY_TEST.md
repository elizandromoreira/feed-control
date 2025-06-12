# Script de Teste de Capacidade de API

Este script genérico permite testar a capacidade de qualquer endpoint de API para descobrir a configuração ideal de requisições por segundo (RPS).

## Como Usar

### 1. Teste Básico (Best Buy - configuração padrão)
```bash
cd backend
node test_api_capacity.js
```

### 2. Teste com API específica
```bash
node test_api_capacity.js bestbuy
node test_api_capacity.js homedepot
```

### 3. Adicionar Nova API

Para testar uma nova API, edite o arquivo `test_api_capacity.js` e adicione uma nova configuração no objeto `API_CONFIGS`:

```javascript
const API_CONFIGS = {
    // ... configurações existentes ...
    
    minha_nova_api: {
        name: 'Minha Nova API',
        baseUrl: 'https://api.exemplo.com/v1',
        testEndpoints: [
            'produto/123',
            'produto/456', 
            'produto/789'
            // Adicione mais endpoints para teste
        ],
        validateResponse: (response) => {
            // Defina como validar se a resposta é válida
            return response.status === 200 && response.data?.success === true;
        },
        headers: {
            'User-Agent': 'CapacityTest/1.0',
            'Authorization': 'Bearer SEU_TOKEN', // Se necessário
            'Accept': 'application/json'
        },
        timeout: 15000 // Timeout em milissegundos
    }
};
```

## Configuração Detalhada

### Parâmetros da Configuração

- **name**: Nome da API (para exibição nos logs)
- **baseUrl**: URL base da API (sem barra final)
- **testEndpoints**: Array de endpoints para teste (serão concatenados com baseUrl)
- **validateResponse**: Função que determina se uma resposta é válida
- **headers**: Headers HTTP customizados para as requisições
- **timeout**: Timeout em milissegundos para cada requisição

### Função validateResponse

Esta função recebe o objeto `response` do axios e deve retornar `true` se a resposta for válida:

```javascript
// Exemplo para API que retorna { success: true, data: {...} }
validateResponse: (response) => {
    return response.status === 200 && 
           response.data && 
           response.data.success === true;
}

// Exemplo para API que retorna { status: "ok", result: {...} }
validateResponse: (response) => {
    return response.status === 200 && 
           response.data?.status === "ok";
}

// Exemplo para API simples que só precisa de status 200
validateResponse: (response) => {
    return response.status === 200;
}
```

## O Que o Script Testa

### 1. Teste de RPS Progressivo
- Testa diferentes valores de RPS: 1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20
- Para automaticamente se a taxa de sucesso cair abaixo de 50%
- Mede taxa de sucesso, tempo de resposta e timeouts

### 2. Padrões de Requisição
- **Burst**: Envia todas as requisições do lote simultaneamente
- **Distribuído**: Espaça as requisições uniformemente ao longo do tempo

### 3. Métricas Coletadas
- Taxa de sucesso (%)
- Tempo de resposta (médio, mínimo, máximo)
- Número de timeouts
- Número de falhas
- Recomendações automáticas

## Interpretação dos Resultados

### Símbolos nos Resultados
- ✅ **Verde**: Taxa de sucesso ≥ 95% (Excelente)
- ⚠️ **Amarelo**: Taxa de sucesso ≥ 80% (Aceitável)
- ❌ **Vermelho**: Taxa de sucesso < 80% (Problemático)

### Recomendações
- **RPS IDEAL**: Maior RPS com ≥98% de sucesso
- **RPS CONSERVADOR**: Maior RPS com ≥90% de sucesso

### Arquivo de Relatório
O script gera um arquivo JSON com todos os resultados:
```
capacity_test_best_buy_2024-01-15T10-30-00-000Z.json
```

## Exemplos de Uso

### Para E-commerce (Best Buy, Home Depot, etc.)
```javascript
ecommerce_api: {
    name: 'E-commerce API',
    baseUrl: 'https://api.loja.com/products',
    testEndpoints: ['12345', '67890', '11111'], // SKUs
    validateResponse: (response) => response.status === 200 && response.data?.available !== undefined,
    headers: { 'API-Key': 'sua-chave-aqui' },
    timeout: 10000
}
```

### Para API REST Genérica
```javascript
rest_api: {
    name: 'REST API',
    baseUrl: 'https://api.exemplo.com/v1',
    testEndpoints: ['users/1', 'users/2', 'posts/1'], // Endpoints diversos
    validateResponse: (response) => response.status === 200,
    headers: { 'Content-Type': 'application/json' },
    timeout: 5000
}
```

### Para API com Autenticação
```javascript
auth_api: {
    name: 'API com Auth',
    baseUrl: 'https://secure-api.com',
    testEndpoints: ['data/1', 'data/2', 'data/3'],
    validateResponse: (response) => response.status === 200 && !response.data?.error,
    headers: { 
        'Authorization': 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...',
        'Content-Type': 'application/json'
    },
    timeout: 8000
}
```

## Dicas de Uso

1. **Escolha endpoints representativos**: Use endpoints que sejam similares aos que você usará em produção
2. **Teste em horários diferentes**: A capacidade pode variar conforme a carga do servidor
3. **Considere a latência de rede**: Teste de locais diferentes se necessário
4. **Monitore o servidor**: Observe o uso de CPU/memória do servidor durante os testes
5. **Comece conservador**: Use o RPS conservador em produção e aumente gradualmente

## Solução de Problemas

### Muitos Timeouts
- Aumente o valor de `timeout`
- Reduza o RPS testado
- Verifique a conectividade de rede

### Taxa de Sucesso Baixa
- Verifique se a função `validateResponse` está correta
- Confirme se os endpoints de teste são válidos
- Verifique se os headers de autenticação estão corretos

### Erro de Conexão
- Confirme se a `baseUrl` está correta
- Verifique se a API está acessível
- Teste manualmente com curl primeiro

## Integração com o Sistema

Após descobrir o RPS ideal, use-o na configuração da loja:

```javascript
// No frontend ou via API
{
    "requests_per_second": 5, // Use o valor descoberto pelo teste
    "batch_size": 100,
    // ... outras configurações
}
``` 