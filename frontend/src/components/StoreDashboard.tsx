import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import ProviderConfigFactory from './providers/ProviderConfigFactory';

// URL da API do Node.js para a Home Depot Sync
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:7005/api';

interface Config {
  stockLevel: number;
  batchSize: number;
  requestsPerSecond: number;
  handlingTimeOmd: number;
  homeDepotHandlingTime: number;
  whiteCapHandlingTime: number;
  vitacostHandlingTime: number;
  bestbuyHandlingTime: number;
  webstaurantstoreHandlingTime: number;
  updateFlagValue: number;
}

interface StoreDetails {
  id: string;
  name: string;
  status: string;
  lastSync: string | null;
  scheduleInterval: number;
}

// Interface para os logs retornados pela API
interface LogEntry {
  file: string;
  count: number;
  path: string;
  date: string;
}

// Interface para informações de progresso
interface ProgressInfo {
  totalProducts: number;
  processedProducts: number;
  successCount: number;
  failCount: number;
  percentage: number;
  isRunning: boolean;
  currentBatch?: number;
  totalBatches?: number;
  errors?: string[];
  error?: string;
  lastUpdateTime?: string;
  phase?: number;
  status?: string;
  reportJson?: any;
  completed?: boolean;
}

interface ProgressData {
  totalProducts: number;
  processedProducts: number;
  successCount: number;
  failCount: number;
  percentage: number;
  isRunning: boolean;
  currentBatch?: number;
  totalBatches?: number;
  errors?: string[];
  error?: string;
  lastUpdateTime?: string;
  phase?: number;
  status?: string;
  reportJson?: any;
  completed?: boolean;
}

