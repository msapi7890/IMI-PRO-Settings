// ===== IMI BOT 상태 대시보드 =====
var _botStatus = null;
var _botBridgeConnected = false;

// 확장프로그램 브릿지 연결 감지
window.addEventListener('message', function(e) {
    if (!e.data) return;
    if (e.data.__imiBotConnected) {
        _botBridgeConnected = true;
        _updateBotToggleBtn();
    }
});

function _sendToBot(msg) {
    window.postMessage(Object.assign({ __imiBot: true }, msg), '*');
}

function toggleBotFromWeb() {
    var btn = document.getElementById('monBotToggleBtn');
    if (btn) btn.disabled = true;
    if (_botStatus && _botStatus.active) {
        _sendToBot({ type: 'STOP_ALL' });
    } else {
        // 체크된 규칙 ID 수집
        var rules = (_botStatus && _botStatus.rules) || [];
        var checkedIds = rules
            .filter(function(r) {
                var chk = document.getElementById('ruleChk_' + r.id);
                return chk && chk.checked;
            })
            .map(function(r) { return r.id; });
        if (!checkedIds.length) {
            alert('실행할 규칙을 하나 이상 체크해주세요.');
            if (btn) btn.disabled = false;
            return;
        }
        _sendToBot({ type: 'START_SELECTED', ruleIds: checkedIds });
    }
    setTimeout(function() { if (btn) btn.disabled = false; }, 2000);
}

function _updateBotToggleBtn() {
    var btn = document.getElementById('monBotToggleBtn');
    if (!btn) return;
    var active = _botStatus && _botStatus.active;
    // Firebase에서 봇 상태를 수신하면 버튼 활성화 (브릿지 연결 여부와 무관)
    if (_botStatus) {
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
    } else if (!_botBridgeConnected) {
        btn.textContent = '확장프로그램 필요';
        btn.disabled = true;
        btn.style.background = '#334155';
        btn.style.color = '#94a3b8';
    }
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
    dot.classList.toggle('active', isActive);

    if (text) {
        text.textContent = isActive
            ? '감시 중 — ' + (s.activeCount || 0) + '개 규칙 실행 중'
            : '봇 중지됨 — ' + (s.totalCount || 0) + '개 규칙 등록됨';
    }
    if (badge) {
        badge.textContent  = isActive ? '● 감시 중' : '■ 중지됨';
        badge.style.background = isActive ? '#166534' : '#374151';
        badge.style.color      = isActive ? '#4ade80'  : '#9ca3af';
    }
    if (lastUpd && s.lastUpdate) {
        lastUpd.textContent = '마지막 동기화: ' + new Date(s.lastUpdate).toLocaleTimeString('ko-KR');
    }

    if (!ruleList) return;
    var rules = s.rules || [];
    if (!rules.length) {
        ruleList.innerHTML = '<div style="text-align:center;padding:18px 0;opacity:0.35;font-size:12px;font-style:italic;">등록된 규칙이 없습니다</div>';
        return;
    }
    ruleList.innerHTML = rules.map(function(r) {
        var runColor = (r.enabled && r.tabOpen) ? '#22c55e' : (r.enabled ? '#f59e0b' : '#94a3b8');
        var runLabel = (r.enabled && r.tabOpen) ? '● 감시중' : (r.enabled ? '○ 대기' : '■ 비활성');
        var chkId = 'ruleChk_' + r.id;
        return '<div style="border:1.5px solid var(--border-ui);border-radius:10px;padding:10px 13px;margin-bottom:6px;background:var(--bg-body);">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
            + '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex:1;min-width:0;">'
            + '<input type="checkbox" id="' + chkId + '" ' + (r.enabled ? 'checked' : '') + ' style="width:15px;height:15px;cursor:pointer;accent-color:var(--active-focus-color);">'
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
    db.ref('monitor_last_alert/'+id).once('value', function(snap) {
        var lastAt = snap.val() || 0;
        if (Date.now() - lastAt >= 60000) {
            db.ref('urgent_notices').push({ content:content, createdAt:Date.now(), expiresAt:Date.now()+24*60*60*1000, isMonitorAlert:true });
            db.ref('monitor_last_alert/'+id).set(Date.now());
        }
    });
    db.ref('monitor_flash_state').set({
        active: true,
        ruleName: rule.name,
        itemCount: items.length,
        itemRows: items.slice(0,3).map(function(it){ return {t:it.title, p:it.price||0, u:it.url||''}; }),
        at: Date.now()
    });
}

function closeMonitorFlash() { db.ref('monitor_flash_state/active').set(false); }

function _showMonitorFlash(s) {
    document.getElementById('monitorAlertTitle').textContent = '🚨 '+(s.ruleName||'모니터링 경고');
    document.getElementById('monitorAlertCount').textContent = (s.itemCount||0)+'개 물품 감지됨';
    document.getElementById('monitorAlertItems').innerHTML = (s.itemRows||[]).map(function(it){
        var k = _esc(it.key || (it.t||'').substring(0,30).trim());
        return '<div style="padding:6px 0;border-bottom:1px solid var(--border-ui);">'
            +(it.tid?'<div style="font-size:11px;font-weight:900;color:#38bdf8;margin-bottom:2px;">#'+_esc(it.tid)+'</div>':'')
            +'<div style="display:flex;align-items:center;gap:6px;">'
            +'<div style="font-size:12px;font-weight:800;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(it.t||'')+'</div>'
            +(it.p?'<div style="color:#ef4444;font-weight:900;font-size:12px;flex-shrink:0;">'+Number(it.p).toLocaleString()+'원</div>':'')
            +'</div>'
            +'<button data-bk="'+k+'" data-title="'+_esc(it.t||'')+'" style="margin-top:4px;font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;cursor:pointer;">필터제외</button>'
            +'</div>';
    }).join('');
    document.getElementById('monitorAlertFlash').classList.remove('hidden');
    document.getElementById('chatSection').classList.add('monitor-border-flash');

    // 전체화면 빨간 오버레이 플래시
    _triggerFullscreenFlash();

    // 탭 제목 깜빡임
    _startTabBlink(s.ruleName, s.itemCount);

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
    if (s.active) _showMonitorFlash(s);
    else _hideMonitorFlashLocal();
});

// 필터제외 버튼 — 이벤트 위임 (monitorAlertFlash 내)
document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-bk]');
    if (!btn || !document.getElementById('monitorAlertItems').contains(btn)) return;
    var key   = btn.getAttribute('data-bk');
    var title = btn.getAttribute('data-title') || '';
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var keys = list.map(function(i) { return typeof i === 'object' ? i.key : i; });
        if (!keys.includes(key)) {
            list.push(title ? { key: key, title: title } : key);
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
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var keys = list.map(function(i) { return typeof i === 'object' ? i.key : i; });
        if (!keys.includes(key)) {
            list.push(title ? { key: key, title: title } : key);
            db.ref('/imi_blocked').set(list);
        }
        btn.disabled = true;
        btn.textContent = '제외됨';
        btn.style.opacity = '0.4';
        btn.style.cursor = 'default';
    });
});

