// ===== IMI BOT 상태 대시보드 =====
var _botStatus = null;
var _botBridgeConnected = false;

// 확장프로그램 브릿지 연결 감지
window.addEventListener('message', function(e) {
    if (!e.data) return;
    if (e.data.__imiBotConnected) {
        var wasConnected = _botBridgeConnected;
        _botBridgeConnected = true;
        _updateBotToggleBtn();
        // 처음 연결 시 확장프로그램에 즉시 상태 동기화 요청
        if (!wasConnected) _sendToBot({ type: 'SYNC_STATUS' });
    }
});

function _sendToBot(msg) {
    window.postMessage(Object.assign({ __imiBot: true }, msg), '*');
}

function _isBotPrivileged(){
    return typeof _currentUser !== 'undefined' && _currentUser &&
           (_currentUser.role === 'admin' || _currentUser.role === 'subadmin');
}

var _botTogglePending = false;
var _botToggleExpected = null; // 'start' | 'stop'

function toggleBotFromWeb() {
    if(!_isBotPrivileged()){ alert('관리자 또는 부관리자만 봇을 제어할 수 있습니다.'); return; }
    var btn = document.getElementById('monBotToggleBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ 전송 중...';
        btn.style.background = '#334155';
        btn.style.color = '#94a3b8';
    }
    _botTogglePending = true;
    if (_botStatus && _botStatus.active) {
        _botToggleExpected = 'stop';
        db.ref('bot_cmd').set({ cmd: 'stop', ts: Date.now() });
        if (_botBridgeConnected) _sendToBot({ type: 'STOP_ALL' });
    } else {
        var rules = (_botStatus && _botStatus.rules) || [];
        var checkedIds = rules
            .filter(function(r) {
                var chk = document.getElementById('ruleChk_' + r.id);
                return chk && chk.checked;
            })
            .map(function(r) { return r.id; });
        if (!checkedIds.length) {
            alert('실행할 규칙을 하나 이상 체크해주세요.');
            _botTogglePending = false;
            if (btn) { btn.disabled = false; _updateBotToggleBtn(); }
            return;
        }
        _botToggleExpected = 'start';
        db.ref('bot_cmd').set({ cmd: 'start', ruleIds: checkedIds, ts: Date.now() });
        if (_botBridgeConnected) _sendToBot({ type: 'START_SELECTED', ruleIds: checkedIds });
    }
    // 30초 후에도 Firebase 응답 없으면 버튼 복구
    setTimeout(function() {
        if (_botTogglePending) { _botTogglePending = false; _updateBotToggleBtn(); }
    }, 30000);
}

function _updateBotToggleBtn() {
    var btn = document.getElementById('monBotToggleBtn');
    if (!btn) return;

    if (!_isBotPrivileged()) {
        btn.style.display = 'none';
        return;
    }
    btn.style.display = '';

    var active = _botStatus && _botStatus.active;

    // 기대 상태로 실제로 바뀐 경우에만 pending 해제
    if (_botTogglePending) {
        var expectedActive = _botToggleExpected === 'start';
        if (active !== expectedActive) return; // 아직 안 바뀜 — 전송 중 유지
        _botTogglePending = false;
        _botToggleExpected = null;
    }
    if (active) {
        btn.textContent = '⏸ 봇 중지';
        btn.style.background = '#ef4444';
        btn.style.color = '#fff';
    } else {
        btn.textContent = '▶ 봇 시작';
        btn.style.background = '#22c55e';
        btn.style.color = '#fff';
    }
    btn.disabled = false;
}

// Firebase에서 봇 상태 실시간 구독
db.ref('bot_status').on('value', function(snap) {
    _botStatus = snap.val();
    _renderBotStatus();
    _updateHdrDot();
    _updateBotToggleBtn();
});

function _renderBotStatus() {
    var s = _botStatus;
    var dot     = document.getElementById('monitorDot');
    var text    = document.getElementById('monitorStatusText');
    var badge   = document.getElementById('monBotBadge');
    var lastUpd = document.getElementById('monLastUpdate');
    var ruleList= document.getElementById('monitorRuleList');

    if (!dot) return;

    if (!s) {
        dot.classList.remove('active');
        if (text) text.textContent = 'IMI BOT 미연결 — 확장프로그램을 실행하세요';
        if (badge) { badge.textContent = '오프라인'; badge.style.background = '#374151'; badge.style.color = '#6b7280'; }
        if (ruleList) ruleList.innerHTML = '<div style="text-align:center;padding:18px 0;opacity:0.35;font-size:12px;">봇 연결 없음</div>';
        return;
    }

    var isActive = s.active;
    var isStale = s.lastUpdate && (Date.now() - s.lastUpdate) > 5 * 60 * 1000; // 5분 이상 갱신 없음
    dot.classList.toggle('active', isActive && !isStale);

    if (text) {
        if (isStale) {
            text.textContent = '⚠ 연결 끊김 — 확장프로그램이 응답하지 않습니다';
        } else {
            text.textContent = isActive
                ? '감시 중 — ' + (s.activeCount || 0) + '개 규칙 실행 중'
                : '봇 중지됨 — ' + (s.totalCount || 0) + '개 규칙 등록됨';
        }
    }
    if (badge) {
        if (isStale) {
            badge.textContent  = '⚠ 연결 끊김';
            badge.style.background = '#78350f';
            badge.style.color      = '#fbbf24';
        } else {
            badge.textContent  = isActive ? '● 감시 중' : '■ 중지됨';
            badge.style.background = isActive ? '#166534' : '#374151';
            badge.style.color      = isActive ? '#4ade80'  : '#9ca3af';
        }
    }
    if (lastUpd && s.lastUpdate) {
        var mins = Math.floor((Date.now() - s.lastUpdate) / 60000);
        var timeStr = new Date(s.lastUpdate).toLocaleTimeString('ko-KR');
        lastUpd.textContent = isStale
            ? '마지막 동기화: ' + timeStr + ' (' + mins + '분 전)'
            : '마지막 동기화: ' + timeStr;
    }

    if (!ruleList) return;
    var rules = s.rules || [];
    if (!rules.length) {
        ruleList.innerHTML = '<div style="text-align:center;padding:18px 0;opacity:0.35;font-size:12px;font-style:italic;">등록된 규칙이 없습니다</div>';
        return;
    }
    var canCtrl = _isBotPrivileged();
    ruleList.innerHTML = rules.map(function(r) {
        var runColor = (r.enabled && r.tabOpen) ? '#22c55e' : (r.enabled ? '#f59e0b' : '#94a3b8');
        var runLabel = (r.enabled && r.tabOpen) ? '● 감시중' : (r.enabled ? '○ 대기' : '■ 비활성');
        var chkId = 'ruleChk_' + r.id;
        var chkDisabled = canCtrl ? '' : 'disabled';
        return '<div style="border:1.5px solid var(--border-ui);border-radius:10px;padding:10px 13px;margin-bottom:6px;background:var(--bg-body);">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
            + '<label style="display:flex;align-items:center;gap:6px;cursor:'+(canCtrl?'pointer':'default')+';flex:1;min-width:0;">'
            + '<input type="checkbox" id="' + chkId + '" ' + (r.enabled ? 'checked' : '') + ' ' + chkDisabled + ' style="width:15px;height:15px;cursor:'+(canCtrl?'pointer':'default')+';accent-color:var(--active-focus-color);">'
            + '<span style="font-size:12px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(r.name) + '</span>'
            + '</label>'
            + '<span style="font-size:10px;font-weight:900;color:' + runColor + ';flex-shrink:0;">' + runLabel + '</span>'
            + '</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;">'
            + (r.keyword      ? '<span class="mon-tag">🔑 ' + _esc(r.keyword) + '</span>' : '')
            + (r.minPrice     ? '<span class="mon-tag">💰 ' + Number(r.minPrice).toLocaleString() + '원↑</span>' : '')
            + '<span class="mon-tag">⏱ ' + (r.scanInterval || 5) + '초</span>'
            + '</div>'
            + '</div>';
    }).join('');
}


