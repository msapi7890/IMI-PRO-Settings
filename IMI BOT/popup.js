function isActive()        { return new Promise(r => chrome.storage.local.get('imi_active',       d => r(!!d.imi_active))); }
function getGlobalHours()  { return new Promise(r => chrome.storage.local.get('imi_global_hours', d => r(d.imi_global_hours || null))); }
function saveGlobalHours(v){ return new Promise(r => chrome.storage.local.set({ imi_global_hours: v }, r)); }
function getTabMap()       { return new Promise(r => chrome.storage.local.get('imi_tab_map',      d => r(d.imi_tab_map || {}))); }

function sendBg(msg) {
    return new Promise(r => {
        try { chrome.runtime.sendMessage(msg, res => { if (chrome.runtime.lastError) r(null); else r(res || null); }); }
        catch(e) { r(null); }
    });
}

let currentActive = false;

async function refresh() {
    const [active, tabMap] = await Promise.all([isActive(), getTabMap()]);
    currentActive = active;
    const openCount = Object.keys(tabMap).length;
    document.getElementById('statusDot').className = active ? 'active' : '';
    document.getElementById('statusText').textContent = active
        ? '감시 중 — ' + openCount + '개 탭 열림'
        : '중지됨 — 시작 버튼을 누르세요';
    const btn = document.getElementById('toggleBtn');
    btn.textContent = active ? '⏸ 전체 중지' : '▶ 전체 시작';
    btn.className   = active ? 'stop' : '';
    initGlobalHoursUI();
}

async function initGlobalHoursUI() {
    const gh   = await getGlobalHours();
    const chk  = document.getElementById('globalHoursEnabled');
    const wrap = document.getElementById('globalHoursInputs');
    const stat = document.getElementById('globalHoursStatus');
    const enabled = !!(gh && gh.enabled);
    chk.checked = enabled;
    wrap.style.display = enabled ? 'flex' : 'none';
    if (gh && gh.from) document.getElementById('globalFrom').value = gh.from;
    if (gh && gh.to)   document.getElementById('globalTo').value   = gh.to;
    if (enabled && gh && gh.from && gh.to) {
        stat.style.display = '';
        stat.textContent = '⏰ ' + gh.from + ' ~ ' + gh.to;
    } else { stat.style.display = 'none'; }
}

async function toggleAll() {
    const btn = document.getElementById('toggleBtn');
    btn.disabled = true;
    await sendBg(currentActive ? { type: 'STOP_ALL' } : { type: 'START_ALL' });
    setTimeout(async () => { await refresh(); btn.disabled = false; }, 1000);
}

document.getElementById('toggleBtn').addEventListener('click', toggleAll);

document.getElementById('globalHoursEnabled').addEventListener('change', async function() {
    document.getElementById('globalHoursInputs').style.display = this.checked ? 'flex' : 'none';
    if (!this.checked) {
        await saveGlobalHours({ enabled: false, from: '', to: '' });
        document.getElementById('globalHoursStatus').style.display = 'none';
        sendBg({ type: 'SYNC_STATUS' });
    }
});

document.getElementById('saveGlobalHoursBtn').addEventListener('click', async function() {
    const from = document.getElementById('globalFrom').value;
    const to   = document.getElementById('globalTo').value;
    if (!from || !to) { alert('시작·종료 시간을 모두 입력해주세요.'); return; }
    await saveGlobalHours({ enabled: true, from, to });
    const stat = document.getElementById('globalHoursStatus');
    stat.style.display = '';
    stat.textContent = '⏰ ' + from + ' ~ ' + to;
    sendBg({ type: 'SYNC_STATUS' });
    alert('✅ 저장됐습니다. ' + from + ' ~ ' + to + ' 에만 작동합니다.');
});

refresh();
setInterval(refresh, 2500);