// ===== 로그 패널 =====
function openLogPanel() {
    document.getElementById('logPanel').classList.remove('hidden');
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
    if (n === 1) loadMonitorLog();
    if (n === 2) loadBlockedItems();
}

function loadMonitorLog() {
    var cutoff = Date.now() - 3600000;
    // 차단 목록 먼저 조회 → 이미 제외된 항목 버튼 비활성 처리
    db.ref('/imi_blocked').once('value', function(blockedSnap) {
        var blockedList = blockedSnap.val() || [];
        if (!Array.isArray(blockedList)) blockedList = [];
        var blockedSet = {};
        blockedList.forEach(function(k) { blockedSet[k] = true; });

        db.ref('/monitor_history').once('value', function(snap) {
            var val = snap.val() || {};
            var toDelete = [];
            var entries = [];
            Object.keys(val).forEach(function(k) {
                var e = val[k];
                if (!e || e.at < cutoff) { toDelete.push(k); return; }
                entries.push({ key: k, data: e });
            });
            toDelete.forEach(function(k) { db.ref('/monitor_history/' + k).remove(); });
            entries.sort(function(a, b) { return b.data.at - a.data.at; });

            var empty = document.getElementById('monitorLogEmpty');
            var list  = document.getElementById('monitorLogList');
            if (!entries.length) {
                if (empty) empty.style.display = '';
                if (list)  list.innerHTML = '';
                return;
            }
            if (empty) empty.style.display = 'none';
            if (list) list.innerHTML = entries.map(function(entry) {
                var d = entry.data;
                var timeStr = new Date(d.at).toLocaleTimeString('ko-KR');
                var rows = (d.itemRows || []).map(function(it) {
                    var rawKey = it.key || it.tid || (it.t || '').substring(0, 30).trim();
                    var bk = _esc(rawKey);
                    var isBlocked = blockedSet[rawKey];
                    var titleAttr = _esc(it.t || '');
                    var btnHtml = bk
                        ? (isBlocked
                            ? '<button data-logbk="' + bk + '" data-logtitle="' + titleAttr + '" disabled style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;flex-shrink:0;opacity:0.4;cursor:default;">제외됨</button>'
                            : '<button data-logbk="' + bk + '" data-logtitle="' + titleAttr + '" style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;cursor:pointer;flex-shrink:0;">필터제외</button>')
                        : '';
                    return '<div style="display:flex;flex-direction:column;gap:2px;padding:7px 10px;background:var(--bg-body);border-radius:7px;border:1px solid var(--border-ui);">'
                        + (it.tid ? '<div style="font-size:11px;font-weight:900;color:#38bdf8;">#' + _esc(it.tid) + '</div>' : '')
                        + '<div style="display:flex;align-items:center;gap:6px;">'
                        + '<div style="font-size:11px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(it.t || '') + '</div>'
                        + (it.p ? '<div style="font-size:11px;font-weight:900;color:#ef4444;flex-shrink:0;">' + Number(it.p).toLocaleString() + '원</div>' : '')
                        + btnHtml
                        + '</div>'
                        + '</div>';
                }).join('');
                return '<div style="border:1.5px solid var(--border-ui);border-radius:11px;padding:11px 14px;margin-bottom:8px;">'
                    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
                    + '<div style="font-size:12px;font-weight:900;color:var(--active-focus-color);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(d.ruleName || '') + '</div>'
                    + '<div style="font-size:10px;font-weight:700;opacity:0.45;flex-shrink:0;">' + timeStr + '</div>'
                    + '<div style="font-size:10px;font-weight:900;color:#ef4444;flex-shrink:0;">' + (d.itemCount || 0) + '개 감지</div>'
                    + '</div>'
                    + '<div style="display:flex;flex-direction:column;gap:5px;">' + rows + '</div>'
                    + '</div>';
            }).join('');
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
            var key   = typeof item === 'object' ? (item.key   || '') : item;
            var title = typeof item === 'object' ? (item.title || '') : '';
            return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1.5px solid var(--border-ui);border-radius:8px;margin-bottom:6px;">'
                + '<div style="flex:1;min-width:0;">'
                + (title ? '<div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(title) + '</div>' : '')
                + '<div style="font-size:10px;opacity:0.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(key) + '</div>'
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