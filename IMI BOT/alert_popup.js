var AUTO_CLOSE = 60000;

chrome.storage.local.get('imi_alert_popup_data', function(d) {
    var data = d.imi_alert_popup_data;
    if (!data) { window.close(); return; }

    document.getElementById('ruleName').textContent = '규칙: ' + (data.ruleName || '') + ' [' + (data.ruleId||'NO-ID') + ']';
    document.getElementById('itemCount').textContent = (data.itemCount || 0) + '개 물품 감지됨';

    var listEl = document.getElementById('itemList');
    (data.itemRows || []).slice(0, 3).forEach(function(it) {
        var row = document.createElement('div');
        row.className = 'item';
        row.innerHTML = (it.tid ? '<div class="item-tid">#' + esc(it.tid) + '</div>' : '')
            + '<div class="item-row2"><span class="item-title">' + esc(it.t) + '</span>'
            + (it.p ? '<span class="item-price">' + Number(it.p).toLocaleString() + '원</span>' : '')
            + '</div>';
        var blockBtn = document.createElement('button');
        blockBtn.className = 'block-btn';
        blockBtn.textContent = '물품제외';
        (function(k) {
            blockBtn.addEventListener('click', function() {
                chrome.runtime.sendMessage({ type: 'BLOCK_ITEM', key: k });
                blockBtn.disabled = true;
                blockBtn.textContent = '제외됨';
            });
        })(it.key || it.t.substring(0, 30).trim());
        row.appendChild(blockBtn);
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
