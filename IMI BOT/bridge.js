// IMI PRO 웹페이지 ↔ 확장프로그램 메시지 브릿지
// GitHub Pages(https://msapi7890.github.io/IMI-PRO/)에서 실행됨

window.addEventListener('message', function(e) {
    if (e.source !== window || !e.data) return;
    if (e.data.__imiBotPing) { window.postMessage({ __imiBotConnected: true }, '*'); return; }
    if (!e.data.__imiBot) return;
    var msg = Object.assign({}, e.data);
    delete msg.__imiBot;
    chrome.runtime.sendMessage(msg, function(res) {
        if (chrome.runtime.lastError) return;
        window.postMessage({ __imiBotRes: true, payload: res || {} }, '*');
    });
});

// 페이지에 확장프로그램 연결 알림 (타이밍 보정: 여러 번 전송)
function _announce() { window.postMessage({ __imiBotConnected: true }, '*'); }
_announce();
setTimeout(_announce, 300);
setTimeout(_announce, 1000);
setTimeout(_announce, 3000);
setTimeout(_announce, 7000);
setTimeout(_announce, 15000);
