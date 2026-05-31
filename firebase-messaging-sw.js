// Web Push 서비스 워커 (Firebase SDK 없이 native push 이벤트 처리)

self.addEventListener('push', function(event) {
    event.waitUntil(
        fetch('https://manual-9a47c-default-rtdb.firebaseio.com/monitor_flash_state.json')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var body = data ? ((data.itemCount||0)+'개 감지') : '새 감지 항목 있음';
            return self.registration.showNotification('🚨 IMI PRO 감지됨', {
                body:             body,
                icon:             './favicon.ico',
                badge:            './favicon.ico',
                tag:              'imi-pro-alert',
                requireInteraction: true,
                data:             { url: self.location.origin + self.location.pathname.replace(/[^/]*$/, '') }
            });
        })
        .catch(function() {
            return self.registration.showNotification('🚨 IMI PRO 감지됨', {
                body:             '새 감지 항목 있음',
                icon:             './favicon.ico',
                badge:            './favicon.ico',
                tag:              'imi-pro-alert',
                requireInteraction: true,
                data:             { url: self.location.origin + self.location.pathname.replace(/[^/]*$/, '') }
            });
        })
    );
});

// 알림 클릭 → IMI PRO 탭 열기/포커스
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    var targetUrl = (event.notification.data && event.notification.data.url) || self.location.origin;
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
            for (var i = 0; i < list.length; i++) {
                if (list[i].url.startsWith(targetUrl) && 'focus' in list[i]) return list[i].focus();
            }
            return clients.openWindow(targetUrl);
        })
    );
});
