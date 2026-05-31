// ===== IMI BOT 상태 대시보드 =====
var _botStatus = null;
var _botBridgeConnected = false;

// 확장프로그램 브릿지 연결 감지 + 푸시 알림 수신
window.addEventListener('message', function(e) {
    if (!e.data) return;
    if (e.data.__imiBotConnected) {
        var wasConnected = _botBridgeConnected;
        _botBridgeConnected = true;
        _updateBotToggleBtn();
        if (!wasConnected) {
            _sendToBot({ type: 'SYNC_STATUS' });
        }
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
        if (ruleList) {
            ruleList.innerHTML = '<div style="text-align:center;padding:18px 0;opacity:0.35;font-size:12px;">봇 연결 없음</div>';
        }
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
    // 사기글 먼저, 비거래 나중
    rules = rules.slice().sort(function(a, b) {
        return (a.type === 'watch' ? 1 : 0) - (b.type === 'watch' ? 1 : 0);
    });
    var canCtrl = _isBotPrivileged();
    ruleList.innerHTML = rules.map(function(r) {
        var liveRule = _botRules.find(function(br) { return br.id === r.id; });
        var isEnabled = liveRule !== undefined ? liveRule.enabled : r.enabled;
        var runColor = (isEnabled && r.tabOpen) ? '#22c55e' : (isEnabled ? '#f59e0b' : '#94a3b8');
        var runLabel = (isEnabled && r.tabOpen) ? '● 감시중' : (isEnabled ? '○ 대기' : '■ 비활성');
        var chkId = 'ruleChk_' + r.id;
        var chkDisabled = canCtrl ? '' : 'disabled';
        var isWatch = r.type === 'watch';
        var borderColor = isWatch ? '#22c55e33' : '#ef444433';
        var typeTag = isWatch
            ? '<span style="font-size:9px;font-weight:900;color:#22c55e;border:1px solid #22c55e;border-radius:4px;padding:1px 5px;flex-shrink:0;">📦 비거래</span>'
            : '<span style="font-size:9px;font-weight:900;color:#ef4444;border:1px solid #ef4444;border-radius:4px;padding:1px 5px;flex-shrink:0;">🚨 사기글</span>';
        return '<div style="border:1.5px solid var(--border-ui);border-left:3px solid '+(isWatch?'#22c55e':'#ef4444')+';border-radius:10px;padding:10px 13px;margin-bottom:6px;background:var(--bg-body);">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
            + '<label style="display:flex;align-items:center;gap:6px;cursor:'+(canCtrl?'pointer':'default')+';flex:1;min-width:0;">'
            + '<input type="checkbox" id="' + chkId + '" ' + (isEnabled ? 'checked' : '') + ' ' + chkDisabled + ' onchange="toggleBotRuleEnabled(\'' + _esc(r.id) + '\',this.checked)" style="width:15px;height:15px;cursor:'+(canCtrl?'pointer':'default')+';accent-color:var(--active-focus-color);">'
            + '<span style="font-size:12px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(r.name) + '</span>'
            + '</label>'
            + typeTag
            + '<span style="font-size:10px;font-weight:900;color:' + runColor + ';flex-shrink:0;">' + runLabel + '</span>'
            + '</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;">'
            + (r.keyword        ? '<span class="mon-tag">🔑 ' + _esc(r.keyword) + '</span>' : '')
            + (r.subKeyword     ? '<span class="mon-tag" style="color:#7dd3fc;border-color:#0284c7;">🔗 AND: ' + _esc(r.subKeyword) + '</span>' : '')
            + (r.minPrice       ? '<span class="mon-tag">💰 ' + Number(r.minPrice).toLocaleString() + '원↑</span>' : '')
            + (r.maxPrice       ? '<span class="mon-tag">💰 ' + Number(r.maxPrice).toLocaleString() + '원↓</span>' : '')
            + '<span class="mon-tag">⏱ ' + (r.scanInterval || 5) + '초</span>'
            + (r.excludeKeyword ? '<span class="mon-tag">🚫 ' + _esc(r.excludeKeyword) + '</span>' : '')
            + (r.photoMinPrice   ? '<span class="mon-tag">📸 ' + Number(r.photoMinPrice).toLocaleString() + '원↑</span>' : '')
            + (r.noPhotoMinPrice ? '<span class="mon-tag">📝 ' + Number(r.noPhotoMinPrice).toLocaleString() + '원↑</span>' : '')
            + '</div>'
            + '</div>';
    }).join('');
}


function openMonitorModal() {
    _renderBotStatus();
    document.getElementById('monitorModal').classList.remove('hidden');
    window.postMessage({ __imiBotPing: true }, '*');
    _stopTabBlink('fraud');
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
    // 구 모니터 엔진(거래번호 감시)은 history 기록 안 함
}

function closeMonitorFlash() { db.ref('monitor_flash_state/active').set(false); }

function _getNotifPrefs(){
    try{ return Object.assign({flash:true,popup:true,sound:false,watchPopup:false},JSON.parse(localStorage.getItem('imi_notif_prefs')||'{}')); }catch(e){ return {flash:true,popup:true,sound:false,watchPopup:false}; }
}

// 브릿지 기반 in-page 토스트 팝업 (사기글: 우하단 빨강 / 비거래: 좌하단 초록)
(function() {
    var _styleInjected = false;
    function _ensureStyle() {
        if (_styleInjected) return;
        _styleInjected = true;
        var s = document.createElement('style');
        s.textContent = '@keyframes _imiPopIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}';
        document.head.appendChild(s);
    }
    function _getContainer(isWatch) {
        var id = isWatch ? '_imi_watch_toasts' : '_imi_fraud_toasts';
        var c = document.getElementById(id);
        if (c) { c.style.display = ''; return c; } // 새 알림 시 숨겨진 컨테이너도 재표시
        c = document.createElement('div');
        c.id = id;
        c.style.cssText = 'position:fixed;z-index:2147483640;bottom:20px;'
            + (isWatch ? 'left:20px;' : 'right:20px;')
            + 'display:flex;flex-direction:column-reverse;gap:8px;pointer-events:none;max-width:480px;';
        document.body.appendChild(c);
        return c;
    }
    window._showInPagePopup = function(type, data) {
        _ensureStyle();
        var isWatch = type === 'watch';
        var accent   = isWatch ? '#22c55e' : '#ef4444';
        var accentA  = isWatch ? '#22c55e77' : '#ef444477';
        var accentB  = isWatch ? '#22c55e33' : '#ef444433';
        var priceClr = isWatch ? '#22c55e' : '#ef4444';
        var btnClr   = isWatch ? '#86efac' : '#f87171';
        var container = _getContainer(isWatch);

        var wrap = document.createElement('div');
        wrap.style.cssText = 'width:460px;border:1.5px solid '+accentA+';border-radius:8px;'
            + 'background:#1e293b;font-family:sans-serif;font-size:12px;color:#f1f5f9;'
            + 'animation:_imiPopIn 0.22s ease;pointer-events:auto;'
            + 'box-shadow:0 4px 24px rgba(0,0,0,0.45);';

        // 카드 헤더
        var cardHdr = document.createElement('div');
        cardHdr.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid '+accentB+';';
        var hdrLabel = (isWatch ? '📦 ' : '🚨 ') + _esc(data.ruleName || (isWatch ? '비거래' : '감지'));
        var kw = data.ruleKeyword || data.keyword || '';
        cardHdr.innerHTML = '<span style="font-size:12px;font-weight:900;color:'+accent+';flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
            + hdrLabel
            + (kw ? '&nbsp;<span style="color:'+btnClr+';font-size:10px;">· "'+_esc(kw)+'"</span>' : '')
            + '</span>'
            + '<span style="font-size:10px;color:#94a3b8;font-weight:700;flex-shrink:0;">'+(data.itemCount||0)+'개</span>';
        wrap.appendChild(cardHdr);

        // 아이템 목록
        var itemList = document.createElement('div');
        itemList.style.cssText = 'max-height:220px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#334155 transparent;padding:0 10px;';
        (data.itemRows || []).forEach(function(it) {
            var k = _esc(it.key || (it.t||'').substring(0,30).trim());
            var row = document.createElement('div');
            row.style.cssText = 'padding:5px 0;border-bottom:1px solid #33415540;';
            var tidHtml = '';
            if (it.tid) {
                if (isWatch) {
                    tidHtml = '<div><a href="https://www.itemmania.com/buy/buy_main.php?tid='+_esc(it.tid)+'" target="_blank" style="font-size:16px;font-weight:900;color:#38bdf8;letter-spacing:0.03em;text-decoration:none;">#'+_fmtTid(it.tid)+'</a></div>';
                } else {
                    tidHtml = '<div style="font-size:16px;font-weight:900;color:#38bdf8;letter-spacing:0.03em;">#'+_fmtTid(it.tid)+'</div>';
                }
            }
            row.innerHTML = tidHtml
                +'<div style="display:flex;align-items:center;gap:6px;">'
                +'<div style="font-size:11px;font-weight:800;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(it.t||'')+'</div>'
                +(it.p?'<div style="color:'+priceClr+';font-weight:900;font-size:11px;flex-shrink:0;">'+Number(it.p).toLocaleString()+'원</div>':'')
                +'</div>'
                +'<div style="display:flex;gap:6px;padding:6px 0 2px;">'
                +'<button data-bk="'+k+'" data-title="'+_esc(it.t||'')+'" data-tid="'+_esc(it.tid||'')+'" data-price="'+(it.p||0)+'"'+(isWatch?' data-bktype="watch"':'')+' style="flex:1;font-size:11px;font-weight:800;padding:5px 0;border-radius:5px;border:1px solid '+btnClr+';color:'+btnClr+';background:none;cursor:pointer;">필터제외</button>'
                +(isWatch?'<button class="_imi_toast_done" data-tid="'+_esc(it.tid||'')+'" style="flex:1;font-size:11px;font-weight:800;padding:5px 0;border-radius:5px;border:none;color:#052e16;background:#22c55e;cursor:pointer;">✅ 처리완료</button>':'')
                +'</div>';
            itemList.appendChild(row);
        });
        wrap.appendChild(itemList);

        // 사기글만 30초 자동 닫기 진행 바 (비거래는 수동 닫기만)
        if (!isWatch) {
            var prog = document.createElement('div');
            prog.style.cssText = 'height:3px;background:#1e293b;border-radius:0 0 8px 8px;';
            var bar = document.createElement('div');
            bar.style.cssText = 'height:100%;width:100%;background:'+accent+';transition:width 30s linear;border-radius:0 0 8px 8px;';
            prog.appendChild(bar);
            wrap.appendChild(prog);
            setTimeout(function() { bar.style.width = '0%'; }, 50);
        }
        // 비거래는 드랍다운과 동일하게 교체 방식 (사기글은 누적)
        if (isWatch) { container.innerHTML = ''; }
        container.appendChild(wrap);

        var _autoCloseTimer = null;

        function remove() {
            var hdrTab = document.getElementById(isWatch ? 'watchHeaderTab' : 'fraudHeaderTab');
            if(hdrTab && hdrTab._popupCount) {
                hdrTab._popupCount = Math.max(0, hdrTab._popupCount - (data.itemCount || 0));
                if(hdrTab._popupCount <= 0) {
                    hdrTab._popupCount = 0;
                    hdrTab.style.display = 'none';
                    hdrTab.classList.remove('hdr-tab-blink');
                    if(typeof _stopTabBlink === 'function') _stopTabBlink(isWatch ? 'watch' : 'fraud');
                    if(typeof _updateWatchFraudRow === 'function') _updateWatchFraudRow();
                    if(isWatch && typeof _syncWatchBanner === 'function') _syncWatchBanner();
                } else {
                    var badge = isWatch
                        ? '⚠️ 비거래&nbsp;<span style="background:#22c55e;color:#000;border-radius:99px;padding:0 6px;font-size:10px;font-weight:900;">'+hdrTab._popupCount+'</span>'
                        : '🚨 사기글&nbsp;<span style="background:#ef4444;color:#fff;border-radius:99px;padding:0 6px;font-size:10px;font-weight:900;">'+hdrTab._popupCount+'</span>';
                    hdrTab.innerHTML = badge;
                }
            }
            if (!isWatch) _removeChatBorderFlash();
            wrap.style.cssText += 'opacity:0;transform:translateX('+(isWatch?'-':'')+'20px);transition:all 0.2s ease;';
            setTimeout(function() {
                if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
                // 팝업 제거 후 컨테이너 비었으면 탭 강제 숨기기 (_popupCount 오차 방어)
                var cont = document.getElementById(isWatch ? '_imi_watch_toasts' : '_imi_fraud_toasts');
                if (cont && cont.childElementCount === 0) {
                    var t = document.getElementById(isWatch ? 'watchHeaderTab' : 'fraudHeaderTab');
                    if (t && t.style.display !== 'none') {
                        t.style.display = 'none';
                        t.classList.remove('hdr-tab-blink');
                        if (typeof _stopTabBlink === 'function') _stopTabBlink(isWatch ? 'watch' : 'fraud');
                        if (typeof _updateWatchFraudRow === 'function') _updateWatchFraudRow();
                        if (!isWatch) _removeChatBorderFlash();
                    }
                }
            }, 220);
        }

        // 처리완료 버튼 (비거래)
        itemList.addEventListener('click', function(e) {
            var doneBtn = e.target.closest('._imi_toast_done');
            if (!doneBtn || doneBtn.disabled) return;
            var tid = doneBtn.getAttribute('data-tid');
            if (!tid) return;
            var by = (typeof _currentUser !== 'undefined' && _currentUser && _currentUser.name) ? _currentUser.name : '';
            doneBtn.disabled = true;
            db.ref('imi_watch_done/' + tid).set({ at: Date.now(), by: by });
            // 해당 항목 행 페이드아웃 후 제거
            var row = doneBtn.closest('[style*="border-bottom"]') || doneBtn.parentNode.parentNode;
            row.style.transition = 'opacity 0.4s';
            row.style.opacity = '0';
            setTimeout(function() {
                if (row.parentNode) row.parentNode.removeChild(row);
                // 남은 항목 없으면 5초 후 팝업 닫기
                var remaining = itemList.querySelectorAll('._imi_toast_done');
                if (remaining.length === 0) setTimeout(remove, 5000);
            }, 400);
        });

        // 사기글: 30초 자동 닫기
        if (!isWatch) {
            _autoCloseTimer = setTimeout(remove, 30000);
        }
    };
}());

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
function _applyChatBorderFlash() {}
function _removeChatBorderFlash() {
    // fraudDropPanel border + maxHeight 강제 초기화
    var fraudPanel = document.getElementById('fraudDropPanel');
    if (fraudPanel) {
        fraudPanel.style.borderColor = 'transparent';
        fraudPanel.style.maxHeight = '0px';
    }
}
setInterval(function() {
    var fraudTab = document.getElementById('fraudHeaderTab');
    if (!fraudTab || fraudTab.style.display !== 'flex') {
        _removeChatBorderFlash();
        var fp = document.getElementById('fraudDropPanel');
        if (fp) { fp.classList.remove('fraud-panel-blink'); fp.style.boxShadow = 'none'; }
    }
    var watchTab = document.getElementById('watchHeaderTab');
    if (!watchTab || watchTab.style.display !== 'flex') {
        var wp = document.getElementById('watchDropPanel');
        if (wp) { wp.style.borderColor = 'transparent'; wp.style.maxHeight = '0px'; wp.classList.remove('watch-panel-blink'); wp.style.boxShadow = 'none'; }
    }
}, 200);
function _fireOsNotif(s) {
    // 익스텐션이 설치돼 있으면 background.js가 알림을 처리하므로 중복 방지
    if (_botBridgeConnected) return;
    if (s.ruleType === 'watch' || !('Notification' in window)) return;
    var allTids = (s.itemRows||[]).map(function(r){ return r.tid||''; }).filter(Boolean);
    var newTids = allTids.filter(function(t){ return !_notifSentTids.has(t); });
    var shouldNotif = allTids.length === 0 || newTids.length > 0;
    newTids.forEach(function(t){ _notifSentTids.add(t); });
    if (!shouldNotif) return;
    var notifCount = allTids.length === 0 ? (s.itemCount||0) : newTids.length;
    var _fn = function() {
        var _n = new Notification('🚨 ' + (s.ruleName || 'IMI PRO') + ' 감지됨', {
            body: notifCount + '개 감지' + (s.ruleKeyword ? ' · 키워드: ' + s.ruleKeyword : '') + '\nIMI PRO 확인 바랍니다',
            icon: 'https://msapi7890.github.io/IMI-PRO/favicon.ico',
            tag: 'imi-pro-alert'
        });
        _n.onclick = function() {
            _n.close();
            if (window.opener) window.opener.focus();
            window.focus();
        };
    };
    if (Notification.permission === 'granted') { _fn(); }
    else if (Notification.permission === 'default') { Notification.requestPermission().then(function(p){ if(p==='granted') _fn(); }); }
}

function _showMonitorFlash(s) {
    if (s.ruleType === 'watch') return;
    // 필터제외 물품 제거 — 재감지 시 이미 제외된 물품은 알림 안 띄움
    var filteredRows = (s.itemRows || []).filter(function(it) {
        var k = it.key || (it.t||'').substring(0,30).trim();
        return !_blockedKeysCache.has(String(k));
    });
    if (filteredRows.length === 0) return;
    s.itemRows = filteredRows;
    s.itemCount = filteredRows.length;
    var _np=_getNotifPrefs();

    // popup ON → 하단 팝업만 표시
    if (_np.popup) {
        if (_np.flash) { _triggerFullscreenFlash(); }
        if (_np.sound) _playAlertBeep();
        _startTabBlink(s.ruleName, s.itemCount, 'fraud');
        _showInPagePopup('fraud', s);
        // 상단바 탭 배지 표시 + 줄 깜빡임
        var fTab = document.getElementById('fraudHeaderTab');
        if(fTab) {
            fTab.style.display = 'flex';
            fTab.classList.add('hdr-tab-blink');
            if(typeof _updateWatchFraudRow === 'function') _updateWatchFraudRow();
            fTab._popupCount = (fTab._popupCount || 0) + (s.itemCount || 0);
            fTab.innerHTML = '🚨 사기글&nbsp;<span style="background:#ef4444;color:#fff;border-radius:99px;padding:0 6px;font-size:10px;font-weight:900;">'+fTab._popupCount+'</span>';
            if (_np.flash) _applyChatBorderFlash(); // 빨간불깜빡임 ON일 때만 상단 바 표시
        }
        _fireOsNotif(s);
        return;
    }

    // 사기글 헤더 탭 + 드롭패널 — 키워드별 카드 위로 쌓기
    var fraudTab   = document.getElementById('fraudHeaderTab');
    var fraudPanel = document.getElementById('fraudDropPanel');
    if(fraudTab && fraudPanel){
        fraudTab.style.display = 'flex';
        if(typeof _updateWatchFraudRow === 'function') _updateWatchFraudRow();
        fraudTab.classList.add('hdr-tab-blink');
        if (_np.flash) _applyChatBorderFlash(); // 빨간불깜빡임 ON일 때만 상단 바 표시

        // 전체 스크롤 컨테이너 (없으면 생성)
        var scrollBox = fraudPanel.querySelector('[data-fraud-scroll]');
        if(!scrollBox){
            fraudPanel.innerHTML = '';
            scrollBox = document.createElement('div');
            scrollBox.setAttribute('data-fraud-scroll','1');
            scrollBox.style.cssText = 'padding:6px 8px;max-height:calc(75vh - 60px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:#334155 transparent;display:flex;flex-direction:column;gap:5px;';
            fraudPanel.appendChild(scrollBox);
        }

        // 키워드별 카드 — prepend(위에 추가)해서 최신이 맨 위
        var card = document.createElement('div');
        card.style.cssText = 'border:1.5px solid #ef444477;border-radius:8px;background:rgba(239,68,68,0.07);flex-shrink:0;';

        // 카드 헤더 (규칙명 + 닫기)
        var cardHdr = document.createElement('div');
        cardHdr.style.cssText = 'display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid #ef444433;';
        cardHdr.innerHTML = '<span style="font-size:12px;font-weight:900;color:#ef4444;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🚨 '+_esc(s.ruleName||'감지')
            +(s.ruleKeyword?'&nbsp;<span style="color:#f87171;font-size:10px;">· "'+_esc(s.ruleKeyword)+'"</span>':'')
            +'</span>'
            +'<span style="font-size:10px;color:#94a3b8;font-weight:700;flex-shrink:0;">'+(s.itemCount||0)+'개</span>';
        card.appendChild(cardHdr);
        card.setAttribute('data-fraud-card','1');

        // 카드 아이템 목록 (최대 4개 보이고 나머지 스크롤)
        var itemList = document.createElement('div');
        itemList.style.cssText = 'max-height:calc(30vh - 30px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:#334155 transparent;padding:0 10px;';
        (s.itemRows||[]).forEach(function(it){
            var k = _esc(it.key || (it.t||'').substring(0,30).trim());
            var row = document.createElement('div');
            row.style.cssText = 'padding:5px 0;border-bottom:1px solid #33415540;';
            row.innerHTML = (it.tid?'<div style="font-size:16px;font-weight:900;color:#38bdf8;letter-spacing:0.03em;">#'+_fmtTid(it.tid)+'</div>':'')
                +'<div style="display:flex;align-items:center;gap:6px;">'
                +'<div style="font-size:11px;font-weight:800;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(it.t||'')+'</div>'
                +(it.p?'<div style="color:#ef4444;font-weight:900;font-size:11px;flex-shrink:0;">'+Number(it.p).toLocaleString()+'원</div>':'')
                +'</div>'
                +'<div style="display:flex;align-items:center;gap:6px;margin-top:3px;">'
                +'<button data-bk="'+k+'" data-title="'+_esc(it.t||'')+'" data-tid="'+_esc(it.tid||'')+'" data-price="'+(it.p||0)+'" style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;cursor:pointer;flex-shrink:0;">필터제외</button>'
                +'<span style="font-size:9px;color:#94a3b8;">정상 물품일 경우</span>'
                +'</div>';
            itemList.appendChild(row);
        });
        card.appendChild(itemList);
        // 맨 위에 추가 (최신이 위)
        scrollBox.insertBefore(card, scrollBox.firstChild);

        // 탭 배지 누적
        var totalCount = (fraudPanel._totalCount || 0) + (s.itemCount || 0);
        fraudPanel._totalCount = totalCount;
        fraudTab.innerHTML = '🚨 사기글&nbsp;<span style="background:#ef4444;color:#fff;border-radius:99px;padding:0 6px;font-size:10px;font-weight:900;">'+totalCount+'</span>';

        fraudPanel.style.maxHeight = '75vh';
        fraudPanel.style.borderColor = '#ef4444';
        fraudPanel.classList.add('fraud-panel-blink');

        // 카드별 30초 자동 제거
        var _cardTimer = setTimeout(function(){
            if(!card.parentNode) return;
            card.remove();
            fraudPanel._totalCount = Math.max(0, (fraudPanel._totalCount||0) - (s.itemCount||0));
            if(!scrollBox.querySelector('[data-fraud-card]')){
                _hideMonitorFlashLocal();
            } else {
                fraudTab.innerHTML = '🚨 사기글&nbsp;<span style="background:#ef4444;color:#fff;border-radius:99px;padding:0 6px;font-size:10px;font-weight:900;">'+(fraudPanel._totalCount||0)+'</span>';
            }
        }, 30000);
        card._autoTimer = _cardTimer;
    }

    if (_np.flash) {
        _triggerFullscreenFlash();
    }

    // 탭 제목 깜빡임
    _startTabBlink(s.ruleName, s.itemCount, 'fraud');

    // 경고음
    if (_np.sound) _playAlertBeep();

    _fireOsNotif(s); // OS 브라우저 알림 (익스텐션 없는 환경 전용)


    // 전역 타이머 제거 — 카드별 30초 타이머로 대체
    if (window._monFlashTimer) { clearTimeout(window._monFlashTimer); window._monFlashTimer = null; }
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

function _startTabBlink(ruleName, itemCount, id) {
    var alertTitle = '🚨 [' + (itemCount||0) + '개 감지] ' + (ruleName||'모니터링 경고');
    var qid = id || 'default';
    if (!window._tabBlinkQueue) window._tabBlinkQueue = [];
    var q = window._tabBlinkQueue;
    var idx = q.findIndex(function(e) { return e.id === qid; });
    if (idx !== -1) { q[idx].title = alertTitle; }
    else { q.push({ id: qid, title: alertTitle }); }
    if (!window._tabBlinkOrigTitle) window._tabBlinkOrigTitle = document.title;
    // id별 60초 자동 종료 타이머 (감지 후 미확인 시 자동 멈춤)
    var autoKey = '_tabBlinkAuto_' + qid;
    if (window[autoKey]) clearTimeout(window[autoKey]);
    window[autoKey] = setTimeout(function() { _stopTabBlink(qid); window[autoKey] = null; }, 30000);
    if (window._tabBlinkInterval) return;
    window._tabBlinkTick = 0;
    window._tabBlinkInterval = setInterval(function() {
        var queue = window._tabBlinkQueue || [];
        if (!queue.length) { _stopTabBlink(); return; }
        var tick = window._tabBlinkTick++;
        if (tick % 2 === 0) {
            document.title = window._tabBlinkOrigTitle;
        } else {
            document.title = queue[Math.floor(tick / 2) % queue.length].title;
        }
    }, 700);
}

function _stopTabBlink(id) {
    if (id !== undefined) {
        window._tabBlinkQueue = (window._tabBlinkQueue || []).filter(function(e) { return e.id !== id; });
        if (window._tabBlinkQueue.length > 0) return;
    } else {
        window._tabBlinkQueue = [];
        _removeChatBorderFlash();
    }
    if (window._tabBlinkInterval) { clearInterval(window._tabBlinkInterval); window._tabBlinkInterval = null; }
    if (window._tabBlinkOrigTitle) { document.title = window._tabBlinkOrigTitle; window._tabBlinkOrigTitle = null; }
    window._tabBlinkTick = 0;
}

function _hideMonitorFlashLocal() {
    _removeChatBorderFlash();
    if (window._monFlashTimer) { clearTimeout(window._monFlashTimer); window._monFlashTimer = null; }
    if (window._overlayFlashInterval) { clearInterval(window._overlayFlashInterval); window._overlayFlashInterval = null; }
    var overlay = document.getElementById('monFullscreenOverlay');
    if (overlay) overlay.style.background = 'rgba(239,68,68,0)';
    _stopTabBlink('fraud');
    // 사기글 헤더 탭 & 드롭패널 숨기기
    var fraudTab   = document.getElementById('fraudHeaderTab');
    var fraudPanel = document.getElementById('fraudDropPanel');
    if(fraudTab){ fraudTab.style.display = 'none'; fraudTab.innerHTML = ''; fraudTab.classList.remove('hdr-tab-blink'); if(typeof _updateWatchFraudRow === 'function') _updateWatchFraudRow(); }
    if(fraudPanel){ fraudPanel.style.maxHeight = '0px'; fraudPanel.style.borderColor = 'transparent'; fraudPanel.innerHTML = ''; fraudPanel._totalCount = 0; }
}

var _lastFlashAt = 0;
var _notifSentTids = new Set();
var _blockedKeysCache = new Set();
db.ref('/imi_blocked').on('value', function(snap) {
    _blockedKeysCache = new Set();
    var list = snap.val() || [];
    if (!Array.isArray(list)) list = [];
    list.forEach(function(item) {
        var k = typeof item === 'object' ? item.key : item;
        var t = typeof item === 'object' ? (item.type || 'fraud') : 'fraud';
        if (t === 'fraud' && k) _blockedKeysCache.add(String(k));
    });
});
db.ref('monitor_flash_state').on('value', function(snap) {
    var s = snap.val();
    if (!s) return;
    if (s.active && s.at && (Date.now() - s.at) < 60000 && s.at !== _lastFlashAt) {
        _lastFlashAt = s.at;
        _showMonitorFlash(s);
        var panel = document.getElementById('logPanel');
        if (panel && !panel.classList.contains('hidden')) {
            var tab1 = document.getElementById('logTab1');
            var tab2 = document.getElementById('logTab2');
            if (tab1 && tab1.classList.contains('mon-tab-active')) setTimeout(loadMonitorLog, 1500);
            else if (tab2 && tab2.classList.contains('mon-tab-active')) setTimeout(loadWatchLog, 1500);
        }
    } else if (!s.active) _hideMonitorFlashLocal();
});

// 필터제외 버튼 — 이벤트 위임 (fraudDropPanel 내)
document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-bk]');
    if (!btn) return;
    var fraudPanel  = document.getElementById('fraudDropPanel');
    var monItems    = document.getElementById('monitorAlertItems');
    var toastsEl    = document.getElementById('_imi_fraud_toasts');
    var watchToasts = document.getElementById('_imi_watch_toasts');
    if (!(fraudPanel && fraudPanel.contains(btn)) && !(monItems && monItems.contains(btn)) && !(toastsEl && toastsEl.contains(btn)) && !(watchToasts && watchToasts.contains(btn))) return;
    var key   = btn.getAttribute('data-bk');
    var title = btn.getAttribute('data-title') || '';
    var tid   = btn.getAttribute('data-tid') || '';
    var price = parseInt(btn.getAttribute('data-price') || 0) || 0;
    var blockType = btn.getAttribute('data-bktype') || 'fraud';
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var keys = list.map(function(i) { return typeof i === 'object' ? i.key : i; });
        if (!keys.includes(key)) {
            var addedBy = (typeof _currentUser !== 'undefined' && _currentUser && _currentUser.name) ? _currentUser.name : '';
            list.push({ key: key, title: title, tid: tid, price: price, addedBy: addedBy, addedAt: Date.now(), type: blockType });
            db.ref('/imi_blocked').set(list);
        }
        btn.disabled = true;
        btn.textContent = '제외됨';
        btn.style.opacity = '0.4';
    });
});

