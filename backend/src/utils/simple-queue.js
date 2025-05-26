/**
 * Implementação simples de uma fila de tarefas com concorrência limitada
 * para substituir o módulo p-queue que está causando problemas de compatibilidade
 */

class SimpleQueue {
  /**
   * @param {Object} options - Opções da fila
   * @param {number} options.concurrency - Número máximo de tarefas executando simultaneamente
   */
  constructor(options = {}) {
    this.concurrency = options.concurrency || 1;
    this.running = 0;
    this.queue = [];
    this.pendingComplete = null;
  }

  /**
   * Adiciona uma tarefa à fila
   * @param {Function} task - Função que retorna uma Promise
   * @returns {Promise} - Promise que resolve quando a tarefa for concluída
   */
  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        task,
        resolve,
        reject
      });
      
      this._processNext();
    });
  }

  /**
   * Processa a próxima tarefa na fila
   * @private
   */
  _processNext() {
    if (this.running >= this.concurrency || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    this.running++;

    Promise.resolve()
      .then(() => item.task())
      .then(
        result => {
          this.running--;
          item.resolve(result);
          this._processNext();
          this._checkIdle();
        },
        error => {
          this.running--;
          item.reject(error);
          this._processNext();
          this._checkIdle();
        }
      );
  }

  /**
   * Verifica se a fila está ociosa e resolve a Promise pendente se necessário
   * @private
   */
  _checkIdle() {
    if (this.pendingComplete && this.running === 0 && this.queue.length === 0) {
      this.pendingComplete();
      this.pendingComplete = null;
    }
  }

  /**
   * Retorna uma Promise que resolve quando todas as tarefas forem concluídas
   * @returns {Promise} - Promise que resolve quando a fila estiver vazia e todas as tarefas concluídas
   */
  onIdle() {
    if (this.running === 0 && this.queue.length === 0) {
      return Promise.resolve();
    }

    return new Promise(resolve => {
      this.pendingComplete = resolve;
    });
  }
}

module.exports = SimpleQueue;
