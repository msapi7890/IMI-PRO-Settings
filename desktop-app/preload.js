const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
    getVersion:       () => ipcRenderer.invoke('get-version'),
    installUpdate:    () => ipcRenderer.invoke('install-update'),
    onUpdateStatus:   (cb) => ipcRenderer.on('update-status', (_, data) => cb(data)),
    isElectron: true
});
