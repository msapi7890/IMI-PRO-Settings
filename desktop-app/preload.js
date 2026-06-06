const { contextBridge, ipcRenderer } = require('electron');

// ── 커스텀 타이틀바 주입 ─────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
    // 콘텐츠 32px 아래로 밀기 (타이틀바 영역 확보)
    const style = document.createElement('style');
    style.textContent = 'html { padding-top: 32px !important; }';
    document.head.appendChild(style);

    // 타이틀바 div
    const bar = document.createElement('div');
    bar.id = '__imi_titlebar__';
    bar.setAttribute('style', [
        'position:fixed', 'top:0', 'left:0', 'right:140px', 'height:32px',
        'z-index:2147483647', '-webkit-app-region:drag',
        'display:flex', 'align-items:center', 'padding:0 10px', 'gap:8px',
        'background:transparent'
    ].join(';'));

    const dot = document.createElement('span');
    dot.id = '__imi_status_dot__';
    dot.setAttribute('style', 'font-size:15px;line-height:1;-webkit-app-region:no-drag;user-select:none;');
    dot.textContent = '🔴';

    bar.appendChild(dot);
    document.body.appendChild(bar);

    // 상태 업데이트 수신
    ipcRenderer.on('__imi_status__', (_, emoji) => {
        dot.textContent = emoji;
    });
});

contextBridge.exposeInMainWorld('electronAPI', {
    showNotification:    (title, body) => ipcRenderer.invoke('show-notification', { title, body }),
    getVersion:          () => ipcRenderer.invoke('get-version'),
    getExeBuild:         () => ipcRenderer.invoke('get-exe-build'),
    onOpenUpdateNotice:  (cb) => ipcRenderer.on('open-update-notice', cb),
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
