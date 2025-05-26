/**
 * Serviço de Gerenciamento de Lojas
 * 
 * Este serviço gerencia o armazenamento e recuperação de informações sobre
 * as lojas suportadas pelo sistema.
 */

const fs = require('fs').promises;
const path = require('path');
const { Store, defaultStores } = require('../models/Store');
const logger = require('../config/logging')();

// Caminho para o arquivo de configuração das lojas
const STORES_FILE = path.join(__dirname, '../../data/stores.json');

class StoreManager {
  constructor() {
    this.stores = [];
    this.loaded = false;
  }

  /**
   * Inicializa o gerenciador de lojas
   */
  async init() {
    if (!this.loaded) {
      await this.loadStores();
    }
    return this;
  }

  /**
   * Carrega as lojas a partir do arquivo de configuração
   */
  async loadStores() {
    try {
      // Garantir que o diretório data existe
      await fs.mkdir(path.dirname(STORES_FILE), { recursive: true });
      
      // Tentar carregar o arquivo
      const data = await fs.readFile(STORES_FILE, 'utf8');
      const storesData = JSON.parse(data);
      
      // Converter os objetos JSON para instâncias de Store
      this.stores = storesData.map(store => {
        const storeInstance = new Store(
          store.id,
          store.name,
          store.apiBaseUrl,
          store.status,
          store.scheduleInterval
        );
        
        // Preservar a informação de última sincronização se existir
        if (store.lastSync) {
          storeInstance.lastSync = store.lastSync;
        }
        
        return storeInstance;
      });
      
      logger.info(`Loaded ${this.stores.length} stores from configuration`);
    } catch (error) {
      // Se o arquivo não existir, usar as lojas padrão
      if (error.code === 'ENOENT') {
        logger.info('Stores configuration file not found, using default stores');
        this.stores = [...defaultStores];
        await this.saveStores();
      } else {
        logger.error(`Error loading stores: ${error.message}`);
        this.stores = [...defaultStores];
      }
    }
    
    this.loaded = true;
  }

  /**
   * Salva as lojas no arquivo de configuração
   */
  async saveStores() {
    try {
      await fs.writeFile(STORES_FILE, JSON.stringify(this.stores, null, 2));
      logger.info(`Saved ${this.stores.length} stores to configuration`);
    } catch (error) {
      logger.error(`Error saving stores: ${error.message}`);
    }
  }

  /**
   * Obtém todas as lojas
   * @returns {Array<Store>} Lista de lojas
   */
  getAllStores() {
    return this.stores;
  }

  /**
   * Obtém uma loja pelo ID
   * @param {string} id - ID da loja
   * @returns {Store|null} A loja encontrada ou null
   */
  getStoreById(id) {
    return this.stores.find(store => store.id === id) || null;
  }

  /**
   * Adiciona uma nova loja
   * @param {Store} store - A loja a ser adicionada
   * @returns {boolean} true se a loja foi adicionada, false caso contrário
   */
  async addStore(store) {
    // Verificar se já existe uma loja com o mesmo ID
    if (this.getStoreById(store.id)) {
      logger.warn(`Store with ID ${store.id} already exists`);
      return false;
    }
    
    this.stores.push(store);
    await this.saveStores();
    return true;
  }

  /**
   * Atualiza uma loja existente
   * @param {string} id - ID da loja
   * @param {Object} storeData - Dados atualizados da loja
   * @returns {boolean} true se a loja foi atualizada, false caso contrário
   */
  async updateStore(id, storeData) {
    const index = this.stores.findIndex(store => store.id === id);
    
    if (index === -1) {
      logger.warn(`Store with ID ${id} not found`);
      return false;
    }
    
    // Atualizar apenas os campos fornecidos
    const store = this.stores[index];
    Object.assign(store, storeData);
    
    await this.saveStores();
    return true;
  }

  /**
   * Remove uma loja
   * @param {string} id - ID da loja
   * @returns {boolean} true se a loja foi removida, false caso contrário
   */
  async removeStore(id) {
    const index = this.stores.findIndex(store => store.id === id);
    
    if (index === -1) {
      logger.warn(`Store with ID ${id} not found`);
      return false;
    }
    
    this.stores.splice(index, 1);
    await this.saveStores();
    return true;
  }

  /**
   * Atualiza o status de uma loja
   * @param {string} id - ID da loja
   * @param {string} status - Novo status
   * @returns {boolean} true se o status foi atualizado, false caso contrário
   */
  async updateStoreStatus(id, status) {
    return this.updateStore(id, { status });
  }

  /**
   * Atualiza o timestamp da última sincronização de uma loja
   * @param {string} id - ID da loja
   * @returns {boolean} true se o timestamp foi atualizado, false caso contrário
   */
  async updateLastSync(id) {
    const index = this.stores.findIndex(store => store.id === id);
    
    if (index === -1) {
      logger.warn(`Store with ID ${id} not found`);
      return false;
    }
    
    // Definir a data de última sincronização
    this.stores[index].lastSync = new Date().toISOString();
    
    // Garantir que a informação seja salva no arquivo persistente
    try {
      await this.saveStores();
      logger.info(`Updated lastSync for store ${id}: ${this.stores[index].lastSync}`);
      return true;
    } catch (error) {
      logger.error(`Error saving lastSync for store ${id}: ${error.message}`);
      return false;
    }
  }
}

// Singleton
let instance = null;

/**
 * Obtém a instância do gerenciador de lojas
 */
async function getStoreManager() {
  if (!instance) {
    instance = new StoreManager();
    await instance.init();
  }
  return instance;
}

module.exports = {
  getStoreManager
};
