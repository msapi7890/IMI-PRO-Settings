var AUTO_CLOSE = 60000;

chrome.storage.local.get('imi_watch_popup_data', function(d) {
    var data = d.imi_watch_popup_data;
    if (!data) { window.close(); return; }

    document.getElementById('ruleName').textContent = '규칙: ' + (data.ruleName || '') + ' [' + (data.ruleId||'NO-ID') + ']';
    document.getElementById('itemCount').textContent = (data.itemCount || 0) + '개 물품 감지됨';

    var listEl = document.getElementById('itemList');
    (data.itemRows || []).slice(0, 3).forEach(function(it) {
        var row = document.createElement('div');
        row.className = 'item' + (it.u ? '' : ' no-link');
        row.innerHTML = (it.tid ? '<div class="item-tid">#' + fmtTid(it.tid) + '</div>' : '')
            + '<div class="item-row2"><span class="item-title">' + esc(it.t) + '</span>'
            + (it.p ? '<span class="item-price">' + Number(it.p).toLocaleString() + '원</span>' : '')
            + '</div>';

        listEl.appendChild(row);
    });

    document.getElementById('closeBtn').addEventListener('click', function(e) {
        e.stopPropagation();
        window.close();
    });

    // 팝업 어디 클릭해도(닫기 제외) → IMI PRO 메인 창 포커스
    document.addEventListener('click', function(e) {
        if (e.target.closest('#closeBtn')) return;
        chrome.runtime.sendMessage({ type: 'FOCUS_MAIN_WINDOW' });
    });

    var bar = document.getElementById('progBar');
    setTimeout(function() { bar.style.width = '0%'; }, 30);
    setTimeout(function() { window.close(); }, AUTO_CLOSE);
});

function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtTid(tid) {
    return String(tid||'').replace(/(.{4})(?=.)/g, '$1 ');
}
