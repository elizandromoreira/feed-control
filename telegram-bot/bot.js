require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { Client } = require('ssh2');
const axios = require('axios');
const { Pool } = require('pg');

// Bot configuration
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Authorized users
const authorizedUsers = process.env.AUTHORIZED_USERS.split(',').map(id => parseInt(id));

// SSH configuration
const sshConfig = {
  host: process.env.SSH_HOST,
  port: 22,
  username: process.env.SSH_USER,
  password: process.env.SSH_PASSWORD,
  // privateKey: process.env.SSH_KEY_PATH ? require('fs').readFileSync(process.env.SSH_KEY_PATH) : undefined
};

// Database configuration
const pool = new Pool({
  user: process.env.DB_USER || 'postgres.bvbnofnnbfdlnpuswlgy',
  host: process.env.DB_HOST || 'aws-0-us-east-1.pooler.supabase.com',
  database: process.env.DB_NAME || 'postgres',
  password: process.env.DB_PASSWORD || 'Bi88An6B9L0EIihL',
  port: process.env.DB_PORT || 6543,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

// Provider API endpoints
const providerAPIs = {
  bestbuy: {
    name: 'Best Buy',
    baseUrl: 'http://167.114.223.83:3005/bb/api',
    productEndpoint: '',  // SKU goes directly after baseUrl
    icon: '🔵'
  },
  homedepot: {
    name: 'Home Depot',
    baseUrl: 'http://167.114.223.83:3005/hd/api',
    productEndpoint: '',  // SKU goes directly after baseUrl
    icon: '🟠'
  },
  vitacost: {
    name: 'Vitacost',
    baseUrl: 'http://167.114.223.83:3005/vc',
    productEndpoint: '',  // SKU goes directly after baseUrl
    icon: '🟣'
  },
  webstaurant: {
    name: 'Webstaurant',
    baseUrl: 'http://167.114.223.83:3005/wr/api',
    productEndpoint: '',  // SKU goes directly after baseUrl
    icon: '🔴'
  }
};

// Store user states for SKU input
const userStates = {};

// Dynamic SKU fetching function
async function fetchTestSKUs() {
  try {
    const query = `
      SELECT source, sku
      FROM (
        SELECT DISTINCT ON (source) 
          source,
          sku,
          last_update
        FROM produtos 
        WHERE sku IS NOT NULL 
          AND sku != ''
          AND source IN ('Best Buy', 'Home Depot', 'Vitacost', 'Webstaurantstore')
          AND availability = 'inStock'
        ORDER BY source, last_update DESC NULLS LAST
      ) t
      ORDER BY source;
    `;
    
    const result = await pool.query(query);
    
    // Map database source names to our provider keys
    const sourceMapping = {
      'Best Buy': 'bestbuy',
      'Home Depot': 'homedepot',
      'Vitacost': 'vitacost',
      'Webstaurantstore': 'webstaurant'
    };
    
    const dynamicSKUs = {};
    result.rows.forEach(row => {
      const providerKey = sourceMapping[row.source];
      if (providerKey) {
        dynamicSKUs[providerKey] = row.sku;
      }
    });
    
    // Use dynamic SKUs if available, otherwise fallback to hardcoded
    const testSKUs = {
      bestbuy: dynamicSKUs.bestbuy || '6571366',         // From database
      homedepot: dynamicSKUs.homedepot || '317196378',     // M12 12V Lithium-Ion Cordless LED Underbody Light
      vitacost: dynamicSKUs.vitacost || '021245103196',   // Kal C-Crystals™ -- 8 oz
      webstaurant: dynamicSKUs.webstaurant || '211366513'    // From database
    };
    
    console.log('Updated test SKUs:', testSKUs);
    return testSKUs;
  } catch (error) {
    console.error('Error fetching dynamic SKUs:', error.message);
    // Return existing testSKUs if database query fails
    return {
      bestbuy: '6571366',         // From database
      homedepot: '317196378',     // M12 12V Lithium-Ion Cordless LED Underbody Light
      vitacost: '021245103196',   // Kal C-Crystals™ -- 8 oz
      webstaurant: '211366513'    // From database
    };
  }
}

// Monitoring interval (12 hours in milliseconds)
const MONITORING_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours
// const MONITORING_INTERVAL = 5 * 60 * 1000; // 5 minutes for testing

// Store last check results
let lastCheckResults = {
  backend: true,
  frontend: true,
  providers: {
    bestbuy: true,
    homedepot: true,
    vitacost: true,
    webstaurant: true
  }
};

// Helper function to escape markdown characters
function escapeMarkdown(text) {
  if (!text) return '';
  return text.toString()
    .replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

// Helper function to send safe messages
async function sendSafeMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (error) {
    // If markdown parse fails, try without parse_mode
    if (error.message && error.message.includes('parse entities')) {
      delete options.parse_mode;
      return await bot.sendMessage(chatId, text.replace(/[*_`]/g, ''), options);
    }
    throw error;
  }
}

// Helper function to edit safe messages
async function editSafeMessage(chatId, messageId, text, options = {}) {
  try {
    return await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...options });
  } catch (error) {
    // If markdown parse fails, try without parse_mode
    if (error.message && error.message.includes('parse entities')) {
      delete options.parse_mode;
      return await bot.editMessageText(text.replace(/[*_`]/g, ''), { chat_id: chatId, message_id: messageId, ...options });
    }
    throw error;
  }
}

// Middleware to check authorization
function isAuthorized(userId) {
  return authorizedUsers.includes(userId);
}

// Execute SSH command
function executeSSHCommand(command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';
    
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        
        stream.on('close', (code, signal) => {
          conn.end();
          resolve(output);
        }).on('data', (data) => {
          output += data.toString();
        }).stderr.on('data', (data) => {
          output += data.toString();
        });
      });
    }).on('error', (err) => {
      reject(err);
    }).connect(sshConfig);
  });
}