export const StoreDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [store, setStore] = useState<StoreDetails | null>(null);
  const [status, setStatus] = useState<'running' | 'stopped'>('stopped');
  const [lastRunTime, setLastRunTime] = useState<string>('');
  // Inicializar com valores vazios que serão preenchidos pela API
  const [config, setConfig] = useState<Config>({
    stockLevel: 0,
    batchSize: 0,
    requestsPerSecond: 0,
    handlingTimeOmd: 0,
    homeDepotHandlingTime: 0,
    whiteCapHandlingTime: 0,
    vitacostHandlingTime: 0,
    bestbuyHandlingTime: 0,
    webstaurantstoreHandlingTime: 0,
    updateFlagValue: 0
  });
  // Atualizar o tipo para suportar tanto strings (simulação) quanto objetos LogEntry
  const [logs, setLogs] = useState<(string | LogEntry)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Novo estado para o progresso
  const [progress, setProgress] = useState<ProgressInfo | null>(null);
  const [progressPolling, setProgressPolling] = useState<NodeJS.Timeout | null>(null);
  
  // Novo estado para rastrear se o agendamento está ativo
  const [isScheduleActive, setIsScheduleActive] = useState<boolean>(false);

  // Estado para controlar o número de erros consecutivos
  const [consecutiveErrors, setConsecutiveErrors] = useState<number>(0);
  // Estado para controlar o intervalo de polling (em ms)
  const [pollingInterval, setPollingInterval] = useState<number>(60000); // Intervalo de polling aumentado para 60 segundos

  // Estado para controlar mensagens de erro de servidor
  const [serverError, setServerError] = useState<string>('');

  // Função para buscar detalhes da loja
  const fetchStoreDetails = async () => {
    try {
      // Buscar detalhes da loja
      const storeResponse = await axios.get(`${API_URL}/stores`);
      const storeData = storeResponse.data.find((s: any) => s.id === id);
      
      if (!storeData) {
        setError(`Loja com ID ${id} não encontrada`);
        setLoading(false);
        return;
      }
      
      setStore({
        id: storeData.id,
        name: storeData.name,
        status: storeData.status,
        lastSync: storeData.lastSync,
        scheduleInterval: storeData.scheduleInterval || 4
      });
      
      // Definir status para o componente
      setStatus(storeData.status === 'Ativo' || storeData.status === 'Executando' ? 'running' : 'stopped');
      
      // Definir data da última sincronização
      if (storeData.lastSync) {
        setLastRunTime(storeData.lastSync);
      }
      
      // Buscar configurações da loja
      try {
        const configResponse = await axios.get(`${API_URL}/stores/${id}/config`);
        if (configResponse.data) {
          setConfig(configResponse.data);
        }
      } catch (configError) {
        console.error('Erro ao buscar configurações:', configError);
      }
      
      // Verificar se existe um agendamento ativo
      try {
        const scheduleResponse = await axios.get(`${API_URL}/stores/${id}/schedule/status`);
        setIsScheduleActive(scheduleResponse.data.active);
      } catch (scheduleError) {
        console.error('Erro ao verificar status do agendamento:', scheduleError);
      }
      
      // Buscar logs da loja
      try {
        const logsResponse = await axios.get(`${API_URL}/stores/${id}/logs`);
        if (logsResponse.data && Array.isArray(logsResponse.data)) {
          setLogs(logsResponse.data);
        }
      } catch (logsError) {
        console.error('Erro ao buscar logs:', logsError);
      }
      
      // Buscar progresso atual
      try {
        const progressResponse = await axios.get(`${API_URL}/stores/${id}/progress`);
        if (progressResponse.data) {
          setProgress(progressResponse.data);
        }
      } catch (progressError) {
        console.error('Erro ao buscar progresso:', progressError);
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Erro ao buscar detalhes da loja:', error);
      setError('Erro ao buscar detalhes da loja');
      setLoading(false);
    }
  };

  // Iniciar polling para atualizar o progresso
  const startProgressPolling = () => {
    // Limpar qualquer intervalo existente primeiro
    if (progressPolling) {
      clearInterval(progressPolling);
      setProgressPolling(null);
    }
    
    // Buscar o progresso imediatamente
    fetchProgressData();
    
    // Verificar se já existem erros acumulados, se sim, não iniciar polling automático
    if (consecutiveErrors > 2) {
      console.log('Muitos erros consecutivos, polling desativado. Use o botão "Atualizar status" para verificar manualmente.');
      return;
    }
    
    // Usar um intervalo muito maior (30 segundos) para reduzir drasticamente a carga no servidor
    const intervalId = setInterval(fetchProgressData, pollingInterval); // 60 segundos
    
    setProgressPolling(intervalId);
  };
  
  // Função para atualização manual do status
  const handleManualRefresh = () => {
    // Limpar os erros consecutivos para dar uma chance de reiniciar o polling automático
    setConsecutiveErrors(0);
    setPollingInterval(60000); // Reset para 60 segundos
    
    // Buscar dados manualmente
    fetchProgressData();
  };
  
  // Função separada para buscar os dados de progresso
  const fetchProgressData = async () => {
    try {
      // Limpar qualquer mensagem de erro anterior
      setServerError('');
      
      const response = await axios.get(`${API_URL}/stores/${id}/progress`, {
        // Adicionar timestamp para evitar cache
        params: { _t: new Date().getTime() },
        // Adicionar timeout para evitar que requisições fiquem pendentes por muito tempo
        timeout: 15000 // Aumentar timeout para 15 segundos
      });
      
      if (response.data) {
        setProgress(response.data);
        // Resetar contador de erros consecutivos quando a requisição for bem-sucedida
        if (consecutiveErrors > 0) {
          setConsecutiveErrors(0);
        }
      }
      
      // Se a sincronização não estiver mais em execução, buscar logs atualizados
      if (response.data && !response.data.isRunning && status === 'running') {
        const logsResponse = await axios.get(`${API_URL}/stores/${id}/logs`);
        
        if (logsResponse.data) {
          setLogs(logsResponse.data);
          setStatus('stopped');
        }
      }
    } catch (error: any) {
      // Verificar o tipo de erro para exibir mensagem apropriada
      let errorMessage = 'Erro ao conectar com o servidor';
      
      if (error.code === 'ECONNABORTED') {
        errorMessage = 'O servidor está demorando para responder. Isso pode ocorrer durante sincronizações com muitos produtos.';
      } else if (error.message === 'Network Error') {
        errorMessage = 'Erro de conexão com o servidor. Verifique se o servidor está online.';
      } else if (error.response) {
        errorMessage = `Erro ${error.response.status}: ${error.response.data.message || 'Erro desconhecido'}`;
      }
      
      // Definir a mensagem de erro para ser exibida na interface
      setServerError(errorMessage);
      
      console.error(`[ERROR] Erro ao buscar progresso para ${id}:`, error);
      
      // Incrementar contador de erros consecutivos
      const newErrorCount = consecutiveErrors + 1;
      setConsecutiveErrors(newErrorCount);
      
      // Se tivermos erros consecutivos, parar o polling completamente
      if (newErrorCount >= 3) {
        if (progressPolling) {
          clearInterval(progressPolling);
          setProgressPolling(null);
        }
      }
    }
  };

  const MAX_RETRIES = 3;
  const INITIAL_RETRY_DELAY = 5000; // 5 segundos de delay inicial para retry

  // Função para buscar progresso com retry
  const fetchProgressWithRetry = async (retries = 0): Promise<ProgressData | null> => {
    try {
      const response = await axios.get(`${API_URL}/stores/${id}/progress?_t=${Date.now()}`, { timeout: 30000 });
      const data = response.data as ProgressData;
      setConsecutiveErrors(0);
      return data;
    } catch (error) {
      console.error('[ERROR] Erro ao buscar progresso para', id, ':', error);
      if (retries < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, retries); // Backoff exponencial
        console.log(`[RETRY] Tentando novamente em ${delay/1000} segundos... (Tentativa ${retries + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchProgressWithRetry(retries + 1);
      } else {
        setConsecutiveErrors(prev => {
          const newErrors = prev + 1;
          if (newErrors >= 2 && progressPolling) {
            clearInterval(progressPolling);
            setProgressPolling(null);
            console.log('Muitos erros consecutivos, polling desativado. Use o botão "Atualizar status" para verificar manualmente.');
          }
          return newErrors;
        });
        return null;
      }
    }
  };

  // Função para iniciar o polling de progresso
  const startProgressPollingWithRetry = () => {
    if (progressPolling) return;
    console.log('[POLLING] Iniciando polling de progresso para', id);
    const interval = setInterval(async () => {
      console.log('[POLLING] Buscando progresso para', id);
      const data = await fetchProgressWithRetry();
      if (data) {
        setProgress(data);
      }
    }, pollingInterval);
    setProgressPolling(interval);
  };

  // Função para lidar com mudanças na configuração
  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setConfig(prev => ({
      ...prev,
      [name]: parseInt(value) || 0 // Garantir que seja um número ou 0
    }));
  };

  const handleSaveConfig = async () => {
    try {
      setLoading(true);
      
      const response = await axios.post(`${API_URL}/stores/${id}/config`, config);
      
      if (response.status === 200) {
        alert('Configuração salva com sucesso!');
      } else {
        alert('Erro ao salvar configuração');
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Erro ao salvar configuração:', error);
      alert('Erro ao salvar configuração');
      setLoading(false);
    }
  };

  const handleStartSync = async () => {
    try {
      setLoading(true);
      
      const response = await axios.post(`${API_URL}/stores/${id}/sync`);
      
      if (response.status === 200) {
        setStatus('running');
        
        // Iniciar polling de progresso
        startProgressPollingWithRetry();
        
        // Limpar logs anteriores
        setLogs([]);
      } else {
        console.error(`[ERROR] Erro ao iniciar sincronização para ${id}:`, response.status);
        alert('Erro ao iniciar sincronização');
      }
      
      setLoading(false);
    } catch (error) {
      console.error(`[ERROR] Erro ao iniciar sincronização para ${id}:`, error);
      alert('Erro ao iniciar sincronização');
      setLoading(false);
    }
  };

  const handleStopSync = async () => {
    try {
      setLoading(true);
      
      // Primeiro, parar o polling para reduzir a carga no servidor
      if (progressPolling) {
        clearInterval(progressPolling);
        setProgressPolling(null);
      }
      
      // Mudar o status imediatamente para feedback visual rápido
      setStatus('stopped');
      
      // Mostrar mensagem ao usuário
      alert('Solicitação de parada enviada. A sincronização será interrompida em breve.');
      
      // Fazer a solicitação de parada como uma operação em segundo plano
      axios.post(`${API_URL}/stores/${id}/sync/stop`, {}, {
        timeout: 30000 // Timeout muito maior para dar tempo ao servidor
      })
      .then(response => {
        if (response.status === 200) {
          console.log('Sincronização parada com sucesso!');
          // Buscar logs atualizados
          axios.get(`${API_URL}/stores/${id}/logs`)
            .then(logsResponse => {
              if (logsResponse.data) {
                setLogs(logsResponse.data);
              }
            })
            .catch(error => console.error('Erro ao buscar logs:', error));
        }
      })
      .catch(error => {
        console.error('Erro ao parar sincronização:', error);
        // Não mostrar alerta para o usuário pois já mudamos o status visualmente
      })
      .finally(() => {
        setLoading(false);
        fetchStoreDetails(); // Atualizar detalhes da loja
      });
      
      // Não esperar pela resposta para liberar a interface
      setLoading(false);
      
    } catch (error) {
      console.error('Erro ao iniciar processo de parada:', error);
      setLoading(false);
    }
  };

  // Nova função para executar apenas a Fase 1
  const handleStartPhase1 = async () => {
    try {
      setLoading(true);
      
      const response = await axios.post(`${API_URL}/stores/${id}/sync`, { phase: 1 });
      
      if (response.status === 200) {
        setStatus('running');
        
        // Iniciar polling de progresso
        startProgressPollingWithRetry();
        
        // Limpar logs anteriores
        setLogs([]);
      } else {
        alert('Erro ao iniciar Fase 1');
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Erro ao iniciar Fase 1:', error);
      alert('Erro ao iniciar Fase 1');
      setLoading(false);
    }
  };

  // Nova função para executar apenas a Fase 2
  const handleStartPhase2 = async () => {
    try {
      setLoading(true);
      
      const response = await axios.post(`${API_URL}/stores/${id}/sync`, { phase: 2 });
      
      if (response.status === 200) {
        setStatus('running');
        
        // Iniciar polling de progresso
        startProgressPollingWithRetry();
        
        // Limpar logs anteriores
        setLogs([]);
      } else {
        alert('Erro ao iniciar Fase 2');
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Erro ao iniciar Fase 2:', error);
      alert('Erro ao iniciar Fase 2');
      setLoading(false);
    }
  };

  const handleScheduleSync = async () => {
    try {
      const response = await axios.post(`${API_URL}/stores/${id}/schedule`, {
        interval: store?.scheduleInterval || 4
      });
      
      if (response.status === 200) {
        setIsScheduleActive(true);
      }
    } catch (error) {
      console.error('Erro ao agendar sincronização:', error);
      alert('Erro ao agendar sincronização');
    }
  };

  const handleCancelSchedule = async () => {
    try {
      const response = await axios.post(`${API_URL}/stores/${id}/schedule/cancel`);
      
      if (response.status === 200) {
        setIsScheduleActive(false);
      }
    } catch (error) {
      console.error('Erro ao cancelar agendamento:', error);
      alert('Erro ao cancelar agendamento');
    }
  };

  // Renderização condicional da barra de progresso
  const renderProgressBar = () => {
    if (!progress) {
      return null;
    }
    
    return (
      <div className="mb-6">
        <div className="flex justify-between mb-1">
          <span className="text-sm font-medium">
            {progress.isRunning ? (
              <>
                <span className="font-bold">Fase {progress.phase}: Atualizando produtos</span> - {progress.processedProducts} de {progress.totalProducts} produtos 
                ({progress.successCount || 0} com sucesso, {progress.failCount || 0} com falha)
              </>
            ) : progress.completed ? (
              <>Sincronização concluída ({progress.percentage}%)</>
            ) : (
              <>Sincronização não está em execução</>
            )}
          </span>
          <span className="text-sm font-medium">{progress.percentage}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-4">
          <div 
            className="h-4 rounded-full bg-primary"
            style={{ width: `${progress.percentage}%`, minWidth: '4px', transition: 'width 0.5s ease' }}
          ></div>
        </div>
        
        {progress.isRunning && progress.currentBatch && progress.totalBatches && (
          <div className="mt-2 text-sm text-gray-600">
            Processando lote {progress.currentBatch} de {progress.totalBatches}
          </div>
        )}
        
        {progress.error && (
          <div className="mt-2 text-sm text-error">
            Erro: {progress.error}
          </div>
        )}
        
        {/* Exibir relatório JSON da Amazon quando disponível */}
        {progress.reportJson && progress.phase === 2 && (
          <div className="mt-4 border border-gray-300 rounded p-3 text-sm bg-gray-50">
            <h4 className="font-bold mb-2">Relatório da Amazon:</h4>
            {progress.reportJson.header && (
              <div className="mb-2">
                <div><strong>Status:</strong> {progress.reportJson.header.status || 'N/A'}</div>
                <div><strong>Feed ID:</strong> {progress.reportJson.header.feedId || 'N/A'}</div>
              </div>
            )}
            {progress.reportJson.summary && (
              <div className="mb-2">
                <div className="font-semibold mb-1">Resumo do Processamento:</div>
                <div><strong>Mensagens Processadas:</strong> {progress.reportJson.summary.messagesProcessed || 0}</div>
                <div><strong>Mensagens Aceitas:</strong> {progress.reportJson.summary.messagesAccepted || 0}</div>
                <div><strong>Mensagens Inválidas:</strong> {progress.reportJson.summary.messagesInvalid || 0}</div>
                <div><strong>Erros:</strong> {progress.reportJson.summary.errors || 0}</div>
                <div><strong>Avisos:</strong> {progress.reportJson.summary.warnings || 0}</div>
              </div>
            )}
            {progress.reportJson.issues && progress.reportJson.issues.length > 0 && (
              <div>
                <div className="font-semibold mb-1">Problemas Encontrados:</div>
                <ul className="list-disc list-inside">
                  {progress.reportJson.issues.map((issue: any, idx: number) => (
                    <li key={idx} className="text-error">
                      {issue.code}: {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Função para filtrar e formatar logs (apenas erros e resumos)
  const getFilteredLogs = () => {
    if (!logs || logs.length === 0) {
      return [];
    }
    
    // Se for um array de strings, retornar diretamente
    if (typeof logs[0] === 'string') {
      return logs;
    }
    
    // Se for um array de objetos LogEntry, filtrar e formatar
    return logs
      .filter((log: any) => log.count > 0)
      .sort((a: any, b: any) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateB - dateA; // Ordenar por data decrescente
      });
  };

  // Efeito para buscar detalhes da loja quando o componente for montado
  useEffect(() => {
    if (!id) {
      setError('ID da loja não fornecido');
      setLoading(false);
      return;
    }

    const fetchInitialData = async () => {
      await fetchStoreDetails(); // Busca os detalhes iniciais
    };

    fetchInitialData();

    // Limpar intervalos quando o componente for desmontado
    return () => {
      if (progressPolling) {
        clearInterval(progressPolling);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]); // Dependência apenas no ID da loja para buscar dados ao montar

  // Efeito para iniciar/parar polling baseado no status (APÓS fetchStoreDetails ter atualizado o status)
  useEffect(() => {
    if (status === 'running' && !progressPolling) {
      startProgressPollingWithRetry();
    } else if (status !== 'running' && progressPolling) {
      clearInterval(progressPolling);
      setProgressPolling(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]); // Dependência no status para controlar o polling

  if (loading && !store) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <div className="spinner"></div>
          <p className="mt-4">Carregando informações da loja...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
          <strong className="font-bold">Erro!</strong>
          <span className="block sm:inline"> {error}</span>
          <button
            className="btn btn-primary mt-4"
            onClick={() => navigate('/')}
          >
            Voltar para a lista de lojas
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <button
        onClick={() => navigate('/')}
        className="btn btn-secondary mb-6 flex items-center"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
        </svg>
        Voltar ao Dashboard
      </button>

      <h1 className="text-3xl font-bold mb-8">
        {store?.name} 
        <span className={`ml-3 inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
          status === 'running' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
        }`}>
          <span className={`h-2 w-2 rounded-full mr-1.5 ${
            status === 'running' ? 'bg-green-400' : 'bg-gray-400'
          }`}></span>
          {status === 'running' ? 'Ativo' : 'Parado'}
        </span>
      </h1>

      {lastRunTime && (
        <p className="text-gray-600 mb-6">
          Última sincronização: {new Date(lastRunTime).toLocaleString()}
        </p>
      )}

      {/* Barra de progresso */}
      {renderProgressBar()}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="card">
          <h2 className="text-2xl font-bold mb-6">Controles</h2>
          <div className="space-y-6">
            <div>
              <button
                onClick={handleStartSync}
                className="btn btn-primary w-full mb-3"
                disabled={status === 'running'}
                aria-label="Iniciar Sincronização"
                tabIndex={0}
              >
                Iniciar Sincronização
              </button>
              <button
                onClick={handleStopSync}
                className="btn btn-error w-full"
                disabled={status !== 'running'}
                aria-label="Parar Sincronização"
                tabIndex={0}
              >
                Parar Sincronização
              </button>
            </div>
            
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-lg font-semibold mb-3">Executar Fases Individualmente</h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={handleStartPhase1}
                  className="btn btn-secondary"
                  disabled={status === 'running'}
                  aria-label="Executar Fase 1"
                  tabIndex={0}
                >
                  Executar Fase 1
                </button>
                <button
                  onClick={handleStartPhase2}
                  className="btn btn-secondary"
                  disabled={status === 'running'}
                  aria-label="Executar Fase 2"
                  tabIndex={0}
                >
                  Executar Fase 2
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                <strong>Fase 1:</strong> Atualiza produtos do fornecedor<br />
                <strong>Fase 2:</strong> Envia atualizações para a Amazon
              </p>
            </div>
            
            <div className="border-t border-gray-200 pt-4 mt-4">
              <h3 className="text-lg font-semibold mb-3">Agendamento</h3>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <label htmlFor="scheduleInterval" className="mr-2 text-sm">Intervalo (horas):</label>
                  <input
                    id="scheduleInterval"
                    type="number"
                    min="1"
                    max="24"
                    value={store?.scheduleInterval || 4}
                    onChange={(e) => setStore(prev => prev ? {...prev, scheduleInterval: Number(e.target.value)} : null)}
                    className="input w-20"
                  />
                </div>
                <div className="flex items-center">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    isScheduleActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    <span className={`h-2 w-2 rounded-full mr-1.5 ${
                      isScheduleActive ? 'bg-green-400' : 'bg-gray-400'
                    }`}></span>
                    {isScheduleActive ? 'Agendamento Ativo' : 'Agendamento Inativo'}
                  </span>
                </div>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handleScheduleSync}
                  className={`btn ${isScheduleActive ? 'btn-secondary' : 'btn-primary'} flex-1`}
                  disabled={isScheduleActive}
                >
                  Agendar
                </button>
                <button
                  onClick={handleCancelSchedule}
                  className={`btn ${isScheduleActive ? 'btn-primary' : 'btn-secondary'} flex-1`}
                  disabled={!isScheduleActive}
                >
                  Cancelar Agenda
                </button>
              </div>
            </div>
            
            {/* Botão para atualização manual do status */}
            <button
              className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded ml-2"
              onClick={handleManualRefresh}
              disabled={loading}
            >
              Atualizar Status
            </button>
          </div>
        </div>

        <div className="card">
          <h2 className="text-2xl font-bold mb-6">Configuração</h2>
          {store && (
            <ProviderConfigFactory 
              providerId={store.id} 
              config={config} 
              onChange={handleConfigChange} 
            />
          )}
          <button
            onClick={handleSaveConfig}
            className="btn btn-primary w-full mt-6"
            aria-label="Salvar configuração"
            tabIndex={0}
          >
            Salvar Configuração
          </button>
        </div>
      </div>

      <div className="card mt-8">
        <h2 className="text-2xl font-bold mb-6">Logs e Erros</h2>
        <div className="bg-gray-100 rounded-lg p-4 h-64 overflow-y-auto">
          {getFilteredLogs().length > 0 ? (
            getFilteredLogs().map((log, index) => (
              <div
                key={index}
                className={`text-sm font-mono mb-2 last:mb-0 ${
                  typeof log === 'string' && log.includes('Erro') ? 'text-error' : 
                  typeof log === 'string' && log.includes('completa') ? 'text-success' : ''
                }`}
              >
                {typeof log === 'string' 
                  ? log 
                  : `[${new Date(log.date).toLocaleString()}] Arquivo: ${log.file} - Produtos com falha: ${log.count}`}
              </div>
            ))
          ) : (
            <p className="text-gray-500 text-center">Nenhum log disponível</p>
          )}
        </div>
        {serverError && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mt-4" role="alert">
            <strong className="font-bold">Erro!</strong>
            <span className="block sm:inline"> {serverError}</span>
          </div>
        )}
      </div>

      <div className="mt-8 text-center text-sm text-gray-600">
        <p>API URL: {API_URL}</p>
        <p>Version: 1.0.0</p>
      </div>
    </div>
  );
};