/**
 * Modelo de Loja
 * 
 * Este arquivo define o modelo de dados para as lojas suportadas pelo sistema.
 */

class Store {
  /**
   * @param {string} id - Identificador único da loja
   * @param {string} name - Nome da loja
   * @param {string} apiBaseUrl - URL base da API da loja
   * @param {string} status - Status atual da loja (ativo, inativo, etc.)
   * @param {number} scheduleInterval - Intervalo de sincronização em horas (padrão: 4)
   */
  constructor(id, name, apiBaseUrl, status = 'Inativo', scheduleInterval = 4) {
    this.id = id;
    this.name = name;
    this.apiBaseUrl = apiBaseUrl;
    this.status = status;
    this.scheduleInterval = scheduleInterval;
    this.lastSync = null;
  }
}

// Lista padrão de lojas suportadas
const defaultStores = [
  new Store('homedepot', 'Home Depot', 'http://167.114.223.83:3005/hd/api', 'Inativo', 4),
  new Store('zoro', 'Zoro', 'http://api.zoro.com', 'Inativo', 4),
  new Store('vitacost', 'Vitacost', 'http://167.114.223.83:3005/vc', 'Inativo', 4),
  new Store('bestbuy', 'Best Buy', 'http://167.114.223.83:3005/bb/api', 'Inativo', 4),
  new Store('webstaurantstore', 'Webstaurantstore', 'http://167.114.223.83:3005/wr/api', 'Inativo', 4)
];

module.exports = {
  Store,
  defaultStores
};