// Keyboard layouts
const mainKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📊 Status', callback_data: 'status' },
        { text: '🔄 Restart', callback_data: 'restart_menu' }
      ],
      [
        { text: '📜 Logs', callback_data: 'logs_menu' },
        { text: '🚀 Deploy', callback_data: 'deploy_menu' }
      ],
      [
        { text: '🌐 Check APIs', callback_data: 'check_apis' },
        { text: '📈 System Info', callback_data: 'system_info' }
      ],
      [
        { text: '🧪 Test Provider APIs', callback_data: 'test_providers' }
      ]
    ]
  }
};

const restartKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🔄 Restart All', callback_data: 'restart_all' },
        { text: '🔄 Restart Backend', callback_data: 'restart_backend' }
      ],
      [
        { text: '🔄 Restart Frontend', callback_data: 'restart_frontend' },
        { text: '🔙 Back', callback_data: 'main_menu' }
      ]
    ]
  }
};

const logsKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '📜 Backend Logs', callback_data: 'logs_backend' },
        { text: '📜 Frontend Logs', callback_data: 'logs_frontend' }
      ],
      [
        { text: '📜 System Logs', callback_data: 'logs_system' },
        { text: '🔙 Back', callback_data: 'main_menu' }
      ]
    ]
  }
};

const providerKeyboard = {
  reply_markup: {
    inline_keyboard: [
      [
        { text: '🔵 Best Buy', callback_data: 'test_provider_bestbuy' },
        { text: '🟠 Home Depot', callback_data: 'test_provider_homedepot' }
      ],
      [
        { text: '🟣 Vitacost', callback_data: 'test_provider_vitacost' },
        { text: '🔴 Webstaurant', callback_data: 'test_provider_webstaurant' }
      ],
      [
        { text: '🔙 Back', callback_data: 'main_menu' }
      ]
    ]
  }
};

