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
async function fireUpdate(path, data) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
        await fetch(DB_URL + path + '.json', {
            method: 'PATCH', body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' },
            signal: ctrl.signal
        });
    } catch(e) {} finally { clearTimeout(t); }
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
let _cachedGlobalTodayOnly = null;
const getTabMap  = () => store.get('imi_tab_map').then(v => v || {});
const saveTabMap = (m) => store.set('imi_tab_map', m);
const isActive   = () => store.get('imi_active').then(v => !!v);
const getBlocked        = () => store.get('imi_blocked').then(v => v || []);
const getBlockedCleared = () => store.get('imi_blocked_cleared_at').then(v => v || 0);
const THIRTY_DAYS_MS    = 30 * 24 * 60 * 60 * 1000;

// 사기글 통계 버퍼 — 1분마다 Firebase에 플러시 (TID 중복 제거)
const _fraudSeenTids = {}; // dateStr → Set (서비스워커 세션 내 중복 방지)
const _fraudStatsBuffer = {}; // 'dateStr|hourStr' → count

function _recordFraudStat(at, itemRows) {
    const d = new Date(at);
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const hourStr = pad(d.getHours());
    const key = dateStr + '|' + hourStr;
    if (!_fraudSeenTids[dateStr]) _fraudSeenTids[dateStr] = new Set();
    const seen = _fraudSeenTids[dateStr];
    let newCount = 0;
    for (const row of itemRows) {
        const tid = row.tid || row.key || '';
        if (tid && !seen.has(tid)) { seen.add(tid); newCount++; }
    }
    if (newCount > 0) _fraudStatsBuffer[key] = (_fraudStatsBuffer[key] || 0) + newCount;
}

async function _flushFraudStats() {
    const keys = Object.keys(_fraudStatsBuffer);
    if (!keys.length) return;
    for (const key of keys) {
        const count = _fraudStatsBuffer[key];
        delete _fraudStatsBuffer[key];
        const [dateStr, hourStr] = key.split('|');
        const existing = await fireGet(`/imi_fraud_stats/${dateStr}/${hourStr}`) || 0;
        await fireSet(`/imi_fraud_stats/${dateStr}/${hourStr}`, existing + count);
    }
}

// 1일 이상 된 imi_watch_alerts 항목 → 통계 집계 후 삭제
async function cleanupWatchAlerts() {
    const data = await fireGet('/imi_watch_alerts');
    if (!data || typeof data !== 'object') return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    // 삭제 대상 항목을 날짜/시간대/키워드별로 집계
    const statsMap = {}; // dateStr → hourStr → { total, keywords: {} }
    const toDelete = [];
    for (const [key, val] of Object.entries(data)) {
        if (!val || (val.at || 0) >= cutoff) continue;
        toDelete.push(key);
        const d = new Date(val.at);
        const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        const hourStr = String(d.getHours()).padStart(2,'0');
        const keyword = val.keyword || '';
        const count = val.count || 1;
        if (!statsMap[dateStr]) statsMap[dateStr] = {};
        if (!statsMap[dateStr][hourStr]) statsMap[dateStr][hourStr] = { total: 0, keywords: {} };
        statsMap[dateStr][hourStr].total += count;
        if (keyword) statsMap[dateStr][hourStr].keywords[keyword] = (statsMap[dateStr][hourStr].keywords[keyword] || 0) + count;
    }

    // Firebase에 통계 누적 저장
    for (const [dateStr, hours] of Object.entries(statsMap)) {
        const existing = await fireGet('/imi_watch_stats/' + dateStr) || {};
        for (const [hourStr, hd] of Object.entries(hours)) {
            if (!existing[hourStr]) existing[hourStr] = { total: 0, keywords: {} };
            existing[hourStr].total = (existing[hourStr].total || 0) + hd.total;
            if (!existing[hourStr].keywords) existing[hourStr].keywords = {};
            for (const [kw, cnt] of Object.entries(hd.keywords)) {
                existing[hourStr].keywords[kw] = (existing[hourStr].keywords[kw] || 0) + cnt;
            }
        }
        await fireSet('/imi_watch_stats/' + dateStr, existing);
    }

    // 오래된 항목 삭제
    for (const key of toDelete) {
        await fireSet('/imi_watch_alerts/' + key, null);
    }
}

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
        subKeyword: r.subKeyword || '',
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
    // 기존에 20분 알람이 남아있을 수 있으므로 항상 지우고 1분으로 재생성
    chrome.alarms.clear('imi_tid_watch', () => { chrome.alarms.create('imi_tid_watch', { periodInMinutes: 1 }); });
}
chrome.runtime.onInstalled.addListener(ensureAlarms);
chrome.runtime.onStartup.addListener(ensureAlarms);
ensureAlarms(); // 서비스워커 재시작 시에도 보장
// 재시작 시 즉시 비거래 배너 상태 동기화 (알람 대기 없이 바로 반영)
setTimeout(() => { checkWatchedTids(); }, 3000);
chrome.alarms.onAlarm.addListener(async alarm => {
    if (alarm.name === 'imi_watchdog') {
        if (await isActive()) await startAll();
    }
    if (alarm.name === 'imi_rule_sync') {
        await checkBotCmd(); // 웹 제어 채널 확인 (최대 1분 지연)
        await syncRulesFromFirebase();
        // 글로벌 오늘만 설정 변경 시 실행 중인 봇 탭에 실시간 전달
        const gto = await fireGet('/global_today_only');
        const newGtoVal = !!gto;
        if (_cachedGlobalTodayOnly !== null && _cachedGlobalTodayOnly !== newGtoVal) {
            const curTabMap = await getTabMap();
            for (const tabId of Object.values(curTabMap)) {
                try { chrome.tabs.sendMessage(tabId, { type: 'UPDATE_GLOBAL_TODAY_ONLY', val: newGtoVal }); } catch(e) {}
            }
        }
        _cachedGlobalTodayOnly = newGtoVal;
        // 차단 목록도 Firebase 기준으로 덮어씀 (차단 해제 반영)
        const remoteBlocked = await fireGetBlocked();
        if (remoteBlocked !== null) {
            await store.set('imi_blocked', remoteBlocked);
        }
        await _flushFraudStats();
        await syncStatus();
    }
    if (alarm.name === 'imi_cleanup') { await maybeCleanupBlocked(); await cleanupWatchAlerts(); }
    if (alarm.name === 'imi_tid_watch') { await checkWatchedTids(); }
    if (alarm.name === 'imi_rule_sync') await syncTidWatchInterval();
});

