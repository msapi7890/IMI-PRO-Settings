(function () {
    // 1. document.referrer 위조
    try {
        Object.defineProperty(Document.prototype, 'referrer', {
            get: function () { return 'https://www.itemmania.com/'; },
            configurable: true
        });
    } catch (e) {}
    try {
        Object.defineProperty(document, 'referrer', {
            get: function () { return 'https://www.itemmania.com/'; },
            configurable: true
        });
    } catch (e) {}

    // 2. '경로' 관련 alert 차단
    var _origAlert = window.alert;
    window.alert = function (msg) {
        if (msg && String(msg).indexOf('경로') !== -1) return;
        return _origAlert.apply(this, arguments);
    };

    // 3. 메인 페이지로 강제 리다이렉트 차단
    var _locDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (_locDesc && _locDesc.set) {
        Object.defineProperty(Location.prototype, 'href', {
            get: _locDesc.get,
            set: function (v) {
                var s = String(v);
                // '/'나 루트로 보내는 리다이렉트만 차단
                if (s === '/' || s === '' || /^\/(index|main)?(\.html?|\.php|\.jsp)?$/i.test(s)) return;
                return _locDesc.set.call(this, v);
            },
            configurable: true
        });
    }
})();
