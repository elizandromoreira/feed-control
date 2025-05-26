# ============================================================
# FASE 2 - ENVIO PARA AMAZON
# ============================================================

def extract_updated_data_phase2():
    """Extrai produtos atualizados do banco para Phase 2."""
    conn = get_db_connection()
    if not conn:
        logger.error("Não foi possível obter conexão com o banco para Phase 2.")
        return None
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT sku2, handling_time_amz, quantity 
                FROM produtos 
                WHERE atualizado = %s AND sku2 LIKE 'SEVC%%'
            """, (STORE_ATUALIZADO,))
            rows = cur.fetchall()
        if rows:
            logger.info(f"{len(rows)} produtos extraídos para envio na Phase 2.")
            return rows
        logger.info("Nenhum produto atualizado encontrado para envio na Phase 2.")
        return None
    except Exception as e:
        logger.error(f"Erro ao acessar o banco de dados na Phase 2: {e}")
        return None
    finally:
        return_db_connection(conn)

def create_inventory_feed_phase2(data):
    """Cria o feed de inventário em JSON para envio à Amazon."""
    try:
        messages = []
        for i, (sku2, handling_time_amz, quantity) in enumerate(data, 1):
            message = {
                "messageId": i,
                "operationType": "PARTIAL_UPDATE",
                "sku": sku2,
                "productType": "PRODUCT",
                "attributes": {
                    "fulfillment_availability": [
                        {
                            "fulfillment_channel_code": "DEFAULT",
                            "quantity": quantity,
                            "lead_time_to_ship_max_days": handling_time_amz,
                        }
                    ]
                }
            }
            messages.append(message)
        feed = {
            "header": {
                "sellerId": AMAZON_CONFIG["seller_id"],
                "version": "2.0",
                "issueLocale": "en_US"
            },
            "messages": messages
        }
        if validar_feed_json(feed):
            logger.info(f"Feed de inventário criado com {len(messages)} produtos na Phase 2.")
            return feed
        logger.error("Validação do feed JSON falhou na Phase 2.")
        return None
    except Exception as e:
        logger.error(f"Erro ao criar feed JSON na Phase 2: {e}")
        return None

def save_feed_locally_phase2(feed_data, batch_num=None):
    """Salva o feed localmente para auditoria (Phase 2)."""
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    batch_suffix = f"_batch{batch_num}" if batch_num is not None else ""
    filename = f'vitacost_feed{batch_suffix}_{timestamp}.json'
    filepath = os.path.join(FEEDS_DIR, filename)
    try:
        with open(filepath, 'w') as f:
            json.dump(feed_data, f, indent=2)
        logger.info(f"Feed salvo localmente na Phase 2: {filepath}")
        return filepath
    except Exception as e:
        logger.error(f"Erro ao salvar feed localmente na Phase 2: {e}")
        return None

def get_sp_api_access_token():
    """Obtém token de acesso para a SP API."""
    # Atualiza as credenciais antes de obter o token
    amazon_creds = get_amazon_credentials()
    if amazon_creds:
        global AMAZON_CONFIG
        AMAZON_CONFIG = amazon_creds
    else:
        logger.error("Não foi possível obter as credenciais da Amazon para gerar o token.")
        return None

    url = "https://api.amazon.com/auth/o2/token"
    data = {
        "grant_type": "refresh_token",
        "client_id": AMAZON_CONFIG["client_id"],
        "client_secret": AMAZON_CONFIG["client_secret"],
        "refresh_token": AMAZON_CONFIG["refresh_token"]
    }
    try:
        response = requests_retry_session().post(url, data=data)
        response.raise_for_status()
        token = response.json().get('access_token')
        if token:
            logger.info("Token de acesso SP API obtido com sucesso.")
            return token
        logger.error("Token de acesso não encontrado na resposta.")
        return None
    except Exception as e:
        logger.error(f"Erro ao obter token de acesso: {e}")
        return None

def create_feed_document(access_token):
    """Cria um documento de feed na SP API."""
    url = "https://sellingpartnerapi-na.amazon.com/feeds/2021-06-30/documents"
    headers_req = {
        "Content-Type": "application/json",
        "x-amz-access-token": access_token
    }
    payload = {"contentType": "application/json"}
    try:
        response = requests_retry_session().post(url, headers=headers_req, json=payload)
        if response.status_code == 201:
            feed_document = response.json()
            logger.info(f"Feed document criado com sucesso. ID: {feed_document.get('feedDocumentId')}")
            return feed_document
        logger.error(f"Erro ao criar feed document: {response.status_code} - {response.text}")
        return None
    except Exception as e:
        logger.error(f"Erro ao criar feed document: {e}")
        return None

def upload_feed_to_s3(feed_content, upload_url):
    """Faz upload do feed para o S3."""
    headers_req = {"Content-Type": "application/json"}
    try:
        response = requests_retry_session().put(upload_url, headers=headers_req, data=json.dumps(feed_content))
        if response.status_code == 200:
            logger.info("Upload do feed para o S3 concluído com sucesso.")
            return True
        logger.error(f"Erro ao fazer upload para o S3: {response.status_code} - {response.text}")
        return False
    except Exception as e:
        logger.error(f"Erro ao fazer upload para o S3: {e}")
        return False

def enviar_feed(feed_document_id, access_token, marketplace_id):
    """Envia o feed para processamento."""
    url = "https://sellingpartnerapi-na.amazon.com/feeds/2021-06-30/feeds"
    headers_req = {
        "Content-Type": "application/json",
        "x-amz-access-token": access_token
    }
    payload = {
        "feedType": "JSON_LISTINGS_FEED",
        "marketplaceIds": [marketplace_id],
        "inputFeedDocumentId": feed_document_id
    }
    
    for attempt in range(MAX_RETRIES):
        try:
            response = requests_retry_session().post(url, headers=headers_req, json=payload)
            if response.status_code == 202:
                feed_id = response.json().get("feedId")
                if feed_id:
                    logger.info(f"Feed enviado com sucesso. Feed ID: {feed_id}")
                    return feed_id
                logger.error("Feed ID não encontrado na resposta.")
                return None
                
            elif response.status_code == 429:
                if attempt < MAX_RETRIES - 1:
                    retry_after = int(response.headers.get('Retry-After', '300'))
                    logger.warning(f"Taxa limite excedida (429). Tentando novamente em {retry_after} segundos.")
                    time.sleep(retry_after)
                    continue
            else:
                logger.error(f"Erro ao enviar o feed: {response.status_code} - {response.text}")
                return None
                
        except Exception as e:
            logger.error(f"Erro ao enviar o feed: {e}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY_SECONDS)
                continue
            return None
            
    logger.error("Todas as tentativas falharam ao enviar o feed.")
    return None

def verificar_status_feed(feed_id, access_token, max_attempts=20):
    """Monitora o status do feed até a conclusão."""
    url = f"https://sellingpartnerapi-na.amazon.com/feeds/2021-06-30/feeds/{feed_id}"
    headers_req = {
        "Content-Type": "application/json",
        "x-amz-access-token": access_token
    }
    
    for attempt in range(1, max_attempts + 1):
        try:
            response = requests_retry_session().get(url, headers=headers_req)
            
            if response.status_code == 200:
                feed_status = response.json()
                processing_status = feed_status.get("processingStatus")
                logger.info(f"Status do feed {feed_id}: {processing_status}")
                
                if processing_status == "DONE":
                    logger.info("Processamento do feed concluído com sucesso.")
                    return feed_status
                elif processing_status in ["CANCELLED", "FATAL"]:
                    logger.error("O processamento do feed falhou ou foi cancelado.")
                    return feed_status
                
                # Verificação normal - aguarda 30 segundos
                delay_seconds = STATUS_CHECK_INTERVAL
                logger.info(f"Aguardando {delay_seconds} segundos antes da próxima verificação...")
                time.sleep(delay_seconds)
                    
            elif response.status_code == 429:
                delay_temp = int(response.headers.get('Retry-After', RETRY_DELAY_SECONDS))
                logger.warning(f"Taxa limite excedida ao verificar status. Aguardando {delay_temp} segundos.")
                time.sleep(delay_temp)
                continue
                
            else:
                logger.error(f"Erro ao verificar o status do feed: {response.status_code} - {response.text}")
                time.sleep(STATUS_CHECK_INTERVAL)
                continue
                
        except Exception as e:
            logger.error(f"Erro ao verificar o status do feed: {e}")
            time.sleep(STATUS_CHECK_INTERVAL)
            continue
    
    logger.error("Tempo limite excedido ao verificar o status do feed.")
    return None

def baixar_relatorio(result_feed_document_id, access_token):
    """Baixa e processa o relatório do feed."""
    url = f"https://sellingpartnerapi-na.amazon.com/feeds/2021-06-30/documents/{result_feed_document_id}"
    headers_req = {
        "Content-Type": "application/json",
        "x-amz-access-token": access_token
    }
    try:
        response = requests_retry_session().get(url, headers=headers_req)
        if response.status_code == 200:
            document_info = response.json()
            download_url = document_info.get('url')
            if download_url:
                response_download = requests_retry_session().get(download_url)
                if response_download.status_code == 200:
                    logger.info("Relatório baixado com sucesso.")
                    content = response_download.content
                    try:
                        with gzip.GzipFile(fileobj=io.BytesIO(content)) as gz_file:
                            decompressed_content = gz_file.read().decode('utf-8')
                    except (OSError, IOError):
                        decompressed_content = content.decode('utf-8')
                    try:
                        report_json = json.loads(decompressed_content)
                        logger.info("Conteúdo do relatório (JSON):")
                        logger.info(json.dumps(report_json, indent=2))
                        return report_json
                    except json.JSONDecodeError as e:
                        logger.error(f"Erro ao decodificar JSON: {e}")
                        logger.info("Conteúdo do relatório (texto bruto):")
                        logger.info(decompressed_content)
                        return decompressed_content
                else:
                    logger.error(f"Erro ao baixar o relatório: {response_download.status_code}")
            else:
                logger.error("URL do relatório não encontrada.")
        elif response.status_code == 429:
            retry_after = response.headers.get('Retry-After', '60')
            delay = int(retry_after)
            logger.warning(f"Taxa limite excedida ao baixar relatório. Tentando novamente em {delay} segundos.")
            time.sleep(delay)
            return baixar_relatorio(result_feed_document_id, access_token)
        else:
            logger.error(f"Erro ao obter o relatório do feed: {response.status_code} - {response.text}")
    except Exception as e:
        logger.error(f"Erro ao baixar o relatório: {e}")
    return None

def reset_updated_flag():
    """Reseta a flag 'atualizado' para produtos Vitacost após processamento."""
    conn = get_db_connection()
    if not conn:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE produtos 
                SET atualizado = 0 
                WHERE atualizado = %s AND sku2 LIKE 'SEVC%%'
            """, (STORE_ATUALIZADO,))
            conn.commit()
        logger.info(f"Flag 'atualizado' resetada com sucesso para produtos Vitacost (de {STORE_ATUALIZADO} para 0).")
        return True
    except Exception as e:
        logger.error(f"Erro ao resetar a flag 'atualizado': {e}")
        return False
    finally:
        return_db_connection(conn)

