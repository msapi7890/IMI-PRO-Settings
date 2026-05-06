(function () {
    'use strict';
    if (window.top !== window.self) return;
    if (window._imiBotLoaded) return;
    window._imiBotLoaded = true;

    let rule = null;
    let isRunning = false;
    let blockedItems = new Set();

    chrome.runtime.sendMessage({ type: 'GET_MY_RULE' }, res => {
        rule = (res && res.rule) ? res.rule : null;
        // rule이 없거나 봇이 정지 상태이면 시작 안 함
        if (!rule || res.botStopped) return;
        // Firebase 포함 차단목록 수신 (background가 원격 병합 후 반환)
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

    // --- 물품 차단 (Firebase 공유 → 전체 실무자 적용) ---
    function blockItem(key) {
        blockedItems.add(key);
        chrome.runtime.sendMessage({ type: 'BLOCK_ITEM', key });
    }

    function renderAlertItems(items) {
        const container = document.getElementById('_imi_items');
        if (!container) return;
        container.innerHTML = items.slice(0, 5).map(it =>
            `<div data-key="${_e(it.key)}" style="display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid #334155;">
                <div style="flex:1;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${it.u
                        ? `<a href="${_e(it.u)}" target="_blank" style="color:#38bdf8;text-decoration:none;font-weight:800;">${_e(it.t)}</a>`
                        : _e(it.t)}
                </div>
                <button data-block="${_e(it.key)}" style="font-size:9px;padding:1px 5px;border-radius:4px;border:1px solid #f87171;color:#f87171;background:none;cursor:pointer;flex-shrink:0;white-space:nowrap;">🚫 차단</button>
            </div>`
        ).join('');
        container.querySelectorAll('button[data-block]').forEach(btn => {
            btn.addEventListener('click', () => {
                blockItem(btn.dataset.block);
                const row = btn.closest('div[data-key]');
                if (row) row.style.opacity = '0.3';
                btn.disabled = true;
                btn.textContent = '차단됨';
            });
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
        (text.match(/[\d,]+만원?/g) || []).forEach(s => {
            const n = parseInt(s.replace(/,/g, '').replace(/만원?$/, '')) * 10000;
            if (n >= 10000) prices.push(n);
        });
        (text.match(/\d+억원?/g) || []).forEach(s => {
            prices.push(parseInt(s.replace(/억원?$/, '')) * 100000000);
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

            const titleEl = el.querySelector('.item_title, .title, .col_title, td:nth-child(2)');
            const title   = titleEl
                ? titleEl.innerText.trim().replace(/\n/g, ' ')
                : text.substring(0, 40) + '...';

            const candidates = el.tagName === 'A'
                ? [el, ...Array.from(el.querySelectorAll('a'))]
                : Array.from(el.querySelectorAll('a'));
            let href = (
                candidates.find(a => a.href && a.href.includes('application')) ||
                candidates.find(a => a.href && a.href.startsWith('http') && !a.href.includes('javascript'))
            )?.href || '';

            // onclick / data 속성에서 ID 추출 → URL 구성
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

            // 링크 없으면 배너/이벤트 영역 → 스킵
            if (!href) return;

            const key = title.substring(0, 20) + '_' + price;
            if (seen.has(key)) return;
            seen.add(key);
            chrome.runtime.sendMessage({ type: 'DEBUG_LOG', text: 'item: ' + title.substring(0,30) + ' | href: ' + href });
            items.push({ t: title, p: price, u: href, key: itemKey });
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
        const content = `🚨 [물리봇 감지] ${rule.name}\n키워드: "${rule.keyword}"\n감지: ${items.length}개\n\n${items[0].t}`;
        chrome.runtime.sendMessage({
            type: 'FIREBASE_SET',
            path: '/monitor_flash_state',
            data: {
                active: true,
                ruleName: rule.name,
                ruleUrl: rule.url,
                itemCount: items.length,
                itemRows: items.slice(0, 3).map(it => ({ t: it.t, p: it.p, u: it.u || '' })),
                at: Date.now()
            }
        });
        chrome.runtime.sendMessage({
            type: 'FIREBASE_PUSH',
            path: '/urgent_notices',
            data: { content, createdAt: Date.now(), expiresAt: Date.now() + 86400000, isMonitorAlert: true }
        });
    }

    // --- 메인 스캔 루프 ---
    function doCheck() {
        if (!isRunning || !rule) return;
        setStatus('🔍 스캔 중...', '#3abff8');

        const items = scanPage();
        const intervalMs = (rule.scanInterval || 5) * 1000;

        if (items.length > 0) {
            setStatus(`🚨 ${items.length}개 감지! 알림 전송`, '#ef4444');
            document.getElementById('_imi_box').style.borderColor = '#ef4444';
            renderAlertItems(items);
            sendAlert(items);
            setTimeout(() => {
                if (!isRunning) return;
                document.getElementById('_imi_box').style.borderColor = '#3abff8';
                document.getElementById('_imi_items').innerHTML = '';
                setStatus('30초 대기 후 재검색...', '#94a3b8');
                submitSearch();
            }, 30000);
        } else {
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