// 서비스워커 시작 시 밀린 명령 처리 + 현재 상태 즉시 Firebase 반영
checkBotCmd().catch(() => {});
syncStatus().catch(() => {});
// imi_watch_banner에서 wsr_ 접두사 항목 삭제 (배너는 거래번호 감시 전용)
fireGet('/imi_watch_banner').then(data => {
    if (!data || typeof data !== 'object') return;
    for (const k of Object.keys(data)) {
        if (k.startsWith('wsr_')) fireSet('/imi_watch_banner/' + k, null).catch(() => {});
    }
}).catch(() => {});

// --- Message handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'DEBUG_LOG') {
        console.log('[BOT]', msg.text);
        sendResponse({ ok: true });
        return true;
    }
    if (msg.type === 'GET_WATCH_HOURS') {
        fireGet('/imi_watch_hours').then(wh => sendResponse(wh || null));
        return true;
    }
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
                } else {
                    const fraudPopupOn = await store.get('imi_notif_popup');
                    if (fraudPopupOn === true) showFraudPopup(msg.data);
                    showOsNotif('fraud', msg.data);
                }
                // logItemRows가 null이면 재감지 → history 기록 스킵 (중복 로그 방지)
                const logRows = msg.data.logItemRows;
                if (Array.isArray(logRows) && logRows.length > 0) {
                    const ruleType = msg.data.ruleType || 'fraud';
                    const detectedAt = msg.data.at || Date.now();
                    await firePush('/monitor_history', {
                        ruleName: msg.data.ruleName || '',
                        ruleKeyword: msg.data.ruleKeyword || '',
                        ruleType,
                        itemCount: logRows.length,
                        itemRows: logRows,
                        at: detectedAt
                    });
                    if (ruleType === 'fraud') _recordFraudStat(detectedAt, logRows);
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
    if (msg.type === 'FOCUS_MAIN_WINDOW') {
        chrome.tabs.query({}, function(tabs) {
            var t = tabs.find(function(t) {
                return t.title && t.title.includes('IMI PRO') && t.url && !t.url.startsWith('chrome-extension://');
            });
            if (t) {
                chrome.tabs.update(t.id, { active: true }, function() {
                    chrome.windows.update(t.windowId, { focused: true });
                });
            }
        });
        sendResponse({ ok: true });
    }
});

// ── 팝업 스택 관리 ──
// 새 팝업이 뜰 때 기존 팝업들을 위로 밀고 새 것은 아래에 배치
const POPUP_W = 460, POPUP_H = 320, POPUP_GAP = 8, POPUP_MARGIN_BOTTOM = 70;

let _fraudWinIds = [];
let _watchWinIds = [];