// Start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!isAuthorized(userId)) {
    await sendSafeMessage(chatId, '❌ Unauthorized. Your ID: ' + userId);
    return;
  }
  
  const welcomeMessage = `
🤖 *Feed Control Manager Bot*

Welcome! I can help you manage your Feed Control application.

Use the buttons below or these commands:
• /status - Check service status
• /restart - Restart services
• /logs - View logs
• /deploy - Deploy updates
• /help - Show all commands
  `;
  
  await sendSafeMessage(chatId, welcomeMessage, { parse_mode: 'Markdown', ...mainKeyboard });
});

// Help command
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!isAuthorized(userId)) return;
  
  const helpMessage = `
📋 *Available Commands:*

*Status & Monitoring:*
/status - Check all services status
/apis - Check API health
/system - System resources info

*Service Control:*
/restart - Restart menu
/restart_all - Restart all services
/restart_backend - Restart backend only
/restart_frontend - Restart frontend only
/stop - Stop all services
/start - Start all services

*Logs:*
/logs - Logs menu
/logs_backend - Last 20 backend logs
/logs_frontend - Last 20 frontend logs

*Deployment:*
/deploy - Full deployment
/deploy_quick - Quick restart only

*Screens:*
/screens - List all screens

*Provider Testing:*
/test_providers - Test provider APIs
/health - Manual health check of all services
  `;
  
  await sendSafeMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

// Status command
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!isAuthorized(userId)) return;
  
  await sendSafeMessage(chatId, '🔍 Checking status...');
  
  try {
    const status = await executeSSHCommand('systemctl status feedcontrol --no-pager');
    const screens = await executeSSHCommand('screen -ls | grep feedcontrol || echo "No feedcontrol screens found"');
    
    let statusEmoji = '🟢';
    if (status.includes('inactive') || status.includes('failed')) {
      statusEmoji = '🔴';
    }
    
    const message = `
${statusEmoji} *Feed Control Status*

*Systemd Service:*
\`\`\`
${status.substring(0, 500)}
\`\`\`

*Active Screens:*
\`\`\`
${screens}
\`\`\`
    `;
    
    await sendSafeMessage(chatId, message, { parse_mode: 'Markdown', ...mainKeyboard });
  } catch (error) {
    await sendSafeMessage(chatId, '❌ Error checking status: ' + error.message);
  }
});

// Test providers command
bot.onText(/\/test_providers/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!isAuthorized(userId)) return;
  
  await sendSafeMessage(chatId, '🧪 Select a provider to test:', providerKeyboard);
});

// Callback query handler
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  
  if (!isAuthorized(userId)) {
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Unauthorized' });
    return;
  }
  
  await bot.answerCallbackQuery(callbackQuery.id);
  
  switch(data) {
    case 'main_menu':
      await editSafeMessage(chatId, messageId, '🏠 Main Menu:', { ...mainKeyboard });
      break;
      
    case 'status':
      await handleStatus(chatId, messageId);
      break;
      
    case 'restart_menu':
      await editSafeMessage(chatId, messageId, '🔄 Restart Services:', { ...restartKeyboard });
      break;
      
    case 'restart_all':
      await handleRestart(chatId, messageId, 'all');
      break;
      
    case 'restart_backend':
      await handleRestart(chatId, messageId, 'backend');
      break;
      
    case 'restart_frontend':
      await handleRestart(chatId, messageId, 'frontend');
      break;
      
    case 'logs_menu':
      await editSafeMessage(chatId, messageId, '📜 View Logs:', { ...logsKeyboard });
      break;
      
    case 'logs_backend':
      await handleLogs(chatId, messageId, 'backend');
      break;
      
    case 'logs_frontend':
      await handleLogs(chatId, messageId, 'frontend');
      break;
      
    case 'logs_system':
      await handleLogs(chatId, messageId, 'system');
      break;
      
    case 'check_apis':
      await handleCheckAPIs(chatId, messageId);
      break;
      
    case 'system_info':
      await handleSystemInfo(chatId, messageId);
      break;
      
    case 'deploy_menu':
      await handleDeployMenu(chatId, messageId);
      break;
      
    case 'test_providers':
      await editSafeMessage(chatId, messageId, '🧪 Select a provider to test:', { ...providerKeyboard });
      break;
      
    case 'test_provider_bestbuy':
    case 'test_provider_homedepot':
    case 'test_provider_vitacost':
    case 'test_provider_webstaurant':
      const provider = data.replace('test_provider_', '');
      await handleProviderTest(chatId, messageId, provider);
      break;
      
    case 'test_auto_bestbuy':
    case 'test_auto_homedepot':
    case 'test_auto_vitacost':
    case 'test_auto_webstaurant':
      const autoProvider = data.replace('test_auto_', '');
      await handleAutoSkuTest(chatId, messageId, autoProvider);
      break;
      
    case 'test_manual_bestbuy':
    case 'test_manual_homedepot':
    case 'test_manual_vitacost':
    case 'test_manual_webstaurant':
      const manualProvider = data.replace('test_manual_', '');
      await handleManualSkuTest(chatId, messageId, manualProvider);
      break;
  }
});

