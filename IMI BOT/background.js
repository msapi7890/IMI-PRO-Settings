const DB_URL = "https://manual-9a47c-default-rtdb.firebaseio.com";

// --- Firebase REST (5초 타임아웃 적용) ---
async function fireGet(path) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
        const res = await fetch(DB_URL + path + '.json', { signal: ctrl.signal });
        if (res.ok) return await res.json();
    } catch(e) {}
    finally { clearTimeout(t); }
    return null;
}

async function fireSet(path, data) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
        await fetch(DB_URL + path + '.json', {
            method: 'PUT', body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
            signal: ctrl.signal
        });
    } catch(e) {
        // 타임아웃 또는 네트워크 차단 — 무시
    } finally {
        clearTimeout(t);
    }
}
async function firePush(path, data) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
        await fetch(DB_URL + path + '.json', {
            method: 'POST', body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
            signal: ctrl.signal
        });
    } catch(e) {
        // 타임아웃 또는 네트워크 차단 — 무시
    } finally {
        clearTimeout(t);
    }
}

// Firebase 빈 배열 저장 시 null 반환 문제 전용 처리
// fireGet은 null=에러, fireGetBlocked는 null=정상 빈 목록으로 구분
async function fireGetBlocked() {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
        const res = await fetch(DB_URL + '/imi_blocked.json', { signal: ctrl.signal });
        if (res.ok) {
            const data = await res.json();
            return Array.isArray(data) ? data : [];  // null(빈 목록) → []
        }
    } catch(e) {}
    finally { clearTimeout(t); }
    return null;  // null = 네트워크 에러(폴백 필요)
}

// --- Storage helpers ---
const store = {
    get: (key) => new Promise(r => chrome.storage.local.get(key, d => r(d[key]))),
    set: (key, val) => new Promise(r => chrome.storage.local.set({ [key]: val }, r)),
};
const getRules  = () => store.get('imi_rules').then(v => v || []);
const saveRules = (r) => store.set('imi_rules', r);
const getTabMap  = () => store.get('imi_tab_map').then(v => v || {});
const saveTabMap = (m) => store.set('imi_tab_map', m);
const isActive   = () => store.get('imi_active').then(v => !!v);
const getBlocked        = () => store.get('imi_blocked').then(v => v || []);
const getBlockedCleared = () => store.get('imi_blocked_cleared_at').then(v => v || 0);
const THIRTY_DAYS_MS    = 30 * 24 * 60 * 60 * 1000;

// 30일 경과 시 차단 목록 자동 초기화 (전체 실무자 공유)
async function maybeCleanupBlocked() {
    const clearedAt = await getBlockedCleared();
    if (!clearedAt) {
        // 최초 실행 — 타임스탬프만 초기화, 목록은 건드리지 않음
        await store.set('imi_blocked_cleared_at', Date.now());
        return;
    }
    if (Date.now() - clearedAt < THIRTY_DAYS_MS) return;
    await store.set('imi_blocked', []);
    await store.set('imi_blocked_cleared_at', Date.now());
    await fireSet('/imi_blocked', []);
}

// Firebase 규칙 동기화 (다른 실무자가 변경한 규칙 수신)
async function syncRulesFromFirebase() {
    try {
        const remote = await fireGet('/imi_rules');
        if (!remote || !Array.isArray(remote) || !remote.length) return;
        const local = await getRules();
        const remoteIds = new Set(remote.map(r => r.id));
        const onlyLocal = local.filter(r => !remoteIds.has(r.id));
        const merged = [...remote, ...onlyLocal];
        await saveRules(merged);
    } catch(e) {}
}

// 서비스워커 시작 시 Firebase 차단목록 + 규칙 동기화
(async () => {
    await maybeCleanupBlocked();
    const remote = await fireGetBlocked();
    if (remote !== null) {
        if (remote.length > 0) {
            const local = await getBlocked();
            const remoteKeys = new Set(remote.map(i => (typeof i === 'object' ? i.key : i)));
            const onlyLocal = local.filter(i => !remoteKeys.has(typeof i === 'object' ? i.key : i));
            await store.set('imi_blocked', [...remote, ...onlyLocal]);
        } else {
            await store.set('imi_blocked', []);  // Firebase 빈 목록 → 로컬도 초기화
        }
    }
    await syncRulesFromFirebase();
    await syncStatus();
})();