def process_in_batches(data, batch_size=9990):
    """Processa os dados em lotes para evitar limites da API."""
    if not data:
        return False
        
    total_products = len(data)
    num_batches = (total_products + batch_size - 1) // batch_size  # Arredonda para cima
    
    logger.info(f"Processando {total_products} produtos em {num_batches} lotes de {batch_size}")
    
    # Obtém token de acesso da Amazon
    access_token = get_sp_api_access_token()
    if not access_token:
        return False
    
    success = True
    for batch_num in range(1, num_batches + 1):
        start_idx = (batch_num - 1) * batch_size
        end_idx = min(batch_num * batch_size, total_products)
        batch_data = data[start_idx:end_idx]
        
        logger.info(f"Processando lote {batch_num}/{num_batches} com {len(batch_data)} produtos")
        
        # Cria o feed de inventário para o lote
        feed = create_inventory_feed_phase2(batch_data)
        if not feed:
            success = False
            continue
        
        # Salva o feed localmente
        save_feed_locally_phase2(feed, batch_num)
        
        # Cria documento de feed
        feed_document = create_feed_document(access_token)
        if not feed_document:
            success = False
            continue
        
        # Faz upload do feed para o S3
        if not upload_feed_to_s3(feed, feed_document.get('url')):
            success = False
            continue
        
        # Envia o feed para a Amazon
        feed_id = enviar_feed(feed_document.get('feedDocumentId'), access_token, AMAZON_CONFIG["marketplace_id"])
        if not feed_id:
            success = False
            continue
        
        # Verifica o status do feed
        feed_result = verificar_status_feed(feed_id, access_token)
        if feed_result and "resultFeedDocumentId" in feed_result:
            # Baixa o relatório do feed
            baixar_relatorio(feed_result["resultFeedDocumentId"], access_token)
        else:
            success = False
    
    # Reseta a flag 'atualizado' para os produtos processados
    if success:
        reset_updated_flag()
    
    return success