// Handle text messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  if (!isAuthorized(userId)) {
    await sendSafeMessage(chatId, '⛔ Unauthorized. Contact the administrator.');
    return;
  }
  
  // Check if user is in SKU input state
  if (userStates[userId] && userStates[userId].action === 'waiting_for_skus') {
    const state = userStates[userId];
    const providerInfo = providerAPIs[state.provider];
    
    // Parse SKUs
    const skus = text.split(',').map(sku => sku.trim()).filter(sku => sku);
    
    if (skus.length === 0) {
      await sendSafeMessage(chatId, '❌ Please provide at least one SKU.');
      return;
    }
    
    // Clear user state
    delete userStates[userId];
    
    // Test the API with the provided SKUs
    await bot.editMessageText(
      `${providerInfo.icon} *Testing ${providerInfo.name} API*\n\n` +
      `🔍 Testing ${skus.length} SKU(s)...`,
      {
        chat_id: chatId,
        message_id: state.messageId,
        parse_mode: 'Markdown'
      }
    );
    
    const results = await testProviderAPI(skus, providerInfo);
    
    // Display results
    let response = `${providerInfo.icon} *${providerInfo.name} API Test Results*\n\n`;
    for (let i = 0; i < skus.length && i < results.length; i++) {
      response += `SKU: \`${skus[i]}\`\n`;
      response += results[i] + '\n';
    }
    
    // Truncate if too long
    if (response.length > 3900) {
      response = response.substring(0, 3900) + '\n\n[TRUNCATED]';
    }
    
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔄 Test Again', callback_data: `test_manual_${state.provider}` }],
        [{ text: '🔄 Use Automatic SKU', callback_data: `test_auto_${state.provider}` }],
        [{ text: '⬅️ Back', callback_data: 'test_providers' }]
      ]
    };
    
    await bot.editMessageText(response, {
      chat_id: chatId,
      message_id: state.messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    
    return;
  }
});