// --- Firebase 상태 동기화 (IMI PRO 대시보드용) ---
async function syncStatus() {
    const [rules, tabMap, active] = await Promise.all([getRules(), getTabMap(), isActive()]);
    const ruleStatus = rules.map(r => ({
        id: r.id,
        name: r.name,
        keyword: r.keyword || '',
        minPrice: r.minPrice || 0,
        maxPrice: r.maxPrice || 0,
        scanInterval: r.scanInterval || 5,
        excludeKeyword: r.excludeKeyword || '',
        photoOnly: !!r.photoOnly,
        type: r.type || 'fraud',
        enabled: r.enabled,
        tabOpen: tabMap[r.id] !== undefined
    }));
    await fireSet('/bot_status', {
        active,
        rules: ruleStatus,
        activeCount: ruleStatus.filter(r => r.enabled && r.tabOpen).length,
        totalCount: ruleStatus.length,
        lastUpdate: Date.now()
    }).catch(() => {});
}

// --- Tab management ---
async function startAll() {
    await store.set('imi_active', true);
    const rules  = await getRules();
    const tabMap = await getTabMap();

    for (const rule of rules) {
        if (!rule.enabled) continue;
        if (tabMap[rule.id]) {
            try { await chrome.tabs.get(tabMap[rule.id]); continue; } catch(e) {}
        }
        const tab = await chrome.tabs.create({ url: rule.url, active: false });
        tabMap[rule.id] = tab.id;
    }
    await saveTabMap(tabMap);
    await syncStatus();
}

async function stopAll() {
    await store.set('imi_active', false);
    // 모든 아이템매니아 탭에 STOP 브로드캐스트 (tabMap 비어있어도 동작)
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
        if (tab.url && tab.url.includes('itemmania.com')) {
            chrome.tabs.sendMessage(tab.id, { type: 'STOP_BOT' }).catch(() => {});
        }
    }
    const tabMap = await getTabMap();
    for (const tabId of Object.values(tabMap)) {
        try { await chrome.tabs.remove(tabId); } catch(e) {}
    }
    await saveTabMap({});
    await syncStatus();
}

async function startSelected(ruleIds) {
    const rules = await getRules();
    for (const rule of rules) {
        rule.enabled = (ruleIds || []).includes(rule.id);
    }
    await saveRules(rules);
    await store.set('imi_active', true);
    const tabMap = await getTabMap();
    for (const rule of rules.filter(r => !r.enabled)) {
        const tabId = tabMap[rule.id];
        if (tabId) { try { await chrome.tabs.remove(tabId); } catch(e) {} delete tabMap[rule.id]; }
    }
    for (const rule of rules.filter(r => r.enabled)) {
        if (tabMap[rule.id]) { try { await chrome.tabs.get(tabMap[rule.id]); continue; } catch(e) {} }
        const tab = await chrome.tabs.create({ url: rule.url, active: false });
        tabMap[rule.id] = tab.id;
    }
    await saveTabMap(tabMap);
    await syncStatus();
}

// Firebase 제어 채널: 웹에서 bot_cmd 쓰면 여기서 읽고 실행
async function checkBotCmd() {
    const cmd = await fireGet('/bot_cmd');
    if (!cmd || !cmd.ts) return;
    const lastHandled = await store.get('imi_cmd_ts').then(v => v || 0);
    if (cmd.ts <= lastHandled) return;
    await store.set('imi_cmd_ts', cmd.ts);
    if (cmd.cmd === 'stop') {
        await stopAll();
    } else if (cmd.cmd === 'start' && Array.isArray(cmd.ruleIds)) {
        await startSelected(cmd.ruleIds);
    }
}