def main_phase2():
    """Executa todo o processo de envio de feed JSON."""
    logger.info("Iniciando Phase 2 - Envio de dados para Amazon")
    
    # Carrega credenciais da Amazon
    amazon_creds = get_amazon_credentials()
    if amazon_creds:
        global AMAZON_CONFIG
        AMAZON_CONFIG = amazon_creds
        logger.info("Credenciais da Amazon carregadas com sucesso")
    else:
        logger.error("Falha ao carregar credenciais da Amazon")
        return False
    
    # Extrai dados atualizados
    data = extract_updated_data_phase2()
    if not data:
        logger.info("Phase 2: Nenhum produto atualizado encontrado para envio.")
        return False
    
    # Processa os dados em lotes
    success = process_in_batches(data)
    
    if success:
        logger.info("Processamento da Phase 2 finalizado com sucesso.")
    else:
        logger.warning("Processamento da Phase 2 finalizado com alguns erros.")
    
    return success 

# ============================================================
# FUNÇÕES PRINCIPAIS
# ============================================================

async def run_phase1():
    """Executa a fase 1 do processo: atualização dos produtos."""
    try:
        logger.info("Iniciando Fase 1: Atualização dos produtos")
        sync = ProductSyncVitacost(DB_CONFIG, API_BASE_URL, requests_per_second=1.0)
        await sync.setup()
        
        # Executa a atualização dos produtos
        await sync.update_all_products(batch_size=10, max_concurrent=5)
        
        # Fecha as conexões
        await sync.close()
        
        logger.info("Fase 1 concluída com sucesso")
        return True
        
    except Exception as e:
        logger.error(f"Erro na Fase 1: {e}")
        traceback.print_exc()
        return False