function openMonitorModal() {
    _renderBotStatus();
    document.getElementById('monitorModal').classList.remove('hidden');
    // 브릿지 재확인 (모달 열 때 연결 상태 갱신)
    window.postMessage({ __imiBotPing: true }, '*');
}
function closeMonitorModal() { document.getElementById('monitorModal').classList.add('hidden'); }

function renderMonitorRules() {
    var list = document.getElementById('monitorRuleList');
    var entries = Object.entries(monitorRules);
    if (!entries.length) {
        list.innerHTML = '<div style="text-align:center;padding:18px 0;opacity:0.35;font-size:12px;font-style:italic;">등록된 감시 규칙이 없습니다</div>';
        return;
    }
    list.innerHTML = entries.map(function(e) {
        var id = e[0], r = e[1];
        return '<div class="mon-rule">'
            + '<div style="display:flex;align-items:center;gap:7px;margin-bottom:6px;">'
            + '<div style="flex:1;font-size:13px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(r.name)+'</div>'
            + '<label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:11px;font-weight:900;white-space:nowrap;flex-shrink:0;">'
            + '<input type="checkbox" onchange="toggleMonitorRule(\''+id+'\',this.checked)" '+(r.enabled?'checked':'')+'>'
            + '<span style="color:'+(r.enabled?'#22c55e':'#94a3b8')+'">'+(r.enabled?'활성':'비활성')+'</span></label>'
            + '<button id="montest_'+id+'" onclick="testMonitorRule(\''+id+'\')" style="font-size:11px;padding:2px 8px;border-radius:6px;border:1.5px solid var(--active-focus-color);color:var(--active-focus-color);background:none;cursor:pointer;font-weight:900;white-space:nowrap;transition:0.15s;flex-shrink:0;">🔍 테스트</button>'
            + '<button onclick="deleteMonitorRule(\''+id+'\')" style="font-size:11px;padding:2px 8px;border-radius:6px;border:1.5px solid #ef4444;color:#ef4444;background:none;cursor:pointer;font-weight:900;white-space:nowrap;transition:0.15s;flex-shrink:0;" onmouseover="this.style.background=\'#ef4444\';this.style.color=\'#fff\'" onmouseout="this.style.background=\'none\';this.style.color=\'#ef4444\'">삭제</button>'
            + '</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:5px;">'
            + (r.gameLabel ? '<span class="mon-tag">🎮 '+_esc(r.gameLabel)+'</span>' : '')
            + (r.keyword ? '<span class="mon-tag">🔑 '+_esc(r.keyword)+'</span>' : '')
            + (r.minPrice ? '<span class="mon-tag">💰 '+Number(r.minPrice).toLocaleString()+'원↑</span>' : '')
            + '<span class="mon-tag">📄 '+(r.maxPages||3)+'페이지</span>'
            + '</div>'
            + '<div style="font-size:9.5px;opacity:0.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(r.url||'')+'</div>'
            + '</div>';
    }).join('');
}

function _esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function _fmtTid(tid) {
    return String(tid||'').replace(/(.{4})(?=.)/g, '$1 ');
}

// 다중 CORS 프록시 자동 전환
async function _fetchViaProxy(url, postBody) {
    if (window.__tmConnected) return await tmFetch(url);

    // 1. 물리적(다이렉트) 접속 시도 (크롬 CORS 확장프로그램 켜져 있을 때 탬퍼몽키 없이 즉시 작동)
    try {
        var dirController = new AbortController();
        var dirTimer = setTimeout(function(){ dirController.abort(); }, 8000);
        var fetchOpts = { signal: dirController.signal, cache: 'no-store' };
        
        if (postBody) {
            fetchOpts.method = 'POST';
            fetchOpts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
            fetchOpts.body = postBody;
        }

        var dirRes;
        try { dirRes = await fetch(url, fetchOpts); }
        finally { clearTimeout(dirTimer); }
        if (dirRes && dirRes.ok) {
            var buffer = await dirRes.arrayBuffer();
            var decoder = new TextDecoder('euc-kr'); // 아이템매니아 한글 깨짐 방지
            var dirHtml = decoder.decode(buffer);
            if (dirHtml && dirHtml.length > 200) return dirHtml;
        } else if (dirRes) {
            throw new Error('서버 요청 실패 (상태코드: ' + dirRes.status + '). URL 또는 파라미터를 확인하세요.');
        }
    } catch(e) {
        if (postBody) {
            throw new Error('검색(POST) 요청이 실패했습니다. CORS 확장 프로그램이 켜져 있는지, 네트워크 연결이 정상인지 확인해주세요. (' + e.message + ')');
        }
        console.warn('[MON] 다이렉트 통신 차단됨, 무료 프록시로 우회합니다.');
    }

    var proxies = [
        { build: function(u){ return 'https://api.allorigins.win/get?disableCache=true&url='+encodeURIComponent(u); }, parse: function(r){ return r.json().then(function(d){ return d.contents||''; }); } },
        { build: function(u){ return 'https://corsproxy.io/?'+encodeURIComponent(u); }, parse: function(r){ return r.text(); } },
        { build: function(u){ return 'https://api.codetabs.com/v1/proxy?quest='+encodeURIComponent(u); }, parse: function(r){ return r.text(); } }
    ];
    for (var pi=0; pi<proxies.length; pi++) {
        var proxy = proxies[pi];
        try {
            var controller = new AbortController();
            var timer = setTimeout(function(){ controller.abort(); }, 12000);
            var res;
            try { res = await fetch(proxy.build(url), { signal: controller.signal }); }
            finally { clearTimeout(timer); }
            if (!res || !res.ok) continue;
            var html = await proxy.parse(res);
            if (html && html.length > 200) return html;
        } catch(e) { console.warn('[MON] proxy '+pi+' fail:', e.message); }
    }
    throw new Error('모든 프록시 실패 — 네트워크 또는 URL 확인 필요');
}

// EUC-KR 한글 인코딩 테이블 로드 및 변환 (아이템매니아 검색용)
window.eucKrTable = null;
async function getEucKrTable() {
    if (window.eucKrTable) return window.eucKrTable;
    try {
        var res = await fetch('https://encoding.spec.whatwg.org/index-euc-kr.txt');
        var text = await res.text();
        window.eucKrTable = {};
        var lines = text.split('\n');
        for (var i=0; i<lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.charAt(0) === '#') continue;
            var parts = line.split(/\s+/);
            if (parts.length >= 2) window.eucKrTable[parseInt(parts[1], 16)] = parseInt(parts[0], 10);
        }
    } catch(e) { console.warn('EUC-KR table fetch error:', e); }
    return window.eucKrTable;
}

async function encodeEucKrUrl(str) {
    var table = await getEucKrTable();
    if (!table) return encodeURIComponent(str);
    var res = '';
    for (var i=0; i<str.length; i++) {
        var code = str.charCodeAt(i);
        if (code <= 0x7F) res += encodeURIComponent(str.charAt(i));
        else if (table[code] !== undefined) res += '%' + (Math.floor(table[code] / 190) + 0x81).toString(16).toUpperCase() + '%' + ((table[code] % 190) + 0x41).toString(16).toUpperCase();
        else res += encodeURIComponent(str.charAt(i));
    }
    return res;
}