// 탭이 닫히면 맵에서 제거
chrome.tabs.onRemoved.addListener(async (tabId) => {
    const tabMap = await getTabMap();
    const entry = Object.entries(tabMap).find(([, tid]) => tid === tabId);
    if (!entry) return;
    delete tabMap[entry[0]];
    await saveTabMap(tabMap);
    // 감시 중이면 2초 후 해당 탭 재오픈
    if (await isActive()) {
        setTimeout(async () => {
            const rules = await getRules();
            const rule  = rules.find(r => r.id === entry[0] && r.enabled);
            if (!rule) return;
            const newTabMap = await getTabMap();
            const tab = await chrome.tabs.create({ url: rule.url, active: false });
            newTabMap[rule.id] = tab.id;
            await saveTabMap(newTabMap);
            await syncStatus();
        }, 2000);
    }
    await syncStatus();
});

// 알람: 탭 생존 확인(3분) + 차단목록 월간 정리(24시간)
function ensureAlarms() {
    chrome.alarms.get('imi_watchdog',   a => { if (!a) chrome.alarms.create('imi_watchdog',   { periodInMinutes: 3 }); });
    chrome.alarms.get('imi_rule_sync',  a => { if (!a) chrome.alarms.create('imi_rule_sync',  { periodInMinutes: 1 }); });
    chrome.alarms.get('imi_cleanup',    a => { if (!a) chrome.alarms.create('imi_cleanup',    { periodInMinutes: 60 * 24 }); });
    chrome.alarms.get('imi_tid_watch',  a => { if (!a) chrome.alarms.create('imi_tid_watch',  { periodInMinutes: 1 }); });
}
chrome.runtime.onInstalled.addListener(ensureAlarms);
chrome.runtime.onStartup.addListener(ensureAlarms);
ensureAlarms(); // 서비스워커 재시작 시에도 보장
// 재시작 시 즉시 비거래 배너 상태 동기화 (알람 대기 없이 바로 반영)
setTimeout(() => { checkWatchedTids(); checkWatchScanRules(); }, 3000);
chrome.alarms.onAlarm.addListener(async alarm => {
    if (alarm.name === 'imi_watchdog') {
        if (await isActive()) await startAll();
    }
    if (alarm.name === 'imi_rule_sync') {
        await checkBotCmd(); // 웹 제어 채널 확인 (최대 1분 지연)
        await syncRulesFromFirebase();
        // 차단 목록도 Firebase 기준으로 덮어씀 (차단 해제 반영)
        const remoteBlocked = await fireGetBlocked();
        if (remoteBlocked !== null) {
            await store.set('imi_blocked', remoteBlocked);
        }
        await syncStatus();
    }
    if (alarm.name === 'imi_cleanup') await maybeCleanupBlocked();
    if (alarm.name === 'imi_tid_watch') { await checkWatchedTids(); await checkWatchScanRules(); }
    if (alarm.name === 'imi_rule_sync') await syncTidWatchInterval();
});

// 서비스워커 시작 시 밀린 명령 처리 + 현재 상태 즉시 Firebase 반영
checkBotCmd().catch(() => {});
syncStatus().catch(() => {});

