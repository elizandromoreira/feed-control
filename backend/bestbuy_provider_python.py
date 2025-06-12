#!/usr/bin/env python3
"""
Best Buy Provider - Python Version
Versão alternativa em Python para comparação com a versão JavaScript
"""

import time
import requests
import psycopg2
import psycopg2.extras
from datetime import datetime
from typing import List, Dict, Optional
import logging
import concurrent.futures
import threading

# Configuração de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

class BestBuyProviderPython:
    def __init__(self, config: Dict):
        self.api_base_url = "http://167.114.223.83:3005/bb/api"
        self.stock_level = config.get('stock_level', 20)
        self.handling_time_omd = config.get('handling_time_omd', 1)
        self.provider_specific_handling_time = config.get('provider_specific_handling_time', 3)
        self.update_flag_value = config.get('update_flag_value', 4)
        
        # Database config - CORRIGIDO com dados reais
        self.db_config = {
            'dbname': 'postgres',
            'user': 'postgres.bvbnofnnbfdlnpuswlgy',
            'host': 'aws-0-us-east-1.pooler.supabase.com',
            'password': 'Bi88An6B9L0EIihL',
            'port': 6543
        }
        
        self.db_connection = None
        
    def init_db(self):
        """Inicializa a conexão do banco"""
        try:
            self.db_connection = psycopg2.connect(**self.db_config)
            self.db_connection.autocommit = True
            logger.info("🐍 Python - Database connection initialized successfully")
        except Exception as e:
            logger.error(f"🐍 Python - Database initialization failed: {e}")
            raise
            
    def close_db(self):
        """Fecha a conexão do banco"""
        if self.db_connection:
            self.db_connection.close()
            logger.info("🐍 Python - Database connection closed")
    
    def fetch_product_data(self, sku: str) -> Dict:
        """Busca dados de um produto na API"""
        url = f"{self.api_base_url}/{sku}"
        
        try:
            response = requests.get(url, timeout=30)
            
            if response.status_code == 200:
                data = response.json()
                
                if data.get('success') and data.get('data'):
                    api_data = data['data']
                    
                    # Log da resposta da API
                    logger.info(f"🐍 [{sku}] API Response - Availability: \"{api_data.get('availability', '')}\", Price: {api_data.get('price', 0)}")
                    
                    # Transformação simples e direta
                    is_in_stock = api_data.get('availability', '').lower() == 'instock'
                    price = float(api_data.get('price', 0))
                    brand = api_data.get('brand', '') or ''
                    
                    result = {
                        'sku': sku,
                        'price': price,
                        'brand': brand,
                        'quantity': self.stock_level if is_in_stock else 0,
                        'availability': 'inStock' if is_in_stock else 'outOfStock',
                        'handlingTime': self.handling_time_omd + self.provider_specific_handling_time
                    }
                    
                    logger.info(f"🐍 [{sku}] Transformed - isInStock: {is_in_stock}, Final Availability: \"{result['availability']}\", Final Price: {result['price']}, Final Qty: {result['quantity']}")
                    
                    return result
                else:
                    logger.error(f"🐍 [{sku}] API returned invalid data structure")
                    
            else:
                logger.error(f"🐍 [{sku}] API returned status {response.status_code}")
                    
        except requests.exceptions.Timeout:
            logger.error(f"🐍 [{sku}] API request timeout")
        except Exception as e:
            logger.error(f"🐍 [{sku}] API request failed: {e}")
        
        # Retorno padrão em caso de erro
        return {
            'sku': sku,
            'price': 0,
            'brand': '',
            'quantity': 0,
            'availability': 'outOfStock',
            'handlingTime': self.handling_time_omd + self.provider_specific_handling_time
        }
    
    def fetch_product_data_with_retry(self, sku: str, max_retries: int = 3) -> Dict:
        """Busca dados com retry inteligente"""
        last_valid_response = None
        
        for attempt in range(1, max_retries + 1):
            try:
                product_data = self.fetch_product_data(sku)
                
                # Análise inteligente da resposta
                analysis = self.analyze_response(product_data, sku, attempt)
                
                if analysis['is_valid']:
                    if attempt > 1:
                        logger.info(f"🐍 [{sku}] ✅ Valid response on attempt {attempt}: {product_data['availability']}/${product_data['price']}")
                    return product_data
                
                # Se a resposta é suspeita mas é a melhor que temos
                if self.is_better_response(product_data, last_valid_response):
                    last_valid_response = product_data
                
                logger.warning(f"🐍 [{sku}] ⚠️ Attempt {attempt}: {analysis['reason']}")
                
                if attempt < max_retries:
                    delay = self.calculate_retry_delay(attempt, analysis['severity'])
                    logger.info(f"🐍 [{sku}] 🔄 Retrying in {delay}ms... ({attempt}/{max_retries})")
                    time.sleep(delay / 1000)
                else:
                    logger.warning(f"🐍 [{sku}] ❌ Max retries reached, using best available response")
                    return last_valid_response or product_data
                    
            except Exception as e:
                logger.error(f"🐍 [{sku}] 💥 Attempt {attempt} failed: {e}")
                
                if attempt < max_retries:
                    delay = self.calculate_retry_delay(attempt, 'high')
                    logger.info(f"🐍 [{sku}] 🔄 Retrying in {delay}ms... ({attempt}/{max_retries})")
                    time.sleep(delay / 1000)
                else:
                    logger.error(f"🐍 [{sku}] ❌ All {max_retries} attempts failed, marking as outOfStock")
                    return {
                        'sku': sku,
                        'price': 0,
                        'brand': '',
                        'quantity': 0,
                        'availability': 'outOfStock',
                        'handlingTime': self.handling_time_omd + self.provider_specific_handling_time
                    }
        
        return last_valid_response or product_data
    
    def analyze_response(self, product_data: Dict, sku: str, attempt: int) -> Dict:
        """Analisa a qualidade da resposta da API"""
        analysis = {
            'is_valid': True,
            'reason': '',
            'severity': 'low'
        }
        
        price = product_data.get('price', 0)
        availability = product_data.get('availability', '')
        
        # Padrão 1: OutOfStock com preço > 0 (muito suspeito)
        if availability == 'outOfStock' and price > 0:
            analysis['is_valid'] = False
            analysis['reason'] = f"Suspicious: outOfStock but price ${price}"
            analysis['severity'] = 'high'
            return analysis
        
        # Padrão 2: Preço $0 com outOfStock (pode ser erro da API)
        if price == 0 and availability == 'outOfStock':
            analysis['is_valid'] = False
            analysis['reason'] = f"Suspicious: outOfStock with $0 - may be API error"
            analysis['severity'] = 'medium'
            return analysis
        
        # Padrão 3: Preço muito baixo para produtos eletrônicos (< $5)
        if 0 < price < 5:
            analysis['is_valid'] = False
            analysis['reason'] = f"Suspicious: unusually low price ${price}"
            analysis['severity'] = 'medium'
            return analysis
        
        # Padrão 4: Preço muito alto (> $10000) - pode ser erro
        if price > 10000:
            analysis['is_valid'] = False
            analysis['reason'] = f"Suspicious: unusually high price ${price}"
            analysis['severity'] = 'low'
            return analysis
        
        return analysis
    
    def is_better_response(self, current: Dict, previous: Optional[Dict]) -> bool:
        """Verifica se a resposta atual é melhor que a anterior"""
        if not previous:
            return True
        
        current_price = current.get('price', 0)
        previous_price = previous.get('price', 0)
        current_availability = current.get('availability', '')
        previous_availability = previous.get('availability', '')
        
        # Prefere respostas com preço > 0
        if current_price > 0 and previous_price == 0:
            return True
        
        # Prefere respostas InStock
        if current_availability == 'inStock' and previous_availability == 'outOfStock':
            return True
        
        return False
    
    def calculate_retry_delay(self, attempt: int, severity: str) -> int:
        """Calcula delay inteligente baseado na severidade do erro"""
        base_delay = 1000  # 1 segundo base
        multiplier = attempt  # Delay progressivo
        
        severity_multipliers = {
            'low': 1,
            'medium': 1.5,
            'high': 2
        }
        
        return int(base_delay * multiplier * severity_multipliers.get(severity, 1))
    
    def update_product_in_db(self, product_data: Dict) -> Dict:
        """Atualiza um produto no banco de dados"""
        sku = product_data['sku']
        
        try:
            cursor = self.db_connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Buscar dados atuais do banco
            cursor.execute(
                "SELECT supplier_price, quantity, availability, brand, lead_time, lead_time_2, handling_time_amz FROM produtos WHERE sku = %s",
                (sku,)
            )
            current_data = cursor.fetchone()
            
            if not current_data:
                logger.warning(f"🐍 [{sku}] Product not found in database")
                return {'status': 'failed', 'message': 'Product not found'}
            
            # Verificar se há mudanças
            has_changes = (
                float(current_data['supplier_price'] or 0) != product_data['price'] or
                int(current_data['quantity'] or 0) != product_data['quantity'] or
                str(current_data['availability'] or '') != product_data['availability'] or
                str(current_data['brand'] or '') != product_data['brand'] or
                int(current_data['lead_time'] or 0) != self.handling_time_omd or
                int(current_data['lead_time_2'] or 0) != self.provider_specific_handling_time or
                int(current_data['handling_time_amz'] or 0) != product_data['handlingTime']
            )
            
            if not has_changes:
                # Apenas atualizar last_update
                cursor.execute(
                    "UPDATE produtos SET last_update = %s WHERE sku = %s",
                    (datetime.now(), sku)
                )
                return {'status': 'no_update'}
            
            # Log detalhado da atualização
            logger.info(f"🐍 [{sku}] DB Update - Old: {current_data['availability']}/${current_data['supplier_price']}, New: {product_data['availability']}/${product_data['price']}")
            
            # Atualizar produto
            cursor.execute("""
                UPDATE produtos SET 
                    supplier_price=%s, quantity=%s, availability=%s, brand=%s,
                    lead_time=%s, lead_time_2=%s, handling_time_amz=%s,
                    last_update=%s, atualizado=%s
                WHERE sku = %s
            """, (
                product_data['price'],
                product_data['quantity'],
                product_data['availability'],
                product_data['brand'],
                self.handling_time_omd,
                self.provider_specific_handling_time,
                product_data['handlingTime'],
                datetime.now(),
                self.update_flag_value,
                sku
            ))
            
            # Verificar se a atualização foi aplicada
            if cursor.rowcount == 0:
                logger.error(f"🐍 [{sku}] Database update failed - no rows affected")
                return {'status': 'failed', 'message': 'No rows updated'}
            
            logger.info(f"🐍 [{sku}] Updated: {product_data['availability']}, Price: {product_data['price']}, Qty: {product_data['quantity']}")
            return {'status': 'updated'}
            
        except Exception as e:
            logger.error(f"🐍 [{sku}] Update failed: {e}")
            return {'status': 'failed', 'message': str(e)}
    
    def process_products(self, skus: List[str], batch_size: int = 25, max_concurrent: int = 10) -> Dict:
        """Processa uma lista de SKUs"""
        logger.info(f"🐍 Python - Processing {len(skus)} products with batch_size={batch_size}, max_concurrent={max_concurrent}")
        
        results = []
        
        # Processar em lotes
        for i in range(0, len(skus), batch_size):
            batch = skus[i:i + batch_size]
            batch_number = (i // batch_size) + 1
            
            logger.info(f"🐍 Processing batch {batch_number}: {len(batch)} products (batch size: {batch_size})")
            
            # Dentro de cada lote, processar com controle de concorrência
            for j in range(0, len(batch), max_concurrent):
                concurrent_batch = batch[j:j + max_concurrent]
                
                logger.info(f"🐍 Processing concurrent batch: {len(concurrent_batch)} products")
                
                # Processar em paralelo usando ThreadPoolExecutor
                with concurrent.futures.ThreadPoolExecutor(max_workers=max_concurrent) as executor:
                    # Buscar dados da API
                    api_futures = {
                        executor.submit(self.fetch_product_data_with_retry, sku): sku 
                        for sku in concurrent_batch
                    }
                    
                    products_data = []
                    for future in concurrent.futures.as_completed(api_futures):
                        products_data.append(future.result())
                    
                    # Atualizar no banco (sequencial para evitar conflitos)
                    batch_results = []
                    for product_data in products_data:
                        result = self.update_product_in_db(product_data)
                        batch_results.append(result)
                    
                    results.extend(batch_results)
                
                # Pequena pausa entre lotes concorrentes
                if j + max_concurrent < len(batch):
                    time.sleep(1)
            
            # Pausa entre lotes grandes
            if i + batch_size < len(skus):
                logger.info(f"🐍 Completed batch {batch_number}, pausing before next batch...")
                time.sleep(2)
        
        # Contar resultados
        success_count = sum(1 for r in results if r['status'] in ['updated', 'no_update'])
        updated_count = sum(1 for r in results if r['status'] == 'updated')
        failed_count = sum(1 for r in results if r['status'] == 'failed')
        
        return {
            'total_processed': len(results),
            'success_count': success_count,
            'updated_count': updated_count,
            'failed_count': failed_count,
            'results': results
        }

def test_python_provider():
    """Função de teste para comparar com a versão JavaScript"""
    logger.info("🐍 INICIANDO TESTE DO PROVIDER PYTHON")
    logger.info("=" * 60)
    
    # SKUs problemáticos identificados nos logs
    test_skus = [
        '6569319',  # Sistema: OutOfStock/$0, API: InStock/$1399.99
        '6583949',  # Sistema: OutOfStock/$69.99, API: OutOfStock/$69.99
        '6577453',  # Sistema: OutOfStock/$219.99, API: OutOfStock/$0
        '6529313',  # Sistema: OutOfStock/$43.99, API: OutOfStock/$0
        '6519664',  # Sistema: OutOfStock/$99.99, API: OutOfStock/$99.99
        '6442037',  # Sistema: OutOfStock/$349.99, API: OutOfStock/$0
        '6568259',  # Sistema: OutOfStock/$39.99, API: OutOfStock/$39.99
        '6537630'   # Sistema: OutOfStock/$129.99, API: OutOfStock/$129.99
    ]
    
    config = {
        'stock_level': 20,
        'handling_time_omd': 1,
        'provider_specific_handling_time': 3,
        'update_flag_value': 4
    }
    
    provider = BestBuyProviderPython(config)
    
    try:
        provider.init_db()
        
        start_time = time.time()
        results = provider.process_products(test_skus, batch_size=4, max_concurrent=3)
        end_time = time.time()
        
        logger.info(f"🐍 RESULTADOS DO TESTE PYTHON:")
        logger.info(f"🐍 Tempo de execução: {end_time - start_time:.2f} segundos")
        logger.info(f"🐍 Total processado: {results['total_processed']}")
        logger.info(f"🐍 Sucessos: {results['success_count']}")
        logger.info(f"🐍 Atualizados: {results['updated_count']}")
        logger.info(f"🐍 Falhas: {results['failed_count']}")
        
    finally:
        provider.close_db()

if __name__ == "__main__":
    test_python_provider() 