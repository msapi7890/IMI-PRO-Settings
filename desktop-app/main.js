const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, shell, dialog } = require('electron');

// ── 단일 인스턴스 잠금 ────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}
app.on('second-instance', () => { showWindow(); });
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch(_) {}
const path = require('path');
const https = require('https');
const fs = require('fs');

const APP_URL  = 'https://msapi7890.github.io/IMI-PRO/';
const DB_BASE  = 'https://manual-9a47c-default-rtdb.firebaseio.com';

// ── 설정 파일 ─────────────────────────────────────────────
let _settingsPath = null;
function settingsPath() {
    if (!_settingsPath) _settingsPath = path.join(app.getPath('userData'), 'settings.json');
    return _settingsPath;
}
function loadSettings() {
    try { return Object.assign({ closeMode: 'ask', openAtLogin: true }, JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))); }
    catch(_) { return { closeMode: 'ask', openAtLogin: true }; }
}
function saveSettings(s) {
    try { fs.writeFileSync(settingsPath(), JSON.stringify(s)); } catch(_) {}
}

// ── 수정 메뉴 ─────────────────────────────────────────────
function buildAppMenu() {
    const s = loadSettings();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{
        label: '수정',
        submenu: [
            {
                label: '닫기 시 매번 선택',
                type: 'radio',
                checked: s.closeMode === 'ask',
                click: () => { saveSettings(Object.assign(s, { closeMode: 'ask' })); buildAppMenu(); }
            },
            {
                label: '닫기 시 트레이로',
                type: 'radio',
                checked: s.closeMode === 'tray',
                click: () => { saveSettings(Object.assign(s, { closeMode: 'tray' })); buildAppMenu(); }
            },
            {
                label: '닫기 시 프로그램 종료',
                type: 'radio',
                checked: s.closeMode === 'quit',
                click: () => { saveSettings(Object.assign(s, { closeMode: 'quit' })); buildAppMenu(); }
            },
            { type: 'separator' },
            {
                label: '컴퓨터 시작 시 자동 실행',
                type: 'checkbox',
                checked: !!s.openAtLogin,
                click: (item) => {
                    s.openAtLogin = item.checked;
                    saveSettings(s);
                    app.setLoginItemSettings({ openAtLogin: s.openAtLogin, path: app.getPath('exe') });
                }
            }
        ]
    }]));
}

let win              = null;
let tray             = null;
let sseReq           = null;
let isQuitting       = false;
let lastAlertAt      = 0;
let lastUpdateStatus = null;   // 페이지 로드 전 이벤트 캐시
let monitorSuppressed = false; // 모니터링 차단 유저 플래그

// ── 아이콘 경로 (없으면 null) ──────────────────────────────
function iconPath() {
    const ico = path.join(__dirname, 'assets', 'icon.ico');
    if (fs.existsSync(ico)) return ico;
    const png = path.join(__dirname, 'assets', 'icon.png');
    return fs.existsSync(png) ? png : null;
}

// ── 윈도우 생성 ───────────────────────────────────────────
function createWindow() {
    const opts = {
        width:  1400,
        height: 900,
        minWidth:  960,
        minHeight: 600,
        title: 'IMI PRO',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            partition: 'persist:imipro'   // 로그인 상태 영구 보존
        },
        show: false   // 준비되면 show
    };
    const icon = iconPath();
    if (icon) opts.icon = icon;

    win = new BrowserWindow(opts);
    win.loadURL(APP_URL);

    // target="_blank" 등 새 창 요청 → 시스템 기본 브라우저로
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
    // 메인 프레임 이동도 앱 URL 외에는 브라우저로
    win.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(APP_URL)) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    win.once('ready-to-show', () => {
        win.show();
    });

    // 페이지 로드 완료 시 미처 못 받은 업데이트 상태 재전송
    win.webContents.on('did-finish-load', () => {
        if (lastUpdateStatus) {
            win.webContents.send('update-status', lastUpdateStatus);
        }
    });

    win.on('close', (e) => {
        if (isQuitting) return;
        e.preventDefault();
        const s = loadSettings();
        if (s.closeMode === 'tray') {
            win.hide();
        } else if (s.closeMode === 'quit') {
            isQuitting = true;
            app.quit();
        } else {
            // 'ask' — 다이얼로그 + 항상 적용 체크박스
            dialog.showMessageBox(win, {
                type: 'question',
                title: 'IMI PRO',
                message: '어떻게 닫을까요?',
                buttons: ['트레이로 닫기', '프로그램 종료'],
                defaultId: 0,
                cancelId: 0,
                checkboxLabel: '이 선택을 항상 적용',
                checkboxChecked: false,
                noLink: true
            }).then(({ response, checkboxChecked }) => {
                const toTray = response === 0;
                if (checkboxChecked) {
                    const s2 = loadSettings();
                    s2.closeMode = toTray ? 'tray' : 'quit';
                    saveSettings(s2);
                    buildAppMenu();
                }
                if (toTray) {
                    win.hide();
                } else {
                    isQuitting = true;
                    app.quit();
                }
            });
        }
    });
}

