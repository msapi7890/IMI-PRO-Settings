const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // 웹 앱에서 네이티브 알림 요청
    showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
    // 앱 버전 조회
    getVersion: () => ipcRenderer.invoke('get-version'),
    isElectron: true
});