// --- Message handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FIREBASE_SET') {
        // 봇 탭 ID 자동 갱신 → OPEN_ITEM_IN_TAB에서 올바른 탭 사용
        if (sender.tab && sender.tab.id && msg.data && msg.data.ruleId) {
            getTabMap().then(m => {
                m[msg.data.ruleId] = sender.tab.id;
                saveTabMap(m);
            });
        }
        fireSet(msg.path, msg.data).then(async () => {
            if (msg.path === '/monitor_flash_state' && msg.data && msg.data.active) {
                if (msg.data.ruleType === 'watch') {
                    showWatchPopup(msg.data);
                }
                // logItemRows가 null이면 재감지 → history 기록 스킵 (중복 로그 방지)
                const logRows = msg.data.logItemRows;
                if (Array.isArray(logRows) && logRows.length > 0) {
                    await firePush('/monitor_history', {
                        ruleName: msg.data.ruleName || '',
                        ruleKeyword: msg.data.ruleKeyword || '',
                        itemCount: logRows.length,
                        itemRows: logRows,
                        at: msg.data.at || Date.now()
                    });
                }
            }
            sendResponse({ ok: true });
        }).catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }
    if (msg.type === 'FIREBASE_PUSH') {
        firePush(msg.path, msg.data).then(() => sendResponse({ ok: true })).catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
    }
    // 컨텐츠 스크립트가 자신의 규칙을 물어볼 때
    if (msg.type === 'GET_MY_RULE') {
        getTabMap().then(async tabMap => {
            const [rules, active, globalTodayOnly] = await Promise.all([getRules(), isActive(), fireGet('/global_today_only')]);
            const ruleId   = Object.entries(tabMap).find(([, tid]) => tid === sender.tab.id)?.[0];
            const rule     = ruleId ? (rules.find(r => r.id === ruleId) || null) : null;
            // 글로벌 오늘만 설정으로 todayOnly 주입 → bot.js 초기값으로 사용
            const ruleOut  = rule ? Object.assign({}, rule, { todayOnly: !!globalTodayOnly }) : null;
            // 봇이 정지 상태면 botStopped 플래그 반환 → 페이지 재로드 후 재시작 방지
            sendResponse({ rule: ruleOut, botStopped: !active });
        });
        return true;
    }
    if (msg.type === 'BLOCK_ITEM') {
        getBlocked().then(async list => {
            const keys = list.map(i => (typeof i === 'object' ? i.key : i));
            if (!keys.includes(msg.key)) {
                list.push(msg.title ? { key: msg.key, title: msg.title } : msg.key);
                await store.set('imi_blocked', list);
                await fireSet('/imi_blocked', list);
            }
            sendResponse({ ok: true });
        });
        return true;
    }
    if (msg.type === 'GET_BLOCKED') {
        fireGetBlocked().then(async remote => {
            // remote !== null → Firebase 도달 성공 (빈 배열 포함)
            // remote === null → 네트워크 에러 → 로컬 폴백
            const list = remote !== null ? remote : await getBlocked();
            if (remote !== null) await store.set('imi_blocked', list);
            const keys = list.map(i => (typeof i === 'object' ? i.key : i));
            sendResponse({ blocked: keys });
        });
        return true;
    }
    if (msg.type === 'START_RULE') {
        // 해당 규칙 탭만 열기
        getTabMap().then(async tabMap => {
            const rules = await getRules();
            const rule = rules.find(r => r.id === msg.ruleId && r.enabled);
            if (rule) {
                if (tabMap[rule.id]) {
                    try { await chrome.tabs.get(tabMap[rule.id]); sendResponse({ ok: true }); return; } catch(e) {}
                }
                const tab = await chrome.tabs.create({ url: rule.url, active: false });
                tabMap[rule.id] = tab.id;
                await saveTabMap(tabMap);
                await syncStatus();
            }
            sendResponse({ ok: true });
        });
        return true;
    }
    if (msg.type === 'STOP_RULE') {
        // 해당 규칙 탭만 닫기
        getTabMap().then(async tabMap => {
            const tabId = tabMap[msg.ruleId];
            if (tabId) {
                try { await chrome.tabs.remove(tabId); } catch(e) {}
                delete tabMap[msg.ruleId];
                await saveTabMap(tabMap);
                await syncStatus();
            }
            sendResponse({ ok: true });
        });
        return true;
    }
    if (msg.type === 'OPEN_ITEM_IN_TAB') {
        (async () => {
            const [tabMap, rules] = await Promise.all([getTabMap(), getRules()]);
            // msg.url 우선, 없으면 tid로 구성
            const url = msg.url || ('https://www.itemmania.com/sell/application.html?tid=' + msg.tid);
            const rule = rules.find(r => r.id === msg.ruleId);

            let tabId = tabMap[msg.ruleId];
            if (tabId) {
                try { await chrome.tabs.get(tabId); } catch(e) { tabId = null; }
            }
            // tabMap에 없으면 열려있는 아이템매니아 탭 검색
            if (!tabId) {
                const allTabs = await chrome.tabs.query({});
                const found = allTabs.find(t =>
                    t.url && t.url.includes('itemmania.com') && !t.url.includes('application.html')
                );
                if (found) {
                    tabId = found.id;
                    const newMap = await getTabMap();
                    newMap[msg.ruleId] = tabId;
                    await saveTabMap(newMap);
                }
            }

            if (tabId) {
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId },
                        world: 'MAIN',
                        func: (u) => { location.href = u; },
                        args: [url]
                    });
                    await chrome.tabs.update(tabId, { active: true });
                    // 봇 활성 상태면 새 스캔 탭 생성
                    if (rule && await isActive()) {
                        const newTab = await chrome.tabs.create({ url: rule.url, active: false });
                        const newMap = await getTabMap();
                        newMap[rule.id] = newTab.id;
                        await saveTabMap(newMap);
                        await syncStatus();
                    }
                    sendResponse({ ok: true });
                } catch(e) {
                    chrome.tabs.create({ url });
                    sendResponse({ ok: false });
                }
            } else {
                // 스캔 탭 없음 → 새 탭으로 fallback
                chrome.tabs.create({ url });
                sendResponse({ ok: false });
            }
        })();
        return true;
    }
    // alert_popup → 스캔 탭의 bot.js에 DOM 클릭 요청
    if (msg.type === 'CLICK_ITEM_IN_SCAN_TAB') {
        (async () => {
            const tabMap = await getTabMap();
            let tabId = tabMap[msg.ruleId];
            if (tabId) { try { await chrome.tabs.get(tabId); } catch(e) { tabId = null; } }
            if (!tabId) {
                const allTabs = await chrome.tabs.query({});
                const found = allTabs.find(t => t.url && t.url.includes('itemmania.com') && !t.url.includes('application.html'));
                if (found) tabId = found.id;
            }
            if (tabId) {
                const url = msg.url;
                const tidM = url.match(/[?&]tid=(\d+)/);
                const idM  = url.match(/[?&]id=(\d+)/);
                try {
                    // MAIN world에서 직접 DOM 클릭 → itemmania 자체 이벤트 핸들러 정상 동작
                    await chrome.scripting.executeScript({
                        target: { tabId },
                        world: 'MAIN',
                        func: (u, tid, id) => {
                            let el = null;
                            if (tid) {
                                el = document.querySelector('li[data-tid="' + tid + '"]') ||
                                     document.querySelector('[data-tid="' + tid + '"]');
                            }
                            if (!el && id) {
                                el = document.querySelector('[data-id="' + id + '"]') ||
                                     document.querySelector('[data-no="' + id + '"]');
                                if (!el) {
                                    document.querySelectorAll('[onclick]').forEach(function(e) {
                                        if (!el && (e.getAttribute('onclick') || '').includes(id)) el = e;
                                    });
                                }
                            }
                            if (el) { (el.querySelector('a') || el).click(); return true; }
                            location.href = u;
                            return false;
                        },
                        args: [url, tidM ? tidM[1] : null, idM ? idM[1] : null]
                    });
                } catch(e) {
                    chrome.tabs.create({ url });
                }
                chrome.tabs.update(tabId, { active: true }).catch(() => {});
            } else {
                chrome.tabs.create({ url: msg.url });
            }
            sendResponse({ ok: true });
        })();
        return true;
    }
    // 웹 대시보드에서 개별 규칙 활성/비활성
    if (msg.type === 'TOGGLE_RULE') {
        (async () => {
            const rules = await getRules();
            const idx = rules.findIndex(r => r.id === msg.ruleId);
            if (idx === -1) { sendResponse({ ok: false }); return; }
            rules[idx].enabled = msg.enabled;
            await saveRules(rules);
            const tabMap = await getTabMap();
            if (msg.enabled) {
                if (!tabMap[msg.ruleId]) {
                    const tab = await chrome.tabs.create({ url: rules[idx].url, active: false });
                    tabMap[msg.ruleId] = tab.id;
                    await saveTabMap(tabMap);
                }
            } else {
                const tabId = tabMap[msg.ruleId];
                if (tabId) {
                    try { await chrome.tabs.remove(tabId); } catch(e) {}
                    delete tabMap[msg.ruleId];
                    await saveTabMap(tabMap);
                }
            }
            await syncStatus();
            sendResponse({ ok: true });
        })();
        return true;
    }
    // 웹에서 체크된 규칙만 시작
    if (msg.type === 'START_SELECTED') {
        startSelected(msg.ruleIds).then(() => sendResponse({ ok: true }));
        return true;
    }
    if (msg.type === 'START_ALL')   { startAll().then(() => sendResponse({ ok: true })); return true; }
    if (msg.type === 'STOP_ALL')    { stopAll().then(() => sendResponse({ ok: true })); return true; }
    if (msg.type === 'SYNC_STATUS') { syncStatus(); sendResponse({ ok: true }); }
    if (msg.type === 'UPDATE_NOTIF_PREF') {
        store.set('imi_notif_' + msg.key, msg.val);
        sendResponse({ ok: true });
    }
});