// 비거래 로그 처리완료 버튼 — 이벤트 위임
document.getElementById('monitorLogListW').addEventListener('click', function(e) {
    var btn = e.target.closest('[data-logdone]');
    if (!btn || btn.disabled) return;
    var tid = btn.getAttribute('data-logdone');
    if (!tid) return;
    var by = (typeof _currentUser !== 'undefined' && _currentUser && _currentUser.name) ? _currentUser.name : '';
    btn.disabled = true;
    btn.textContent = '✅ 처리완료';
    btn.style.background = 'none';
    btn.style.border = '1px solid #22c55e';
    btn.style.color = '#22c55e';
    btn.style.opacity = '0.4';
    btn.style.cursor = 'default';
    db.ref('imi_watch_done/' + tid).set({ at: Date.now(), by: by });
});

// 필터제외 버튼 — 이벤트 위임 (log-box 안 #monitorLogList에 직접 위임, stopPropagation 우회)
function _handleLogBkClick(e) {
    var btn = e.target.closest('[data-logbk]');
    if (!btn || btn.disabled) return;
    var key   = btn.getAttribute('data-logbk');
    var title = btn.getAttribute('data-logtitle') || '';
    var tid   = btn.getAttribute('data-logtid') || '';
    var price = parseInt(btn.getAttribute('data-logprice') || 0) || 0;
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var keys = list.map(function(i) { return typeof i === 'object' ? i.key : i; });
        if (!keys.includes(key)) {
            var addedBy = (typeof _currentUser !== 'undefined' && _currentUser && _currentUser.name) ? _currentUser.name : '';
            list.push({ key: key, title: title, tid: tid, price: price, addedBy: addedBy, addedAt: Date.now(), type: 'fraud' });
            db.ref('/imi_blocked').set(list);
        }
        btn.disabled = true;
        btn.textContent = '제외됨';
        btn.style.opacity = '0.4';
        btn.style.cursor = 'default';
    });
}
document.getElementById('monitorLogList').addEventListener('click', _handleLogBkClick);
document.getElementById('monitorLogListW').addEventListener('click', _handleLogBkClick);

