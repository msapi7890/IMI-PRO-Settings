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

const APP_URL  = 'https://msapi7890.github.io/IMI-PRO-Settings/';
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
    const _updateReady = lastUpdateStatus && lastUpdateStatus.type === 'downloaded';
    Menu.setApplicationMenu(Menu.buildFromTemplate([{
        label: _updateReady ? '⚙ 설정  🔴' : '⚙ 설정',
        submenu: [
            {
                label: _updateReady
                    ? '🔴 NEW   🚀 업데이트 재시작 (준비 완료)'
                    : lastUpdateStatus && lastUpdateStatus.type === 'downloading'
                    ? '🔄 업데이트 다운로드 중...'
                    : '🔍 업데이트 확인',
                click: () => {
                    showWindow();
                    if (lastUpdateStatus) {
                        if (win) win.webContents.send('update-status', lastUpdateStatus);
                    } else if (autoUpdater) {
                        autoUpdater.checkForUpdates().catch(() => {});
                    }
                }
            },
            { type: 'separator' },
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
const _ruleLastNotif = {};              // ruleName → last OS-notif timestamp
const NOTIF_COOLDOWN = 30 * 60 * 1000; // 같은 룰 30분 이내 중복 OS 알림 차단
let lastUpdateStatus = null;   // 페이지 로드 전 이벤트 캐시
let monitorSuppressed = false; // 모니터링 차단 유저 플래그
let osNotifMuted      = false; // OS 알림만 차단 플래그
const _sseBlinkLabels = {};    // ruleKey → label (SSE 감지 상태)
let _rendererBlinkLabels = []; // 렌더러 IPC 요청 레이블

// ── 버전 표시 (26.6.17 형식, .0 끝나면 축약) ─────────────
function appDisplayVersion() {
    const v = app.getVersion();
    return v.endsWith('.0') ? v.slice(0, -2) : v;
}

// ── 타이틀 깜빡임 핵심 함수 ───────────────────────────────
let _titleBlinkTimer = null;
function _updateTitleBlink() {
    if (_titleBlinkTimer) { clearInterval(_titleBlinkTimer); _titleBlinkTimer = null; }
    const merged = [..._rendererBlinkLabels, ...Object.values(_sseBlinkLabels)];
    const labels  = [...new Set(merged)];
    const ver      = appDisplayVersion();
    const base     = 'IMI PRO v' + ver + ' 🟢';
    const alertTxt = 'IMI PRO v' + ver + ' 🚨';
    if (labels.length === 0) { if (win) win.setTitle(base); return; }
    let idx = 0;
    _titleBlinkTimer = setInterval(() => {
        if (!win) return;
        win.setTitle(idx++ % 2 === 0 ? alertTxt : base);
    }, 900);
}

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
        title: 'IMI PRO v' + appDisplayVersion(),
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

    // 페이지 title 변경 완전 차단 — 항상 고정 타이틀 유지
    win.on('page-title-updated', (e) => {
        e.preventDefault();
        win.setTitle('IMI PRO v' + appDisplayVersion());
    });

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

    // F5 / Ctrl+R 새로고침 단축키 복원
    win.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown') return;
        if (input.key === 'F5' || (input.control && input.key === 'r')) {
            win.webContents.reloadIgnoringCache();
        }
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

                const now = Date.now();
                let sseChanged = false;
                for (const d of items) {
                    if (!d) continue;
                    const ruleKey = d.ruleName || d.keyword || '_default';
                    const at = d.at || 0;
                    const isActive = d.active && (now - at <= 120000);

                    if (isActive) {
                        // OS 알림 (30분 쿨다운)
                        if (now - (_ruleLastNotif[ruleKey] || 0) >= NOTIF_COOLDOWN) {
                            _ruleLastNotif[ruleKey] = now;
                            const title = '🚨 ' + (d.ruleName || 'IMI PRO') + ' 감지됨';
                            const body  = (d.itemCount || 0) + '개 감지 · 키워드: ' + (d.keyword || '') + '\nIMI PRO 확인 바랍니다';
                            if (!monitorSuppressed && !osNotifMuted) showNativeNotif(title, body);
                        }
                        // 타이틀 깜빡임 (쿨다운 없음)
                        if (!_sseBlinkLabels[ruleKey]) { _sseBlinkLabels[ruleKey] = d.ruleName || '알림'; sseChanged = true; }
                    } else {
                        if (_sseBlinkLabels[ruleKey]) { delete _sseBlinkLabels[ruleKey]; sseChanged = true; }
                    }
                }
                if (sseChanged) _updateTitleBlink();
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
        buildAppMenu();   // 메뉴 레이블 갱신
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
ipcMain.handle('show-notification', (_, { title, body }) => { if (!monitorSuppressed && !osNotifMuted) showNativeNotif(title, body); });
ipcMain.handle('get-version',       ()                   => app.getVersion());
ipcMain.handle('install-update',    ()                   => { if (autoUpdater) autoUpdater.quitAndInstall(true, true); });
ipcMain.on('set-monitor-disabled',  (_, val)             => { monitorSuppressed = !!val; });
ipcMain.on('set-os-notif-muted',    (_, val)             => { osNotifMuted = !!val; });
ipcMain.on('flash-frame',           (_, val)             => { if (win) win.flashFrame(!!val); });

// ── 타이틀 깜빡임 IPC (렌더러 요청) ─────────────────────
ipcMain.on('blink-title', (_, { on, labels }) => {
    _rendererBlinkLabels = on && labels && labels.length > 0 ? labels : [];
    _updateTitleBlink();
});

// ── 앱 시작 ───────────────────────────────────────────────
app.whenReady().then(async () => {
    // 버전 변경 시 캐시 초기화 (구버전 index.html 캐시 방지)
    const ses = require('electron').session.fromPartition('persist:imipro');
    const s   = loadSettings();
    if (s.lastCachedVersion !== app.getVersion()) {
        try { await ses.clearCache(); } catch(_) {}
        s.lastCachedVersion = app.getVersion();
        saveSettings(s);
    }

    buildAppMenu();
    createWindow();
    createTray();

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