// Test provider API function
async function testProviderAPI(skus, providerInfo) {
  const results = [];
  
  for (const sku of skus) {
    try {
      const url = `${providerInfo.baseUrl}/${sku}`;
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.data) {
        // Format JSON response nicely
        const jsonStr = JSON.stringify(response.data, null, 2);
        
        if (jsonStr.length > 800) {
          // If response is too long, show summary
          results.push(`✅ *Success!*\n\`\`\`json\n${jsonStr.substring(0, 700)}...\n[TRUNCATED]\n\`\`\`\n`);
        } else {
          results.push(`✅ *Success!*\n\`\`\`json\n${jsonStr}\n\`\`\`\n`);
        }
      } else {
        results.push(`⚠️ *Empty response*\n`);
      }
      
    } catch (error) {
      let errorMessage = `❌ *Error:*\n`;
      
      if (error.response) {
        errorMessage += `Status: ${error.response.status}\n`;
        errorMessage += `Message: ${error.response.statusText}\n`;
        if (error.response.data) {
          errorMessage += `\`\`\`\n${JSON.stringify(error.response.data, null, 2).substring(0, 200)}\n\`\`\`\n`;
        }
      } else if (error.request) {
        errorMessage += `No response from server\n`;
        errorMessage += `URL: ${error.config?.url}\n`;
      } else {
        errorMessage += error.message + '\n';
      }
      
      results.push(errorMessage);
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return results;
}

// Handler functions
async function handleStatus(chatId, messageId) {
  try {
    await editSafeMessage(chatId, messageId, '🔍 Checking status...');
    
    const status = await executeSSHCommand('systemctl status feedcontrol --no-pager | head -20');
    const screens = await executeSSHCommand('screen -ls | grep feedcontrol || echo "No feedcontrol screens found"');
    
    let statusEmoji = '🟢';
    if (status.includes('inactive') || status.includes('failed')) {
      statusEmoji = '🔴';
    }
    
    const message = `
${statusEmoji} *Service Status*

\`\`\`
${status.substring(0, 800)}
\`\`\`

*Screens:*
\`\`\`
${screens}
\`\`\`
    `;
    
    await editSafeMessage(chatId, messageId, message, { parse_mode: 'Markdown', ...mainKeyboard });
  } catch (error) {
    await editSafeMessage(chatId, messageId, '❌ Error: ' + error.message, { ...mainKeyboard });
  }
}

async function handleRestart(chatId, messageId, service) {
  try {
    await editSafeMessage(chatId, messageId, `🔄 Restarting ${service}...`);
    
    let command;
    if (service === 'all') {
      command = 'systemctl restart feedcontrol';
    } else if (service === 'backend') {
      command = 'screen -S feedcontrol-backend -X quit && sleep 2 && systemctl restart feedcontrol';
    } else if (service === 'frontend') {
      command = 'screen -S feedcontrol-frontend -X quit && sleep 2 && systemctl restart feedcontrol';
    }
    
    await executeSSHCommand(command);
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
    
    const status = await executeSSHCommand('screen -ls | grep feedcontrol');
    
    await editSafeMessage(chatId, messageId, `✅ ${service} restarted successfully!\n\n\`\`\`${status}\`\`\``, { parse_mode: 'Markdown', ...mainKeyboard });
  } catch (error) {
    await editSafeMessage(chatId, messageId, '❌ Error restarting: ' + error.message, { ...mainKeyboard });
  }
}

async function handleLogs(chatId, messageId, type) {
  try {
    await editSafeMessage(chatId, messageId, `📜 Fetching ${type} logs...`);
    
    let command;
    if (type === 'backend') {
      command = 'timeout 2 screen -S feedcontrol-backend -X hardcopy /tmp/backend.log && tail -20 /tmp/backend.log || echo "Could not capture screen logs"';
    } else if (type === 'frontend') {
      command = 'timeout 2 screen -S feedcontrol-frontend -X hardcopy /tmp/frontend.log && tail -20 /tmp/frontend.log || echo "Could not capture screen logs"';
    } else if (type === 'system') {
      command = 'journalctl -u feedcontrol -n 20 --no-pager';
    }
    
    const logs = await executeSSHCommand(command);
    
    const message = `📜 *${type.charAt(0).toUpperCase() + type.slice(1)} Logs:*\n\n\`\`\`\n${logs.substring(0, 3000)}\n\`\`\``;
    
    await editSafeMessage(chatId, messageId, message, { parse_mode: 'Markdown', ...mainKeyboard });
  } catch (error) {
    await editSafeMessage(chatId, messageId, '❌ Error fetching logs: ' + error.message, { ...mainKeyboard });
  }
}

async function handleCheckAPIs(chatId, messageId) {
  try {
    await editSafeMessage(chatId, messageId, '🌐 Checking APIs...');
    
    let backendStatus = '❌ Offline';
    let frontendStatus = '❌ Offline';
    
    try {
      // Check backend API by hitting the /api/stores endpoint
      const backendResponse = await axios.get(`${process.env.BACKEND_URL}/api/stores`, { timeout: 5000 });
      if (backendResponse.status === 200) {
        backendStatus = '✅ Online';
      }
    } catch (e) {}
    
    try {
      const frontendResponse = await axios.get(process.env.FRONTEND_URL, { timeout: 5000 });
      if (frontendResponse.status === 200) {
        frontendStatus = '✅ Online';
      }
    } catch (e) {}
    
    const currentTime = new Date().toLocaleString();
    const message = `
🌐 *API Status:*

*Backend:* ${backendStatus}
${process.env.BACKEND_URL}

*Frontend:* ${frontendStatus}
${process.env.FRONTEND_URL}

_Checked at: ${currentTime}_
    `;
    
    // Create new keyboard to force update
    const updatedKeyboard = {
      reply_markup: {
        inline_keyboard: [...mainKeyboard.reply_markup.inline_keyboard]
      }
    };
    
    await editSafeMessage(chatId, messageId, message, { parse_mode: 'Markdown', ...updatedKeyboard });
  } catch (error) {
    await editSafeMessage(chatId, messageId, '❌ Error checking APIs: ' + error.message, { ...mainKeyboard });
  }
}

async function handleSystemInfo(chatId, messageId) {
  try {
    await editSafeMessage(chatId, messageId, '📊 Getting system info...');
    
    const uptime = await executeSSHCommand('uptime');
    const memory = await executeSSHCommand('free -h | grep Mem');
    const disk = await executeSSHCommand('df -h | grep -E "/$|/opt"');
    const processes = await executeSSHCommand('ps aux | grep -E "node|screen" | grep -v grep | wc -l');
    
    const message = `
📊 *System Information:*

*Uptime:*
\`\`\`
${uptime.trim()}
\`\`\`

*Memory:*
\`\`\`
${memory.trim()}
\`\`\`

*Disk Usage:*
\`\`\`
${disk.trim()}
\`\`\`

*Node/Screen Processes:* ${processes.trim()}
    `;
    
    await editSafeMessage(chatId, messageId, message, { parse_mode: 'Markdown', ...mainKeyboard });
  } catch (error) {
    await editSafeMessage(chatId, messageId, '❌ Error getting system info: ' + error.message, { ...mainKeyboard });
  }
}

async function handleDeployMenu(chatId, messageId) {
  const deployKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🚀 Full Deploy', callback_data: 'deploy_full' },
          { text: '⚡ Quick Restart', callback_data: 'deploy_quick' }
        ],
        [
          { text: '🔙 Back', callback_data: 'main_menu' }
        ]
      ]
    }
  };
  
  await editSafeMessage(chatId, messageId, '🚀 Deploy Options:', { ...deployKeyboard });
}

