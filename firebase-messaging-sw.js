// IMI PRO 웹 푸시 서비스워커
// Firebase Messaging SDK 미사용 — raw push 이벤트 직접 처리

self.addEventListener('push', function(event) {
    var title = '🚨 IMI PRO 감지됨';
    var options = {
        body: '',
        icon: './favicon.ico',
        badge: './favicon.ico',
        tag: 'imi-pro-alert',
        requireInteraction: true,
        data: { url: 'https://msapi7890.github.io/IMI-PRO/' }
    };
    try {
        var d = event.data ? event.data.json() : {};
        if (d.title) title = d.title;
        if (d.body)  options.body = d.body;
    } catch(e) {}
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
