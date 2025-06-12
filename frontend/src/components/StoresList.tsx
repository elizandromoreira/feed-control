import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { NextSyncCountdown } from './NextSyncCountdown';

// A URL da API foi fixada para garantir a comunicação com o backend na porta 7005.
const API_URL = 'http://localhost:7005/api';

interface Store {
  id: string;
  name: string;
  status: string;
  lastSync: string | null;
  schedule: {
    isActive: boolean;
    interval: number | null;
  };
}

export const StoresList: React.FC = () => {
  const navigate = useNavigate();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const fetchStores = async () => {
      try {
        // Tentar obter os dados da API
        const response = await axios.get(`${API_URL}/stores`, {
          // Adicionar timestamp para evitar cache
          params: { _t: new Date().getTime() }
        });
        
        // A API /stores retorna um array com objetos contendo id e name
        const storesData: Store[] = response.data;
        
        // Verificar se os dados obtidos têm o formato esperado
        if (Array.isArray(storesData)) {
          setStores(storesData);
          // Remover mensagem de erro caso existente
          if (error) setError(null);
        } else {
          throw new Error('Dados retornados pela API têm formato inválido');
        }
        
        setLoading(false);
      } catch (error) {
        console.error('Error fetching stores:', error);
        
        // Se já temos dados, mantemos os dados existentes e apenas mostramos um aviso
        if (stores.length > 0) {
          setError('Aviso: Não foi possível atualizar os dados das lojas. Exibindo dados existentes.');
        } else {
          setError('Erro ao carregar lojas. Tente novamente mais tarde.');
          setLoading(false);
        }
      }
    };

    // Buscar dados imediatamente
    fetchStores();
    
    // Configurar polling para atualizar os dados a cada 60 segundos (aumentado de 30 para reduzir carga)
    const intervalId = setInterval(fetchStores, 60000);
    setPollingInterval(intervalId);
    
    // Limpar o intervalo quando o componente for desmontado
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, []); // Dependência vazia para executar apenas na montagem

  const handleNavigateToStore = (id: string) => {
    navigate(`/store/${id}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Sync Dashboard</h1>
      
      {error && (
        <div className="bg-error bg-opacity-10 border border-error text-error px-4 py-3 rounded mb-6">
          <p>{error}</p>
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {stores.map((store) => (
          <div key={store.id} className="card hover:shadow-lg transition-shadow duration-200">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-semibold">{store.name}</h2>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  store.status === 'running' ? 'bg-success text-white' : 'bg-error text-white'
                }`}
              >
                {store.status === 'running' ? 'Running' : 'Stopped'}
              </span>
            </div>
            
            <div className="text-sm text-gray-600 mb-4">
              <p>Last synchronized: {store.lastSync ? new Date(store.lastSync).toLocaleString() : 'Never'}</p>
              <p>
                Agendamento: 
                {store.schedule && store.schedule.isActive 
                  ? (
                      <>
                        <span className="text-green-600 font-semibold"> Ativo ({store.schedule.interval}h)</span>
                        <NextSyncCountdown 
                          isActive={store.schedule.isActive} 
                          intervalHours={store.schedule.interval} 
                          lastSync={store.lastSync} 
                        />
                      </>
                    )
                  : <span className="text-red-600 font-semibold"> Inativo</span>
                }
              </p>
            </div>
            
            <div className="mt-auto pt-4 flex space-x-4">
              <button
                onClick={() => handleNavigateToStore(store.id)}
                className="btn btn-primary flex-1"
                aria-label={`Manage ${store.name}`}
                tabIndex={0}
              >
                Manage
              </button>
            </div>
          </div>
        ))}
        
        {stores.length === 0 && (
          <div className="col-span-full text-center p-8 bg-gray-50 rounded-lg">
            <p className="text-gray-500">No stores found</p>
          </div>
        )}
      </div>
    </div>
  );
}; 