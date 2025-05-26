import React from 'react';
import HomeDepotConfig from './HomeDepotConfig';
import WhiteCapConfig from './WhiteCapConfig';
import VitacostConfig from './VitacostConfig';
import BestBuyConfig from './BestBuyConfig';
import WebstaurantstoreConfig from './WebstaurantstoreConfig';

// Interface para configuração genérica
interface ConfigProps {
  stockLevel: number;
  batchSize: number;
  requestsPerSecond: number;
  handlingTimeOmd: number;
  homeDepotHandlingTime: number;
  whiteCapHandlingTime: number;
  vitacostHandlingTime: number;
  bestbuyHandlingTime: number;
  webstaurantstoreHandlingTime: number;
  updateFlagValue: number; // Novo campo para o código de atualização
}

interface ProviderConfigFactoryProps {
  providerId: string;
  config: ConfigProps;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Factory para selecionar o componente de configuração correto com base no tipo de fornecedor
 */
const ProviderConfigFactory: React.FC<ProviderConfigFactoryProps> = ({ 
  providerId, 
  config, 
  onChange 
}) => {
  // Selecionar o componente de configuração com base no providerId
  switch (providerId) {
    case 'homedepot':
      return <HomeDepotConfig config={config} onChange={onChange} />;
    
    case 'whitecap':
      return <WhiteCapConfig config={config} onChange={onChange} />;
    
    case 'vitacost':
      return <VitacostConfig config={config} onChange={onChange} />;
    
    case 'bestbuy':
      return <BestBuyConfig config={config} onChange={onChange} />;
    
    case 'webstaurantstore':
      return <WebstaurantstoreConfig config={config} onChange={onChange} />;
    
    // Caso padrão - usar um formulário genérico
    default:
      return (
        <div className="space-y-4">
          <div>
            <label htmlFor="stockLevel" className="block text-sm font-medium text-gray-700 mb-1">
              Nível de Estoque
            </label>
            <input
              id="stockLevel"
              type="number"
              name="stockLevel"
              value={config.stockLevel}
              onChange={onChange}
              className="input"
              aria-label="Nível de estoque"
            />
          </div>
          
          <div>
            <label htmlFor="handlingTimeOmd" className="block text-sm font-medium text-gray-700 mb-1">
              Tempo de Manuseio OMD (dias)
            </label>
            <input
              id="handlingTimeOmd"
              type="number"
              name="handlingTimeOmd"
              value={config.handlingTimeOmd}
              onChange={onChange}
              className="input"
              aria-label="Tempo de manuseio da OMD em dias"
            />
          </div>
          
          <div>
            <label htmlFor="batchSize" className="block text-sm font-medium text-gray-700 mb-1">
              Tamanho do Lote
            </label>
            <input
              id="batchSize"
              type="number"
              name="batchSize"
              value={config.batchSize}
              onChange={onChange}
              className="input"
              aria-label="Tamanho do lote"
            />
          </div>
          
          <div>
            <label htmlFor="requestsPerSecond" className="block text-sm font-medium text-gray-700 mb-1">
              Requisições por Segundo
            </label>
            <input
              id="requestsPerSecond"
              type="number"
              name="requestsPerSecond"
              value={config.requestsPerSecond}
              onChange={onChange}
              className="input"
              aria-label="Requisições por segundo"
            />
          </div>
          
          <div>
            <label htmlFor="updateFlagValue" className="block text-sm font-medium text-gray-700 mb-1">
              Código de Atualização (ID da Loja)
            </label>
            <input
              id="updateFlagValue"
              type="number"
              name="updateFlagValue"
              value={config.updateFlagValue}
              onChange={onChange}
              className="input"
              aria-label="Código de atualização (ID da loja)"
            />
            <p className="text-xs text-gray-500 mt-1">
              Este código será usado para marcar produtos atualizados por esta loja. Use um valor único para cada loja.
            </p>
          </div>
          
          <div className="bg-yellow-50 p-4 rounded-md border border-yellow-200 mt-4">
            <h3 className="text-yellow-800 font-medium mb-2">Configuração Genérica</h3>
            <p className="text-sm text-yellow-700">
              Este fornecedor não possui um formulário de configuração específico.
              As configurações básicas estão sendo usadas.
            </p>
          </div>
        </div>
      );
  }
};

export default ProviderConfigFactory; 