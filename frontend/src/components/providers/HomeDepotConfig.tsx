import React from 'react';

interface HomeDepotConfigProps {
  config: {
    stockLevel: number;
    batchSize: number;
    requestsPerSecond: number;
    handlingTimeOmd: number;
    homeDepotHandlingTime: number;
    updateFlagValue: number;
  };
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Componente de configuração específico para o fornecedor Home Depot
 */
const HomeDepotConfig: React.FC<HomeDepotConfigProps> = ({ config, onChange }) => {
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
        <label htmlFor="homeDepotHandlingTime" className="block text-sm font-medium text-gray-700 mb-1">
          Tempo de Manuseio Home Depot (dias)
        </label>
        <input
          id="homeDepotHandlingTime"
          type="number"
          name="homeDepotHandlingTime"
          value={config.homeDepotHandlingTime}
          disabled={true}
          className="input bg-gray-100 cursor-not-allowed"
          aria-label="Tempo de manuseio da Home Depot em dias (calculado automaticamente)"
        />
        <p className="text-sm text-gray-500 mt-1">
          Este valor é calculado automaticamente com base nos dados da API da Home Depot.
        </p>
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
          Código de Atualização Home Depot
        </label>
        <input
          id="updateFlagValue"
          type="number"
          name="updateFlagValue"
          value={config.updateFlagValue}
          onChange={onChange}
          className="input"
          aria-label="Código de atualização Home Depot"
        />
        <p className="text-sm text-gray-500 mt-1">
          Identificador usado para marcar produtos atualizados pela Home Depot no banco de dados.
          Recomendado: 1
        </p>
      </div>
    </div>
  );
};

export default HomeDepotConfig; 