// ===== 로그 패널 =====
var _logFullMode  = false;
var _logFullModeW = false;

// 비거래 처리완료 상태 (Firebase imi_watch_done 동기화)
var _watchDoneSet = {};
db.ref('imi_watch_done').on('value', function(snap) {
    _watchDoneSet = snap.val() || {};
    document.querySelectorAll('[data-logdone]').forEach(function(btn) {
        var tid = btn.getAttribute('data-logdone');
        var info = _watchDoneSet[tid];
        if (info && !btn.disabled) {
            btn.disabled = true;
            var byName = (info && typeof info === 'object') ? (info.by || '') : '';
            btn.textContent = '✅ 처리완료' + (byName ? ' · ' + byName : '');
            btn.style.background = 'none';
            btn.style.border = '1px solid #22c55e';
            btn.style.color = '#22c55e';
            btn.style.opacity = '0.4';
            btn.style.cursor = 'default';
        }
    });
});

function openLogPanel() {
    document.getElementById('logPanel').classList.remove('hidden');
    _logFullMode = false; _logFullModeW = false;
    ['logFullDayBtnWrap','logFullDayBtnWrapW'].forEach(function(wid) {
        var w = document.getElementById(wid);
        if (w) w.style.display = _isBotPrivileged() ? '' : 'none';
    });
    var btn = document.getElementById('logFullDayBtn');
    if (btn) { btn.textContent = '📅 24시간 전체 기록 불러오기'; btn.disabled = false; btn.style.opacity = '1'; btn.onclick = loadFullDayLog; }
    var btnW = document.getElementById('logFullDayBtnW');
    if (btnW) { btnW.textContent = '📅 24시간 전체 기록 불러오기'; btnW.disabled = false; btnW.style.opacity = '1'; btnW.onclick = loadFullDayLogW; }
    switchLogTab(1);
}
function closeLogPanel() {
    document.getElementById('logPanel').classList.add('hidden');
}
function switchLogTab(n) {
    [1,2,3,4,5].forEach(function(i) {
        var t = document.getElementById('logTab'+i);
        var c = document.getElementById('logTabContent'+i);
        if (t) t.classList.toggle('mon-tab-active', i === n);
        if (c) c.style.display = i === n ? '' : 'none';
    });
    if (n === 1) { _logFullMode  = false; loadMonitorLog(false); }
    if (n === 2) { _logFullModeW = false; loadWatchLog(false); }
    if (n === 3) loadBlockedFraud();
    if (n === 4) loadBlockedWatch();
    if (n === 5) loadStatsTab();
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
function loadFullDayLogW() {
    _logFullModeW = true;
    var btn = document.getElementById('logFullDayBtnW');
    if (btn) { btn.textContent = '⏳ 불러오는 중...'; btn.disabled = true; btn.style.opacity = '0.55'; }
    loadWatchLog(true);
}
function loadRecentLogW() {
    _logFullModeW = false;
    var btn = document.getElementById('logFullDayBtnW');
    if (btn) { btn.textContent = '📅 전체 기록 불러오기'; btn.disabled = false; btn.style.opacity = '1'; btn.onclick = loadFullDayLogW; }
    loadWatchLog(false);
}

function loadMonitorLog(fullDay) { _loadLogByType(fullDay, false); }
function loadWatchLog(fullDay)   { _loadLogByType(fullDay, true);  }

function _loadLogByType(fullDay, isWatch) {
    var ids = isWatch ? {
        list: 'monitorLogListW', empty: 'monitorLogEmptyW',
        btn: 'logFullDayBtnW', loadFull: loadFullDayLogW, loadRecent: loadRecentLogW
    } : {
        list: 'monitorLogList', empty: 'monitorLogEmpty',
        btn: 'logFullDayBtn', loadFull: loadFullDayLog, loadRecent: loadRecentLog
    };

    var cutoff24 = Date.now() - 86400000;
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
                if (!e.ruleType) return; // ruleType 없는 구 모니터 엔진 로그 제외
                if (fullDay && e.at < cutoff24) return;
                var entryIsWatch = e.ruleType === 'watch';
                if (isWatch !== entryIsWatch) return;
                entries.push({ key: k, data: e });
            });
            entries.sort(function(a, b) { return b.data.at - a.data.at; });

            var empty = document.getElementById(ids.empty);
            var list  = document.getElementById(ids.list);
            if (!entries.length) {
                if (empty) empty.style.display = '';
                if (list)  list.innerHTML = '';
                var emptyBtn = document.getElementById(ids.btn);
                if (emptyBtn && _isBotPrivileged()) {
                    emptyBtn.disabled = false; emptyBtn.style.opacity = '1';
                    emptyBtn.textContent = fullDay ? '↩ 최근 100건 보기' : '📅 24시간 전체 기록 불러오기';
                    emptyBtn.onclick = fullDay ? ids.loadRecent : ids.loadFull;
                }
                return;
            }
            if (empty) empty.style.display = 'none';

            function _renderEntry(entry) {
                var d = entry.data;
                var timeStr = new Date(d.at).toLocaleTimeString('ko-KR');
                var entryIsWatch = d.ruleType === 'watch';
                var rtTag = entryIsWatch
                    ? '<span style="font-size:8px;font-weight:900;color:#22c55e;border:1px solid #22c55e;border-radius:3px;padding:0 4px;flex-shrink:0;white-space:nowrap;">📦 비거래</span>'
                    : '<span style="font-size:8px;font-weight:900;color:#ef4444;border:1px solid #ef4444;border-radius:3px;padding:0 4px;flex-shrink:0;white-space:nowrap;">🚨 사기글</span>';
                var rows = (d.itemRows || []).map(function(it) {
                    var rawKey = it.key || (it.t || '').substring(0, 30).trim();
                    var bk = _esc(rawKey);
                    var isBlocked = blockedSet[rawKey];
                    var titleAttr = _esc(it.t || '');
                    var tidAttr = _esc(it.tid || '');
                    var listTime = it.listTime || '';
                    var btnHtml = bk
                        ? (isBlocked
                            ? '<button data-logbk="' + bk + '" data-logtitle="' + titleAttr + '" data-logtid="' + tidAttr + '" data-logprice="' + (it.p||0) + '" disabled style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;flex-shrink:0;opacity:0.4;cursor:default;">제외됨</button>'
                            : '<button data-logbk="' + bk + '" data-logtitle="' + titleAttr + '" data-logtid="' + tidAttr + '" data-logprice="' + (it.p||0) + '" style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;cursor:pointer;flex-shrink:0;">필터제외</button>')
                        : '';
                    var doneHtml = '';
                    if (entryIsWatch && it.tid) {
                        var doneInfo = _watchDoneSet[it.tid];
                        var isDone = !!doneInfo;
                        var doneBy = (doneInfo && typeof doneInfo === 'object') ? (doneInfo.by || '') : '';
                        doneHtml = isDone
                            ? '<button data-logdone="' + _esc(it.tid) + '" disabled style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #22c55e;color:#22c55e;background:none;flex-shrink:0;opacity:0.4;cursor:default;">✅ 처리완료' + (doneBy ? ' · ' + _esc(doneBy) : '') + '</button>'
                            : '<button data-logdone="' + _esc(it.tid) + '" style="font-size:10px;padding:2px 7px;border-radius:4px;background:#22c55e;color:#000;border:none;cursor:pointer;font-weight:900;flex-shrink:0;">처리완료</button>';
                    }
                    return '<div style="display:flex;flex-direction:column;gap:2px;padding:7px 10px;background:var(--bg-body);border-radius:7px;border:1px solid var(--border-ui);">'
                        + (it.tid ? '<div style="display:flex;align-items:center;gap:6px;font-size:20px;font-weight:900;color:#38bdf8;letter-spacing:0.03em;">#' + _fmtTid(it.tid)
                            + (listTime ? '<span style="font-size:10px;font-weight:500;color:#64748b;">· ' + listTime + '</span>' : '')
                            + doneHtml
                            + '</div>' : '')
                        + '<div style="display:flex;align-items:center;gap:6px;">'
                        + '<div style="font-size:11px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(it.t || '') + '</div>'
                        + (it.p ? '<div style="font-size:11px;font-weight:900;color:#ef4444;flex-shrink:0;">' + Number(it.p).toLocaleString() + '원</div>' : '')
                        + btnHtml
                        + '</div>'
                        + '</div>';
                }).join('');
                return '<div style="border:1.5px solid var(--border-ui);border-left:3px solid '+(entryIsWatch?'#22c55e':'#ef4444')+';border-radius:11px;padding:11px 14px;margin-bottom:8px;">'
                    + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
                    + '<div style="font-size:12px;font-weight:900;color:var(--active-focus-color);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(d.ruleName || '') + '</div>'
                    + rtTag
                    + '<div style="font-size:10px;font-weight:700;opacity:0.45;flex-shrink:0;">' + timeStr + '</div>'
                    + '<div style="font-size:10px;font-weight:900;color:#ef4444;flex-shrink:0;">' + (d.itemCount || 0) + '개 감지</div>'
                    + '</div>'
                    + (d.ruleKeyword ? '<div style="font-size:10px;color:#64748b;margin-bottom:7px;">🔑 ' + _esc(d.ruleKeyword) + '</div>' : '')
                    + '<div style="display:flex;flex-direction:column;gap:5px;">' + rows + '</div>'
                    + '</div>';
            }

            var html = '';
            if (fullDay) {
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
            } else if (isWatch) {
                // 비거래 기본 모드: 최근 3회 감지
                var displayEntries = entries.slice(0, 3);
                var hiddenW = entries.length - 3;
                html = displayEntries.map(_renderEntry).join('');
                if (hiddenW > 0) {
                    html += '<div style="text-align:center;font-size:11px;opacity:0.45;padding:4px 0;">📅 이전 감지 ' + hiddenW + '회 — 24시간 전체 보기 버튼으로 확인</div>';
                }
            } else {
                // 사기글 기본 모드: 최신순 5회, 감지별 접힘 카드
                var displayEntries = entries.slice(0, 5);
                var hiddenF = entries.length - 5;
                html = displayEntries.map(function(entry, idx) {
                    var d = entry.data;
                    var timeStr = new Date(d.at).toLocaleTimeString('ko-KR');
                    var rows = (d.itemRows || []).map(function(it) {
                        var rawKey = it.key || (it.t || '').substring(0, 30).trim();
                        var bk = _esc(rawKey);
                        var isBlocked = blockedSet[rawKey];
                        var titleAttr = _esc(it.t || '');
                        var tidAttr   = _esc(it.tid || '');
                        var listTime  = it.listTime || '';
                        var btnHtml = bk
                            ? (isBlocked
                                ? '<button data-logbk="'+bk+'" data-logtitle="'+titleAttr+'" data-logtid="'+tidAttr+'" data-logprice="'+(it.p||0)+'" disabled style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;flex-shrink:0;opacity:0.4;cursor:default;">제외됨</button>'
                                : '<button data-logbk="'+bk+'" data-logtitle="'+titleAttr+'" data-logtid="'+tidAttr+'" data-logprice="'+(it.p||0)+'" style="font-size:10px;padding:2px 7px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;cursor:pointer;flex-shrink:0;">필터제외</button>')
                            : '';
                        return '<div style="display:flex;flex-direction:column;gap:2px;padding:7px 10px;background:var(--bg-body);border-radius:7px;border:1px solid var(--border-ui);">'
                            + (it.tid ? '<div style="display:flex;align-items:center;gap:6px;font-size:20px;font-weight:900;color:#38bdf8;letter-spacing:0.03em;">#'+_fmtTid(it.tid)
                                + (listTime ? '<span style="font-size:10px;font-weight:500;color:#64748b;">· '+listTime+'</span>' : '')
                                + '</div>' : '')
                            + '<div style="display:flex;align-items:center;gap:6px;">'
                            + '<div style="font-size:11px;font-weight:700;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(it.t||'')+'</div>'
                            + (it.p ? '<div style="font-size:11px;font-weight:900;color:#ef4444;flex-shrink:0;">'+Number(it.p).toLocaleString()+'원</div>' : '')
                            + btnHtml
                            + '</div></div>';
                    }).join('');
                    return '<details '+(idx===0?'open':'')+' style="border:1.5px solid var(--border-ui);border-left:3px solid #ef4444;border-radius:11px;margin-bottom:8px;overflow:hidden;">'
                        + '<summary style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;user-select:none;list-style:none;background:var(--bg-body);">'
                        + '<span style="font-size:11px;color:#ef4444;flex-shrink:0;">▶</span>'
                        + '<div style="font-size:12px;font-weight:900;color:var(--active-focus-color);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(d.ruleName||'')+'</div>'
                        + (d.ruleKeyword ? '<div style="font-size:10px;color:#64748b;flex-shrink:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">🔑 '+_esc(d.ruleKeyword)+'</div>' : '')
                        + '<div style="font-size:10px;font-weight:700;opacity:0.45;flex-shrink:0;">'+timeStr+'</div>'
                        + '<div style="font-size:10px;font-weight:900;color:#ef4444;flex-shrink:0;">'+(d.itemCount||0)+'개</div>'
                        + '</summary>'
                        + '<div style="padding:8px 12px 10px;display:flex;flex-direction:column;gap:5px;">'+rows+'</div>'
                        + '</details>';
                }).join('');
                if (hiddenF > 0) {
                    html += '<div style="text-align:center;font-size:11px;opacity:0.45;padding:4px 0;">📅 이전 감지 '+hiddenF+'회 — 24시간 전체 보기 버튼으로 확인</div>';
                }
            }

            if (list) list.innerHTML = html;

            var btn = document.getElementById(ids.btn);
            if (btn && _isBotPrivileged()) {
                btn.disabled = false; btn.style.opacity = '1';
                if (fullDay) { btn.textContent = '↩ 최근 100건 보기'; btn.onclick = ids.loadRecent; }
                else { btn.textContent = '📅 24시간 전체 기록 불러오기'; btn.onclick = ids.loadFull; }
            }
        });
    });
}