// 페이지 번호 URL 생성 및 HTML 가져오기 (있는 그대로 POST 전송)
async function _fetchPageHtml(baseUrl, page, keyword) {
    if (keyword) {
        var postUrl = baseUrl.split('?')[0];

        var qs = baseUrl.split('?')[1] || '';
        var pairs = qs.split('&');
        var postParts = [];
        for (var i = 0; i < pairs.length; i++) {
            if (!pairs[i]) continue;
            var key = pairs[i].split('=')[0];
            if (key !== 'page' && key !== 'search_word' && key !== 'searchWord') {
                postParts.push(pairs[i]);
            }
        }

        var mainKw = keyword.split(',')[0].trim();
        var encodedKw = await encodeEucKrUrl(mainKw);
        postParts.push('search_word=' + encodedKw);
        postParts.push('searchWord=' + encodedKw);

        if (page > 1) {
            postParts.push('page=' + page);
        }

        return await _fetchViaProxy(postUrl, postParts.join('&'));
    } else {
        var u = baseUrl;
        if (page > 1) {
            if (/[?&]page=\d+/.test(u)) u = u.replace(/([?&]page=)\d+/, '$1' + page);
            else u += (u.includes('?') ? '&' : '?') + 'page=' + page;
        }
        u += (u.includes('?') ? '&' : '?') + '_t=' + Date.now();
        return await _fetchViaProxy(u, null);
    }
}

async function testMonitorRule(id) {
    var rule = monitorRules[id];
    if (!rule) return;
    var btn = document.getElementById('montest_'+id);
    if (btn) { btn.textContent = '⏳...'; btn.disabled = true; }
    try {
        var maxPages = rule.maxPages || 3;
        var allItems = [], filteredItems = [], usedProxy = '';
        for (var page=1; page<=maxPages; page++) {
            var html = await _fetchPageHtml(rule.url, page, rule.keyword);
            var pageAll = _parseItemmaniaHtml(html, '', 0, rule.url||'');
            var pageFilt = _parseItemmaniaHtml(html, rule.keyword||'', rule.minPrice||0, rule.url||'');
            allItems = allItems.concat(pageAll);
            filteredItems = filteredItems.concat(pageFilt);
            if (pageAll.length === 0 && page > 1) break;
            if (page < maxPages) await new Promise(function(r){ setTimeout(r,800); });
        }
        var msg = '🔍 테스트 결과 — '+rule.name+'\n─────────────────────\n📄 확인한 페이지: '+maxPages+'페이지\n📄 전체 파싱된 물품: '+allItems.length+'개\n✅ 조건 일치 물품: '+filteredItems.length+'개\n\n';
        if (allItems.length === 0) {
            msg += '⚠️ 물품을 하나도 파싱하지 못했습니다.\n→ HTML 구조 파싱 실패 가능성.\n→ URL이 목록 페이지가 맞는지 확인하세요.';
        } else if (filteredItems.length === 0) {
            msg += '⚠️ 조건에 맞는 물품 없음\n';
            if (rule.keyword) msg += '→ 키워드 "'+rule.keyword+'" 없음\n';
            if (rule.minPrice) msg += '→ 최소가격 '+Number(rule.minPrice).toLocaleString()+'원 미충족\n';
            msg += '\n[ 파싱된 물품 예시 ]\n';
            allItems.slice(0,3).forEach(function(it,i){ msg += (i+1)+'. '+it.title+(it.price?' ('+it.price.toLocaleString()+'원)':'')+'\n'; });
        } else {
            msg += '[ 감지된 물품 ]\n';
            filteredItems.slice(0,5).forEach(function(it,i){ msg += (i+1)+'. '+it.title+(it.price?' ('+it.price.toLocaleString()+'원)':'')+'\n'; });
        }
        alert(msg);
    } catch(e) {
        alert('❌ '+e.message);
    } finally {
        if (btn) { btn.textContent = '🔍 테스트'; btn.disabled = false; }
    }
}

function toggleMonitorRule(id, enabled) { db.ref('monitor_rules/'+id+'/enabled').set(enabled); }
function deleteMonitorRule(id) {
    if (!confirm('이 감시 규칙을 삭제하시겠습니까?')) return;
    var pw = prompt('관리자 비밀번호:');
    if (pw !== ADMIN_PW) { if (pw) alert('❌ 비밀번호 오류'); return; }
    db.ref('monitor_rules/'+id).remove();
}

function addMonitorRule() {
    var name = (document.getElementById('mrName').value||'').trim();
    var url = (document.getElementById('mrUrl').value||'').trim();
    var keyword = (document.getElementById('mrKeyword').value||'').trim();
    var minPriceRaw = (document.getElementById('mrMinPrice').value||'').trim();
    var gameLabel = (document.getElementById('mrGame').value||'').trim();
    if (!name) { alert('규칙 이름을 입력하세요.'); return; }
    if (!url || !/^https?:\/\//.test(url)) { alert('올바른 URL을 입력하세요. (https://...)'); return; }
    if (!keyword && !minPriceRaw) { alert('키워드 또는 최소가격 중 하나는 입력해야 합니다.'); return; }
    var pw = prompt('관리자 비밀번호:');
    if (pw !== ADMIN_PW) { if (pw) alert('❌ 비밀번호 오류'); return; }
    var minPrice = minPriceRaw ? (parseInt(minPriceRaw.replace(/[^0-9]/g,''))||0) : 0;
    var maxPages = parseInt(document.getElementById('mrMaxPages').value)||3;
    db.ref('monitor_rules').push({ name:name, url:url, keyword:keyword, minPrice:minPrice, gameLabel:gameLabel, maxPages:maxPages, enabled:true, createdAt:Date.now() });
    ['mrName','mrUrl','mrKeyword','mrMinPrice','mrGame'].forEach(function(i){ document.getElementById(i).value=''; });
    document.getElementById('mrMaxPages').value='3';
    alert('✅ 감시 규칙이 등록되었습니다!');
}

function toggleMonitoring() { if (_monIsActive) stopMonitoringEngine(); else startMonitoringEngine(); }

window.__tmConnected = false;
window.__tmResolvers = {};
var _tmPingTimer = setInterval(function() {
    if (window.__tmConnected) clearInterval(_tmPingTimer);
    else window.postMessage({ type: 'TM_PING' }, '*');
}, 1000);

window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'TM_CONNECTED') {
        window.__tmConnected = true;
        var badge = document.getElementById('tmStatusBadge');
        if (badge) { badge.innerHTML = '✅ 우회 스크립트 연결됨'; badge.style.background = '#22c55e'; }
    }
    if (e.data && e.data.type === 'TM_FETCH_SUCCESS') {
        if (window.__tmResolvers[e.data.reqId]) {
            window.__tmResolvers[e.data.reqId].resolve(e.data.responseText);
            delete window.__tmResolvers[e.data.reqId];
        }
    }
    if (e.data && e.data.type === 'TM_FETCH_ERROR') {
        if (window.__tmResolvers[e.data.reqId]) {
            window.__tmResolvers[e.data.reqId].reject(new Error(e.data.error));
            delete window.__tmResolvers[e.data.reqId];
        }
    }
});
function tmFetch(url) {
    return new Promise(function(resolve, reject) {
        var reqId = 'req_' + Date.now() + '_' + Math.random();
        window.__tmResolvers[reqId] = { resolve: resolve, reject: reject };
        window.postMessage({ type: 'TM_FETCH_REQUEST', reqId: reqId, url: url }, '*');
    });
}

function startMonitoringEngine() {
    if (_monIntervalId) return;
    _monIsActive = true;
    _doMonitorCheck();
    _monIntervalId = setInterval(_doMonitorCheck, _monIntervalMin * 60000);
    updateMonitorStatusDisplay();
    _updateHdrDot();
}

function stopMonitoringEngine() {
    clearInterval(_monIntervalId); _monIntervalId = null; _monIsActive = false;
    updateMonitorStatusDisplay(); _updateHdrDot();
}

function setMonitorInterval(min) {
    _monIntervalMin = min; localStorage.setItem('mon_interval', min);
    if (_monIsActive) { stopMonitoringEngine(); startMonitoringEngine(); }
}

