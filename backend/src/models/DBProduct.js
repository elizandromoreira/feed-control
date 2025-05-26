/**
 * Modelo de produto do banco de dados
 * 
 * Este módulo define a classe DBProduct, que representa um produto
 * conforme armazenado no banco de dados.
 */

/**
 * Classe que representa um produto do banco de dados
 */
class DBProduct {
  /**
   * Construtor da classe DBProduct
   * @param {string} sku - SKU do produto
   * @param {string} asin - ASIN do produto
   * @param {string} sku2 - SKU secundário do produto
   * @param {string} source - Fonte do produto
   */
  constructor(sku = '', asin = '', sku2 = '', source = '') {
    this.sku = sku;
    this.asin = asin;
    this.sku2 = sku2;
    this.source = source;
    this.supplier_price = 0;
    this.freight_cost = 0;
    this.lead_time = '';
    this.lead_time_2 = 0;
    this.total_price = 0;
    this.quantity = 0;
    this.tax_supplier = 0;
    this.availability = '';
    this.customer_price_shipping = 0;
    this.supplier_price_shipping = 0;
    this.handling_time_amz = 0;
    this.brand = '';
  }

  /**
   * Cria uma instância de DBProduct a partir de uma linha do banco de dados
   * @param {Object} row - Linha do banco de dados
   * @returns {DBProduct} - Instância de DBProduct
   */
  static fromDatabaseRow(row) {
    const product = new DBProduct(
      row.sku,
      row.asin,
      row.sku2,
      row.source
    );
    
    if (row.supplier_price) product.supplier_price = parseFloat(row.supplier_price);
    if (row.freight_cost) product.freight_cost = parseFloat(row.freight_cost);
    if (row.lead_time) product.lead_time = row.lead_time;
    if (row.lead_time_2) product.lead_time_2 = parseInt(row.lead_time_2, 10);
    if (row.total_price) product.total_price = parseFloat(row.total_price);
    if (row.quantity) product.quantity = parseInt(row.quantity, 10);
    if (row.tax_supplier) product.tax_supplier = parseFloat(row.tax_supplier);
    if (row.availability) product.availability = row.availability;
    if (row.customer_price_shipping) product.customer_price_shipping = parseFloat(row.customer_price_shipping);
    if (row.supplier_price_shipping) product.supplier_price_shipping = parseFloat(row.supplier_price_shipping);
    if (row.handling_time_amz) product.handling_time_amz = parseInt(row.handling_time_amz, 10);
    if (row.brand) product.brand = row.brand;
    
    return product;
  }
}

module.exports = { DBProduct };