// ===== 차단 목록 렌더 (type: 'fraud'=사기글, 'watch'=비거래, 없으면 fraud로 간주) =====
function _renderBlockedByType(type, containerId, emptyId) {
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var filtered = list.filter(function(item) {
            var t = typeof item === 'object' ? (item.type || 'fraud') : 'fraud';
            return t === type;
        });
        var container = document.getElementById(containerId);
        var empty     = document.getElementById(emptyId);
        if (!filtered.length) {
            container.innerHTML = '';
            if (empty) empty.style.display = '';
            return;
        }
        if (empty) empty.style.display = 'none';
        container.innerHTML = filtered.slice().reverse().map(function(item) {
            var key     = typeof item === 'object' ? (item.key   || '') : item;
            var title   = typeof item === 'object' ? (item.title || '') : '';
            var tid     = typeof item === 'object' ? (item.tid   || '') : '';
            var price   = typeof item === 'object' ? (item.price || 0) : 0;
            var addedBy = typeof item === 'object' ? (item.addedBy || '') : '';
            var addedAt = typeof item === 'object' && item.addedAt ? new Date(item.addedAt).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
            var subText = tid ? ('#' + tid) : key;
            return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1.5px solid var(--border-ui);border-radius:8px;margin-bottom:6px;">'
                + '<div style="flex:1;min-width:0;">'
                + '<div style="display:flex;align-items:center;gap:6px;">'
                + (title ? '<div style="font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">' + _esc(title) + '</div>' : '')
                + (price ? '<div style="font-size:11px;font-weight:900;color:#ef4444;flex-shrink:0;">' + Number(price).toLocaleString() + '원</div>' : '')
                + '</div>'
                + '<div style="font-size:10px;opacity:0.45;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + _esc(subText) + '</div>'
                + (addedBy ? '<div style="font-size:10px;opacity:0.45;margin-top:2px;">✍️ ' + _esc(addedBy) + (addedAt ? ' · ' + addedAt : '') + '</div>' : '')
                + '</div>'
                + '<button onclick="unblockItem(\'' + _esc(key.replace(/'/g,'\\\'')) + '\')" style="font-size:10px;padding:3px 10px;border-radius:5px;border:1px solid #22c55e;color:#22c55e;background:none;cursor:pointer;font-weight:700;flex-shrink:0;">제외 해제</button>'
                + '</div>';
        }).join('');
    });
}
function loadBlockedFraud() { _renderBlockedByType('fraud', 'blockedItemList',  'blockedEmpty'); }
function loadBlockedWatch() { _renderBlockedByType('watch', 'blockedItemListW', 'blockedEmptyW'); }
function loadBlockedItems() { loadBlockedFraud(); }