function updateMonitorStatusDisplay() {
    var dot = document.getElementById('monitorDot');
    var txt = document.getElementById('monitorStatusText');
    var btn = document.getElementById('monitorToggleBtn');
    if (!dot||!txt||!btn) return;
    if (_monIsActive) {
        dot.classList.add('active');
        var lc = localStorage.getItem('mon_last_check');
        txt.textContent = lc ? '마지막 체크: '+new Date(+lc).toLocaleTimeString('ko-KR') : '모니터링 중...';
        btn.textContent = '⏸ 중지'; btn.style.background = '#ef4444';
    } else {
        dot.classList.remove('active');
        txt.textContent = '모니터링 중지됨';
        btn.textContent = '▶ 시작'; btn.style.background = '#22c55e';
    }
}

function _updateHdrDot() {
    var dot = document.getElementById('hdrMonDot');
    if (!dot) return;
    var isActive = _botStatus && _botStatus.active;
    if (isActive) dot.classList.add('active'); else dot.classList.remove('active');
}

async function _doMonitorCheck() {
    var active = Object.entries(monitorRules).filter(function(e){ return e[1].enabled; });
    if (!active.length) return;
    localStorage.setItem('mon_last_check', Date.now().toString());
    if (!document.getElementById('monitorModal').classList.contains('hidden')) updateMonitorStatusDisplay();
    for (var i=0; i<active.length; i++) {
        try { await _checkOneRule(active[i][0], active[i][1]); }
        catch(e) { console.warn('[MON] Rule error:', active[i][1].name, e); }
        if (i < active.length-1) await new Promise(function(r){ setTimeout(r,2000); });
    }
}

async function _checkOneRule(id, rule) {
    var maxPages = rule.maxPages || 3;
    var allItems = [];
    for (var page=1; page<=maxPages; page++) {
        try {
            var html = await _fetchPageHtml(rule.url, page, rule.keyword);
            var pageItems = _parseItemmaniaHtml(html, rule.keyword||'', rule.minPrice||0, rule.url||'');
            allItems = allItems.concat(pageItems);
            var pageAll = _parseItemmaniaHtml(html, '', 0, rule.url||'');
            if (pageAll.length === 0 && page > 1) break;
        } catch(e) { console.warn('[MON] page'+page+' error:', e.message); break; }
        if (page < maxPages) await new Promise(function(r){ setTimeout(r,1000); });
    }
    if (!allItems.length) return;
    _triggerMonitorAlert(id, rule, allItems);
}

function _parseItemmaniaHtml(html, keyword, minPrice, baseUrl) {
    var origin = '';
    if (baseUrl) { try { origin = new URL(baseUrl).origin; } catch(e) {} }
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    var matched = [];
    var seen = {};

    // 링크, HTML 구조 전부 무시하고 텍스트 블록 자체를 스캔하는 무적 로직
    var rows = doc.querySelectorAll('li, tr, .item_row, .item_wrap');
    for (var i=0; i<rows.length; i++) {
        var el = rows[i];
        // 하위 요소에 또 li나 tr이 있다면 중복 방지를 위해 패스
        if (el.tagName === 'LI' && el.querySelector('li')) continue;
        if (el.tagName === 'TR' && el.querySelector('tr')) continue;

        var text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (text.length < 15) continue;
        if (text.includes('물품제목') && text.includes('등록일시')) continue;

        var m = text.match(/(\d{1,3}(,\d{3})+)/g) || text.match(/(\d{5,})/g);
        if (!m) continue;
        var nums = m.map(function(s){ return parseInt(s.replace(/,/g,'')); }).filter(function(n){ return n >= 1000; });
        if (!nums.length) continue;
        var price = Math.max.apply(null, nums);

        var _kws = keyword ? keyword.split(',').map(function(k){return k.trim();}).filter(Boolean) : [];
        if (_kws.length > 0 && !_kws.some(function(k){ return text.indexOf(k)>=0; })) continue;
        if (minPrice > 0 && price < minPrice) continue;

        var key = price + "_" + text.substring(0, 15);
        if (seen[key]) continue;
        seen[key] = true;

        var titleEl = el.querySelector('.item_title, .title, .col_title, td:nth-child(2)');
        var title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim().replace(/\n/g, ' ') : text.substring(0, 40) + '...';

        var anchors = el.tagName === 'A' ? [el] : Array.from(el.querySelectorAll('a'));
        var appA = anchors.find(function(a){ var h=a.getAttribute('href')||''; return h.indexOf('application')>=0; });
        var anyA = anchors.find(function(a){ var h=a.getAttribute('href')||''; return h && h!=='#' && h.indexOf('javascript')<0; });
        var rawHref = (appA || anyA) ? ((appA||anyA).getAttribute('href')||'') : '';
        var itemUrl = rawHref.startsWith('http') ? rawHref : (rawHref.startsWith('/') && origin ? origin + rawHref : '');

        matched.push({ title:title, price:price, url:itemUrl });
        if (matched.length >= 20) break;
    }
    return matched;
}

function _extractPrice(text) {
    var m = text.match(/(\d{1,3}(,\d{3})+)/g);
    if (!m) m = text.match(/(\d{4,})/g);
    if (!m) return 0;
    var nums = m.map(function(s){ return parseInt(s.replace(/[^0-9]/g,'')); }).filter(function(n){ return n >= 100; });
    return nums.length ? Math.max.apply(null,nums) : 0;
}

function _triggerMonitorAlert(id, rule, items) {
    var lines = items.slice(0,5).map(function(it,i){
        return (i+1)+'. '+it.title+(it.price?' ('+it.price.toLocaleString()+'원)':'');
    });
    var content = '🚨 [자동감지] '+rule.name+'\n'
        +(rule.gameLabel?'게임: '+rule.gameLabel+'\n':'')
        +(rule.keyword?'키워드: "'+rule.keyword+'"\n':'')
        +(rule.minPrice?'최소가격: '+Number(rule.minPrice).toLocaleString()+'원 이상\n':'')
        +'감지된 물품: '+items.length+'개\n\n'
        +lines.join('\n')
        +'\n\n🔗 '+rule.url;
    var _at = Date.now();
    db.ref('monitor_flash_state').set({
        active: true,
        ruleName: rule.name,
        ruleKeyword: rule.keyword || '',
        itemCount: items.length,
        itemRows: items.map(function(it){ return {t:it.title, p:it.price||0, u:it.url||''}; }),
        at: _at
    });
    db.ref('/monitor_history').push({
        ruleName: rule.name,
        ruleKeyword: rule.keyword || '',
        itemCount: items.length,
        itemRows: items.map(function(it){ return {t:it.title, p:it.price||0, u:it.url||''}; }),
        at: _at
    });
}

function closeMonitorFlash() { db.ref('monitor_flash_state/active').set(false); }

