import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import NextSyncTimer from './NextSyncTimer';

// URL da API do Node.js para a Home Depot Sync
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:7005/api';

interface Store {
  id: string;
  name: string;
  status: string;
  lastSync: string | null;
}

export const StoresList: React.FC = () => {
  const navigate = useNavigate();
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStores = async () => {
      try {
        // Tentar obter os dados da API
        const response = await axios.get(`${API_URL}/stores`);
        
        // Mapear os dados da API para o formato esperado pelo componente
        const storesData = response.data.map((store: any) => ({
          id: store.id,
          name: store.name,
          status: store.status === 'Ativo' || store.status === 'Executando' ? 'running' : 'stopped',
          lastSync: store.lastSync
        }));
        
        // Verificar se os dados obtidos têm o formato esperado
        if (Array.isArray(storesData) && storesData.length > 0) {
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
          // Se não temos dados, mostramos um erro e usamos dados de fallback
          setError('Não foi possível carregar as lojas. Por favor, verifique se o servidor está rodando.');
          
          // Fallback para desenvolvimento - dados simulados com IDs correspondentes ao backend
          setStores([
            { id: 'homedepot', name: 'Home Depot', status: 'stopped', lastSync: null },
            { id: 'bestbuy', name: 'Best Buy', status: 'stopped', lastSync: null },
            { id: 'zoro', name: 'Zoro', status: 'stopped', lastSync: null },
            { id: 'vitacost', name: 'Vitacost', status: 'stopped', lastSync: null },
            { id: 'webstaurantstore', name: 'Webstaurantstore', status: 'stopped', lastSync: null },
            { id: 'whitecap', name: 'White Cap', status: 'stopped', lastSync: null },
          ]);
        }
        
        setLoading(false);
      }
    };

    fetchStores();
    
    // Atualizar a lista de lojas a cada 15 segundos
    const interval = setInterval(fetchStores, 15000);
    
    return () => clearInterval(interval);
  }, []);

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
              Last synchronized: {store.lastSync ? new Date(store.lastSync).toLocaleString() : 'Never'}
            </div>
            
            {/* Temporizador para a próxima sincronização */}
            <div className="mb-4">
              <NextSyncTimer storeId={store.id} />
            </div>
            
            <div className="flex space-x-4">
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