// 비거래 감지 팝업 (좌측 하단, 초록 테마)
let _watchWinId = null;
let _lastWatchAt = 0;

async function showWatchPopup(data) {
    const popupOn = await store.get('imi_notif_popup');
    if (popupOn === false) return;

    const now = Date.now();
    if (now - _lastWatchAt < 5000) return;
    _lastWatchAt = now;

    // IMI PRO 인페이지 알림 (Firebase 경유 — 확장프로그램 없는 사용자도 수신)
    try {
        await firePush('/imi_watch_alerts', {
            tid:     data.tid     || '',
            label:   data.label   || data.ruleName || '',
            keyword: data.keyword || '',
            count:   data.count   || 0,
            at:      now,
            seen:    false
        });
    } catch(e) {}
}

// 거래번호 감시 체크 간격 동기화 (imi_rule_sync 때마다 실행)
// tid_watch_interval 단위: 초 (60~3600). Chrome alarm은 분 단위이므로 변환.
let _lastTidInterval = 0;
async function syncTidWatchInterval() {
    const v = await fireGet('/tid_watch_interval');
    const secs = (typeof v === 'number' && v >= 60) ? v : 1200; // 기본 20분(1200초)
    if (secs === _lastTidInterval) return;
    _lastTidInterval = secs;
    const mins = Math.max(1, secs / 60);
    chrome.alarms.clear('imi_tid_watch', () => {
        chrome.alarms.create('imi_tid_watch', { periodInMinutes: mins });
    });
}

