import React from 'react';

interface VitacostConfigProps {
  config: {
    stockLevel: number;
    batchSize: number;
    requestsPerSecond: number;
    handlingTimeOmd: number;
    vitacostHandlingTime: number;
    updateFlagValue: number;
  };
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Componente de configuração específico para o fornecedor Vitacost
 */
const VitacostConfig: React.FC<VitacostConfigProps> = ({ config, onChange }) => {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="stockLevel" className="block text-sm font-medium text-gray-700 mb-1">
          Nível de Estoque (Vitacost)
        </label>
        <input
          id="stockLevel"
          type="number"
          name="stockLevel"
          value={config.stockLevel}
          onChange={onChange}
          className="input"
          aria-label="Nível de estoque para Vitacost"
        />
        <p className="text-sm text-gray-500 mt-1">
          Limite máximo de estoque a ser considerado para produtos da Vitacost.
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
        <p className="text-sm text-gray-500 mt-1">
          Tempo de manuseio da OMD para produtos da Vitacost.
        </p>
      </div>
      
      <div>
        <label htmlFor="vitacostHandlingTime" className="block text-sm font-medium text-gray-700 mb-1">
          Tempo de Manuseio Vitacost (dias)
        </label>
        <input
          id="vitacostHandlingTime"
          type="number"
          name="vitacostHandlingTime"
          value={config.vitacostHandlingTime}
          onChange={onChange}
          className="input"
          aria-label="Tempo de manuseio da Vitacost em dias"
        />
        <p className="text-sm text-gray-500 mt-1">
          Tempo de manuseio específico da Vitacost para seus produtos.
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
        <p className="text-sm text-gray-500 mt-1">
          Número de produtos a serem processados em cada lote durante o envio para a Amazon.
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
        <p className="text-sm text-gray-500 mt-1">
          Taxa de requisições à API da Vitacost (limite para evitar bloqueio).
        </p>
      </div>
      
      <div>
        <label htmlFor="updateFlagValue" className="block text-sm font-medium text-gray-700 mb-1">
          Código de Atualização Vitacost
        </label>
        <input
          id="updateFlagValue"
          type="number"
          name="updateFlagValue"
          value={config.updateFlagValue}
          onChange={onChange}
          className="input"
          aria-label="Código de atualização Vitacost"
        />
        <p className="text-sm text-gray-500 mt-1">
          Identificador usado para marcar produtos atualizados pela Vitacost no banco de dados. 
          Recomendado: 2
        </p>
      </div>
      
      <div className="bg-blue-50 p-4 rounded-md border border-blue-200 mt-4">
        <h3 className="text-blue-800 font-medium mb-2">Informações da Vitacost</h3>
        <p className="text-sm text-blue-700">
          A Vitacost fornece informações sobre disponibilidade e preços de produtos.
          O sistema utilizará o tempo de manuseio configurado acima para todos os produtos,
          independentemente de outras condições. Certifique-se de configurar um valor adequado
          para garantir prazos de entrega realistas.
        </p>
      </div>
    </div>
  );
};

export default VitacostConfig; 