function _getNotifPrefs(){
    try{ return Object.assign({flash:true,popup:true,sound:false},JSON.parse(localStorage.getItem('imi_notif_prefs')||'{}')); }catch(e){ return {flash:true,popup:true,sound:false}; }
}
function _playAlertBeep(){
    try{
        var ctx=new (window.AudioContext||window.webkitAudioContext)();
        [0,0.22,0.44].forEach(function(d){
            var o=ctx.createOscillator(), g=ctx.createGain();
            o.connect(g); g.connect(ctx.destination);
            o.type='sine'; o.frequency.value=880;
            g.gain.setValueAtTime(0.35,ctx.currentTime+d);
            g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+d+0.18);
            o.start(ctx.currentTime+d); o.stop(ctx.currentTime+d+0.2);
        });
    }catch(e){}
}
function _showMonitorFlash(s) {
    var _np=_getNotifPrefs();
    document.getElementById('monitorAlertTitle').textContent = '🚨 '+(s.ruleName||'모니터링 경고');
    document.getElementById('monitorAlertCount').textContent = (s.itemCount||0)+'개 물품 감지됨';
    document.getElementById('monitorAlertItems').innerHTML = (s.itemRows||[]).map(function(it){
        var k = _esc(it.key || (it.t||'').substring(0,30).trim());
        return '<div style="padding:6px 0;border-bottom:1px solid var(--border-ui);">'
            +(it.tid?'<div style="font-size:20px;font-weight:900;color:#38bdf8;margin-bottom:2px;letter-spacing:0.03em;">#'+_fmtTid(it.tid)+'</div>':'')
            +'<div style="display:flex;align-items:center;gap:6px;">'
            +'<div style="font-size:12px;font-weight:800;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(it.t||'')+'</div>'
            +(it.p?'<div style="color:#ef4444;font-weight:900;font-size:12px;flex-shrink:0;">'+Number(it.p).toLocaleString()+'원</div>':'')
            +'</div>'
            +'<button data-bk="'+k+'" data-title="'+_esc(it.t||'')+'" data-tid="'+_esc(it.tid||'')+'" style="margin-top:4px;font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;cursor:pointer;">필터제외</button>'
            +'</div>';
    }).join('');
    document.getElementById('monitorAlertFlash').classList.remove('hidden');

    if (_np.flash) {
        document.getElementById('chatSection').classList.add('monitor-border-flash');
        _triggerFullscreenFlash();
    }

    // 탭 제목 깜빡임
    _startTabBlink(s.ruleName, s.itemCount);

    // 경고음
    if (_np.sound) _playAlertBeep();

    // OS 브라우저 알림 (다른 창 열어도 뜨는 알림)
    if ('Notification' in window) {
        var _fireNotif = function() {
            new Notification('🚨 ' + (s.ruleName || 'IMI PRO') + ' 감지됨', {
                body: (s.itemCount||0) + '개 감지' + (s.ruleKeyword ? ' · 키워드: ' + s.ruleKeyword : '') + '\nIMI PRO 확인 바랍니다',
                icon: 'https://msapi7890.github.io/IMI-PRO/favicon.ico'
            });
        };
        if (Notification.permission === 'granted') {
            _fireNotif();
        } else if (Notification.permission === 'default') {
            Notification.requestPermission().then(function(perm) {
                if (perm === 'granted') _fireNotif();
            });
        }
    }

    if (window._monFlashTimer) clearTimeout(window._monFlashTimer);
    window._monFlashTimer = setTimeout(closeMonitorFlash, 30000);
}

function _triggerFullscreenFlash() {
    var overlay = document.getElementById('monFullscreenOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'monFullscreenOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9600;pointer-events:none;background:rgba(239,68,68,0);transition:none;';
        document.body.appendChild(overlay);
    }
    var count = 0;
    if (window._overlayFlashInterval) clearInterval(window._overlayFlashInterval);
    window._overlayFlashInterval = setInterval(function() {
        count++;
        overlay.style.background = count % 2 === 1
            ? 'rgba(239,68,68,0.35)'
            : 'rgba(239,68,68,0)';
        if (count >= 8) {
            clearInterval(window._overlayFlashInterval);
            window._overlayFlashInterval = null;
            overlay.style.background = 'rgba(239,68,68,0)';
        }
    }, 250);
}

function _startTabBlink(ruleName, itemCount) {
    if (window._tabBlinkInterval) return;
    var origTitle = document.title;
    var alertTitle = '🚨 [' + (itemCount||0) + '개 감지] ' + (ruleName||'모니터링 경고');
    var toggle = false;
    window._tabBlinkOrigTitle = origTitle;
    window._tabBlinkInterval = setInterval(function() {
        toggle = !toggle;
        document.title = toggle ? alertTitle : origTitle;
    }, 700);
}

function _stopTabBlink() {
    if (window._tabBlinkInterval) {
        clearInterval(window._tabBlinkInterval);
        window._tabBlinkInterval = null;
    }
    if (window._tabBlinkOrigTitle) {
        document.title = window._tabBlinkOrigTitle;
        window._tabBlinkOrigTitle = null;
    }
}

function _hideMonitorFlashLocal() {
    document.getElementById('monitorAlertFlash').classList.add('hidden');
    document.getElementById('chatSection').classList.remove('monitor-border-flash');
    if (window._monFlashTimer) { clearTimeout(window._monFlashTimer); window._monFlashTimer = null; }
    if (window._overlayFlashInterval) { clearInterval(window._overlayFlashInterval); window._overlayFlashInterval = null; }
    var overlay = document.getElementById('monFullscreenOverlay');
    if (overlay) overlay.style.background = 'rgba(239,68,68,0)';
    _stopTabBlink();
}

db.ref('monitor_flash_state').on('value', function(snap) {
    var s = snap.val();
    if (!s) return;
    // at이 90초 이내인 최신 감지만 표시 — 페이지 로드 시 오래된 active 상태 재표시 방지
    if (s.active && s.at && (Date.now() - s.at) < 90000) {
        _showMonitorFlash(s);
        // 로그 패널이 열려있고 감지 로그 탭이 활성이면 자동 갱신
        var panel = document.getElementById('logPanel');
        var tab1  = document.getElementById('logTab1');
        if (panel && !panel.classList.contains('hidden') && tab1 && tab1.classList.contains('mon-tab-active')) {
            setTimeout(loadMonitorLog, 1500);
        }
    } else if (!s.active) _hideMonitorFlashLocal();
});

// 필터제외 버튼 — 이벤트 위임 (monitorAlertFlash 내)
document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-bk]');
    if (!btn || !document.getElementById('monitorAlertItems').contains(btn)) return;
    var key   = btn.getAttribute('data-bk');
    var title = btn.getAttribute('data-title') || '';
    var tid   = btn.getAttribute('data-tid') || '';
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var keys = list.map(function(i) { return typeof i === 'object' ? i.key : i; });
        if (!keys.includes(key)) {
            var addedBy = (typeof _currentUser !== 'undefined' && _currentUser && _currentUser.name) ? _currentUser.name : '';
            list.push({ key: key, title: title, tid: tid, addedBy: addedBy, addedAt: Date.now() });
            db.ref('/imi_blocked').set(list);
        }
        btn.disabled = true;
        btn.textContent = '제외됨';
        btn.style.opacity = '0.4';
    });
});

// 필터제외 버튼 — 이벤트 위임 (log-box 안 #monitorLogList에 직접 위임, stopPropagation 우회)
document.getElementById('monitorLogList').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-logbk]');
    if (!btn || btn.disabled) return;
    var key   = btn.getAttribute('data-logbk');
    var title = btn.getAttribute('data-logtitle') || '';
    var tid   = btn.getAttribute('data-logtid') || '';
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var keys = list.map(function(i) { return typeof i === 'object' ? i.key : i; });
        if (!keys.includes(key)) {
            var addedBy = (typeof _currentUser !== 'undefined' && _currentUser && _currentUser.name) ? _currentUser.name : '';
            list.push({ key: key, title: title, tid: tid, addedBy: addedBy, addedAt: Date.now() });
            db.ref('/imi_blocked').set(list);
        }
        btn.disabled = true;
        btn.textContent = '제외됨';
        btn.style.opacity = '0.4';
        btn.style.cursor = 'default';
    });
});

// ===== 로그 패널 =====
var _logFullMode = false;

