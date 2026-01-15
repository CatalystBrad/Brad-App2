// State management
let currentAgent = 'ceo';
let conversationHistory = [];

const agentInfo = {
  ceo: {
    title: 'CEO Agent',
    description: 'Strategic insights and high-level decision support',
    avatar: '👔'
  },
  operations: {
    title: 'Operations Manager',
    description: 'Process optimization and operational excellence',
    avatar: '⚙️'
  },
  finance: {
    title: 'Finance Manager',
    description: 'Financial planning, analysis, and insights',
    avatar: '💰'
  }
};

// DOM elements
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const agentButtons = document.querySelectorAll('.agent-btn');
const currentAgentTitle = document.getElementById('currentAgentTitle');
const currentAgentDesc = document.getElementById('currentAgentDesc');
const apiStatus = document.getElementById('apiStatus');

// Check API status on load
async function checkApiStatus() {
  try {
    const status = await window.electronAPI.checkApiStatus();
    if (status.isConfigured) {
      apiStatus.classList.add('connected');
      apiStatus.querySelector('.status-text').textContent = 'Claude API Connected';
    } else {
      apiStatus.classList.add('error');
      apiStatus.querySelector('.status-text').textContent = 'API Key Not Set';
    }
  } catch (error) {
    apiStatus.classList.add('error');
    apiStatus.querySelector('.status-text').textContent = 'Connection Error';
  }
}

checkApiStatus();

// Agent selection
agentButtons.forEach(button => {
  button.addEventListener('click', () => {
    const agent = button.dataset.agent;
    switchAgent(agent);
  });
});

function switchAgent(agent) {
  if (agent === currentAgent) return;

  // Update UI
  agentButtons.forEach(btn => btn.classList.remove('active'));
  document.querySelector(`[data-agent="${agent}"]`).classList.add('active');

  // Update header
  currentAgentTitle.textContent = agentInfo[agent].title;
  currentAgentDesc.textContent = agentInfo[agent].description;

  // Reset conversation
  currentAgent = agent;
  conversationHistory = [];

  // Clear chat (keep welcome message)
  const welcomeMessage = chatContainer.querySelector('.welcome-message');
  chatContainer.innerHTML = '';
  if (welcomeMessage) {
    chatContainer.appendChild(welcomeMessage.cloneNode(true));
  }

  // Show agent switch message
  addSystemMessage(`Switched to ${agentInfo[agent].title}`);
}

function addSystemMessage(text) {
  const systemMsg = document.createElement('div');
  systemMsg.className = 'message system';
  systemMsg.innerHTML = `
    <div class="message-content">
      <div class="message-text" style="background: #2a2a2a; text-align: center; color: #888; font-size: 13px;">
        ${text}
      </div>
    </div>
  `;
  chatContainer.appendChild(systemMsg);
  scrollToBottom();
}

function addUserMessage(text) {
  // Remove welcome message if present
  const welcomeMessage = chatContainer.querySelector('.welcome-message');
  if (welcomeMessage) {
    welcomeMessage.remove();
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = 'message user';
  messageDiv.innerHTML = `
    <div class="message-avatar">👤</div>
    <div class="message-content">
      <div class="message-role">You</div>
      <div class="message-text">${escapeHtml(text)}</div>
    </div>
  `;
  chatContainer.appendChild(messageDiv);
  scrollToBottom();
}

function addAgentMessage(text) {
  const messageDiv = document.createElement('div');
  messageDiv.className = 'message agent';
  messageDiv.innerHTML = `
    <div class="message-avatar">${agentInfo[currentAgent].avatar}</div>
    <div class="message-content">
      <div class="message-role">${agentInfo[currentAgent].title}</div>
      <div class="message-text">${escapeHtml(text)}</div>
    </div>
  `;
  chatContainer.appendChild(messageDiv);
  scrollToBottom();
}

function showThinking() {
  const thinkingDiv = document.createElement('div');
  thinkingDiv.className = 'message agent thinking';
  thinkingDiv.innerHTML = `
    <div class="message-avatar">${agentInfo[currentAgent].avatar}</div>
    <div class="message-content">
      <div class="thinking-indicator">
        <span>Thinking</span>
        <div class="thinking-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    </div>
  `;
  chatContainer.appendChild(thinkingDiv);
  scrollToBottom();
  return thinkingDiv;
}

function removeThinking(thinkingElement) {
  if (thinkingElement && thinkingElement.parentNode) {
    thinkingElement.remove();
  }
}

function scrollToBottom() {
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) return;

  // Disable input
  messageInput.disabled = true;
  sendButton.disabled = true;

  // Add user message to UI
  addUserMessage(message);

  // Clear input
  messageInput.value = '';

  // Show thinking indicator
  const thinkingElement = showThinking();

  try {
    // Send to Claude API
    const result = await window.electronAPI.sendToClaude(
      currentAgent,
      message,
      conversationHistory
    );

    // Remove thinking indicator
    removeThinking(thinkingElement);

    if (result.error) {
      addAgentMessage(`Error: ${result.error}`);
    } else {
      // Add agent response
      addAgentMessage(result.response);

      // Update conversation history
      conversationHistory.push({
        role: 'user',
        content: message
      });
      conversationHistory.push({
        role: 'assistant',
        content: result.response
      });
    }
  } catch (error) {
    removeThinking(thinkingElement);
    addAgentMessage(`Error: ${error.message}`);
  } finally {
    // Re-enable input
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.focus();
  }
}

// Event listeners
sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
});

// Focus input on load
messageInput.focus();
