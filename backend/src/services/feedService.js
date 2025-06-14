const { Pool } = require('pg');
const { DB_CONFIG } = require('../config/db');
const logger = require('../config/logging')();

// Create pool instance
const pool = new Pool(DB_CONFIG);

/**
 * Feed Service - Manages Amazon feeds in the database
 */
class FeedService {
  /**
   * Save a feed to the database
   * @param {Object} feedData - Feed data object
   * @param {string} feedType - Type of feed ('inventory' or 'result')
   * @param {string} feedId - Feed ID (optional for inventory feeds)
   * @param {string} storeId - Store identifier
   * @param {string} filePath - Local file path (optional)
   * @returns {Promise<Object>} - Saved feed record
   */
  async saveFeed(feedData, feedType, feedId = null, storeId, filePath = null) {
    try {
      // Extract item count and summary based on feed type
      let itemCount = 0;
      let summary = null;
      
      if (feedType === 'inventory' && feedData.messages) {
        itemCount = feedData.messages.length;
      } else if (feedType === 'result' && feedData.summary) {
        summary = feedData.summary;
        itemCount = summary.messagesProcessed || 0;
      }
      
      const query = `
        INSERT INTO amazon_feeds 
        (feed_id, feed_type, timestamp, store_id, content, summary, status, item_count, file_path)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;
      
      const values = [
        feedId,
        feedType,
        new Date(),
        storeId,
        feedData,
        summary,
        'processed',
        itemCount,
        filePath
      ];
      
      const result = await pool.query(query, values);
      logger.store(storeId, 'info', `Feed saved to database: ${feedType}${feedId ? ` (ID: ${feedId})` : ''}`);
      return result.rows[0];
    } catch (error) {
      logger.store(storeId, 'error', `Error saving feed to database: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Get feeds by type and store
   * @param {string} feedType - Type of feed
   * @param {string} storeId - Store identifier
   * @param {number} limit - Result limit
   * @param {number} offset - Pagination offset
   * @returns {Promise<Array>} - Array of feeds
   */
  async getFeedsByTypeAndStore(feedType, storeId, limit = 100, offset = 0) {
    try {
      const query = `
        SELECT * FROM amazon_feeds
        WHERE feed_type = $1 AND store_id = $2
        ORDER BY timestamp DESC
        LIMIT $3 OFFSET $4
      `;
      
      const values = [feedType, storeId, limit, offset];
      const result = await pool.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error(`Error fetching feeds: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Get feed by ID
   * @param {string} feedId - Feed ID
   * @returns {Promise<Object|null>} - Feed record or null
   */
  async getFeedById(feedId) {
    try {
      const query = 'SELECT * FROM amazon_feeds WHERE feed_id = $1';
      const result = await pool.query(query, [feedId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Error fetching feed by ID: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Update feed status
   * @param {string} feedId - Feed ID
   * @param {string} status - New status
   * @returns {Promise<Object|null>} - Updated feed or null
   */
  async updateFeedStatus(feedId, status) {
    try {
      const query = `
        UPDATE amazon_feeds 
        SET status = $1, updated_at = NOW()
        WHERE feed_id = $2
        RETURNING *
      `;
      
      const result = await pool.query(query, [status, feedId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Error updating feed status: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Get feed statistics by store
   * @param {string} storeId - Store identifier
   * @returns {Promise<Object>} - Statistics object
   */
  async getFeedStatsByStore(storeId) {
    try {
      const query = `
        SELECT 
          feed_type,
          COUNT(*) as count,
          SUM(item_count) as total_items,
          MAX(timestamp) as last_feed_time
        FROM amazon_feeds
        WHERE store_id = $1
        GROUP BY feed_type
      `;
      
      const result = await pool.query(query, [storeId]);
      
      const stats = {
        inventory: { count: 0, totalItems: 0, lastFeedTime: null },
        result: { count: 0, totalItems: 0, lastFeedTime: null }
      };
      
      result.rows.forEach(row => {
        stats[row.feed_type] = {
          count: parseInt(row.count),
          totalItems: parseInt(row.total_items) || 0,
          lastFeedTime: row.last_feed_time
        };
      });
      
      return stats;
    } catch (error) {
      logger.error(`Error fetching feed statistics: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Delete old feeds (cleanup)
   * @param {number} daysToKeep - Number of days to keep feeds
   * @returns {Promise<number>} - Number of deleted records
   */
  async deleteOldFeeds(daysToKeep = 30) {
    try {
      const query = `
        DELETE FROM amazon_feeds
        WHERE timestamp < NOW() - INTERVAL '${daysToKeep} days'
        RETURNING id
      `;
      
      const result = await pool.query(query);
      const deletedCount = result.rows.length;
      
      if (deletedCount > 0) {
        logger.info(`Deleted ${deletedCount} old feeds (older than ${daysToKeep} days)`);
      }
      
      return deletedCount;
    } catch (error) {
      logger.error(`Error deleting old feeds: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Check if feed exists by ID
   * @param {string} feedId - Feed ID
   * @returns {Promise<boolean>} - True if exists
   */
  async feedExists(feedId) {
    try {
      const query = 'SELECT 1 FROM amazon_feeds WHERE feed_id = $1 LIMIT 1';
      const result = await pool.query(query, [feedId]);
      return result.rows.length > 0;
    } catch (error) {
      logger.error(`Error checking feed existence: ${error.message}`, { error });
      throw error;
    }
  }

  /**
   * Update the most recent feed record with Amazon feed ID
   * @param {string} feedId - Amazon feed ID
   * @param {string} storeId - Store identifier
   * @returns {Promise<Object|null>} - Updated feed or null
   */
  async updateLatestFeedWithId(feedId, storeId) {
    try {
      const query = `
        UPDATE amazon_feeds 
        SET feed_id = $1, updated_at = NOW()
        WHERE id = (
          SELECT id FROM amazon_feeds 
          WHERE store_id = $2 AND feed_id IS NULL 
          ORDER BY created_at DESC 
          LIMIT 1
        )
        RETURNING *
      `;
      
      const result = await pool.query(query, [feedId, storeId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error(`Error updating latest feed with ID: ${error.message}`, { error });
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new FeedService();
