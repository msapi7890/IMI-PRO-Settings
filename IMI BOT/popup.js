const DB_URL = 'https://manual-9a47c-default-rtdb.firebaseio.com';

function getRules()        { return new Promise(r => chrome.storage.local.get('imi_rules',        d => r(d.imi_rules        || []))); }
function saveRules(v)      { return new Promise(r => chrome.storage.local.set({ imi_rules: v }, r)); }
function getTabMap()       { return new Promise(r => chrome.storage.local.get('imi_tab_map',       d => r(d.imi_tab_map       || {}))); }
function isActive()        { return new Promise(r => chrome.storage.local.get('imi_active',        d => r(!!d.imi_active))); }
function getGlobalHours()  { return new Promise(r => chrome.storage.local.get('imi_global_hours',  d => r(d.imi_global_hours  || null))); }
function saveGlobalHours(v){ return new Promise(r => chrome.storage.local.set({ imi_global_hours: v }, r)); }

// Firebase 규칙 동기화
async function fireGetRules() {
    try {
        const res = await fetch(DB_URL + '/imi_rules.json?_t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) { const d = await res.json(); return Array.isArray(d) ? d : null; }
    } catch(e) {}
    return null;
}
async function fireSaveRules(rules) {
    try {
        await fetch(DB_URL + '/imi_rules.json', {
            method: 'PUT', body: JSON.stringify(rules),
            headers: { 'Content-Type': 'application/json' }
        });
    } catch(e) {}
}

function sendBg(msg) {
    return new Promise(r => {
        try {
            chrome.runtime.sendMessage(msg, res => {
                if (chrome.runtime.lastError) { r(null); } else { r(res || null); }
            });
        } catch(e) { r(null); }
    });
}

let currentTabMap = {};
let currentActive = false;
let editingRuleId = null;
let _initialSynced = false;

// ── 전체 시간대 UI ──
async function initGlobalHoursUI() {
    const gh = await getGlobalHours();
    const chk  = document.getElementById('globalHoursEnabled');
    const wrap  = document.getElementById('globalHoursInputs');
    const from  = document.getElementById('globalFrom');
    const to    = document.getElementById('globalTo');
    const stat  = document.getElementById('globalHoursStatus');
    if (!chk) return;
    const enabled = !!(gh && gh.enabled);
    chk.checked = enabled;
    wrap.style.display = enabled ? 'flex' : 'none';
    if (gh && gh.from) from.value = gh.from;
    if (gh && gh.to)   to.value   = gh.to;
    if (enabled && gh && gh.from && gh.to) {
        stat.style.display = '';
        stat.textContent = '⏰ 전체 시간: ' + gh.from + ' ~ ' + gh.to;
    } else { stat.style.display = 'none'; }
}

async function refresh() {
    // 첫 로드 시 Firebase에서 최신 규칙 pull
    if (!_initialSynced) {
        _initialSynced = true;
        const remote = await fireGetRules();
        if (remote && remote.length) {
            const local = await getRules();
            // Firebase 우선, 로컬에만 있는 규칙(미동기화)은 병합
            const remoteIds = new Set(remote.map(r => r.id));
            const onlyLocal = local.filter(r => !remoteIds.has(r.id));
            const merged = [...remote, ...onlyLocal];
            await saveRules(merged);
            if (onlyLocal.length) await fireSaveRules(merged);
        }
    }
    const [rules, tabMap, active] = await Promise.all([getRules(), getTabMap(), isActive()]);
    currentTabMap = tabMap;
    currentActive = active;
    renderStatus(rules, tabMap, active);
    renderRules(rules, tabMap);
    initGlobalHoursUI();
}

function renderStatus(rules, tabMap, active) {
    const enabledCount = rules.filter(r => r.enabled).length;
    const openCount    = Object.keys(tabMap).length;
    document.getElementById('statusDot').className = active ? 'active' : '';
    document.getElementById('statusText').textContent = active
        ? `감시 중 — ${enabledCount}개 규칙 / ${openCount}개 탭`
        : (rules.length ? '중지됨 — 시작 버튼을 누르세요' : '규칙을 먼저 추가하세요');
    const btn = document.getElementById('toggleBtn');
    btn.textContent = active ? '⏸ 전체 중지' : '▶ 전체 시작';
    btn.className   = active ? 'stop' : '';
}

function renderRules(rules, tabMap) {
    const list = document.getElementById('ruleList');
    if (!rules.length) {
        list.innerHTML = '<div class="empty-msg">등록된 규칙이 없습니다</div>';
        return;
    }
    list.innerHTML = rules.map(r => {
        const isOpen = tabMap[r.id] !== undefined;
        return `
        <div class="rule-card ${r.enabled ? 'active-rule' : ''}">
            <div class="rule-top">
                <input class="rule-toggle" type="checkbox" data-id="${esc(r.id)}" ${r.enabled ? 'checked' : ''}>
                <div class="rule-name">${esc(r.name)}</div>
                ${isOpen ? '<span style="font-size:10px;color:#22c55e;font-weight:900;flex-shrink:0;">● 감시중</span>' : ''}
                <button class="rule-edit" data-id="${esc(r.id)}">수정</button>
                <button class="rule-del"  data-id="${esc(r.id)}">삭제</button>
            </div>
            <div class="rule-tags">
                ${r.keyword        ? `<span class="tag">🔑 ${esc(r.keyword)}</span>` : ''}
                ${r.minPrice       ? `<span class="tag">💰 ${Number(r.minPrice).toLocaleString()}원↑</span>` : ''}
                ${r.maxPrice       ? `<span class="tag">💰 ${Number(r.maxPrice).toLocaleString()}원↓</span>` : ''}
                <span class="tag">⏱ ${r.scanInterval || 5}초</span>
                ${r.excludeKeyword ? `<span class="tag">🚫 ${esc(r.excludeKeyword)}</span>` : ''}
                ${(r.activeFrom && r.activeTo) ? `<span class="tag">⏰ ${esc(r.activeFrom)}~${esc(r.activeTo)}</span>` : ''}
            </div>
            <div class="rule-url">${esc(r.url)}</div>
        </div>`;
    }).join('');
}

// 수정 버튼 클릭 → 폼에 기존 값 채움
async function startEdit(id) {
    const rules = await getRules();
    const r = rules.find(r => r.id === id);
    if (!r) return;
    editingRuleId = id;
    document.getElementById('inName').value     = r.name || '';
    document.getElementById('inUrl').value      = r.url  || '';
    document.getElementById('inKw').value       = r.keyword || '';
    document.getElementById('inMin').value      = r.minPrice || '';
    document.getElementById('inMax').value      = r.maxPrice || '';
    document.getElementById('inInterval').value = r.scanInterval || 5;
    document.getElementById('inExclude').value  = r.excludeKeyword || '';
    document.getElementById('inFrom').value     = r.activeFrom || '';
    document.getElementById('inTo').value       = r.activeTo   || '';
    document.getElementById('addBtn').textContent = '✏️ 수정 완료';
    document.getElementById('addBtn').style.background = '#f59e0b';
    document.querySelector('.add-form-title').textContent = '✏️ 규칙 수정 중';
    document.getElementById('inName').focus();
    document.getElementById('inName').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
    editingRuleId = null;
    ['inName','inUrl','inKw','inMin','inMax','inInterval','inExclude','inFrom','inTo'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('addBtn').textContent = '✅ 규칙 등록';
    document.getElementById('addBtn').style.background = '';
    document.querySelector('.add-form-title').textContent = '➕ 새 규칙 추가';
}

async function toggleAll() {
    const btn = document.getElementById('toggleBtn');
    btn.disabled = true;
    if (currentActive) {
        await sendBg({ type: 'STOP_ALL' });
    } else {
        const rules = await getRules();
        if (!rules.some(r => r.enabled)) {
            alert('활성화된 규칙이 없습니다.\n체크박스로 원하는 규칙을 켜주세요.');
            btn.disabled = false;
            return;
        }
        await sendBg({ type: 'START_ALL' });
    }
    setTimeout(async () => { await refresh(); btn.disabled = false; }, 1000);
}

async function toggleRule(id, enabled) {
    const rules = (await getRules()).map(r => r.id === id ? { ...r, enabled } : r);
    await saveRules(rules);
    fireSaveRules(rules);
    await refresh();
    await sendBg({ type: enabled ? 'START_RULE' : 'STOP_RULE', ruleId: id });
}

async function deleteRule(id) {
    if (!confirm('이 규칙을 삭제하시겠습니까?')) return;
    const rules = (await getRules()).filter(r => r.id !== id);
    await saveRules(rules);
    fireSaveRules(rules);
    if (editingRuleId === id) cancelEdit();
    await refresh();
}

async function addRule() {
    const name         = document.getElementById('inName').value.trim();
    const url          = document.getElementById('inUrl').value.trim();
    const keyword      = document.getElementById('inKw').value.trim();
    const minPrice     = parseInt(document.getElementById('inMin').value) || 0;
    const maxPrice     = parseInt(document.getElementById('inMax').value) || 0;
    const scanInterval = parseInt(document.getElementById('inInterval').value) || 5;
    const excludeKeyword = document.getElementById('inExclude').value.trim();
    const activeFrom   = document.getElementById('inFrom').value || '';
    const activeTo     = document.getElementById('inTo').value   || '';

    if (!name)                             return alert('규칙 이름을 입력하세요.');
    if (!url || !/^https?:\/\//.test(url)) return alert('올바른 URL을 입력하세요. (https://...)');
    if (!keyword && !minPrice)             return alert('키워드 또는 최소가격 중 하나는 필요합니다.');

    if (editingRuleId) {
        // 기존 규칙 수정
        const rules = (await getRules()).map(r =>
            r.id === editingRuleId
                ? { ...r, name, url, keyword, minPrice, maxPrice, scanInterval, excludeKeyword, activeFrom, activeTo }
                : r
        );
        await saveRules(rules);
        fireSaveRules(rules);
        cancelEdit();
        await refresh();
        sendBg({ type: 'SYNC_STATUS' });
        alert('✅ 규칙이 수정됐습니다: ' + name);
    } else {
        // 새 규칙 등록
        const newRule = {
            id: 'r_' + Date.now(),
            name, url, keyword, minPrice, maxPrice, scanInterval, excludeKeyword, activeFrom, activeTo,
            enabled: true, createdAt: Date.now()
        };
        const rules = [...(await getRules()), newRule];
        await saveRules(rules);
        fireSaveRules(rules);
        ['inName','inUrl','inKw','inMin','inMax','inInterval','inExclude','inFrom','inTo'].forEach(id => document.getElementById(id).value = '');
        await refresh();
        sendBg({ type: 'SYNC_STATUS' });
        alert('✅ 규칙이 등록됐습니다: ' + name);
    }
}

function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// 이벤트 위임
document.getElementById('ruleList').addEventListener('change', e => {
    const cb = e.target.closest('.rule-toggle');
    if (cb) toggleRule(cb.dataset.id, cb.checked);
});
document.getElementById('ruleList').addEventListener('click', e => {
    if (e.target.closest('.rule-del'))  deleteRule(e.target.closest('.rule-del').dataset.id);
    if (e.target.closest('.rule-edit')) startEdit(e.target.closest('.rule-edit').dataset.id);
});

document.getElementById('toggleBtn').addEventListener('click', toggleAll);
document.getElementById('addBtn').addEventListener('click', addRule);

// ── 전체 시간대 이벤트 ──
document.getElementById('globalHoursEnabled').addEventListener('change', async function() {
    const wrap = document.getElementById('globalHoursInputs');
    const stat = document.getElementById('globalHoursStatus');
    wrap.style.display = this.checked ? 'flex' : 'none';
    if (!this.checked) {
        await saveGlobalHours({ enabled: false, from: '', to: '' });
        stat.style.display = 'none';
        sendBg({ type: 'SYNC_STATUS' });
    }
});
document.getElementById('saveGlobalHoursBtn').addEventListener('click', async function() {
    const from = document.getElementById('globalFrom').value;
    const to   = document.getElementById('globalTo').value;
    if (!from || !to) { alert('시작 시간과 종료 시간을 모두 입력해주세요.'); return; }
    await saveGlobalHours({ enabled: true, from, to });
    const stat = document.getElementById('globalHoursStatus');
    stat.style.display = '';
    stat.textContent = '⏰ 전체 시간: ' + from + ' ~ ' + to;
    sendBg({ type: 'SYNC_STATUS' });
    alert('✅ 저장됐습니다. ' + from + ' ~ ' + to + ' 에만 작동합니다.');
});

refresh();
setInterval(refresh, 2500);
