import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:7005/api';

interface NextSyncTimerProps {
  storeId: string;
}

interface NextSyncInfo {
  scheduled: boolean;
  nextSync?: string;
  nextSyncTimestamp?: number;
  timeRemaining?: number;
  formattedTimeRemaining?: string;
  hours?: number;
  minutes?: number;
  seconds?: number;
  interval?: number;
  lastSync?: string;
  message?: string;
  error?: string;
}

const NextSyncTimer: React.FC<NextSyncTimerProps> = ({ storeId }) => {
  const [nextSyncInfo, setNextSyncInfo] = useState<NextSyncInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [countdown, setCountdown] = useState<{ hours: number; minutes: number; seconds: number } | null>(null);
  
  // Usar refs para armazenar valores que não devem causar re-renderização
  const nextSyncTimestampRef = useRef<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastFetchTimeRef = useRef<number>(0);
  
  // Nova função para iniciar o script
  const startSync = async () => {
    try {
      console.log(`Iniciando sincronização para store ${storeId}`);
      const response = await axios.post(`${API_URL}/stores/${storeId}/start-sync`);
      console.log('Sincronização iniciada:', response.data);
      
      // Buscar novas informações de agendamento após iniciar a sincronização
      await fetchNextSyncInfo();
    } catch (error) {
      console.error('Erro ao iniciar sincronização:', error);
    }
  };
  
  // Função para buscar informações sobre a próxima sincronização
  const fetchNextSyncInfo = async () => {
    try {
      // Limitar a frequência de chamadas à API
      const now = Date.now();
      if (now - lastFetchTimeRef.current < 10000) { // Evitar chamadas em menos de 10 segundos
        return;
      }
      
      lastFetchTimeRef.current = now;
      console.log(`[DEBUG] Fetching next sync info for store ${storeId} at ${new Date().toISOString()}`);
      
      const response = await axios.get(`${API_URL}/stores/${storeId}/next-sync`);
      const data = response.data;
      
      // Logs detalhados para diagnóstico
      console.log(`[DEBUG] Raw data received for ${storeId}:`, JSON.stringify(data));
      
      if (data.nextSyncTimestamp) {
        const nextSyncDate = new Date(data.nextSyncTimestamp);
        console.log(`[DEBUG] Next sync date for ${storeId}: ${nextSyncDate.toISOString()}`);
      }
      
      if (data.lastSync) {
        const lastSyncDate = new Date(data.lastSync);
        console.log(`[DEBUG] Last sync date for ${storeId}: ${lastSyncDate.toISOString()}`);
        
        if (data.interval) {
          const expectedNextSync = new Date(lastSyncDate.getTime() + data.interval * 60 * 60 * 1000);
          console.log(`[DEBUG] Expected next sync with interval ${data.interval}h: ${expectedNextSync.toISOString()}`);
          
          // Calcular diferença entre o esperado e o recebido
          if (data.nextSyncTimestamp) {
            const actualNextSync = new Date(data.nextSyncTimestamp);
            const diffMs = actualNextSync.getTime() - expectedNextSync.getTime();
            const diffHours = diffMs / (1000 * 60 * 60);
            console.log(`[DEBUG] Difference between expected and actual: ${diffHours.toFixed(2)} hours (${diffMs}ms)`);
          }
        }
      }
      
      // Garantir que o intervalo seja respeitado
      if (data.interval) {
        console.log(`[DEBUG] Using interval from API: ${data.interval} hours`);
      }
      
      setNextSyncInfo(data);
      
      if (data.scheduled && data.nextSyncTimestamp) {
        // Só atualizar o timestamp se ele não existir ou se for diferente do atual
        // Isso evita que o contador seja reiniciado desnecessariamente
        if (nextSyncTimestampRef.current === null || 
            Math.abs(nextSyncTimestampRef.current - data.nextSyncTimestamp) > 60000) { // Diferença maior que 1 minuto
          console.log(`[DEBUG] Updating nextSyncTimestamp from ${nextSyncTimestampRef.current} to ${data.nextSyncTimestamp}`);
          const oldDate = nextSyncTimestampRef.current ? new Date(nextSyncTimestampRef.current).toISOString() : 'null';
          const newDate = new Date(data.nextSyncTimestamp).toISOString();
          console.log(`[DEBUG] Time change: ${oldDate} -> ${newDate}`);
          
          nextSyncTimestampRef.current = data.nextSyncTimestamp;
          
          // Salvar o timestamp no localStorage para persistir entre recargas da página
          localStorage.setItem(`nextSync_${storeId}`, data.nextSyncTimestamp.toString());
        } else {
          console.log(`[DEBUG] Keeping existing nextSyncTimestamp: ${nextSyncTimestampRef.current}`);
        }
      } else {
        nextSyncTimestampRef.current = null;
        setCountdown(null);
      }
      
      setLoading(false);
    } catch (error) {
      console.error('Error fetching next sync info:', error);
      setNextSyncInfo({
        scheduled: false,
        error: 'Não foi possível obter informações sobre a próxima sincronização'
      });
      setLoading(false);
    }
  };
  
  // Função para atualizar o contador com base no timestamp armazenado
  const updateCountdown = () => {
    if (nextSyncTimestampRef.current === null) {
      setCountdown(null);
      return;
    }
    
    const now = Date.now();
    const timeRemaining = nextSyncTimestampRef.current - now;
    
    if (timeRemaining <= 0) {
      // Se o tempo acabou, iniciar a sincronização e buscar novas informações
      setCountdown(null);
      nextSyncTimestampRef.current = null; // Limpar o timestamp para forçar uma atualização
      startSync(); // Chamar a função para iniciar a sincronização
      return;
    }
    
    // Converter para horas, minutos e segundos
    const hours = Math.floor(timeRemaining / (1000 * 60 * 60));
    const minutes = Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((timeRemaining % (1000 * 60)) / 1000);
    
    setCountdown({ hours, minutes, seconds });
  };

  // Buscar informações iniciais
  useEffect(() => {
    // Limpar timer existente quando o storeId mudar
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    // Resetar o timestamp
    nextSyncTimestampRef.current = null;
    
    // CORREÇÃO ESPECÍFICA PARA BEST BUY
    // Este trecho executará automaticamente ao carregar o componente para a Best Buy
    if (storeId === 'bestbuy') {
      (async function fixBestBuyTimer() {
        try {
          console.log("=== CORREÇÃO AUTOMÁTICA DO TIMER DA BEST BUY ===");
          
          // 1. Limpar qualquer valor armazenado localmente para forçar nova busca
          localStorage.removeItem(`nextSync_${storeId}`);
          console.log("✓ LocalStorage limpo para Best Buy");
          
          // 2. Forçar um reagendamento com intervalo explícito de 4 horas
          // Isso fará o servidor recalcular tudo corretamente
          console.log("→ Forçando reagendamento com intervalo correto...");
          try {
            const scheduleResponse = await axios.post(`${API_URL}/stores/${storeId}/schedule`, { 
              interval: 4 // Garantir que seja exatamente 4 horas 
            });
            console.log("✓ Reagendamento forçado com sucesso:", scheduleResponse.data);
            
            // Esperar 500ms para garantir que o servidor processou tudo
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (e) {
            console.error("✗ Erro ao reagendar:", e);
          }
          
          console.log("→ Buscando dados atualizados do servidor...");
        } catch (error) {
          console.error("Erro durante a correção:", error);
        }
      })();
    }
    
    // Buscar informações iniciais
    fetchNextSyncInfo();
    
    // Verificar mudanças no agendamento a cada 10 minutos
    const infoInterval = setInterval(fetchNextSyncInfo, 10 * 60 * 1000);
    
    return () => {
      clearInterval(infoInterval);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [storeId]);

  // Iniciar o contador quando o componente montar
  useEffect(() => {
    // Atualizar o contador imediatamente
    updateCountdown();
    
    // Configurar intervalo para atualizar a cada segundo
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    timerRef.current = setInterval(updateCountdown, 1000);
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Salvar o timestamp no localStorage para persistir entre recargas da página
  useEffect(() => {
    if (nextSyncInfo?.nextSyncTimestamp && !nextSyncTimestampRef.current) {
      const storedTimestamp = localStorage.getItem(`nextSync_${storeId}`);
      
      if (storedTimestamp) {
        const parsedTimestamp = parseInt(storedTimestamp, 10);
        const now = Date.now();
        
        // Usar o timestamp armazenado apenas se for no futuro
        if (parsedTimestamp > now) {
          nextSyncTimestampRef.current = parsedTimestamp;
          console.log(`Using stored timestamp for ${storeId}: ${new Date(parsedTimestamp).toISOString()}`);
          updateCountdown();
          return;
        }
      }
      
      // Se não houver timestamp armazenado ou se for inválido, usar o da API
      nextSyncTimestampRef.current = nextSyncInfo.nextSyncTimestamp;
      localStorage.setItem(`nextSync_${storeId}`, nextSyncInfo.nextSyncTimestamp.toString());
      console.log(`Saved timestamp for ${storeId}: ${new Date(nextSyncInfo.nextSyncTimestamp).toISOString()}`);
      updateCountdown();
    }
  }, [nextSyncInfo, storeId]);

  if (loading && !countdown) {
    return <div className="text-sm text-gray-500">Carregando próxima sincronização...</div>;
  }

  if (!nextSyncInfo?.scheduled && !countdown) {
    return (
      <div className="text-sm text-gray-500">
        {nextSyncInfo?.message || nextSyncInfo?.error || 'Sem agendamento ativo'}
      </div>
    );
  }

  return (
    <div className="text-sm">
      <div className="font-medium text-primary">Próxima sincronização em:</div>
      <div className="font-bold text-lg">
        {countdown ? (
          <span>
            {String(countdown.hours).padStart(2, '0')}:
            {String(countdown.minutes).padStart(2, '0')}:
            {String(countdown.seconds).padStart(2, '0')}
          </span>
        ) : (
          'Calculando...'
        )}
      </div>
      {nextSyncInfo?.lastSync && (
        <div className="text-xs text-gray-500 mt-1">
          Última sincronização: {new Date(nextSyncInfo.lastSync).toLocaleString()}
        </div>
      )}
    </div>
  );
};

export default NextSyncTimer;
