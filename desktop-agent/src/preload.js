const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  sendToClaude: (agentType, message, conversationHistory) =>
    ipcRenderer.invoke('send-to-claude', { agentType, message, conversationHistory }),

  checkApiStatus: () =>
    ipcRenderer.invoke('check-api-status')
});