function openLogPanel() {
    document.getElementById('logPanel').classList.remove('hidden');
    _logFullMode = false;
    var btnWrap = document.getElementById('logFullDayBtnWrap');
    if (btnWrap) {
        btnWrap.style.display = _isBotPrivileged() ? '' : 'none';
        var btn = document.getElementById('logFullDayBtn');
        if (btn) { btn.textContent = '📅 24시간 전체 기록 불러오기'; btn.disabled = false; btn.onclick = loadFullDayLog; }
    }
    switchLogTab(1);
}
function closeLogPanel() {
    document.getElementById('logPanel').classList.add('hidden');
}
function switchLogTab(n) {
    document.getElementById('logTab1').classList.toggle('mon-tab-active', n === 1);
    document.getElementById('logTab2').classList.toggle('mon-tab-active', n === 2);
    document.getElementById('logTabContent1').style.display = n === 1 ? '' : 'none';
    document.getElementById('logTabContent2').style.display = n === 2 ? '' : 'none';
    if (n === 1) loadMonitorLog(_logFullMode);
    if (n === 2) loadBlockedItems();
}

function loadFullDayLog() {
    _logFullMode = true;
    var btn = document.getElementById('logFullDayBtn');
    if (btn) { btn.textContent = '⏳ 불러오는 중...'; btn.disabled = true; btn.style.opacity = '0.55'; }
    loadMonitorLog(true);
}
function loadRecentLog() {
    _logFullMode = false;
    var btn = document.getElementById('logFullDayBtn');
    if (btn) { btn.textContent = '📅 전체 기록 불러오기'; btn.disabled = false; btn.style.opacity = '1'; btn.onclick = loadFullDayLog; }
    loadMonitorLog(false);
}

function loadMonitorLog(fullDay) {
    var cutoff = fullDay ? Date.now() - 86400000 : Date.now() - 7200000; // 전체: 24시간 / 기본: 2시간
    var histRef = fullDay
        ? db.ref('/monitor_history').limitToLast(2000)
        : db.ref('/monitor_history').limitToLast(500);
    db.ref('/imi_blocked').once('value', function(blockedSnap) {
        var blockedList = blockedSnap.val() || [];
        if (!Array.isArray(blockedList)) blockedList = [];
        var blockedSet = {};
        blockedList.forEach(function(item) {
            var k = typeof item === 'object' ? (item.key || '') : item;
            if (k) blockedSet[k] = true;
        });

        histRef.once('value', function(snap) {
            var val = snap.val() || {};
            var entries = [];
            Object.keys(val).forEach(function(k) {
                var e = val[k];
                if (!e) return;
                if (e.at < cutoff) return; // 시간 필터 (기본: 2시간 / 전체: 24시간)
                entries.push({ key: k, data: e });
            });
            entries.sort(function(a, b) { return b.data.at - a.data.at; });

            var empty = document.getElementById('monitorLogEmpty');
            var list  = document.getElementById('monitorLogList');
            if (!entries.length) {
                if (empty) empty.style.display = '';
                if (list)  list.innerHTML = '';
                var emptyBtn = document.getElementById('logFullDayBtn');
                if (emptyBtn && _isBotPrivileged()) {
                    emptyBtn.disabled = false; emptyBtn.style.opacity = '1';
                    emptyBtn.textContent = fullDay ? '↩ 최근 100건 보기' : '📅 24시간 전체 기록 불러오기';
                    emptyBtn.onclick = fullDay ? loadRecentLog : loadFullDayLog;
                }
                return;
            }
            if (empty) empty.style.display = 'none';

            // 시간대별 그룹화
            var hourGroups = {};
            var hourOrder = [];
            entries.forEach(function(entry) {
                var dt = new Date(entry.data.at);
                var hKey = dt.getFullYear() + '-'
                    + String(dt.getMonth() + 1).padStart(2, '0') + '-'
                    + String(dt.getDate()).padStart(2, '0') + ' '
                    + String(dt.getHours()).padStart(2, '0');
                if (!hourGroups[hKey]) { hourGroups[hKey] = []; hourOrder.push(hKey); }
                hourGroups[hKey].push(entry);
            });

            function _renderEntry(entry) {
                var d = entry.data;
                var timeStr = new Date(d.at).toLocaleTimeString('ko-KR');
                var rows = (d.itemRows || []).map(function(it) {
                    var rawKey = it.key || (it.t || '').substring(0, 30).trim();
                    var bk = _esc(rawKey);
                    var isBlocked = blockedSet[rawKey];
                    var titleAttr = _esc(it.t || '');
                    var tidAttr = _esc(it.tid || '');
                    var listTime = it.listTime || '';
                    var btnHtml = bk
                        ? (isBlocked
                            ? '<button data-logbk="' + bk + '" data-logtitle="' + titleAttr + '" data-logtid="' + tidAttr + '" disabled style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;flex-shrink:0;opacity:0.4;cursor:default;">제외됨</button>'
                            : '<button data-logbk="' + bk + '" data-logtitle="' + titleAttr + '" data-logtid="' + tidAttr + '" style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;cursor:pointer;flex-shrink:0;">필터제외</button>')
                        : '';
                    return '<div style="display:flex;flex-direction:column;gap:2px;padding:7px 10px;background:var(--bg-body);border-radius:7px;border:1px solid var(--border-ui);">'
                        + (it.tid ? '<div style="display:flex;align-items:center;gap:6px;font-size:20px;font-weight:900;color:#38bdf8;letter-spacing:0.03em;">#' + _fmtTid(it.tid)
                            + (listTime ? '<span style="font-size:10px;font-weight:500;color:#64748b;">· ' + listTime + '</span>' : '')
                            + '</div>' : '')
                        + '<div style="display:flex;align-items:center;gap:6px;">'
                        + '<div style="font-size:11px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(it.t || '') + '</div>'
                        + (it.p ? '<div style="font-size:11px;font-weight:900;color:#ef4444;flex-shrink:0;">' + Number(it.p).toLocaleString() + '원</div>' : '')
                        + btnHtml
                        + '</div>'
                        + '</div>';
                }).join('');
                return '<div style="border:1.5px solid var(--border-ui);border-radius:11px;padding:11px 14px;margin-bottom:8px;">'
                    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">'
                    + '<div style="font-size:12px;font-weight:900;color:var(--active-focus-color);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(d.ruleName || '') + '</div>'
                    + '<div style="font-size:10px;font-weight:700;opacity:0.45;flex-shrink:0;">' + timeStr + '</div>'
                    + '<div style="font-size:10px;font-weight:900;color:#ef4444;flex-shrink:0;">' + (d.itemCount || 0) + '개 감지</div>'
                    + '</div>'
                    + (d.ruleKeyword ? '<div style="font-size:10px;color:#64748b;margin-bottom:7px;">🔑 ' + _esc(d.ruleKeyword) + '</div>' : '')
                    + '<div style="display:flex;flex-direction:column;gap:5px;">' + rows + '</div>'
                    + '</div>';
            }

            var html = '';
            hourOrder.forEach(function(hKey, idx) {
                var groupEntries = hourGroups[hKey];
                var parts = hKey.split(' ');
                var label = parts[0] + ' ' + parseInt(parts[1]) + '시';
                var totalItems = groupEntries.reduce(function(s, e){ return s + (e.data.itemCount || 0); }, 0);
                html += '<details ' + (idx === 0 ? 'open' : '') + ' style="border:2px solid var(--border-ui);border-radius:12px;margin-bottom:8px;overflow:hidden;">'
                    + '<summary style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;font-weight:900;font-size:12px;background:var(--bg-body);user-select:none;list-style:none;">'
                    + '<span style="flex:1;">🕐 ' + label + '</span>'
                    + '<span style="font-size:11px;font-weight:700;color:#ef4444;">' + groupEntries.length + '회 감지 · 총 ' + totalItems + '개</span>'
                    + '</summary>'
                    + '<div style="padding:10px 10px 2px;">'
                    + groupEntries.map(_renderEntry).join('')
                    + '</div>'
                    + '</details>';
            });

            if (list) list.innerHTML = html;

            // 버튼 상태 복원
            var btn = document.getElementById('logFullDayBtn');
            if (btn && _isBotPrivileged()) {
                btn.disabled = false;
                btn.style.opacity = '1';
                if (fullDay) {
                    btn.textContent = '↩ 최근 100건 보기';
                    btn.onclick = loadRecentLog;
                } else {
                    btn.textContent = '📅 24시간 전체 기록 불러오기';
                    btn.onclick = loadFullDayLog;
                }
            }
        });
    });
}