// ── 트레이 ────────────────────────────────────────────────
function createTray() {
    try {
        const icon = iconPath();
        const img  = icon ? nativeImage.createFromPath(icon) : nativeImage.createEmpty();
        tray = new Tray(img);
        tray.setToolTip('IMI PRO');
        tray.on('click', showWindow);
        rebuildTrayMenu();
    } catch(e) {
        console.error('트레이 생성 실패:', e.message);
    }
}

function rebuildTrayMenu() {
    if (!tray) return;
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'IMI PRO 열기', click: showWindow },
        { type: 'separator' },
        { label: '종료', click: () => { isQuitting = true; app.quit(); } }
    ]));
}

function showWindow() {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

// ── 네이티브 알림 ─────────────────────────────────────────
function showNativeNotif(title, body) {
    if (!Notification.isSupported()) return;
    const opts = { title, body, silent: false };
    const icon = iconPath();
    if (icon) opts.icon = icon;
    const notif = new Notification(opts);
    notif.on('click', showWindow);
    notif.show();
}

// ── Firebase SSE 리스너 (탐지 알림) ───────────────────────
function connectSSE() {
    if (sseReq) { try { sseReq.destroy(); } catch (_) {} sseReq = null; }

    const urlObj = new URL(`${DB_BASE}/monitor_flash_state.json`);
    sseReq = https.get(
        { hostname: urlObj.hostname, path: urlObj.pathname, headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' } },
        (res) => {
            let buf = '';
            res.on('data', (chunk) => {
                buf += chunk.toString();
                const lines = buf.split('\n');
                buf = lines.pop();
                let payload = null;
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try { payload = JSON.parse(line.slice(6)); } catch (_) {}
                    }
                }
                if (!payload) return;

                // 단일 { active, at, ... } 또는 중첩 { ruleId: { active, at, ... } }
                const items = (payload && typeof payload === 'object' && 'active' in payload)
                    ? [payload]
                    : Object.values(payload || {});

                for (const d of items) {
                    if (!d || !d.active) continue;
                    const at = d.at || 0;
                    if (at <= lastAlertAt) continue;
                    if (Date.now() - at > 120000) continue;   // 2분 초과 무시
                    lastAlertAt = at;

                    const title = '🚨 ' + (d.ruleName || 'IMI PRO') + ' 감지됨';
                    const body  = (d.itemCount || 0) + '개 감지 · 키워드: ' + (d.keyword || '') + '\nIMI PRO 확인 바랍니다';
                    if (!monitorSuppressed) showNativeNotif(title, body);
                }
            });
            res.on('end',   () => setTimeout(connectSSE, 5000));
            res.on('error', () => setTimeout(connectSSE, 5000));
        }
    );
    sseReq.on('error', () => setTimeout(connectSSE, 10000));
}

// ── 자동 업데이트 ─────────────────────────────────────────
function setupAutoUpdater() {
    if (!autoUpdater) return;
    autoUpdater.autoDownload         = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger               = null;

    function sendUpdate(data) {
        lastUpdateStatus = data;
        if (win) win.webContents.send('update-status', data);
    }

    autoUpdater.on('update-available',   (info) => sendUpdate({ type: 'downloading', version: info.version, percent: 0 }));
    autoUpdater.on('download-progress',  (p)    => sendUpdate({ type: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded',  (info) => sendUpdate({ type: 'downloaded',  version: info.version }));
    autoUpdater.on('update-not-available', ()   => { lastUpdateStatus = null; if (win) win.webContents.send('update-status', { type: 'none' }); });

    // checkForUpdates (알림 없음) — 알림은 위 이벤트에서 직접 처리
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
}

// ── IPC (렌더러 → 메인 알림 요청) ────────────────────────
ipcMain.handle('show-notification', (_, { title, body }) => { if (!monitorSuppressed) showNativeNotif(title, body); });
ipcMain.handle('get-version',       ()                   => app.getVersion());
ipcMain.handle('install-update',    ()                   => { if (autoUpdater) autoUpdater.quitAndInstall(true, true); });
ipcMain.on('set-monitor-disabled',  (_, val)             => { monitorSuppressed = !!val; });

// ── 앱 시작 ───────────────────────────────────────────────
app.whenReady().then(() => {
    buildAppMenu();
    createWindow();
    createTray();

    const s = loadSettings();
    app.setLoginItemSettings({ openAtLogin: !!s.openAtLogin, path: app.getPath('exe') });

    connectSSE();
    if (app.isPackaged) setupAutoUpdater();
});

app.on('activate',      showWindow);   // macOS dock 클릭
app.on('before-quit',   () => { isQuitting = true; });
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // 트레이 상주 → 종료하지 않음
    }
});