// 거래번호 감시 — 숨김→노출 전환 감지, 노출 유지 여부 지속 추적
async function checkWatchedTids() {
    const tids = await fireGet('/watched_tids');
    if (!tids || typeof tids !== 'object') return;

    for (const [key, item] of Object.entries(tids)) {
        if (!item) continue;

        const tid = String(item.tid || '');
        if (!tid) continue;

        const url = 'https://www.itemmania.com/sell/application.html?id=' + tid;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 8000);
            const resp = await fetch(url, { redirect: 'follow', signal: ctrl.signal });
            clearTimeout(t);
            const text = await resp.text();

            // 로그인 페이지로 리다이렉트 됐거나 tid가 페이지에 없으면 아직 숨김
            const stillHidden = !resp.url.includes('application.html') || !text.includes(tid);

            if (stillHidden) {
                // 숨김 확인 → 배너 비활성화, alertSent 초기화 (다음 노출 시 재알림)
                await fireSet('/imi_watch_banner/' + key + '/active', false);
                if (item.alertSent) {
                    await fireSet('/watched_tids/' + key + '/alertSent', false);
                }
                continue;
            }

            // 노출 감지 — 물품명 추출 시도
            const titleMatch = text.match(/<h2[^>]*class="[^"]*subject[^"]*"[^>]*>([^<]+)</) ||
                               text.match(/<title[^>]*>([^<|]+)/);
            const itemTitle = (titleMatch ? titleMatch[1].trim() : '') || item.label || ('거래번호 ' + tid);

            const now = Date.now();

            // 배너 상태 항상 업데이트 (노출 중임을 표시)
            await fireSet('/imi_watch_banner/' + key, {
                active: true, tid, label: item.label || '', title: itemTitle, url, at: now
            });

            // 최초 감지 시에만 팝업 알림 + 로그 기록
            if (!item.alertSent) {
                await fireSet('/watched_tids/' + key + '/alertSent', true);
                await fireSet('/watched_tids/' + key + '/detectedAt', now);

                showWatchPopup({
                    ruleName: item.label || tid,
                    ruleId: key, ruleType: 'watch',
                    itemCount: 1,
                    itemRows: [{ t: itemTitle, tid, u: url, p: '' }]
                });

                // 로그 기록 (사기글 감지와 동일한 경로)
                await firePush('/monitor_history', {
                    ruleName: (item.label || '') + ' (비거래 감시)',
                    ruleKeyword: tid,
                    itemCount: 1,
                    itemRows: [{ t: itemTitle, tid, u: url, p: '', listTime: '' }],
                    at: now
                });
            }
        } catch(e) {}
    }
}

