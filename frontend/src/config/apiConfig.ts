/**
 * API Configuration
 * 
 * This file automatically detects the current environment and provides the appropriate API URL.
 * - In development: Uses localhost
 * - In production: Uses the server IP
 */

// Function to determine if we're running on the production server
const isProductionServer = (): boolean => {
  // Check if window is defined (for SSR compatibility)
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    return hostname === '167.114.223.83' || hostname.includes('feedcontrol');
  }
  return false;
};

// Base API URL configuration
export const API_URL = isProductionServer() 
  ? 'http://167.114.223.83:7005/api'  // Production server
  : 'http://localhost:7005/api';      // Local development

// Export other API-related configurations if needed
export const API_TIMEOUT = 30000; // 30 seconds
