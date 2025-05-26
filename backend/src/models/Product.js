/**
 * Modelos de Dados para Produtos
 * 
 * Este módulo define as classes para representar dados de produtos.
 * Equivalente às classes ProductData e DBProduct do script Python original.
 */

/**
 * Representa os dados de um produto obtidos da API do Home Depot
 */
class ProductData {
  /**
   * @param {Object} data - Dados do produto
   * @param {string} data.sku - SKU do produto
   * @param {number} [data.price=0.0] - Preço do produto
   * @param {number} [data.stock=0] - Estoque disponível
   * @param {boolean} [data.available=false] - Disponibilidade do produto
   * @param {string} [data.min_delivery_date=""] - Data mínima de entrega
   * @param {string} [data.max_delivery_date=""] - Data máxima de entrega
   * @param {string} [data.brand="Generico"] - Marca do produto
   * @param {number} [data.shipping_cost=0.0] - Custo de envio
   * @param {boolean} [data.discontinued=false] - Indica se o produto foi descontinuado
   */
  constructor(data) {
    this.sku = data.sku;
    this.price = data.price || 0.0;
    this.stock = data.stock || 0;
    this.available = data.available || false;
    this.min_delivery_date = data.min_delivery_date || "";
    this.max_delivery_date = data.max_delivery_date || "";
    this.brand = data.brand || "Generico";
    this.shipping_cost = data.shipping_cost || 0.0;
    this.discontinued = data.discontinued || false;
  }

  /**
   * Cria uma instância de ProductData a partir de dados da API
   * @param {Object} apiData - Dados da API
   * @returns {ProductData} - Nova instância de ProductData
   */
  static fromApiData(apiData) {
    // Adaptar os dados da API para o formato esperado
    return new ProductData({
      sku: apiData.id || apiData.sku || apiData.SKU || "",
      price: parseFloat(apiData.price || 0),
      stock: parseInt(apiData.stock || 0, 10),
      available: apiData.available === true || apiData.available === "true",
      min_delivery_date: apiData.minDeliveryDate || apiData.min_delivery_date || "",
      max_delivery_date: apiData.maxDeliveryDate || apiData.max_delivery_date || "",
      brand: apiData.brand || "Generico",
      shipping_cost: parseFloat(apiData.shippingCost || apiData.shipping_cost || 0),
      discontinued: apiData.discontinued === true || apiData.discontinued === "true"
    });
  }

  /**
   * Converte a instância para um objeto simples
   * @returns {Object} - Objeto com os dados do produto
   */
  toObject() {
    return {
      sku: this.sku,
      price: this.price,
      stock: this.stock,
      available: this.available,
      min_delivery_date: this.min_delivery_date,
      max_delivery_date: this.max_delivery_date,
      brand: this.brand,
      shipping_cost: this.shipping_cost,
      discontinued: this.discontinued
    };
  }
}

/**
 * Representa um produto armazenado no banco de dados
 */
class DBProduct {
  /**
   * @param {Object} data - Dados do produto
   * @param {string} data.sku - SKU do produto
   * @param {number} [data.supplier_price=0.0] - Preço do fornecedor
   * @param {number} [data.freight_cost=0.0] - Custo de frete
   * @param {string|number} [data.lead_time=0] - Tempo de entrega
   * @param {number} [data.lead_time_2=0] - Tempo de entrega secundário
   * @param {number} [data.total_price=0.0] - Preço total
   * @param {number} [data.quantity=0] - Quantidade em estoque
   * @param {number} [data.tax_supplier=0.0] - Taxa do fornecedor
   * @param {string} [data.availability='outOfStock'] - Disponibilidade
   * @param {number} [data.customer_price_shipping=0.0] - Preço de envio para o cliente
   * @param {number} [data.supplier_price_shipping=0.0] - Preço de envio do fornecedor
   * @param {number} [data.handling_time_amz=0] - Tempo de manuseio para a Amazon
   * @param {string} [data.brand='Generico'] - Marca do produto
   */
  constructor(data) {
    this.sku = data.sku;
    this.supplier_price = data.supplier_price || 0.0;
    this.freight_cost = data.freight_cost || 0.0;
    this.lead_time = data.lead_time || 0;
    this.lead_time_2 = data.lead_time_2 || 0;
    this.total_price = data.total_price || 0.0;
    this.quantity = data.quantity || 0;
    this.tax_supplier = data.tax_supplier || 0.0;
    this.availability = data.availability || 'outOfStock';
    this.customer_price_shipping = data.customer_price_shipping || 0.0;
    this.supplier_price_shipping = data.supplier_price_shipping || 0.0;
    this.handling_time_amz = data.handling_time_amz || 0;
    this.brand = data.brand || 'Generico';
  }

  /**
   * Cria uma instância de DBProduct a partir de uma linha do banco de dados
   * @param {Object} row - Linha do banco de dados
   * @returns {DBProduct} - Nova instância de DBProduct
   */
  static fromDatabaseRow(row) {
    return new DBProduct({
      sku: row.sku,
      supplier_price: parseFloat(row.supplier_price || 0),
      freight_cost: parseFloat(row.freight_cost || 0),
      lead_time: row.lead_time || 0,
      lead_time_2: parseInt(row.lead_time_2 || 0, 10),
      total_price: parseFloat(row.total_price || 0),
      quantity: parseInt(row.quantity || 0, 10),
      tax_supplier: parseFloat(row.tax_supplier || 0),
      availability: row.availability || 'outOfStock',
      customer_price_shipping: parseFloat(row.customer_price_shipping || 0),
      supplier_price_shipping: parseFloat(row.supplier_price_shipping || 0),
      handling_time_amz: parseInt(row.handling_time_amz || 0, 10),
      brand: row.brand || 'Generico'
    });
  }

  /**
   * Converte a instância para um objeto simples
   * @returns {Object} - Objeto com os dados do produto
   */
  toObject() {
    return {
      sku: this.sku,
      supplier_price: this.supplier_price,
      freight_cost: this.freight_cost,
      lead_time: this.lead_time,
      lead_time_2: this.lead_time_2,
      total_price: this.total_price,
      quantity: this.quantity,
      tax_supplier: this.tax_supplier,
      availability: this.availability,
      customer_price_shipping: this.customer_price_shipping,
      supplier_price_shipping: this.supplier_price_shipping,
      handling_time_amz: this.handling_time_amz,
      brand: this.brand
    };
  }
}

module.exports = {
  ProductData,
  DBProduct
};
