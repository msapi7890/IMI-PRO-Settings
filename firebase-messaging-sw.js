// IMI PRO 웹 푸시 서비스워커
// Firebase Messaging SDK 미사용 — raw push 이벤트 직접 처리

self.addEventListener('install', function(event) {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function(event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
    var title = '🚨 IMI PRO 감지됨';
    var options = {
        body: '',
        icon: 'https://msapi7890.github.io/IMI-PRO/guide_imgs/1.png',
        tag: 'imi-pro-alert',
        requireInteraction: true,
        data: { url: 'https://msapi7890.github.io/IMI-PRO/' }
    };
    try {
        var d = event.data ? event.data.json() : {};
        if (d.title) title = d.title;
        if (d.body)  options.body = d.body;
    } catch(e) {}
    // 서비스워커 push 수신 로그 (진단용)
    fetch('https://manual-9a47c-default-rtdb.firebaseio.com/sw_push_log.json', {
        method: 'POST',
        body: JSON.stringify({ ts: Date.now(), title: title })
    }).catch(function(){});
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    var targetUrl = (event.notification.data && event.notification.data.url) || 'https://msapi7890.github.io/IMI-PRO/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
            for (var i = 0; i < list.length; i++) {
                if (list[i].url.startsWith(targetUrl) && 'focus' in list[i]) return list[i].focus();
            }
            return clients.openWindow(targetUrl);
        })
    );
});
