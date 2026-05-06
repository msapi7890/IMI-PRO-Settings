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
const getBlocked = () => store.get('imi_blocked').then(v => v || []);

// 서비스워커 시작 시 Firebase 차단목록 → 로컬 병합 + 상태 동기화
(async () => {
    const remote = await fireGet('/imi_blocked');
    if (remote && Array.isArray(remote) && remote.length) {
        const local = await getBlocked();
        const merged = [...new Set([...local, ...remote])];
        await store.set('imi_blocked', merged);
    }
    // 시작 시 Firebase에 현재 실제 상태 반영 (삭제 후 재설치 시 구 데이터 덮어쓰기)
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
    const tabMap = await getTabMap();
    for (const tabId of Object.values(tabMap)) {
        try { await chrome.tabs.remove(tabId); } catch(e) {}
    }
    await saveTabMap({});
    await syncStatus();
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

// 알람: 주기적으로 탭 생존 확인
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create('imi_watchdog', { periodInMinutes: 3 });
});
chrome.alarms.onAlarm.addListener(async alarm => {
    if (alarm.name === 'imi_watchdog' && await isActive()) await startAll();
});

// --- Message handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'FIREBASE_SET') {
        fireSet(msg.path, msg.data).then(() => {
            // 물품 감지 알림 → 커스텀 팝업 창
            if (msg.path === '/monitor_flash_state' && msg.data && msg.data.active) {
                showAlertPopup(msg.data);
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
            const rules    = await getRules();
            const ruleId   = Object.entries(tabMap).find(([, tid]) => tid === sender.tab.id)?.[0];
            const rule     = ruleId ? (rules.find(r => r.id === ruleId) || null) : null;
            sendResponse({ rule });
        });
        return true;
    }
    if (msg.type === 'BLOCK_ITEM') {
        getBlocked().then(async list => {
            if (!list.includes(msg.key)) {
                list.push(msg.key);
                await store.set('imi_blocked', list);
                await fireSet('/imi_blocked', list);  // 전체 실무자 공유
            }
            sendResponse({ ok: true });
        });
        return true;
    }
    if (msg.type === 'GET_BLOCKED') {
        getBlocked().then(list => sendResponse({ blocked: list }));
        return true;
    }
    if (msg.type === 'DEBUG_LOG') {
        console.log('[IMI BOT]', msg.text);
        sendResponse({ ok: true });
        return true;
    }
    if (msg.type === 'OPEN_ITEM_IN_TAB') {
        (async () => {
            // 30초 쿨다운 (루프 방지)
            const now = Date.now();
            const lastOpen = await store.get('imi_last_open') || 0;
            if (now - lastOpen < 30000) { sendResponse({ ok: false }); return; }
            await store.set('imi_last_open', now);
            const [tabMap, rules] = await Promise.all([getTabMap(), getRules()]);
            let tabId = tabMap[msg.ruleId];
            const rule = rules.find(r => r.id === msg.ruleId);
            const url  = 'https://www.itemmania.com/sell/application.html?tid=' + msg.tid;

            // tabMap에 없으면 열려있는 아이템매니아 탭 직접 검색
            if (!tabId) {
                const imitabs = await chrome.tabs.query({ url: '*://*.itemmania.com/*' });
                const found = imitabs.find(t => t.url && !t.url.includes('application.html'));
                if (found) tabId = found.id;
            }
            console.log('[OPEN_ITEM] ruleId:', msg.ruleId, '| tabId:', tabId);

            if (tabId) {
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId },
                        world: 'MAIN',
                        func: (u) => { location.href = u; },
                        args: [url]
                    });
                    console.log('[OPEN_ITEM] executeScript OK');
                    await chrome.tabs.update(tabId, { active: true });
                    // 봇이 활성 상태일 때만 새 모니터링 탭 생성
                    if (rule && await isActive()) {
                        const newTab = await chrome.tabs.create({ url: rule.url, active: false });
                        const newMap = await getTabMap();
                        newMap[rule.id] = newTab.id;
                        await saveTabMap(newMap);
                        await syncStatus();
                    }
                } catch(e) {
                    console.log('[OPEN_ITEM] executeScript 실패:', e.message);
                    chrome.tabs.create({ url });
                }
            } else {
                console.log('[OPEN_ITEM] itemmania 탭 없음 → 새 탭 fallback');
                chrome.tabs.create({ url });
            }
            sendResponse({ ok: !!tabId });
        })();
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
    if (msg.type === 'START_ALL')   { startAll().then(() => sendResponse({ ok: true })); return true; }
    if (msg.type === 'STOP_ALL')    { stopAll().then(() => sendResponse({ ok: true })); return true; }
    if (msg.type === 'SYNC_STATUS') { syncStatus(); sendResponse({ ok: true }); }
});

// 커스텀 팝업 창 (IMI PRO 스타일)
let _alertWinId = null;
let _lastAlertAt = 0;

async function showAlertPopup(data) {
    const now = Date.now();
    // 5초 이내 중복 방지
    if (now - _lastAlertAt < 5000) return;
    _lastAlertAt = now;

    await store.set('imi_alert_popup_data', data);

    // 기존 팝업 닫기
    if (_alertWinId) {
        try { await chrome.windows.remove(_alertWinId); } catch(e) {}
        _alertWinId = null;
    }

    const win = await chrome.windows.create({
        url: chrome.runtime.getURL('alert_popup.html'),
        type: 'popup',
        width: 388,
        height: 290,
        focused: true
    });
    _alertWinId = win.id;

    // 창 닫히면 ID 초기화
    chrome.windows.onRemoved.addListener(function onClose(wid) {
        if (wid === _alertWinId) { _alertWinId = null; chrome.windows.onRemoved.removeListener(onClose); }
    });
}