// ─── 비거래 스캔 감지 (watch_scan_rules) ───────────────────────────────────
// 탭/콘텐츠스크립트 불필요 — background.js가 직접 URL을 fetch해서 1페이지 스캔
const _wsr_lastChecked = {}; // 규칙별 마지막 체크 시각
let _cachedGlobalTodayOnly = null; // 변경 감지용 캐시

async function checkWatchScanRules() {
    const [rules, globalTodayOnly] = await Promise.all([
        fireGet('/watch_scan_rules'),
        fireGet('/global_today_only')
    ]);
    if (!rules || typeof rules !== 'object') return;

    // 글로벌 오늘만 설정 변경 시 실행 중인 봇 탭에 실시간 전달
    const newVal = !!globalTodayOnly;
    if (_cachedGlobalTodayOnly !== null && _cachedGlobalTodayOnly !== newVal) {
        const tabMap = await getTabMap();
        for (const tabId of Object.values(tabMap)) {
            try { chrome.tabs.sendMessage(tabId, { type: 'UPDATE_GLOBAL_TODAY_ONLY', val: newVal }); } catch(e) {}
        }
    }
    _cachedGlobalTodayOnly = newVal;

    for (const [key, rule] of Object.entries(rules)) {
        if (!rule || !rule.enabled || !rule.url) continue;

        const interval = (rule.scanInterval || 300) * 1000; // ms
        if (_wsr_lastChecked[key] && Date.now() - _wsr_lastChecked[key] < interval) continue;
        _wsr_lastChecked[key] = Date.now();

        const kws = (rule.keyword || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
        if (!kws.length) continue;
        const exKws = (rule.excludeKeyword || '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean);

        // 글로벌 오늘만 설정으로만 제어
        let todayDateStr = null;
        if (newVal) {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            todayDateStr = y + '.' + m + '.' + d; // "2026.05.21"
        }

        let matched = [];
        let scanOk = false;
        let scanErr = '';
        try {
            matched = await _wsrScanViaTab(rule, kws, exKws, todayDateStr);
            scanOk = true;
        } catch(e) { scanErr = e.message || String(e); }

        // 마지막 체크 시각 + 결과 기록 (UI 카드에 표시)
        await fireSet('/watch_scan_rules/' + key + '/lastCheck', Date.now());
        await fireSet('/watch_scan_rules/' + key + '/lastCount', scanOk ? matched.length : -1);
        if (!scanOk) await fireSet('/watch_scan_rules/' + key + '/lastError', scanErr);
        else await fireSet('/watch_scan_rules/' + key + '/lastError', null); // 성공 시 이전 오류 초기화

        if (!scanOk) continue;

        if (matched.length > 0) {
            const now = Date.now();
            // 이전 활성 상태 먼저 조회 (set 이전에 해야 prev 값이 정확함)
            const prevActive = await fireGet('/imi_watch_banner/wsr_' + key + '/active');
            await fireSet('/imi_watch_banner/wsr_' + key, {
                active: true, label: rule.name || rule.keyword || '',
                keyword: rule.keyword || '', count: matched.length, url: rule.url, at: now
            });
            // 최초 감지 또는 이전에 inactive 였을 때만 알림 발송
            if (!prevActive) {
                await firePush('/imi_watch_alerts', {
                    label: rule.name || rule.keyword || '',
                    keyword: rule.keyword || '',
                    count: matched.length,
                    at: now, seen: false
                });
                await firePush('/monitor_history', {
                    ruleName: (rule.name || rule.keyword || '') + ' (비거래 스캔)',
                    ruleKeyword: rule.keyword || '',
                    itemCount: matched.length,
                    itemRows: matched.map(it => ({ t: it.t, p: 0, u: it.u, tid: it.tid, listTime: '' })),
                    at: now
                });
            }
        } else {
            await fireSet('/imi_watch_banner/wsr_' + key + '/active', false);
        }
    }
}

// 비거래 스캔: 실제 탭을 열어서 DOM에서 직접 긁음 (fetch+파싱 방식 대체)
async function _wsrScanViaTab(rule, kws, exKws, todayDateStr) {
    const todayPrefix = todayDateStr ? todayDateStr.replace(/\./g, '') : null;
    const allItems = [];

    for (let page = 1; page <= 2; page++) {
        const pageUrl = page === 1 ? rule.url
            : rule.url + (rule.url.includes('?') ? '&' : '?') + 'page=' + page;

        const tab = await new Promise((resolve, reject) => {
            chrome.tabs.create({ url: pageUrl, active: false }, t => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(t);
            });
        });

        try {
            // 페이지 로딩 완료 대기 (최대 20초)
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    reject(new Error('페이지 로딩 타임아웃'));
                }, 20000);
                const listener = (tabId, changeInfo) => {
                    if (tabId === tab.id && changeInfo.status === 'complete') {
                        clearTimeout(timeout);
                        chrome.tabs.onUpdated.removeListener(listener);
                        resolve();
                    }
                };
                chrome.tabs.onUpdated.addListener(listener);
            });

            // JS 렌더링 여유 시간
            await new Promise(r => setTimeout(r, 1500));

            const res = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (kws, exKws, todayPrefix) => {
                    const items = [];
                    const seen = new Set();
                    document.querySelectorAll('li, tr, .item_row, .item_wrap').forEach(el => {
                        if (el.querySelector('li, tr')) return;
                        const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
                        if (text.length < 10) return;
                        const tl = text.toLowerCase();
                        if (!kws.some(k => tl.includes(k))) return;
                        if (exKws.length && exKws.some(k => tl.includes(k))) return;
                        const a = el.querySelector('a[href*="application"]') || el.querySelector('a[href]');
                        const href = a ? a.href : location.href;
                        if (todayPrefix) {
                            const m = href.match(/[?&]tid=(\d+)/);
                            if (m && !m[1].startsWith(todayPrefix)) return;
                        }
                        const key = href || text.substring(0, 30);
                        if (seen.has(key)) return;
                        seen.add(key);
                        const titleEl = el.querySelector('.subject, .kind_title, .item_title, .title, td:nth-child(2)');
                        const title = titleEl ? (titleEl.innerText || '').trim().substring(0, 60) : text.substring(0, 60);
                        const tidM = href.match(/[?&](?:tid|id)=(\d+)/);
                        items.push({ t: title, u: href, tid: tidM ? tidM[1] : '' });
                    });
                    return items;
                },
                args: [kws, exKws, todayPrefix]
            });

            const pageItems = (res && res[0] && res[0].result) || [];
            allItems.push(...pageItems);

        } finally {
            try { chrome.tabs.remove(tab.id); } catch(e) {}
        }
    }

    // TID 기준 중복 제거
    const seen = new Set();
    return allItems.filter(item => {
        const key = item.tid || item.u || item.t;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
