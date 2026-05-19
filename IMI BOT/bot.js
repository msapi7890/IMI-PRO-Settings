(function () {
    'use strict';
    if (window.top !== window.self) return;
    if (window._imiBotLoaded) return;
    if (location.pathname.includes('application.html')) return;
    window._imiBotLoaded = true;

    let rule = null;
    let isRunning = false;
    let blockedItems = new Set();

    // --- 메시지 핸들러 ---
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg.type === 'STOP_BOT') {
            isRunning = false;
            sessionStorage.removeItem('_imi_page2_scan');
            setStatus('⏹ 정지됨', '#94a3b8');
            sendResponse({ ok: true });
            return true;
        }
        // alert_popup에서 요청: 현재 페이지 DOM 요소 직접 클릭
        if (msg.type === 'CLICK_ITEM_URL') {
            const clicked = clickItemByUrl(msg.url);
            sendResponse({ ok: clicked });
            return true;
        }
    });

    chrome.runtime.sendMessage({ type: 'GET_MY_RULE' }, res => {
        rule = (res && res.rule) ? res.rule : null;
        if (!rule || res.botStopped) return;
        chrome.runtime.sendMessage({ type: 'GET_BLOCKED' }, bRes => {
            blockedItems = new Set(bRes && bRes.blocked ? bRes.blocked : []);
            initUI();
            if (rule.enabled) { isRunning = true; setTimeout(doCheck, 1500); }
        });
    });

    // --- UI ---
    function initUI() {
        if (document.getElementById('_imi_box')) return;
        const box = document.createElement('div');
        box.id = '_imi_box';
        box.style.cssText = [
            'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483647',
            'background:#1e293b', 'border:3px solid #3abff8', 'padding:12px 14px',
            'border-radius:10px', 'color:#fff', 'width:250px',
            'box-shadow:0 8px 24px rgba(0,0,0,0.6)', 'font-family:sans-serif', 'font-size:12px'
        ].join(';');
        box.innerHTML = `
            <div style="font-weight:900;font-size:13px;color:#3abff8;margin-bottom:6px;">🤖 ${_e(rule.name)}</div>
            <div style="opacity:0.55;font-size:10px;margin-bottom:4px;">
                🔑 ${_e(rule.keyword || '(키워드 없음)')}
                ${rule.minPrice ? ' / 💰' + Number(rule.minPrice).toLocaleString() + '원↑' : ''}
                ${rule.scanInterval ? ' / ⏱' + rule.scanInterval + '초' : ''}
            </div>
            <div id="_imi_status" style="font-size:11px;font-weight:700;color:#94a3b8;margin-top:6px;">준비 중...</div>
            <div id="_imi_items" style="max-height:120px;overflow-y:auto;margin-top:5px;"></div>`;
        document.body.appendChild(box);
    }

    function setStatus(text, color) {
        const el = document.getElementById('_imi_status');
        if (el) { el.textContent = text; el.style.color = color || '#94a3b8'; }
    }

    // --- 물품 차단 ---
    function blockItem(key) {
        blockedItems.add(key);
        chrome.runtime.sendMessage({ type: 'BLOCK_ITEM', key });
    }

    // --- DOM 요소 직접 클릭 (itemmania 세션 유지) ---
    function clickItemByUrl(url) {
        const tidMatch = url.match(/[?&]tid=(\d+)/);
        if (tidMatch) {
            const el = document.querySelector('li[data-tid="' + tidMatch[1] + '"]');
            if (el) { (el.querySelector('a') || el).click(); return true; }
        }
        const idMatch = url.match(/[?&]id=(\d+)/);
        if (idMatch) {
            let el = document.querySelector('[data-id="' + idMatch[1] + '"]') ||
                     document.querySelector('[data-no="' + idMatch[1] + '"]');
            if (!el) {
                document.querySelectorAll('[onclick]').forEach(e => {
                    if (!el && (e.getAttribute('onclick') || '').includes(idMatch[1])) el = e;
                });
            }
            if (el) { (el.querySelector('a') || el).click(); return true; }
        }
        return false;
    }

    function clickItemDirectly(it) {
        // 1순위: 저장된 DOM 참조 (페이지 새로고침 전)
        if (it._el && document.contains(it._el)) {
            const a = it._el.querySelector('a[href*="application"]') || it._el.querySelector('a') || it._el;
            a.click();
            return;
        }
        // 2순위: URL로 DOM 탐색
        if (it.u && clickItemByUrl(it.u)) return;
        // 3순위: background 경유 탭 이동 (페이지 이미 새로고침된 경우)
        if (it.u) chrome.runtime.sendMessage({ type: 'OPEN_ITEM_IN_TAB', url: it.u, ruleId: rule.id });
    }

    function renderAlertItems(items) {
        const container = document.getElementById('_imi_items');
        if (!container) return;
        container.innerHTML = '';
        items.slice(0, 5).forEach(it => {
            const row = document.createElement('div');
            row.dataset.key = it.key;
            row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid #334155;';

            const titleDiv = document.createElement('div');
            titleDiv.style.cssText = 'flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

            if (it.u) {
                const span = document.createElement('span');
                span.textContent = it.t + ' ↗';
                span.style.cssText = 'color:#38bdf8;font-weight:800;cursor:pointer;';
                span.addEventListener('click', () => clickItemDirectly(it));
                titleDiv.appendChild(span);
            } else {
                titleDiv.textContent = it.t;
            }

            const blockBtn = document.createElement('button');
            blockBtn.dataset.block = it.key;
            blockBtn.textContent = '🚫 차단';
            blockBtn.style.cssText = 'font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;cursor:pointer;flex-shrink:0;white-space:nowrap;';
            blockBtn.addEventListener('click', () => {
                blockItem(it.key);
                row.style.opacity = '0.3';
                blockBtn.disabled = true;
                blockBtn.textContent = '차단됨';
            });

            row.appendChild(titleDiv);
            row.appendChild(blockBtn);
            container.appendChild(row);
        });
    }

    // --- 가격 파싱 ---
    function extractMaxPrice(text) {
        const prices = [];
        (text.match(/\d{1,3}(?:,\d{3})+/g) || []).forEach(s => {
            const n = parseInt(s.replace(/,/g, ''));
            if (n >= 1000) prices.push(n);
        });
        (text.match(/\b\d{5,}\b/g) || []).forEach(s => {
            const n = parseInt(s);
            if (n >= 10000) prices.push(n);
        });
        (text.match(/[\d,]+만원/g) || []).forEach(s => {
            const n = parseInt(s.replace(/,/g, '').replace(/만원$/, '')) * 10000;
            if (n >= 10000) prices.push(n);
        });
        // "N억원"만 가격 인식 — "1억 개" 같은 수량 표현 제외
        (text.match(/\d+억원/g) || []).forEach(s => {
            prices.push(parseInt(s.replace(/억원$/, '')) * 100000000);
        });
        return prices.length ? Math.max(...prices) : 0;
    }

    // --- 페이지 스캔 ---
    function scanPage() {
        if (!rule) return [];
        const kws    = (rule.keyword || '').split(',').map(k => k.trim()).filter(Boolean);
        const exKws  = (rule.excludeKeyword || '').split(',').map(k => k.trim()).filter(Boolean);
        const minPrice = rule.minPrice || 0;
        const maxPrice = rule.maxPrice || 0;

        const seen  = new Set();
        const items = [];

        document.querySelectorAll('li, tr, .item_row, .item_wrap').forEach(el => {
            let text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (text.length < 15) return;
            if (text.includes('물품제목') && text.includes('등록일시')) return;

            if (kws.length && !kws.some(k => text.includes(k))) return;
            if (exKws.length && exKws.some(k => text.includes(k))) return;

            const price = extractMaxPrice(text);
            if (minPrice > 0 && price < minPrice) return;
            if (maxPrice > 0 && price > maxPrice) return;

            const titleEl = el.querySelector('.subject, .kind_title, .item_title, .title, .col_title, td:nth-child(2)');
            const title = titleEl
                ? (() => {
                    const raw = Array.from(titleEl.childNodes)
                        .filter(n => n.nodeType === Node.TEXT_NODE)
                        .map(n => n.textContent.trim()).filter(Boolean).join(' ');
                    return (raw || titleEl.innerText.split('\n')[0]).trim();
                })()
                : text.substring(0, 40) + '...';

            const candidates = el.tagName === 'A'
                ? [el, ...Array.from(el.querySelectorAll('a'))]
                : Array.from(el.querySelectorAll('a'));
            let href = (
                candidates.find(a => a.href && a.href.includes('application')) ||
                candidates.find(a => a.href && a.href.startsWith('http') && !a.href.includes('javascript'))
            )?.href || '';

            if (!href) {
                const tid = el.getAttribute('data-tid');
                if (tid && /^\d{6,}$/.test(tid)) {
                    href = location.origin + '/sell/application.html?tid=' + tid;
                }
            }

            if (!href) {
                const allEls = [el, ...Array.from(el.querySelectorAll('[onclick],[data-id],[data-no],[data-seq]'))];
                for (const e of allEls) {
                    const oc = e.getAttribute('onclick') || '';
                    const m = oc.match(/application[^'"]*[?&]id=(\d+)/i)
                           || oc.match(/[?&]id=(\d+)/i)
                           || oc.match(/['"(](\d{4,})['")/]/);
                    if (m) { href = location.origin + '/sell/application.html?id=' + m[1] + '&pinit=2'; break; }
                    const did = e.getAttribute('data-id') || e.getAttribute('data-no') || e.getAttribute('data-seq');
                    if (did && /^\d{3,}$/.test(did)) { href = location.origin + '/sell/application.html?id=' + did + '&pinit=2'; break; }
                }
            }

            const itemKey = title.substring(0, 30).trim();
            if (blockedItems.has(itemKey)) return;

            // TID를 먼저 추출해서 중복 키로 사용 — 제목+가격이 같아도 TID가 다르면 별개 물품
            const elTid = el.getAttribute('data-tid') ||
                          [el, ...Array.from(el.querySelectorAll('[data-tid]'))].reduce((acc, e) => acc || e.getAttribute('data-tid'), '');
            const tidM = href.match(/[?&]tid=(\d+)/);
            const idM  = href.match(/[?&]id=(\d+)/);
            const tid  = (elTid && /^\d+$/.test(elTid)) ? elTid : (tidM ? tidM[1] : (idM ? idM[1] : ''));

            const key = tid ? ('tid_' + tid) : (title.substring(0, 20) + '_' + price);
            if (seen.has(key)) return;
            seen.add(key);
            chrome.runtime.sendMessage({ type: 'DEBUG_LOG', text: 'item: ' + title.substring(0,30) + ' | href: ' + (href || '(없음)') });
            // _el: DOM 참조 저장 → 클릭 시 직접 사용
            items.push({ t: title, p: price, u: href, key: itemKey, tid, _el: el });
        });
        return items;
    }

    // --- 검색 폼 제출 ---
    function submitSearch() {
        if (!isRunning || !rule) return;
        const kw = (rule.keyword || '').split(',')[0].trim();
        if (!kw) { setTimeout(() => location.reload(), 1000); return; }

        const searchBox =
            document.getElementById('searchWord') ||
            document.querySelector('input[name="searchWord"]') ||
            document.querySelector('input[name="search_word"]') ||
            document.querySelector('input[placeholder*="검색"]') ||
            document.querySelector('.search_input, #search_input, [class*="search"] input[type="text"]');

        if (searchBox) {
            searchBox.value = kw;
            searchBox.dispatchEvent(new Event('input', { bubbles: true }));
            searchBox.dispatchEvent(new Event('change', { bubbles: true }));
            const form = searchBox.closest('form');
            if (form) { form.submit(); return; }
            searchBox.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
            searchBox.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Enter', keyCode: 13, bubbles: true }));
        } else {
            location.reload();
        }
    }

    // --- Firebase 알림 ---
    function sendAlert(items) {
        const _at = Date.now();
        const _rows = items.map(it => ({ t: it.t, p: it.p, u: it.u || '', tid: it.tid || '' }));
        chrome.runtime.sendMessage({
            type: 'FIREBASE_SET',
            path: '/monitor_flash_state',
            data: {
                active: true,
                ruleId: rule.id,
                ruleName: rule.name,
                ruleKeyword: rule.keyword || '',
                ruleUrl: rule.url,
                itemCount: items.length,
                itemRows: _rows,
                at: _at
            }
        });
        // monitor_history 기록은 background.js의 FIREBASE_SET 핸들러에서 원자적으로 처리됨
    }

    // --- 2페이지 존재 여부 확인 ---
    function findPage2Link() {
        return Array.from(document.querySelectorAll('a[href]')).find(a => {
            const h = a.href || '';
            return h.includes('page=2') || h.includes('pnum=2') || h.includes('nowPage=2') || h.includes('pageNo=2');
        }) || Array.from(document.querySelectorAll('a')).find(a => {
            return a.textContent.trim() === '2' && a.closest('[class*="pag"],[class*="page"],[class*="num"]');
        }) || null;
    }

    // --- 2페이지 이동 ---
    function goToPage2() {
        const p2 = findPage2Link();
        if (p2) { p2.click(); return; }
        // 링크 없으면 이동 안 함 (1페이지만 있는 경우)
    }

    // --- 메인 스캔 루프 ---
    function doCheck() {
        if (!isRunning || !rule) return;
        const onPage2 = sessionStorage.getItem('_imi_page2_scan') === '1';
        setStatus('🔍 스캔 중...' + (onPage2 ? ' (2p)' : ' (1p)'), '#3abff8');

        const items = scanPage();
        const intervalMs = (rule.scanInterval || 5) * 1000;

        if (items.length > 0) {
            setStatus(`🚨 ${items.length}개 감지! 알림 전송`, '#ef4444');
            document.getElementById('_imi_box').style.borderColor = '#ef4444';
            renderAlertItems(items);
            sendAlert(items);
            sessionStorage.removeItem('_imi_page2_scan');
            setTimeout(() => {
                if (!isRunning) return;
                document.getElementById('_imi_box').style.borderColor = '#3abff8';
                document.getElementById('_imi_items').innerHTML = '';
                setStatus('30초 대기 후 재검색...', '#94a3b8');
                submitSearch();
            }, 30000);
        } else if (!onPage2) {
            // 1페이지 완료 → 2페이지 링크 있을 때만 이동
            if (!findPage2Link()) {
                // 2페이지 없음(1페이지짜리 검색결과) → 다음 사이클
                sessionStorage.removeItem('_imi_page2_scan');
                const t = new Date().toLocaleTimeString('ko-KR');
                setStatus(`없음 — ${rule.scanInterval || 5}초 후 재검색 (${t})`, '#94a3b8');
                document.getElementById('_imi_items').innerHTML = '';
                setTimeout(() => { if (!isRunning) return; submitSearch(); }, intervalMs);
                return;
            }
            sessionStorage.setItem('_imi_page2_scan', '1');
            setStatus('1p 없음 — 2p 스캔 중...', '#64748b');
            setTimeout(() => {
                if (!isRunning) return;
                goToPage2();
                // AJAX 방식 페이지 전환 대비: 리로드 없으면 doCheck가 자동 호출 안 됨
                // 리로드 방식이면 구 컨텍스트가 소멸되므로 이 타이머는 무시됨
                setTimeout(() => { if (!isRunning) return; doCheck(); }, 1500);
            }, 400);
        } else {
            // 2페이지도 없음 → 다음 사이클
            sessionStorage.removeItem('_imi_page2_scan');
            const t = new Date().toLocaleTimeString('ko-KR');
            setStatus(`없음 — ${rule.scanInterval || 5}초 후 재검색 (${t})`, '#94a3b8');
            document.getElementById('_imi_items').innerHTML = '';
            setTimeout(() => { if (!isRunning) return; submitSearch(); }, intervalMs);
        }
    }

    function _e(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
})();
