// IMI PRO 웹페이지 ↔ 확장프로그램 메시지 브릿지
// GitHub Pages(https://msapi7890.github.io/IMI-PRO/)에서 실행됨

// 페이지 → 확장프로그램
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

// 확장프로그램 → 페이지 (푸시 알림용)
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (msg && msg.__imiBotPush) {
        window.postMessage(msg, '*');
        sendResponse({ ok: true });
    }
    return true;
});

// 페이지에 확장프로그램 연결 알림 (타이밍 보정: 여러 번 전송)
function _announce() { window.postMessage({ __imiBotConnected: true }, '*'); }
_announce();
setTimeout(_announce, 300);
setTimeout(_announce, 1000);
setTimeout(_announce, 3000);
setTimeout(_announce, 7000);
setTimeout(_announce, 15000);
// 주기적 heartbeat — 서비스워커 재시작 또는 오프라인 상태에서도 연결 유지
setInterval(_announce, 20000);