function _registerPopupClose(winId, arr) {
    const handler = (id) => {
        if (id !== winId) return;
        const idx = arr.indexOf(winId);
        if (idx !== -1) arr.splice(idx, 1);
        chrome.windows.onRemoved.removeListener(handler);
    };
    chrome.windows.onRemoved.addListener(handler);
}

async function _stackPopup(url, storageKey, data, arr, alignRight) {
    await chrome.storage.local.set({ [storageKey]: data });
    const sw = screen.width, sh = screen.height;
    const baseTop  = sh - POPUP_H - POPUP_MARGIN_BOTTOM;
    const baseLeft = alignRight ? (sw - POPUP_W - 20) : 20;

    // 기존 창들 위로 밀기
    const shift = POPUP_H + POPUP_GAP;
    await Promise.all(arr.map(wid =>
        chrome.windows.get(wid).then(w =>
            chrome.windows.update(wid, { top: Math.max(0, (w.top || baseTop) - shift) })
        ).catch(() => {})
    ));

    // 새 창을 맨 아래에 열기
    const win = await chrome.windows.create({
        url: chrome.runtime.getURL(url),
        type: 'popup',
        width: POPUP_W,
        height: POPUP_H,
        top:  baseTop,
        left: baseLeft
    }).catch(() => null);

    if (win) {
        arr.push(win.id);
        _registerPopupClose(win.id, arr);
    }
}

// 윈도우 OS 토스트 알림 (chrome.notifications)
function showOsNotif(type, data) {
    const id = 'imi_' + type;
    chrome.notifications.clear(id, function() {
        chrome.notifications.create(id, {
            type: 'basic',
            iconUrl: 'icon48.png',
            title: 'IMI PRO — 물품 감지!',
            message: (data.ruleName || '') + ' | ' + (data.itemCount || 0) + '개 물품 감지됨'
        });
    });
}

chrome.notifications.onClicked.addListener(function(notifId) {
    chrome.tabs.query({}, function(tabs) {
        var t = tabs.find(function(tab) {
            return tab.title && tab.title.includes('IMI PRO') && tab.url && !tab.url.startsWith('chrome-extension://');
        });
        if (t) {
            chrome.tabs.update(t.id, { active: true }, function() {
                chrome.windows.update(t.windowId, { focused: true });
            });
        }
    });
    chrome.notifications.clear(notifId);
});

// 사기글 감지 팝업 (우측 하단, 빨간 테마) — popup 토글 ON일 때
async function showFraudPopup(data) {
    await _stackPopup('alert_popup.html', 'imi_alert_popup_data', data, _fraudWinIds, true);
}

// 비거래 감지 팝업 (좌측 하단, 초록 테마)
let _lastWatchAt = 0;

async function showWatchPopup(data) {
    const watchPopupOn = await store.get('imi_notif_watchPopup');

    const now = Date.now();
    if (now - _lastWatchAt < 5000) return;
    _lastWatchAt = now;

    if (watchPopupOn === true) {
        // 팝업창 모드: 좌측 하단 스택 쌓기
        await _stackPopup('watch_popup.html', 'imi_watch_popup_data', data, _watchWinIds, false);
        return;
    }

    // 드롭다운 모드: Firebase 경유 → 상단 watchDropPanel
    try {
        const itemRows = (data.itemRows || []);
        const tids = itemRows.map(r => r.tid || '').filter(Boolean);
        await firePush('/imi_watch_alerts', {
            tids:     tids,
            itemRows: itemRows.map(r => ({ tid: r.tid||'', t: r.t||'', key: r.key||'' })),
            label:    data.label   || data.ruleName || '',
            keyword:  data.keyword || data.ruleKeyword || '',
            count:    data.itemCount || data.count || 0,
            at:       now,
            seen:     false
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

    // watched_tids에 없는 고아 배너 항목 정리
    const banners = await fireGet('/imi_watch_banner');
    if (banners && typeof banners === 'object') {
        for (const bKey of Object.keys(banners)) {
            if (!tids || !tids[bKey]) {
                await fireSet('/imi_watch_banner/' + bKey, null);
            }
        }
    }

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
                // 숨김 확인 → 배너 비활성화, alertSent 초기화 (다음 노출 시 재알림) — PATCH 1회로 묶음
                await fireUpdate('/imi_watch_banner/' + key, { active: false });
                if (item.alertSent) await fireUpdate('/watched_tids/' + key, { alertSent: false });
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

            // 최초 감지 시 alertSent 처리 (배너로만 표시, 로그 기록 없음)
            if (!item.alertSent) {
                await fireUpdate('/watched_tids/' + key, { alertSent: true, detectedAt: now });
            }
        } catch(e) {}
    }
}

