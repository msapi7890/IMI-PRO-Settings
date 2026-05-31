importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey:            "AIzaSyDc3L_8IfVJxjIkv1tnOXRy_tQx3fSPxOI",
    authDomain:        "manual-9a47c.firebaseapp.com",
    databaseURL:       "https://manual-9a47c-default-rtdb.firebaseio.com",
    projectId:         "manual-9a47c",
    storageBucket:     "manual-9a47c.firebasestorage.app",
    messagingSenderId: "360735158801",
    appId:             "1:360735158801:web:1dd7b4d7a07ac9502a37b0"
});

const messaging = firebase.messaging();

// 백그라운드 메시지 수신 (탭 닫혀있을 때)
messaging.onBackgroundMessage(function(payload) {
    var d = payload.data || {};
    self.registration.showNotification(d.title || '🚨 IMI PRO 감지됨', {
        body:             d.body || '',
        icon:             './favicon.ico',
        badge:            './favicon.ico',
        tag:              'imi-pro-alert',
        requireInteraction: true,
        data:             { url: self.location.origin + self.location.pathname.replace(/[^/]*$/, '') }
    });
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