// ===== 차단 목록 로드 =====
function loadBlockedItems() {
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var container = document.getElementById('blockedItemList');
        var empty     = document.getElementById('blockedEmpty');
        if (!list.length) {
            container.innerHTML = '';
            empty.style.display = '';
            return;
        }
        empty.style.display = 'none';
        container.innerHTML = list.map(function(item, i) {
            var key     = typeof item === 'object' ? (item.key   || '') : item;
            var title   = typeof item === 'object' ? (item.title || '') : '';
            var tid     = typeof item === 'object' ? (item.tid   || '') : '';
            var addedBy = typeof item === 'object' ? (item.addedBy || '') : '';
            var addedAt = typeof item === 'object' && item.addedAt ? new Date(item.addedAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
            var subText = tid ? ('#' + tid) : key; // 거래번호 있으면 우선 표시
            return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1.5px solid var(--border-ui);border-radius:8px;margin-bottom:6px;">'
                + '<div style="flex:1;min-width:0;">'
                + (title ? '<div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(title) + '</div>' : '')
                + '<div style="font-size:10px;opacity:0.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(subText) + '</div>'
                + (addedBy ? '<div style="font-size:10px;opacity:0.45;margin-top:2px;">✍️ ' + _esc(addedBy) + (addedAt ? ' · ' + addedAt : '') + '</div>' : '')
                + '</div>'
                + '<button onclick="unblockItem(' + i + ')" style="font-size:10px;padding:3px 10px;border-radius:5px;border:1px solid #22c55e;color:#22c55e;background:none;cursor:pointer;font-weight:700;flex-shrink:0;">제외 해제</button>'
                + '</div>';
        }).join('');
    });
}

// ===== 개별 차단 해제 =====
function unblockItem(idx) {
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        list.splice(idx, 1);
        db.ref('/imi_blocked').set(list, function() {
            loadBlockedItems();
            loadMonitorLog();
        });
    });
}

// ===== 전체 차단 해제 =====
function clearAllBlocked() {
    if (!confirm('차단 목록을 전체 삭제하시겠습니까?')) return;
    db.ref('/imi_blocked').set([], function() {
        loadBlockedItems();
        loadMonitorLog();
    });
}

// ===== 봇 규칙 관리 (Firebase /imi_rules 배열) =====
var _botRules = [];
var _botRuleEditingId = null;

db.ref('/imi_rules').on('value', function(snap) {
    var val = snap.val();
    _botRules = Array.isArray(val) ? val.filter(Boolean)
              : (val && typeof val === 'object') ? Object.values(val).filter(Boolean)
              : [];
    _renderBotRuleList();
});

function _renderBotRuleList() {
    var list = document.getElementById('botRuleList');
    if (!list) return;
    if (!_botRules.length) {
        list.innerHTML = '<div style="text-align:center;padding:20px 0;opacity:0.35;font-size:12px;">등록된 봇 규칙이 없습니다</div>';
        return;
    }
    var canEdit = _isBotPrivileged();
    list.innerHTML = _botRules.map(function(r) {
        var runStatus = (_botStatus && _botStatus.rules) ? _botStatus.rules.find(function(sr){ return sr.id === r.id; }) : null;
        var isRunning = !!(runStatus && runStatus.tabOpen);
        var runColor  = isRunning ? '#22c55e' : '#94a3b8';
        var runLabel  = isRunning ? '● 감시중' : '■ 대기';
        var typeTag = r.type === 'watch'
            ? '<span style="font-size:9px;font-weight:900;color:#22c55e;border:1px solid #22c55e;border-radius:4px;padding:1px 5px;flex-shrink:0;">📦 비거래</span>'
            : '<span style="font-size:9px;font-weight:900;color:#ef4444;border:1px solid #ef4444;border-radius:4px;padding:1px 5px;flex-shrink:0;">🚨 사기글</span>';
        return '<div style="border:1.5px solid var(--border-ui);border-radius:10px;padding:10px 13px;margin-bottom:6px;background:var(--bg-body);">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
            + '<label style="display:flex;align-items:center;gap:6px;cursor:'+(canEdit?'pointer':'default')+';flex:1;min-width:0;">'
            + '<input type="checkbox" onchange="toggleBotRuleEnabled(\'' + _esc(r.id) + '\',this.checked)" '+(r.enabled?'checked':'')+' '+(canEdit?'':'disabled')+' style="width:15px;height:15px;accent-color:var(--active-focus-color);cursor:'+(canEdit?'pointer':'default')+';">'
            + '<span style="font-size:12px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(r.name) + '</span>'
            + '</label>'
            + typeTag
            + '<span style="font-size:10px;font-weight:900;color:'+runColor+';flex-shrink:0;">'+runLabel+'</span>'
            + (canEdit ? '<button onclick="startEditBotRule(\''+_esc(r.id)+'\')" style="font-size:10px;padding:2px 7px;border-radius:5px;border:1.5px solid #f59e0b;color:#f59e0b;background:none;cursor:pointer;flex-shrink:0;">수정</button>' : '')
            + (canEdit ? '<button onclick="deleteBotRule(\''+_esc(r.id)+'\')" style="font-size:10px;padding:2px 7px;border-radius:5px;border:1.5px solid #ef4444;color:#ef4444;background:none;cursor:pointer;flex-shrink:0;">삭제</button>' : '')
            + '</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;">'
            + (r.keyword        ? '<span class="mon-tag">🔑 ' + _esc(r.keyword) + '</span>' : '')
            + (r.minPrice       ? '<span class="mon-tag">💰 ' + Number(r.minPrice).toLocaleString() + '원↑</span>' : '')
            + (r.maxPrice       ? '<span class="mon-tag">💰 ' + Number(r.maxPrice).toLocaleString() + '원↓</span>' : '')
            + '<span class="mon-tag">⏱ ' + (r.scanInterval || 5) + '초</span>'
            + (r.excludeKeyword ? '<span class="mon-tag">🚫 ' + _esc(r.excludeKeyword) + '</span>' : '')
            + '</div>'
            + '<div style="font-size:9.5px;opacity:0.3;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(r.url || '') + '</div>'
            + '</div>';
    }).join('');
}

function _saveBotRules(rules) {
    db.ref('/imi_rules').set(rules);
}

function toggleBotRuleEnabled(id, enabled) {
    if (!_isBotPrivileged()) return;
    _saveBotRules(_botRules.map(function(r) {
        return r.id === id ? Object.assign({}, r, { enabled: enabled }) : r;
    }));
}

function deleteBotRule(id) {
    if (!_isBotPrivileged()) return;
    if (!confirm('이 봇 규칙을 삭제하시겠습니까?')) return;
    _saveBotRules(_botRules.filter(function(r) { return r.id !== id; }));
    if (_botRuleEditingId === id) _cancelBotRuleEdit();
}

