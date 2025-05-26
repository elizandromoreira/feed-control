# Instruções para Correções do Feed Control

Este guia apresenta as correções para os dois problemas identificados:
1. Timer não inicia a sincronização quando chega a zero
2. Problemas no carregamento das variáveis de ambiente do arquivo `.env.production`

## Arquivos Modificados

### Frontend
- `frontend/src/components/NextSyncTimer.tsx`

### Backend
- `backend/index.js`
- `backend/start-production.sh`
- `backend/package.json`

## Detalhes das Correções

### Problema 1: Timer não inicia a sincronização

1. **Adicionamos uma função `startSync()` no componente NextSyncTimer.tsx**:
   - Esta função faz uma chamada POST para o endpoint `/api/stores/${storeId}/start-sync`
   - É chamada automaticamente quando o timer chega a zero

2. **Implementamos o endpoint `/api/stores/:storeId/start-sync` no backend**:
   - O endpoint recebe o ID da loja
   - Inicia o processo de sincronização assincronamente
   - Adiciona logs para monitoramento

### Problema 2: Carregamento do arquivo .env.production

1. **Modificamos a função `ensureEnvConfigLoaded()` para**:
   - Verificar se está em ambiente de produção através de `process.env.NODE_ENV`
   - Usar o arquivo `.env.production` em produção ou `.env` em desenvolvimento
   - Adicionar logs para facilitar o diagnóstico

2. **Atualizamos o script `start-production.sh` para**:
   - Definir explicitamente `NODE_ENV=production`
   - Verificar a existência do arquivo `.env.production`
   - Carregar variáveis de ambiente de forma mais segura usando `source`
   - Verificar variáveis críticas antes de iniciar a aplicação

3. **Adicionamos scripts no `package.json` para**:
   - Facilitar o início da aplicação em modo de produção
   - Permitir iniciar com diferentes configurações (web, cron, ou ambos)

## Como Implementar na Produção

Para implementar essas alterações no servidor de produção, siga os passos abaixo:

1. **Envie os arquivos modificados para o servidor**:
   ```bash
   # Conecte-se ao servidor
   ssh root@167.114.223.83
   
   # Crie um backup dos arquivos antes de modificá-los
   cd /opt/feed-control
   cp index.js index.js.bak
   cp start-production.sh start-production.sh.bak
   cp package.json package.json.bak
   
   cd /opt/feed-control-frontend/src/components
   cp NextSyncTimer.tsx NextSyncTimer.tsx.bak
   
   # Saia do servidor
   exit
   
   # Envie os arquivos atualizados
   scp backend/index.js root@167.114.223.83:/opt/feed-control/
   scp backend/start-production.sh root@167.114.223.83:/opt/feed-control/
   scp backend/package.json root@167.114.223.83:/opt/feed-control/
   scp frontend/src/components/NextSyncTimer.tsx root@167.114.223.83:/opt/feed-control-frontend/src/components/
   ```

2. **Configure permissões e reinicie a aplicação**:
   ```bash
   # Conecte-se ao servidor
   ssh root@167.114.223.83
   
   # Configure permissões
   cd /opt/feed-control
   chmod +x start-production.sh
   
   # Reinicie a aplicação
   pm2 restart feed-control
   
   # Verifique os logs
   pm2 logs feed-control
   ```

3. **Teste as alterações**:
   - Acesse o frontend da aplicação
   - Verifique se o timer está funcionando corretamente
   - Quando o timer chegar a zero, ele deve iniciar a sincronização automaticamente
   - Verifique os logs para confirmar que está carregando o arquivo `.env.production` 