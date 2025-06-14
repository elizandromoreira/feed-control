/**
 * Script to test migration of a single feed file to database
 */

const fs = require('fs').promises;
const path = require('path');
const { Pool } = require('pg');
const { DB_CONFIG } = require('./src/config/db');
const feedService = require('./src/services/feedService');

// Create pool instance
const pool = new Pool(DB_CONFIG);

const FEEDS_DIR = path.join(__dirname, 'feeds');

async function testSingleMigration() {
  console.log('=== Test Single Feed Migration ===\n');
  
  try {
    // List files and pick the first one
    const files = await fs.readdir(FEEDS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    if (jsonFiles.length === 0) {
      console.log('No JSON files found in feeds directory');
      return;
    }
    
    // Pick the first inventory feed
    const testFile = jsonFiles.find(f => f.startsWith('inventory_feed_')) || jsonFiles[0];
    const filePath = path.join(FEEDS_DIR, testFile);
    
    console.log(`Selected file for test: ${testFile}`);
    console.log(`Full path: ${filePath}\n`);
    
    // Read file content
    const content = await fs.readFile(filePath, 'utf8');
    const feedData = JSON.parse(content);
    
    console.log('Feed data preview:');
    console.log(`- Type: inventory`);
    console.log(`- Store: amazon (default)`);
    console.log(`- File size: ${content.length} bytes`);
    
    // Extract some metadata from feed
    if (feedData.header) {
      console.log(`- Seller ID: ${feedData.header.sellerId || 'N/A'}`);
      console.log(`- Document version: ${feedData.header.documentVersion || 'N/A'}`);
    }
    
    if (feedData.messages && Array.isArray(feedData.messages)) {
      console.log(`- Number of products: ${feedData.messages.length}`);
    }
    
    console.log('\n--- Attempting to save to database ---\n');
    
    // Save to database
    const result = await feedService.saveFeed(
      feedData,
      'inventory',
      null,
      'amazon',
      filePath
    );
    
    if (result) {
      console.log('✅ Successfully saved to database!');
      console.log(`- Database ID: ${result.id}`);
      console.log(`- Created at: ${result.created_at}`);
      console.log(`- Status: ${result.status}`);
      
      // Verify by reading back from database
      console.log('\n--- Verifying data in database ---\n');
      
      const query = `
        SELECT id, feed_type, store_id, status, created_at, file_path
        FROM amazon_feeds
        WHERE id = $1
      `;
      
      const verifyResult = await pool.query(query, [result.id]);
      
      if (verifyResult.rows.length > 0) {
        const row = verifyResult.rows[0];
        console.log('✅ Feed found in database:');
        console.log(`- ID: ${row.id}`);
        console.log(`- Type: ${row.feed_type}`);
        console.log(`- Store: ${row.store_id}`);
        console.log(`- Status: ${row.status}`);
        console.log(`- File path: ${row.file_path}`);
        console.log(`- Created: ${row.created_at}`);
        
        // Check if content was saved
        const contentQuery = `
          SELECT 
            LENGTH(content::text) as content_size,
            jsonb_array_length(content->'messages') as message_count
          FROM amazon_feeds
          WHERE id = $1
        `;
        
        const contentResult = await pool.query(contentQuery, [result.id]);
        if (contentResult.rows.length > 0) {
          const contentRow = contentResult.rows[0];
          console.log(`\n✅ Content verification:`);
          console.log(`- Content size in DB: ${contentRow.content_size} bytes`);
          console.log(`- Message count in DB: ${contentRow.message_count || 0}`);
        }
      } else {
        console.log('❌ Feed not found in database after saving!');
      }
      
    } else {
      console.log('❌ Failed to save to database');
    }
    
  } catch (error) {
    console.error('❌ Error during test:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    // Close database connection
    if (pool && pool.end) {
      await pool.end();
      console.log('\n--- Database connection closed ---');
    }
  }
}

// Run test
if (require.main === module) {
  testSingleMigration().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
