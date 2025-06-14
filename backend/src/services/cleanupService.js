const fs = require('fs').promises;
const path = require('path');
const configureLogging = require('../config/logging');
const logger = configureLogging();

class CleanupService {
    constructor() {
        this.feedsPath = path.join(__dirname, '../../feeds');
        this.logsPath = path.join(__dirname, '../../logs');
        this.isRunning = false;
        this.cleanupInterval = null;
        
        // Run cleanup every 6 hours (6 * 60 * 60 * 1000 ms)
        this.intervalTime = 6 * 60 * 60 * 1000;
        
        // Files older than 72 hours will be deleted (72 * 60 * 60 * 1000 ms)
        this.maxAge = 72 * 60 * 60 * 1000;
    }

    /**
     * Start the automatic cleanup service
     */
    start() {
        if (this.isRunning) {
            logger.info('🧹 Cleanup service is already running');
            return;
        }

        logger.info('🧹 Starting automatic cleanup service');
        logger.info(`📁 Monitoring feeds: ${this.feedsPath}`);
        logger.info(`📁 Monitoring logs: ${this.logsPath}`);
        logger.info(`⏰ Cleanup interval: every 6 hours`);
        logger.info(`🗑️  Max file age: 72 hours`);

        // Run initial cleanup
        this.runCleanup();

        // Schedule regular cleanups
        this.cleanupInterval = setInterval(() => {
            this.runCleanup();
        }, this.intervalTime);

        this.isRunning = true;
    }

    /**
     * Stop the automatic cleanup service
     */
    stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.isRunning = false;
        logger.info('🛑 Cleanup service stopped');
    }

    /**
     * Run cleanup process for both feeds and logs directories
     */
    async runCleanup() {
        logger.info('🧹 Starting cleanup process...');
        
        const results = {
            feeds: await this.cleanupDirectory(this.feedsPath, 'feeds'),
            logs: await this.cleanupDirectory(this.logsPath, 'logs')
        };

        const totalDeleted = results.feeds.deleted + results.logs.deleted;
        const totalSize = this.formatBytes(results.feeds.size + results.logs.size);

        if (totalDeleted > 0) {
            logger.info(`✅ Cleanup completed: ${totalDeleted} files deleted (${totalSize} freed)`);
        } else {
            logger.info('✅ Cleanup completed: no old files found');
        }
    }

    /**
     * Cleanup a specific directory
     * @param {string} dirPath - Directory path to clean
     * @param {string} dirName - Directory name for logging
     * @returns {Object} - Statistics about cleanup
     */
    async cleanupDirectory(dirPath, dirName) {
        const stats = { deleted: 0, size: 0, errors: 0 };

        try {
            // Check if directory exists
            await fs.access(dirPath);
            
            const files = await fs.readdir(dirPath);
            const now = Date.now();

            for (const file of files) {
                const filePath = path.join(dirPath, file);
                
                try {
                    const fileStat = await fs.stat(filePath);
                    
                    // Skip directories
                    if (fileStat.isDirectory()) {
                        continue;
                    }

                    const fileAge = now - fileStat.mtime.getTime();
                    
                    // Delete files older than 72 hours
                    if (fileAge > this.maxAge) {
                        const fileSize = fileStat.size;
                        await fs.unlink(filePath);
                        
                        stats.deleted++;
                        stats.size += fileSize;
                        
                        const ageHours = Math.round(fileAge / (60 * 60 * 1000));
                        logger.info(`🗑️  Deleted: ${dirName}/${file} (${ageHours}h old, ${this.formatBytes(fileSize)})`);
                    }
                } catch (error) {
                    stats.errors++;
                    logger.error(`❌ Error processing ${dirName}/${file}:`, error.message);
                }
            }

            if (stats.deleted > 0) {
                logger.info(`📁 ${dirName}: ${stats.deleted} files deleted, ${this.formatBytes(stats.size)} freed`);
            }

        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info(`📁 Directory ${dirName} not found, skipping cleanup`);
            } else {
                logger.error(`❌ Error accessing ${dirName} directory:`, error.message);
            }
        }

        return stats;
    }

    /**
     * Format bytes to human readable format
     * @param {number} bytes - Number of bytes
     * @returns {string} - Formatted string
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    /**
     * Get cleanup service status
     * @returns {Object} - Service status information
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            intervalTime: this.intervalTime,
            maxAge: this.maxAge,
            feedsPath: this.feedsPath,
            logsPath: this.logsPath,
            nextCleanup: this.isRunning ? new Date(Date.now() + this.intervalTime).toISOString() : null
        };
    }

    /**
     * Force run cleanup manually
     * @returns {Object} - Cleanup results
     */
    async forceCleanup() {
        logger.info('🔄 Manual cleanup requested');
        await this.runCleanup();
        return this.getStatus();
    }
}

module.exports = new CleanupService();