// ===== 개별 차단 해제 (key 기반) =====
function unblockItem(key) {
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var newList = list.filter(function(item) {
            var k = typeof item === 'object' ? item.key : item;
            return k !== key;
        });
        db.ref('/imi_blocked').set(newList, function() {
            loadBlockedFraud();
            loadBlockedWatch();
            loadMonitorLog();
        });
    });
}

// ===== 전체 차단 해제 (타입별) =====
function clearAllBlockedFraud() {
    if (!confirm('사기글 필터제외 목록을 전체 삭제하시겠습니까?')) return;
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var newList = list.filter(function(item) {
            var t = typeof item === 'object' ? (item.type || 'fraud') : 'fraud';
            return t !== 'fraud';
        });
        db.ref('/imi_blocked').set(newList, function() { loadBlockedFraud(); loadMonitorLog(); });
    });
}
function clearAllBlockedWatch() {
    if (!confirm('비거래 필터제외 목록을 전체 삭제하시겠습니까?')) return;
    db.ref('/imi_blocked').once('value', function(snap) {
        var list = snap.val() || [];
        if (!Array.isArray(list)) list = [];
        var newList = list.filter(function(item) {
            var t = typeof item === 'object' ? (item.type || 'fraud') : 'fraud';
            return t !== 'watch';
        });
        db.ref('/imi_blocked').set(newList, function() { loadBlockedWatch(); });
    });
}
function clearAllBlocked() { clearAllBlockedFraud(); }

// ===== 감지 통계 =====
var _statsType = 'fraud';

function loadStatsTab() {
    var today = new Date();
    var pad = function(n) { return String(n).padStart(2,'0'); };
    var todayStr = today.getFullYear() + '-' + pad(today.getMonth()+1) + '-' + pad(today.getDate());
    var monthStr = today.getFullYear() + '-' + pad(today.getMonth()+1);
    var dp = document.getElementById('statsDayPicker');
    var mp = document.getElementById('statsMonthPicker');
    if (dp && !dp.value) dp.value = todayStr;
    if (mp && !mp.value) mp.value = monthStr;
    _switchStatsType(_statsType);
}

function _switchStatsType(type) {
    _statsType = type;
    var w = document.getElementById('statsTypeWatch');
    var f = document.getElementById('statsTypeFraud');
    if (w) { w.style.background = type==='watch'?'#22c55e':'none'; w.style.color = type==='watch'?'#000':'#94a3b8'; w.style.border = '1px solid '+(type==='watch'?'#22c55e':'#334155'); }
    if (f) { f.style.background = type==='fraud'?'#ef4444':'none'; f.style.color = type==='fraud'?'#fff':'#94a3b8'; f.style.border = '1px solid '+(type==='fraud'?'#ef4444':'#334155'); }
    _renderStatsForType(type);
}

function _onStatsDateChange()  { _renderStatsForType(_statsType); }
function _onStatsMonthChange() { _renderStatsForType(_statsType); }

function _renderStatsForType(type) {
    var dp = document.getElementById('statsDayPicker');
    var mp = document.getElementById('statsMonthPicker');
    var dateStr  = dp ? dp.value : '';
    var monthStr = mp ? mp.value : '';
    var dc = document.getElementById('statsDayChart');
    var mc = document.getElementById('statsMonthChart');
    if (dc) dc.innerHTML = '<div style="text-align:center;padding:20px 0;font-size:11px;opacity:0.4;">불러오는 중...</div>';
    if (mc) mc.innerHTML = '';
    if (type === 'watch') _loadWatchStats(dateStr, monthStr);
    else _loadFraudStats(dateStr, monthStr);
}

