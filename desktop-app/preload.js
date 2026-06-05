const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    showNotification:    (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
    getVersion:          () => ipcRenderer.invoke('get-version'),
    getExeBuild:         () => ipcRenderer.invoke('get-exe-build'),
    installUpdate:       () => ipcRenderer.invoke('install-update'),
    onUpdateStatus:      (cb) => ipcRenderer.on('update-status', (_, data) => cb(data)),
    setMonitorDisabled:  (val) => ipcRenderer.send('set-monitor-disabled', val),
    setOsNotifMuted:     (val) => ipcRenderer.send('set-os-notif-muted', val),
    closeNotification:   () => ipcRenderer.send('close-notification'),
    flashFrame:          (val) => ipcRenderer.send('flash-frame', val),
    blinkTitle:          (on, labels) => ipcRenderer.send('blink-title', { on: !!on, labels: Array.isArray(labels) ? labels : (labels ? [labels] : []) }),
    send:                (ch, val) => ipcRenderer.send(ch, val),
    restartApp:          () => ipcRenderer.invoke('restart-app'),
    isElectron: true
});
