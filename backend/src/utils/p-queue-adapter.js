/**
 * Adaptador para o módulo p-queue
 * 
 * Este adaptador permite usar o módulo p-queue (que é um módulo ESM)
 * em um ambiente CommonJS.
 */

// Usar import dinâmico para carregar o módulo ESM
let PQueue = null;

async function loadPQueue() {
  try {
    const module = await import('p-queue');
    PQueue = module.default;
    return PQueue;
  } catch (error) {
    console.error('Erro ao carregar o módulo p-queue:', error);
    throw error;
  }
}

// Carregar o módulo imediatamente
loadPQueue();

// Função para obter uma instância de PQueue
async function getPQueue(options) {
  // Garantir que o módulo foi carregado
  if (!PQueue) {
    await loadPQueue();
  }
  
  // Criar uma nova instância de PQueue
  return new PQueue(options);
}

module.exports = {
  getPQueue
};
