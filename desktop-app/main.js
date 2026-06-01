const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, shell } = require('electron');
let autoUpdater = null;
try { autoUpdater = require('electron-updater').autoUpdater; } catch(_) {}
const path = require('path');
const https = require('https');
const fs = require('fs');

const APP_URL  = 'https://msapi7890.github.io/IMI-PRO/';
const DB_BASE  = 'https://manual-9a47c-default-rtdb.firebaseio.com';

let win        = null;
let tray       = null;
let sseReq     = null;
let isQuitting = false;
let lastAlertAt = 0;

// ── 아이콘 경로 (없으면 null) ──────────────────────────────
function iconPath() {
    const png = path.join(__dirname, 'assets', 'icon.png');
    if (fs.existsSync(png)) return png;
    const ico = path.join(__dirname, 'assets', 'icon.ico');
    return fs.existsSync(ico) ? ico : null;
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

    win.once('ready-to-show', () => {
        win.show();
    });

    win.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            win.hide();   // X 버튼 → 트레이로
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
    const autoStart = app.getLoginItemSettings().openAtLogin;
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'IMI PRO 열기',  click: showWindow },
        { type: 'separator' },
        {
            label: '컴퓨터 시작 시 자동 실행',
            type:  'checkbox',
            checked: autoStart,
            click: (item) => {
                app.setLoginItemSettings({ openAtLogin: item.checked });
                rebuildTrayMenu();
            }
        },
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
                    showNativeNotif(title, body);
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
    autoUpdater.autoDownload        = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger              = null;

    autoUpdater.on('update-available',  () => showNativeNotif('IMI PRO 업데이트', '새 버전을 다운로드 중입니다...'));
    autoUpdater.on('update-downloaded', () => showNativeNotif('IMI PRO 업데이트 완료', '앱 종료 시 자동 설치됩니다.'));

    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 60 * 60 * 1000);
}

// ── IPC (렌더러 → 메인 알림 요청) ────────────────────────
ipcMain.handle('show-notification', (_, { title, body }) => showNativeNotif(title, body));
ipcMain.handle('get-version',       ()                   => app.getVersion());

// ── 앱 시작 ───────────────────────────────────────────────
app.whenReady().then(() => {
    createWindow();
    createTray();
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