def run_phase2():
    """Executa a fase 2 do processo: envio para Amazon."""
    try:
        logger.info("Iniciando Fase 2: Envio para Amazon")
        success = main_phase2()
        if success:
            logger.info("Fase 2 concluída com sucesso")
        else:
            logger.error("Fase 2 falhou")
        return success
    except Exception as e:
        logger.error(f"Erro na Fase 2: {e}")
        traceback.print_exc()
        return False

async def main():
    """Função principal que executa as duas fases do processo."""
    logger.info("Iniciando o processo de sincronização Vitacost")
    
    # Carrega a skip_list
    global skip_list
    skip_list = load_skip_list()
    
    try:
        # Fase 1: Atualização dos produtos
        phase1_success = await run_phase1()
        
        if not phase1_success:
            logger.error("Fase 1 falhou, continuando com a Fase 2")
        
        # Fase 2: Envio de dados para Amazon
        phase2_success = run_phase2()
        
        return phase1_success and phase2_success
        
    except Exception as e:
        logger.error(f"Erro durante a execução: {e}")
        traceback.print_exc()
        return False

def run():
    """Função de entrada para executar o processo completo."""
    try:
        success = asyncio.run(main())
        if success:
            logger.info("Processo completo executado com sucesso")
            return 0
        else:
            logger.error("Processo completo falhou")
            return 1
    except Exception as e:
        logger.error(f"Erro fatal durante a execução: {e}")
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(run()) 