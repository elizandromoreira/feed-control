/**
 * Script to migrate existing feed files to Supabase database
 * 
 * This script reads all JSON feed files from the feeds directory
 * and migrates them to the amazon_feeds table in Supabase
 */

const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const { DB_CONFIG } = require('./src/config/db');
const feedService = require('./src/services/feedService');
const logger = require('./src/config/logging')();

// Create pool instance
const pool = new Pool(DB_CONFIG);

const FEEDS_DIR = path.join(__dirname, 'feeds');

// Configuration
const BATCH_SIZE = 100; // Process files in batches
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Extract store ID from feed content
 * @param {Object} feedData - Feed data
 * @param {string} fileName - File name
 * @returns {string} - Store ID
 */
function extractStoreId(feedData, fileName) {
  // Try to determine store from various sources
  
  // Check if there's a store identifier in the feed data
  if (feedData.storeId) {
    return feedData.storeId;
  }
  
  // Check seller ID mapping
  if (feedData.header && feedData.header.sellerId) {
    const sellerIdMap = {
      'A1SPSR0CFA01TC': 'amazon', // Default Amazon seller ID
      // Add more mappings as needed
    };
    
    if (sellerIdMap[feedData.header.sellerId]) {
      return sellerIdMap[feedData.header.sellerId];
    }
  }
  
  // Try to extract from filename patterns
  const storePatterns = {
    'vitacost': /vitacost/i,
    'homedepot': /home[-_]?depot/i,
    'bestbuy': /best[-_]?buy/i,
    'webstaurantstore': /webstaurant/i,
    'whitecap': /white[-_]?cap/i
  };
  
  for (const [store, pattern] of Object.entries(storePatterns)) {
    if (pattern.test(fileName)) {
      return store;
    }
  }
  
  // Default to 'amazon' if no specific store found
  return 'amazon';
}

/**
 * Parse timestamp from filename
 * @param {string} fileName - File name
 * @returns {Date} - Parsed date
 */
function parseTimestamp(fileName) {
  // Try to extract timestamp from inventory_feed_YYYY-MM-DDTHH-mm-ss-sssZ.json format
  const timestampMatch = fileName.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (timestampMatch) {
    // Reconstruct ISO timestamp
    const [, year, month, day, hour, minute, second, millisecond] = timestampMatch;
    const isoTimestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`;
    try {
      const date = new Date(isoTimestamp);
      if (!isNaN(date.getTime())) {
        return date;
      }
    } catch (e) {
      // Fall through to use current date
    }
  }
  
  // If no valid timestamp in filename, use current date
  return new Date();
}

/**
 * Process a single feed file
 * @param {string} filePath - Full path to file
 * @param {string} fileName - File name
 * @returns {Promise<Object>} - Migration result
 */
async function processFeedFile(filePath, fileName) {
  try {
    // Read file content
    const content = await fs.readFile(filePath, 'utf8');
    const feedData = JSON.parse(content);
    
    // Determine feed type
    let feedType, feedId;
    if (fileName.startsWith('inventory_feed_')) {
      feedType = 'inventory';
      feedId = null;
    } else if (fileName.startsWith('result_')) {
      feedType = 'result';
      feedId = fileName.replace('result_', '').replace('.json', '');
    } else {
      return {
        success: false,
        error: `Unknown file type: ${fileName}`
      };
    }
    
    // Extract metadata
    const storeId = extractStoreId(feedData, fileName);
    const timestamp = parseTimestamp(fileName);
    
    // Get file stats for additional metadata
    const stats = await fs.stat(filePath);
    
    if (DRY_RUN) {
      console.log(`[DRY RUN] Would migrate: ${fileName}`);
      console.log(`  Type: ${feedType}`);
      console.log(`  Store: ${storeId}`);
      console.log(`  Timestamp: ${timestamp.toISOString()}`);
      console.log(`  Size: ${stats.size} bytes`);
      if (feedId) console.log(`  Feed ID: ${feedId}`);
      return { success: true, dryRun: true };
    }
    
    // Check if feed already exists in database
    if (feedId && await feedService.feedExists(feedId)) {
      return {
        success: false,
        error: `Feed ${feedId} already exists in database`,
        skipped: true
      };
    }
    
    // Save to database
    const saved = await feedService.saveFeed(
      feedData,
      feedType,
      feedId,
      storeId,
      filePath
    );
    
    return {
      success: true,
      record: saved
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Main migration function
 */
async function migrateFeeds() {
  console.log('=== Feed Migration Script ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Feeds directory: ${FEEDS_DIR}`);
  console.log('');
  
  try {
    // Check if feeds directory exists
    try {
      await fs.access(FEEDS_DIR);
    } catch (error) {
      console.error(`Feeds directory not found: ${FEEDS_DIR}`);
      return;
    }
    
    // List all files
    const files = await fs.readdir(FEEDS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    console.log(`Found ${jsonFiles.length} JSON files to process`);
    console.log('');
    
    // Statistics
    const stats = {
      total: jsonFiles.length,
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };
    
    // Process files in batches
    for (let i = 0; i < jsonFiles.length; i += BATCH_SIZE) {
      const batch = jsonFiles.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(jsonFiles.length / BATCH_SIZE);
      
      console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`);
      
      // Process batch in parallel
      const promises = batch.map(fileName => {
        const filePath = path.join(FEEDS_DIR, fileName);
        return processFeedFile(filePath, fileName);
      });
      
      const results = await Promise.all(promises);
      
      // Update statistics
      results.forEach((result, index) => {
        const fileName = batch[index];
        
        if (result.success) {
          if (!result.dryRun) {
            console.log(`✓ Migrated: ${fileName}`);
          }
          stats.success++;
        } else if (result.skipped) {
          console.log(`⚠ Skipped: ${fileName} - ${result.error}`);
          stats.skipped++;
        } else {
          console.error(`✗ Failed: ${fileName} - ${result.error}`);
          stats.failed++;
          stats.errors.push({ file: fileName, error: result.error });
        }
      });
      
      // Add delay between batches to avoid overwhelming the database
      if (i + BATCH_SIZE < jsonFiles.length && !DRY_RUN) {
        console.log('Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    // Print summary
    console.log('\n=== Migration Summary ===');
    console.log(`Total files: ${stats.total}`);
    console.log(`Successfully migrated: ${stats.success}`);
    console.log(`Skipped (already exists): ${stats.skipped}`);
    console.log(`Failed: ${stats.failed}`);
    
    if (stats.errors.length > 0) {
      console.log('\nErrors:');
      stats.errors.forEach(({ file, error }) => {
        console.log(`  - ${file}: ${error}`);
      });
    }
    
    if (DRY_RUN) {
      console.log('\n[DRY RUN] No changes were made to the database.');
      console.log('Run without --dry-run flag to perform actual migration.');
    }
    
  } catch (error) {
    console.error('Migration failed:', error.message);
    logger.error('Migration failed', { error });
  } finally {
    // Close database connection
    if (pool && pool.end) {
      await pool.end();
      console.log('\nDatabase connection closed.');
    }
  }
}

// Run migration
if (require.main === module) {
  migrateFeeds().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { migrateFeeds };
