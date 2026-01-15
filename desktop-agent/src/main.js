const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

let mainWindow;
let anthropic;

// Initialize Claude API client
function initializeClaudeAPI() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    anthropic = new Anthropic({ apiKey });
    console.log('Claude API initialized');
  } else {
    console.warn('ANTHROPIC_API_KEY not found in environment variables');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  initializeClaudeAPI();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handler for sending messages to Claude
ipcMain.handle('send-to-claude', async (event, { agentType, message, conversationHistory }) => {
  if (!anthropic) {
    return {
      error: 'Claude API not initialized. Please set ANTHROPIC_API_KEY environment variable.'
    };
  }

  try {
    // Define system prompts for each agent type
    const systemPrompts = {
      ceo: `You are an AI Executive Assistant for a CEO. Your role is to:
- Provide strategic insights and high-level decision support
- Help with business planning, vision, and long-term strategy
- Analyze market trends and competitive positioning
- Assist with stakeholder communication and leadership tasks
- Prioritize initiatives based on business impact
- Provide executive summaries and key insights

Be concise, strategic, and focus on high-level business outcomes.`,

      operations: `You are an AI Operations Manager Assistant. Your role is to:
- Optimize processes and workflows
- Help with project management and resource allocation
- Identify bottlenecks and efficiency improvements
- Assist with team coordination and task delegation
- Provide operational metrics and KPI tracking
- Suggest automation opportunities
- Handle day-to-day operational challenges

Be practical, detail-oriented, and focus on execution and efficiency.`,

      finance: `You are an AI Finance Manager Assistant. Your role is to:
- Assist with financial planning and analysis
- Help with budgeting, forecasting, and financial modeling
- Provide insights on cash flow and profitability
- Analyze financial metrics and KPIs
- Support investment decisions and ROI analysis
- Ensure compliance and risk management
- Create financial reports and summaries

Be precise, data-driven, and focus on financial health and sustainability.`
    };

    const systemPrompt = systemPrompts[agentType] || systemPrompts.ceo;

    // Build messages array from conversation history
    const messages = conversationHistory || [];
    messages.push({
      role: 'user',
      content: message
    });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages
    });

    return {
      success: true,
      response: response.content[0].text,
      usage: response.usage
    };
  } catch (error) {
    console.error('Error communicating with Claude:', error);
    return {
      error: error.message || 'Failed to communicate with Claude API'
    };
  }
});

// IPC handler to check API status
ipcMain.handle('check-api-status', async () => {
  return {
    isConfigured: !!anthropic,
    hasApiKey: !!process.env.ANTHROPIC_API_KEY
  };
});