function startEditBotRule(id) {
    var r = _botRules.find(function(r) { return r.id === id; });
    if (!r) return;
    _botRuleEditingId = id;
    document.getElementById('brName').value     = r.name || '';
    document.getElementById('brUrl').value      = r.url  || '';
    document.getElementById('brKw').value       = r.keyword || '';
    document.getElementById('brMin').value      = r.minPrice || '';
    document.getElementById('brMax').value      = r.maxPrice || '';
    document.getElementById('brInterval').value = r.scanInterval || 300;
    document.getElementById('brExclude').value  = r.excludeKeyword || '';
    var brTypeEl = document.querySelector('input[name="brType"][value="'+(r.type||'fraud')+'"]');
    if (brTypeEl) brTypeEl.checked = true;
    document.getElementById('brAddBtn').textContent   = '✏️ 수정 완료';
    document.getElementById('brAddBtn').style.background = '#f59e0b';
    document.getElementById('brFormTitle').textContent  = '✏️ 규칙 수정 중';
    document.getElementById('brCancelBtn').style.display = '';
    document.getElementById('brName').focus();
}

function _cancelBotRuleEdit() {
    _botRuleEditingId = null;
    ['brName','brUrl','brKw','brMin','brMax','brExclude'].forEach(function(id) {
        document.getElementById(id).value = '';
    });
    document.getElementById('brInterval').value = '300';
    var fraudEl = document.getElementById('brTypeFraud'); if (fraudEl) fraudEl.checked = true;
    document.getElementById('brAddBtn').textContent   = '✅ 규칙 등록';
    document.getElementById('brAddBtn').style.background = '';
    document.getElementById('brFormTitle').textContent  = '➕ 새 규칙 추가';
    document.getElementById('brCancelBtn').style.display = 'none';
}

function addBotRule() {
    if (!_isBotPrivileged()) { alert('관리자 또는 부관리자만 봇 규칙을 관리할 수 있습니다.'); return; }
    var name           = (document.getElementById('brName').value || '').trim();
    var url            = (document.getElementById('brUrl').value  || '').trim();
    var keyword        = (document.getElementById('brKw').value   || '').trim();
    var minPrice       = parseInt(document.getElementById('brMin').value)      || 0;
    var maxPrice       = parseInt(document.getElementById('brMax').value)      || 0;
    var scanInterval   = parseInt(document.getElementById('brInterval').value) || 300;
    var excludeKeyword = (document.getElementById('brExclude').value || '').trim();
    var typeEl         = document.querySelector('input[name="brType"]:checked');
    var ruleType       = typeEl ? typeEl.value : 'fraud';

    if (!name) { alert('규칙 이름을 입력하세요.'); return; }
    if (!url || !/^https?:\/\//.test(url)) { alert('올바른 URL을 입력하세요. (https://...)'); return; }
    if (!keyword && !minPrice) { alert('키워드 또는 최소가격 중 하나는 필요합니다.'); return; }

    if (_botRuleEditingId) {
        _saveBotRules(_botRules.map(function(r) {
            return r.id === _botRuleEditingId
                ? Object.assign({}, r, { name: name, url: url, keyword: keyword, minPrice: minPrice, maxPrice: maxPrice, scanInterval: scanInterval, excludeKeyword: excludeKeyword, type: ruleType })
                : r;
        }));
        _cancelBotRuleEdit();
        alert('✅ 규칙이 수정됐습니다: ' + name + '\n1분 내로 봇에 자동 반영됩니다.');
    } else {
        var newRule = {
            id: 'r_' + Date.now(),
            name: name, url: url, keyword: keyword,
            minPrice: minPrice, maxPrice: maxPrice,
            scanInterval: scanInterval, excludeKeyword: excludeKeyword,
            type: ruleType, enabled: true, createdAt: Date.now()
        };
        _saveBotRules(_botRules.concat([newRule]));
        ['brName','brUrl','brKw','brMin','brMax','brExclude'].forEach(function(id) {
            document.getElementById(id).value = '';
        });
        document.getElementById('brInterval').value = '300';
        var fraudEl = document.getElementById('brTypeFraud'); if (fraudEl) fraudEl.checked = true;
        alert('✅ 규칙이 등록됐습니다: ' + name + '\n1분 내로 봇에 자동 반영됩니다.');
    }
}

// ===== 거래번호 감시 (watched_tids) =====
var _watchedTids = {};

db.ref('/watched_tids').on('value', function(snap) {
    _watchedTids = snap.val() || {};
    _renderWatchedTids();
});

function addWatchedTid() {
    var tid   = (document.getElementById('wtTid').value   || '').trim().replace(/\s/g, '');
    var label = (document.getElementById('wtLabel').value || '').trim();
    if (!tid || !/^\d+$/.test(tid)) { alert('거래번호는 숫자만 입력하세요.'); return; }
    if (_watchedTids) {
        var exists = Object.values(_watchedTids).some(function(v){ return v && String(v.tid) === tid; });
        if (exists) { alert('이미 등록된 거래번호입니다.'); return; }
    }
    var key = 'wt_' + Date.now();
    var addedBy = (typeof _currentUser !== 'undefined' && _currentUser) ? (_currentUser.name || '') : '';
    db.ref('/watched_tids/' + key).set({
        tid: tid, label: label, addedBy: addedBy,
        addedAt: Date.now(), alertSent: false
    }, function(err) {
        if (err) { alert('등록 실패: ' + err.message); return; }
        document.getElementById('wtTid').value   = '';
        document.getElementById('wtLabel').value = '';
        alert('✅ 거래번호 ' + tid + ' 감시 등록됐습니다.\n5분마다 자동 체크합니다.');
    });
}

function _loadWatchInterval() {
    db.ref('/tid_watch_interval').once('value', function(snap) {
        var v = snap.val();
        var el = document.getElementById('wtInterval');
        if (el && v) el.value = v;
    });
}

function saveWatchInterval() {
    var el = document.getElementById('wtInterval');
    var v = parseInt(el ? el.value : '') || 20;
    if (v < 5) v = 5;
    if (v > 120) v = 120;
    el.value = v;
    db.ref('/tid_watch_interval').set(v, function(err) {
        if (err) { alert('저장 실패: ' + err.message); return; }
        alert('✅ 체크 간격이 ' + v + '분으로 저장됐습니다.\n다음 체크 주기부터 적용됩니다.');
    });
}

function _renderWatchedTids() {
    var list = document.getElementById('watchedTidList');
    if (!list) return;
    var entries = Object.entries(_watchedTids || {});
    if (!entries.length) {
        list.innerHTML = '<div style="text-align:center;padding:16px 0;opacity:0.35;font-size:12px;">등록된 감시 거래번호가 없습니다</div>';
        return;
    }
    entries.sort(function(a, b){ return (b[1].addedAt||0) - (a[1].addedAt||0); });
    list.innerHTML = entries.map(function(e) {
        var k = e[0]; var v = e[1];
        var tid = _esc(String(v.tid || ''));
        var label = v.label ? ('<span style="font-size:11px;font-weight:700;color:var(--text-main);">' + _esc(v.label) + '</span>') : '';
        var tidFmt = tid.replace(/(.{4})(?=.)/g, '$1 ');
        var statusColor = v.alertSent ? '#22c55e' : '#f59e0b';
        var statusText  = v.alertSent ? '✅ 노출 감지됨' : '⏳ 감시중';
        var addedAt = v.addedAt ? new Date(v.addedAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
        return '<div style="border:1.5px solid var(--border-ui);border-radius:10px;padding:10px 13px;margin-bottom:6px;background:var(--bg-body);">'
            + '<div style="display:flex;align-items:center;gap:8px;">'
            + '<div style="flex:1;min-width:0;">'
            + (label ? label + '<br>' : '')
            + '<span style="font-size:16px;font-weight:900;color:#38bdf8;letter-spacing:0.03em;">#' + tidFmt + '</span>'
            + '</div>'
            + '<span style="font-size:10px;font-weight:900;color:' + statusColor + ';flex-shrink:0;">' + statusText + '</span>'
            + '</div>'
            + (addedAt ? '<div style="font-size:9.5px;opacity:0.3;margin-top:3px;">' + (v.addedBy ? v.addedBy + ' · ' : '') + addedAt + '</div>' : '')
            + '</div>';
    }).join('');
}