// 비거래 통계 — imi_watch_alerts(오늘) + imi_watch_stats(과거), TID 중복제거
function _loadWatchStats(dateStr, monthStr) {
    var pad = function(n) { return String(n).padStart(2,'0'); };
    db.ref('imi_watch_alerts').limitToLast(100).once('value', function(alertsSnap) {
        var alerts = alertsSnap.val() || {};
        // dateStr+hour별 첫 감지 시각 기준으로 TID 배정 (중복 제거)
        var tidFirstSeen = {}; // tid → { dStr, hStr, at }
        Object.values(alerts).forEach(function(val) {
            if (!val || !val.at) return;
            var d = new Date(val.at);
            var dStr = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate());
            var hStr = pad(d.getHours());
            (val.tids || []).forEach(function(tid) {
                if (!tid) return;
                if (!tidFirstSeen[tid] || val.at < tidFirstSeen[tid].at) {
                    tidFirstSeen[tid] = { dStr: dStr, hStr: hStr, at: val.at };
                }
            });
        });
        // 시간대별 카운트 (선택 날짜)
        var hourCounts = {};
        // 월별 일별 카운트
        var monthDayCounts = {};
        Object.values(tidFirstSeen).forEach(function(info) {
            if (info.dStr === dateStr) hourCounts[info.hStr] = (hourCounts[info.hStr] || 0) + 1;
            if (info.dStr.startsWith(monthStr)) {
                var day = info.dStr.split('-')[2];
                monthDayCounts[day] = (monthDayCounts[day] || 0) + 1;
            }
        });
        // 과거 데이터(imi_watch_stats) 보완 — 오늘 데이터 없는 날에 한해 사용
        db.ref('/imi_watch_stats').once('value', function(statsSnap) {
            var allStats = statsSnap.val() || {};
            // 선택 날짜가 과거인 경우 imi_watch_stats 사용
            var histDay = allStats[dateStr] || {};
            if (Object.keys(hourCounts).length === 0) {
                Object.keys(histDay).forEach(function(hStr) { hourCounts[hStr] = histDay[hStr].total || 0; });
            }
            // 월별: imi_watch_stats에서 아직 없는 날 보완
            Object.keys(allStats).forEach(function(dStr) {
                if (!dStr.startsWith(monthStr)) return;
                var day = dStr.split('-')[2];
                if (!monthDayCounts[day]) {
                    var t = 0;
                    Object.values(allStats[dStr]).forEach(function(h) { t += (h.total || 0); });
                    monthDayCounts[day] = t;
                }
            });
            _renderBarChart('statsDayChart', hourCounts, '#22c55e');
            _renderLineChart('statsMonthChart', monthDayCounts, '#22c55e');
        });
    });
}

// 사기글 통계 — imi_fraud_stats (미리 집계된 데이터)
function _loadFraudStats(dateStr, monthStr) {
    db.ref('/imi_fraud_stats').once('value', function(statsSnap) {
        var allStats = statsSnap.val() || {};
        var hourCounts = allStats[dateStr] || {};
        var monthDayCounts = {};
        Object.keys(allStats).forEach(function(dStr) {
            if (!dStr.startsWith(monthStr)) return;
            var day = dStr.split('-')[2];
            var t = 0;
            Object.values(allStats[dStr]).forEach(function(v) { t += (v || 0); });
            monthDayCounts[day] = t;
        });
        _renderBarChart('statsDayChart', hourCounts, '#ef4444');
        _renderLineChart('statsMonthChart', monthDayCounts, '#ef4444');
    });
}

// 막대 그래프 (시간대별 단색, 툴팁 포함)
function _renderBarChart(containerId, hourCounts, barColor) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var maxVal = 0;
    for (var h=0; h<24; h++) { var v=hourCounts[String(h).padStart(2,'0')]||0; if(v>maxVal) maxVal=v; }
    if (maxVal === 0) { container.innerHTML='<div style="text-align:center;padding:24px 0;font-size:11px;opacity:0.35;">해당 날짜 감지 기록 없음</div>'; return; }
    var W=340,H=130,pL=24,pB=16,pT=6,pR=4,cW=W-pL-pR,cH=H-pB-pT,slotW=cW/24,barW=slotW*0.65;
    var svg='<svg width="100%" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" style="display:block;">';
    [0.25,0.5,0.75,1].forEach(function(r){
        var y=pT+cH*(1-r);
        svg+='<line x1="'+pL+'" y1="'+y.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+y.toFixed(1)+'" stroke="#1e293b" stroke-width="1"/>';
        svg+='<text x="'+(pL-2)+'" y="'+(y+3).toFixed(1)+'" text-anchor="end" font-size="7" fill="#475569">'+Math.round(maxVal*r)+'</text>';
    });
    svg+='<line x1="'+pL+'" y1="'+(pT+cH)+'" x2="'+(W-pR)+'" y2="'+(pT+cH)+'" stroke="#334155" stroke-width="1"/>';
    for (var h=0; h<24; h++){
        var hStr=String(h).padStart(2,'0'), v=hourCounts[hStr]||0;
        var x=pL+slotW*h+(slotW-barW)/2;
        if (v>0) {
            var bH=(v/maxVal)*cH;
            svg+='<rect x="'+x.toFixed(1)+'" y="'+(pT+cH-bH).toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+bH.toFixed(1)+'" fill="'+barColor+'" rx="1.5"/>';
        }
        // 투명 호버 영역 (data-tip 속성으로 툴팁)
        svg+='<rect x="'+(pL+slotW*h).toFixed(1)+'" y="'+pT+'" width="'+slotW.toFixed(1)+'" height="'+cH+'" fill="transparent" data-tip="'+h+'시  '+v+'건"/>';
        if(h%3===0) svg+='<text x="'+(x+barW/2).toFixed(1)+'" y="'+(H-3)+'" text-anchor="middle" font-size="7" fill="#475569">'+h+'</text>';
    }
    svg+='</svg>';
    container.innerHTML=svg;
    _attachChartTip(container);
}

