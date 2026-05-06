var AUTO_CLOSE = 60000;

chrome.storage.local.get('imi_alert_popup_data', function(d) {
    var data = d.imi_alert_popup_data;
    if (!data) { window.close(); return; }

    document.getElementById('ruleName').textContent = '규칙: ' + (data.ruleName || '') + ' [' + (data.ruleId||'NO-ID') + ']';
    document.getElementById('itemCount').textContent = (data.itemCount || 0) + '개 물품 감지됨';

    var listEl = document.getElementById('itemList');
    (data.itemRows || []).slice(0, 3).forEach(function(it) {
        var row = document.createElement('div');
        row.className = 'item' + (it.u ? '' : ' no-link');
        row.innerHTML = '<span class="item-title">' + esc(it.t) + '</span>'
            + (it.p ? '<span class="item-price">' + Number(it.p).toLocaleString() + '원</span>' : '');

        if (it.u) {
            row.style.cursor = 'pointer';
            (function(url, ruleId) {
                row.addEventListener('click', function() {
                    // 항상 기존 스캔 탭 활용 (새 탭 열면 세션 없어서 메인으로 리다이렉트)
                    chrome.runtime.sendMessage({ type: 'OPEN_ITEM_IN_TAB', url: url, ruleId: ruleId });
                    window.close();
                });
            })(it.u, data.ruleId);
        }
        listEl.appendChild(row);
    });

    document.getElementById('closeBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        window.close();
    });

    // 프로그레스바 자동 닫힘
    var bar = document.getElementById('progBar');
    setTimeout(function() { bar.style.width = '0%'; }, 30);
    setTimeout(function() { window.close(); }, AUTO_CLOSE);
});

function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
