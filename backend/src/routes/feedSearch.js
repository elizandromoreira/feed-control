const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { DB_CONFIG } = require('../config/db');

const pool = new Pool(DB_CONFIG);

/**
 * Search for a SKU in all feeds
 * GET /api/feeds/search/:sku
 */
router.get('/search/:sku', async (req, res) => {
  const { sku } = req.params;
  
  try {
    const query = `
      SELECT 
        af.id as feed_id,
        af.feed_type,
        af.store_id,
        af.status,
        af.created_at,
        af.file_path,
        product->>'sku' as sku,
        product->>'messageId' as message_id,
        product->>'operationType' as operation_type,
        product->>'productType' as product_type,
        product->'attributes' as attributes,
        product->'attributes'->'fulfillment_availability'->0->>'quantity' as quantity,
        product->'attributes'->'fulfillment_availability'->0->>'fulfillment_channel_code' as channel,
        product->'attributes'->'fulfillment_availability'->0->>'lead_time_to_ship_max_days' as lead_time
      FROM amazon_feeds af,
           jsonb_array_elements(content->'messages') as product
      WHERE product->>'sku' = $1
      ORDER BY af.created_at DESC
      LIMIT 50
    `;
    
    const result = await pool.query(query, [sku]);
    
    if (result.rows.length === 0) {
      return res.json({
        success: true,
        message: `No data found for SKU: ${sku}`,
        data: []
      });
    }
    
    // Group by feed for better organization
    const feedsMap = new Map();
    
    result.rows.forEach(row => {
      if (!feedsMap.has(row.feed_id)) {
        feedsMap.set(row.feed_id, {
          feed_id: row.feed_id,
          feed_type: row.feed_type,
          store_id: row.store_id,
          status: row.status,
          created_at: row.created_at,
          file_path: row.file_path,
          products: []
        });
      }
      
      feedsMap.get(row.feed_id).products.push({
        sku: row.sku,
        message_id: row.message_id,
        operation_type: row.operation_type,
        product_type: row.product_type,
        quantity: row.quantity,
        channel: row.channel,
        lead_time: row.lead_time,
        attributes: row.attributes
      });
    });
    
    const feeds = Array.from(feedsMap.values());
    
    res.json({
      success: true,
      sku: sku,
      total_feeds: feeds.length,
      data: feeds
    });
    
  } catch (error) {
    console.error('Error searching for SKU:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search for SKU',
      message: error.message
    });
  }
});

/**
 * Get SKU history (quantity changes over time)
 * GET /api/feeds/history/:sku
 */
router.get('/history/:sku', async (req, res) => {
  const { sku } = req.params;
  
  try {
    const query = `
      SELECT 
        af.created_at,
        af.feed_type,
        af.store_id,
        product->'attributes'->'fulfillment_availability'->0->>'quantity' as quantity,
        product->>'operationType' as operation_type
      FROM amazon_feeds af,
           jsonb_array_elements(content->'messages') as product
      WHERE product->>'sku' = $1
        AND af.feed_type = 'inventory'
      ORDER BY af.created_at DESC
      LIMIT 100
    `;
    
    const result = await pool.query(query, [sku]);
    
    res.json({
      success: true,
      sku: sku,
      history: result.rows
    });
    
  } catch (error) {
    console.error('Error getting SKU history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get SKU history',
      message: error.message
    });
  }
});

/**
 * Search multiple SKUs at once
 * POST /api/feeds/search-multiple
 * Body: { skus: ['SKU1', 'SKU2', ...] }
 */
router.post('/search-multiple', async (req, res) => {
  const { skus } = req.body;
  
  if (!Array.isArray(skus) || skus.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Please provide an array of SKUs'
    });
  }
  
  try {
    const query = `
      SELECT 
        product->>'sku' as sku,
        MAX(af.created_at) as last_seen,
        COUNT(DISTINCT af.id) as feed_count,
        (
          SELECT product2->'attributes'->'fulfillment_availability'->0->>'quantity'
          FROM amazon_feeds af2,
               jsonb_array_elements(content->'messages') as product2
          WHERE product2->>'sku' = product->>'sku'
          ORDER BY af2.created_at DESC
          LIMIT 1
        ) as current_quantity
      FROM amazon_feeds af,
           jsonb_array_elements(content->'messages') as product
      WHERE product->>'sku' = ANY($1::text[])
      GROUP BY product->>'sku'
    `;
    
    const result = await pool.query(query, [skus]);
    
    res.json({
      success: true,
      searched_skus: skus,
      found_skus: result.rows.length,
      data: result.rows
    });
    
  } catch (error) {
    console.error('Error searching multiple SKUs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search multiple SKUs',
      message: error.message
    });
  }
});

module.exports = router;
