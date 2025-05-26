import React from 'react';

// Interface para as props de configuração
interface ConfigProps {
  stockLevel: number;
  batchSize: number;
  requestsPerSecond: number;
  handlingTimeOmd: number;
  bestbuyHandlingTime: number;
  updateFlagValue: number;
}

interface BestBuyConfigProps {
  config: ConfigProps;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Formulário de configuração específico para Best Buy
 */
const BestBuyConfig: React.FC<BestBuyConfigProps> = ({ config, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="stockLevel" className="block text-sm font-medium text-gray-700 mb-1">
          Nível de Estoque Best Buy
        </label>
        <input
          id="stockLevel"
          type="number"
          name="stockLevel"
          value={config.stockLevel}
          onChange={onChange}
          className="input"
          aria-label="Nível de estoque Best Buy"
        />
        <p className="text-xs text-gray-500 mt-1">
          Quantidade mínima de estoque para produtos Best Buy.
        </p>
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
        <p className="text-xs text-gray-500 mt-1">
          Tempo adicional de manuseio pela OMD.
        </p>
      </div>
      
      <div>
        <label htmlFor="bestbuyHandlingTime" className="block text-sm font-medium text-gray-700 mb-1">
          Tempo de Manuseio Best Buy (dias)
        </label>
        <input
          id="bestbuyHandlingTime"
          type="number"
          name="bestbuyHandlingTime"
          value={config.bestbuyHandlingTime}
          onChange={onChange}
          className="input"
          aria-label="Tempo de manuseio Best Buy em dias"
        />
        <p className="text-xs text-gray-500 mt-1">
          Tempo de manuseio específico da Best Buy.
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
        <p className="text-xs text-gray-500 mt-1">
          Produtos processados por lote (Amazon usará sempre 9990).
        </p>
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
        <p className="text-xs text-gray-500 mt-1">
          Limite de requisições API por segundo.
        </p>
      </div>
      
      <div>
        <label htmlFor="updateFlagValue" className="block text-sm font-medium text-gray-700 mb-1">
          Código de Atualização Best Buy
        </label>
        <input
          id="updateFlagValue"
          type="number"
          name="updateFlagValue"
          value={config.updateFlagValue}
          onChange={onChange}
          className="input"
          aria-label="Código de atualização Best Buy"
        />
        <p className="text-xs text-gray-500 mt-1">
          ID único para a Best Buy (4). Não altere esse valor a menos que seja absolutamente necessário.
        </p>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-md border border-blue-200 mt-4">
        <h3 className="text-blue-800 font-medium mb-2">Informações Best Buy</h3>
        <p className="text-sm text-blue-700">
          O tempo total de manuseio (handling) que será enviado para a Amazon será a soma do tempo de manuseio da OMD
          e do tempo de manuseio específico da Best Buy.
        </p>
      </div>
    </div>
  );
};

export default BestBuyConfig; 