async function handleProviderTest(chatId, messageId, provider) {
  const providerInfo = providerAPIs[provider];
  
  // Create inline keyboard with options
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔄 Use Automatic SKU', callback_data: `test_auto_${provider}` }
      ],
      [
        { text: '✏️ Enter Manual SKUs', callback_data: `test_manual_${provider}` }
      ],
      [
        { text: '⬅️ Back', callback_data: 'test_providers' }
      ]
    ]
  };
  
  await bot.editMessageText(
    `${providerInfo.icon} *Testing ${providerInfo.name} API*\n\n` +
    `Choose an option:\n\n` +
    `🔄 *Automatic SKU*: Use active SKU from database\n` +
    `✏️ *Manual SKUs*: Enter your own SKUs`,
    {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    }
  );
}

async function handleAutoSkuTest(chatId, messageId, provider) {
  const providerInfo = providerAPIs[provider];
  
  try {
    // Show loading message
    await bot.editMessageText(
      `${providerInfo.icon} *Testing ${providerInfo.name} API*\n\n` +
      `🔄 Fetching active SKU from database...`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
      }
    );
    
    // Fetch SKUs from database
    const skus = await fetchTestSKUs();
    const sku = skus[provider];
    
    if (!sku) {
      await bot.editMessageText(
        `${providerInfo.icon} *${providerInfo.name} API Test*\n\n` +
        `❌ No active SKU found in database for ${providerInfo.name}`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '⬅️ Back', callback_data: `test_${provider}` }]]
          }
        }
      );
      return;
    }
    
    // Test the API with the SKU
    await bot.editMessageText(
      `${providerInfo.icon} *Testing ${providerInfo.name} API*\n\n` +
      `🔍 Testing with SKU: \`${sku}\`...`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
      }
    );
    
    const results = await testProviderAPI([sku], providerInfo);
    
    // Display results
    let response = `${providerInfo.icon} *${providerInfo.name} API Test Results*\n\n`;
    response += `SKU: \`${sku}\` (from database)\n\n`;
    response += results[0];
    
    // Create keyboard with options
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔄 Test Again', callback_data: `test_auto_${provider}` }],
        [{ text: '✏️ Test Manual SKUs', callback_data: `test_manual_${provider}` }],
        [{ text: '⬅️ Back', callback_data: 'test_providers' }]
      ]
    };
    
    await bot.editMessageText(response, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    
  } catch (error) {
    console.error('Auto SKU test error:', error);
    await bot.editMessageText(
      `${providerInfo.icon} *${providerInfo.name} API Test*\n\n` +
      `❌ Error: ${error.message}`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ Back', callback_data: `test_${provider}` }]]
        }
      }
    );
  }
}

