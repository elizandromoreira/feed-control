import React from 'react';

// Interface para as props de configuração
interface ConfigProps {
  stockLevel: number;
  batchSize: number;
  requestsPerSecond: number;
  handlingTimeOmd: number;
  providerSpecificHandlingTime: number;
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
          value={config.stockLevel || ''}
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
          value={config.handlingTimeOmd || ''}
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
          name="providerSpecificHandlingTime"
          value={config.providerSpecificHandlingTime || ''}
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
          value={config.batchSize || ''}
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
          <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
            Recomendado: 20
          </span>
        </label>
        <input
          id="requestsPerSecond"
          type="number"
          name="requestsPerSecond"
          value={config.requestsPerSecond || ''}
          onChange={onChange}
          className="input"
          aria-label="Requisições por segundo"
          min="1"
          max="20"
        />
        <div className="mt-2 space-y-1">
          <p className="text-xs text-gray-500">
            Limite de requisições API por segundo. Baseado em teste de capacidade:
          </p>
          <div className="text-xs space-y-1">
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                ✅ Ideal: 20 RPS
              </span>
              <span className="text-gray-600">100% sucesso, processamento mais rápido</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                🛡️ Conservador: 15 RPS
              </span>
              <span className="text-gray-600">Para ambientes com alta latência</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
                ⚠️ Mínimo: 5 RPS
              </span>
              <span className="text-gray-600">Apenas se houver problemas de conectividade</span>
            </div>
          </div>
        </div>
      </div>
      
      <div>
        <label htmlFor="updateFlagValue" className="block text-sm font-medium text-gray-700 mb-1">
          Código de Atualização Best Buy
        </label>
        <input
          id="updateFlagValue"
          type="number"
          name="updateFlagValue"
          value={config.updateFlagValue || ''}
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
        <p className="text-sm text-blue-700 mb-2">
          O tempo total de manuseio (handling) que será enviado para a Amazon será a soma do tempo de manuseio da OMD
          e do tempo de manuseio específico da Best Buy.
        </p>
      </div>

      <div className="bg-green-50 p-4 rounded-md border border-green-200 mt-4">
        <h3 className="text-green-800 font-medium mb-2">🚀 Otimização de Performance</h3>
        <div className="text-sm text-green-700 space-y-2">
          <p>
            <strong>Teste de Capacidade Realizado:</strong> A API Best Buy foi testada e suporta até 20 RPS com 100% de sucesso.
          </p>
          <p>
            <strong>Benefícios do 20 RPS:</strong>
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>Processamento 2.5x mais rápido que configurações anteriores</li>
            <li>Elimina problemas de rate limiting</li>
            <li>Reduz produtos incorretamente marcados como "OutOfStock"</li>
            <li>Sincronização completa em ~76 segundos (vs 3-4 minutos)</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default BestBuyConfig; 