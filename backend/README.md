# Feed Control - Sistema Modular de Sincronização

Este sistema sincroniza dados de produtos entre fornecedores externos, o banco de dados interno e a Amazon Seller API. O sistema foi projetado para ser modular, permitindo a adição de novos fornecedores sem precisar modificar o código existente.

## Arquitetura

O sistema opera em duas fases principais:

1. **Phase 1**: Busca de dados do fornecedor e comparação (diff) com o banco interno
2. **Phase 2**: Envio de atualizações para a Amazon Seller API

A arquitetura foi refatorada utilizando os seguintes padrões de design:

- **Interface de Provedor**: Define um contrato claro para implementação de fornecedores
- **Factory Pattern**: Gerencia a criação e registro de fornecedores
- **Strategy Pattern**: Cada fornecedor implementa sua própria estratégia para Phase1 e Phase2
- **Adapter Pattern**: O código existente foi adaptado para a nova arquitetura sem modificações substanciais

## Estrutura de Diretórios

```
backend/
  ├── src/
  │   ├── providers/                  # Módulos de fornecedores (novo)
  │   │   ├── provider-interface.js   # Interface base para todos os fornecedores 
  │   │   ├── provider-factory.js     # Factory para gerenciar fornecedores
  │   │   ├── home-depot-provider.js  # Implementação para Home Depot
  │   │   └── [other-provider].js     # Implementações para outros fornecedores
  │   │
  │   ├── sync/                       # Serviços de sincronização (novo)
  │   │   └── sync-service.js         # Serviço que conecta a loja ao provider
  │   │
  │   ├── phases/                     # Implementação das fases (existente)
  │   │   ├── phase1.js               # Implementação da Phase 1 (mantida)
  │   │   └── phase2.js               # Implementação da Phase 2 (mantida)
  │   │
  │   ├── services/                   # Serviços (existente)
  │   │   ├── homeDepotApi.js         # Serviço de API Home Depot (mantido)
  │   │   ├── amazonApi.js            # Serviço de API Amazon (mantido)
  │   │   ├── database.js             # Serviço de banco de dados (mantido)
  │   │   └── storeManager.js         # Gerenciador de lojas (mantido)
  │   │
  │   ├── models/                     # Modelos de dados (existente)
  │   │   ├── Store.js                # Modelo de loja (mantido)
  │   │   └── DBProduct.js            # Modelo de produto (mantido)
  │   │
  │   ├── config/                     # Configurações (existente)
  │   │   ├── db.js                   # Configuração do banco (mantida)
  │   │   ├── logging.js              # Configuração de logs (mantida)
  │   │   └── constants.js            # Constantes (mantida)
  │   │
  └── index.js                        # Ponto de entrada (modificado)
```

## Como Adicionar um Novo Fornecedor

### 1. Criar Implementação do Fornecedor

Crie um novo arquivo em `src/providers/` seguindo o padrão `nome-do-fornecedor-provider.js`. O arquivo deve implementar a interface `BaseProvider`:

```javascript
const BaseProvider = require('./provider-interface');

class NovoFornecedorProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    // Inicialização específica do fornecedor
  }

  // Implementação obrigatória dos métodos da interface
  getId() {
    return 'id-do-fornecedor';
  }

  getName() {
    return 'Nome do Fornecedor';
  }

  getApiService() {
    // Retornar serviço de API para este fornecedor
  }

  async executePhase1(skipProblematic, requestsPerSecond, checkCancellation, updateProgress) {
    // Implementação da Phase 1 específica para este fornecedor
  }

  async executePhase2(batchSize, checkInterval, checkCancellation, updateProgress) {
    // Implementação da Phase 2 específica para este fornecedor
  }

  getPhase2Queries() {
    // Retornar queries SQL específicas para Phase 2
    return {
      extractUpdatedData: `SELECT ... FROM produtos WHERE atualizado = 1 AND source = 'NomeFornecedor'`,
      resetUpdatedProducts: `UPDATE produtos SET atualizado = 0 WHERE atualizado = 1 AND source = 'NomeFornecedor'`
    };
  }

  async resetUpdatedProducts() {
    // Implementação para resetar produtos atualizados
  }
}

module.exports = NovoFornecedorProvider;
```

### 2. Registrar o Fornecedor no Factory

Edite o arquivo `src/providers/provider-factory.js` para registrar o novo fornecedor:

```javascript
const HomeDepotProvider = require('./home-depot-provider');
const NovoFornecedorProvider = require('./novo-fornecedor-provider');

class ProviderFactory {
  registerDefaultProviders() {
    // Registrar providers existentes
    this.registerProvider('homedepot', HomeDepotProvider);
    
    // Registrar novo provider
    this.registerProvider('novo-fornecedor', NovoFornecedorProvider);
  }
  
  // ... restante do código não alterado
}
```

### 3. (Opcional) Criar Serviço de API para o Fornecedor

Se o fornecedor necessitar de um serviço de API dedicado, crie um novo arquivo em `src/services/` seguindo o padrão `novoFornecedorApi.js`:

```javascript
class NovoFornecedorApiService {
  constructor(baseUrl, requestsPerSecond) {
    this.baseUrl = baseUrl;
    this.requestsPerSecond = requestsPerSecond;
  }

  async fetchProductDataWithRetry(sku) {
    // Implementação para buscar dados do produto na API do fornecedor
  }

  // Outros métodos conforme necessário
}

module.exports = NovoFornecedorApiService;
```

### 4. Adicionar o Fornecedor na Lista de Lojas

Para que o novo fornecedor seja visível na interface, adicione-o ao arquivo `src/models/Store.js`:

```javascript
const defaultStores = [
  new Store('homedepot', 'Home Depot', 'http://api.homedepot.com', 'Inativo', 4),
  // ... outras lojas existentes
  new Store('novo-fornecedor', 'Nome do Fornecedor', 'http://api.novofornecedor.com', 'Inativo', 4)
];
```

## Testes

Recomenda-se criar testes unitários para cada novo fornecedor. Os testes devem verificar:

1. Capacidade de buscar dados da API do fornecedor
2. Processamento correto dos dados no formato esperado pelo banco
3. Geração correta dos feeds para a Amazon
4. Comportamento adequado em caso de erros

## Execução

Para executar a sincronização com um fornecedor específico:

```bash
node index.js --provider nome-do-fornecedor
```

Para executar apenas uma fase específica:

```bash
node index.js --provider nome-do-fornecedor --phase 1
```

## Notas de Implementação

1. Mantenha a compatibilidade com o código existente da Home Depot
2. Cada fornecedor deve definir suas próprias queries SQL e transformação de dados
3. Utilize variáveis de ambiente específicas para cada fornecedor (ex: FORNECEDOR_API_BASE_URL)
4. Isole completamente a lógica específica de cada fornecedor em seu respectivo módulo

## Manutenção

Ao fazer alterações que afetam todos os fornecedores:

1. Modifique a interface `BaseProvider` para adicionar novos métodos, com implementações default quando possível
2. Atualize a documentação com os novos requisitos
3. Garanta que as alterações não quebrem os fornecedores existentes 