async function handleManualSkuTest(chatId, messageId, provider) {
  const providerInfo = providerAPIs[provider];
  
  bot.editMessageText(
    `${providerInfo.icon} *Testing ${providerInfo.name} API*\n\n` +
    `Please send the SKUs you want to test (comma separated):\n` +
    `Example: \`123456, 789012, 345678\`\n\n` +
    `Or send a single SKU: \`123456\``,
    {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown'
    }
  );
  
  // Store user state
  userStates[chatId] = {
    action: 'waiting_for_skus',
    provider: provider,
    messageId: messageId
  };
}

// Monitoring function
async function startServiceMonitoring() {
  console.log('🔍 Starting service monitoring (every 12 hours)...');
  
  // Fetch fresh SKUs on startup
  await fetchTestSKUs();
  
  // Run check immediately on startup
  await checkAllServices();
  
  // Then run every 12 hours
  setInterval(async () => {
    // Refresh SKUs before each check
    await fetchTestSKUs();
    await checkAllServices();
  }, MONITORING_INTERVAL);
}

// Check all services
async function checkAllServices() {
  console.log(`[${new Date().toISOString()}] Running service health check...`);
  
  const currentResults = {
    backend: false,
    frontend: false,
    providers: {
      bestbuy: false,
      homedepot: false,
      vitacost: false,
      webstaurant: false
    }
  };
  
  let hasIssues = false;
  let issueMessages = [];
  
  // Check backend
  try {
    const backendResponse = await axios.get(process.env.BACKEND_URL, { timeout: 10000 });
    currentResults.backend = backendResponse.status === 200;
  } catch (error) {
    currentResults.backend = false;
  }
  
  // Check frontend
  try {
    const frontendResponse = await axios.get(process.env.FRONTEND_URL, { timeout: 10000 });
    currentResults.frontend = frontendResponse.status === 200;
  } catch (error) {
    currentResults.frontend = false;
  }
  
  // Check provider APIs
  for (const [provider, sku] of Object.entries(await fetchTestSKUs())) {
    try {
      const providerInfo = providerAPIs[provider];
      const url = `${providerInfo.baseUrl}/${sku}`;
      const response = await axios.get(url, { timeout: 10000 });
      currentResults.providers[provider] = response.status === 200 && response.data;
    } catch (error) {
      currentResults.providers[provider] = false;
    }
  }
  
  // Compare with last results and build alert message
  if (!currentResults.backend && lastCheckResults.backend) {
    hasIssues = true;
    issueMessages.push('🔴 Backend is OFFLINE!');
  }
  
  if (!currentResults.frontend && lastCheckResults.frontend) {
    hasIssues = true;
    issueMessages.push('🔴 Frontend is OFFLINE!');
  }
  
  for (const [provider, isOnline] of Object.entries(currentResults.providers)) {
    if (!isOnline && lastCheckResults.providers[provider]) {
      hasIssues = true;
      const providerInfo = providerAPIs[provider];
      issueMessages.push(`${providerInfo.icon} ${providerInfo.name} API is OFFLINE!`);
    }
  }
  
  // Check if services came back online
  let recoveryMessages = [];
  
  if (currentResults.backend && !lastCheckResults.backend) {
    recoveryMessages.push('✅ Backend is back ONLINE!');
  }
  
  if (currentResults.frontend && !lastCheckResults.frontend) {
    recoveryMessages.push('✅ Frontend is back ONLINE!');
  }
  
  for (const [provider, isOnline] of Object.entries(currentResults.providers)) {
    if (isOnline && !lastCheckResults.providers[provider]) {
      const providerInfo = providerAPIs[provider];
      recoveryMessages.push(`${providerInfo.icon} ${providerInfo.name} API is back ONLINE!`);
    }
  }
  
  // Send notifications if there are issues or recoveries
  if (hasIssues || recoveryMessages.length > 0) {
    let alertMessage = '🚨 *Feed Control Service Alert*\n\n';
    
    if (hasIssues) {
      alertMessage += '*Services DOWN:*\n' + issueMessages.join('\n') + '\n\n';
    }
    
    if (recoveryMessages.length > 0) {
      alertMessage += '*Services RECOVERED:*\n' + recoveryMessages.join('\n') + '\n\n';
    }
    
    alertMessage += `_Checked at: ${new Date().toLocaleString()}_`;
    
    // Send alert to all authorized users
    for (const userId of authorizedUsers) {
      try {
        await sendSafeMessage(userId, alertMessage, { parse_mode: 'Markdown' });
        console.log(`Alert sent to user ${userId}`);
      } catch (error) {
        console.error(`Failed to send alert to user ${userId}:`, error.message);
      }
    }
  }
  
  // Update last check results
  lastCheckResults = JSON.parse(JSON.stringify(currentResults));
  
  // Log the results
  console.log(`Health check completed:`, {
    backend: currentResults.backend ? 'Online' : 'Offline',
    frontend: currentResults.frontend ? 'Online' : 'Offline',
    providers: Object.entries(currentResults.providers).map(([k, v]) => `${k}: ${v ? 'Online' : 'Offline'}`).join(', ')
  });
}

