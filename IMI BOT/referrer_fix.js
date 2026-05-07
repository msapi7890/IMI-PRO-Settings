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

    // 메인 페이지 리다이렉트 판별 (상대경로 + 절대URL 모두 처리)
    function isMainRedirect(v) {
        var s = String(v || '');
        // 상대경로: /, /index.html, /main.html 등
        if (s === '/' || s === '') return true;
        if (/^\/(index|main)?(\.html?|\.php|\.jsp)?(\?.*)?$/i.test(s)) return true;
        // 절대URL: https://www.itemmania.com/ 또는 https://www.itemmania.com/index.html
        if (/https?:\/\/[^/]*itemmania\.com\/?(\?.*)?$/.test(s)) return true;
        if (/https?:\/\/[^/]*itemmania\.com\/(index|main)?(\.html?|\.php|\.jsp)?(\?.*)?$/i.test(s)) return true;
        return false;
    }

    // 3. location.href 세터 차단
    var _locDesc = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
    if (_locDesc && _locDesc.set) {
        Object.defineProperty(Location.prototype, 'href', {
            get: _locDesc.get,
            set: function (v) {
                if (isMainRedirect(v)) return;
                return _locDesc.set.call(this, v);
            },
            configurable: true
        });
    }

    // 4. location.replace() 차단
    var _origReplace = Location.prototype.replace;
    Location.prototype.replace = function (v) {
        if (isMainRedirect(v)) return;
        return _origReplace.call(this, v);
    };

    // 5. location.assign() 차단
    var _origAssign = Location.prototype.assign;
    Location.prototype.assign = function (v) {
        if (isMainRedirect(v)) return;
        return _origAssign.call(this, v);
    };
})();
