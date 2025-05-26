# Feed Control System

Sistema de controle de feeds para múltiplas lojas online, desenvolvido com React (frontend) e Node.js (backend).

## 📋 Descrição

O Feed Control System é uma aplicação completa para gerenciar e sincronizar produtos de diferentes lojas online. O sistema suporta múltiplos provedores como Home Depot, Best Buy, Vitacost, WebstaurantStore, WhiteCap e Zoro.

## 🚀 Tecnologias Utilizadas

### Frontend
- React 19.0.0
- TypeScript
- Tailwind CSS
- Axios para requisições HTTP

### Backend
- Node.js
- Express.js
- PostgreSQL
- Winston para logging
- Puppeteer para web scraping
- Axios para requisições HTTP

## 📁 Estrutura do Projeto

```
feed_control/
├── frontend/                 # Aplicação React
│   ├── src/
│   │   ├── components/      # Componentes React
│   │   ├── App.tsx         # Componente principal
│   │   └── index.tsx       # Ponto de entrada
│   ├── public/             # Arquivos públicos
│   └── package.json        # Dependências do frontend
├── backend/                 # API Node.js
│   ├── src/
│   │   ├── config/         # Configurações
│   │   ├── models/         # Modelos de dados
│   │   ├── phases/         # Fases de processamento
│   │   ├── providers/      # Provedores de lojas
│   │   ├── services/       # Serviços
│   │   └── utils/          # Utilitários
│   ├── data/               # Dados de configuração
│   └── package.json        # Dependências do backend
└── deploy_scripts/         # Scripts de deploy
```

## 🛠️ Instalação e Configuração

### Pré-requisitos
- Node.js (versão 18 ou superior)
- PostgreSQL
- Git

### 1. Clone o repositório
```bash
git clone https://github.com/elizandromoreira/feed-control.git
cd feed-control
```

### 2. Configuração do Backend
```bash
cd backend
npm install
```

Crie um arquivo `.env` baseado no `.env.example`:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=feed_control
DB_USER=seu_usuario
DB_PASSWORD=sua_senha
NODE_ENV=development
PORT=3001
```

### 3. Configuração do Frontend
```bash
cd frontend
npm install
```

### 4. Configuração do Banco de Dados
Execute os scripts SQL necessários para criar as tabelas no PostgreSQL.

## 🚀 Execução

### Desenvolvimento Local

#### Backend
```bash
cd backend
npm start
```
O backend estará disponível em `http://localhost:3001`

#### Frontend
```bash
cd frontend
npm start
```
O frontend estará disponível em `http://localhost:3000`

### Produção

#### Build do Frontend
```bash
cd frontend
npm run build
```

#### Deploy
Use os scripts de deploy disponíveis na raiz do projeto:
```bash
./deploy_frontend_server.sh
```

## 📊 Funcionalidades

### Dashboard Principal
- Visualização de todas as lojas configuradas
- Status de sincronização em tempo real
- Métricas de produtos processados

### Gerenciamento de Lojas
- Configuração de múltiplos provedores
- Configurações específicas por loja
- Monitoramento de status

### Processamento de Feeds
- **Phase 1**: Coleta de dados dos produtos
- **Phase 2**: Processamento e validação
- Sistema de retry para falhas
- Logging detalhado

### Provedores Suportados
- **Home Depot**: Produtos de casa e construção
- **Best Buy**: Eletrônicos e tecnologia
- **Vitacost**: Produtos de saúde e bem-estar
- **WebstaurantStore**: Equipamentos para restaurantes
- **WhiteCap**: Ferramentas e equipamentos
- **Zoro**: Suprimentos industriais

## 🔧 Configuração de Provedores

Cada provedor possui configurações específicas que podem ser ajustadas através da interface web:

### Exemplo de Configuração
```json
{
  "storeId": "571890020192",
  "name": "Home Depot Store",
  "provider": "home-depot",
  "config": {
    "baseUrl": "https://www.homedepot.com",
    "maxRetries": 3,
    "timeout": 30000
  }
}
```

## 📝 Logs

O sistema mantém logs detalhados de todas as operações:
- Logs de sincronização
- Logs de erro
- Logs de performance
- Logs de produtos processados

## 🔄 Deploy

### Servidor de Produção
O sistema está configurado para deploy em servidor Linux com Nginx:

1. **Build do Frontend**: Gera arquivos estáticos
2. **Upload para Servidor**: Copia arquivos via SCP
3. **Configuração do Nginx**: Serve arquivos estáticos
4. **Restart dos Serviços**: Reinicia Nginx e aplicação

### Scripts de Deploy
- `deploy_frontend_server.sh`: Deploy completo do frontend
- `deploy-full.sh`: Deploy completo (frontend + backend)
- `update-server.sh`: Atualização do servidor

## 🐛 Troubleshooting

### Problemas Comuns

1. **Erro de Conexão com Banco**
   - Verifique as credenciais no arquivo `.env`
   - Confirme se o PostgreSQL está rodando

2. **Timeout nas Requisições**
   - Ajuste o valor de timeout nas configurações
   - Verifique a conectividade com os provedores

3. **Falhas no Deploy**
   - Verifique as permissões SSH
   - Confirme se o Nginx está configurado corretamente

## 📈 Monitoramento

O sistema inclui:
- Dashboard de métricas em tempo real
- Alertas para falhas de sincronização
- Relatórios de performance
- Logs estruturados para análise

## 🤝 Contribuição

1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📄 Licença

Este projeto está sob a licença MIT. Veja o arquivo `LICENSE` para mais detalhes.

## 📞 Contato

Elizandro Moreira - elizandromoreira@example.com

Link do Projeto: [https://github.com/elizandromoreira/feed-control](https://github.com/elizandromoreira/feed-control)

## 🙏 Agradecimentos

- Equipe de desenvolvimento
- Comunidade open source
- Provedores de APIs utilizadas 