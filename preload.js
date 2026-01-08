const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  send: (channel, data) => {
    const validChannels = [
      'send-to-gemini',
      'perform-action',
      'launch-app',
      'open-file',
      'show-file-in-folder',
      'open-folder',
      'resize-window',
      'save-settings',
      'get-settings',
      'open-settings',
      'close-settings',
      'save-ui-state'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, func) => {
    const validChannels = [
      'focus-input',
      'gemini-response',
      'action-result',
      'settings-saved',
      'current-settings',
      'show-settings-panel',
      'hide-settings-panel',
      'save-state',
      'restore-state'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  }
});