// 꺾은선 그래프 (월별 일별, 툴팁 포함)
function _renderLineChart(containerId, dailyCounts, lineColor) {
    var container=document.getElementById(containerId);
    if(!container) return;
    if(!lineColor) lineColor='#60a5fa';
    var maxVal=0;
    for(var d=1;d<=31;d++){var v=dailyCounts[String(d).padStart(2,'0')]||0;if(v>maxVal)maxVal=v;}
    if(maxVal===0){container.innerHTML='<div style="text-align:center;padding:20px 0;font-size:11px;opacity:0.35;">해당 월 감지 기록 없음</div>';return;}
    var W=340,H=100,pL=24,pB=14,pT=6,pR=4,cW=W-pL-pR,cH=H-pB-pT,xStep=cW/30;
    var svg='<svg width="100%" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" style="display:block;">';
    [0.5,1].forEach(function(r){
        var y=pT+cH*(1-r);
        svg+='<line x1="'+pL+'" y1="'+y.toFixed(1)+'" x2="'+(W-pR)+'" y2="'+y.toFixed(1)+'" stroke="#1e293b" stroke-width="1"/>';
        svg+='<text x="'+(pL-2)+'" y="'+(y+3).toFixed(1)+'" text-anchor="end" font-size="7" fill="#475569">'+Math.round(maxVal*r)+'</text>';
    });
    svg+='<line x1="'+pL+'" y1="'+(pT+cH)+'" x2="'+(W-pR)+'" y2="'+(pT+cH)+'" stroke="#334155" stroke-width="1"/>';
    var points=[];
    for(var d=1;d<=31;d++){
        var v=dailyCounts[String(d).padStart(2,'0')]||0;
        points.push({x:(pL+(d-1)*xStep),y:(pT+cH-(v/maxVal)*cH),v:v,d:d});
    }
    var pathD=points.map(function(p,i){return(i===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ');
    svg+='<path d="'+pathD+' L'+points[30].x.toFixed(1)+','+(pT+cH)+' L'+points[0].x.toFixed(1)+','+(pT+cH)+' Z" fill="'+lineColor+'" fill-opacity="0.08"/>';
    svg+='<path d="'+pathD+'" fill="none" stroke="'+lineColor+'" stroke-width="1.5" stroke-linejoin="round"/>';
    points.forEach(function(p){
        if(p.v>0) svg+='<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="2.5" fill="'+lineColor+'"/>';
        // 투명 호버 영역
        svg+='<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="8" fill="transparent" data-tip="'+p.d+'일  '+p.v+'건"/>';
    });
    [1,5,10,15,20,25,31].forEach(function(d){var p=points[d-1];svg+='<text x="'+p.x.toFixed(1)+'" y="'+(H-2)+'" text-anchor="middle" font-size="7" fill="#475569">'+d+'</text>';});
    svg+='</svg>';
    container.innerHTML=svg;
    _attachChartTip(container);
}

// 툴팁 이벤트 연결
function _attachChartTip(container) {
    container.addEventListener('mousemove', function(e) {
        var tip = e.target.getAttribute('data-tip');
        if (tip) _showChartTip(e, tip);
        else _hideChartTip();
    });
    container.addEventListener('mouseleave', _hideChartTip);
}
function _showChartTip(evt, text) {
    var tip = document.getElementById('_statsTip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = '_statsTip';
        tip.style.cssText = 'position:fixed;background:#0f172a;border:1px solid #334155;color:#e2e8f0;font-size:10px;font-weight:700;padding:4px 10px;border-radius:5px;pointer-events:none;z-index:9999;white-space:nowrap;';
        document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.style.display = '';
    tip.style.left = (evt.clientX + 10) + 'px';
    tip.style.top = (evt.clientY - 32) + 'px';
}
function _hideChartTip() {
    var tip = document.getElementById('_statsTip');
    if (tip) tip.style.display = 'none';
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
    _renderWatchRules();
});

function _renderBotRuleList() {
    var list = document.getElementById('botRuleList');
    if (!list) return;
    if (!_botRules.length) {
        list.innerHTML = '<div style="text-align:center;padding:20px 0;opacity:0.35;font-size:12px;">등록된 봇 규칙이 없습니다</div>';
        return;
    }
    var canEdit = _isBotPrivileged();
    var fraudRules = _botRules.filter(function(r) { return r.type !== 'watch'; });
    if (!fraudRules.length) {
        list.innerHTML = '<div style="text-align:center;padding:20px 0;opacity:0.35;font-size:12px;">등록된 사기글 규칙이 없습니다</div>';
        return;
    }
    list.innerHTML = fraudRules.map(function(r) {
        var runStatus = (_botStatus && _botStatus.rules) ? _botStatus.rules.find(function(sr){ return sr.id === r.id; }) : null;
        var isRunning = !!(runStatus && runStatus.tabOpen);
        var runColor  = isRunning ? '#22c55e' : '#94a3b8';
        var runLabel  = isRunning ? '● 감시중' : '■ 대기';
        var typeTag = r.type === 'watch'
            ? '<span style="font-size:9px;font-weight:900;color:#22c55e;border:1px solid #22c55e;border-radius:4px;padding:1px 5px;flex-shrink:0;">📦 비거래</span>'
            : '<span style="font-size:9px;font-weight:900;color:#ef4444;border:1px solid #ef4444;border-radius:4px;padding:1px 5px;flex-shrink:0;">🚨 사기글</span>';
        return '<div style="border:1.5px solid var(--border-ui);border-radius:10px;padding:10px 13px;margin-bottom:6px;background:var(--bg-body);">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
            + '<div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'
            + '<span style="font-size:12px;font-weight:900;">' + _esc(r.name) + '</span>'
            + '</div>'
            + typeTag
            + '<span style="font-size:10px;font-weight:900;color:'+runColor+';flex-shrink:0;">'+runLabel+'</span>'
            + (canEdit ? '<button onclick="startEditBotRule(\''+_esc(r.id)+'\')" style="font-size:10px;padding:2px 7px;border-radius:5px;border:1.5px solid #f59e0b;color:#f59e0b;background:none;cursor:pointer;flex-shrink:0;">수정</button>' : '')
            + (canEdit ? '<button onclick="deleteBotRule(\''+_esc(r.id)+'\')" style="font-size:10px;padding:2px 7px;border-radius:5px;border:1.5px solid #ef4444;color:#ef4444;background:none;cursor:pointer;flex-shrink:0;">삭제</button>' : '')
            + '</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;">'
            + (r.keyword        ? '<span class="mon-tag">🔑 ' + _esc(r.keyword) + '</span>' : '')
            + (r.subKeyword     ? '<span class="mon-tag" style="color:#7dd3fc;border-color:#0284c7;">🔗 AND: ' + _esc(r.subKeyword) + '</span>' : '')
            + (r.minPrice       ? '<span class="mon-tag">💰 ' + Number(r.minPrice).toLocaleString() + '원↑</span>' : '')
            + (r.maxPrice       ? '<span class="mon-tag">💰 ' + Number(r.maxPrice).toLocaleString() + '원↓</span>' : '')
            + '<span class="mon-tag">⏱ ' + (r.scanInterval || 5) + '초</span>'
            + (r.excludeKeyword ? '<span class="mon-tag">🚫 ' + _esc(r.excludeKeyword) + '</span>' : '')
            + (r.photoMinPrice   ? '<span class="mon-tag">📸 ' + Number(r.photoMinPrice).toLocaleString() + '원↑</span>' : '')
            + (r.noPhotoMinPrice ? '<span class="mon-tag">📝 ' + Number(r.noPhotoMinPrice).toLocaleString() + '원↑</span>' : '')
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
    document.getElementById('brSubKw').value    = r.subKeyword || '';
    document.getElementById('brMin').value      = r.minPrice || '';
    document.getElementById('brMax').value      = r.maxPrice || '';
    document.getElementById('brInterval').value = r.scanInterval || 300;
    document.getElementById('brExclude').value  = r.excludeKeyword || '';
    document.getElementById('brPhotoMinPrice').value   = r.photoMinPrice   || '';
    document.getElementById('brNoPhotoMinPrice').value = r.noPhotoMinPrice || '';
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
    ['brName','brUrl','brKw','brSubKw','brMin','brMax','brExclude','brPhotoMinPrice','brNoPhotoMinPrice'].forEach(function(id) {
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
    var keyword        = (document.getElementById('brKw').value     || '').trim();
    var subKeyword     = (document.getElementById('brSubKw').value  || '').trim();
    var minPrice       = parseInt(document.getElementById('brMin').value)      || 0;
    var maxPrice       = parseInt(document.getElementById('brMax').value)      || 0;
    var scanInterval   = parseInt(document.getElementById('brInterval').value) || 300;
    var excludeKeyword  = (document.getElementById('brExclude').value || '').trim();
    var photoMinPrice   = parseInt(document.getElementById('brPhotoMinPrice').value)   || 0;
    var noPhotoMinPrice = parseInt(document.getElementById('brNoPhotoMinPrice').value) || 0;
    var typeEl          = document.querySelector('input[name="brType"]:checked');
    var ruleType       = typeEl ? typeEl.value : 'fraud';

    if (!name) { alert('규칙 이름을 입력하세요.'); return; }
    if (!url || !/^https?:\/\//.test(url)) { alert('올바른 URL을 입력하세요. (https://...)'); return; }
    if (!keyword && !minPrice) { alert('키워드 또는 최소가격 중 하나는 필요합니다.'); return; }

    if (_botRuleEditingId) {
        _saveBotRules(_botRules.map(function(r) {
            return r.id === _botRuleEditingId
                ? Object.assign({}, r, { name: name, url: url, keyword: keyword, subKeyword: subKeyword, minPrice: minPrice, maxPrice: maxPrice, scanInterval: scanInterval, excludeKeyword: excludeKeyword, photoMinPrice: photoMinPrice, noPhotoMinPrice: noPhotoMinPrice, photoOnly: false, noPhotoOnly: false, type: ruleType })
                : r;
        }));
        _cancelBotRuleEdit();
        alert('✅ 규칙이 수정됐습니다: ' + name + '\n1분 내로 봇에 자동 반영됩니다.');
    } else {
        var newRule = {
            id: 'r_' + Date.now(),
            name: name, url: url, keyword: keyword, subKeyword: subKeyword,
            minPrice: minPrice, maxPrice: maxPrice,
            scanInterval: scanInterval, excludeKeyword: excludeKeyword,
            photoMinPrice: photoMinPrice, noPhotoMinPrice: noPhotoMinPrice, type: ruleType, enabled: true, createdAt: Date.now()
        };
        _saveBotRules(_botRules.concat([newRule]));
        ['brName','brUrl','brKw','brSubKw','brMin','brMax','brExclude'].forEach(function(id) {
            document.getElementById(id).value = '';
        });
        document.getElementById('brInterval').value = '300';
        var fraudEl = document.getElementById('brTypeFraud'); if (fraudEl) fraudEl.checked = true;
        alert('✅ 규칙이 등록됐습니다: ' + name + '\n1분 내로 봇에 자동 반영됩니다.');
    }
}

// ===== 거래번호 감시 (watched_tids) =====
var _watchedTids = {};
var _watchEditingKey = null;

db.ref('/watched_tids').on('value', function(snap) {
    _watchedTids = snap.val() || {};
    _renderWatchedTids();
    // watched_tids에 없는 고아 배너 즉시 정리
    db.ref('/imi_watch_banner').once('value', function(bSnap) {
        var banners = bSnap.val() || {};
        Object.keys(banners).forEach(function(bKey) {
            if (!_watchedTids[bKey]) db.ref('/imi_watch_banner/' + bKey).set(null);
        });
    });
});

function addWatchedTid() {
    var tid   = (document.getElementById('wtTid').value   || '').trim().replace(/\s/g, '');
    var label = (document.getElementById('wtLabel').value || '').trim();
    if (!tid || !/^\d+$/.test(tid)) { alert('거래번호는 숫자만 입력하세요.'); return; }

    if (_watchEditingKey) {
        db.ref('/watched_tids/' + _watchEditingKey).update({ tid: tid, label: label, alertSent: false }, function(err) {
            if (err) { alert('수정 실패: ' + err.message); return; }
            _cancelWatchEdit();
            alert('✅ 수정됐습니다.');
        });
        return;
    }

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
        alert('✅ 거래번호 ' + tid + ' 감시 등록됐습니다.');
    });
}

function startEditWatchedTid(key) {
    var v = _watchedTids[key];
    if (!v) return;
    _watchEditingKey = key;
    document.getElementById('wtTid').value   = v.tid   || '';
    document.getElementById('wtLabel').value = v.label || '';
    document.getElementById('wtAddBtn').textContent    = '✏️ 수정 완료';
    document.getElementById('wtAddBtn').style.background = '#f59e0b';
    document.getElementById('wtFormTitle').textContent = '✏️ 수정 중';
    document.getElementById('wtCancelBtn').style.display = '';
    document.getElementById('wtTid').focus();
}

function _cancelWatchEdit() {
    _watchEditingKey = null;
    document.getElementById('wtTid').value   = '';
    document.getElementById('wtLabel').value = '';
    document.getElementById('wtAddBtn').textContent    = '🔍 감시 등록';
    document.getElementById('wtAddBtn').style.background = '#22c55e';
    document.getElementById('wtFormTitle').textContent = '➕ 감시 등록';
    document.getElementById('wtCancelBtn').style.display = 'none';
}

function deleteWatchedTid(key, tid) {
    if (!confirm('"' + tid + '" 감시를 삭제하시겠습니까?')) return;
    db.ref('/watched_tids/' + key).set(null, function(err) {
        if (err) { alert('삭제 실패: ' + err.message); return; }
        // 배너도 같이 제거
        db.ref('/imi_watch_banner/' + key).set(null);
        if (_watchEditingKey === key) _cancelWatchEdit();
    });
}

function _loadWatchInterval() {
    db.ref('/tid_watch_interval').once('value', function(snap) {
        var v = snap.val();
        var el = document.getElementById('wtInterval');
        // 구형 데이터(분)를 초로 자동 변환: 값이 120 이하면 분 단위 레거시
        if (el && v) el.value = (v <= 120 ? v * 60 : v);
    });
}

function saveWatchInterval() {
    var el = document.getElementById('wtInterval');
    var v = parseInt(el ? el.value : '') || 1200;
    if (v < 60) v = 60;
    if (v > 3600) v = 3600;
    el.value = v;
    db.ref('/tid_watch_interval').set(v, function(err) {
        if (err) { alert('저장 실패: ' + err.message); return; }
        var min = Math.floor(v/60), sec = v%60;
        var label = min > 0 ? min + '분' + (sec > 0 ? ' ' + sec + '초' : '') : sec + '초';
        alert('✅ 체크 간격이 ' + label + '으로 저장됐습니다.\n다음 체크 주기부터 적용됩니다.');
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
            + '<button onclick="startEditWatchedTid(\'' + _esc(k) + '\')" style="font-size:10px;padding:2px 7px;border-radius:5px;border:1.5px solid #f59e0b;color:#f59e0b;background:none;cursor:pointer;flex-shrink:0;">수정</button>'
            + '<button onclick="deleteWatchedTid(\'' + _esc(k) + '\',\'' + tid + '\')" style="font-size:10px;padding:2px 7px;border-radius:5px;border:1.5px solid #ef4444;color:#ef4444;background:none;cursor:pointer;flex-shrink:0;">삭제</button>'
            + '</div>'
            + (addedAt ? '<div style="font-size:9.5px;opacity:0.3;margin-top:3px;">' + (v.addedBy ? v.addedBy + ' · ' : '') + addedAt + '</div>' : '')
            + '</div>';
    }).join('');
}

// ===== 비거래 스캔 규칙 (type:'watch' in /imi_rules) =====
var _wsrEditingKey = null;

function _renderWatchRules() {
    var list = document.getElementById('watchScanRuleList');
    if (!list) return;
    var watchRules = _botRules.filter(function(r) { return r.type === 'watch'; });
    if (!watchRules.length) {
        list.innerHTML = '<div style="text-align:center;padding:20px 0;opacity:0.35;font-size:12px;">등록된 비거래 규칙이 없습니다</div>';
        return;
    }
    var canEdit = _isBotPrivileged();
    list.innerHTML = watchRules.map(function(r) {
        var enabled = r.enabled !== false;
        var runStatus = (_botStatus && _botStatus.rules) ? _botStatus.rules.find(function(sr){ return sr.id === r.id; }) : null;
        var tabOpen = !!(runStatus && runStatus.tabOpen);
        var runColor = (enabled && tabOpen) ? '#22c55e' : (enabled ? '#f59e0b' : '#94a3b8');
        var runLabel = (enabled && tabOpen) ? '● 감시중' : (enabled ? '○ 대기' : '■ 비활성');
        return '<div style="border:1.5px solid var(--border-ui);border-left:3px solid #22c55e;border-radius:10px;padding:10px 13px;margin-bottom:6px;background:var(--bg-body);">'
            + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">'
            + '<div style="flex:1;min-width:0;">'
            + '<span style="font-size:12px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block;">'+_esc(r.name||'(이름없음)')+'</span>'
            + '</div>'
            + '<span style="font-size:9px;font-weight:900;color:#22c55e;border:1px solid #22c55e;border-radius:4px;padding:1px 5px;flex-shrink:0;">📦 비거래</span>'
            + '<span style="font-size:10px;font-weight:900;color:'+runColor+';flex-shrink:0;">'+runLabel+'</span>'
            + (canEdit?'<button id="wsrtest_'+_esc(r.id)+'" onclick="_testWsrRule(\''+_esc(r.id)+'\')" style="font-size:10px;padding:2px 7px;border-radius:5px;border:1.5px solid var(--active-focus-color);color:var(--active-focus-color);background:none;cursor:pointer;flex-shrink:0;">🔍 테스트</button>':'')
            + (canEdit?'<button onclick="_editWsrRule(\''+_esc(r.id)+'\')" style="font-size:10px;padding:2px 7px;border-radius:5px;border:1.5px solid #f59e0b;color:#f59e0b;background:none;cursor:pointer;flex-shrink:0;">수정</button>':'')
            + (canEdit?'<button onclick="_deleteWsrRule(\''+_esc(r.id)+'\')" style="font-size:10px;padding:2px 7px;border-radius:5px;border:1.5px solid #ef4444;color:#ef4444;background:none;cursor:pointer;flex-shrink:0;">삭제</button>':'')
            + '</div>'
            + '<div style="display:flex;flex-wrap:wrap;gap:4px;">'
            + (r.keyword?'<span class="mon-tag">🔑 '+_esc(r.keyword)+'</span>':'')
            + (r.excludeKeyword?'<span class="mon-tag" style="color:#f87171;">🚫 '+_esc(r.excludeKeyword)+'</span>':'')
            + '<span class="mon-tag">⏱ '+(r.scanInterval||300)+'초</span>'
            + (enabled
                ? '<button onclick="toggleBotRuleEnabled(\''+_esc(r.id)+'\',false)" style="font-size:9px;padding:1px 7px;border-radius:4px;border:1px solid #94a3b8;color:#94a3b8;background:none;cursor:pointer;">정지</button>'
                : '<button onclick="toggleBotRuleEnabled(\''+_esc(r.id)+'\',true)" style="font-size:9px;padding:1px 7px;border-radius:4px;border:1px solid #22c55e;color:#22c55e;background:none;cursor:pointer;">시작</button>')
            + '</div>'
            + '<div style="font-size:9.5px;opacity:0.25;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+_esc(r.url||'')+'</div>'
            + '</div>';
    }).join('');
}

async function _testWsrRule(id) {
    var v = _botRules.find(function(r){ return r.id === id; }); if (!v) return;
    var btn = document.getElementById('wsrtest_' + id);
    if (btn) { btn.textContent = '⏳...'; btn.disabled = true; }
    try {
        var html = await _fetchViaProxy(v.url);
        var allItems = _parseItemmaniaHtml(html, '', 0, v.url);
        var matchItems = _parseItemmaniaHtml(html, v.keyword || '', 0, v.url);
        var exKws = (v.excludeKeyword || '').split(',').map(function(k){ return k.trim().toLowerCase(); }).filter(Boolean);
        if (exKws.length) {
            matchItems = matchItems.filter(function(it) {
                var tl = (it.title || '').toLowerCase();
                return !exKws.some(function(k){ return tl.includes(k); });
            });
        }
        var msg = '🔍 비거래 스캔 테스트 — ' + v.name + '\n─────────────────────\n';
        msg += '📄 파싱된 물품: ' + allItems.length + '개\n';
        msg += '✅ 키워드 일치: ' + matchItems.length + '개\n\n';
        if (allItems.length === 0) {
            msg += '⚠️ 물품을 하나도 파싱하지 못했습니다.\n→ URL이 목록 페이지인지, CORS 확장이 켜져 있는지 확인하세요.';
        } else if (matchItems.length === 0) {
            msg += '⚠️ 키워드 "' + (v.keyword || '') + '"에 맞는 물품 없음\n\n';
            msg += '[ 파싱된 물품 예시 ]\n';
            allItems.slice(0, 3).forEach(function(it, i) { msg += (i + 1) + '. ' + it.title + '\n'; });
        } else {
            msg += '[ 감지된 물품 ]\n';
            matchItems.slice(0, 5).forEach(function(it, i) { msg += (i + 1) + '. ' + it.title + '\n'; });
        }
        alert(msg);
    } catch(e) {
        alert('❌ ' + e.message);
    } finally {
        if (btn) { btn.textContent = '🔍 테스트'; btn.disabled = false; }
    }
}

function addWatchScanRule() {
    if (!_isBotPrivileged()) { alert('관리자 또는 부관리자만 관리할 수 있습니다.'); return; }
    var name           = (document.getElementById('wsrName').value||'').trim();
    var url            = (document.getElementById('wsrUrl').value||'').trim();
    var keyword        = (document.getElementById('wsrKw').value||'').trim();
    var excludeKeyword = (document.getElementById('wsrExclude').value||'').trim();
    var interval       = parseInt(document.getElementById('wsrInterval').value)||300;
    if (!name) { alert('규칙 이름을 입력하세요.'); return; }
    if (!url || !/^https?:\/\//.test(url)) { alert('올바른 URL을 입력하세요.'); return; }
    if (!keyword) { alert('감지 키워드를 입력하세요.'); return; }
    if (interval < 10) interval = 10;

    if (_wsrEditingKey) {
        _saveBotRules(_botRules.map(function(r) {
            return r.id === _wsrEditingKey
                ? Object.assign({}, r, { name:name, url:url, keyword:keyword, excludeKeyword:excludeKeyword, scanInterval:interval })
                : r;
        }));
        _cancelWsrEdit();
        alert('✅ 수정됐습니다.');
        return;
    }
    var addedBy = (typeof _currentUser !== 'undefined' && _currentUser) ? (_currentUser.name||'') : '';
    var newRule = {
        id: 'r_' + Date.now(),
        name:name, url:url, keyword:keyword, excludeKeyword:excludeKeyword,
        scanInterval:interval, enabled:true, type:'watch',
        addedBy:addedBy, createdAt:Date.now()
    };
    _saveBotRules(_botRules.concat([newRule]));
    ['wsrName','wsrUrl','wsrKw','wsrExclude'].forEach(function(id){ document.getElementById(id).value=''; });
    document.getElementById('wsrInterval').value='300';
    alert('✅ 비거래 감지 규칙 등록됐습니다: '+name);
}

function _cancelWsrEdit() {
    _wsrEditingKey = null;
    ['wsrName','wsrUrl','wsrKw','wsrExclude'].forEach(function(id){ document.getElementById(id).value=''; });
    document.getElementById('wsrInterval').value='300';
    document.getElementById('wsrAddBtn').textContent='✅ 규칙 등록';
    document.getElementById('wsrAddBtn').style.background='#22c55e';
    document.getElementById('wsrFormTitle').textContent='➕ 새 비거래 규칙 추가';
    document.getElementById('wsrCancelBtn').style.display='none';
}

function _editWsrRule(id) {
    var r = _botRules.find(function(r) { return r.id === id; }); if (!r) return;
    _wsrEditingKey = id;
    document.getElementById('wsrName').value     = r.name            || '';
    document.getElementById('wsrUrl').value      = r.url             || '';
    document.getElementById('wsrKw').value       = r.keyword         || '';
    document.getElementById('wsrExclude').value  = r.excludeKeyword  || '';
    document.getElementById('wsrInterval').value = r.scanInterval    || 300;
    document.getElementById('wsrAddBtn').textContent = '✏️ 수정 완료';
    document.getElementById('wsrAddBtn').style.background = '#f59e0b';
    document.getElementById('wsrFormTitle').textContent = '✏️ 수정 중';
    document.getElementById('wsrCancelBtn').style.display = '';
    document.getElementById('wsrFormWrap').style.display = '';
    document.getElementById('wsrName').focus();
}

function _deleteWsrRule(id) {
    var r = _botRules.find(function(r) { return r.id === id; }); if (!r) return;
    if (!confirm('"'+(r.name||id)+'" 규칙을 삭제하시겠습니까?')) return;
    _saveBotRules(_botRules.filter(function(r) { return r.id !== id; }));
}