// Manual health check command
bot.onText(/\/health/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!isAuthorized(userId)) {
    await sendSafeMessage(chatId, '❌ Unauthorized');
    return;
  }
  
  await sendSafeMessage(chatId, '🔍 Running manual health check...');
  
  // Force a check now
  await checkAllServices();
  
  // Send current status
  let statusMessage = '📊 *Current Service Status:*\n\n';
  statusMessage += `Backend: ${lastCheckResults.backend ? '✅ Online' : '❌ Offline'}\n`;
  statusMessage += `Frontend: ${lastCheckResults.frontend ? '✅ Online' : '❌ Offline'}\n\n`;
  statusMessage += '*Provider APIs:*\n';
  
  for (const [provider, isOnline] of Object.entries(lastCheckResults.providers)) {
    const providerInfo = providerAPIs[provider];
    statusMessage += `${providerInfo.icon} ${providerInfo.name}: ${isOnline ? '✅ Online' : '❌ Offline'}\n`;
  }
  
  statusMessage += `\n_Last automatic check: ${new Date().toLocaleString()}_`;
  statusMessage += `\n_Next automatic check in: ${Math.round(MONITORING_INTERVAL / 1000 / 60 / 60)} hours_`;
  
  await sendSafeMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('🤖 Feed Control Telegram Bot started!');
console.log('Authorized users:', authorizedUsers);

// Start monitoring services
startServiceMonitoring();
