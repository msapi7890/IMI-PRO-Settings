    // 매뉴얼 데이터를 JSON 태그에서 로드
    var MANUAL_INDEX = JSON.parse(document.getElementById('manualData').textContent);
    var PAGE_RANGES = JSON.parse(document.getElementById('pageRangesData').textContent);
    var BAY_MANUAL_INDEX = JSON.parse(document.getElementById('bayManualData').textContent);
    var BAY_PAGE_RANGES = JSON.parse(document.getElementById('bayPageRangesData').textContent);

    // BAY 카테고리 그룹: BAY_MANUAL_INDEX 갱신 시 재빌드
    var _BAY_CAT_NAMES = ['회원가입/탈퇴','판매','구매','결제','마일리지충전','마일리지 출금','거래 안내','회원등급/인증센터','보안서비스','부가서비스','기타','베이만의서비스','거래신고/취소/종료','거래사고 및 비관련 상품(비거래)'];
    function _buildBayCategoryGroups(){
        var _titles = Object.keys(BAY_MANUAL_INDEX);
        var _gs = [], _cur = [];
        _titles.forEach(function(t){
            if(/^1-1\./.test(t) && _cur.length){ _gs.push(_cur); _cur=[]; }
            _cur.push(t);
        });
        if(_cur.length) _gs.push(_cur);
        var _map = {};
        _gs.forEach(function(g,i){ if(_BAY_CAT_NAMES[i]) _map[_BAY_CAT_NAMES[i]]=g; });
        BAY_CATEGORY_GROUPS = _map;
    }
    var BAY_CATEGORY_GROUPS = {};
    _buildBayCategoryGroups();

    var FIREBASE_CONFIG = {apiKey:"AIzaSyDc3L_8IfVJxjIkv1tnOXRy_tQx3fSPxOI",authDomain:"manual-9a47c.firebaseapp.com",databaseURL:"https://manual-9a47c-default-rtdb.firebaseio.com",projectId:"manual-9a47c",storageBucket:"manual-9a47c.firebasestorage.app",messagingSenderId:"360735158801",appId:"1:360735158801:web:1dd7b4d7a07ac9502a37b0"};
    firebase.initializeApp(FIREBASE_CONFIG);
    var db = firebase.database();
    var storage = firebase.storage();
    var _fbRestToken = null;
    var _fbAuthPromise = fetch(
        'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDc3L_8IfVJxjIkv1tnOXRy_tQx3fSPxOI',
        {method:'POST',headers:{'Content-Type':'application/json'},
         body:JSON.stringify({email:'imiprobot@gmail.com',password:'mania3001!',returnSecureToken:true})}
    ).then(function(r){return r.json();}).then(function(d){
        if(d.idToken){
            _fbRestToken=d.idToken;
            return firebase.auth().signInWithEmailAndPassword('imiprobot@gmail.com','mania3001!').catch(function(e){ console.warn('[FB SDK auth] 실패:', e.message); });
        } else console.warn('[FB auth] 실패:', d.error&&d.error.message);
    }).catch(function(e){ console.warn('[FB auth] 오류:', e.message); });
    var ADMIN_PW = "mania3001!";
    var CLAUDE_API_KEY = "";

    var currentMode = 'mania', chatHistories = {mania_manual:"",bay_manual:"",mania_template:"",bay_template:""};
    var allNotices = {mania:{},bay:{}}, manualData = {mania:{text:"",files:[]},bay:{text:"",files:[]}};
    var urgentNotices = {};
    var allTemplates = {mania:{},bay:{}};
    var themeIdx = 0, currentEditId = null;
    var themes = ['light','green','dark'];
    var themeIcons = {light:'\uD83C\uDF1E',green:'\uD83C\uDF3F',dark:'\uD83C\uDF19'};

    var renderer = new marked.Renderer();
    renderer.link = function(h,t,x){ return '<a href="'+h+'" target="_blank">'+x+'</a>'; };
    marked.setOptions({renderer:renderer});

    function updateStatusBadge(){
        var badge = document.getElementById('syncStatusBadge');
        var bar = document.getElementById('apiKeyWarningBar');
        if(badge) badge.style.display = 'none';
        if(CLAUDE_API_KEY){
            if(bar) bar.style.display = 'none';
        } else {
            if(bar){
                bar.style.display = 'block';
                if(_currentUser && _currentUser.role==='admin'){
                    bar.style.cursor='pointer';
                    bar.onclick=checkAppStatus;
                    bar.textContent='⚠ AI 기능이 현재 비활성 상태입니다 — 클릭하여 API 키 설정';
                } else {
                    bar.style.cursor='default';
                    bar.onclick=null;
                    bar.textContent='⚠ AI 기능이 현재 비활성 상태입니다 — 관리자에게 문의해주세요';
                }
            }
        }
    }

    var _customPromptResolve = null;
    function showCustomPrompt(msg, isPassword) {
        return new Promise(function(resolve) {
            _customPromptResolve = resolve;
            var modal = document.getElementById('customPromptModal');
            document.getElementById('customPromptMsg').textContent = msg;
            var inp = document.getElementById('customPromptInput');
            inp.type = isPassword ? 'password' : 'text';
            inp.value = '';
            modal.style.display = 'flex';
            setTimeout(function(){ inp.focus(); }, 80);
        });
    }
    function _customPromptOk() {
        var val = document.getElementById('customPromptInput').value;
        document.getElementById('customPromptModal').style.display = 'none';
        if (_customPromptResolve) { _customPromptResolve(val); _customPromptResolve = null; }
    }
    function _customPromptCancel() {
        document.getElementById('customPromptModal').style.display = 'none';
        if (_customPromptResolve) { _customPromptResolve(null); _customPromptResolve = null; }
    }

    async function checkAppStatus(){
        async function _saveApiKey(val){
            try{
                await _authFetch('config/claude_api_key.json','PUT', val);
            } catch(e){
                alert("❌ Firebase 저장 실패: "+e.message);
                return false;
            }
            // SDK 리스너 응답 여부와 무관하게 즉시 로컬 반영
            CLAUDE_API_KEY = val;
            updateStatusBadge();
            return true;
        }
        if(!CLAUDE_API_KEY){
            var pw = await showCustomPrompt("관리자 비밀번호를 입력하세요:", true);
            if(pw !== ADMIN_PW){if(pw !== null)alert("❌ 비밀번호가 틀렸습니다.");return;}
            var key = await showCustomPrompt("Claude API 키 입력 (sk-ant-...):");
            if(key && key.startsWith('sk-ant-')){
                var ok = await _saveApiKey(key.trim());
                if(ok) alert("✅ API 키 저장 완료! 전체 실무자에게 자동 적용됩니다.");
            } else if(key){alert("❌ 올바르지 않은 형식입니다.");}
        } else {
            if(confirm("IMI PRO v49.0\n모드: "+currentMode.toUpperCase()+"\nAPI키: "+CLAUDE_API_KEY.substring(0,12)+"...\n\n[확인] 키 변경  [취소] 닫기")){
                var pw = await showCustomPrompt("관리자 비밀번호를 입력하세요:", true);
                if(pw !== ADMIN_PW){if(pw !== null)alert("❌ 비밀번호가 틀렸습니다.");return;}
                var key = await showCustomPrompt("새 Claude API 키 입력 (sk-ant-...)\n※ 빈칸으로 확인 시 API 키 삭제됩니다:");
                if(key === null){ /* 취소 */ }
                else if(key.trim()===''){
                    if(confirm("API 키를 삭제하시겠습니까?\nAI 기능이 비활성화됩니다.")){
                        var ok = await _saveApiKey('');
                        if(ok) alert("✅ API 키가 삭제됐습니다. 전체 실무자에게 자동 적용됩니다.");
                    }
                } else if(key.trim().startsWith('sk-ant-')){
                    var ok = await _saveApiKey(key.trim());
                    if(ok) alert("✅ API 키 변경 완료! 전체 실무자에게 자동 적용됩니다.");
                } else {alert("❌ 올바르지 않은 형식입니다.");}
            }
        }
    }

    function cycleTheme(){ themeIdx=(themeIdx+1)%themes.length; applyTheme(themes[themeIdx]); }

    // ===== 다중 사용자 인증 시스템 =====
    var _AUTH_DB = 'https://manual-9a47c-default-rtdb.firebaseio.com';
    var _currentUser = null;  // {name, role}

    async function _sha256(s){
        var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
        return Array.from(new Uint8Array(b)).map(function(v){ return v.toString(16).padStart(2,'0'); }).join('');
    }
    function _authLoadLocal(){
        try{ return JSON.parse(sessionStorage.getItem('imi_auth')||'null'); }catch(e){ return null; }
    }
    function _lockShow(){ document.body.classList.add('auth-pending'); }
    function _lockHide(){ document.body.classList.remove('auth-pending'); }

    // Firebase REST 헬퍼
    var _authFetchBlocked = false; // 권한 차단 감지 플래그
    async function _authFetch(path, method, data){
        try{
            await _fbAuthPromise;
            // % 기호가 유효한 퍼센트 인코딩(%XX)이 아닌 경우 → %25로 치환, 공백 → %20
            // (예: "200% 구매" → "200%25%20구매" — 이미 인코딩된 _ukey 경로는 영향 없음)
            var safePath = path.replace(/%(?![0-9A-Fa-f]{2})/g,'%25').replace(/\s/g,'%20');
            var token = _fbRestToken || '';
            try {
                var cu = firebase.auth().currentUser;
                if(cu) token = await cu.getIdToken(); // 항상 최신 토큰 (SDK가 자동 갱신)
            } catch(e2) {}
            var authParam = token ? ('&auth='+token) : '';
            var opts = {cache:'no-store'};
            if(method){ opts.method=method; opts.headers={'Content-Type':'application/json'}; if(data!==undefined) opts.body=JSON.stringify(data); }
            var _sep = safePath.includes('?') ? '&' : '?';
            var r = await fetch(_AUTH_DB+'/'+safePath+_sep+'_t='+Date.now()+authParam, opts);
            if(r.status===401||r.status===403){
                _authFetchBlocked=true;
                // 재시도 1: SDK 토큰 강제갱신 (GitHub Pages 등 SDK 인증 가능한 환경)
                try {
                    var cu2 = firebase.auth().currentUser;
                    if(cu2){
                        token = await cu2.getIdToken(true);
                        authParam = '&auth='+token;
                        r = await fetch(_AUTH_DB+'/'+safePath+_sep+'_t='+Date.now()+authParam, opts);
                        if(r.ok){ _authFetchBlocked=false; return await r.json(); }
                    }
                } catch(e3) {}
                // 재시도 2: REST API 재로그인 (localhost 등 SDK 도메인 제한 환경)
                try {
                    var rd = await fetch(
                        'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyDc3L_8IfVJxjIkv1tnOXRy_tQx3fSPxOI',
                        {method:'POST',headers:{'Content-Type':'application/json'},
                         body:JSON.stringify({email:'imiprobot@gmail.com',password:'mania3001!',returnSecureToken:true})}
                    ).then(function(rr){return rr.json();});
                    if(rd && rd.idToken){
                        _fbRestToken = rd.idToken;
                        authParam = '&auth='+rd.idToken;
                        r = await fetch(_AUTH_DB+'/'+safePath+_sep+'_t='+Date.now()+authParam, opts);
                        if(r.ok){ _authFetchBlocked=false; return await r.json(); }
                    }
                } catch(e4) {}
                return null;
            }
            _authFetchBlocked = false;
            return r.ok ? (await r.json()) : null;
        }catch(e){ return null; }
    }

    // 유저키 인코딩 (Firebase key safe)
    function _ukey(name){ return encodeURIComponent(name.trim()); }

    // 화면 전환 헬퍼
    function _showLockView(id){
        ['lockLoginView','lockRegisterView','lockRegDoneView','lockLoadingView','lockChangeView','lockFindPwView','lockAutoResetView'].forEach(function(v){
            var el=document.getElementById(v); if(el) el.style.display='none';
        });
        var el=document.getElementById(id); if(el) el.style.display='';
        _lockShow();
    }
    function _showLockLogin(){
        _showLockView('lockLoginView');
        ['lockErrMsg'].forEach(function(id){ var e=document.getElementById(id); if(e) e.style.display='none'; });
        try{
            var rem=JSON.parse(localStorage.getItem('imi_remember')||'null');
            if(rem&&rem.name){
                var ne=document.getElementById('lockNameInput'); if(ne) ne.value=rem.name;
                var pe=document.getElementById('lockPwInput');   if(pe) pe.value=rem.pw||'';
                var ce=document.getElementById('lockRememberChk'); if(ce) ce.checked=true;
            }
        }catch(e){}
        setTimeout(function(){ var n=document.getElementById('lockNameInput'); if(n) n.focus(); }, 80);
    }
    function _showLockRegister(){
        _showLockView('lockRegisterView');
        ['lockRegName','lockRegEmpId','lockRegPw','lockRegPw2'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        var e=document.getElementById('lockRegErr'); if(e) e.style.display='none';
        setTimeout(function(){ var n=document.getElementById('lockRegName'); if(n) n.focus(); }, 80);
    }
    function _showLockRegDone(){ _showLockView('lockRegDoneView'); }
    function _showLockChange(msg, showCancel){
        _showLockView('lockChangeView');
        var m=document.getElementById('lockChangeMsg'); if(m) m.textContent=msg||'비밀번호 변경';
        var cb=document.getElementById('lockChangeCancelBtn'); if(cb) cb.style.display=showCancel?'':'none';
        var e=document.getElementById('lockChangeErr'); if(e) e.style.display='none';
        ['lockOldPw','lockNewPw','lockNewPw2'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
    }

    // 초기화
    async function _authInit(){
        _showLockView('lockLoadingView');
        var saved = _authLoadLocal();
        if(saved && saved.name && saved.hash){
            var user = await _authFetch('imi_users/'+_ukey(saved.name)+'.json');
            if(user && user.pw_hash === saved.hash && user.approved){
                _authGrant({name:saved.name, role:user.role, monitor_disabled:!!user.monitor_disabled, os_notif_disabled:!!user.os_notif_disabled});
                return;
            }
        }
        // 등록된 유저가 없으면 안내 문구 변경
        var allUsers = await _authFetch('imi_users.json');
        if(!allUsers || Object.keys(allUsers).length === 0){
            var sub = document.getElementById('lockSubtitle');
            if(sub) sub.textContent = '첫 번째 가입자가 관리자가 됩니다';
        }
        _showLockLogin();
    }

    // 로그인
    async function _authSubmit(){
        var name = (document.getElementById('lockNameInput').value||'').trim();
        var pw   = document.getElementById('lockPwInput').value||'';
        var errEl = document.getElementById('lockErrMsg');
        errEl.style.display='none';
        if(!name||!pw){ errEl.textContent='이름과 비밀번호를 입력해주세요'; errEl.style.display=''; return; }
        var hash = await _sha256(pw);
        var user = await _authFetch('imi_users/'+_ukey(name)+'.json');
        if(!user){
            errEl.textContent = _authFetchBlocked
                ? '⚠ Firebase 연결 오류 — 관리자에게 문의하세요 (DB 규칙 확인 필요)'
                : '존재하지 않는 이름입니다';
            errEl.style.display=''; return;
        }
        if(user.pw_hash !== hash){
            var _failKey = 'imi_fail_' + _ukey(name);
            var _fails = parseInt(localStorage.getItem(_failKey)||'0') + 1;
            if(_fails >= 5){
                localStorage.removeItem(_failKey);
                var _chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                var _tmpPw=Array.from({length:6},function(){return _chars[Math.floor(Math.random()*_chars.length)];}).join('');
                var _tmpHash=await _sha256(_tmpPw);
                await _authFetch('imi_users/'+_ukey(name)+'/pw_hash.json','PUT',_tmpHash);
                await _authFetch('imi_users/'+_ukey(name)+'/pw_changed_at.json','PUT',0);
                var el=document.getElementById('lockAutoTmpPw'); if(el) el.textContent=_tmpPw;
                _showLockView('lockAutoResetView');
            } else {
                localStorage.setItem(_failKey, _fails);
                errEl.textContent='비밀번호가 올바르지 않습니다 ('+_fails+'/5)';
                errEl.style.display='';
                document.getElementById('lockPwInput').value='';
            }
            return;
        }
        localStorage.removeItem('imi_fail_' + _ukey(name)); // 로그인 성공 시 초기화
        if(!user.approved){ errEl.textContent='승인 대기 중입니다. 관리자의 승인을 기다려 주세요.'; errEl.style.display=''; return; }
        // 아이디·비밀번호 기억
        var chk=document.getElementById('lockRememberChk');
        if(chk&&chk.checked){ localStorage.setItem('imi_remember',JSON.stringify({name:name,pw:pw})); }
        else { localStorage.removeItem('imi_remember'); }
        // 세션 저장 (브라우저 닫으면 로그아웃)
        sessionStorage.setItem('imi_auth', JSON.stringify({name:name, role:user.role, hash:hash, at:Date.now()}));
        // 월 1회 비밀번호 변경 체크 (30일)
        var MONTH_MS=30*86400000;
        if(!user.pw_changed_at || Date.now()-user.pw_changed_at>MONTH_MS){
            _currentUser={name:name, role:user.role, monitor_disabled:!!user.monitor_disabled, os_notif_disabled:!!user.os_notif_disabled};
            _showLockChange('🔒 매월 비밀번호 변경이 필요합니다\n현재 비밀번호를 입력 후 새 비밀번호를 설정하세요.', false);
            return;
        }
        _authGrant({name:name, role:user.role, monitor_disabled:!!user.monitor_disabled, os_notif_disabled:!!user.os_notif_disabled});
    }

    // 회원가입
    async function _authRegister(){
        var name  = (document.getElementById('lockRegName').value||'').trim();
        var empId = (document.getElementById('lockRegEmpId').value||'').trim();
        var pw    = document.getElementById('lockRegPw').value||'';
        var pw2   = document.getElementById('lockRegPw2').value||'';
        var errEl = document.getElementById('lockRegErr');
        errEl.style.display='none';
        if(!name||!empId||!pw||!pw2){ errEl.textContent='모든 항목을 입력해주세요'; errEl.style.display=''; return; }
        if(name.length < 2){ errEl.textContent='이름은 2자 이상이어야 합니다'; errEl.style.display=''; return; }
        if(pw.length < 6){ errEl.textContent='비밀번호는 6자 이상이어야 합니다'; errEl.style.display=''; return; }
        if(pw !== pw2){ errEl.textContent='비밀번호가 일치하지 않습니다'; errEl.style.display=''; return; }
        var existing = await _authFetch('imi_users/'+_ukey(name)+'.json');
        if(existing){ errEl.textContent='이미 사용 중인 이름입니다'; errEl.style.display=''; return; }
        var allUsers = await _authFetch('imi_users.json');
        var isFirst = !allUsers || Object.keys(allUsers).length === 0;
        var hash = await _sha256(pw);
        await _authFetch('imi_users/'+_ukey(name)+'.json', 'PUT', {name:name, emp_id:empId, pw_hash:hash, role:isFirst?'admin':'user', approved:isFirst, created_at:Date.now(), pw_changed_at:Date.now()});
        if(isFirst){
            sessionStorage.setItem('imi_auth', JSON.stringify({name:name, role:'admin', hash:hash, at:Date.now()}));
            _authGrant({name:name, role:'admin'});
        } else {
            _showLockRegDone();
        }
    }

    // 로그인 성공 처리
    function _authGrant(user){
        _currentUser = user;
        _lockHide();
        document.getElementById('lockChangeView').style.display='none';
        // 유저 배지 표시
        var badge = document.getElementById('authUserBadge');
        if(badge) badge.style.display='';
        var nameDisp = document.getElementById('authUserNameDisp');
        if(nameDisp) nameDisp.textContent = user.name + (user.role==='admin' ? ' 👑' : user.role==='subadmin' ? ' ★' : '');
        setTimeout(_syncHdrBtnWidths, 50);
        var adminItem = document.getElementById('authAdminMenuItem');
        if(adminItem) adminItem.style.display = user.role==='admin' ? '' : 'none';
        // 업데이트 알림 Firebase 리스너 시작
        _startUpdateNoticeListener();
        // 설정 메뉴(native)에서 업데이트 알림 발송 클릭 시 모달 열기
        if(window.electronAPI && window.electronAPI.onOpenUpdateNotice){
            window.electronAPI.onOpenUpdateNotice(function(){ _openUpdateNoticeSend(); });
        }
        // 승인 대기 감시
        if(user.role === 'admin' || user.role === 'subadmin') _authWatchPending();
        // 로그인 후 메모 로드 (시작 시 _currentUser 없어서 스킵됐던 것 복구)
        loadMemos();
        // 봇 버튼 권한 적용 (monitor.js 함수)
        if(typeof _updateBotToggleBtn === 'function') _updateBotToggleBtn();
        // 모니터링 알림 억제 (monitor_disabled 플래그, admin은 항상 허용)
        var _monDis = !!user.monitor_disabled && user.role !== 'admin';
        // 데스크탑 SSE 알림 억제 IPC
        if(window.electronAPI && window.electronAPI.setMonitorDisabled)
            window.electronAPI.setMonitorDisabled(_monDis);
        // 앱 내 showNotification도 no-op으로 차단 (탭/패널은 계속 보임)
        if(_monDis && window.electronAPI)
            window.electronAPI.showNotification = function(){ return Promise.resolve(); };
        // OS 알림만 차단 (os_notif_disabled 플래그, admin은 항상 허용)
        var _osNotifDis = !!user.os_notif_disabled && user.role !== 'admin';
        if(window.electronAPI && window.electronAPI.setOsNotifMuted)
            window.electronAPI.setOsNotifMuted(_osNotifDis);
        // Firebase에서 매뉴얼 인덱스 데이터 로드
        _initManualData();
        // 로그인 후 role 확정 — API 키 배너 재렌더
        updateStatusBadge();
    }

    // 로그아웃
    function _authLogout(){
        if(!confirm('로그아웃 하시겠습니까?')) return;
        sessionStorage.removeItem('imi_auth');
        location.reload();
    }

    // 비밀번호 변경
    async function _authChangePw(){
        var oldPw = document.getElementById('lockOldPw').value;
        var newPw = document.getElementById('lockNewPw').value;
        var newPw2 = document.getElementById('lockNewPw2').value;
        var errEl = document.getElementById('lockChangeErr');
        errEl.style.display='none';
        if(!_currentUser){ errEl.textContent='로그인 정보가 없습니다'; errEl.style.display=''; return; }
        if(!oldPw||!newPw||!newPw2){ errEl.textContent='모든 항목을 입력해주세요'; errEl.style.display=''; return; }
        if(newPw.length < 6){ errEl.textContent='비밀번호는 6자 이상이어야 합니다'; errEl.style.display=''; return; }
        if(newPw !== newPw2){ errEl.textContent='새 비밀번호가 일치하지 않습니다'; errEl.style.display=''; return; }
        var oldHash = await _sha256(oldPw);
        var user = await _authFetch('imi_users/'+_ukey(_currentUser.name)+'.json');
        if(!user || user.pw_hash !== oldHash){ errEl.textContent='현재 비밀번호가 올바르지 않습니다'; errEl.style.display=''; return; }
        var newHash = await _sha256(newPw);
        var now = Date.now();
        await _authFetch('imi_users/'+_ukey(_currentUser.name)+'/pw_hash.json', 'PUT', newHash);
        await _authFetch('imi_users/'+_ukey(_currentUser.name)+'/pw_changed_at.json', 'PUT', now);
        sessionStorage.setItem('imi_auth', JSON.stringify({name:_currentUser.name, role:_currentUser.role, hash:newHash, at:now}));
        // 기억된 비밀번호 갱신
        try{
            var rem=JSON.parse(localStorage.getItem('imi_remember')||'null');
            if(rem&&rem.name===_currentUser.name) localStorage.setItem('imi_remember',JSON.stringify({name:rem.name,pw:newPw}));
        }catch(e){}
        // 잠금화면 강제변경인 경우 → 정식 로그인 진행
        if(document.body.classList.contains('auth-pending')){
            alert('비밀번호가 변경됐습니다. 로그인합니다.');
            _authGrant(_currentUser);
        } else {
            _authCancelChange();
            alert('비밀번호가 변경됐습니다.');
        }
    }
    function _authCancelChange(){
        document.getElementById('lockChangeView').style.display='none';
        _lockHide();
    }
    // 비밀번호 찾기
    function _showLockFindPw(){
        _showLockView('lockFindPwView');
        ['lockFindName','lockFindEmpId'].forEach(function(id){ var e=document.getElementById(id); if(e) e.value=''; });
        var err=document.getElementById('lockFindErr'); if(err) err.style.display='none';
        var res=document.getElementById('lockFindResult'); if(res) res.style.display='none';
        var btn=document.getElementById('lockFindBtn'); if(btn){ btn.textContent='임시 비밀번호 발급'; btn.disabled=false; }
        setTimeout(function(){ var n=document.getElementById('lockFindName'); if(n) n.focus(); },80);
    }
    async function _authFindPw(){
        var name  = (document.getElementById('lockFindName').value||'').trim();
        var empId = (document.getElementById('lockFindEmpId').value||'').trim();
        var errEl = document.getElementById('lockFindErr');
        errEl.style.display='none';
        if(!name||!empId){ errEl.textContent='이름과 사번을 모두 입력해주세요'; errEl.style.display=''; return; }
        var btn=document.getElementById('lockFindBtn');
        if(btn){ btn.textContent='확인 중...'; btn.disabled=true; }
        var user = await _authFetch('imi_users/'+_ukey(name)+'.json');
        if(!user||!user.emp_id){
            errEl.textContent='이름 또는 사번이 올바르지 않습니다';
            errEl.style.display='';
            if(btn){ btn.textContent='임시 비밀번호 발급'; btn.disabled=false; }
            return;
        }
        if(String(user.emp_id).trim() !== String(empId)){
            errEl.textContent='이름 또는 사번이 올바르지 않습니다';
            errEl.style.display='';
            if(btn){ btn.textContent='임시 비밀번호 발급'; btn.disabled=false; }
            return;
        }
        // 임시 비밀번호 생성 (대문자+숫자 8자리)
        var chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var tmpPw=Array.from({length:8},function(){return chars[Math.floor(Math.random()*chars.length)];}).join('');
        var hash = await _sha256(tmpPw);
        await _authFetch('imi_users/'+_ukey(name)+'/pw_hash.json','PUT',hash);
        await _authFetch('imi_users/'+_ukey(name)+'/pw_changed_at.json','PUT',0); // 로그인 시 강제 변경
        var resEl=document.getElementById('lockFindResult');
        var pwEl=document.getElementById('lockFindTmpPw');
        if(pwEl) pwEl.textContent=tmpPw;
        if(resEl) resEl.style.display='';
        if(btn){ btn.textContent='발급 완료'; btn.disabled=true; }
    }

    // 관리자: 비밀번호 초기화
    async function _authResetPw(key, name){
        if(!confirm('"'+name+'" 의 비밀번호를 초기화할까요?\n임시 비밀번호가 생성됩니다.')) return;
        var chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var tmpPw=Array.from({length:6},function(){return chars[Math.floor(Math.random()*chars.length)];}).join('');
        var hash=await _sha256(tmpPw);
        await _authFetch('imi_users/'+key+'/pw_hash.json','PUT',hash);
        await _authFetch('imi_users/'+key+'/pw_changed_at.json','PUT',0); // 다음 로그인 시 강제 변경
        alert('"'+name+'" 임시 비밀번호:\n\n  '+tmpPw+'\n\n다음 로그인 시 비밀번호 변경이 요구됩니다.');
        _renderUserMgmt();
    }
    function _openUserChangePw(){
        _hideUserMenu();
        _showLockChange('비밀번호 변경', true);
    }

    // pending 카운트 (popoup 렌더링용)
    var _umPendingCount = 0;

    // 유저 메뉴 토글 (팀/파트/접속현황 팝업 — 팝업 안에 gear 포함)
    async function _toggleUserMenu(e){
        e.stopPropagation();
        var menu = document.getElementById('authUserMenu');
        if(!menu) return;
        var isOpen = menu.style.display !== 'none';
        if(isOpen){ menu.style.display = 'none'; return; }

        menu.innerHTML = '<div style="padding:16px;color:#64748b;font-size:12px;text-align:center;">로딩 중...</div>';
        menu.style.display = '';

        var users     = await _authFetch('imi_users.json') || {};
        var teamsData = await _umLoadTeams();
        var teamNames = Object.keys(teamsData);

        var approved = Object.entries(users)
            .filter(function(e){ return e[1].approved; })
            .map(function(e){ return Object.assign({_key:e[0]}, e[1]); });

        var isAdmin = _currentUser && _currentUser.role === 'admin';

        // 헤더 (멤버 수 + 톱니바퀴)
        var h = '<div style="padding:9px 14px 8px;border-bottom:1px solid var(--border-ui);display:flex;align-items:center;justify-content:space-between;">'
            + '<div style="display:flex;align-items:center;gap:6px;">'
            +   '<span style="font-size:10px;font-weight:900;color:#94a3b8;letter-spacing:0.03em;">멤버</span>'
            +   '<span style="font-size:10px;font-weight:700;color:#e2e8f0;">'+approved.length+'명</span>'
            + '</div>'
            + '<button onclick="_umToggleSettings(event)" title="설정" style="width:24px;height:24px;border-radius:6px;border:1px solid transparent;background:none;color:#64748b;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:0.1s;" onmouseover="this.style.background=\'var(--bg-body)\';this.style.color=\'var(--text-main)\'" onmouseout="this.style.background=\'none\';this.style.color=\'#64748b\'">&#x2699;</button>'
            + '</div>';

        // 설정 섹션 (기본 hidden, gear 클릭 시 토글)
        var pendingTag = _umPendingCount > 0
            ? ' <span style="background:#ef4444;color:#fff;font-size:9px;font-weight:900;border-radius:99px;padding:0 5px;">'+_umPendingCount+'</span>'
            : '';
        var rowS = 'padding:9px 16px;font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px;';
        h += '<div id="authInlineSettings" style="display:none;border-bottom:1px solid var(--border-ui);background:var(--bg-body);">';
        if(_currentUser){
            h += '<div onclick="openUserMgmtModal()" style="'+rowS+'color:var(--text-main);border-bottom:1px solid var(--border-ui);" onmouseover="this.style.opacity=0.75" onmouseout="this.style.opacity=1">&#x1f465; 멤버 목록'+pendingTag+'</div>';
        }
        h += '<div onclick="_openUserChangePw()" style="'+rowS+'color:var(--text-main);border-bottom:1px solid var(--border-ui);" onmouseover="this.style.opacity=0.75" onmouseout="this.style.opacity=1">&#x1f511; 비밀번호 변경</div>';
        h += '<div onclick="_authLogout()" style="'+rowS+'color:#ef4444;" onmouseover="this.style.opacity=0.75" onmouseout="this.style.opacity=1">&#x1f6aa; 로그아웃</div>';
        h += '</div>';

        h += '<div style="overflow-y:auto;max-height:340px;padding:6px 0;">';

        var shownKeys = {};

        // 팀별 섹션
        teamNames.forEach(function(team){
            var parts    = teamsData[team] || [];
            var teamMems = approved.filter(function(u){ return u.team === team; });
            if(teamMems.length === 0 && parts.length === 0) return;

            h += '<div style="padding:6px 14px 4px;">'
                + '<div style="font-size:10px;font-weight:900;color:#94a3b8;letter-spacing:0.04em;margin-bottom:5px;">&#x1f4cb; '+escHtml(team)+'</div>';

            if(parts.length > 0){
                parts.forEach(function(part){
                    var pMems = teamMems.filter(function(u){ return u.part === part; });
                    pMems.forEach(function(u){ shownKeys[u._key]=1; });
                    h += '<div style="padding-left:10px;margin-bottom:5px;border-left:2px solid #0284c7;">'
                        + '<div style="font-size:9px;color:#7dd3fc;font-weight:700;margin-bottom:3px;">'+escHtml(part)+'</div>'
                        + '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
                    if(pMems.length === 0){
                        h += '<span style="font-size:9px;color:#334155;">없음</span>';
                    } else {
                        pMems.forEach(function(u){
                            h += _umUserChip(u);
                        });
                    }
                    h += '</div></div>';
                });
                // 파트 미배정 팀원
                var noPart = teamMems.filter(function(u){ return !u.part; });
                if(noPart.length > 0){
                    noPart.forEach(function(u){ shownKeys[u._key]=1; });
                    h += '<div style="padding-left:10px;margin-bottom:3px;display:flex;flex-wrap:wrap;gap:4px;">';
                    noPart.forEach(function(u){ h += _umUserChip(u); });
                    h += '</div>';
                }
            } else {
                // 파트 없는 팀
                teamMems.forEach(function(u){ shownKeys[u._key]=1; });
                h += '<div style="padding-left:10px;display:flex;flex-wrap:wrap;gap:4px;">';
                if(teamMems.length === 0){
                    h += '<span style="font-size:9px;color:#334155;">멤버 없음</span>';
                } else {
                    teamMems.forEach(function(u){ h += _umUserChip(u); });
                }
                h += '</div>';
            }
            h += '</div>';
        });

        // 팀 미배정 멤버
        var noTeam = approved.filter(function(u){ return !u.team && !shownKeys[u._key]; });
        if(noTeam.length > 0){
            h += '<div style="padding:6px 14px 4px;border-top:1px solid var(--border-ui);margin-top:4px;">'
                + '<div style="font-size:10px;color:#475569;font-weight:700;margin-bottom:4px;">미배정</div>'
                + '<div style="display:flex;flex-wrap:wrap;gap:4px;">';
            noTeam.forEach(function(u){ h += _umUserChip(u); });
            h += '</div></div>';
        }

        h += '</div>';
        menu.innerHTML = h;
        setTimeout(function(){ document.addEventListener('click', _hideUserMenu, {once:true}); }, 10);
    }
    function _umUserChip(u){
        return '<span style="background:#1e293b;border:1px solid #334155;border-radius:5px;padding:2px 7px;font-size:10px;display:inline-flex;align-items:center;">'
            + '<span style="color:#e2e8f0;">'+escHtml(u.name)+'</span>'
            + '</span>';
    }
    function _umToggleSettings(e){
        e.stopPropagation();
        var s = document.getElementById('authInlineSettings');
        if(s) s.style.display = s.style.display === 'none' ? '' : 'none';
    }
    function _hideUserMenu(){
        var m = document.getElementById('authUserMenu');
        if(m) m.style.display='none';
    }

    // 관리자: 대기 유저 감시
    function _authWatchPending(){
        function check(){
            _authFetch('imi_users.json').then(function(users){
                if(!users) return;
                var cnt = Object.values(users).filter(function(u){ return !u.approved; }).length;
                _umPendingCount = cnt;
                var b1 = document.getElementById('authPendingBadge');
                if(b1){ b1.textContent=cnt; b1.style.display=cnt?'':'none'; }
            });
        }
        check();
        setInterval(check, 30000);
    }

    // 회원관리 모달
    var _umCurrentTab = 1;
    var _umFilter = 'all';
    function openUserMgmtModal(){
        _hideUserMenu();
        document.getElementById('userMgmtModal').style.display='flex';
        var role = _currentUser && _currentUser.role;
        var isPriv = role === 'admin' || role === 'subadmin';
        // 승인대기 탭: admin/subadmin만
        var tab2 = document.getElementById('umTab2');
        if(tab2) tab2.style.display = isPriv ? '' : 'none';
        // 팀관리 탭: admin만
        var tab3 = document.getElementById('umTab3');
        if(tab3) tab3.style.display = role === 'admin' ? '' : 'none';
        // 일반 유저는 항상 탭1로
        var defaultTab = isPriv ? _umCurrentTab : 1;
        _umSwitchTab(defaultTab);
    }
    function closeUserMgmtModal(){
        document.getElementById('userMgmtModal').style.display='none';
    }

    // ===== 파일 매뉴얼 시스템 =====
    function _isPrivileged(){ return _currentUser && (_currentUser.role==='admin'||_currentUser.role==='subadmin'); }

    function openManualFilesModal(tab){
        _mfUploadDone = false;
        _mfUpdateNavBadge();
        var tab1 = document.getElementById('mfTab1');
        if(tab1) tab1.style.display = _isPrivileged() ? '' : 'none';
        document.getElementById('manualFilesModal').style.display='flex';
        _mfSwitchTab(tab || (_isPrivileged() ? 1 : 2));
    }
    function closeManualFilesModal(){
        document.getElementById('manualFilesModal').style.display='none';
    }
    function _mfSwitchTab(n){
        var cols = {1:'#f59e0b', 2:'#0284c7', 3:'#ef4444'};
        [1,2,3].forEach(function(i){
            var btn = document.getElementById('mfTab'+i);
            if(!btn) return;
            var active = i===n;
            btn.style.borderBottomColor = active ? cols[i] : 'transparent';
            btn.style.background = active ? '#0f172a' : '#1e293b';
            btn.style.color = active ? cols[i] : '#475569';
        });
        var wrap = document.getElementById('mfContent');
        if(wrap) wrap.style.padding = n===3 ? '0' : '16px 20px';
        if(n===1) _renderManualMgmt();
        else if(n===2) _renderManualFiles();
        else _renderBadwordMgmt();
    }

    function _renderBadwordMgmt(){
        var wrap = document.getElementById('mfContent');
        if(!wrap) return;
        wrap.innerHTML =
            '<div id="bwViewList" style="display:flex;flex-direction:column;">'
            +'<div style="padding:8px 10px;border-bottom:1px solid #334155;display:flex;gap:6px;align-items:center;">'
            +'<input id="bwSearchInput" type="text" placeholder="금칙어 검색..." oninput="_renderBwList()" style="flex:1;font-size:12px;padding:6px 10px;height:34px;border-radius:8px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;outline:none;">'
            +'<button onclick="_bwShowAddForm()" style="padding:0 14px;height:34px;border-radius:8px;background:#ef4444;color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:900;flex-shrink:0;">+ 추가</button>'
            +'<button onclick="_bwShowBulkForm()" style="padding:0 14px;height:34px;border-radius:8px;background:#7c3aed;color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:900;flex-shrink:0;">📋 일괄 등록</button>'
            +'</div>'
            // 단건 추가 폼
            +'<div id="bwAddForm" style="display:none;padding:10px;border-bottom:1px solid #334155;background:#0f172a;gap:6px;flex-direction:column;">'
            +'<div style="display:flex;gap:6px;">'
            +'<select id="bwAddGame" style="flex:1;padding:6px 8px;border-radius:8px;border:1.5px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;font-weight:700;"></select>'
            +'<input id="bwAddGameNew" type="text" placeholder="새 카테고리명" style="display:none;flex:1;padding:6px 8px;border-radius:8px;border:1.5px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;">'
            +'</div>'
            +'<div style="display:flex;gap:6px;">'
            +'<input id="bwAddWord" type="text" placeholder="금칙어 입력" style="flex:1;font-size:13px;padding:6px 10px;height:34px;border-radius:8px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;outline:none;" onkeydown="if(event.key===\'Enter\')_bwDoAdd()">'
            +'<button onclick="_bwDoAdd()" style="padding:0 14px;height:34px;border-radius:8px;background:#22c55e;color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:900;flex-shrink:0;">등록</button>'
            +'<button onclick="_bwHideAddForm()" style="padding:0 10px;height:34px;border-radius:8px;background:none;border:1.5px solid #334155;color:#64748b;cursor:pointer;font-size:12px;flex-shrink:0;">취소</button>'
            +'</div>'
            +'</div>'
            // 일괄 등록 폼
            +'<div id="bwBulkForm" style="display:none;padding:10px;border-bottom:1px solid #334155;background:#0f172a;gap:6px;flex-direction:column;">'
            +'<div style="font-size:11px;font-weight:900;color:#7c3aed;margin-bottom:2px;">📋 일괄 등록 — 한 줄에 단어 하나씩 입력</div>'
            +'<div style="display:flex;gap:6px;">'
            +'<select id="bwBulkGame" style="flex:1;padding:6px 8px;border-radius:8px;border:1.5px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;font-weight:700;"></select>'
            +'<input id="bwBulkGameNew" type="text" placeholder="새 카테고리명" style="display:none;flex:1;padding:6px 8px;border-radius:8px;border:1.5px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;">'
            +'</div>'
            +'<textarea id="bwBulkWords" rows="6" placeholder="금칙어를 한 줄에 하나씩 입력하세요&#10;예)&#10;작업템&#10;사기&#10;버스" style="width:100%;padding:8px 10px;border-radius:8px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:13px;resize:vertical;outline:none;box-sizing:border-box;line-height:1.6;" oninput="_bwBulkCount()"></textarea>'
            +'<div style="display:flex;align-items:center;gap:6px;">'
            +'<span id="bwBulkCountLabel" style="flex:1;font-size:11px;color:#64748b;">0개 단어</span>'
            +'<button onclick="_bwDoBulkAdd()" style="padding:0 18px;height:34px;border-radius:8px;background:#22c55e;color:#fff;border:none;cursor:pointer;font-size:12px;font-weight:900;flex-shrink:0;">일괄 등록</button>'
            +'<button onclick="_bwHideBulkForm()" style="padding:0 10px;height:34px;border-radius:8px;background:none;border:1.5px solid #334155;color:#64748b;cursor:pointer;font-size:12px;flex-shrink:0;">취소</button>'
            +'</div>'
            +'</div>'
            +'<div id="bwListContent" style="padding:10px 14px;"></div>'
            +'</div>';
        _badwordsCache[currentMode] = null;
        _renderBwList();
    }

    function _mfFileRow(f, priv){
        var dt = new Date(f.approvedAt||f.uploadedAt).toLocaleDateString('ko');
        var ext = (f.fileName||'').split('.').pop().toUpperCase();
        var extColor = ext==='PDF'?'#ef4444':ext==='XLSX'||ext==='XLS'?'#22c55e':ext==='DOCX'||ext==='DOC'?'#3b82f6':'#6366f1';
        var h = '<div style="background:#0f172a;border:1.5px solid #1e293b;border-radius:10px;padding:10px 13px;margin-bottom:6px;display:flex;align-items:center;gap:9px;">';
        h += '<span style="background:'+extColor+'22;color:'+extColor+';font-size:10px;font-weight:900;border-radius:5px;padding:2px 7px;flex-shrink:0;">'+ext+'</span>';
        h += '<div style="flex:1;min-width:0;">';
        h += '<div style="font-size:12px;font-weight:700;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+escHtml(f.title||f.fileName)+'</div>';
        h += '<div style="font-size:10px;color:#475569;margin-top:1px;">'+escHtml(f.uploadedBy)+' · '+dt+'</div>';
        h += '</div>';
        h += '<a href="'+escHtml(f.downloadURL)+'" target="_blank" style="padding:5px 12px;border-radius:7px;background:#0284c7;color:#fff;font-size:10px;font-weight:700;text-decoration:none;flex-shrink:0;">열기</a>';
        if(priv){
            h += '<button onclick="_deleteManualFile(\''+f.id+'\',\''+escHtml(f.storagePath||'')+'\')" style="padding:5px 8px;border-radius:7px;background:none;border:1px solid #334155;color:#475569;font-size:10px;cursor:pointer;flex-shrink:0;">삭제</button>';
        }
        h += '</div>';
        return h;
    }

    async function _renderManualFiles(){
        var wrap = document.getElementById('mfContent');
        if(!wrap) return;
        wrap.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px;">로딩 중...</div>';

        var priv = _isPrivileged();

        var raw = await _authFetch('imi_manual_files.json');
        var files = raw ? Object.entries(raw).map(function(e){ return Object.assign({id:e[0]},e[1]); }) : [];

        var approved = files.filter(function(f){ return f.status==='approved'; })
                            .sort(function(a,b){ return (b.approvedAt||b.uploadedAt)-(a.approvedAt||a.uploadedAt); });

        var maniaFiles = approved.filter(function(f){ return !f.mode||f.mode==='mania'; });
        var bayFiles   = approved.filter(function(f){ return f.mode==='bay'; });

        var h = '';

        // ── 섹션별 파일 목록 (다운로드 전용) ──
        var sections = [
            {key:'mania', label:'📌 아이템매니아', color:'#0284c7', files:maniaFiles},
            {key:'bay',   label:'📌 아이템베이',   color:'#e85d04', files:bayFiles}
        ];
        if(!approved.length){
            h += '<div style="text-align:center;padding:30px 0;color:#334155;font-size:12px;">등록된 파일이 없습니다.</div>';
        } else {
            sections.forEach(function(sec){
                if(!sec.files.length) return;
                h += '<div style="margin-bottom:14px;">';
                h += '<div style="font-size:11px;font-weight:900;color:'+sec.color+';margin-bottom:8px;border-left:3px solid '+sec.color+';padding-left:8px;">'+sec.label+' '+sec.files.length+'개</div>';
                sec.files.forEach(function(f){ h += _mfFileRow(f, priv); });
                h += '</div>';
            });
        }

        wrap.innerHTML = h;
        // 기본 모드 버튼 상태 초기화
        if(typeof _mfCurrentMode !== 'undefined') _mfSetMode(_mfCurrentMode, true);
    }

    var _mfCurrentMode = 'mania';
    function _mfSetMode(mode, silent){
        _mfCurrentMode = mode;
        var colors = {mania:'#0284c7', bay:'#e85d04'};
        ['mania','bay'].forEach(function(m){
            var btn = document.getElementById('mfModeBtn_'+m);
            if(!btn) return;
            var active = m===mode;
            btn.style.background = active ? colors[m] : 'none';
            btn.style.borderColor = active ? colors[m] : '#334155';
            btn.style.color = active ? '#fff' : '#94a3b8';
        });
    }

    function _mfNorm(s){
        // 제목/파일명 정규화: 소문자, 공백·특수문자 제거, 끝 버전번호 제거
        return (s||'').toLowerCase()
            .replace(/[_\-\s\.]+/g,'')
            .replace(/[vV버전version]?\d[\d\.]*$/,'');
    }
    function _mfFindDupes(files, title, fileName){
        var normTitle = _mfNorm(title);
        var normFile  = _mfNorm(fileName.replace(/\.[^.]+$/,''));
        return files.filter(function(f){
            var ft = _mfNorm(f.title||f.fileName);
            var ff = _mfNorm((f.fileName||'').replace(/\.[^.]+$/,''));
            // 제목 일치 or 파일명(확장자 제거) 일치 or 한쪽이 다른쪽을 포함
            return ft===normTitle || ff===normFile ||
                   (normTitle.length>3 && (ft.includes(normTitle)||normTitle.includes(ft))) ||
                   (normFile.length>3  && (ff.includes(normFile)||normFile.includes(ff)));
        });
    }

    async function _uploadManualFile(){
        var titleEl = document.getElementById('mfTitle');
        var fileEl  = document.getElementById('mfFileInput');
        var prog    = document.getElementById('mfUploadProgress');
        var file    = fileEl ? fileEl.files[0] : null;
        if(!file){ return; }

        var title = (titleEl&&titleEl.value.trim()) || file.name.replace(/\.[^.]+$/,'');
        var mode  = _mfCurrentMode || 'mania';

        // ── 중복 체크 (같은 모드 내에서만) ──
        if(prog) prog.textContent = '중복 파일 확인 중...';
        var raw = await _authFetch('imi_manual_files.json');
        var allFiles = raw ? Object.entries(raw).map(function(e){ return Object.assign({id:e[0]},e[1]); }) : [];
        var sameMode = allFiles.filter(function(f){ return (f.mode||'mania')===mode; });
        var dupes = _mfFindDupes(sameMode, title, file.name);

        var replaceIds = [];
        if(dupes.length > 0){
            var dupeNames = dupes.map(function(d){ return '· '+escHtml(d.title||d.fileName)+' ('+new Date(d.uploadedAt).toLocaleDateString('ko')+')'; }).join('\n');
            var msg = '유사한 파일이 이미 '+dupes.length+'개 있습니다:\n'+dupeNames.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
            msg += '\n\n최신 버전으로 교체하시겠습니까?\n(확인 → 기존 삭제 후 등록 / 취소 → 기존 유지하고 별도 추가)';
            if(confirm(msg)){
                replaceIds = dupes.map(function(d){ return {id:d.id, path:d.storagePath||''}; });
            }
        }

        if(prog) prog.textContent = '업로드 중... 잠시 기다려 주세요.';

        try{
            var ts = Date.now();
            var safeName = ts+'_'+file.name.replace(/[^\w가-힣._-]/g,'_');
            var storePath = 'manuals/'+safeName;
            var snap = await storage.ref(storePath).put(file);
            var url  = await snap.ref.getDownloadURL();

            // 교체 시 기존 파일 삭제
            for(var i=0;i<replaceIds.length;i++){
                var r=replaceIds[i];
                if(r.path){ try{ await storage.ref(r.path).delete(); }catch(e){} }
                await _authFetch('imi_manual_files/'+r.id+'.json','DELETE');
            }

            var entry = {
                title: title,
                fileName: file.name,
                storagePath: storePath,
                downloadURL: url,
                uploadedBy: (_currentUser&&_currentUser.name)||'',
                uploadedAt: ts,
                mode: mode,
                status: 'approved',
                approvedBy: (_currentUser&&_currentUser.name)||'',
                approvedAt: ts
            };
            await _authFetch('imi_manual_files/'+ts+'.json','PUT',entry);

            var msg2 = replaceIds.length>0 ? '&#x2713; 교체 등록 완료!' : '&#x2713; 등록 완료!';
            if(prog) prog.textContent = msg2;
            if(titleEl) titleEl.value='';
            if(fileEl)  fileEl.value='';
            setTimeout(function(){ _renderManualFiles(); }, 600);
        }catch(e){
            if(prog) prog.textContent = '오류: '+e.message;
        }
    }

    async function _approveManualFile(id){
        var now = Date.now();
        await _authFetch('imi_manual_files/'+id+'/status.json','PUT','approved');
        await _authFetch('imi_manual_files/'+id+'/approvedBy.json','PUT',(_currentUser&&_currentUser.name)||'');
        await _authFetch('imi_manual_files/'+id+'/approvedAt.json','PUT',now);
        _renderManualFiles();
    }

    async function _deleteManualFile(id, storagePath){
        if(!confirm('이 파일을 삭제하시겠습니까?')) return;
        if(storagePath){
            try{ await storage.ref(storagePath).delete(); }catch(e){}
        }
        await _authFetch('imi_manual_files/'+id+'.json','DELETE');
        _renderManualFiles();
    }
    // ===== /파일 매뉴얼 =====

    // ── 매뉴얼 관리 탭 ──
    var _mfMgmtMode = 'mania';
    var _mfRegTab   = 'new';
    var _mfCurrentEditKey  = null;
    var _mfEditCache = null; // 항목 수정 탭 데이터 캐시 (매 키입력마다 재요청 방지)
    var _mfCurrentEditData = null;

    function _mfCancelPending(){
        if(!_mfPending || !_mfPending.length) return;
        if(!confirm('대기 중인 항목 '+_mfPending.length+'개를 취소하시겠습니까?\n저장되지 않은 항목은 모두 사라집니다.')) return;
        _mfPending = [];
        _mfRenderPendingList();
        _mfUpdateNavBadge();
    }
    function _mfNavCancel(){
        if(_mfIsConverting){ _mfCancelRenderNow(); }
        else { _mfCancelPending(); }
    }

    function _mfUpdateNavBadge(){
        var btn   = document.getElementById('mfNavBtn');
        var badge = document.getElementById('mfNavBadge');
        if(!badge) return;

        // 총 페이지: Firebase 저장값 우선, 로컬 렌더링 정보로 보완
        var totalPages = _mfTotalPdfPages || 0;
        if(_mfRendered){
            var _rEnd = _mfRendered.startFrom + _mfRendered.numPages - 1;
            if(_rEnd > totalPages) totalPages = _rEnd;
        }

        // 대기 중 항목이 커버하는 페이지 수
        var pendingPages = 0;
        if(_mfPending) _mfPending.forEach(function(e){ pendingPages += Math.max(0, (e.to||0)-(e.from||0)+1); });

        var registeredPages = _mfSavedPageCnt + pendingPages;
        var hasPending  = _mfPending && _mfPending.length > 0;
        // 작업 중일 때만 배지 표시 (완료된 카운터는 상시 표시 안 함)
        var active = _mfIsConverting || _mfImgUploading || hasPending || _mfUploadDone;

        var cancelBtn = document.getElementById('mfNavCancelBtn');
        if(!active){
            badge.style.display = 'none';
            if(cancelBtn) cancelBtn.style.display = 'none';
            if(btn){ btn.style.borderColor='var(--border-ui)'; btn.style.color='var(--text-main)'; }
            return;
        }
        if(cancelBtn) cancelBtn.style.display = (_mfIsConverting || hasPending) ? '' : 'none';

        badge.style.display = '';
        if(_mfUploadDone && !_mfImgUploading && !_mfIsConverting && !hasPending){
            badge.textContent      = '✅ 완료 — 눌러서 확인';
            badge.style.background = '#15803d';
            badge.style.color      = '#4ade80';
            badge.style.animation  = 'mfBadgePulse 1.5s ease-in-out infinite';
            if(btn){ btn.style.borderColor='#22c55e'; btn.style.color='#4ade80'; }
            return;
        }
        badge.style.animation = '';
        if(_mfImgUploading){
            var _ups = _mfImgUploadState;
            badge.textContent      = '업로드 중 ' + (_ups ? _ups.count : '...');
            badge.style.background = '#0284c7';
            badge.style.color      = '#fff';
            if(btn){ btn.style.borderColor='#0284c7'; btn.style.color='#7dd3fc'; }
        } else if(_mfIsConverting){
            badge.textContent      = '변환 중 ' + (_mfConvertStatus || '...');
            badge.style.background = '#7c3aed';
            badge.style.color      = '#fff';
            if(btn){ btn.style.borderColor='#7c3aed'; btn.style.color='#a78bfa'; }
        } else if(hasPending){
            badge.textContent      = _mfPending.length + '개 대기중';
            badge.style.background = '#f59e0b';
            badge.style.color      = '#0f172a';
            if(btn){ btn.style.borderColor='#f59e0b'; btn.style.color='#f59e0b'; }
        }
    }
    var _MANIA_CATS = ['일반','충전','결제','사고'];
    var _BAY_CATS   = ['회원가입/탈퇴','판매','구매','결제','마일리지충전','마일리지 출금','거래 안내','회원등급/인증센터','보안서비스','부가서비스','기타','베이만의서비스','거래신고/취소/종료','거래사고 및 비관련 상품(비거래)'];
    var MANUAL_RANGES = {};      // manual_page_ranges/mania (카테고리 포함)
    var BAY_MANUAL_RANGES = {};  // manual_page_ranges/bay
    var _mfPending      = [];   // 신규 등록 대기 항목
    var _mfRendered     = null; // {mode, startFrom, numPages, fileName, storePath, downloadURL}
    var _mfSavedPageCnt = 0;    // Firebase에 저장된 항목이 커버하는 페이지 수 합계
    var _mfTotalPdfPages= 0;    // 이 모드 PDF 총 페이지 수 (Firebase manual_meta에서 로드)
    var _mfRegisteredRanges = []; // 저장된 항목의 페이지 범위 [{start,end}]
    var _mfCancelRender = false;// PDF 변환 중 취소 플래그
    var _mfIsConverting = false;// 변환 진행 중 여부
    var _mfConvertStatus= '';   // 변환 중 상태 문자열 (예: "3 / 181")
    var _mfProgressHtml = '';   // 마지막 progress 영역 HTML (모달 재진입 시 복원)
    var _mfImgUploading = false;// 이미지 직접 업로드 진행 중 여부
    var _mfUploadDone   = false;// 업로드 완료 후 배지 표시용
    var _mfImgUploadState = null; // {current, total, pct, text, done, failed}

    // ── Realtime DB 이미지 저장/조회 헬퍼 (Firebase Storage 대체) ──
    function _b64PadPage(num){ return String(num).padStart(3,'0'); }

    // ── IndexedDB 이미지 캐시 헬퍼 ──
    var _mfIdbName = 'mf-img-cache', _mfIdbStore = 'imgs';
    function _mfIdbOpen(){
        return new Promise(function(res,rej){
            var r = indexedDB.open(_mfIdbName, 1);
            r.onupgradeneeded = function(e){ e.target.result.createObjectStore(_mfIdbStore); };
            r.onsuccess = function(e){ res(e.target.result); };
            r.onerror   = function(e){ rej(e.target.error); };
        });
    }
    async function _mfCacheGet(key){
        try{
            var db = await _mfIdbOpen();
            return await new Promise(function(res,rej){
                var tx = db.transaction(_mfIdbStore,'readonly');
                var req = tx.objectStore(_mfIdbStore).get(key);
                req.onsuccess = function(){ res(req.result||null); };
                req.onerror   = function(){ rej(req.error); };
            });
        }catch(e){ return null; }
    }
    async function _mfCacheSet(key, val){
        try{
            var db = await _mfIdbOpen();
            return await new Promise(function(res,rej){
                var tx = db.transaction(_mfIdbStore,'readwrite');
                var req = tx.objectStore(_mfIdbStore).put(val, key);
                req.onsuccess = function(){ res(); };
                req.onerror   = function(){ rej(req.error); };
            });
        }catch(e){}
    }
    async function _mfCacheDel(key){
        try{
            var db = await _mfIdbOpen();
            return await new Promise(function(res,rej){
                var tx = db.transaction(_mfIdbStore,'readwrite');
                var req = tx.objectStore(_mfIdbStore).delete(key);
                req.onsuccess = function(){ res(); };
                req.onerror   = function(){ rej(req.error); };
            });
        }catch(e){}
    }
    function _mfCacheKey(mode, pageNum){ return 'mf_'+mode+'_'+_b64PadPage(pageNum); }

    // 다른 사용자 캐시 무효화 기록을 DB에 씀 (아주 작은 텍스트)
    async function _mfWriteCacheInvalidate(mode, pageNums){
        try{
            var ts = Date.now();
            var patch = {};
            pageNums.forEach(function(n){ patch['p'+_b64PadPage(n)] = ts; });
            await _authFetch('cache_invalidate/'+mode+'.json','PATCH', patch);
        }catch(e){}
    }

    // 앱 시작 시: DB 무효 목록 읽고 해당 캐시 삭제 + 7일 지난 기록 정리
    async function _mfApplyCacheInvalidation(){
        try{
            var cutoff = Date.now() - 7*24*60*60*1000;
            for(var mode of ['mania','bay']){
                var inv = await _authFetch('cache_invalidate/'+mode+'.json');
                if(!inv || typeof inv !== 'object') continue;
                var expired = {};
                var keys = Object.keys(inv);
                for(var i=0; i<keys.length; i++){
                    var k = keys[i];
                    var pageNum = parseInt(k.replace('p',''), 10);
                    if(!isNaN(pageNum)) await _mfCacheDel(_mfCacheKey(mode, pageNum));
                    if(inv[k] < cutoff) expired[k] = null;
                }
                if(Object.keys(expired).length){
                    await _authFetch('cache_invalidate/'+mode+'.json','PATCH', expired);
                }
            }
        }catch(e){}
    }

    async function _savePageToDb(mode, pageNum, blob){
        return new Promise(function(resolve, reject){
            var reader = new FileReader();
            reader.onload = async function(e){
                try{
                    var b64 = e.target.result.split(',')[1];
                    await _authFetch('manual_pages_b64/'+mode+'/p'+_b64PadPage(pageNum)+'.json','PUT',b64);
                    var dataUrl = 'data:image/jpeg;base64,'+b64;
                    // 내 캐시 갱신 + 다른 사용자 캐시 무효 기록
                    _mfCacheSet(_mfCacheKey(mode, pageNum), dataUrl).catch(function(){});
                    _mfWriteCacheInvalidate(mode, [pageNum]).catch(function(){});
                    resolve(dataUrl);
                }catch(err){ reject(err); }
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async function _getPageDataUrl(mode, pageNum){
        // 캐시 우선
        var cacheKey = _mfCacheKey(mode, pageNum);
        var cached = await _mfCacheGet(cacheKey);
        if(cached) return cached;
        // DB에서 다운로드 후 캐시 저장
        try{
            var b64 = await _authFetch('manual_pages_b64/'+mode+'/p'+_b64PadPage(pageNum)+'.json');
            if(b64 && typeof b64==='string'){
                var dataUrl = 'data:image/jpeg;base64,'+b64;
                _mfCacheSet(cacheKey, dataUrl).catch(function(){});
                return dataUrl;
            }
        }catch(e){}
        // Storage 폴백 (마이그레이션 전 호환)
        try{ return await storage.ref('manual_pages/'+mode+'/page-'+_b64PadPage(pageNum)+'.jpg').getDownloadURL(); }
        catch(e2){}
        return null;
    }

    async function _listDbPages(mode){
        try{
            // shallow=true: 키값만 받아 전체 base64 이미지 다운로드 방지
            var data = await _authFetch('manual_pages_b64/'+mode+'.json?shallow=true');
            if(data && typeof data==='object'){
                return Object.keys(data)
                    .map(function(k){ return parseInt(k.replace('p',''),10); })
                    .filter(function(n){ return !isNaN(n); })
                    .sort(function(a,b){ return a-b; });
            }
        }catch(e){}
        return [];
    }

    async function _deleteAllPagesFromDb(mode){
        try{ await _authFetch('manual_pages_b64/'+mode+'.json','DELETE'); }catch(e){}
    }

    async function _migrateStorageToDb(mode, onProgress){
        try{
            var result = await storage.ref('manual_pages/'+mode+'/').listAll();
            var items = result.items.slice().sort(function(a,b){ return a.name.localeCompare(b.name); });
            if(!items.length){ if(onProgress) onProgress('이미지 없음',0,0); return 0; }
            var done = 0;
            for(var i=0;i<items.length;i++){
                var ref = items[i];
                var m = ref.name.match(/page-(\d+)\.jpg$/i);
                if(!m) continue;
                var pageNum = parseInt(m[1],10);
                var existing = await _authFetch('manual_pages_b64/'+mode+'/p'+_b64PadPage(pageNum)+'.json');
                if(existing && typeof existing==='string'){ done++; if(onProgress) onProgress('건너뜀 p.'+pageNum,done,items.length); continue; }
                try{
                    var url = await ref.getDownloadURL();
                    var resp = await fetch(url);
                    var blob = await resp.blob();
                    await _savePageToDb(mode, pageNum, blob);
                    done++;
                    if(onProgress) onProgress('완료 p.'+pageNum,done,items.length);
                }catch(e2){ console.warn('마이그레이션 실패 p.'+pageNum, e2); }
            }
            return done;
        }catch(e){ console.error('마이그레이션 오류:',e); return 0; }
    }

    function _renderManualMgmt(){
        var wrap = document.getElementById('mfContent');
        if(!wrap) return;
        if(!_isPrivileged()){ wrap.innerHTML='<div style="color:#475569;text-align:center;padding:30px;font-size:13px;">접근 권한이 없습니다.</div>'; return; }
        var isAdm = _currentUser && _currentUser.role==='admin';
        var h = '';

        // 모드 선택
        h += '<div style="display:flex;gap:6px;margin-bottom:12px;">';
        h += '<button id="mfMgmtMode_mania" onclick="_mfSetMgmtMode(\'mania\')" style="flex:1;padding:7px;border-radius:7px;border:1.5px solid #0284c7;background:#0284c7;color:#fff;font-size:11px;font-weight:900;cursor:pointer;">📌 매니아</button>';
        h += '<button id="mfMgmtMode_bay"   onclick="_mfSetMgmtMode(\'bay\')"   style="flex:1;padding:7px;border-radius:7px;border:1.5px solid #334155;background:none;color:#94a3b8;font-size:11px;font-weight:900;cursor:pointer;">📌 베이</button>';
        h += '</div>';

        // ── 신규 등록 ──

        // STEP 1: PDF 업로드 + 렌더링
        h += '<div style="background:#0f172a;border-radius:10px;padding:14px;border:1.5px solid #1e293b;margin-bottom:10px;">';
        h += '<div style="font-size:10px;font-weight:900;color:#7c3aed;letter-spacing:0.05em;margin-bottom:8px;">① PDF 업로드 &amp; 이미지 변환</div>';
        h += '<div style="font-size:10px;font-weight:900;color:#64748b;margin-bottom:4px;">시작 페이지 <span style="font-weight:400;color:#475569;">(이 PDF 1페이지 = 매뉴얼 전체 몇 번째 페이지인지)</span></div>';
        h += '<div style="display:flex;gap:6px;margin-bottom:10px;">';
        h += '<input type="number" id="mfNewStart" min="1" placeholder="예: 151" style="flex:1;padding:7px 10px;border-radius:7px;border:1.5px solid #334155;background:#1e293b;color:#e2e8f0;font-size:12px;outline:none;">';
        h += '<button onclick="_mfAutoStart()" style="padding:7px 12px;border-radius:7px;border:1px solid #334155;background:none;color:#64748b;font-size:11px;cursor:pointer;white-space:nowrap;">자동 확인</button>';
        h += '</div>';
        h += '<label id="mfImgUploadLabel" style="display:block;padding:9px 14px;border-radius:8px;background:linear-gradient(135deg,#7c3aed,#0284c7);color:#fff;font-size:11px;font-weight:900;cursor:pointer;text-align:center;">';
        h += '📄🖼 PDF 또는 이미지 선택 (여러 장 가능)';
        h += '<input type="file" id="mfCombinedFile" accept=".pdf,image/jpeg,image/png,image/webp" multiple style="display:none;" onchange="_mfHandleFiles()">';
        h += '</label>';
        h += '<label style="display:flex;align-items:center;gap:6px;margin-top:8px;cursor:pointer;user-select:none;">';
        h += '<input type="checkbox" id="mfImgOverwrite" style="width:14px;height:14px;accent-color:#f59e0b;cursor:pointer;">';
        h += '<span style="font-size:11px;color:#f59e0b;font-weight:700;">기존 이미지 덮어쓰기 (기존 페이지 내용 교체 시 체크)</span>';
        h += '</label>';
        h += '<div id="mfImgUploadProgress" style="display:none;margin-top:8px;padding:10px 12px;border-radius:8px;background:#0c1a2e;border:1px solid #1e3a5f;">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
        h += '<span id="mfImgUploadText" style="font-size:11px;font-weight:700;color:#7dd3fc;"></span>';
        h += '<span id="mfImgUploadCount" style="font-size:11px;font-weight:900;color:#e2e8f0;"></span>';
        h += '</div>';
        h += '<div style="background:#1e293b;border-radius:4px;height:8px;overflow:hidden;">';
        h += '<div id="mfImgUploadBar" style="height:100%;background:linear-gradient(90deg,#0284c7,#38bdf8);border-radius:4px;transition:width 0.2s;width:0%;"></div>';
        h += '</div>';
        h += '</div>';
        h += '<div id="mfNewProgress" style="font-size:11px;color:#64748b;margin-top:8px;min-height:16px;white-space:pre-wrap;"></div>';
        h += '</div>';

        // STEP 2: 항목 등록
        h += '<div id="mfEntryPanel" style="">';
        h += '<div style="background:#0f172a;border-radius:10px;padding:14px;border:1.5px solid #22c55e;margin-bottom:10px;">';
        h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">';
        h += '<div style="font-size:10px;font-weight:900;color:#22c55e;letter-spacing:0.05em;flex:1;">② 항목 등록 <span id="mfRenderedInfo" style="font-weight:400;color:#64748b;font-size:10px;"></span></div>';
        h += '<button onclick="_mfLoadStorageThumbs()" id="mfLoadThumbsBtn" style="padding:4px 10px;border-radius:6px;border:1px solid #334155;background:none;color:#64748b;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap;">📷 저장된 이미지 불러오기</button>';
        h += '</div>';
        h += '<div id="mfThumbResumeBanner" style="display:none;margin-bottom:8px;padding:8px 12px;border-radius:8px;background:#0f2e1a;border:1.5px solid #166534;font-size:11px;color:#4ade80;display:flex;align-items:center;gap:8px;flex-wrap:wrap;"></div>';
        h += '<div id="mfPageThumbs" style="display:none;overflow-x:auto;overflow-y:hidden;white-space:nowrap;border:1px solid #1e293b;border-radius:8px;padding:8px;margin-bottom:10px;background:#0a1120;"></div>';
        h += '<div style="font-size:10px;color:#475569;margin-bottom:8px;">썸네일 클릭 → 뷰어에서 항목 등록 후 전체 저장하세요.</div>';
        h += '<input type="number" id="mfEntryFrom" style="display:none;">';
        h += '<input type="number" id="mfEntryTo" style="display:none;">';
        h += '<div id="mfPendingList"></div>';
        h += '<button id="mfSaveAllBtn" onclick="_mfSaveAllPending()" style="display:none;padding:10px 0;border-radius:8px;background:#0284c7;color:#fff;font-size:12px;font-weight:900;border:none;cursor:pointer;width:100%;margin-top:8px;">💾 전체 저장</button>';
        h += '</div>';
        h += '</div>'; // mfEntryPanel

        // ── 항목 수정 폼 (등록된 항목 목록에서 수정 버튼 클릭 시 표시) ──
        h += '<div id="mfEditForm" style="display:none;background:#0f172a;border-radius:10px;padding:14px;border:1.5px solid #f59e0b;margin-bottom:10px;">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
        h += '<div style="font-size:11px;font-weight:900;color:#f59e0b;">✏️ 항목 수정</div>';
        h += '<button onclick="document.getElementById(\'mfEditForm\').style.display=\'none\'" style="padding:3px 8px;border-radius:5px;background:none;border:1px solid #334155;color:#64748b;font-size:10px;cursor:pointer;">닫기</button>';
        h += '</div>';

        // 이미지 미리보기 (전체 페이지 썸네일)
        h += '<div id="mfEditPreviewWrap" style="display:none;margin-bottom:12px;">';
        h += '<div style="font-size:10px;color:#475569;margin-bottom:4px;" id="mfEditPreviewLabel"></div>';
        h += '<div id="mfEditPreviewList" style="display:flex;flex-wrap:wrap;gap:6px;max-height:220px;overflow-y:auto;padding:4px 0;"></div>';
        h += '</div>';

        // 제목
        h += '<div style="font-size:10px;font-weight:900;color:#f59e0b;margin-bottom:3px;">제목</div>';
        h += '<input id="mfEditFTitle" placeholder="항목명" style="width:100%;padding:7px 10px;border-radius:7px;border:1.5px solid #334155;background:#1e293b;color:#e2e8f0;font-size:11px;outline:none;margin-bottom:8px;">';

        // 카테고리
        h += '<div style="font-size:10px;font-weight:900;color:#f59e0b;margin-bottom:3px;">카테고리</div>';
        h += '<div style="display:flex;gap:4px;margin-bottom:4px;">';
        h += '<select id="mfEditFCat" style="flex:1;padding:7px 10px;border-radius:7px;border:1.5px solid #334155;background:#1e293b;color:#e2e8f0;font-size:11px;outline:none;"></select>';
        h += '<button onclick="_mfToggleEditCatRename()" title="카테고리 이름 변경" style="padding:7px 10px;border-radius:7px;border:1px solid #334155;background:none;color:#f59e0b;font-size:12px;cursor:pointer;">✏️</button>';
        h += '</div>';
        h += '<div id="mfEditCatRenameWrap" style="display:none;gap:4px;margin-bottom:8px;">';
        h += '<input type="text" id="mfEditCatRenameInput" placeholder="새 카테고리 이름" onkeydown="if(event.key===\'Enter\')_mfConfirmEditCatRename();if(event.key===\'Escape\')_mfCancelEditCatRename();" style="flex:1;padding:6px 10px;border-radius:7px;border:1.5px solid #f59e0b;background:#1e293b;color:#e2e8f0;font-size:11px;outline:none;">';
        h += '<button onclick="_mfConfirmEditCatRename()" style="padding:6px 12px;border-radius:7px;border:none;background:#f59e0b;color:#fff;font-size:11px;font-weight:900;cursor:pointer;white-space:nowrap;">변경</button>';
        h += '<button onclick="_mfCancelEditCatRename()" style="padding:6px 10px;border-radius:7px;border:1px solid #334155;background:none;color:#64748b;font-size:11px;cursor:pointer;">취소</button>';
        h += '</div>';

        // 페이지 범위
        h += '<div style="font-size:10px;font-weight:900;color:#f59e0b;margin-bottom:3px;">페이지 범위</div>';
        h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">';
        h += '<input id="mfEditFStart" type="number" placeholder="시작" style="flex:1;padding:7px 10px;border-radius:7px;border:1.5px solid #334155;background:#1e293b;color:#e2e8f0;font-size:11px;outline:none;">';
        h += '<span style="color:#475569;font-weight:900;">~</span>';
        h += '<input id="mfEditFEnd" type="number" placeholder="끝" style="flex:1;padding:7px 10px;border-radius:7px;border:1.5px solid #334155;background:#1e293b;color:#e2e8f0;font-size:11px;outline:none;">';
        h += '</div>';

        // 키워드
        h += '<div style="font-size:10px;font-weight:900;color:#f59e0b;margin-bottom:3px;">키워드 <span style="font-weight:400;color:#475569;">(쉼표 구분)</span></div>';
        h += '<input id="mfEditFKws" placeholder="예: 개명, 이름변경, 명의변경" style="width:100%;padding:7px 10px;border-radius:7px;border:1.5px solid #334155;background:#1e293b;color:#e2e8f0;font-size:11px;outline:none;margin-bottom:10px;">';

        // 저장 버튼
        h += '<button id="mfEditSaveBtn" onclick="_mfSaveEditItem()" style="width:100%;padding:9px;border-radius:7px;background:#f59e0b;color:#fff;font-size:12px;font-weight:900;border:none;cursor:pointer;">💾 저장</button>';

        // 추가 범위 수정 (PDF 렌더링 완료 후)
        h += '<div id="mfEditExtraPanel" style="display:none;margin-top:10px;">';
        h += '<div style="background:#1e293b;border-radius:9px;padding:12px;border:1.5px solid #f59e0b;">';
        h += '<div style="font-size:10px;font-weight:900;color:#f59e0b;margin-bottom:6px;">같은 범위 내 다른 항목 페이지 조정 <span style="font-weight:400;color:#475569;">(선택)</span></div>';
        h += '<div id="mfEditExtraList"></div>';
        h += '<button onclick="_mfSaveExtraEdits()" style="padding:8px 0;border-radius:7px;background:#f59e0b;color:#fff;font-size:11px;font-weight:900;border:none;cursor:pointer;width:100%;margin-top:8px;">수정 내용 저장</button>';
        h += '</div>';
        h += '</div>'; // mfEditExtraPanel

        h += '</div>'; // mfEditForm

        // ── 등록된 항목 목록 ──
        h += '<div style="background:#0f172a;border-radius:10px;padding:14px;border:1.5px solid #1e293b;">';
        h += '<div style="font-size:11px;font-weight:900;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">📋 등록된 항목 목록</div>';
        h += '<input id="mfRangeSearch" oninput="_mfRangeFilter()" placeholder="🔍 이름 검색..." style="width:100%;padding:6px 10px;border-radius:7px;border:1.5px solid #334155;background:#1e293b;color:#e2e8f0;font-size:11px;outline:none;margin-bottom:8px;box-sizing:border-box;">';
        h += '<div id="mfRangeList" style="max-height:230px;overflow-y:auto;"></div>';
        h += '</div>';

        if(isAdm){
            h += '<div style="background:#0f172a;border-radius:10px;padding:12px 14px;margin-top:8px;border:1px solid #0369a1;">';
            h += '<div style="font-size:10px;font-weight:700;color:#38bdf8;margin-bottom:6px;">🔄 파일 매뉴얼 → 챗봇 검색 인덱스 동기화</div>';
            h += '<div style="font-size:9px;color:#475569;margin-bottom:6px;">등록된 항목이 챗봇에서 검색 안 될 때 실행</div>';
            h += '<button id="mfSyncIndexBtn" onclick="_mfSyncSearchIndex()" style="padding:7px 0;border-radius:7px;background:#0369a1;color:#bae6fd;font-size:11px;font-weight:900;border:none;cursor:pointer;width:100%;">🔄 검색 인덱스 전체 동기화</button>';
            h += '</div>';
            h += '<div style="background:#0f172a;border-radius:10px;padding:12px 14px;margin-top:8px;border:1px solid #7f1d1d;">';
            h += '<div style="font-size:10px;font-weight:700;color:#ef4444;margin-bottom:6px;">⚠ 위험 — 현재 모드 매뉴얼 전체 삭제</div>';
            h += '<button onclick="_mfResetAll()" style="padding:7px 0;border-radius:7px;background:#7f1d1d;color:#fca5a5;font-size:11px;font-weight:900;border:none;cursor:pointer;width:100%;">🗑 매뉴얼 전체 초기화 (DB + 이미지)</button>';
            h += '</div>';
        }

        wrap.innerHTML = h;
        _mfSetMgmtMode(_mfMgmtMode);
        _mfSetRegTab(_mfRegTab);
        // 모달 닫았다 다시 열어도 상태 복원
        _mfRenderPageThumbs();
        _mfRenderPendingList();
        if(_mfProgressHtml){
            var _pg = document.getElementById('mfNewProgress');
            if(_pg) _pg.innerHTML = _mfProgressHtml;
        }
        if(_mfRendered){
            var _infoEl = document.getElementById('mfRenderedInfo');
            var _fromEl = document.getElementById('mfEntryFrom');
            var _toEl   = document.getElementById('mfEntryTo');
            var _endPg  = _mfRendered.startFrom + _mfRendered.numPages - 1;
            if(_infoEl) _infoEl.textContent = '(p.'+_mfRendered.startFrom+' ~ p.'+_endPg+', '+_mfRendered.numPages+'페이지)';
            if(_fromEl) _fromEl.value = _mfRendered.startFrom;
            if(_toEl)   _toEl.value   = _endPg;
        }
        // 이미지 직접 업로드 진행 상태 복원
        if(_mfImgUploadState){
            var _pw = document.getElementById('mfImgUploadProgress');
            var _pt = document.getElementById('mfImgUploadText');
            var _pc = document.getElementById('mfImgUploadCount');
            var _pb = document.getElementById('mfImgUploadBar');
            var _lbl= document.getElementById('mfImgUploadLabel');
            if(_pw) _pw.style.display='block';
            if(_pt){ _pt.textContent=_mfImgUploadState.text; if(_mfImgUploadState.done) _pt.style.color='#4ade80'; }
            if(_pc) _pc.textContent=_mfImgUploadState.count;
            if(_pb){ _pb.style.width=_mfImgUploadState.pct+'%'; if(_mfImgUploadState.done) _pb.style.background='#22c55e'; }
            if(_lbl && _mfImgUploading){ _lbl.style.pointerEvents='none'; _lbl.style.opacity='0.5'; }
        }
    }

    function _mfSetMgmtMode(mode){
        _mfMgmtMode = mode;
        ['mania','bay'].forEach(function(m){
            var btn = document.getElementById('mfMgmtMode_'+m);
            if(!btn) return;
            var active = m===mode;
            var col = m==='mania' ? '#0284c7' : '#e85d04';
            btn.style.background = active ? col : 'none';
            btn.style.borderColor = active ? col : '#334155';
            btn.style.color = active ? '#fff' : '#94a3b8';
        });
        // 모드 전환 시 이전 모드 이미지 초기화
        window._mfPageUrls = [];
        _mfRegisteredRanges = [];
        _mfRenderPageThumbs();
        // 불러오기 버튼 텍스트 초기화
        var loadBtn = document.getElementById('mfLoadThumbsBtn');
        if(loadBtn){ loadBtn.disabled=false; loadBtn.textContent='📷 저장된 이미지 불러오기'; }
        _mfLoadCats(mode); // Firebase에서 카테고리 로드 후 select 갱신
        _mfFillEditSel(mode);
        _mfLoadRanges(mode);
        _mfEditCache = null; // 모드 전환 시 항목 수정 캐시 초기화
        if(mode === 'bay') _mfRepairBayRanges();
    }

    function _mfSetRegTab(tab){
        _mfRegTab = tab;
        ['new','edit'].forEach(function(t){
            var btn   = document.getElementById('mfRegTab_'+t);
            var panel = document.getElementById('mfRegPanel_'+t);
            if(!btn||!panel) return;
            var active = t===tab;
            btn.style.background = active ? '#0f172a' : 'none';
            btn.style.color      = active ? '#e2e8f0' : '#475569';
            panel.style.display  = active ? '' : 'none';
        });
    }

    function _mfFillEntryCat(mode){
        var cats = mode==='mania' ? _MANIA_CATS : _BAY_CATS;
        ['mfEntryCat','mfViewerEntryCat'].forEach(function(id){
            var sel = document.getElementById(id);
            if(!sel) return;
            var cur = sel.value;
            sel.innerHTML = cats.map(function(c){ return '<option value="'+escHtml(c)+'"'+(c===cur?' selected':'')+'>'+escHtml(c)+'</option>'; }).join('');
        });
    }

    async function _mfLoadCats(mode){
        try{
            var saved = await _authFetch('manual_cats/'+mode+'.json');
            if(saved && Array.isArray(saved) && saved.length){
                if(mode==='mania') _MANIA_CATS = saved;
                else _BAY_CATS = saved;
            }
        }catch(e){}
        _mfFillEntryCat(mode);
    }

    async function _mfSaveCats(mode){
        var cats = mode==='mania' ? _MANIA_CATS : _BAY_CATS;
        await _authFetch('manual_cats/'+mode+'.json','PUT',cats);
    }

    function _mfToggleCatAdd(){
        var wrap = document.getElementById('mfCatAddWrap');
        if(!wrap) return;
        var show = wrap.style.display === 'none';
        wrap.style.display = show ? 'flex' : 'none';
        if(show){ var inp = document.getElementById('mfCatAddInput'); if(inp){ inp.value=''; inp.focus(); } }
    }

    async function _mfConfirmAddCat(){
        var inp = document.getElementById('mfCatAddInput');
        if(!inp) return;
        var name = inp.value.trim();
        if(!name){ inp.focus(); return; }
        var mode = _mfMgmtMode;
        var cats = mode==='mania' ? _MANIA_CATS : _BAY_CATS;
        if(cats.indexOf(name) >= 0){ alert('이미 있는 카테고리입니다.'); inp.focus(); return; }
        cats.push(name);
        await _mfSaveCats(mode);
        _mfFillEntryCat(mode);
        var sel = document.getElementById('mfEntryCat');
        if(sel) sel.value = name;
        _mfCancelAddCat();
    }

    function _mfCancelAddCat(){
        var wrap = document.getElementById('mfCatAddWrap');
        if(wrap) wrap.style.display = 'none';
    }

    async function _mfDelCat(){
        var sel = document.getElementById('mfEntryCat');
        if(!sel || !sel.value) return;
        var val = sel.value;
        var mode = _mfMgmtMode;
        var cats = mode==='mania' ? _MANIA_CATS : _BAY_CATS;
        if(cats.length <= 1){ alert('카테고리가 1개 이하일 때는 삭제할 수 없습니다.'); return; }
        if(!confirm('"'+val+'" 카테고리를 삭제할까요?')) return;
        var idx = cats.indexOf(val);
        if(idx >= 0) cats.splice(idx, 1);
        await _mfSaveCats(mode);
        _mfFillEntryCat(mode);
    }

    function _mfViewerToggleCatAdd(){
        var wrap = document.getElementById('mfViewerCatAddWrap');
        if(!wrap) return;
        var show = wrap.style.display === 'none';
        wrap.style.display = show ? 'flex' : 'none';
        if(show){ var inp = document.getElementById('mfViewerCatAddInput'); if(inp){ inp.value=''; inp.focus(); } }
    }
    async function _mfViewerConfirmAddCat(){
        var inp = document.getElementById('mfViewerCatAddInput');
        if(!inp) return;
        var name = inp.value.trim();
        if(!name){ inp.focus(); return; }
        var mode = _mfMgmtMode;
        var cats = mode==='mania' ? _MANIA_CATS : _BAY_CATS;
        if(cats.indexOf(name) >= 0){ alert('이미 있는 카테고리입니다.'); inp.focus(); return; }
        cats.push(name);
        await _mfSaveCats(mode);
        _mfFillEntryCat(mode);
        var sel = document.getElementById('mfViewerEntryCat');
        if(sel) sel.value = name;
        _mfViewerCancelAddCat();
    }
    function _mfViewerCancelAddCat(){
        var wrap = document.getElementById('mfViewerCatAddWrap');
        if(wrap) wrap.style.display = 'none';
    }
    async function _mfViewerDelCat(){
        var sel = document.getElementById('mfViewerEntryCat');
        if(!sel || !sel.value) return;
        var val = sel.value;
        var mode = _mfMgmtMode;
        var cats = mode==='mania' ? _MANIA_CATS : _BAY_CATS;
        if(cats.length <= 1){ alert('카테고리가 1개 이하일 때는 삭제할 수 없습니다.'); return; }
        if(!confirm('"'+val+'" 카테고리를 삭제할까요?')) return;
        var idx = cats.indexOf(val);
        if(idx >= 0) cats.splice(idx, 1);
        await _mfSaveCats(mode);
        _mfFillEntryCat(mode);
    }

    async function _mfDoRenameCat(oldName, newName, onDone){
        if(!newName || newName === oldName){ if(onDone) onDone(); return; }
        var mode = _mfMgmtMode;
        var cats = mode==='mania' ? _MANIA_CATS : _BAY_CATS;
        var idx = cats.indexOf(oldName);
        if(idx < 0) return;
        if(cats.indexOf(newName) >= 0){ alert('이미 있는 카테고리 이름입니다.'); return; }
        cats[idx] = newName;
        await _mfSaveCats(mode);
        var allRaw = await _authFetch('manual_page_ranges/'+mode+'.json');
        if(allRaw && typeof allRaw === 'object'){
            for(var _rk in allRaw){
                if((allRaw[_rk].category||'') === oldName){
                    await _authFetch('manual_page_ranges/'+mode+'/'+_rk+'/category.json','PUT',newName);
                }
            }
        }
        _mfFillEntryCat(mode);
        if(onDone) onDone(newName);
        _mfLoadRanges(mode);
    }

    function _mfViewerToggleCatRename(){
        var sel = document.getElementById('mfViewerEntryCat');
        if(!sel || !sel.value) return;
        var wrap = document.getElementById('mfViewerCatRenameWrap');
        var addWrap = document.getElementById('mfViewerCatAddWrap');
        if(!wrap) return;
        var show = wrap.style.display === 'none';
        if(addWrap) addWrap.style.display = 'none';
        wrap.style.display = show ? 'flex' : 'none';
        if(show){
            var inp = document.getElementById('mfViewerCatRenameInput');
            if(inp){ inp.value = sel.value; inp.focus(); inp.select(); }
        }
    }
    async function _mfViewerConfirmRenameCat(){
        var sel = document.getElementById('mfViewerEntryCat');
        var inp = document.getElementById('mfViewerCatRenameInput');
        if(!sel || !inp) return;
        var oldName = sel.value, newName = inp.value.trim();
        _mfViewerCancelRenameCat();
        await _mfDoRenameCat(oldName, newName, function(n){ var s=document.getElementById('mfViewerEntryCat'); if(s&&n) s.value=n; });
    }
    function _mfViewerCancelRenameCat(){
        var wrap = document.getElementById('mfViewerCatRenameWrap');
        if(wrap) wrap.style.display = 'none';
    }

    function _mfToggleEditCatRename(){
        var sel = document.getElementById('mfEditFCat');
        if(!sel || !sel.value) return;
        var wrap = document.getElementById('mfEditCatRenameWrap');
        if(!wrap) return;
        var show = wrap.style.display === 'none';
        wrap.style.display = show ? 'flex' : 'none';
        if(show){
            var inp = document.getElementById('mfEditCatRenameInput');
            if(inp){ inp.value = sel.value; inp.focus(); inp.select(); }
        }
    }
    async function _mfConfirmEditCatRename(){
        var sel = document.getElementById('mfEditFCat');
        var inp = document.getElementById('mfEditCatRenameInput');
        if(!sel || !inp) return;
        var oldName = sel.value, newName = inp.value.trim();
        _mfCancelEditCatRename();
        await _mfDoRenameCat(oldName, newName, function(n){ var s=document.getElementById('mfEditFCat'); if(s&&n) s.value=n; });
    }
    function _mfCancelEditCatRename(){
        var wrap = document.getElementById('mfEditCatRenameWrap');
        if(wrap) wrap.style.display = 'none';
    }

    function _mfViewerAddItem(){
        var p = window._mfPageUrls ? window._mfPageUrls[_mfViewerIdx] : null;
        var from = parseInt(document.getElementById('mfEntryFrom').value)||0;
        var to   = parseInt(document.getElementById('mfEntryTo').value)||0;
        if(from && to && from !== to){
            _mfViewerRegFromTo(from, to);
        } else if(from){
            _mfViewerRegFromTo(from, from);
        } else if(p){
            _mfViewerRegFromTo(p.page, p.page);
        } else {
            alert('페이지 이미지가 없습니다.');
        }
    }

    async function _mfFillEditSel(mode){
        var sel = document.getElementById('mfEditSel');
        if(!sel) return;
        sel.innerHTML = '<option value="">-- 항목을 선택하세요 --</option>';
        var raw = await _authFetch('manual_page_ranges/'+mode+'.json');
        if(!raw) return;
        Object.entries(raw).sort(function(a,b){ return (a[1].start||0)-(b[1].start||0); }).forEach(function(e){
            var key=e[0], r=e[1];
            var opt = document.createElement('option');
            opt.value = key;
            opt.textContent = (r.title||key)+' (p.'+r.start+'~'+r.end+')';
            opt.dataset.start = r.start; opt.dataset.end = r.end;
            opt.dataset.title = r.title||key; opt.dataset.cat = r.category||'';
            sel.appendChild(opt);
        });
    }

    function _mfOnEditSel(){
        var sel       = document.getElementById('mfEditSel');
        var infoEl    = document.getElementById('mfEditInfo');
        var renderPnl = document.getElementById('mfEditRenderPanel');
        var extraPnl  = document.getElementById('mfEditExtraPanel');
        var progEl    = document.getElementById('mfEditProgress');
        if(progEl) progEl.textContent = '';
        if(extraPnl) extraPnl.style.display = 'none';
        var kwsPanel = document.getElementById('mfEditKwsPanel');
        if(!sel||!sel.value){
            if(infoEl) infoEl.textContent = '';
            if(renderPnl) renderPnl.style.display = 'none';
            if(kwsPanel) kwsPanel.style.display = 'none';
            return;
        }
        var opt = sel.options[sel.selectedIndex];
        var cat = opt.dataset.cat ? ' · '+opt.dataset.cat : '';
        if(infoEl) infoEl.innerHTML = '현재 페이지: <strong style="color:#e2e8f0;">p.'+opt.dataset.start+' ~ p.'+opt.dataset.end+'</strong>'+escHtml(cat);
        if(renderPnl) renderPnl.style.display = '';
        // 키워드 불러오기
        if(kwsPanel){ kwsPanel.style.display = ''; }
        var kwsInput = document.getElementById('mfEditKeywords');
        if(kwsInput){
            kwsInput.value = '';
            _authFetch('manual_page_ranges/'+_mfMgmtMode+'/'+sel.value+'/keywords.json').then(function(kws){
                if(kwsInput && kws) kwsInput.value = kws;
            });
        }
    }

    async function _mfAutoStart(){
        var progEl = document.getElementById('mfNewProgress');
        if(progEl) progEl.textContent = '현재 마지막 페이지 확인 중...';
        var total = await _mfGetMaxPage(_mfMgmtMode);
        var startEl = document.getElementById('mfNewStart');
        if(startEl) startEl.value = total+1;
        if(progEl) progEl.textContent = '현재 '+total+'페이지 → 시작 페이지: '+(total+1)+'으로 설정됐습니다.';
    }

    async function _mfGetMaxPage(mode){
        var max = 0;
        // 메타 파일 (업로드 시 기록)
        try{
            var meta = await _authFetch('manual_meta/'+mode+'/maxPage.json');
            if(meta && typeof meta==='number' && meta>0) max = Math.max(max, meta);
        }catch(e){}
        // 등록 항목 기준
        try{
            var raw = await _authFetch('manual_page_ranges/'+mode+'.json');
            if(raw) Object.values(raw).forEach(function(r){ if((r.end||0)>max) max=r.end; });
        }catch(e){}
        // DB 실제 저장 파일 기준 (가장 신뢰성 높음 — 메타 파일이 오래됐어도 보정)
        try{
            var dbPages = await _listDbPages(mode);
            if(dbPages.length) max = Math.max(max, dbPages[dbPages.length-1]);
        }catch(e){}
        // 세 소스 중 최댓값으로 maxPage 메타 갱신 (다음 호출부터 빠르게 읽도록)
        if(max>0){
            try{ await _authFetch('manual_meta/'+mode+'/maxPage.json','PUT',max); }catch(e){}
        }
        return max;
    }

    // ── 신규: 렌더링만 먼저 실행 ──
    function _mfCancelRenderNow(){
        _mfCancelRender = true;
        var btn = document.getElementById('mfCancelBtn');
        if(btn){ btn.disabled=true; btn.textContent='취소 중...'; }
    }

    async function _mfUploadImgFiles(filesOverride){
        var progWrap = document.getElementById('mfImgUploadProgress');
        var progText = document.getElementById('mfImgUploadText');
        var progCnt  = document.getElementById('mfImgUploadCount');
        var progBar  = document.getElementById('mfImgUploadBar');
        var label    = document.getElementById('mfImgUploadLabel');
        var startEl  = document.getElementById('mfNewStart');
        var rawFiles = filesOverride || (function(){ var inp=document.getElementById('mfImgFiles'); return inp&&inp.files?Array.from(inp.files):[]; })();
        if(!rawFiles || !rawFiles.length) return;
        var startPage = parseInt(startEl ? startEl.value : '1', 10);
        if(!startPage || startPage < 1){ alert('시작 페이지를 먼저 입력해주세요.'); return; }
        var mode = _mfMgmtMode;

        // 파일명 기준 정렬 (숫자 순서)
        var files = rawFiles.slice().sort(function(a,b){
            return a.name.localeCompare(b.name, undefined, {numeric:true});
        });
        var total = files.length;

        // 파일명 끝 숫자를 페이지 번호로 추출 (예: "page-041.jpg" → 41, "123.jpg" → 123)
        function _fnPageNum(name, fallback){
            var m = name.replace(/\.[^.]+$/, '').match(/(\d+)$/);
            return m ? parseInt(m[1], 10) : fallback;
        }

        // UI 잠금 + 전역 상태 시작 (동기적으로 즉시 표시)
        _mfImgUploading = true;
        _mfImgUploadState = {text:'⬆ 준비 중...', count:'0 / '+total, pct:0, done:false};
        if(label){ label.style.pointerEvents='none'; label.style.opacity='0.5';
            var _firstNode = label.firstChild;
            if(_firstNode && _firstNode.nodeType===3) _firstNode.nodeValue = '⬆ 업로드 준비 중... ('+total+'장)';
        }
        if(progWrap){ progWrap.style.display='block'; }
        if(progText) progText.textContent = '⬆ 이미 업로드된 파일 확인 중...';
        if(progCnt)  progCnt.textContent  = '';
        if(progBar)  progBar.style.width  = '0%';
        await new Promise(function(r){ requestAnimationFrame(function(){ requestAnimationFrame(r); }); });

        // 덮어쓰기 모드: 체크 시 기존 페이지 건너뛰지 않음
        var overwriteEl = document.getElementById('mfImgOverwrite');
        var overwrite = overwriteEl && overwriteEl.checked;
        var existingPages = new Set();
        if(!overwrite){
            try{
                var dbExisting = await _listDbPages(mode);
                dbExisting.forEach(function(n){ existingPages.add(n); });
            }catch(e){ console.warn('기존 목록 조회 실패, 전체 업로드로 진행:', e); }
        }

        var uploaded = 0, failed = 0, skipped = 0;
        var lastUploadedPage = 0, maxPageNum = 0;
        for(var i=0; i<files.length; i++){
            // 파일명 숫자가 startPage보다 작으면 PDF 내보내기 파일(001.jpg 등)로 판단해 startPage 기준으로 계산
            var _fnNum = _fnPageNum(files[i].name, startPage + i);
            var pageNum = (_fnNum >= startPage) ? _fnNum : (startPage + i);
            if(pageNum > maxPageNum) maxPageNum = pageNum;
            var padded  = String(pageNum).padStart(3,'0');
            var storagePath = 'manual_pages/'+mode+'/page-'+padded+'.jpg';

            // 이미 존재하면 건너뜀
            if(existingPages.has(pageNum)){
                skipped++;
                var pct0 = Math.round((i+1)/total*100);
                var txt0 = '⏭ 건너뜀 p.'+pageNum+' (이미 업로드됨)';
                var cnt0 = (i+1)+' / '+total+' (건너뜀 '+skipped+'장)';
                _mfImgUploadState = {text:txt0, count:cnt0, pct:pct0, done:false};
                _mfUpdateNavBadge();
                var _lpt0=document.getElementById('mfImgUploadText'); var _lpc0=document.getElementById('mfImgUploadCount'); var _lpb0=document.getElementById('mfImgUploadBar');
                if(_lpt0) _lpt0.textContent=txt0; if(_lpc0) _lpc0.textContent=cnt0; if(_lpb0) _lpb0.style.width=pct0+'%';
                continue;
            }

            try{
                await _savePageToDb(mode, pageNum, files[i]);
                uploaded++;
                if(pageNum > lastUploadedPage) lastUploadedPage = pageNum;
            }catch(e){
                failed++;
                console.warn('업로드 실패:', files[i].name, e);
            }
            var pct = Math.round((i+1)/total*100);
            var txt = '⬆ 업로드 중... p.'+pageNum;
            var cnt = (i+1)+' / '+total+' ('+pct+'%)';
            _mfImgUploadState = {text:txt, count:cnt, pct:pct, done:false};
            _mfUpdateNavBadge();
            var _lpt=document.getElementById('mfImgUploadText'); var _lpc=document.getElementById('mfImgUploadCount'); var _lpb=document.getElementById('mfImgUploadBar');
            if(_lpt) _lpt.textContent=txt; if(_lpc) _lpc.textContent=cnt; if(_lpb) _lpb.style.width=pct+'%';
        }

        // maxPage: 실제 처리된 페이지 번호 기준 (건너뜀 포함)
        var lastPage = maxPageNum || (startPage + files.length - 1);
        if(lastPage > 0){
            await _authFetch('manual_meta/'+mode+'/maxPage.json','PUT',lastPage);
            _mfTotalPdfPages = lastPage;
        }

        // 완료 상태
        var skipMsg  = skipped ? ' ('+skipped+'장 건너뜀)' : '';
        var failMsg  = failed  ? ' ⚠ '+failed+'장 실패' : '';
        var doneText = '✅ 완료'+failMsg;
        var doneCnt  = uploaded+'장 업로드됨'+skipMsg+(lastPage?' (p.'+startPage+'~p.'+lastPage+')':'');
        _mfImgUploading = false;
        _mfUploadDone   = true;
        _mfImgUploadState = {text:doneText, count:doneCnt, pct:100, done:true};

        var _lpt2 = document.getElementById('mfImgUploadText');
        var _lpc2 = document.getElementById('mfImgUploadCount');
        var _lpb2 = document.getElementById('mfImgUploadBar');
        if(_lpt2){ _lpt2.textContent=doneText; _lpt2.style.color='#4ade80'; }
        if(_lpc2) _lpc2.textContent=doneCnt;
        if(_lpb2){ _lpb2.style.width='100%'; _lpb2.style.background='#22c55e'; }

        // 렌더링 상태 업데이트
        _mfRendered = {mode:mode, startFrom:startPage, numPages:files.length, fileName:'이미지 직접 업로드', storePath:'', downloadURL:''};
        _mfUpdateNavBadge();

        // 버튼 복구 + 자동 로드
        var _lbl2 = document.getElementById('mfImgUploadLabel');
        if(_lbl2){
            _lbl2.style.pointerEvents='';
            _lbl2.style.opacity='';
            var _fn = _lbl2.firstChild;
            if(_fn && _fn.nodeType===3) _fn.nodeValue = '📄🖼 PDF 또는 이미지 선택 (여러 장 가능)';
        }
        if(!failed){ _mfLoadStorageThumbs(uploaded, skipped, startPage); }
    }

    function _mfHandleFiles(){
        var input = document.getElementById('mfCombinedFile');
        var files = input ? Array.from(input.files) : [];
        if(!files.length) return;
        var pdfFile = files.find(function(f){ return f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf'); });
        if(pdfFile){
            _mfDoRender(pdfFile);
        } else {
            _mfUploadImgFiles(files);
        }
        if(input) input.value='';
    }

    async function _mfDoRender(fileOverride){
        var startEl = document.getElementById('mfNewStart');
        var prog    = document.getElementById('mfNewProgress');
        var start   = parseInt(startEl ? startEl.value : '0', 10);
        var file    = fileOverride || null;
        if(!file) return;
        if(!start||start<1){ alert('"자동 확인" 버튼을 눌러 시작 페이지를 설정하거나 직접 입력해주세요.'); return; }
        // 취소 버튼 표시
        _mfCancelRender = false;
        if(prog) prog.innerHTML = '이미지 변환 준비 중... <button id="mfCancelBtn" onclick="_mfCancelRenderNow()" style="margin-left:8px;padding:2px 10px;border-radius:5px;background:#7f1d1d;color:#fca5a5;border:none;font-size:10px;font-weight:900;cursor:pointer;">✕ 취소</button>';

        var mode = _mfMgmtMode;
        var ts   = Date.now();
        var safeName = ts+'_'+file.name.replace(/[^\w가-힣._-]/g,'_');
        var storePath = 'manuals/'+safeName;

        // PDF → 이미지 변환
        var numPages = await _renderPdfToManualPages(mode, file, prog, start);
        // 취소 버튼 제거
        var cancelBtn = document.getElementById('mfCancelBtn');
        if(cancelBtn) cancelBtn.remove();
        if(_mfCancelRender){
            _mfCancelRender = false;
            if(prog) prog.textContent = '⚠ 변환이 취소되었습니다.';
            if(fileEl) fileEl.value='';
            _mfRenderPageThumbs();
            return;
        }
        if(!numPages){ if(fileEl) fileEl.value=''; return; }

        // 원본 PDF → 파일 목록에도 자동 저장
        if(prog) prog.textContent = '파일 목록 저장 중...';
        try{
            var snap = await storage.ref(storePath).put(file);
            var url  = await snap.ref.getDownloadURL();
            var entry = {
                title: file.name.replace(/\.[^.]+$/,''),
                fileName: file.name, storagePath: storePath, downloadURL: url,
                uploadedBy: (_currentUser&&_currentUser.name)||'', uploadedAt: ts,
                mode: mode, status: 'approved',
                approvedBy: (_currentUser&&_currentUser.name)||'', approvedAt: ts
            };
            await _authFetch('imi_manual_files/'+ts+'.json','PUT',entry);
            _mfRendered = {mode:mode, startFrom:start, numPages:numPages, fileName:file.name, storePath:storePath, downloadURL:url};
        }catch(e){
            _mfRendered = {mode:mode, startFrom:start, numPages:numPages, fileName:file.name};
        }

        var endPage = start + numPages - 1;
        if(endPage > (_mfTotalPdfPages||0)){
            _mfTotalPdfPages = endPage;
            _authFetch('manual_meta/'+mode+'/maxPage.json','PUT',endPage);
        }
        if(prog) prog.textContent = '✅ '+numPages+'페이지 변환 완료 · 파일 목록 자동 저장됨';

        // 항목 등록 패널 활성화
        var entryPanel = document.getElementById('mfEntryPanel');
        var infoEl     = document.getElementById('mfRenderedInfo');
        var fromEl     = document.getElementById('mfEntryFrom');
        var toEl       = document.getElementById('mfEntryTo');
        if(infoEl) infoEl.textContent = '(p.'+start+' ~ p.'+endPage+', '+numPages+'페이지)';
        if(fromEl) fromEl.value = start;
        if(toEl)   toEl.value   = endPage;
        if(entryPanel) entryPanel.style.display = '';
        _mfFillEntryCat(mode);
        _mfPending = [];
        _mfRenderPendingList();
        _mfRenderPageThumbs();
        if(fileEl) fileEl.value = '';
    }

    // ── 신규: 항목 추가 ──
    function _mfAddPending(){
        var nameEl = document.getElementById('mfEntryName');
        var catEl  = document.getElementById('mfEntryCat');
        var fromEl = document.getElementById('mfEntryFrom');
        var toEl   = document.getElementById('mfEntryTo');
        var name   = nameEl ? nameEl.value.trim() : '';
        var cat    = catEl  ? catEl.value : '';
        var from   = parseInt(fromEl ? fromEl.value : '0', 10);
        var to     = parseInt(toEl   ? toEl.value   : '0', 10);
        if(!name){ alert('항목명을 입력해주세요.'); return; }
        if(!from||!to||from<1||to<from){ alert('올바른 페이지 범위를 입력해주세요. (시작 ≤ 끝)'); return; }
        // 렌더링된 범위 벗어나는지 경고
        if(_mfRendered){
            var rEnd = _mfRendered.startFrom + _mfRendered.numPages - 1;
            if(from < _mfRendered.startFrom || to > rEnd){
                if(!confirm('입력한 범위(p.'+from+'~p.'+to+')가 렌더링된 범위(p.'+_mfRendered.startFrom+'~p.'+rEnd+') 밖입니다.\n계속 추가하시겠습니까?')) return;
            }
        }
        var kwsEl = document.getElementById('mfEntryKeywords');
        var kws = kwsEl ? kwsEl.value.trim() : '';
        _mfPending.push({name:name, cat:cat, from:from, to:to, keywords:kws, cropTop:_mfViewerCropTop||0, cropBottom:(_mfViewerCropBot!==undefined?_mfViewerCropBot:100)});
        _mfViewerCropTop=0; _mfViewerCropBot=100; // 다음 항목을 위해 초기화
        if(nameEl) nameEl.value = '';
        if(kwsEl)  kwsEl.value  = '';
        // 다음 항목 시작은 이전 끝+1 자동 설정
        if(fromEl) fromEl.value = to+1;
        if(toEl)   toEl.value   = _mfRendered ? (_mfRendered.startFrom+_mfRendered.numPages-1) : to+1;
        _mfRenderPendingList();
    }

    function _mfRenderPendingList(){
        var listEl  = document.getElementById('mfPendingList');
        var saveBtn = document.getElementById('mfSaveAllBtn');
        if(!listEl) return;
        if(!_mfPending.length){ listEl.innerHTML=''; if(saveBtn) saveBtn.style.display='none'; return; }
        var h = '';
        _mfPending.forEach(function(e,i){
            var hasCrop = e.cropTop > 0 || e.cropBottom < 100;
            var cropBadge = hasCrop
                ? '<span style="font-size:9px;color:#3abff8;margin-left:5px;font-weight:700;">✂ '+e.cropTop+'%~'+e.cropBottom+'%</span>'
                : '';
            h += '<div style="padding:6px 8px;border-radius:7px;background:#0f172a;margin-bottom:4px;border:1px solid #1e293b;">';
            h += '<div style="display:flex;align-items:center;gap:5px;">';
            h += '<div style="flex:1;min-width:0;">';
            h += '<div style="font-size:11px;font-weight:700;color:#e2e8f0;">'+escHtml(e.name)+cropBadge+'</div>';
            h += '<div style="font-size:10px;color:#475569;margin-top:1px;">'+escHtml(e.cat)+' · p.'+e.from+'~'+e.to+'</div>';
            if(e.keywords) h += '<div style="font-size:9px;color:#64748b;margin-top:1px;">🔑 '+escHtml(e.keywords)+'</div>';
            h += '</div>';
            h += '<button onclick="_mfOpenCropForPending('+i+')" style="padding:3px 8px;border-radius:6px;background:none;border:1px solid '+(hasCrop?'#3abff8':'#334155')+';color:#3abff8;font-size:11px;cursor:pointer;flex-shrink:0;" title="이미지 영역 설정">✂️</button>';
            h += '<button onclick="_mfRemovePending('+i+')" style="padding:3px 8px;border-radius:6px;background:none;border:1px solid #334155;color:#ef4444;font-size:10px;cursor:pointer;flex-shrink:0;">삭제</button>';
            h += '</div>';
            h += '</div>';
        });
        listEl.innerHTML = h;
        if(saveBtn) saveBtn.style.display = '';
        _mfUpdateNavBadge();
    }

    function _mfRemovePending(idx){
        _mfPending.splice(idx,1);
        _mfRenderPendingList();
    }

    function _mfRenderPageThumbs(){
        var thumbsEl   = document.getElementById('mfPageThumbs');
        var resumeBar  = document.getElementById('mfThumbResumeBanner');
        if(!thumbsEl) return;
        if(!window._mfPageUrls || !window._mfPageUrls.length){
            thumbsEl.style.display='none';
            if(resumeBar) resumeBar.style.display='none';
            return;
        }
        thumbsEl.style.display = '';
        var h = '';
        window._mfPageUrls.forEach(function(p){
            var isReg = _mfRegisteredRanges.some(function(r){ return r.start && r.end && p.page >= r.start && p.page <= r.end; });
            h += '<div onclick="_mfThumbClick('+p.page+')" id="mfThumb_'+p.page+'" style="display:inline-block;cursor:pointer;text-align:center;margin-right:8px;vertical-align:top;border-radius:8px;padding:3px;border:2px solid '+(isReg?'#22c55e':'#1e293b')+';transition:border-color 0.15s;position:relative;" title="p.'+p.page+(isReg?' (등록됨)':' 클릭하여 크게 보기')+'">';
            h += '<img src="'+p.url+'" style="width:120px;height:155px;object-fit:cover;border-radius:5px;display:block;">';
            if(isReg) h += '<div style="position:absolute;top:3px;left:3px;right:3px;bottom:18px;border-radius:5px;background:rgba(34,197,94,0.18);display:flex;align-items:center;justify-content:center;pointer-events:none;"><span style="font-size:28px;color:#22c55e;font-weight:900;text-shadow:0 0 8px #000;">✓</span></div>';
            h += '<div style="font-size:10px;color:'+(isReg?'#22c55e':'#64748b')+';margin-top:4px;font-weight:700;">p.'+p.page+'</div>';
            h += '</div>';
        });
        thumbsEl.innerHTML = h;
        _mfUpdateNavBadge();
        // 이어서 등록 배너
        if(resumeBar){
            if(_mfRegisteredRanges.length > 0){
                var maxEnd = Math.max.apply(null, _mfRegisteredRanges.map(function(r){ return r.end||0; }));
                var nextPage = maxEnd + 1;
                var hasNext = window._mfPageUrls.some(function(p){ return p.page === nextPage; });
                resumeBar.style.display = 'flex';
                resumeBar.innerHTML = '<span>✅ 이미 '+_mfRegisteredRanges.length+'개 항목 등록됨 (마지막 p.'+maxEnd+')</span>'
                    + (hasNext
                        ? '<button onclick="_mfJumpToResume('+nextPage+')" style="padding:4px 12px;border-radius:6px;background:#22c55e;color:#000;font-size:11px;font-weight:900;border:none;cursor:pointer;flex-shrink:0;">▶ p.'+nextPage+'부터 이어서 등록</button>'
                        : '<span style="color:#64748b;">(모든 페이지 등록 완료)</span>');
            } else {
                resumeBar.style.display = 'none';
            }
        }
    }
    function _mfThumbClick(page){
        _mfOpenPageViewer(page);
    }
    function _mfJumpToResume(page){
        _mfOpenPageViewer(page);
        // 해당 페이지를 바로 시작 페이지로 자동 설정
        document.getElementById('mfEntryFrom').value = page;
        document.getElementById('mfEntryTo').value   = page;
        _mfViewerUpdateRangeBar();
        _mfUpdateThumbHighlight();
    }

    // ── 페이지 이미지 뷰어 ──
    var _mfViewerIdx = 0;
    var _mfViewerCropTop = 0;
    var _mfViewerCropBot = 100;

    function _mfOpenPageViewer(page){
        if(!window._mfPageUrls || !window._mfPageUrls.length){ alert('먼저 "📷 저장된 이미지 불러오기"를 눌러주세요.'); return; }
        _mfViewerIdx = window._mfPageUrls.findIndex(function(p){ return p.page === page; });
        if(_mfViewerIdx < 0) _mfViewerIdx = 0;
        document.getElementById('mfPageViewerModal').style.display = 'flex';
        _mfViewerFillCat();
        _mfViewerRender();
        document.addEventListener('keydown', _mfViewerKeydown);
    }
    function _mfCloseViewer(){
        document.getElementById('mfPageViewerModal').style.display = 'none';
        document.removeEventListener('keydown', _mfViewerKeydown);
    }
    function _mfViewerKeydown(e){
        if(e.key === 'ArrowLeft')  _mfViewerPrev();
        if(e.key === 'ArrowRight') _mfViewerNext();
        if(e.key === 'Escape')     _mfCloseViewer();
    }
    function _mfViewerPrev(){ if(_mfViewerIdx > 0){ _mfViewerIdx--; _mfViewerRender(); } }
    function _mfViewerNext(){ if(_mfViewerIdx < window._mfPageUrls.length-1){ _mfViewerIdx++; _mfViewerRender(); } }

    function _mfViewerRender(){
        var p = window._mfPageUrls[_mfViewerIdx];
        if(!p) return;
        var img  = document.getElementById('mfViewerImg');
        var wrap = document.getElementById('mfViewerImgWrap');
        // 이미지 로드 후 가로/세로 판별 → 레이아웃 자동 조정
        img.onload = function(){
            var landscape = this.naturalWidth >= this.naturalHeight;
            if(wrap){ wrap.style.maxWidth = landscape ? '960px' : '500px'; }
            this.style.maxHeight = landscape ? '' : '80vh';
            this.onload = null;
        };
        img.src = p.url;
        document.getElementById('mfViewerPageLabel').textContent = 'p.'+p.page;
        document.getElementById('mfViewerNavLabel').textContent = (_mfViewerIdx+1)+' / '+window._mfPageUrls.length;
        _mfViewerUpdateCropOverlay();
        _mfViewerUpdateRangeBar();
        _mfViewerUpdateRegLabel();
    }
    function _mfViewerUpdateRangeBar(){
        var from = parseInt(document.getElementById('mfEntryFrom').value)||0;
        var to   = parseInt(document.getElementById('mfEntryTo').value)||0;
        var bar  = document.getElementById('mfViewerRangeBar');
        if(!bar) return;
        if(from && to) bar.innerHTML = '선택 범위: <strong style="color:#4ade80;">p.'+from+' ~ p.'+to+'</strong>'
            +((_mfViewerCropTop||0)>0||_mfViewerCropBot<100 ? ' &nbsp;·&nbsp; <span style="color:#fb923c;">노출 '+_mfViewerCropTop+'%~'+_mfViewerCropBot+'%</span>' : '');
        else bar.textContent = '선택 범위: 없음 (아래 버튼으로 시작/끝 페이지 설정)';
        _mfViewerUpdateRegLabel();
    }
    function _mfViewerUpdateCropOverlay(){
        var topDim = document.getElementById('mfViewerCropTopDim');
        var botDim = document.getElementById('mfViewerCropBotDim');
        if(!topDim||!botDim) return;
        if(_mfViewerCropTop > 0){
            topDim.style.display='block'; topDim.style.height = _mfViewerCropTop+'%';
        } else { topDim.style.display='none'; }
        if(_mfViewerCropBot < 100){
            botDim.style.display='block'; botDim.style.height = (100-_mfViewerCropBot)+'%';
        } else { botDim.style.display='none'; }
    }
    function _mfViewerSetFrom(){
        var p = window._mfPageUrls[_mfViewerIdx];
        if(!p) return;
        document.getElementById('mfEntryFrom').value = p.page;
        document.getElementById('mfEntryTo').value   = p.page;
        _mfViewerUpdateRangeBar();
        _mfUpdateThumbHighlight();
    }
    function _mfViewerSetTo(){
        var p = window._mfPageUrls[_mfViewerIdx];
        if(!p) return;
        var from = parseInt(document.getElementById('mfEntryFrom').value)||0;
        if(from && p.page < from){ document.getElementById('mfEntryFrom').value = p.page; }
        else { document.getElementById('mfEntryTo').value = p.page; }
        _mfViewerUpdateRangeBar();
        _mfUpdateThumbHighlight();
    }
    function _mfViewerCrop(){
        var p = window._mfPageUrls[_mfViewerIdx];
        if(!p) return;
        window._currentCropData = {
            dbPath:'', imgUrl: p.url,
            cropTop: _mfViewerCropTop||0,
            cropBottom: _mfViewerCropBot!==undefined ? _mfViewerCropBot : 100,
            _pendingCallback: function(top, bot){
                _mfViewerCropTop = top;
                _mfViewerCropBot = bot;
                _mfViewerUpdateCropOverlay();
                _mfViewerUpdateRangeBar();
            }
        };
        openCropEditor();
    }
    function _mfViewerFillCat(){
        var sel = document.getElementById('mfViewerEntryCat');
        if(!sel) return;
        var cats = _mfMgmtMode==='mania' ? _MANIA_CATS : _BAY_CATS;
        sel.innerHTML = cats.map(function(c){ return '<option value="'+escHtml(c)+'">'+escHtml(c)+'</option>'; }).join('');
    }
    function _mfViewerUpdateRegLabel(){
        var p = window._mfPageUrls ? window._mfPageUrls[_mfViewerIdx] : null;
        var lbl = document.getElementById('mfViewerRegRangeLabel');
        if(!lbl) return;
        var from = parseInt(document.getElementById('mfEntryFrom').value)||0;
        var to   = parseInt(document.getElementById('mfEntryTo').value)||0;
        var cur  = p ? p.page : '?';
        if(from && to && from!==to){
            lbl.innerHTML = '현재: <strong style="color:#3abff8;">p.'+cur+'</strong> &nbsp; 범위: <strong style="color:#4ade80;">p.'+from+' ~ p.'+to+'</strong>';
        } else {
            lbl.innerHTML = '현재: <strong style="color:#3abff8;">p.'+cur+'</strong>';
        }
    }
    function _mfViewerRegFromTo(from, to){
        var nameEl = document.getElementById('mfViewerEntryName');
        var catEl  = document.getElementById('mfViewerEntryCat');
        var kwsEl  = document.getElementById('mfViewerEntryKeywords');
        var name = nameEl ? nameEl.value.trim() : '';
        if(!name){ alert('항목명을 입력해주세요.'); if(nameEl) nameEl.focus(); return; }
        var cat = catEl ? catEl.value : '';
        var kws = kwsEl ? kwsEl.value.trim() : '';
        if(_mfRendered){
            var rEnd = _mfRendered.startFrom + _mfRendered.numPages - 1;
            if(from < _mfRendered.startFrom || to > rEnd){
                if(!confirm('입력한 범위(p.'+from+'~p.'+to+')가 렌더링된 범위(p.'+_mfRendered.startFrom+'~p.'+rEnd+') 밖입니다.\n계속 추가하시겠습니까?')) return;
            }
        }
        _mfPending.push({name:name, cat:cat, from:from, to:to, keywords:kws, cropTop:_mfViewerCropTop||0, cropBottom:(_mfViewerCropBot!==undefined?_mfViewerCropBot:100)});
        _mfViewerCropTop=0; _mfViewerCropBot=100;
        if(nameEl) nameEl.value='';
        if(kwsEl)  kwsEl.value='';
        // 다음 항목 시작 자동 설정
        var nextFrom = to+1;
        var nextTo   = _mfRendered ? (_mfRendered.startFrom+_mfRendered.numPages-1) : nextFrom;
        document.getElementById('mfEntryFrom').value = nextFrom;
        document.getElementById('mfEntryTo').value   = nextTo;
        _mfViewerUpdateRangeBar();
        _mfUpdateThumbHighlight();
        _mfViewerUpdateRegLabel();
        _mfRenderPendingList();
        _mfUpdateNavBadge();
        var fbEl = document.getElementById('mfViewerRegFeedback');
        if(fbEl){
            fbEl.textContent = '✅ p.'+from+(from!==to?'~'+to:'')+' 추가됨!';
            fbEl.style.color = '#4ade80';
            fbEl.style.display = '';
            setTimeout(function(){ if(fbEl) fbEl.style.display='none'; }, 2500);
        }
    }
    function _mfViewerRegisterSingle(){
        var p = window._mfPageUrls ? window._mfPageUrls[_mfViewerIdx] : null;
        if(!p){ alert('페이지 이미지가 없습니다.'); return; }
        _mfViewerSaveDirect(p.page, p.page);
    }
    function _mfViewerRegisterRange(){
        var from = parseInt(document.getElementById('mfEntryFrom').value)||0;
        var to   = parseInt(document.getElementById('mfEntryTo').value)||0;
        if(!from||!to||from<1||to<from){ alert('먼저 "📌 시작 페이지로" / "📌 끝 페이지로" 버튼으로 범위를 지정해주세요.'); return; }
        _mfViewerSaveDirect(from, to);
    }
    async function _mfViewerSaveDirect(from, to){
        var nameEl = document.getElementById('mfViewerEntryName');
        var catEl  = document.getElementById('mfViewerEntryCat');
        var kwsEl  = document.getElementById('mfViewerEntryKeywords');
        var fbEl   = document.getElementById('mfViewerRegFeedback');
        var btnS   = document.getElementById('mfViewerBtnSingle');
        var btnR   = document.getElementById('mfViewerBtnRange');
        var name = nameEl ? nameEl.value.trim() : '';
        if(!name){ alert('항목명을 입력해주세요.'); if(nameEl) nameEl.focus(); return; }
        var cat  = catEl  ? catEl.value : '';
        var kws  = kwsEl  ? kwsEl.value.trim() : '';
        var mode = _mfMgmtMode;
        var idx  = mode==='bay' ? BAY_MANUAL_INDEX : MANUAL_INDEX;
        if(btnS) btnS.disabled=true;
        if(btnR) btnR.disabled=true;
        if(fbEl){ fbEl.textContent='저장 중...'; fbEl.style.color='#94a3b8'; fbEl.style.display=''; }
        var key = name.replace(/[.#$\[\]\/]/g,'_');
        var cropTop = _mfViewerCropTop||0;
        var cropBot = _mfViewerCropBot!==undefined ? _mfViewerCropBot : 100;
        var result = await _authFetch('manual_page_ranges/'+mode+'/'+key+'.json','PUT',{
            start:from, end:to, title:name, category:cat, keywords:kws, cropTop:cropTop, cropBottom:cropBot
        });
        if(result === null){
            if(fbEl){ fbEl.textContent='❌ 저장 실패! 새로고침 후 재시도'; fbEl.style.color='#ef4444'; }
            if(btnS) btnS.disabled=false;
            if(btnR) btnR.disabled=false;
            return;
        }
        if(!idx[name]){
            await _authFetch('imi_manual_index/'+mode+'/'+normalizeKey(name)+'.json','PUT',name);
            idx[name]='';
        }
        if(kws){
            var _kArr=kws.split(',').map(function(t){return t.trim();}).filter(function(t){return t.length>0;});
            if(_kArr.length) db.ref('keywords/'+mode+'/'+encodeForDb(name)).set(_kArr);
        }
        if(nameEl) nameEl.value='';
        if(kwsEl)  kwsEl.value='';
        _mfViewerCropTop=0; _mfViewerCropBot=100;
        if(fbEl){ fbEl.textContent='✅ p.'+from+'~'+to+' 저장됨!'; fbEl.style.color='#4ade80'; fbEl.style.display=''; }
        setTimeout(function(){ if(fbEl) fbEl.style.display='none'; }, 2500);
        // 등록 범위 즉시 반영
        _mfRegisteredRanges.push({start:from, end:to});
        _mfRenderPageThumbs();
        _mfLoadRanges(mode);
        _mfFillEditSel(mode);
        // 다음 페이지로 자동 이동
        var nextFrom = to+1;
        var fromOuter = document.getElementById('mfEntryFrom');
        var toOuter   = document.getElementById('mfEntryTo');
        if(fromOuter) fromOuter.value = nextFrom;
        if(toOuter)   toOuter.value   = nextFrom;
        _mfViewerUpdateRangeBar();
        _mfUpdateThumbHighlight();
        _mfViewerUpdateRegLabel();
        _mfUpdateNavBadge();
        if(btnS) btnS.disabled=false;
        if(btnR) btnR.disabled=false;
    }

    function _mfUpdateThumbHighlight(){
        var from = parseInt(document.getElementById('mfEntryFrom').value)||0;
        var to   = parseInt(document.getElementById('mfEntryTo').value)||0;
        if(!window._mfPageUrls) return;
        window._mfPageUrls.forEach(function(p){
            var el = document.getElementById('mfThumb_'+p.page);
            if(!el) return;
            el.style.borderColor = (p.page>=from && p.page<=to && from && to) ? '#22c55e' : '#1e293b';
        });
    }

    async function _mfRunMigrate(){
        var btn = document.getElementById('mfMigrateBtn');
        if(btn){ btn.disabled=true; btn.textContent='마이그레이션 중...'; }
        var mode = _mfMgmtMode;
        var done = await _migrateStorageToDb(mode, function(msg, cur, total){
            if(btn) btn.textContent = '☁ '+cur+'/'+total+' '+msg;
        });
        if(btn){ btn.disabled=false; btn.textContent='✅ 완료 '+done+'장 이전됨'; }
        alert('['+mode+'] 마이그레이션 완료! '+done+'장이 DB에 저장됐습니다.');
    }

    // 이미지 클릭 시 오버레이로 크게 보기
    window._mfImgZoom = function(src, label){
        var ov = document.createElement('div');
        ov.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;';
        ov.innerHTML='<div style="color:#94a3b8;font-size:11px;margin-bottom:8px;">'+label+' — 클릭해서 닫기</div>'
            +'<img src="'+src+'" style="max-width:90vw;max-height:85vh;border-radius:10px;object-fit:contain;">';
        ov.addEventListener('click', function(){ document.body.removeChild(ov); });
        document.body.appendChild(ov);
    };

    // fromPage 지정 시 해당 페이지만 로드 (업로드 직후 빠른 표시용)
    // fromPage 없으면 전체 로드 (버튼 클릭 or 중간 삽입용)
    async function _mfLoadStorageThumbs(newlyUploaded, skippedCount, fromPage){
        var btn = document.getElementById('mfLoadThumbsBtn');
        var mode = _mfMgmtMode;
        var onlyNew = typeof fromPage === 'number' && fromPage > 0 && typeof newlyUploaded === 'number' && newlyUploaded > 0;
        try{
            if(onlyNew){
                // 새로 업로드한 페이지만 로드 (fromPage ~ fromPage+newlyUploaded-1)
                var newPageUrls = [];
                var endPage = fromPage + newlyUploaded - 1;
                if(btn){ btn.disabled=true; btn.textContent='로딩 중... 0/'+newlyUploaded; }
                for(var p=fromPage;p<=endPage;p++){
                    try{
                        var url2 = await _getPageDataUrl(mode, String(p).padStart(3,'0'));
                        if(url2) newPageUrls.push({page:String(p).padStart(3,'0'), url:url2});
                    }catch(e2){}
                    if(btn) btn.textContent='로딩 중... '+(p-fromPage+1)+'/'+newlyUploaded;
                }
                // 기존 캐시에 추가 (중복 제거)
                var existing = (window._mfPageUrls||[]).filter(function(x){
                    return !newPageUrls.some(function(n){ return n.page===x.page; });
                });
                window._mfPageUrls = existing.concat(newPageUrls).sort(function(a,b){ return a.page < b.page ? -1 : 1; });
                _mfRenderPageThumbs();
                var skipTxt = skippedCount ? ' ('+skippedCount+'장 건너뜀)' : '';
                var dbTotal = await _mfGetMaxPage(mode);
                if(btn){ btn.disabled=false; btn.textContent='✅ '+newlyUploaded+'장 업로드됨'+skipTxt+' — DB 중 '+dbTotal+'장'; }
                _mfLoadRanges(_mfMgmtMode);
                return;
            }

            // 전체 로드 (버튼 클릭)
            if(btn){ btn.disabled=true; btn.textContent='불러오는 중...'; }
            var pageNums = await _listDbPages(mode);
            if(!pageNums.length){ alert('저장된 이미지가 없습니다. PDF를 먼저 업로드해주세요.'); return; }
            window._mfPageUrls = [];
            if(btn) btn.textContent = '로딩 중... 0/'+pageNums.length;
            for(var i=0;i<pageNums.length;i++){
                try{
                    var url = await _getPageDataUrl(mode, pageNums[i]);
                    if(url) window._mfPageUrls.push({page:pageNums[i], url:url});
                }catch(e2){}
                if(btn && i%10===9) btn.textContent = '로딩 중... '+(i+1)+'/'+pageNums.length;
            }
            _mfRenderPageThumbs();
            var total = window._mfPageUrls.length;
            if(btn){
                if(typeof newlyUploaded === 'number'){
                    var skipTxt2 = skippedCount ? ' ('+skippedCount+'장 건너뜀)' : '';
                    btn.textContent = '✅ '+newlyUploaded+'장 업로드됨'+skipTxt2+' — DB 총 '+total+'장';
                } else {
                    btn.textContent = '✅ '+total+'장 불러옴';
                }
            }
            if(window._mfPageUrls.length){
                var _pages = window._mfPageUrls.map(function(p){ return p.page; });
                var _minP  = Math.min.apply(null, _pages);
                var _maxP  = Math.max.apply(null, _pages);
                _mfRendered = {mode: mode, startFrom: _minP, numPages: _maxP - _minP + 1, fileName: 'DB 불러오기', storePath: '', downloadURL: ''};
            }
            _mfLoadRanges(_mfMgmtMode);
        }catch(e){
            alert('이미지 불러오기 실패: '+e.message);
        }finally{
            if(btn) btn.disabled=false;
        }
    }

    async function _mfOpenCropForPending(idx){
        var e = _mfPending[idx];
        if(!e) return;
        var cached = window._mfPageUrls && window._mfPageUrls.find(function(p){ return p.page === e.from; });
        var imgUrl;
        if(cached){ imgUrl = cached.url; }
        else {
            var pageNum = String(e.from).padStart(3,'0');
            try{ imgUrl = await _getPageDataUrl(_mfMgmtMode, pageNum); }
            catch(err){}
            if(!imgUrl){ alert('이미지를 불러올 수 없습니다. PDF 렌더링이 완료된 후 사용해주세요.'); return; }
        }
        window._currentCropData = {
            dbPath: '', imgUrl: imgUrl,
            cropTop: e.cropTop||0,
            cropBottom: e.cropBottom!==undefined ? e.cropBottom : 100,
            _pendingCallback: function(top, bot){
                _mfPending[idx].cropTop = top;
                _mfPending[idx].cropBottom = bot;
                _mfRenderPendingList();
            }
        };
        openCropEditor();
    }

    async function _mfSaveEditKeywords(){
        if(!_mfCurrentEditKey){ alert('항목을 먼저 선택해주세요.'); return; }
        var kws = (document.getElementById('mfEditFKws')||{}).value || '';
        await _authFetch('manual_page_ranges/'+_mfMgmtMode+'/'+_mfCurrentEditKey+'/keywords.json','PUT',kws.trim());
    }

    // ── 항목 수정 탭: 검색·목록·편집 ──
    function _mfEditFilter(){
        var q = ((document.getElementById('mfEditSearch')||{}).value||'').trim();
        _mfEditLoadList(q);
    }

    async function _mfEditLoadList(q, forceReload){
        var listEl = document.getElementById('mfEditItemList');
        if(!listEl) return;
        if(!_mfEditCache || forceReload){
            listEl.innerHTML = '<div style="font-size:11px;color:#475569;padding:8px;">로딩 중...</div>';
            var fetched = await _authFetch('manual_page_ranges/'+_mfMgmtMode+'.json');
            _mfEditCache = (fetched && typeof fetched === 'object') ? fetched : null;
        }
        var raw = _mfEditCache;
        if(!raw||typeof raw!=='object'){
            listEl.innerHTML='<div style="font-size:11px;color:#475569;padding:8px;">등록된 항목이 없습니다.</div>';
            return;
        }
        var entries = Object.entries(raw).sort(function(a,b){ return (a[1].start||0)-(b[1].start||0); });
        if(q){ var qL=q.toLowerCase(); entries = entries.filter(function(e){ var r=e[1]; return (r.title||e[0]).toLowerCase().includes(qL); }); }
        if(!entries.length){
            listEl.innerHTML='<div style="font-size:11px;color:#475569;padding:8px;">검색 결과가 없습니다.</div>';
            return;
        }
        var h='';
        entries.forEach(function(e){
            var key=e[0], r=e[1];
            var isSelected = key===_mfCurrentEditKey;
            h+='<div onclick="_mfSelectEditItem(\''+escHtml(key)+'\')" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:'+(isSelected?'#1e3a5f':'#1e293b')+';border:1.5px solid '+(isSelected?'#3abff8':'#334155')+';margin-bottom:4px;cursor:pointer;transition:0.1s;" onmouseover="this.style.borderColor=\'#3abff8\'" onmouseout="this.style.borderColor=\''+(isSelected?'#3abff8':'#334155')+'\'">';
            h+='<div style="flex:1;min-width:0;">';
            h+='<div style="font-size:11px;font-weight:900;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+escHtml(r.title||key)+'</div>';
            h+='<div style="font-size:10px;color:#475569;margin-top:1px;">p.'+r.start+' ~ p.'+r.end+(r.category?' · '+escHtml(r.category):'')+'</div>';
            h+='</div>';
            h+='<span style="font-size:9px;color:#3abff8;font-weight:900;flex-shrink:0;">수정 ›</span>';
            h+='</div>';
        });
        listEl.innerHTML=h;
    }

    async function _mfSelectEditItem(key){
        _mfCurrentEditKey = key;
        var raw = await _authFetch('manual_page_ranges/'+_mfMgmtMode+'/'+key+'.json');
        if(!raw){ alert('항목 정보를 불러올 수 없습니다.'); return; }
        _mfCurrentEditData = raw;

        // 폼 채우기
        var titEl  = document.getElementById('mfEditFTitle');
        var catEl  = document.getElementById('mfEditFCat');
        var startEl= document.getElementById('mfEditFStart');
        var endEl  = document.getElementById('mfEditFEnd');
        var kwsEl  = document.getElementById('mfEditFKws');
        if(titEl)  titEl.value  = raw.title || key.replace(/_/g,' ') || '';
        if(startEl)startEl.value= raw.start    || '';
        if(endEl)  endEl.value  = raw.end      || '';
        if(kwsEl)  kwsEl.value  = raw.keywords || '';

        // 카테고리 select 채우기
        if(catEl){
            var cats = _mfMgmtMode==='mania' ? _MANIA_CATS : _BAY_CATS;
            catEl.innerHTML = cats.map(function(c){ return '<option value="'+escHtml(c)+'"'+(c===(raw.category||'')?' selected':'')+'>'+escHtml(c)+'</option>'; }).join('');
        }

        // 이미지 미리보기 (전체 페이지 썸네일)
        var previewWrap  = document.getElementById('mfEditPreviewWrap');
        var previewList  = document.getElementById('mfEditPreviewList');
        var previewLabel = document.getElementById('mfEditPreviewLabel');
        if(previewWrap && previewList && raw.start && raw.end){
            var _ps = parseInt(raw.start)||0, _pe = parseInt(raw.end)||_ps;
            if(previewLabel) previewLabel.textContent = 'p.'+_ps+' ~ p.'+_pe+' ('+(_pe-_ps+1)+'장) — 클릭하면 크게 보기';
            previewList.innerHTML = '<span style="font-size:10px;color:#475569;">이미지 로딩 중...</span>';
            previewWrap.style.display = '';
            (function(_s,_e){
                (async function(){
                    var _html = '';
                    for(var _pg=_s;_pg<=_e;_pg++){
                        try{
                            var _u = await _getPageDataUrl(_mfMgmtMode, _pg);
                            if(_u) _html += '<img src="'+_u+'" title="p.'+_pg+'" onclick="window._mfImgZoom&&window._mfImgZoom(this.src,\'p.'+_pg+'\')" '
                                +'style="height:90px;border-radius:6px;cursor:pointer;border:1.5px solid #334155;object-fit:contain;background:#1e293b;">';
                        }catch(e2){}
                    }
                    if(previewList) previewList.innerHTML = _html || '<span style="font-size:10px;color:#ef4444;">이미지 없음</span>';
                })();
            })(_ps,_pe);
        } else if(previewWrap){
            previewWrap.style.display = 'none';
        }

        // 폼 표시
        var formEl = document.getElementById('mfEditForm');
        if(formEl) formEl.style.display = '';
        var progEl = document.getElementById('mfEditProgress');
        if(progEl) progEl.textContent = '';
        var extraPnl = document.getElementById('mfEditExtraPanel');
        if(extraPnl) extraPnl.style.display = 'none';
    }

    function _mfEditFromList(key){
        _mfSelectEditItem(key);
        var formEl = document.getElementById('mfEditForm');
        if(formEl) formEl.scrollIntoView({behavior:'smooth', block:'nearest'});
    }

    async function _mfSaveEditItem(){
        if(!_mfCurrentEditKey){ alert('항목을 먼저 선택해주세요.'); return; }
        var mode   = _mfMgmtMode;
        var newTitle = (document.getElementById('mfEditFTitle')||{}).value||'';
        var cat      = ((document.getElementById('mfEditFCat')||{}).value)||'';
        var start    = parseInt((document.getElementById('mfEditFStart')||{}).value)||0;
        var end      = parseInt((document.getElementById('mfEditFEnd')||{}).value)||0;
        var kws      = ((document.getElementById('mfEditFKws')||{}).value||'').trim();
        newTitle = newTitle.trim();
        if(!newTitle){ alert('제목을 입력해주세요.'); return; }
        if(!start||!end||start>end){ alert('페이지 범위가 올바르지 않습니다.'); return; }

        var oldTitle = (_mfCurrentEditData||{}).title||'';
        var oldEnd   = (_mfCurrentEditData||{}).end||0;
        var shiftDiff = end - oldEnd;
        var btn = document.getElementById('mfEditSaveBtn');
        if(btn){ btn.disabled=true; btn.textContent='저장 중...'; }

        await _authFetch('manual_page_ranges/'+mode+'/'+_mfCurrentEditKey+'.json','PATCH',
            {title:newTitle, category:cat, start:start, end:end, keywords:kws});

        // 이후 항목 자동 밀기 제거됨 — 범위 수정은 해당 항목만 적용

        // 검색 인덱스 갱신 (제목 바뀌면 이전 키 삭제 후 새 키 등록)
        var idx = mode==='bay' ? BAY_MANUAL_INDEX : MANUAL_INDEX;
        if(oldTitle && oldTitle!==newTitle){
            await _authFetch('imi_manual_index/'+mode+'/'+normalizeKey(oldTitle)+'.json','DELETE');
            delete idx[oldTitle];
        }
        if(!idx[newTitle]){
            await _authFetch('imi_manual_index/'+mode+'/'+normalizeKey(newTitle)+'.json','PUT',newTitle);
            idx[newTitle]='';
        }

        // 키워드를 검색 시스템(keywords/ 경로)에도 동기화
        if(oldTitle && oldTitle!==newTitle){
            db.ref('keywords/'+mode+'/'+encodeForDb(oldTitle)).remove();
        }
        var _kArr2=kws?kws.split(',').map(function(t){return t.trim();}).filter(function(t){return t.length>0;}):[];
        if(_kArr2.length) db.ref('keywords/'+mode+'/'+encodeForDb(newTitle)).set(_kArr2);
        else db.ref('keywords/'+mode+'/'+encodeForDb(newTitle)).remove();

        _mfCurrentEditData = Object.assign({},_mfCurrentEditData,{title:newTitle,category:cat,start:start,end:end,keywords:kws});
        _mfEditCache = null;
        _mfLoadRanges(mode);

        if(btn){ btn.disabled=false; btn.textContent='✅ 저장 완료!'; setTimeout(function(){ btn.textContent='💾 저장'; var f=document.getElementById('mfEditForm'); if(f) f.style.display='none'; },1500); }
    }

    async function _mfSaveAllPending(){
        if(!_mfPending.length){ alert('추가된 항목이 없습니다.'); return; }
        var btn = document.getElementById('mfSaveAllBtn');
        if(btn){ btn.disabled=true; btn.textContent='저장 중...'; }
        var mode = _mfMgmtMode;
        var idx  = mode==='bay' ? BAY_MANUAL_INDEX : MANUAL_INDEX;
        var _saveFailed = [];
        for(var i=0;i<_mfPending.length;i++){
            var e   = _mfPending[i];
            var key = e.name.replace(/[.#$\[\]\/]/g,'_');
            var _saveResult = await _authFetch('manual_page_ranges/'+mode+'/'+key+'.json','PUT',{start:e.from,end:e.to,title:e.name,category:e.cat,keywords:e.keywords||'',cropTop:e.cropTop||0,cropBottom:(e.cropBottom!==undefined?e.cropBottom:100)});
            if(_saveResult === null){ _saveFailed.push(e.name); continue; }
            if(!idx[e.name]){ await _authFetch('imi_manual_index/'+mode+'/'+normalizeKey(e.name)+'.json','PUT',e.name); idx[e.name]=''; }
            // 키워드를 검색 시스템(keywords/ 경로)에도 동기화
            if(e.keywords){
                var _kArr=e.keywords.split(',').map(function(t){return t.trim();}).filter(function(t){return t.length>0;});
                if(_kArr.length) db.ref('keywords/'+mode+'/'+encodeForDb(e.name)).set(_kArr);
            }
        }
        var prog = document.getElementById('mfNewProgress');
        if(_saveFailed.length){
            if(prog) prog.style.color='#ef4444';
            if(prog) prog.textContent = '❌ 저장 실패 ('+_saveFailed.length+'개): '+_saveFailed.join(', ')+' — 페이지 새로고침 후 다시 시도해주세요.';
            if(btn){ btn.disabled=false; btn.textContent='💾 전체 저장'; }
            alert('❌ 저장에 실패했습니다.\n\n실패 항목: '+_saveFailed.join('\n')+'\n\n페이지를 새로고침하면 자동으로 토큰이 갱신됩니다.\n새로고침 후 다시 등록해주세요.');
            return;
        }
        if(prog){ prog.style.color=''; prog.textContent = '✅ '+_mfPending.length+'개 항목 저장 완료!'; }
        _mfPending = [];
        _mfRenderPendingList();
        _mfUpdateNavBadge();
        if(btn){ btn.disabled=false; btn.textContent='💾 전체 저장'; btn.style.display='none'; }
        _mfLoadRanges(mode);
        _mfFillEditSel(mode);
    }

    // ── 수정: 이미지 직접 교체 ──
    async function _mfDoModifyByImages(){
        var input  = document.getElementById('mfEditImgFiles');
        var prog   = document.getElementById('mfEditProgress');
        var key    = _mfCurrentEditKey || '';
        var files  = input && input.files ? Array.from(input.files) : [];
        if(!key){ alert('항목을 먼저 선택해주세요.'); return; }
        if(!files.length) return;

        var startPage = parseInt((_mfCurrentEditData||{}).start, 10);
        if(!startPage){ alert('항목 시작 페이지를 확인할 수 없습니다.'); return; }
        var mode  = _mfMgmtMode;
        var title = (_mfCurrentEditData||{}).title || key;

        // 파일명 순 정렬
        files.sort(function(a,b){ return a.name.localeCompare(b.name, undefined, {numeric:true}); });
        var total = files.length;

        // 진행 UI
        if(prog) prog.textContent = '⬆ 업로드 준비 중...';
        var imgLabel = document.getElementById('mfEditImgFiles') ? document.getElementById('mfEditImgFiles').parentElement : null;
        if(imgLabel){ imgLabel.style.pointerEvents='none'; imgLabel.style.opacity='0.5'; }

        var uploaded = 0, failed = 0;
        var endPage = startPage + total - 1;

        for(var i=0; i<files.length; i++){
            var pageNum = startPage + i;
            var padded  = String(pageNum).padStart(3,'0');
            try{
                await _savePageToDb(mode, pageNum, files[i]);
                uploaded++;
            }catch(e){
                failed++;
                console.warn('업로드 실패:', files[i].name, e);
            }
            if(prog) prog.textContent = '⬆ 업로드 중... '+(i+1)+' / '+total+' (p.'+pageNum+')';
        }

        // end 페이지 업데이트
        await _authFetch('manual_page_ranges/'+mode+'/'+key+'/end.json','PUT',endPage);
        _mfCurrentEditData = Object.assign({},_mfCurrentEditData,{end:endPage});

        // end 입력창 갱신
        var endEl = document.getElementById('mfEditFEnd');
        if(endEl) endEl.value = endPage;

        // 미리보기 이미지 갱신 (새로 업로드한 전체 페이지)
        var _pwrap2 = document.getElementById('mfEditPreviewWrap');
        var _plist2 = document.getElementById('mfEditPreviewList');
        var _plbl2  = document.getElementById('mfEditPreviewLabel');
        if(_pwrap2 && _plist2){
            if(_plbl2) _plbl2.textContent = 'p.'+startPage+' ~ p.'+endPage+' ('+(endPage-startPage+1)+'장) — 클릭하면 크게 보기';
            _plist2.innerHTML = '<span style="font-size:10px;color:#475569;">이미지 로딩 중...</span>';
            _pwrap2.style.display = '';
            (function(_s,_e){
                (async function(){
                    var _html='';
                    for(var _pg=_s;_pg<=_e;_pg++){
                        try{
                            var _u=await _getPageDataUrl(mode,_pg);
                            if(_u) _html+='<img src="'+_u+'" title="p.'+_pg+'" onclick="window._mfImgZoom&&window._mfImgZoom(this.src,\'p.'+_pg+'\')" '
                                +'style="height:90px;border-radius:6px;cursor:pointer;border:1.5px solid #334155;object-fit:contain;background:#1e293b;">';
                        }catch(e2){}
                    }
                    if(_plist2) _plist2.innerHTML=_html||'<span style="font-size:10px;color:#ef4444;">이미지 없음</span>';
                })();
            })(startPage, endPage);
        }

        _mfLoadRanges(mode);

        var failMsg = failed ? ' (⚠ '+failed+'장 실패)' : '';
        if(prog){ prog.style.color='#4ade80'; prog.textContent='✅ 교체 완료! "'+title+'" · p.'+startPage+'~p.'+endPage+' · '+uploaded+'장 업로드'+failMsg; }
        if(imgLabel){ imgLabel.style.pointerEvents=''; imgLabel.style.opacity=''; }
        if(input) input.value='';
    }

    // ── 수정: PDF 렌더링 + 파일목록 저장 ──
    async function _mfDoModify(){
        var fileEl = document.getElementById('mfEditFile');
        var prog   = document.getElementById('mfEditProgress');
        var key    = _mfCurrentEditKey || '';
        var file   = fileEl ? fileEl.files[0] : null;
        if(!key||!file) return;
        var start = parseInt((_mfCurrentEditData||{}).start, 10);
        var title = (_mfCurrentEditData||{}).title || key;
        if(!start){ alert('항목을 먼저 선택해주세요.'); return; }

        var mode = _mfMgmtMode;
        var numPages = await _renderPdfToManualPages(mode, file, prog, start);
        if(!numPages){ if(fileEl) fileEl.value=''; return; }
        var end = start + numPages - 1;

        // 선택 항목 end 업데이트
        await _authFetch('manual_page_ranges/'+mode+'/'+key+'/end.json','PUT',end);

        // 원본 PDF → 파일 목록 자동 저장
        try{
            var ts = Date.now();
            var safeName = ts+'_'+file.name.replace(/[^\w가-힣._-]/g,'_');
            var storePath = 'manuals/'+safeName;
            var snap = await storage.ref(storePath).put(file);
            var url  = await snap.ref.getDownloadURL();
            var entry = {
                title: file.name.replace(/\.[^.]+$/,''),
                fileName: file.name, storagePath: storePath, downloadURL: url,
                uploadedBy: (_currentUser&&_currentUser.name)||'', uploadedAt: ts,
                mode: mode, status: 'approved',
                approvedBy: (_currentUser&&_currentUser.name)||'', approvedAt: ts
            };
            await _authFetch('imi_manual_files/'+ts+'.json','PUT',entry);
        }catch(e){}

        if(prog) prog.textContent = '✅ 교체 완료! "'+title+'" · p.'+start+'~p.'+end+' · 파일 목록 저장됨';
        if(fileEl) fileEl.value = '';

        // 같은 범위 내 다른 항목들 표시 (선택적 조정)
        var raw = await _authFetch('manual_page_ranges/'+mode+'.json');
        if(raw){
            var sameRange = Object.entries(raw).filter(function(e){
                return e[0]!==key && e[1].start>=start && e[1].start<=end;
            }).sort(function(a,b){ return a[1].start-b[1].start; });
            if(sameRange.length){
                var extraPnl  = document.getElementById('mfEditExtraPanel');
                var extraList = document.getElementById('mfEditExtraList');
                if(extraPnl&&extraList){
                    var h='';
                    sameRange.forEach(function(e){
                        var k=e[0], r=e[1];
                        h+='<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:7px;background:#1e293b;margin-bottom:4px;">';
                        h+='<div style="flex:1;font-size:11px;color:#e2e8f0;">'+escHtml(r.title||k)+'</div>';
                        h+='<span style="font-size:10px;color:#475569;">p.</span>';
                        h+='<input type="number" data-key="'+escHtml(k)+'" data-mode="'+mode+'" value="'+r.start+'" min="1" style="width:52px;padding:4px 6px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:11px;text-align:center;outline:none;">';
                        h+='<span style="font-size:10px;color:#475569;">~</span>';
                        h+='<input type="number" data-key2="'+escHtml(k)+'" data-mode="'+mode+'" value="'+r.end+'" min="1" style="width:52px;padding:4px 6px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:11px;text-align:center;outline:none;">';
                        h+='</div>';
                    });
                    extraList.innerHTML=h;
                    extraPnl.style.display='';
                }
            }
        }
        _mfLoadRanges(mode);
        _mfFillEditSel(mode);
    }

    async function _mfSaveExtraEdits(){
        var extraList = document.getElementById('mfEditExtraList');
        if(!extraList) return;
        var starts = extraList.querySelectorAll('[data-key]');
        var ends   = extraList.querySelectorAll('[data-key2]');
        for(var i=0;i<starts.length;i++){
            var k    = starts[i].dataset.key;
            var mode = starts[i].dataset.mode;
            var s    = parseInt(starts[i].value,10);
            var e    = parseInt(ends[i].value,10);
            if(s&&e&&s<=e) await _authFetch('manual_page_ranges/'+mode+'/'+k+'.json','PATCH',{start:s,end:e});
        }
        var extraPnl = document.getElementById('mfEditExtraPanel');
        if(extraPnl) extraPnl.style.display='none';
        _mfLoadRanges(_mfMgmtMode);
        _mfFillEditSel(_mfMgmtMode);
    }

    async function _mfLoadRanges(mode){
        var listEl = document.getElementById('mfRangeList');
        if(!listEl) return;
        listEl.innerHTML = '<div style="font-size:11px;color:#475569;padding:8px 0;">로딩 중...</div>';
        var [raw, meta] = await Promise.all([
            _authFetch('manual_page_ranges/'+mode+'.json'),
            _authFetch('manual_meta/'+mode+'.json')
        ]);
        if(meta && meta.maxPage) _mfTotalPdfPages = meta.maxPage;
        // 챗봇용 RANGES도 즉시 갱신 (새 항목이 바로 반영되도록)
        if(raw && typeof raw === 'object'){
            if(mode === 'bay') BAY_MANUAL_RANGES = raw;
            else MANUAL_RANGES = raw;
        }
        if(!raw||typeof raw!=='object'){ _mfSavedPageCnt=0; _mfRegisteredRanges=[]; _mfUpdateNavBadge(); _mfRenderPageThumbs(); listEl.innerHTML='<div style="font-size:11px;color:#475569;padding:8px 0;">등록된 항목이 없습니다.</div>'; return; }
        var entries = Object.entries(raw).sort(function(a,b){ return (a[1].start||0)-(b[1].start||0); });
        if(!entries.length){ _mfSavedPageCnt=0; _mfRegisteredRanges=[]; _mfUpdateNavBadge(); _mfRenderPageThumbs(); listEl.innerHTML='<div style="font-size:11px;color:#475569;padding:8px 0;">등록된 항목이 없습니다.</div>'; return; }
        // 저장된 항목이 커버하는 총 페이지 수 집계
        var _savedPages = 0;
        entries.forEach(function(e){ _savedPages += Math.max(0,(e[1].end||0)-(e[1].start||0)+1); });
        _mfSavedPageCnt = _savedPages;
        _mfRegisteredRanges = entries.map(function(e){ return {start:e[1].start||0, end:e[1].end||0}; });
        _mfUpdateNavBadge();
        _mfRenderPageThumbs();
        window._mfRangeEntries = entries; // 필터링용 캐시
        _mfRenderRangeRows(entries, mode);
    }
    function _mfRangeFilter(){
        var q = ((document.getElementById('mfRangeSearch')||{}).value||'').trim().toLowerCase();
        var entries = window._mfRangeEntries || [];
        var filtered = q ? entries.filter(function(e){ return (e[1].title||e[0]).toLowerCase().includes(q); }) : entries;
        _mfRenderRangeRows(filtered, _mfMgmtMode);
    }
    function _mfRenderRangeRows(entries, mode){
        var listEl = document.getElementById('mfRangeList');
        if(!listEl) return;
        if(!entries.length){ listEl.innerHTML='<div style="font-size:11px;color:#475569;padding:8px 0;">검색 결과가 없습니다.</div>'; return; }
        var h='';
        entries.forEach(function(e){
            var key=e[0], r=e[1], title=r.title||key;
            var catBadge=r.category?'<span style="font-size:9px;background:#0f172a;border:1px solid #334155;color:#64748b;border-radius:4px;padding:1px 5px;margin-left:4px;">'+escHtml(r.category)+'</span>':'';
            h+='<div style="display:flex;align-items:center;gap:6px;padding:7px 8px;border-radius:7px;background:#1e293b;margin-bottom:4px;">';
            h+='<div style="flex:1;min-width:0;">';
            h+='<div style="font-size:11px;font-weight:700;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+escHtml(title)+catBadge+'</div>';
            h+='<div style="font-size:10px;color:#475569;margin-top:1px;">p.'+r.start+' ~ p.'+r.end+'</div>';
            h+='</div>';
            h+='<button onclick="_mfEditFromList(\''+escHtml(key)+'\')" style="padding:4px 8px;border-radius:6px;background:none;border:1px solid #f59e0b;color:#f59e0b;font-size:10px;cursor:pointer;flex-shrink:0;">수정</button>';
            h+='<button onclick="_mfDeleteRange(\''+mode+'\',\''+escHtml(key)+'\',\''+escHtml(title)+'\')" style="padding:4px 8px;border-radius:6px;background:none;border:1px solid #334155;color:#ef4444;font-size:10px;cursor:pointer;flex-shrink:0;">삭제</button>';
            h+='</div>';
        });
        listEl.innerHTML=h;
    }

    async function _mfDeleteRange(mode, key, title){
        if(!confirm('"'+title+'" 항목을 삭제하시겠습니까?')) return;
        await _authFetch('manual_page_ranges/'+mode+'/'+key+'.json', 'DELETE');
        // 챗봇 검색 인덱스에서도 삭제 (여기 안 지우면 검색에 계속 뜸)
        await _authFetch('imi_manual_index/'+mode+'/'+normalizeKey(title)+'.json', 'DELETE');
        // 메모리 캐시 즉시 반영 (페이지 새로고침 없이 검색에서 바로 사라짐)
        var idx = mode==='bay' ? BAY_MANUAL_INDEX : MANUAL_INDEX;
        if(idx && idx[title] !== undefined) delete idx[title];
        if(_mfCurrentEditKey===key){ _mfCurrentEditKey=null; _mfCurrentEditData=null; var f=document.getElementById('mfEditForm'); if(f) f.style.display='none'; }
        _mfEditCache = null;
        _mfLoadRanges(mode);
    }


    async function _mfResetAll(){
        var mode = _mfMgmtMode;
        var label = mode === 'bay' ? '아이템베이(BAY)' : '아이템매니아(IMI)';
        if(!confirm('['+label+'] 매뉴얼을 전체 삭제하시겠습니까?\n\n• DB 페이지 범위 등록 데이터\n• DB 목차 인덱스\n• Storage 이미지 파일 전체\n\n이 작업은 되돌릴 수 없습니다.')) return;
        if(!confirm('정말 삭제합니다. 계속하시겠습니까?')) return;

        var btn = document.querySelector('button[onclick="_mfResetAll()"]');
        if(btn){ btn.disabled=true; btn.textContent='삭제 중...'; }

        // DB 삭제 (SDK 사용 - 키 인코딩 안전)
        await new Promise(function(res){ db.ref('manual_page_ranges/'+mode).set(null, res); });
        await _authFetch('imi_manual_index/'+mode+'.json','DELETE');
        await new Promise(function(res){ db.ref('manual_meta/'+mode).set(null, res); });
        _mfTotalPdfPages = 0; _mfSavedPageCnt = 0;

        // DB 이미지 삭제
        await _deleteAllPagesFromDb(mode);
        // Storage 이미지도 정리 (있으면)
        try{
            var result = await storage.ref('manual_pages/'+mode+'/').listAll();
            var dels = result.items.map(function(ref){ return ref.delete().catch(function(){}); });
            await Promise.all(dels);
        } catch(e){}

        if(btn){ btn.disabled=false; btn.textContent='🗑 매뉴얼 전체 초기화 (DB + 이미지)'; }
        alert('['+label+'] 매뉴얼 전체 삭제 완료!');
        _mfPending = [];
        _mfRendered = null;
        _mfLoadRanges(mode);
        _mfFillEditSel(mode);
        window._mfPageUrls = [];
        _mfRenderPageThumbs();
        _mfUpdateNavBadge();
    }

    async function _renderPdfToManualPages(mode, file, prog, startFrom){
        startFrom = startFrom||1;
        _mfIsConverting = true;
        _mfConvertStatus = '';
        _mfProgressHtml  = '';
        window._mfPageUrls = [];
        if(prog) prog.textContent = 'PDF 파일 읽는 중...';
        var numPages = 0;
        var failedPages = [];
        try{
            pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
            var arrayBuf = await file.arrayBuffer();
            if(prog) prog.textContent = 'PDF 파싱 중... (잠시 기다려주세요)';
            var pdfDoc   = await pdfjsLib.getDocument({data:arrayBuf}).promise;
            numPages = pdfDoc.numPages;
            if(prog) prog.textContent = 'PDF 파싱 완료 (총 '+numPages+'페이지) — 이미지 변환 시작...';
            var _lastPage = numPages; // 완료된 PDF 페이지 수
            var _total = numPages;
            var canvas = document.createElement('canvas');
            var ctx    = canvas.getContext('2d');
            // pdfPage=1~numPages 순서로 변환, 저장 시 manualPage = startFrom + pdfPage - 1
            for(var i=1;i<=numPages;i++){
                if(_mfCancelRender){ _lastPage = i-1; break; }
                var _manualPage = startFrom + i - 1; // 실제 매뉴얼 페이지 번호
                _mfConvertStatus = i + ' / ' + _total;
                var _ph = '이미지 변환 중 p.'+_manualPage+' ('+i+'/'+_total+')... <button id="mfCancelBtn" onclick="_mfCancelRenderNow()" style="margin-left:8px;padding:2px 10px;border-radius:5px;background:#7f1d1d;color:#fca5a5;border:none;font-size:10px;font-weight:900;cursor:pointer;">✕ 취소</button>';
                _mfProgressHtml = _ph;
                // 항상 현재 DOM 직접 조회 (모달 재빌드 후에도 최신 엘리먼트에 반영)
                var _liveP = document.getElementById('mfNewProgress');
                if(_liveP) _liveP.innerHTML = _ph; else if(prog) prog.innerHTML = _ph;
                _mfUpdateNavBadge();
                try{
                    var page     = await pdfDoc.getPage(i);
                    var viewport = page.getViewport({scale:3.0}); // 최고화질 렌더링
                    canvas.width=viewport.width; canvas.height=viewport.height;
                    await page.render({canvasContext:ctx,viewport:viewport}).promise;
                    var blob = await new Promise(function(resolve){ canvas.toBlob(function(b){resolve(b);},'image/jpeg',0.97); });
                    var dlUrl = await _savePageToDb(mode, _manualPage, blob);
                    window._mfPageUrls.push({page:_manualPage, url:dlUrl});
                    // 캔버스 메모리 해제
                    ctx.clearRect(0,0,canvas.width,canvas.height);
                    blob = null;
                } catch(pageErr){
                    console.warn('페이지 '+i+' 실패, 건너뜀:', pageErr);
                    failedPages.push(i);
                }
            }
            numPages = _lastPage; // 완료된 마지막 페이지 번호로 갱신
        }catch(e){
            _mfIsConverting = false; _mfConvertStatus = ''; _mfUpdateNavBadge();
            _mfProgressHtml = '오류: '+e.message;
            if(prog) prog.textContent=_mfProgressHtml;
            console.error(e);
            return 0;
        }
        _mfIsConverting = false;
        _mfConvertStatus = '';
        _mfUpdateNavBadge();
        var _renderedCount = _lastPage; // 완료된 PDF 페이지 수 = 저장된 매뉴얼 페이지 수
        if(failedPages.length){
            _mfProgressHtml = '⚠ '+_renderedCount+'페이지 중 '+failedPages.length+'개 실패 — 나머지 완료';
            if(prog) prog.textContent = _mfProgressHtml;
        }
        return _renderedCount;
    }

    async function _mfRepairBayRanges(){
        if(localStorage.getItem('bay_range_repair_done_v1')) return;
        var allRaw = await _authFetch('manual_page_ranges/bay.json');
        if(!allRaw || typeof allRaw !== 'object') return;
        // p.95~p.162 범위 항목만 -1 (사용자가 직접 수정한 163+ 항목 제외)
        var changed = 0;
        for(var _rk in allRaw){
            var _rr = allRaw[_rk];
            var _rs = _rr.start||0, _re = _rr.end||0;
            if(_rs >= 95 && _rs <= 162){
                await _authFetch('manual_page_ranges/bay/'+_rk+'.json','PATCH',{start:_rs-1, end:_re-1});
                changed++;
            }
        }
        localStorage.setItem('bay_range_repair_done_v1', '1');
        if(changed > 0) _mfLoadRanges('bay');
    }

    async function _mfSyncSearchIndex(){
        var btn = document.getElementById('mfSyncIndexBtn');
        if(btn){ btn.disabled=true; btn.textContent='동기화 중...'; }
        try{
            for(var mode of ['mania','bay']){
                var raw = await _authFetch('manual_page_ranges/'+mode+'.json');
                // normalizeKey(title)을 키, 실제 제목을 값으로 저장
                // 고아 항목(대리 등) 제거: PUT으로 전체 교체
                var newIdxFb = {};
                var newIdxMem = {};
                if(raw && typeof raw === 'object'){
                    Object.keys(raw).forEach(function(k){
                        var entry = raw[k];
                        var title = (entry && entry.title) ? entry.title : k;
                        newIdxFb[normalizeKey(title)] = title;
                        newIdxMem[title] = '';
                        // 키워드도 keywords/ 경로에 동기화
                        if(entry && entry.keywords){
                            var _ka=entry.keywords.split(',').map(function(t){return t.trim();}).filter(function(t){return t.length>0;});
                            if(_ka.length) db.ref('keywords/'+mode+'/'+encodeForDb(title)).set(_ka);
                        }
                    });
                }
                await _authFetch('imi_manual_index/'+mode+'.json','PUT', newIdxFb);
                if(mode==='bay'){ BAY_MANUAL_INDEX = newIdxMem; _buildBayCategoryGroups(); }
                else MANUAL_INDEX = newIdxMem;
            }
            var cntM = Object.keys(MANUAL_INDEX).length;
            var cntB = Object.keys(BAY_MANUAL_INDEX).length;
            if(btn){ btn.disabled=false; btn.textContent='✅ 동기화 완료'; }
            alert('✅ 검색 인덱스 재구성 완료! (고아 항목 제거)\n\n매니아: '+cntM+'개 항목\n베이: '+cntB+'개 항목\n\n※ 항목 수 = 이미지 묶음(제목) 수 (페이지 수 아님)\n\n페이지를 새로고침하면 챗봇 검색에 반영됩니다.');
        }catch(e){
            if(btn){ btn.disabled=false; btn.textContent='🔄 검색 인덱스 전체 동기화'; }
            alert('오류: '+e.message);
        }
    }

    async function _initManualData(){
        _mfApplyCacheInvalidation(); // 무효 목록 확인 후 캐시 정리 (백그라운드)
        try{
            var mI  = await _authFetch('imi_manual_index/mania.json');
            var bI  = await _authFetch('imi_manual_index/bay.json');
            var pR  = await _authFetch('imi_page_ranges/mania.json');
            var bpR = await _authFetch('imi_page_ranges/bay.json');
            if(mI  && typeof mI  === 'object'){
                // 값이 실제 제목인 새 포맷: {normalizeKey(title): title}
                // 값이 ""인 구형 포맷도 대응 (키 자체를 제목으로 사용)
                var _mi={};
                Object.keys(mI).forEach(function(k){
                    var t=mI[k]; if(t&&typeof t==='string') _mi[t]=''; else _mi[k]='';
                });
                MANUAL_INDEX = _mi;
            }
            if(bI  && typeof bI  === 'object'){
                var _bi={};
                Object.keys(bI).forEach(function(k){
                    var t=bI[k]; if(t&&typeof t==='string') _bi[t]=''; else _bi[k]='';
                });
                // 교체가 아닌 병합: 기본 내장 데이터(1-1. 패턴) 위에 Firebase 항목 추가
                BAY_MANUAL_INDEX = Object.assign({}, BAY_MANUAL_INDEX, _bi);
                _buildBayCategoryGroups();
            }
            if(pR  && typeof pR  === 'object') PAGE_RANGES      = pR;
            if(bpR && typeof bpR === 'object') BAY_PAGE_RANGES  = bpR;
            // manual_page_ranges 로드 (카테고리 필드 포함)
            var mR  = await _authFetch('manual_page_ranges/mania.json');
            var bR2 = await _authFetch('manual_page_ranges/bay.json');
            if(mR  && typeof mR  === 'object') MANUAL_RANGES     = mR;
            if(bR2 && typeof bR2 === 'object') BAY_MANUAL_RANGES = bR2;
            // 커스텀 카테고리 로드 (카테고리 버튼에서 즉시 사용)
            var mc = await _authFetch('manual_cats/mania.json');
            var bc = await _authFetch('manual_cats/bay.json');
            if(mc && Array.isArray(mc) && mc.length) _MANIA_CATS = mc;
            if(bc && Array.isArray(bc) && bc.length) _BAY_CATS   = bc;
        }catch(e){ /* Firebase 실패 시 HTML 하드코딩 값 유지 */ }
    }

    function _umSetFilter(f){ _umFilter = f; _renderUserMgmt(); }

    function _umSwitchTab(n){
        _umCurrentTab = n;
        [1,2,3].forEach(function(i){
            var btn = document.getElementById('umTab'+i);
            if(!btn) return;
            btn.style.color = i===n ? '#3abff8' : '#64748b';
            btn.style.borderBottomColor = i===n ? '#3abff8' : 'transparent';
        });
        _renderUserMgmt();
    }

    // teamsData 포맷: { "팀이름": ["파트1", "파트2"], ... }
    // Firebase는 빈 배열 [] 을 저장하지 않으므로 sentinel {_:1} 로 대체
    function _teamsToFirebase(teamsData){
        var out = {};
        Object.keys(teamsData).forEach(function(team){
            var parts = teamsData[team];
            out[team] = (Array.isArray(parts) && parts.length === 0) ? {_:1} : parts;
        });
        return out;
    }
    function _normalizeTeamParts(val){
        if(!val) return [];
        if(Array.isArray(val)) return val;
        // Firebase가 배열을 숫자키 객체로 바꾼 경우: {"0":"파트1","1":"파트2"}
        var keys = Object.keys(val);
        if(keys.length === 1 && keys[0] === '_') return []; // sentinel
        // 숫자키만 있으면 배열로 복원
        if(keys.every(function(k){ return /^\d+$/.test(k); }))
            return keys.sort(function(a,b){return +a-+b;}).map(function(k){ return val[k]; });
        return [];
    }
    // 구버전(배열) 자동 마이그레이션 + sentinel 정규화
    async function _umLoadTeams(){
        var raw = await _authFetch('imi_teams.json');
        if(!raw) return {};
        if(Array.isArray(raw)){
            var obj = {};
            raw.forEach(function(t){ obj[t] = []; });
            await _authFetch('imi_teams.json', 'PUT', _teamsToFirebase(obj));
            return obj;
        }
        var normalized = {};
        Object.keys(raw).forEach(function(team){
            normalized[team] = _normalizeTeamParts(raw[team]);
        });
        return normalized;
    }

    async function _renderUserMgmt(){
        var content = document.getElementById('userMgmtContent');
        content.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px;">로딩 중...</div>';

        var users     = await _authFetch('imi_users.json') || {};
        var teamsData = await _umLoadTeams();
        var teamNames = Object.keys(teamsData);

        var list = Object.entries(users).map(function(e){
            return Object.assign({_key:e[0]}, e[1]);
        });
        var pending  = list.filter(function(u){ return !u.approved; });
        var approved = list.filter(function(u){ return u.approved; });

        var pc = document.getElementById('umPendingCnt');
        if(pc){ pc.textContent = pending.length; pc.style.display = pending.length ? '' : 'none'; }

        var ROW = 'display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #0f172a;gap:5px;flex-wrap:nowrap;min-width:0;';
        var ABT = 'padding:4px 9px;border-radius:7px;border:none;font-size:11px;font-weight:700;cursor:pointer;flex-shrink:0;';
        var SEL = 'padding:3px 6px;border-radius:6px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:10px;font-weight:600;cursor:pointer;flex-shrink:0;max-width:76px;';

        var isAdmin = _currentUser && _currentUser.role === 'admin';

        function teamOpts(cur){
            var o = '<option value="">팀 없음</option>';
            teamNames.forEach(function(t){ o += '<option value="'+escHtml(t)+'"'+(t===cur?' selected':'')+'>'+escHtml(t)+'</option>'; });
            return o;
        }
        function partOpts(teamName, cur){
            var o = '<option value="">파트 없음</option>';
            var parts = (teamName && teamsData[teamName]) ? teamsData[teamName] : [];
            parts.forEach(function(p){ o += '<option value="'+escHtml(p)+'"'+(p===cur?' selected':'')+'>'+escHtml(p)+'</option>'; });
            return o;
        }

        var h = '';

        // ── 탭 1: 멤버 목록 ─────────────────────────────────────
        if(_umCurrentTab === 1){
            var noTeamList = approved.filter(function(u){ return !u.team; });
            var noPartList = approved.filter(function(u){ return u.team && !u.part; });

            // 필터 버튼 바
            function _fBtn(f, label, count, color){
                var active = _umFilter === f;
                return '<button onclick="_umSetFilter(\''+f+'\')" style="padding:3px 9px;border-radius:6px;font-size:10px;font-weight:900;cursor:pointer;border:1.5px solid '+(active?color:'#334155')+';background:'+(active?color+'33':'none')+';color:'+(active?color:'#64748b')+';transition:0.15s;flex-shrink:0;">'+label+(count>0?' '+count:'')+'</button>';
            }
            h += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #1e293b;">';
            h += _fBtn('all', '전체', approved.length, '#3abff8');
            h += _fBtn('no-team', '⚠ 팀 미배정', noTeamList.length, '#f59e0b');
            h += _fBtn('no-part', '⚠ 파트 미배정', noPartList.length, '#fb923c');
            teamNames.forEach(function(t){
                h += _fBtn('team:'+t, t, approved.filter(function(u){ return u.team===t; }).length, '#0284c7');
            });
            h += '</div>';

            // 멤버 행 렌더
            function renderURow(u){
                var isMe = _currentUser && u.name === _currentUser.name;
                var unassigned = !u.team || (u.team && !u.part);
                var leftBorder = !u.team ? 'border-left:3px solid #f59e0b;padding-left:5px;'
                               : (u.team && !u.part) ? 'border-left:3px solid #fb923c;padding-left:5px;' : '';
                var roleBadge = u.role==='admin'
                    ? '<span style="background:#7c3aed;color:#fff;font-size:9px;border-radius:4px;padding:1px 5px;flex-shrink:0;">관리자</span>'
                    : u.role==='subadmin'
                    ? '<span style="background:#0e7490;color:#a5f3fc;font-size:9px;border-radius:4px;padding:1px 5px;flex-shrink:0;">부관리자</span>'
                    : '<span style="background:#334155;color:#94a3b8;font-size:9px;border-radius:4px;padding:1px 5px;flex-shrink:0;">일반</span>';
                var teamBadge = u.team
                    ? '<span style="background:#0284c7;color:#fff;font-size:9px;border-radius:4px;padding:1px 5px;flex-shrink:0;">'+escHtml(u.team)+'</span>'
                    : '<span style="background:#78350f;color:#fbbf24;font-size:9px;border-radius:4px;padding:1px 5px;flex-shrink:0;">팀없음</span>';
                var partBadge = (u.team && u.part)
                    ? '<span style="background:#0c4a6e;color:#7dd3fc;font-size:9px;border-radius:4px;padding:1px 5px;flex-shrink:0;">'+escHtml(u.part)+'</span>'
                    : (u.team ? '<span style="background:#1c1917;color:#a8a29e;font-size:9px;border-radius:4px;padding:1px 5px;flex-shrink:0;">파트없음</span>' : '');
                var r = '<div style="'+ROW+leftBorder+'">'
                    + '<span style="font-size:12px;font-weight:700;color:#e2e8f0;min-width:48px;flex-shrink:0;">'+escHtml(u.name||u._key)+(isMe?'<span style="font-size:9px;color:#64748b;"> (나)</span>':'')+'</span>'
                    + teamBadge + partBadge + roleBadge
                    + '<span style="flex:1;min-width:0;"></span>';
                if(isAdmin){
                    r += '<select onchange="_umSetTeam(\''+u._key+'\',this.value)" style="'+SEL+'" title="팀">'+teamOpts(u.team||'')+'</select>';
                    r += '<select onchange="_umSetPart(\''+u._key+'\',this.value)" style="'+SEL+'" title="파트">'+partOpts(u.team||'', u.part||'')+'</select>';
                    if(!isMe){
                        r += '<select onchange="_umSetRole(\''+u._key+'\',this.value)" style="'+SEL+'" title="권한">'
                            + '<option value="user"'+(u.role==='user'?' selected':'')+'>일반</option>'
                            + '<option value="subadmin"'+(u.role==='subadmin'?' selected':'')+'>부관리자</option>'
                            + '<option value="admin"'+(u.role==='admin'?' selected':'')+'>관리자</option>'
                            + '</select>';
                    }
                    r += '<button onclick="_umSetEmpId(\''+u._key+'\',\''+escHtml(u.name||u._key)+'\',\''+escHtml(u.emp_id||'')+'\')" style="'+ABT+'background:none;border:1px solid #1e3a5f;color:#93c5fd;" title="사번 설정">ID</button>';
                    if(!isMe){
                        r += '<button onclick="_authResetPw(\''+u._key+'\',\''+escHtml(u.name||u._key)+'\')" style="'+ABT+'background:none;border:1px solid #334155;color:#f59e0b;" title="비밀번호 초기화">&#x1f511;</button>';
                        r += '<button onclick="_umToggleMonitor(\''+u._key+'\','+!!u.monitor_disabled+')" style="'+ABT+(u.monitor_disabled ? 'background:#b91c1c33;border:1px solid #b91c1c;color:#f87171;' : 'background:none;border:1px solid #334155;color:#64748b;')+'" title="'+(u.monitor_disabled?'모니터링 차단됨 (클릭 시 해제)':'모니터링 허용 (클릭 시 차단)')+'">&#x1f4e1;'+(u.monitor_disabled?'&#x274c;':'&#x2714;')+'</button>';
                        r += '<button onclick="_umToggleOsNotif(\''+u._key+'\','+!!u.os_notif_disabled+')" style="'+ABT+(u.os_notif_disabled ? 'background:#78350f33;border:1px solid #d97706;color:#fbbf24;' : 'background:none;border:1px solid #334155;color:#64748b;')+'" title="'+(u.os_notif_disabled?'윈도우 알림 차단됨 (클릭 시 해제)':'윈도우 알림 허용 (클릭 시 차단)')+'">&#x1f514;'+(u.os_notif_disabled?'&#x274c;':'&#x2714;')+'</button>';
                        r += '<button onclick="_authDelete(\''+u._key+'\',\''+escHtml(u.name||u._key)+'\')" style="'+ABT+'background:none;border:1px solid #334155;color:#64748b;" title="삭제">&#x2715;</button>';
                    }
                }
                r += '</div>';
                return r;
            }

            // 필터별 출력
            if(_umFilter === 'no-team'){
                h += '<div style="font-size:10px;color:#f59e0b;font-weight:900;margin-bottom:6px;">⚠ 팀 미배정 '+noTeamList.length+'명</div>';
                if(noTeamList.length === 0) h += '<div style="font-size:11px;color:#475569;padding:10px 0;">없음</div>';
                noTeamList.forEach(function(u){ h += renderURow(u); });
            } else if(_umFilter === 'no-part'){
                h += '<div style="font-size:10px;color:#fb923c;font-weight:900;margin-bottom:6px;">⚠ 파트 미배정 '+noPartList.length+'명</div>';
                if(noPartList.length === 0) h += '<div style="font-size:11px;color:#475569;padding:10px 0;">없음</div>';
                noPartList.forEach(function(u){ h += renderURow(u); });
            } else if(_umFilter.indexOf('team:') === 0){
                var tf = _umFilter.slice(5);
                var tlist = approved.filter(function(u){ return u.team===tf; });
                h += '<div style="font-size:10px;color:#0284c7;font-weight:900;margin-bottom:6px;">📋 '+escHtml(tf)+' '+tlist.length+'명</div>';
                tlist.forEach(function(u){ h += renderURow(u); });
            } else {
                // 전체: 팀별 섹션 + 미배정 섹션
                var grouped = {};
                teamNames.forEach(function(t){ grouped[t] = []; });
                approved.forEach(function(u){ if(u.team && grouped[u.team]) grouped[u.team].push(u); });
                teamNames.forEach(function(team){
                    var mems = grouped[team];
                    h += '<div style="margin-bottom:8px;">';
                    h += '<div style="font-size:10px;font-weight:900;color:#0284c7;letter-spacing:0.06em;padding:4px 0 4px;border-bottom:1px solid #1e3a5f;margin-bottom:2px;">📋 '+escHtml(team)+' ('+mems.length+'명)</div>';
                    if(mems.length===0) h += '<div style="font-size:11px;color:#334155;padding:6px 0 2px;">멤버 없음</div>';
                    mems.forEach(function(u){ h += renderURow(u); });
                    h += '</div>';
                });
                if(noTeamList.length > 0){
                    h += '<div style="margin-bottom:8px;">';
                    h += '<div style="font-size:10px;font-weight:900;color:#f59e0b;letter-spacing:0.06em;padding:4px 0 4px;border-bottom:1px solid #78350f;margin-bottom:2px;">⚠ 팀 미배정 ('+noTeamList.length+'명)</div>';
                    noTeamList.forEach(function(u){ h += renderURow(u); });
                    h += '</div>';
                }
            }
        }
        // ── 탭 2: 승인대기 ─────────────────────────────────────
        else if(_umCurrentTab === 2){
            if(pending.length === 0){
                h += '<div style="text-align:center;padding:30px 0;color:#475569;font-size:12px;">대기 중인 가입 신청이 없습니다.</div>';
            } else {
                h += '<div style="font-size:11px;color:#f59e0b;font-weight:700;margin-bottom:12px;">승인 대기 '+pending.length+'건</div>';
                pending.forEach(function(u){
                    var dt = u.created_at ? new Date(u.created_at).toLocaleDateString('ko') : '-';
                    h += '<div style="'+ROW+'">'
                        + '<div style="flex:1;">'
                        +   '<div style="font-size:13px;font-weight:700;color:#e2e8f0;">'+escHtml(u.name||u._key)+'</div>'
                        +   '<div style="font-size:10px;color:#64748b;margin-top:2px;">신청일: '+dt+'</div>'
                        + '</div>'
                        + '<button onclick="_authApprove(\''+u._key+'\')" style="'+ABT+'background:#22c55e;color:#fff;">승인</button>'
                        + '<button onclick="_authReject(\''+u._key+'\')" style="'+ABT+'background:#ef4444;color:#fff;">거절</button>'
                        + '</div>';
                });
            }
        }
        // ── 탭 3: 팀관리 ─────────────────────────────────────
        else if(_umCurrentTab === 3){
            h += '<div style="display:flex;gap:8px;margin-bottom:14px;">'
                + '<input id="umNewTeamInput" type="text" placeholder="새 팀 이름" style="flex:1;padding:7px 12px;border-radius:8px;border:1.5px solid #334155;background:#0f172a;color:#e2e8f0;font-size:12px;font-weight:600;outline:none;">'
                + '<button onclick="_umAddTeam()" style="'+ABT+'background:linear-gradient(135deg,#0284c7,#3abff8);color:#fff;padding:7px 14px;">팀 추가</button>'
                + '</div>';

            if(teamNames.length === 0){
                h += '<div style="color:#475569;font-size:12px;text-align:center;padding:20px 0;">팀이 없습니다. 팀을 먼저 만들어 주세요.</div>';
            } else {
                teamNames.forEach(function(team){
                    var parts       = teamsData[team] || [];
                    var teamMembers = approved.filter(function(u){ return u.team === team; });
                    var noPartMems  = teamMembers.filter(function(u){ return !u.part; });

                    h += '<div style="background:#0f172a;border-radius:10px;padding:12px 14px;margin-bottom:10px;">';

                    // 팀 헤더
                    h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">'
                        + '<span style="font-size:13px;font-weight:900;color:#e2e8f0;flex:1;">&#x1f4cb; '+escHtml(team)+'</span>'
                        + '<span style="font-size:10px;color:#64748b;">전체 '+teamMembers.length+'명</span>'
                        + '<button onclick="_umDeleteTeam(\''+escHtml(team)+'\')" style="background:none;border:none;color:#475569;cursor:pointer;font-size:12px;padding:2px 4px;" title="팀 삭제">&#x1f5d1;</button>'
                        + '</div>';

                    // 파트 추가 입력
                    h += '<div style="display:flex;gap:6px;margin-bottom:10px;">'
                        + '<input id="umNewPartInput_'+escHtml(team)+'" type="text" placeholder="새 파트 이름" style="flex:1;padding:5px 10px;border-radius:7px;border:1px solid #1e293b;background:#1e293b;color:#e2e8f0;font-size:11px;outline:none;">'
                        + '<button onclick="_umAddPart(\''+escHtml(team)+'\')" style="'+ABT+'background:#0c4a6e;color:#7dd3fc;padding:5px 11px;font-size:11px;">파트 추가</button>'
                        + '</div>';

                    // 파트별 멤버
                    parts.forEach(function(part, pi){
                        var pMems = teamMembers.filter(function(u){ return u.part === part; });
                        var chips = pMems.map(function(u){
                            return '<span style="background:#1e293b;border:1px solid #334155;border-radius:5px;padding:2px 7px;font-size:10px;color:#94a3b8;display:inline-flex;align-items:center;">'
                                + escHtml(u.name)+'</span>';
                        }).join(' ');
                        var MBTN = 'background:none;border:1px solid #334155;border-radius:4px;color:#64748b;cursor:pointer;font-size:9px;padding:1px 4px;line-height:1;';
                        h += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0 6px 10px;border-left:2px solid #0284c7;margin-bottom:5px;">'
                            + '<div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0;">'
                            + '<button onclick="_umMovePart(\''+escHtml(team)+'\','+pi+',-1)" style="'+MBTN+(pi===0?'opacity:0.2;cursor:default;':'')+'" '+(pi===0?'disabled':'')+' title="위로">▲</button>'
                            + '<button onclick="_umMovePart(\''+escHtml(team)+'\','+pi+',1)" style="'+MBTN+(pi===parts.length-1?'opacity:0.2;cursor:default;':'')+'" '+(pi===parts.length-1?'disabled':'')+' title="아래로">▼</button>'
                            + '</div>'
                            + '<span style="font-size:11px;font-weight:700;color:#7dd3fc;min-width:54px;flex-shrink:0;">'+escHtml(part)+'</span>'
                            + '<span style="font-size:10px;color:#475569;flex-shrink:0;">'+pMems.length+'명</span>'
                            + '<span style="flex:1;display:flex;flex-wrap:wrap;gap:3px;">'+(chips||'<span style="font-size:10px;color:#334155;">없음</span>')+'</span>'
                            + '<button onclick="_umDeletePart(\''+escHtml(team)+'\',\''+escHtml(part)+'\')" style="background:none;border:none;color:#334155;cursor:pointer;font-size:11px;padding:0 2px;" title="파트 삭제">&#x2715;</button>'
                            + '</div>';
                    });

                    // 파트 미배정 멤버
                    if(noPartMems.length > 0){
                        var noChips = noPartMems.map(function(u){
                            return '<span style="background:#1e293b;border:1px solid #1e293b;border-radius:5px;padding:2px 7px;font-size:10px;color:#475569;display:inline-flex;align-items:center;">'
                                + escHtml(u.name)+'</span>';
                        }).join(' ');
                        h += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0 6px 10px;border-left:2px solid #1e293b;margin-bottom:5px;">'
                            + '<span style="font-size:10px;color:#334155;min-width:54px;flex-shrink:0;">미배정</span>'
                            + '<span style="flex:1;display:flex;flex-wrap:wrap;gap:3px;">'+noChips+'</span>'
                            + '</div>';
                    }

                    if(parts.length === 0 && teamMembers.length === 0){
                        h += '<div style="font-size:11px;color:#1e293b;padding:2px 0;">파트와 멤버가 없습니다.</div>';
                    }

                    h += '</div>';
                });
            }
        }

        content.innerHTML = h;
    }

    // ── 팀 CRUD ────────────────────────────────────────────────────
    async function _umAddTeam(){
        var inp = document.getElementById('umNewTeamInput');
        var name = inp ? inp.value.trim() : '';
        if(!name){ alert('팀 이름을 입력해주세요.'); return; }
        var teamsData = await _umLoadTeams();
        if(teamsData.hasOwnProperty(name)){ alert('이미 존재하는 팀입니다.'); return; }
        teamsData[name] = [];
        await _authFetch('imi_teams.json', 'PUT', _teamsToFirebase(teamsData));
        _renderUserMgmt();
    }
    async function _umDeleteTeam(team){
        if(!confirm(team+' 팀을 삭제하시겠습니까?\n(소속 멤버의 팀/파트 배정이 해제됩니다)')) return;
        var teamsData = await _umLoadTeams();
        delete teamsData[team];
        await _authFetch('imi_teams.json', 'PUT', _teamsToFirebase(teamsData));
        var users = await _authFetch('imi_users.json') || {};
        var tasks = Object.entries(users)
            .filter(function(e){ return e[1].team === team; })
            .map(function(e){ return _authFetch('imi_users/'+e[0]+'/team.json', 'PUT', '').then(function(){
                return _authFetch('imi_users/'+e[0]+'/part.json', 'PUT', '');
            }); });
        await Promise.all(tasks);
        _renderUserMgmt();
    }

    // ── 파트 CRUD ──────────────────────────────────────────────────
    async function _umAddPart(team){
        var inp = document.getElementById('umNewPartInput_'+team);
        var name = inp ? inp.value.trim() : '';
        if(!name){ alert('파트 이름을 입력해주세요.'); return; }
        var teamsData = await _umLoadTeams();
        if(!teamsData[team]) teamsData[team] = [];
        if(teamsData[team].includes(name)){ alert('이미 존재하는 파트입니다.'); return; }
        teamsData[team].push(name);
        await _authFetch('imi_teams.json', 'PUT', _teamsToFirebase(teamsData));
        _renderUserMgmt();
    }
    async function _umDeletePart(team, part){
        if(!confirm('['+team+'] '+part+' 파트를 삭제하시겠습니까?\n(소속 멤버의 파트 배정이 해제됩니다)')) return;
        var teamsData = await _umLoadTeams();
        if(teamsData[team]) teamsData[team] = teamsData[team].filter(function(p){ return p !== part; });
        await _authFetch('imi_teams.json', 'PUT', _teamsToFirebase(teamsData));
        var users = await _authFetch('imi_users.json') || {};
        var tasks = Object.entries(users)
            .filter(function(e){ return e[1].team === team && e[1].part === part; })
            .map(function(e){ return _authFetch('imi_users/'+e[0]+'/part.json', 'PUT', ''); });
        await Promise.all(tasks);
        _renderUserMgmt();
    }
    async function _umMovePart(team, idx, dir){
        var teamsData = await _umLoadTeams();
        var parts = teamsData[team];
        if(!parts) return;
        var newIdx = idx + dir;
        if(newIdx < 0 || newIdx >= parts.length) return;
        var tmp = parts[idx]; parts[idx] = parts[newIdx]; parts[newIdx] = tmp;
        await _authFetch('imi_teams.json', 'PUT', _teamsToFirebase(teamsData));
        _renderUserMgmt();
    }

    // ── 유저 필드 변경 ──────────────────────────────────────────────
    async function _umSetTeam(key, team){
        // 팀 바꾸면 파트 초기화 + 화면 새로고침 (파트 select 옵션이 바뀌므로)
        await _authFetch('imi_users/'+key+'/team.json', 'PUT', team);
        await _authFetch('imi_users/'+key+'/part.json', 'PUT', '');
        _renderUserMgmt();
    }
    async function _umSetPart(key, part){
        await _authFetch('imi_users/'+key+'/part.json', 'PUT', part);
    }
    async function _umToggleMonitor(key, current){
        await _authFetch('imi_users/'+key+'/monitor_disabled.json', 'PUT', !current);
        _renderUserMgmt();
    }
    async function _umToggleOsNotif(key, current){
        await _authFetch('imi_users/'+key+'/os_notif_disabled.json', 'PUT', !current);
        _renderUserMgmt();
    }

    async function _umSetRole(key, role){
        if(!confirm('권한을 변경하시겠습니까?')) return;
        await _authFetch('imi_users/'+key+'/role.json', 'PUT', role);
        _renderUserMgmt();
    }
    async function _umSetEmpId(key, name, current){
        var val = prompt('['+name+'] 사번을 입력하세요.\n현재: '+(current||'없음'), current||'');
        if(val === null) return;
        val = val.trim();
        await _authFetch('imi_users/'+key+'/emp_id.json', 'PUT', val);
        _renderUserMgmt();
    }

    // ── 승인/거절/삭제 ─────────────────────────────────────────────
    async function _authApprove(key){
        await _authFetch('imi_users/'+key+'/approved.json', 'PUT', true);
        _authWatchPending();
        _renderUserMgmt();
    }
    async function _authReject(key){
        if(!confirm('이 가입 신청을 거절하고 삭제하시겠습니까?')) return;
        await _authFetch('imi_users/'+key+'.json', 'DELETE');
        _authWatchPending();
        _renderUserMgmt();
    }
    async function _authDelete(key, name){
        if(!confirm(name+' 회원을 삭제하시겠습니까?')) return;
        await _authFetch('imi_users/'+key+'.json', 'DELETE');
        _renderUserMgmt();
    }
    function _openAdminChange(){ _openUserChangePw(); }

    // ================================

        // 알림 설정 (개인 저장)
    var _notifPrefs = {flash:true, popup:true, sound:false, watchPopup:false};
    function _loadNotifPrefs(){
        try{ var s=localStorage.getItem('imi_notif_prefs'); if(s) _notifPrefs=Object.assign({flash:true,popup:true,sound:false,watchPopup:false},JSON.parse(s)); }catch(e){}
        _applyNotifPrefs();
    }
    function _applyNotifPrefs(){
        ['flash','popup','sound','watchPopup'].forEach(function(k){
            var btn=document.getElementById('tog-'+k); if(!btn) return;
            var on=_notifPrefs[k];
            btn.style.background=on?'#22c55e':'#475569';
            var dot=btn.querySelector('.sw-dot');
            if(dot) dot.style.transform=on?'translateX(20px)':'translateX(0px)';
        });
    }
    var _globalTodayOnly = false;
    function _applyGlobalTodayOnlyUI(val) {
        _globalTodayOnly = !!val;
        var btn = document.getElementById('tog-global-today'); if (!btn) return;
        btn.style.background = _globalTodayOnly ? '#f59e0b' : '#475569';
        var dot = btn.querySelector('.sw-dot');
        if (dot) dot.style.transform = _globalTodayOnly ? 'translateX(20px)' : 'translateX(0px)';
    }
    function _loadGlobalTodayOnly() {
        db.ref('/global_today_only').once('value', function(snap) { _applyGlobalTodayOnlyUI(!!snap.val()); });
    }
    function toggleGlobalTodayOnly() {
        _globalTodayOnly = !_globalTodayOnly;
        db.ref('/global_today_only').set(_globalTodayOnly);
        _applyGlobalTodayOnlyUI(_globalTodayOnly);
    }
    function switchMonTab(n){
        [1,2,3,4,5].forEach(function(i){
            document.getElementById('monTab'+i).classList.toggle('mon-tab-active',i===n);
            document.getElementById('monTabContent'+i).style.display=i===n?'flex':'none';
        });
        if(n===1) _loadGlobalTodayOnly();
        if(n===3) _applyNotifPrefs();
        if(n===2) {
            _renderBotRuleList();
            _loadFraudHours();
            var fw = document.getElementById('botRuleFormWrap');
            if(fw) fw.style.display = _isBotPrivileged() ? '' : 'none';
        }
        if(n===4) { _renderWatchedTids(); _loadWatchInterval(); }
        if(n===5) {
            _renderWatchRules();
            _loadWatchHours();
            var wsrFW = document.getElementById('wsrFormWrap');
            if(wsrFW) wsrFW.style.display = _isBotPrivileged() ? '' : 'none';
        }
    }
    function _fmtTimeInput(el){
        var pos = el.selectionStart;
        var v = el.value.replace(/[^0-9]/g,'');
        if(v.length > 2) v = v.slice(0,2) + ':' + v.slice(2);
        if(v.length > 5) v = v.slice(0,5) + ':' + v.slice(5);
        if(v.length > 8) v = v.slice(0,8);
        el.value = v;
    }
    function _loadWatchHours(){
        db.ref('/imi_watch_hours').once('value', function(snap){
            var wh = snap.val() || { enabled:false, from:'09:00:00', to:'00:00:00' };
            var tog = document.getElementById('tog-watch-hours');
            var range = document.getElementById('watchHoursRange');
            var fromEl = document.getElementById('watchHoursFrom');
            var toEl   = document.getElementById('watchHoursTo');
            if(fromEl) fromEl.value = wh.from || '09:00:00';
            if(toEl)   toEl.value   = wh.to   || '00:00:00';
            if(tog){
                tog.style.background = wh.enabled ? '#22c55e' : '#475569';
                var dot = tog.querySelector('.sw-dot');
                if(dot) dot.style.transform = wh.enabled ? 'translateX(20px)' : 'translateX(0)';
            }
            if(range){
                range.style.opacity = wh.enabled ? '1' : '0.4';
                range.style.pointerEvents = wh.enabled ? '' : 'none';
            }
        });
    }
    function toggleWatchHours(){
        db.ref('/imi_watch_hours').once('value', function(snap){
            var wh = snap.val() || { enabled:false, from:'09:00', to:'00:00' };
            wh.enabled = !wh.enabled;
            db.ref('/imi_watch_hours').set(wh, _loadWatchHours);
        });
    }
    function saveWatchHours(){
        var from = (document.getElementById('watchHoursFrom')||{}).value || '09:00';
        var to   = (document.getElementById('watchHoursTo')||{}).value   || '00:00';
        db.ref('/imi_watch_hours').once('value', function(snap){
            var wh = snap.val() || { enabled:false };
            wh.from = from; wh.to = to;
            db.ref('/imi_watch_hours').set(wh, function(){
                _loadWatchHours();
                var btn = document.querySelector('[onclick="saveWatchHours()"]');
                if(btn){ var orig=btn.textContent; btn.textContent='✓'; setTimeout(function(){ btn.textContent=orig; }, 1200); }
            });
        });
    }
    function _loadFraudHours(){
        db.ref('/imi_fraud_hours').once('value', function(snap){
            var fh = snap.val() || { enabled:false, from:'09:00:00', to:'00:00:00' };
            var tog = document.getElementById('tog-fraud-hours');
            var range = document.getElementById('fraudHoursRange');
            var fromEl = document.getElementById('fraudHoursFrom');
            var toEl   = document.getElementById('fraudHoursTo');
            if(fromEl) fromEl.value = fh.from || '09:00:00';
            if(toEl)   toEl.value   = fh.to   || '00:00:00';
            if(tog){
                tog.style.background = fh.enabled ? '#ef4444' : '#475569';
                var dot = tog.querySelector('.sw-dot');
                if(dot) dot.style.transform = fh.enabled ? 'translateX(20px)' : 'translateX(0)';
            }
            if(range){
                range.style.opacity = fh.enabled ? '1' : '0.4';
                range.style.pointerEvents = fh.enabled ? '' : 'none';
            }
        });
    }
    function toggleFraudHours(){
        db.ref('/imi_fraud_hours').once('value', function(snap){
            var fh = snap.val() || { enabled:false, from:'09:00:00', to:'00:00:00' };
            fh.enabled = !fh.enabled;
            db.ref('/imi_fraud_hours').set(fh, _loadFraudHours);
        });
    }
    function saveFraudHours(){
        var from = (document.getElementById('fraudHoursFrom')||{}).value || '09:00:00';
        var to   = (document.getElementById('fraudHoursTo')||{}).value   || '00:00:00';
        db.ref('/imi_fraud_hours').once('value', function(snap){
            var fh = snap.val() || { enabled:false };
            fh.from = from; fh.to = to;
            db.ref('/imi_fraud_hours').set(fh, function(){
                _loadFraudHours();
                var btn = document.querySelector('[onclick="saveFraudHours()"]');
                if(btn){ var orig=btn.textContent; btn.textContent='✓'; setTimeout(function(){ btn.textContent=orig; }, 1200); }
            });
        });
    }
    function toggleNotif(key){
        _notifPrefs[key]=!_notifPrefs[key];
        try{ localStorage.setItem('imi_notif_prefs',JSON.stringify(_notifPrefs)); }catch(e){}
        _applyNotifPrefs();
        if(key==='popup')      window.postMessage({__imiBot:true,type:'UPDATE_NOTIF_PREF',key:'popup',val:_notifPrefs.popup},'*');
        if(key==='watchPopup') window.postMessage({__imiBot:true,type:'UPDATE_NOTIF_PREF',key:'watchPopup',val:_notifPrefs.watchPopup},'*');
    }
    function applyTheme(name){
        document.getElementById('mainBody').className = name+'-mode';
        document.getElementById('themeBtn').innerText = themeIcons[name];
        localStorage.setItem('imi_theme_v2', name);
        themeIdx = themes.indexOf(name);
        switchMode(currentMode);
    }
    function updateFontSize(v){
        v=parseInt(v);
        document.documentElement.style.setProperty('--base-font', v+'px');
        document.getElementById('fontDisplay').innerText = v;
        localStorage.setItem('imi_font_size', v);
        var chatBox=document.getElementById('chatBox');
        var chatW=chatBox ? chatBox.clientWidth : 800;
        // 이미지 크기: 12→72%/75%, 14→77%/80%, 16→82%/85%, 18→87%/90%, 20→92%/95%
        var maniaPct=Math.min(72+(v-12)*2.5, 95);
        var bayPct=Math.min(75+(v-12)*2.5, 97);
        var maxW=Math.round(chatW*0.97);
        var maniaW=Math.min(Math.round(chatW*maniaPct/100), maxW);
        var bayW=Math.min(Math.round(chatW*bayPct/100), maxW);
        var bubbleMaxW=Math.min(88+Math.max(0,v-16)*4.5, 97);
        document.documentElement.style.setProperty('--bubble-max-w', bubbleMaxW+'%');
        document.documentElement.style.setProperty('--mania-mv-w', maniaW+'px');
        document.documentElement.style.setProperty('--bay-mv-w', bayW+'px');
        // 티커 폰트: base-font에 비례 (16→11.5px, 18→13px, 20→14.4px)
        var tickerFont = Math.max(8, Math.round(v * 0.72 * 10) / 10);
        document.documentElement.style.setProperty('--ticker-font', tickerFont+'px');
        // 티커 내부 높이도 함께 조정
        var tickerH = Math.round(v * 1.75);
        document.documentElement.style.setProperty('--ticker-inner-h', tickerH+'px');
    }
    function adjustFontSize(delta){
        var cur = parseInt(document.getElementById('fontDisplay').innerText) || 16;
        var next = Math.min(20, Math.max(12, cur + delta));
        updateFontSize(next);
    }

    /* ── 직원 스케쥴 ── */
    var SCHED_GROUPS = [
        { label:'9시',  key:'g0' },
        { label:'15시', key:'g1' },
        { label:'야간', key:'g2' },
        { label:'12시', key:'g3' },
        { label:'17시', key:'g4' }
    ];
    /* gIdx 기준 표시 순서: 9시(0) 12시(3) 15시(1) 17시(4) 야간(2) */
    var SCHED_DISPLAY_ORDER = [0,3,1,4,2];
    var _schedActiveGroups = null;
    function _schedGroupStorageKey(){ return 'imi_sched_active_v3_'+(_schedTabId||'default')+'_'+_schedYear+'_'+_schedMonth; }
    function _getActiveGroups(){
        if(_schedActiveGroups===null){
            try{var s=JSON.parse(localStorage.getItem(_schedGroupStorageKey()));_schedActiveGroups=Array.isArray(s)?s:SCHED_GROUPS.map(function(g){return g.key;});}
            catch(e){_schedActiveGroups=SCHED_GROUPS.map(function(g){return g.key;});}
        }
        return _schedActiveGroups;
    }
    function _toggleSchedGroup(key){
        var active=_getActiveGroups().slice();
        var idx=active.indexOf(key);
        if(idx>=0){active.splice(idx,1);}else{
            active=SCHED_DISPLAY_ORDER.map(function(gi){return SCHED_GROUPS[gi].key;}).filter(function(k){return active.indexOf(k)>=0||k===key;});
        }
        _schedActiveGroups=active;
        localStorage.setItem(_schedGroupStorageKey(),JSON.stringify(active));
        _renderGroupBtns();
        _buildSchedColMap();
        _renderScheduleTable();
    }
    function _renderGroupBtns(){
        var bar=document.getElementById('schedGroupBtns'); if(!bar)return;
        var active=_getActiveGroups();
        var colors={'g0':'#eab308','g3':'#d946ef','g1':'#06b6d4','g4':'#22c55e','g2':'#8b5cf6'};
        bar.innerHTML='';
        SCHED_DISPLAY_ORDER.forEach(function(gi){
            var g=SCHED_GROUPS[gi];
            var on=active.indexOf(g.key)>=0;
            var c=colors[g.key]||'var(--active-focus-color)';
            var btn=document.createElement('button');
            btn.textContent=g.label;
            btn.style.cssText='padding:2px 10px;border-radius:6px;font-size:10px;font-weight:900;cursor:pointer;transition:all 0.15s;border:1.5px solid '+(on?c:'var(--border-ui)')+';background:'+(on?c+'22':'none')+';color:'+(on?c:'var(--text-sub)')+';';
            btn.onclick=function(){_toggleSchedGroup(g.key);};
            bar.appendChild(btn);
        });
        var hiddenCount = Object.keys(_schedHiddenStaff).length;
        if(hiddenCount > 0){
            var shBtn = document.createElement('button');
            shBtn.innerHTML = '👁 숨김해제 <span style="opacity:0.6">('+hiddenCount+')</span>';
            shBtn.style.cssText = 'padding:2px 8px;border-radius:6px;font-size:10px;font-weight:900;cursor:pointer;border:1.5px solid var(--active-focus-color);background:rgba(59,130,246,0.1);color:var(--active-focus-color);margin-left:4px;transition:0.15s;';
            shBtn.onmouseover = function(){ this.style.background='var(--active-focus-color)'; this.style.color='#fff'; };
            shBtn.onmouseout = function(){ this.style.background='rgba(59,130,246,0.1)'; this.style.color='var(--active-focus-color)'; };
            shBtn.onclick = clearSchedHidden;
            bar.appendChild(shBtn);
        }
    }
    var _schedYear = 2026, _schedMonth = 4;
    var _schedViewMode = 'month'; // 'month' | 'week'
    var _schedWeekIndex = 0;
    var _schedStamp = '휴무';
    var _schedCells = {}, _schedNames = {};
    var _schedDragging = false;
    var _schedCtrlMode = false;
    var _schedDragSeen = {};
    var _schedMemos = {}, _schedMemoActiveKey = null;
    var _schedCellRef = null, _schedCellListener = null;
    var _schedColors = {}, _schedColorPickerTarget = null;
    var _schedSelecting = false;
    var _schedSelStartCol = null, _schedSelStartDay = null;
    var _schedSelEndCol = null, _schedSelEndDay = null;
    var _schedRowSelecting = false;
    var _schedRowSelStart = null;
    var _schedTabId = '';
    var _schedTabs = [];
    var _schedDefaultTabName = '고객상담팀';
    var _schedEditMode = false;
    var _schedRowSelEnd = null;
    var _schedRowSelBase = [];
    var _schedColMap = [];
    var _schedHiddenStaff = {};
    try { _schedHiddenStaff = JSON.parse(localStorage.getItem('imi_sched_hidden')||'{}'); } catch(e){}
    var _GCOL = ['#eab308','#06b6d4','#8b5cf6','#d946ef','#22c55e'];
    var _SCHED_COL_PALETTE = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#6366f1','#8b5cf6','#06b6d4','#f59e0b','#78716c','#94a3b8'];
    var _prevSchedCells = {}, _prevSchedMemos = {};
    var _nextSchedCells = {}, _nextSchedMemos = {};
    var _schedUndoStack = [];
    var _schedFocusKey = null;
    var _schedSelAnchorCol = null, _schedSelAnchorDay = null;
    /* ── 공휴일 데이터 2024-2030 (superkts.com 기준) ── */
    var KR_HOLIDAYS = {
        2024:{1:[1],2:[9,10,11,12],3:[1],4:[10],5:[5,6,15],6:[6],8:[15],9:[16,17,18],10:[3,9],12:[25]},
        2025:{1:[1,27,28,29,30],3:[1,3],5:[5,6],6:[3,6],8:[15],10:[3,5,6,7,8,9],12:[25]},
        2026:{1:[1],2:[16,17,18],3:[1,2],5:[5,24,25],6:[6],8:[15,17],9:[24,25,26],10:[3,5,9],12:[25]},
        2027:{1:[1],2:[6,7,8,9],3:[1],5:[5,13],6:[6],8:[15,16],9:[14,15,16],10:[3,4,9,11],12:[25,27]},
        2028:{1:[1,26,27,28],3:[1],4:[12],5:[2,5],6:[6],8:[15],10:[2,3,4,5,9],12:[25]},
        2029:{1:[1,12,13,14],3:[1],5:[5,7,20,21],6:[6],8:[15],9:[21,22,23,24],10:[3,9],12:[25]},
        2030:{1:[1],2:[2,3,4,5],3:[1],5:[5,6,9],6:[6],8:[15],9:[11,12,13],10:[3,9],12:[25]}
    };
    var _schedCustomHolidays = {};
    function _isKrHoliday(year, month, day){
        var fixed=(KR_HOLIDAYS[year]||{})[month]||[];
        if(fixed.indexOf(day)>=0) return true;
        var custom=_schedCustomHolidays[month]||[];
        return custom.indexOf(day)>=0;
    }
    function _getWeekRanges(year, month) {
        var ranges = [];
        var days = new Date(year, month, 0).getDate();
        var currentWeek = [];
        
        var firstDow = new Date(year, month-1, 1).getDay();
        if(firstDow > 0) {
            var prevMonthDays = new Date(year, month-1, 0).getDate();
            for(var i=0; i<firstDow; i++) {
                var pD = prevMonthDays - firstDow + 1 + i;
                var pM = month === 1 ? 12 : month - 1;
                var pY = month === 1 ? year - 1 : year;
                currentWeek.push({y: pY, m: pM, d: pD, isCur: false});
            }
        }
        
        for(var d=1; d<=days; d++) {
            var dow = new Date(year, month-1, d).getDay();
            currentWeek.push({y: year, m: month, d: d, isCur: true});
            if(dow === 6 || d === days) {
                if(d === days && dow !== 6) {
                    var nextD = 1;
                    for(var i=dow+1; i<=6; i++) {
                        var nM = month === 12 ? 1 : month + 1;
                        var nY = month === 12 ? year + 1 : year;
                        currentWeek.push({y: nY, m: nM, d: nextD++, isCur: false});
                    }
                }
                ranges.push(currentWeek);
                currentWeek = [];
            }
        }
        return ranges;
    }
    function _schedKeyDown(e){
        var tag = document.activeElement ? document.activeElement.tagName : '';
        var inInput = (tag==='INPUT'||tag==='TEXTAREA'||document.activeElement.isContentEditable);
        if(e.key==='Escape'){
            if(_schedSelStartCol!==null){ _schedClearSel(); return; }
            if(_schedRowSelStart!==null){ _schedRowClearSel(); return; }
            if(!inInput){ closeMemoPopup(); closeColorPicker(); closeScheduleModal(); }
        } else if((e.ctrlKey||e.metaKey) && e.key==='c'){
            if(!inInput && _schedSelStartCol!==null){ e.preventDefault(); _schedCopySelection(); }
        } else if((e.ctrlKey||e.metaKey) && e.key==='z'){
            if(!inInput){ e.preventDefault(); _schedUndo(); }
        } else if(!inInput && !_schedStamp && _schedFocusKey && !e.ctrlKey && !e.metaKey && !e.altKey){
            if(e.key==='Delete'||e.key==='Backspace'){
                e.preventDefault(); _schedSaveCell(_schedFocusKey, '');
            } else if(e.key==='Enter'||e.key==='F2'){
                e.preventDefault();
                var _fk=_schedFocusKey, _fc=document.getElementById('scell_'+_fk);
                if(_fc){ var _cv=(_schedCells[_fk]||'').split('|')[0]; _showCellInlineEdit(_fc,_cv,function(nv){ if(nv!==null) _schedSaveCell(_fk,nv); }); }
            } else if(e.key.length===1){
                e.preventDefault();
                var _fk2=_schedFocusKey, _fc2=document.getElementById('scell_'+_fk2);
                if(_fc2){ _showCellInlineEdit(_fc2,'',function(nv){ if(nv!==null) _schedSaveCell(_fk2,nv); }); }
            }
        }
    }
    function _buildSchedColMap(){
        _schedColMap = [];
        var active=_getActiveGroups();
        SCHED_DISPLAY_ORDER.forEach(function(gIdx){
            var g=SCHED_GROUPS[gIdx];
            if(active.indexOf(g.key)<0)return;
            var ids=Object.keys(_schedNames[g.key]||{}).map(Number).sort(function(a,b){return a-b;})
                .filter(function(sid){ return !_schedHiddenStaff[g.key+'_'+sid]; });
            ids.forEach(function(sid){ _schedColMap.push({gIdx:gIdx,staffId:sid}); });
        });
    }
    function _schedGetColIdx(gIdx,staffId){
        for(var i=0;i<_schedColMap.length;i++){
            if(_schedColMap[i].gIdx===gIdx&&_schedColMap[i].staffId===staffId) return i;
        }
        return -1;
    }
    function _schedSelBegin(gIdx,staffId,day){
        var col=_schedGetColIdx(gIdx,staffId);
        if(col<0) return;
        _schedSelecting=true;
        _schedSelStartCol=col; _schedSelStartDay=day;
        _schedSelEndCol=col; _schedSelEndDay=day;
        _renderSchedSelection();
    }
    function _schedSelOver(gIdx,staffId,day){
        if(!_schedSelecting) return;
        var col=_schedGetColIdx(gIdx,staffId);
        if(col<0) return;
        _schedSelEndCol=col; _schedSelEndDay=day;
        _renderSchedSelection();
    }
    function _schedClearSel(){
        _schedSelStartCol=null; _schedSelStartDay=null;
        _schedSelEndCol=null; _schedSelEndDay=null;
        _schedSelecting=false;
        document.querySelectorAll('.sched-sel').forEach(function(c){ c.classList.remove('sched-sel'); });
    }
    function _renderSchedSelection(){
        document.querySelectorAll('.sched-sel').forEach(function(c){ c.classList.remove('sched-sel'); });
        if(_schedSelStartCol===null) return;
        var c1=Math.min(_schedSelStartCol,_schedSelEndCol);
        var c2=Math.max(_schedSelStartCol,_schedSelEndCol);
        var d1=Math.min(_schedSelStartDay,_schedSelEndDay);
        var d2=Math.max(_schedSelStartDay,_schedSelEndDay);
        for(var ci=c1;ci<=c2;ci++){
            var cm=_schedColMap[ci]; if(!cm) continue;
            for(var d=d1;d<=d2;d++){
                var cell=document.getElementById('scell_'+_schedCellKey(cm.gIdx,cm.staffId,d));
                if(cell) cell.classList.add('sched-sel');
            }
        }
    }
    function _schedCopySelection(){
        if(_schedSelStartCol===null) return;
        var c1=Math.min(_schedSelStartCol,_schedSelEndCol);
        var c2=Math.max(_schedSelStartCol,_schedSelEndCol);
        var d1=Math.min(_schedSelStartDay,_schedSelEndDay);
        var d2=Math.max(_schedSelStartDay,_schedSelEndDay);
        var rows=[];
        /* 헤더행: 이름 */
        var hdr=[];
        for(var ci=c1;ci<=c2;ci++){
            var cm=_schedColMap[ci];
            hdr.push(cm?((_schedNames[SCHED_GROUPS[cm.gIdx].key]||{})[cm.staffId]||''):'');
        }
        rows.push(hdr.join('\t'));
        for(var d=d1;d<=d2;d++){
            var row=[];
            for(var ci2=c1;ci2<=c2;ci2++){
                var cm2=_schedColMap[ci2];
                row.push(cm2?(_schedCells[_schedCellKey(cm2.gIdx,cm2.staffId,d)]||''):'');
            }
            rows.push(d+'\t'+row.join('\t'));
        }
        navigator.clipboard.writeText(rows.join('\n')).catch(function(){});
        var flash=document.getElementById('schedCopyFlash');
        if(flash){ flash.style.display='block'; setTimeout(function(){ flash.style.display='none'; },1400); }
    }
    
    function schedRowSelBegin(e, d) {
        if (!e.shiftKey) {
            document.querySelectorAll('.sched-row-highlight').forEach(function(el) {
                el.classList.remove('sched-row-highlight');
            });
            var tr = document.getElementById('srow_' + d);
            if (tr) tr.classList.add('sched-row-highlight');
        } else {
            var tr = document.getElementById('srow_' + d);
            if (tr) tr.classList.toggle('sched-row-highlight');
        }
        _schedRowSelecting = true;
        _schedRowSelStart = d;
        _schedRowSelEnd = d;
        _schedRowSelBase = [];
        document.querySelectorAll('.sched-row-highlight').forEach(function(el) {
            _schedRowSelBase.push(el.id);
        });
    }
    
    function schedRowSelOver(e, d) {
        if (!_schedRowSelecting) return;
        _schedRowSelEnd = d;
        document.querySelectorAll('.sched-row-highlight').forEach(function(el) {
            el.classList.remove('sched-row-highlight');
        });
        _schedRowSelBase.forEach(function(id) {
            var tr = document.getElementById(id);
            if (tr) tr.classList.add('sched-row-highlight');
        });
        var d1 = Math.min(_schedRowSelStart, _schedRowSelEnd);
        var d2 = Math.max(_schedRowSelStart, _schedRowSelEnd);
        for (var i = d1; i <= d2; i++) {
            var tr = document.getElementById('srow_' + i);
            if (tr) tr.classList.add('sched-row-highlight');
        }
    }
    function _schedRowClearSel() {
        _schedRowSelecting = false;
        _schedRowSelStart = null;
        _schedRowSelEnd = null;
        _schedRowSelBase = [];
        document.querySelectorAll('.sched-row-highlight').forEach(function(el) {
            el.classList.remove('sched-row-highlight');
        });
    }

    function _updateScheduleTitle() {
        var titleEl = document.getElementById('scheduleTitle');
        if(!titleEl) return;
        if(_schedViewMode === 'week') {
            titleEl.textContent = _schedYear+'년 '+_schedMonth+'월 '+(_schedWeekIndex+1)+'주차 스케쥴';
        } else {
            titleEl.textContent = _schedYear+'년 '+_schedMonth+'월 스케쥴';
        }
    }

    function setSchedViewMode(mode) {
        if(window._schedViewMode === mode) return;
        window._schedViewMode = mode;
        var btnM = document.getElementById('btnSchedViewMonth');
        var btnW = document.getElementById('btnSchedViewWeek');
        var tb = document.getElementById('schedStampToolbar');
        if(mode === 'month') {
            if(btnM){ btnM.style.background = 'var(--active-focus-color)'; btnM.style.color = '#fff'; }
            if(btnW){ btnW.style.background = 'transparent'; btnW.style.color = 'var(--text-sub)'; }
            if(tb) tb.style.display = 'flex';
        } else {
            if(btnW){ btnW.style.background = 'var(--active-focus-color)'; btnW.style.color = '#fff'; }
            if(btnM){ btnM.style.background = 'transparent'; btnM.style.color = 'var(--text-sub)'; }
            if(tb) tb.style.display = 'none';
            var now = new Date();
            if(now.getFullYear() === _schedYear && (now.getMonth() + 1) === _schedMonth) {
                var d = now.getDate();
                var ranges = _getWeekRanges(_schedYear, _schedMonth);
                for(var i=0; i<ranges.length; i++){
                    if(ranges[i].some(function(item){return item.d === d && item.isCur;})) { _schedWeekIndex = i; break; }
                }
            } else {
                _schedWeekIndex = 0;
            }
            _schedClearSel();
            _schedRowClearSel();
        }
        _updateScheduleTitle();
        _renderScheduleTable();
    }

    function _loadSchedTabs(){
        db.ref('work_schedule/_tab_defs').once('value', function(snap){
            var raw = snap.val();
            _schedTabs = (Array.isArray(raw) && raw.length) ? raw.filter(Boolean) : [];
            db.ref('work_schedule/_default_tab_name').once('value', function(snap2){
                var n = snap2.val();
                _schedDefaultTabName = (n && typeof n === 'string') ? n : '고객상담팀';
                _renderSchedTabs();
            });
        });
    }
    function _renderSchedTabs(){
        var bar = document.getElementById('schedTabBar');
        if(!bar) return;
        var isAdmin = _currentUser && _currentUser.role === 'admin';
        var allTabs = [{id:'', name:_schedDefaultTabName}].concat(_schedTabs);
        bar.innerHTML = '';
        allTabs.forEach(function(tab){
            var active = _schedTabId === tab.id;
            var wrap = document.createElement('div');
            wrap.style.cssText = 'display:flex;align-items:center;gap:3px;padding:0 14px;cursor:pointer;font-size:11px;font-weight:900;border-bottom:2.5px solid '+(active?'var(--active-focus-color)':'transparent')+';color:'+(active?'var(--active-focus-color)':'var(--text-sub)')+';white-space:nowrap;transition:all 0.15s;flex-shrink:0;user-select:none;height:100%;box-sizing:border-box;';
            var nameSpan = document.createElement('span');
            nameSpan.textContent = tab.name;
            wrap.appendChild(nameSpan);
            if(isAdmin && active){
                var editBtn = document.createElement('button');
                editBtn.textContent = '✏';
                editBtn.title = '이름 수정';
                editBtn.style.cssText = 'padding:0 3px;border:none;background:none;cursor:pointer;font-size:9px;opacity:0.45;color:inherit;line-height:1;';
                editBtn.onclick = function(e){ e.stopPropagation(); _editSchedTabName(tab.id, tab.name); };
                wrap.appendChild(editBtn);
                if(tab.id !== ''){
                    var delBtn = document.createElement('button');
                    delBtn.textContent = '×';
                    delBtn.title = '탭 삭제';
                    delBtn.style.cssText = 'padding:0 3px;border:none;background:none;cursor:pointer;font-size:13px;opacity:0.4;color:#ef4444;line-height:1;';
                    delBtn.onclick = function(e){ e.stopPropagation(); _deleteSchedTab(tab.id, tab.name); };
                    wrap.appendChild(delBtn);
                }
            }
            if(!active){ wrap.onclick = function(){ _switchSchedTab(tab.id); }; }
            bar.appendChild(wrap);
        });
        if(isAdmin){
            var addBtn = document.createElement('button');
            addBtn.textContent = '＋ 탭 추가';
            addBtn.style.cssText = 'padding:4px 10px;border-radius:6px;border:1.5px dashed var(--border-ui);background:none;color:var(--text-sub);font-size:10px;font-weight:700;cursor:pointer;margin-left:8px;white-space:nowrap;transition:0.15s;flex-shrink:0;align-self:center;';
            addBtn.onmouseover = function(){ this.style.borderColor='var(--active-focus-color)'; this.style.color='var(--active-focus-color)'; };
            addBtn.onmouseout = function(){ this.style.borderColor='var(--border-ui)'; this.style.color='var(--text-sub)'; };
            addBtn.onclick = _addSchedTab;
            bar.appendChild(addBtn);
        }
    }
    function _switchSchedTab(tabId){
        if(_schedTabId === tabId) return;
        _schedTabId = tabId;
        _schedActiveGroups = null;
        _renderSchedTabs();
        _loadScheduleAll();
    }
    function _addSchedTab(){
        var name = prompt('새 탭 이름을 입력하세요:');
        if(!name || !name.trim()) return;
        var id = 'tab_' + Date.now();
        _schedTabs.push({id:id, name:name.trim()});
        _saveSchedTabs(function(){ _renderSchedTabs(); _switchSchedTab(id); });
    }
    function _editSchedTabName(tabId, oldName){
        var name = prompt('탭 이름 변경:', oldName);
        if(!name || !name.trim() || name.trim() === oldName) return;
        if(tabId === ''){
            _schedDefaultTabName = name.trim();
            db.ref('work_schedule/_default_tab_name').set(_schedDefaultTabName, function(err){
                if(!err) _renderSchedTabs();
            });
            return;
        }
        var tab = null;
        for(var i=0; i<_schedTabs.length; i++){ if(_schedTabs[i].id === tabId){ tab=_schedTabs[i]; break; } }
        if(tab){ tab.name = name.trim(); }
        _saveSchedTabs(function(){ _renderSchedTabs(); });
    }
    function _deleteSchedTab(tabId, tabName){
        if(!confirm('"'+tabName+'" 탭을 삭제하시겠습니까?\n(탭 설정만 삭제되며 Firebase 데이터는 유지됩니다)')) return;
        _schedTabs = _schedTabs.filter(function(t){ return t.id !== tabId; });
        _saveSchedTabs(function(){
            if(_schedTabId === tabId){ _schedTabId=''; _schedActiveGroups=null; _renderSchedTabs(); _loadScheduleAll(); }
            else { _renderSchedTabs(); }
        });
    }
    function _saveSchedTabs(cb){
        db.ref('work_schedule/_tab_defs').set(_schedTabs, function(err){
            if(err) console.error('탭 저장 실패', err);
            else if(cb) cb();
        });
    }

    function openScheduleModal(){
        var now = new Date();
        _schedYear = now.getFullYear();
        _schedMonth = now.getMonth()+1;
        var d = now.getDate();
        var ranges = _getWeekRanges(_schedYear, _schedMonth);
        for(var i=0; i<ranges.length; i++){
            if(ranges[i].some(function(item){return item.d === d && item.isCur;})) { _schedWeekIndex = i; break; }
        }
        setScheduleStamp('');
        window._schedViewMode = 'month';
        var btnM = document.getElementById('btnSchedViewMonth');
        var btnW = document.getElementById('btnSchedViewWeek');
        if(btnM) { btnM.style.background = 'var(--active-focus-color)'; btnM.style.color = '#fff'; }
        if(btnW) { btnW.style.background = 'transparent'; btnW.style.color = 'var(--text-sub)'; }
        var tb = document.getElementById('schedStampToolbar');
        if(tb) tb.style.display = 'flex';
        _schedTabId = '';
        _schedFocusKey = null; _schedSelAnchorCol = null; _schedSelAnchorDay = null; _schedUndoStack = [];
        _loadSchedTabs();
        _loadScheduleAll();
        document.getElementById('scheduleModal').classList.remove('hidden');
        document.addEventListener('keydown', _schedKeyDown);
    }
    function closeScheduleModal(){
        _detachSchedCellListener();
        document.getElementById('scheduleModal').classList.add('hidden');
        closeMemoPopup();
        closeColorPicker();
        document.removeEventListener('keydown', _schedKeyDown);
    }
    function scheduleNav(dir){
        if(window._schedViewMode === 'month') {
            _schedMonth += dir;
            if(_schedMonth > 12){ _schedMonth=1; _schedYear++; }
            if(_schedMonth < 1){ _schedMonth=12; _schedYear--; }
            _schedWeekIndex = 0;
            _schedActiveGroups = null;
            _loadScheduleAll();
        } else {
            var ranges = _getWeekRanges(_schedYear, _schedMonth);
            _schedWeekIndex += dir;
            if(_schedWeekIndex < 0) {
                _schedMonth--;
                if(_schedMonth < 1){ _schedMonth=12; _schedYear--; }
                var prevRanges = _getWeekRanges(_schedYear, _schedMonth);
                _schedWeekIndex = prevRanges.length - 1;
                _schedActiveGroups = null;
                _loadScheduleAll();
            } else if(_schedWeekIndex >= ranges.length) {
                _schedMonth++;
                if(_schedMonth > 12){ _schedMonth=1; _schedYear++; }
                _schedWeekIndex = 0;
                _schedActiveGroups = null;
                _loadScheduleAll();
            } else {
                _updateScheduleTitle();
                _renderScheduleTable();
            }
        }
    }
    function setScheduleStamp(val){
        if(val && val===_schedStamp){ val=''; } /* 같은 버튼 재클릭 → 해제 */
        _schedStamp = val || '';
        var btnIds = ['stamp_휴무','stamp_9시','stamp_12시','stamp_15시','stamp_17시','stamp_연차','stamp_반차','stamp_안식','stamp_교육','stamp_출장','stamp_육아','stamp_제외'];
        var btnVals = ['휴무','9시','12시','15시','17시','연차','반차','안식','교육','출장','육아','제외'];
        btnIds.forEach(function(id, i){
            var btn = document.getElementById(id);
            if(!btn) return;
            if(val && btnVals[i]===val){
                btn.style.opacity='1'; btn.style.transform='scale(1.1)'; btn.style.boxShadow='0 0 0 2.5px var(--active-focus-color)';
            } else {
                btn.style.opacity='0.55'; btn.style.transform='scale(1)'; btn.style.boxShadow='none';
            }
        });
        var wrap = document.getElementById('scheduleTableWrap');
        if(wrap) {
            if(_schedStamp) wrap.classList.add('stamp-mode');
            else wrap.classList.remove('stamp-mode');
        }
    }
    function _detachSchedCellListener(){
        if(_schedCellRef && _schedCellListener){
            _schedCellRef.off('value', _schedCellListener);
            _schedCellRef = null;
            _schedCellListener = null;
        }
    }
    function _schedFbRoot(){ return _schedTabId ? 'work_schedule/tabs/'+_schedTabId+'/' : 'work_schedule/'; }
    function _staffMonthPath(){ return _schedFbRoot()+'staff_by_month/'+_schedYear+'/'+_schedMonth; }
    function _parseStaffRaw(rawNames){
        var names={};
        SCHED_GROUPS.forEach(function(g){
            var raw=rawNames[g.key];
            if(!raw||typeof raw!=='object'){ names[g.key]={}; }
            else if(Array.isArray(raw)){ var o={}; raw.forEach(function(n,i){ if(n!=null)o[i]=n; }); names[g.key]=o; }
            else { names[g.key]=raw; }
        });
        return names;
    }
    function _loadScheduleAll(){
        _detachSchedCellListener();
        _updateScheduleTitle();
        document.getElementById('scheduleTableWrap').innerHTML = '<div style="padding:30px;text-align:center;opacity:0.4;font-size:13px;">불러오는 중...</div>';

        /* 탭ID를 시작 시점에 캡처 — 비동기 콜백에서 _schedTabId가 바뀌어도 안전 */
        var myTabId = _schedTabId;
        function myRoot(){ return myTabId ? 'work_schedule/tabs/'+myTabId+'/' : 'work_schedule/'; }
        function myStaffPath(){ return myRoot()+'staff_by_month/'+_schedYear+'/'+_schedMonth; }
        function isStale(){ return _schedTabId !== myTabId; }

        var py = _schedMonth === 1 ? _schedYear - 1 : _schedYear;
        var pm = _schedMonth === 1 ? 12 : _schedMonth - 1;
        var ny = _schedMonth === 12 ? _schedYear + 1 : _schedYear;
        var nm = _schedMonth === 12 ? 1 : _schedMonth + 1;

        db.ref(myRoot()+py+'/'+pm).once('value').then(function(ps){
            if(isStale()) return;
            var pVal = ps.val() || {};
            _prevSchedCells = pVal.cells || {};
            _prevSchedMemos = pVal.memos || {};
            return db.ref(myRoot()+ny+'/'+nm).once('value');
        }).then(function(ns){
            if(!ns || isStale()) return;
            var nVal = ns.val() || {};
            _nextSchedCells = nVal.cells || {};
            _nextSchedMemos = nVal.memos || {};

            /* 달별 직원 경로 시도 → 없으면 전역 staff 복사 */
            db.ref(myStaffPath()).once('value', function(snapS){
                if(isStale()) return;
                var rawS=snapS.val();
                function _continueLoad(rawNames){
                    if(isStale()) return;
                    _schedNames=_parseStaffRaw(rawNames);
                    var rawC={};
                    try{ rawC=JSON.parse(localStorage.getItem('imi_sched_colors')||'{}'); }catch(e){}
                    _schedColors={};
                    SCHED_GROUPS.forEach(function(g){ _schedColors[g.key]=(rawC[g.key]&&typeof rawC[g.key]==='object')?rawC[g.key]:{}; });
                    db.ref('work_schedule/custom_holidays/'+_schedYear).once('value', function(snapH){
                        if(isStale()) return;
                        var rawH=snapH.val()||{};
                        _schedCustomHolidays={};
                        Object.keys(rawH).forEach(function(m){ var arr=rawH[m]; _schedCustomHolidays[parseInt(m)]=Array.isArray(arr)?arr:Object.values(arr).map(Number); });
                        _schedCellRef=db.ref(myRoot()+_schedYear+'/'+_schedMonth);
                        _schedCellListener=_schedCellRef.on('value', function(snap2){
                            if(isStale()){ _detachSchedCellListener(); return; }
                            var md=snap2.val()||{};
                            _schedCells=md.cells||{};
                            _schedMemos=md.memos||{};
                            try{ _renderGroupBtns(); _renderScheduleTable(); }
                            catch(e){ console.error('render error', e); }
                        });
                    });
                }
                if(rawS){
                    _continueLoad(rawS);
                } else {
                    /* 해당 탭/달 첫 방문 → 전역 staff 복사 후 달별 저장 */
                    db.ref(myRoot()+'staff').once('value', function(snapG){
                        if(isStale()) return;
                        var rawG=snapG.val()||{};
                        var toSave={};
                        SCHED_GROUPS.forEach(function(g){
                            var raw=rawG[g.key];
                            if(raw&&typeof raw==='object'){
                                if(Array.isArray(raw)){ var o={}; raw.forEach(function(n,i){ if(n!=null)o[i]=n; }); toSave[g.key]=o; }
                                else { toSave[g.key]=raw; }
                            } else { toSave[g.key]={}; }
                        });
                        db.ref(myStaffPath()).set(toSave);
                        _continueLoad(toSave);
                    });
                }
            });
        }).catch(function(e){
            if(isStale()) return;
            console.error(e);
            document.getElementById('scheduleTableWrap').innerHTML = '<div style="padding:30px;color:#ef4444;text-align:center;">데이터를 불러오는 중 오류가 발생했습니다.</div>';
        });
    }
    function _schedCellKey(gIdx, staffId, day){ return gIdx+'_'+staffId+'_'+day; }
    
    function _onCellMouseDown(e, gIdx, staffId, d) {
        if (window._schedViewMode === 'week') return;
        if (_schedStamp) {
            _schedCtrlMode = !!(e.ctrlKey || e.metaKey);
            _schedDragStart(gIdx, staffId, d);
        } else if (e.shiftKey && _schedSelAnchorCol !== null) {
            var col = _schedGetColIdx(gIdx, staffId);
            _schedSelStartCol = _schedSelAnchorCol; _schedSelStartDay = _schedSelAnchorDay;
            _schedSelEndCol = col; _schedSelEndDay = d;
            _schedSelecting = false;
            _renderSchedSelection();
        } else {
            var col2 = _schedGetColIdx(gIdx, staffId);
            _schedSelAnchorCol = col2; _schedSelAnchorDay = d;
            _schedFocusKey = _schedCellKey(gIdx, staffId, d);
            _schedSelBegin(gIdx, staffId, d);
        }
    }
    function _onCellMouseEnter(gIdx, staffId, d) {
        if (window._schedViewMode === 'week') return;
        if (_schedStamp) {
            _schedDragEnter(gIdx, staffId, d);
        } else {
            _schedSelOver(gIdx, staffId, d);
        }
    }
    function _onCellDblClick(gIdx, staffId, d) {
        if (window._schedViewMode === 'week' || _schedStamp) return;
        var key = _schedCellKey(gIdx, staffId, d);
        var curVal = (_schedCells[key]||'').split('|')[0];
        var cell = document.getElementById('scell_'+key);
        _showCellInlineEdit(cell, curVal, function(newVal){
            if(newVal===null) return;
            _schedSaveCell(key, newVal);
        });
    }
    
    function _schedValColor(v){
        if(v==='휴무') return '#ef4444';
        if(v==='12시') return '#d946ef';
        if(v==='17시') return '#22c55e';
        if(v==='연차') return '#8b5cf6';
        if(v==='반차') return '#f97316';
        if(v==='안식') return '#14b8a6';
        if(v==='9시')  return '#eab308';
        if(v==='15시') return '#06b6d4';
        if(v==='교육') return '#2563eb';
        if(v==='출장') return '#0ea5e9';
        if(v==='육아') return '#ec4899';
        if(v==='제외') return '#6b7280';
        return 'var(--text-main)';
    }
    function _schedValColorFaded(v){
        if(v==='휴무') return 'rgba(239,68,68,0.5)';
        if(v==='12시') return 'rgba(217,70,239,0.5)';
        if(v==='17시') return 'rgba(34,197,94,0.5)';
        if(v==='연차') return 'rgba(139,92,246,0.5)';
        if(v==='반차') return 'rgba(249,115,22,0.5)';
        if(v==='안식') return 'rgba(20,184,166,0.5)';
        if(v==='9시')  return 'rgba(234,179,8,0.5)';
        if(v==='15시') return 'rgba(6,182,212,0.5)';
        if(v==='교육') return 'rgba(37,99,235,0.5)';
        if(v==='출장') return 'rgba(14,165,233,0.5)';
        if(v==='육아') return 'rgba(236,72,153,0.5)';
        if(v==='제외') return 'rgba(107,114,128,0.5)';
        return 'rgba(140,140,140,0.5)';
    }
    function _schedPrefixTxt(val, faded){
        var known=['교육','출장','육아','휴무','연차','반차','안식','9시','12시','15시','17시'];
        for(var i=0;i<known.length;i++){
            var kw=known[i];
            if(val.startsWith(kw)&&val.length>kw.length){
                var col=faded?_schedValColorFaded(kw):_schedValColor(kw);
                var sfxCol=faded?'rgba(255,255,255,0.4)':'#fff';
                return '<span style="color:'+col+';font-weight:900;">'+kw+'</span>'+
                       '<span style="color:'+sfxCol+';font-weight:900;">'+val.slice(kw.length)+'</span>';
            }
        }
        return '<span style="color:'+(faded?'rgba(200,200,200,0.5)':'#e2e8f0')+';font-weight:800;">'+val+'</span>';
    }
    function _showCellInlineEdit(cell, curVal, callback){
        var rect=cell.getBoundingClientRect();
        var overlay=document.createElement('div');
        overlay.style.cssText='position:fixed;inset:0;z-index:99999;';
        var top=rect.bottom+4; if(top+80>window.innerHeight) top=rect.top-88;
        var left=Math.max(rect.left,4);
        var box=document.createElement('div');
        box.style.cssText='position:absolute;top:'+top+'px;left:'+left+'px;'+
            'background:#1e293b;border:2px solid #3abff8;border-radius:9px;'+
            'padding:8px 10px;display:flex;flex-direction:column;gap:6px;'+
            'box-shadow:0 4px 24px rgba(0,0,0,0.6);min-width:140px;z-index:100000;';
        var inp=document.createElement('input');
        inp.value=curVal; inp.placeholder='교육1차, 예비군...';
        inp.style.cssText='background:#0f172a;border:1.5px solid #334155;border-radius:6px;'+
            'color:#e2e8f0;font-size:12px;font-weight:700;padding:5px 9px;outline:none;'+
            'width:100%;box-sizing:border-box;';
        var btnRow=document.createElement('div');
        btnRow.style.cssText='display:flex;gap:6px;';
        var btnOk=document.createElement('button');
        btnOk.textContent='완료';
        btnOk.style.cssText='flex:1;background:#3abff8;color:#0f172a;border:none;border-radius:6px;'+
            'padding:5px 0;font-size:11px;font-weight:900;cursor:pointer;';
        var btnDel=document.createElement('button');
        btnDel.textContent='삭제';
        btnDel.style.cssText='flex:1;background:rgba(239,68,68,0.15);color:#ef4444;'+
            'border:1px solid #ef4444;border-radius:6px;padding:5px 0;font-size:11px;font-weight:900;cursor:pointer;';
        function doOk(){ document.body.removeChild(overlay); callback(inp.value.trim()); }
        function doDel(){ document.body.removeChild(overlay); callback(''); }
        function doCancel(){ document.body.removeChild(overlay); callback(null); }
        btnOk.onclick=doOk; btnDel.onclick=doDel;
        overlay.onclick=function(e){ if(e.target===overlay) doCancel(); };
        inp.onkeydown=function(e){ if(e.key==='Enter') doOk(); if(e.key==='Escape') doCancel(); };
        btnRow.appendChild(btnOk); btnRow.appendChild(btnDel);
        box.appendChild(inp); box.appendChild(btnRow);
        overlay.appendChild(box); document.body.appendChild(overlay);
        setTimeout(function(){ inp.focus(); inp.select(); },30);
    }
    function _schedDualTxt(parts, faded){
        var c0 = faded ? _schedValColorFaded(parts[0]) : _schedValColor(parts[0]);
        var c1 = faded ? _schedValColorFaded(parts[1]) : _schedValColor(parts[1]);
        return '<span style="font-size:9px;">'+
               '<span style="color:'+c0+';font-weight:900;">'+parts[0]+'</span>'+
               '<span style="color:rgba(150,150,150,0.6);font-weight:400;"> / </span>'+
               '<span style="color:'+c1+';font-weight:900;">'+parts[1]+'</span>'+
               '</span>';
    }

    function _schedApplyCell(gIdx, staffId, day){
        var key = _schedCellKey(gIdx, staffId, day);
        if(_schedDragging && _schedDragSeen[key]) return; /* 드래그 중 이미 적용한 셀 스킵 */
        _schedDragSeen[key] = true;
        var path = _schedFbRoot()+_schedYear+'/'+_schedMonth+'/cells/'+key;
        var cur = _schedCells[key] || '';
        var parts = cur ? cur.split('|').filter(Boolean) : [];
        var idx = parts.indexOf(_schedStamp);
        var newVal;
        if(_schedCtrlMode){
            /* Ctrl 누름: 기존 값 유지하고 추가 */
            if(idx !== -1 && !_schedDragging){
                parts.splice(idx, 1);
                newVal = parts.join('|');
            } else if(idx !== -1){
                newVal = cur;
            } else if(parts.length >= 2){
                parts[1] = _schedStamp;
                newVal = parts.join('|');
            } else {
                parts.push(_schedStamp);
                newVal = parts.join('|');
            }
        } else {
            /* 일반 클릭: 기존 값 교체 */
            if(idx !== -1 && !_schedDragging){
                /* 같은 값 재클릭 → 토글 제거 */
                newVal = '';
            } else {
                newVal = _schedStamp;
            }
        }
        if(newVal){
            _schedCells[key] = newVal;
            db.ref(path).set(newVal);
        } else {
            delete _schedCells[key];
            db.ref(path).remove();
        }
        var cell = document.getElementById('scell_'+key);
        if(cell) _applySchedCellStyle(cell, newVal, day);
    }
    function _applySchedCellStyle(cell, val, day){
        var dow = new Date(_schedYear, _schedMonth-1, day).getDay();
        var isSunC=dow===0,isSatC=dow===6;
        var isHolC=!isSunC&&!isSatC&&_isKrHoliday(_schedYear,_schedMonth,day);
        var isRedC=isSunC||isHolC;
        var key = cell.id.replace('scell_','');
        var parts = key.split('_');
        var gKey = SCHED_GROUPS[parseInt(parts[0])].key;
        var cc = (_schedColors[gKey]||{})[parseInt(parts[1])]||'';
        var baseBg = cc ? _colRgba(cc, 0.06) : (isRedC?'rgba(239,68,68,0.13)':(isSatC?'rgba(96,165,250,0.13)':''));
        var vspan = document.getElementById('sval_'+key);
        var valParts = val ? val.split('|').filter(Boolean) : [];
        if(!val){
            if(vspan) vspan.innerHTML='';
            cell.style.background=baseBg; cell.style.color=''; cell.style.fontWeight='';
        } else if(valParts.length >= 2){
            if(vspan) vspan.innerHTML=_schedDualTxt(valParts, false);
            cell.style.background=baseBg; cell.style.color=''; cell.style.fontWeight='';
        } else if(val==='휴무'){
            if(vspan) vspan.innerHTML='휴무';
            cell.style.background=baseBg; cell.style.color='#ef4444'; cell.style.fontWeight='900';
        } else if(val==='12시'){
            if(vspan) vspan.innerHTML='12시';
            cell.style.background=baseBg; cell.style.color='#d946ef'; cell.style.fontWeight='900';
        } else if(val==='17시'){
            if(vspan) vspan.innerHTML='17시';
            cell.style.background=baseBg; cell.style.color='#22c55e'; cell.style.fontWeight='900';
        } else if(val==='연차'){
            if(vspan) vspan.innerHTML='연차';
            cell.style.background=baseBg; cell.style.color='#8b5cf6'; cell.style.fontWeight='900';
        } else if(val==='반차'){
            if(vspan) vspan.innerHTML='반차';
            cell.style.background=baseBg; cell.style.color='#f97316'; cell.style.fontWeight='900';
        } else if(val==='안식'){
            if(vspan) vspan.innerHTML='안식';
            cell.style.background=baseBg; cell.style.color='#14b8a6'; cell.style.fontWeight='900';
        } else if(val==='교육'){
            if(vspan) vspan.innerHTML='교육';
            cell.style.background=baseBg; cell.style.color='#2563eb'; cell.style.fontWeight='900';
        } else if(val==='출장'){
            if(vspan) vspan.innerHTML='출장';
            cell.style.background=baseBg; cell.style.color='#0ea5e9'; cell.style.fontWeight='900';
        } else if(val==='육아'){
            if(vspan) vspan.innerHTML='육아';
            cell.style.background=baseBg; cell.style.color='#ec4899'; cell.style.fontWeight='900';
        } else if(val==='제외'){
            if(vspan) vspan.innerHTML='<span style="font-size:15px;font-weight:900;opacity:0.55;">✕</span>';
            cell.style.background='rgba(107,114,128,0.08)'; cell.style.color='#6b7280'; cell.style.fontWeight='900';
        } else if(val==='9시'){
            if(vspan) vspan.innerHTML='9시';
            cell.style.background=baseBg; cell.style.color='#eab308'; cell.style.fontWeight='900';
        } else if(val==='15시'){
            if(vspan) vspan.innerHTML='15시';
            cell.style.background=baseBg; cell.style.color='#06b6d4'; cell.style.fontWeight='900';
        } else {
            if(vspan) vspan.innerHTML=_schedPrefixTxt(val, false);
            cell.style.background=baseBg; cell.style.color=''; cell.style.fontWeight='';
        }
    }
    function _schedSaveName(gKey, staffId, val){
        if(!_schedNames[gKey]) _schedNames[gKey]={};
        _schedNames[gKey][staffId] = val;
        db.ref(_staffMonthPath()+'/'+gKey+'/'+staffId).set(val||'');
    }
    function toggleSchedStaffHide(gKey, staffId){
        var k = gKey + '_' + staffId;
        if(_schedHiddenStaff[k]){ delete _schedHiddenStaff[k]; }
        else { _schedHiddenStaff[k] = true; }
        localStorage.setItem('imi_sched_hidden', JSON.stringify(_schedHiddenStaff));
        _renderGroupBtns();
        _renderScheduleTable();
    }
    function clearSchedHidden(){
        _schedHiddenStaff = {};
        localStorage.setItem('imi_sched_hidden', '{}');
        _renderGroupBtns();
        _renderScheduleTable();
    }
    function clearSchedStaff(gIdx, staffId){
        if(!confirm('해당 직원의 이번 달 스케줄을 모두 비우시겠습니까?\n(입력된 휴무, 연차, 당직 등의 기록이 모두 삭제됩니다)')) return;
        var keysToDelete = [];
        var days = new Date(_schedYear, _schedMonth, 0).getDate();
        for(var d=1; d<=days; d++){
            var k = _schedCellKey(gIdx, staffId, d);
            if(_schedCells[k] || _schedMemos[k]) keysToDelete.push(k);
        }
        if(!keysToDelete.length){ alert('비울 스케줄이 없습니다.'); return; }
        var upd = {};
        keysToDelete.forEach(function(k){
            upd[_schedFbRoot()+_schedYear+'/'+_schedMonth+'/cells/'+k] = null;
            upd[_schedFbRoot()+_schedYear+'/'+_schedMonth+'/memos/'+k] = null;
            delete _schedCells[k];
            delete _schedMemos[k];
        });
        db.ref().update(upd, function(err){
            if(!err) _renderScheduleTable();
        });
    }
    /* ── 공휴일 관리 ── */
    function openHolidayMgr(e){
        e.stopPropagation();
        var pop=document.getElementById('schedHolidayMgr'); if(!pop) return;
        var r=e.target.getBoundingClientRect();
        document.getElementById('holidayMgrTitle').textContent=_schedYear+'년 '+_schedMonth+'월';
        _renderHolidayMgrBody();
        pop.style.display='block';
        var container=document.querySelector('#scheduleModal > div');
        var cr=container?container.getBoundingClientRect():{top:0,left:0,width:window.innerWidth,height:window.innerHeight};
        var popW=pop.offsetWidth||250;
        var margin=8;
        var topPos=r.bottom-cr.top+6;
        var leftPos=r.right-popW-cr.left;
        leftPos=Math.max(margin, Math.min(leftPos, cr.width-popW-margin));
        topPos=Math.max(margin, Math.min(topPos, cr.height-pop.offsetHeight-margin));
        pop.style.top=topPos+'px';
        pop.style.left=leftPos+'px';
        pop.style.right='auto';
        setTimeout(function(){document.addEventListener('click',_holidayMgrOutside,{once:true});},10);
    }
    function _holidayMgrOutside(e){
        var pop=document.getElementById('schedHolidayMgr');
        if(pop&&!pop.contains(e.target)) pop.style.display='none';
    }
    function closeHolidayMgr(){
        var pop=document.getElementById('schedHolidayMgr'); if(pop) pop.style.display='none';
    }
    function _renderHolidayMgrBody(){
        var body=document.getElementById('holidayMgrBody'); if(!body) return;
        var m=_schedMonth;
        var fixed=(KR_HOLIDAYS[_schedYear]||{})[m]||[];
        var custom=_schedCustomHolidays[m]||[];
        var html='';
        if(fixed.length===0&&custom.length===0){
            html='<div style="font-size:10px;opacity:0.4;padding:4px 0;">이 달 공휴일 없음</div>';
        } else {
            var allDays=fixed.slice().concat(custom).filter(function(d,i,a){return a.indexOf(d)===i;}).sort(function(a,b){return a-b;});
            allDays.forEach(function(d){
                var isCustom=custom.indexOf(d)>=0;
                html+='<div style="display:flex;align-items:center;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border-ui);font-size:11px;">';
                html+='<span><b>'+m+'/'+d+'</b> <span style="font-size:9px;opacity:0.5;">'+(isCustom?'커스텀':'기본')+'</span></span>';
                if(isCustom){
                    html+='<button onclick="deleteCustomHoliday('+d+')" style="padding:1px 6px;border-radius:4px;border:1px solid #ef4444;color:#ef4444;background:none;font-size:9px;cursor:pointer;">삭제</button>';
                } else {
                    html+='<span style="font-size:9px;opacity:0.3;">고정</span>';
                }
                html+='</div>';
            });
        }
        body.innerHTML=html;
    }
    function addCustomHoliday(){
        var inp=document.getElementById('holidayMgrInput'); if(!inp) return;
        var d=parseInt(inp.value);
        if(isNaN(d)||d<1||d>31){alert('1~31 사이 날짜를 입력하세요.');return;}
        var m=_schedMonth;
        if(!_schedCustomHolidays[m]) _schedCustomHolidays[m]=[];
        if(_schedCustomHolidays[m].indexOf(d)>=0){alert('이미 등록된 날짜입니다.');return;}
        _schedCustomHolidays[m].push(d);
        _schedCustomHolidays[m].sort(function(a,b){return a-b;});
        db.ref('work_schedule/custom_holidays/'+_schedYear+'/'+m).set(_schedCustomHolidays[m]);
        inp.value='';
        _renderHolidayMgrBody();
        _renderScheduleTable();
    }
    function deleteCustomHoliday(d){
        var m=_schedMonth;
        if(!_schedCustomHolidays[m]) return;
        _schedCustomHolidays[m]=_schedCustomHolidays[m].filter(function(x){return x!==d;});
        if(_schedCustomHolidays[m].length===0){
            db.ref('work_schedule/custom_holidays/'+_schedYear+'/'+m).remove();
            delete _schedCustomHolidays[m];
        } else {
            db.ref('work_schedule/custom_holidays/'+_schedYear+'/'+m).set(_schedCustomHolidays[m]);
        }
        _renderHolidayMgrBody();
        _renderScheduleTable();
    }
    function addSchedStaff(gIdx){
        var g = SCHED_GROUPS[gIdx];
        if(!_schedNames[g.key]) _schedNames[g.key]={};
        var ids = Object.keys(_schedNames[g.key]).map(Number);
        var nextId = ids.length>0 ? Math.max.apply(null,ids)+1 : 0;
        _schedNames[g.key][nextId]='';
        db.ref(_staffMonthPath()+'/'+g.key+'/'+nextId).set('');
        _renderScheduleTable();
    }
    function removeSchedStaff(gIdx, staffId){
        var g = SCHED_GROUPS[gIdx];
        if(!_schedNames[g.key]) return;
        delete _schedNames[g.key][staffId];
        var keysToDelete=[];
        Object.keys(_schedCells).forEach(function(k){
            var p=k.split('_');
            if(parseInt(p[0])===gIdx && parseInt(p[1])===staffId) keysToDelete.push(k);
        });
        keysToDelete.forEach(function(k){ delete _schedCells[k]; });
        db.ref(_staffMonthPath()+'/'+g.key+'/'+staffId).remove();
        if(keysToDelete.length){
            var upd={};
            keysToDelete.forEach(function(k){
                upd[_schedFbRoot()+_schedYear+'/'+_schedMonth+'/cells/'+k]=null;
                upd[_schedFbRoot()+_schedYear+'/'+_schedMonth+'/memos/'+k]=null;
                delete _schedMemos[k];
            });
            db.ref().update(upd);
        }
        _renderScheduleTable();
    }
    function openCellMemo(key, evt){
        evt.stopPropagation();
        _schedMemoActiveKey = key;
        var popup = document.getElementById('schedMemoPopup');
        if(!popup) return;
        document.getElementById('schedMemoInput').value = _schedMemos[key] || '';
        var x = Math.min(evt.clientX+6, window.innerWidth-225);
        var y = Math.min(evt.clientY+6, window.innerHeight-165);
        popup.style.left=x+'px'; popup.style.top=y+'px'; popup.style.display='block';
        setTimeout(function(){ var inp=document.getElementById('schedMemoInput'); if(inp) inp.focus(); },50);
    }
    function closeMemoPopup(){
        var p=document.getElementById('schedMemoPopup'); if(p) p.style.display='none';
        _schedMemoActiveKey=null;
    }
    function saveCellMemoFromPopup(){
        var key=_schedMemoActiveKey; if(!key){ closeMemoPopup(); return; }
        var val=document.getElementById('schedMemoInput').value.trim();
        var path=_schedFbRoot()+_schedYear+'/'+_schedMonth+'/memos/'+key;
        if(val){ _schedMemos[key]=val; db.ref(path).set(val); }
        else { delete _schedMemos[key]; db.ref(path).remove(); }
        _updateMemoIndicator(key, val);
        /* cell title 업데이트 */
        var cell=document.getElementById('scell_'+key);
        if(cell){ if(val) cell.setAttribute('title',val); else cell.removeAttribute('title'); }
        closeMemoPopup();
    }
    function deleteCellMemoFromPopup(){
        var key=_schedMemoActiveKey; if(!key){ closeMemoPopup(); return; }
        delete _schedMemos[key];
        db.ref(_schedFbRoot()+_schedYear+'/'+_schedMonth+'/memos/'+key).remove();
        _updateMemoIndicator(key,'');
        var cell=document.getElementById('scell_'+key); if(cell) cell.removeAttribute('title');
        closeMemoPopup();
    }
    function _updateMemoIndicator(key, memoText){
        var dot=document.getElementById('smemo_'+key); if(!dot) return;
        if(memoText){ dot.style.borderTopColor='#ef4444'; dot.title=memoText; }
        else { dot.style.borderTopColor='rgba(130,130,130,0.13)'; dot.title='메모 추가'; }
    }
    function _schedDragEnd(){ _schedDragging=false; _schedSelecting=false; _schedDragSeen={}; _schedRowSelecting=false; }
    function _schedSaveCell(key, newVal){
        var oldVal = _schedCells[key] || '';
        if(oldVal === newVal) return;
        var d = parseInt(key.split('_')[2]);
        var path = _schedFbRoot()+_schedYear+'/'+_schedMonth+'/cells/'+key;
        if(newVal){ _schedCells[key]=newVal; db.ref(path).set(newVal); }
        else { delete _schedCells[key]; db.ref(path).remove(); }
        var cell = document.getElementById('scell_'+key);
        if(cell) _applySchedCellStyle(cell, newVal, d);
        _schedUndoStack.push({key:key, oldVal:oldVal, newVal:newVal});
        if(_schedUndoStack.length>50) _schedUndoStack.shift();
    }
    function _schedUndo(){
        if(!_schedUndoStack.length) return;
        var entry = _schedUndoStack.pop();
        var d = parseInt(entry.key.split('_')[2]);
        var path = _schedFbRoot()+_schedYear+'/'+_schedMonth+'/cells/'+entry.key;
        if(entry.oldVal){ _schedCells[entry.key]=entry.oldVal; db.ref(path).set(entry.oldVal); }
        else { delete _schedCells[entry.key]; db.ref(path).remove(); }
        var cell = document.getElementById('scell_'+entry.key);
        if(cell) _applySchedCellStyle(cell, entry.oldVal, d);
    }
    function _schedDragStart(gIdx, staffId, day){
        _schedDragSeen={};
        _schedApplyCell(gIdx, staffId, day); /* 첫 클릭: _schedDragging=false → 토글 허용 */
        _schedDragging=true; /* 이후 mousemove는 드래그 모드 */
    }
    function _schedDragEnter(gIdx, staffId, day){
        if(!_schedDragging || !_schedStamp) return;
        _schedApplyCell(gIdx, staffId, day);
    }
    function _colRgba(hex, a){
        var r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
        return 'rgba('+r+','+g+','+b+','+a+')';
    }
    function _closeColorPickerOutside(e){
        var p=document.getElementById('schedColorPicker');
        if(p && !p.contains(e.target)) closeColorPicker();
    }
    function openStaffColorPicker(gIdx, staffId, evt){
        evt.stopPropagation();
        _schedColorPickerTarget = {gIdx:gIdx, staffId:staffId};
        var g = SCHED_GROUPS[gIdx];
        var cur = (_schedColors[g.key]||{})[staffId]||'';
        var sw = document.getElementById('schedColorSwatches');
        var h='';
        _SCHED_COL_PALETTE.forEach(function(c){
            var ring=c===cur?'box-shadow:0 0 0 2px #fff,0 0 0 3.5px '+c+';':'';
            h+='<div onclick="setStaffColor(\''+c+'\')" title="'+c+'" style="width:18px;height:18px;border-radius:3px;background:'+c+';cursor:pointer;'+ring+'transition:transform 0.1s;" onmouseover="this.style.transform=\'scale(1.2)\'" onmouseout="this.style.transform=\'scale(1)\'"></div>';
        });
        sw.innerHTML=h;
        var picker=document.getElementById('schedColorPicker');
        var x=Math.min(evt.clientX, window.innerWidth-175);
        var y=Math.min(evt.clientY+8, window.innerHeight-115);
        picker.style.left=x+'px'; picker.style.top=y+'px'; picker.style.display='block';
        setTimeout(function(){ document.addEventListener('click', _closeColorPickerOutside); },0);
    }
    function closeColorPicker(){
        document.removeEventListener('click', _closeColorPickerOutside);
        var p=document.getElementById('schedColorPicker'); if(p) p.style.display='none';
        _schedColorPickerTarget=null;
    }
    function setStaffColor(color){
        if(!_schedColorPickerTarget) return;
        var gIdx=_schedColorPickerTarget.gIdx, staffId=_schedColorPickerTarget.staffId;
        var gKey=SCHED_GROUPS[gIdx].key;
        if(!_schedColors[gKey]) _schedColors[gKey]={};
        if(color){ _schedColors[gKey][staffId]=color; }
        else { delete _schedColors[gKey][staffId]; }
        try{ localStorage.setItem('imi_sched_colors', JSON.stringify(_schedColors)); }catch(e){}
        closeColorPicker();
        _renderScheduleTable();
    }
    function _renderScheduleTable(){
        _buildSchedColMap();
        _schedSelStartCol=null; _schedSelStartDay=null;
        _schedSelEndCol=null; _schedSelEndDay=null; _schedSelecting=false;
        var wrap = document.getElementById('scheduleTableWrap');
        var days = new Date(_schedYear, _schedMonth, 0).getDate();
        var DN = ['일','월','화','수','목','금','토'];
        var cs = 'border:1px solid var(--border-ui);overflow:hidden;';
        var active=_getActiveGroups();
        var _activeDispGroups=SCHED_DISPLAY_ORDER.filter(function(gi){return active.indexOf(SCHED_GROUPS[gi].key)>=0;}).map(function(gi){return{g:SCHED_GROUPS[gi],gIdx:gi};});
        var gStaff=_activeDispGroups.map(function(item){
            var obj=_schedNames[item.g.key]||{};
            return Object.keys(obj).map(Number).sort(function(a,b){return a-b;})
                .filter(function(sid){ return !_schedHiddenStaff[item.g.key+'_'+sid]; });
        });

        /* ── 컬럼 폭: 퍼센트 기반, 스크롤 없이 꽉 맞춤 ── */
        var totalStaffCols = gStaff.reduce(function(acc,ids){ return acc+Math.max(1,ids.length); },0);
        var availW = window.innerWidth - 14 - 26; /* 모달 margin + padding 양측 */
        var dateFixPx = Math.max(40, Math.min(56, Math.round(availW * 0.046)));
        var staffPxEach = totalStaffCols > 0
            ? Math.max(24, Math.floor((availW - dateFixPx) / totalStaffCols))
            : 60;
        var DWpct = (dateFixPx / availW * 100).toFixed(2)+'%';
        var SWpct = (staffPxEach / availW * 100).toFixed(2)+'%';

        var targetDays = [];
        if (window._schedViewMode === 'week') {
            targetDays = _getWeekRanges(_schedYear, _schedMonth)[_schedWeekIndex];
        } else {
            for(var i=1; i<=days; i++) targetDays.push({y:_schedYear, m:_schedMonth, d:i, isCur:true});
        }

        /* ── 행 높이: wrap의 실제 DOM 높이에서 역산 ── */
        var nameH = 24;          /* 이름 입력행 고정 24px */
        var theadH = 28 + nameH + 6; /* 그룹헤더(28) + 이름행(24) + 경계선여유(6) = 58 */
        var wrapH = (wrap && wrap.clientHeight > 80) ? wrap.clientHeight : Math.max(300, window.innerHeight - 145);
        /* border-collapse: 행당 ~1px 경계선 누적(days+6 px) 포함해 역산, 상한 없음 */
        var rowH = Math.max(9, Math.floor((wrapH - theadH - targetDays.length - 10) / (targetDays.length + 3)));
        var footH = rowH * 3.5; // 통계 및 수정버튼 합산 공간
        /* 안전 검증: 초과 시 rowH 감소 */
        while(theadH + rowH * targetDays.length + footH + targetDays.length + 6 > wrapH && rowH > 8){
            rowH--;
            footH = rowH * 3.5;
        }
        if(window._schedViewMode === 'week') {
            rowH = Math.min(rowH, 90);
        }

        /* ── 폰트 적응 ── */
        var cFont = rowH < 12 ? '8px' : (rowH < 16 ? '9px' : (rowH < 22 ? '10px' : (rowH < 35 ? '11px' : '13px')));
        if(window._schedViewMode === 'week') cFont = rowH < 25 ? '12px' : (rowH < 40 ? '14px' : '17px');
        var dFont = rowH < 14 ? '7px' : (rowH < 35 ? '9px' : '12px');
        if(window._schedViewMode === 'week') dFont = rowH < 30 ? '12px' : '15px';
        var swPx = staffPxEach;
        var inpFont = swPx < 36 ? '10px' : '12px';
        var btnPad = swPx < 44 ? '1px 3px' : '1px 6px';
        var btnFont = swPx < 44 ? '8px' : '9.5px';

        /* ── 오늘 날짜 ── */
        var _today=new Date(); var _todayD=0;
        if(_today.getFullYear()===_schedYear&&_today.getMonth()+1===_schedMonth) _todayD=_today.getDate();

        var html='<table style="border-collapse:collapse;table-layout:fixed;width:100%;font-size:'+cFont+';font-weight:700;">';

        /* 헤더 1행: 날짜(rowspan=2) + 그룹 레이블 */
        html+='<thead><tr>';
        html+='<th rowspan="2" style="'+cs+'width:'+DWpct+';text-align:center;font-size:'+dFont+';font-weight:900;background:var(--bg-body);vertical-align:middle;height:28px;white-space:nowrap;padding:1px 0;">날짜</th>';
        _activeDispGroups.forEach(function(item,di){
            var g=item.g; var gIdx=item.gIdx;
            var ids=gStaff[di];
            var span=Math.max(1,ids.length);
            var lb=di>0?'border-left:4px solid '+_colRgba(_GCOL[gIdx],0.65)+';':'';
            var gc=_GCOL[gIdx];
            html+='<th colspan="'+span+'" style="'+cs+lb+'text-align:center;font-size:10.5px;font-weight:900;color:'+gc+';background:var(--bg-body);padding:1px 3px;height:28px;vertical-align:middle;white-space:nowrap;">';
            html+='<div style="display:flex;align-items:center;justify-content:center;gap:5px;">';
            html+='<span>'+g.label+'</span>';
            if(window._schedViewMode === 'month') {
                html+='<button onclick="addSchedStaff('+gIdx+')" style="padding:2px 5px;border-radius:4px;border:1px solid '+gc+';background:var(--bg-card);color:'+gc+';font-size:8px;font-weight:900;cursor:pointer;" title="이 시간대에 직원 추가">+추가</button>';
            }
            html+='</div>';
            html+='</th>';
        });
        html+='</tr>';

        /* 헤더 2행: 이름 입력 */
        html+='<tr>';
        _activeDispGroups.forEach(function(item,di){
            var g=item.g; var gIdx=item.gIdx;
            var ids=gStaff[di];
            var lb=di>0?'border-left:4px solid '+_colRgba(_GCOL[gIdx],0.65)+';':'';
            if(ids.length===0){
                if(_schedEditMode){
                    var egc=_GCOL[gIdx]||'#888';
                    html+='<td style="'+cs+lb+'width:'+SWpct+';text-align:center;background:var(--bg-body);height:'+nameH+'px;vertical-align:middle;">';
                    html+='<button onclick="addSchedStaff('+gIdx+')" style="padding:2px 6px;border-radius:4px;border:1.5px solid '+egc+';background:transparent;color:'+egc+';font-size:8px;font-weight:900;cursor:pointer;white-space:nowrap;">+추가</button>';
                    html+='</td>';
                } else {
                    html+='<td style="'+cs+lb+'width:'+SWpct+';text-align:center;font-size:7.5px;opacity:0.3;background:var(--bg-body);height:'+nameH+'px;vertical-align:middle;">없음</td>';
                }
            } else {
                ids.forEach(function(staffId,ci){
                    var lb2=ci===0?lb:'';
                    var name=((_schedNames[g.key]||{})[staffId])||'';
                    var cc=(_schedColors[g.key]||{})[staffId]||'';
                    var tdBg=cc?_colRgba(cc,0.15):'var(--bg-card)';
                    var tdTopBdr=cc?'border-top:2.5px solid '+cc+';':'';
                    var mouseEvt = ' onmouseover="var b=this.querySelector(\'.hide-btn\');if(b)b.style.display=\'block\'" onmouseout="var b=this.querySelector(\'.hide-btn\');if(b)b.style.display=\'none\'"';
                    var tdEvt = window._schedViewMode === 'month' ? ' onclick="var i=this.querySelector(\'input\');if(i&&document.activeElement!==i)i.focus()"' : '';
                    var isReadonly = window._schedViewMode === 'week' ? 'readonly' : '';
                    html+='<td' + tdEvt + ' style="'+cs+lb2+tdTopBdr+'width:'+SWpct+';padding:1px 1px;background:'+tdBg+';height:'+nameH+'px;vertical-align:middle;' + (window._schedViewMode === 'month' ? 'cursor:text;' : 'cursor:default;') + '" title="'+(window._schedViewMode==='month'?'클릭하여 이름 수정':'')+'">';
                    html+='<div style="display:flex;align-items:center;width:100%;height:100%;position:relative;overflow:hidden;"'+mouseEvt+'>';
                    if(window._schedViewMode === 'month') {
                        html+='<button onclick="event.stopPropagation();openStaffColorPicker('+gIdx+','+staffId+',event)" style="flex-shrink:0;width:12px;height:12px;border-radius:3px;border:1.5px solid '+(cc?cc:'rgba(140,140,140,0.5)')+';background:'+(cc||'rgba(140,140,140,0.18)')+';cursor:pointer;padding:0;margin-right:2px;" title="열 색상 변경"></button>';
                    }
                    html+='<input type="text" value="'+name.replace(/"/g,'&quot;').replace(/'/g,'&#39;')+'" onblur="_schedSaveName(\''+g.key+'\','+staffId+',this.value)" placeholder="이름" style="flex:1;min-width:0;width:0;height:20px;border:none;background:transparent;color:var(--text-main);font-size:'+inpFont+';font-weight:700;text-align:center;outline:none;padding:0;' + (window._schedViewMode==='month'?'cursor:text;':'cursor:default;') + '" ' + isReadonly + ' />';
                    if(window._schedViewMode === 'month') {
                        html+='<button class="hide-btn" onclick="event.stopPropagation();toggleSchedStaffHide(\''+g.key+'\','+staffId+')" title="이 직원 숨기기" style="position:absolute;right:1px;top:50%;transform:translateY(-50%);display:none;border:none;background:rgba(0,0,0,0.55);color:#fff;border-radius:4px;font-size:9px;padding:2px 5px;cursor:pointer;font-weight:900;">숨김</button>';
                    }
                    html+='</div></td>';
                });
            }
        });
        html+='</tr></thead>';

        /* 바디: 날짜 행 (세로) */
        html+='<tbody>';
        for(var di=0; di<targetDays.length; di++){
            var tDay = targetDays[di];
            var d = tDay.d;
            var y = tDay.y;
            var m = tDay.m;
            var isCur = tDay.isCur;

            var dow=new Date(y,m-1,d).getDay();
            var isSun=dow===0,isSat=dow===6,isToday=(y===_today.getFullYear() && m===(_today.getMonth()+1) && d===_todayD);
            var isHol=!isSun&&!isSat&&_isKrHoliday(y,m,d);
            var isRed=isSun||isHol;
            var dc=isToday?'#166534':(isRed?'#b91c1c':(isSat?'#1d4ed8':'var(--text-main)'));
            if(!isCur) dc = 'rgba(140,140,140,0.5)';

            var dbg=isToday?'rgba(34,197,94,0.55)':(isRed?'rgba(239,68,68,0.25)':(isSat?'rgba(96,165,250,0.25)':'var(--bg-body)'));
            if(!isCur) dbg = 'rgba(0,0,0,0.03)';

            var leftF = Math.max(10, Math.min(14, rowH - 2));
            var rightF = Math.max(9, Math.min(12, rowH - 4));
            if(window._schedViewMode === 'week') {
                leftF = Math.max(12, Math.min(18, rowH - 6));
                rightF = Math.max(11, Math.min(15, rowH - 8));
            }
            var dateStr = isCur ? d : (m + '/' + d);
            var dateInner = '<div style="display:flex; width:100%; height:100%;opacity:'+(isCur?1:0.7)+';">' +
                            '<div style="flex:1.2; display:flex; align-items:center; justify-content:center; font-size:'+(isCur?leftF:(leftF-2))+'px; font-weight:900;">' + dateStr + '</div>' +
                            '<div style="flex:0.8; display:flex; align-items:center; justify-content:center; font-size:'+rightF+'px; font-weight:800; opacity:0.6; border-left:1px solid rgba(128,128,128,0.2);">' + DN[dow] + '</div>' +
                            '</div>';

            html+='<tr id="srow_'+d+'">';
            if(isCur) {
                html+='<td class="sched-date-cell" onmousedown="event.preventDefault(); schedRowSelBegin(event, '+d+')" onmouseover="schedRowSelOver(event, '+d+')" title="클릭하여 이 행을 강조 (드래그로 다중 선택, Shift+클릭으로 개별 선택)" style="'+cs+'width:'+DWpct+';height:'+rowH+'px;text-align:center;padding:0;background:'+dbg+';color:'+dc+';vertical-align:middle;white-space:nowrap;'+(isToday?'border-left:4px solid #22c55e;box-shadow:inset 2px 0 8px rgba(34,197,94,0.18);':'')+(isRed&&!isToday?'border-left:3px solid rgba(239,68,68,0.5);':'')+(isSat&&!isToday?'border-left:3px solid rgba(96,165,250,0.5);':'')+'">'+(isToday?'<b style="display:block;height:100%;">'+dateInner+'</b>':dateInner)+'</td>';
            } else {
                html+='<td style="'+cs+'width:'+DWpct+';height:'+rowH+'px;text-align:center;padding:0;background:'+dbg+';color:'+dc+';vertical-align:middle;white-space:nowrap;">'+dateInner+'</td>';
            }

            _activeDispGroups.forEach(function(item,di){
                var g=item.g; var gIdx=item.gIdx;
                var ids=gStaff[di];
                var lb=di>0?'border-left:4px solid '+_colRgba(_GCOL[gIdx],0.65)+';':'';
                if(ids.length===0){
                    html+='<td style="'+cs+lb+'width:'+SWpct+';height:'+rowH+'px;background:'+(isCur?'var(--bg-body)':'rgba(0,0,0,0.02)')+';"></td>';
                } else {
                    ids.forEach(function(staffId,ci){
                        var lb2=ci===0?lb:'';
                        var key=_schedCellKey(gIdx,staffId,d);
                        var val = '';
                        var memo = '';
                        if (isCur) {
                            val = _schedCells[key] || '';
                            memo = _schedMemos[key] || '';
                        } else if (y < _schedYear || (y === _schedYear && m < _schedMonth)) {
                            val = _prevSchedCells[key] || '';
                            memo = _prevSchedMemos[key] || '';
                        } else {
                            val = _nextSchedCells[key] || '';
                            memo = _nextSchedMemos[key] || '';
                        }

                        var bg='',color='',fw='',txt='';
                        var cc3=(_schedColors[g.key]||{})[staffId]||'';
                        bg=cc3?_colRgba(cc3,isToday?0.16:(isRed||isSat?0.10:0.06)):(isToday?'rgba(34,197,94,0.15)':(isRed?'rgba(239,68,68,0.13)':(isSat?'rgba(96,165,250,0.13)':'')));
                        if(!isCur) bg = 'rgba(0,0,0,0.02)';

                        var _vp = val ? val.split('|').filter(Boolean) : [];
                        if(_vp.length >= 2){
                            txt=_schedDualTxt(_vp, !isCur);
                            color=''; fw='';
                        } else if(val==='휴무'){color=isCur?'#ef4444':'rgba(239,68,68,0.5)';fw='900';txt='휴무';}
                        else if(val==='12시'){color=isCur?'#d946ef':'rgba(217,70,239,0.5)';fw='900';txt='12시';}
                        else if(val==='17시'){color=isCur?'#22c55e':'rgba(34,197,94,0.5)';fw='900';txt='17시';}
                        else if(val==='연차'){color=isCur?'#8b5cf6':'rgba(139,92,246,0.5)';fw='900';txt='연차';}
                        else if(val==='반차'){color=isCur?'#f97316':'rgba(249,115,22,0.5)';fw='900';txt='반차';}
                        else if(val==='안식'){color=isCur?'#14b8a6':'rgba(20,184,166,0.5)';fw='900';txt='안식';}
                        else if(val==='9시'){color=isCur?'#eab308':'rgba(234,179,8,0.5)';fw='900';txt='9시';}
                        else if(val==='15시'){color=isCur?'#06b6d4':'rgba(6,182,212,0.5)';fw='900';txt='15시';}
                        else if(val==='교육'){color=isCur?'#2563eb':'rgba(37,99,235,0.5)';fw='900';txt='교육';}
                        else if(val==='출장'){color=isCur?'#0ea5e9':'rgba(14,165,233,0.5)';fw='900';txt='출장';}
                        else if(val==='육아'){color=isCur?'#ec4899':'rgba(236,72,153,0.5)';fw='900';txt='육아';}
                        else if(val==='제외'){color=isCur?'#6b7280':'rgba(107,114,128,0.4)';fw='900';txt='<span style="font-size:15px;opacity:0.55;">✕</span>';}
                        else if(val){ color=''; fw=''; txt=_schedPrefixTxt(val,!isCur); }

                        var foldColor=memo?'#ef4444':'rgba(130,130,130,0.13)';
                        if (!isCur && memo) foldColor = 'rgba(239,68,68,0.4)';

                        var cellTitleAttr=memo?' title="'+memo.replace(/"/g,'&quot;')+'"':'';
                        var cellEv='';
                        var cellIdStr='';
                        var memoClick='';
                        var cellCursor='cursor:default;';
                        var memoSpan='';

                        if(isCur) {
                            cellIdStr = 'id="scell_'+key+'" ';
                            cellEv='onmousedown="event.preventDefault();_onCellMouseDown(event,'+gIdx+','+staffId+','+d+')" onmouseenter="_onCellMouseEnter('+gIdx+','+staffId+','+d+')" ondblclick="event.preventDefault();_onCellDblClick('+gIdx+','+staffId+','+d+')"';
                            memoClick = window._schedViewMode === 'month' ? 'onclick="event.stopPropagation();openCellMemo(\''+key+'\',event)"' : '';
                            cellCursor = window._schedViewMode === 'month' ? 'cursor:cell;' : 'cursor:default;';
                            memoSpan = '<span id="smemo_'+key+'" '+memoClick+' onmousedown="event.stopPropagation()" onmouseover="event.stopPropagation()" title="'+(memo||(window._schedViewMode==='month'?'메모 추가':''))+'" style="position:absolute;top:0;right:0;width:0;height:0;border-top:7px solid '+foldColor+';border-left:7px solid transparent;' + (window._schedViewMode==='month'?'cursor:pointer;':'') + 'z-index:2;transition:border-color 0.2s;"></span>';
                        } else {
                            if(memo) {
                                memoSpan = '<span title="'+memo.replace(/"/g,'&quot;')+'" style="position:absolute;top:0;right:0;width:0;height:0;border-top:7px solid '+foldColor+';border-left:7px solid transparent;z-index:2;"></span>';
                            }
                        }
                        
                        html+='<td '+cellIdStr+cellEv+cellTitleAttr+' style="'+cs+lb2+'position:relative;width:'+SWpct+';height:'+rowH+'px;text-align:center;'+cellCursor+'background:'+bg+';color:'+color+';font-weight:'+fw+';font-size:'+cFont+';transition:background 0.08s;user-select:none;-webkit-user-select:none;white-space:nowrap;">';
                        html+='<span '+(isCur?'id="sval_'+key+'" ':'')+'style="pointer-events:none;">'+txt+'</span>'+memoSpan;
                        html+='</td>';
                    });
                }
            });
            html+='</tr>';
        }
        html+='</tbody>';

        /* ── 푸터 ── */
        html+='<tfoot>';
        html+='<tr>';
        html+='<td style="'+cs+'width:'+DWpct+';height:'+(footH/2.2)+'px;background:rgba(239,68,68,0.10);text-align:center;font-size:9px;font-weight:900;color:#ef4444;vertical-align:middle;white-space:nowrap;padding:0;line-height:1;">'+(window._schedViewMode==='week'?'주간<br>휴무':'월간<br>휴무')+'</td>';
            _activeDispGroups.forEach(function(item,di){
                var g=item.g; var gIdx=item.gIdx;
                var ids=gStaff[di];
                var lb=di>0?'border-left:4px solid '+_colRgba(_GCOL[gIdx],0.65)+';':'';
                if(ids.length===0){
                    html+='<td style="'+cs+lb+'width:'+SWpct+';height:'+(footH/2.2)+'px;background:var(--bg-body);"></td>';
                } else {
                    ids.forEach(function(staffId,ci){
                        var lb2=ci===0?lb:'';
                        var hwCnt=0, yCnt=0, bCnt=0, anCnt=0, edCnt=0, naCnt=0;
                        for(var dd_idx=0; dd_idx<targetDays.length; dd_idx++){
                            var tDay=targetDays[dd_idx];
                            var k = _schedCellKey(gIdx,staffId,tDay.d);
                            var v = '';
                            if (tDay.isCur) {
                                v = _schedCells[k] || '';
                            } else if (tDay.y < _schedYear || (tDay.y === _schedYear && tDay.m < _schedMonth)) {
                                v = _prevSchedCells[k] || '';
                            } else {
                                v = _nextSchedCells[k] || '';
                            }
                            var _vf = v ? v.split('|')[0] : '';
                            if(_vf==='휴무') hwCnt++;
                            else if(_vf==='연차') yCnt++;
                            else if(_vf==='반차') bCnt++;
                            else if(_vf==='안식') anCnt++;
                            else if(_vf==='교육') edCnt++;
                            else if(_vf==='육아') naCnt++;
                        }
                        var total = hwCnt + yCnt + bCnt * 0.5 + anCnt + naCnt;
                        var totalStr = total > 0 ? total+'일' : '—';
                        var hasBan = bCnt > 0;
                        var bg = total > 0 ? 'rgba(239,68,68,0.15)' : 'var(--bg-body)';
                        var col = total > 0 ? '#ef4444' : 'rgba(140,140,140,0.4)';
                        var tip = total > 0 ? ('휴무'+hwCnt+'·연차'+yCnt+(hasBan?'·반차'+bCnt+'(×0.5)':'')+(anCnt?'·안식'+anCnt:'')+(naCnt?'·육아'+naCnt:'')) : '';
                        html+='<td title="'+tip+'" style="'+cs+lb2+'width:'+SWpct+';height:'+(footH/2.2)+'px;text-align:center;vertical-align:middle;'+
                            'background:'+bg+';color:'+col+';'+
                            'font-weight:900;font-size:10px;padding:0;white-space:nowrap;line-height:1;cursor:'+(tip?'help':'default')+';">'+
                            totalStr+'</td>';
                    });
                }
            });
        html+='</tr>';
        if(window._schedViewMode === 'month') {
            html+='<tr>';
            html+='<td style="'+cs+'width:'+DWpct+';height:'+(footH/1.8)+'px;background:var(--bg-body);padding:0;"></td>';
            _activeDispGroups.forEach(function(item,di){
                var g=item.g; var gIdx=item.gIdx;
                var ids=gStaff[di];
                var lb=di>0?'border-left:4px solid '+_colRgba(_GCOL[gIdx],0.65)+';':'';
                if(ids.length===0){
                    html+='<td style="'+cs+lb+'width:'+SWpct+';height:'+(footH/1.8)+'px;text-align:center;vertical-align:middle;background:var(--bg-body);padding:1px;"></td>';
                } else {
                    ids.forEach(function(staffId,ci){
                        var lb2=ci===0?lb:'';
                        html+='<td style="'+cs+lb2+'width:'+SWpct+';height:'+(footH/1.8)+'px;text-align:center;vertical-align:middle;background:var(--bg-body);padding:1px;">';
                        html+='<div style="display:flex;gap:2px;justify-content:center;align-items:center;flex-wrap:wrap;">';
                        html+='<button onclick="clearSchedStaff('+gIdx+','+staffId+')" style="padding:1px 3px;border-radius:3px;border:1px solid #06b6d4;background:none;color:#06b6d4;font-size:7.5px;font-weight:900;cursor:pointer;white-space:nowrap;">🧹 비우기</button>';
                        html+='<button onclick="removeSchedStaff('+gIdx+','+staffId+')" style="padding:1px 3px;border-radius:3px;border:1px solid #ef4444;background:none;color:#ef4444;font-size:7.5px;font-weight:900;cursor:pointer;white-space:nowrap;">× 삭제</button>';
                        html+='</div></td>';
                    });
                }
            });
            html+='</tr>';
        }
        html+='</tfoot>';

        html+='</table>';
        wrap.innerHTML=html;
        document.removeEventListener('mouseup',_schedDragEnd);
        document.addEventListener('mouseup',_schedDragEnd);
    }

    function toggleTicker(){
        var content=document.getElementById('tickerContent');
        var btn=document.getElementById('tickerToggleBtn');
        var ticker=document.getElementById('urgentTicker');
        var isHidden = content.style.display==='none';
        if(isHidden){
            content.style.display='flex';
            btn.textContent='▲';
            btn.title='공지바 접기';
            ticker.style.padding='5px 10px';
            localStorage.setItem('tickerCollapsed','0');
        } else {
            content.style.display='none';
            btn.textContent='▼';
            btn.title='공지바 펼치기';
            ticker.style.padding='3px 10px';
            localStorage.setItem('tickerCollapsed','1');
        }
    }
    function resetFilters(){
        document.getElementById('noticeSearch').value="";
        document.getElementById('datePicker').value="";
        renderNotices();
    }
    function syncManuals(){
        db.ref('central_manual_'+currentMode).on('value',function(s){
            manualData[currentMode]=s.val()||{text:"",files:[]};
            updateFileListUI();
        });
    }
    async function handleAdminUpload(input){
        var pw=prompt("\uBE44\uBC88:"); if(pw!==ADMIN_PW) return;
        var files=Array.from(input.files); if(!files.length) return;
        document.getElementById('syncStatusBadge').innerText="UPDATING...";
        try{
            for(var f of files){
                var txt=""; var ab=await f.arrayBuffer();
                if(f.name.toLowerCase().endsWith('pdf')){
                    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';
                    var pdf=await pdfjsLib.getDocument(new Uint8Array(ab)).promise;
                    for(var i=1;i<=pdf.numPages;i++){
                        var page=await pdf.getPage(i);
                        var c=await page.getTextContent();
                        txt+=c.items.map(function(s){return s.str;}).join(" ")+"\n";
                    }
                } else { txt=new TextDecoder().decode(ab); }
                await storage.ref('manuals/'+currentMode+'/'+f.name).put(f);
                manualData[currentMode].text=(manualData[currentMode].text||"")+"\n"+txt;
                if(!manualData[currentMode].files) manualData[currentMode].files=[];
                manualData[currentMode].files.push(f.name);
                await db.ref('central_manual_'+currentMode).set(manualData[currentMode]);
            }
            alert("\u2705 \uC5C5\uB85C\uB4DC \uC644\uB8CC");
        }catch(e){alert("\u274C "+e.message);}
        finally{updateStatusBadge();input.value="";}
    }
    function updateFileListUI(){
        var _fl=document.getElementById('fileList');if(_fl)_fl.innerHTML=(manualData[currentMode].files||[]).map(function(f){
            return '<div class="file-item p-2 border rounded-lg flex justify-between items-center bg-white/50 text-[11px] font-bold shadow-sm"><span class="truncate pr-2">'+f+'</span><span class="text-red-400 cursor-pointer" onclick="deleteManualFile(\''+f+'\')">x</span></div>';
        }).join('');
        var _cc=document.getElementById('totalCharCount');if(_cc)_cc.innerText=(manualData[currentMode].text||"").length.toLocaleString();
    }
    async function deleteManualFile(fileName){
        var pw=prompt("\uBE44\uBC88:"); if(pw!==ADMIN_PW) return;
        if(confirm("\uC0AD\uC81C?")){
            try{
                await storage.ref('manuals/'+currentMode+'/'+fileName).delete();
                manualData[currentMode].files=manualData[currentMode].files.filter(function(f){return f!==fileName;});
                await db.ref('central_manual_'+currentMode).set(manualData[currentMode]);
                alert("\uC0AD\uC81C \uC644\uB8CC");
            }catch(e){alert("\uC624\uB958: "+e.message);}
        }
    }
    async function resetKnowledgeBase(){
        var pw=prompt("\uCD08\uAE30\uD654 \uBE44\uBC88:"); if(pw!==ADMIN_PW) return;
        if(confirm("\uBAA8\uB450 \uC0AD\uC81C?")){
            document.getElementById('syncStatusBadge').innerText="CLEANING...";
            try{
                var r=storage.ref('manuals/'+currentMode);
                var l=await r.listAll();
                await Promise.all(l.items.map(function(i){return i.delete();}));
                await db.ref('central_manual_'+currentMode).set({text:"",files:[]});
                alert("\u2728 \uCD08\uAE30\uD654 \uC644\uB8CC");
            }catch(e){alert("\uC2E4\uD328: "+e.message);}
            finally{updateStatusBadge();}
        }
    }

    function normalizeKey(k){ return k.replace(/[.#$\[\]\/]/g,'_'); }

    // ── 카테고리 버튼 ──
    async function _toggleCatMenu(){
        var popup = document.getElementById('catMenuPopup');
        if(!popup) return;
        if(popup.style.display !== 'none'){ popup.style.display='none'; return; }
        // 매번 Firebase에서 최신 카테고리 로드
        try{
            var saved = await _authFetch('manual_cats/'+currentMode+'.json');
            if(saved && Array.isArray(saved) && saved.length){
                if(currentMode==='mania') _MANIA_CATS = saved;
                else _BAY_CATS = saved;
            }
        }catch(e){}
        var cats = currentMode==='mania' ? _MANIA_CATS : _BAY_CATS;
        var btnStyle = 'display:block;width:100%;text-align:left;padding:7px 12px;border-radius:8px;border:none;background:none;color:var(--text-main);font-size:13px;font-weight:700;cursor:pointer;';
        popup.innerHTML = '<div style="font-size:10px;font-weight:900;color:var(--active-focus-color);margin-bottom:7px;padding:0 2px;">🏷️ 카테고리 검색</div>'
            + cats.map(function(c){
                return '<button style="'+btnStyle+'" onmouseover="this.style.background=\'var(--border-ui)\'" onmouseout="this.style.background=\'none\'" onclick="_catMenuSelect(\''+c.replace(/'/g,"\\'")+'\')">'
                    + escHtml(c) + '</button>';
            }).join('');
        popup.style.display = 'block';
        // 팝업 외부 클릭 시 닫기
        setTimeout(function(){
            document.addEventListener('click', function _closeCat(e){
                var p = document.getElementById('catMenuPopup');
                if(p && !p.contains(e.target) && e.target.id!=='catMenuBtn'){
                    p.style.display='none';
                    document.removeEventListener('click',_closeCat);
                }
            });
        }, 10);
    }
    function _catMenuSelect(cat){
        document.getElementById('catMenuPopup').style.display='none';
        var lid = 'L' + Date.now();
        addMsg('', 'bot', lid);
        var botD = document.getElementById(lid).querySelector('.bubble');
        var idx = currentMode==='bay' ? BAY_MANUAL_INDEX : MANUAL_INDEX;
        _searchByCategory(cat, botD, idx);
        document.getElementById('chatBox').scrollTop = 99999;
    }
    function _searchByCategory(cat, botD, idx){
        var allTitles = [];

        // ① BAY_CATEGORY_GROUPS (내장 매뉴얼 1-1. 기반)
        if(currentMode==='bay'){
            var _bg = BAY_CATEGORY_GROUPS[cat] || BAY_CATEGORY_GROUPS[cat.trim()] || null;
            if(!_bg){
                var _bk = Object.keys(BAY_CATEGORY_GROUPS).find(function(c){ return c===cat||c===cat.trim(); });
                if(_bk) _bg = BAY_CATEGORY_GROUPS[_bk];
            }
            if(_bg && _bg.length){
                _bg.forEach(function(t){ allTitles.push({label:t, src:'idx'}); });
            }
        }

        // ② MANUAL_RANGES / BAY_MANUAL_RANGES (.category 필드 등록 항목)
        var ranges = currentMode==='mania' ? MANUAL_RANGES : BAY_MANUAL_RANGES;
        Object.entries(ranges).forEach(function(e){
            if(e[1] && (e[1].category||'일반')===cat){
                var _t = e[1].title||e[0]||'';
                if(_t && !allTitles.find(function(x){ return x.label===_t; })){
                    allTitles.push({label:_t, src:'range'});
                }
            }
        });

        if(!allTitles.length){ botD.innerHTML='<span>🏷️ <strong>'+escHtml(cat)+'</strong> 카테고리에 등록된 항목이 없습니다.</span>'; return; }
        var use3col = allTitles.length >= 8;
        var h='<strong>🏷️ '+escHtml(cat)+' ('+allTitles.length+'건):</strong>';
        h += use3col ? '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px;">' : '<div class="choice-card-wrap">';
        allTitles.forEach(function(item){
            var _t = item.label.replace(/\"/g,'&quot;');
            h+="<button class='choice-card' onclick='showContentById(\""+_t+"\")'>▶ "+escHtml(item.label)+"</button>";
        });
        h+='</div>';
        botD.innerHTML=h;
    }

    var _lastAskTime = 0;
    async function ask(){
        var inp=document.getElementById('userInput');
        var q=inp.value.trim(); if(!q) return;
        var _now=Date.now(); if(_now-_lastAskTime<500){return;} _lastAskTime=_now;
        addMsg(q,'user'); inp.value=""; inp.focus(); updateAssistPanel(q);
        window._lastManualSearchQ = q;
        var lid="L"+_now;
        addMsg("\uB9E4\uB274\uC5BC\uC744 \uAC80\uC0C9 \uC911\uC785\uB2C8\uB2E4...","bot",lid);
        var botD=document.getElementById(lid).querySelector('.bubble');
        var idx = currentMode==='bay' ? BAY_MANUAL_INDEX : MANUAL_INDEX;
        var titles=Object.keys(idx);
        var kw=q.toLowerCase().trim();

        // 카테고리 검색 (베이 전용: 섹션 이름으로 전체 목록 표시)
        if(currentMode==='bay'){
            var _bg=BAY_CATEGORY_GROUPS[kw]||BAY_CATEGORY_GROUPS[q.trim()]||null;
            if(!_bg){
                // 부분 일치: 입력어가 카테고리명에 포함되거나 카테고리명이 입력어에 포함
                var _bk=Object.keys(BAY_CATEGORY_GROUPS).find(function(c){
                    return c===kw||c.indexOf(kw)>=0||kw.indexOf(c)>=0;
                });
                if(_bk) _bg=BAY_CATEGORY_GROUPS[_bk];
            }
            if(_bg&&_bg.length){
                var _use3b = _bg.length >= 8;
                var _bh='<strong>🏷️ '+escHtml(kw)+' 카테고리 전체 ('+_bg.length+'건):</strong>';
                _bh += _use3b ? '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px;">' : '<div class="choice-card-wrap">';
                _bg.forEach(function(t){_bh+="<button class='choice-card' onclick='showContentById(\""+t.replace(/\"/g,'&quot;')+"\")'>▶ "+escHtml(t)+"</button>";});
                _bh+='</div>';
                botD.innerHTML=_bh;
                document.getElementById('chatBox').scrollTop=99999;
                return;
            }
        }

        // 카테고리 검색 — 버튼 또는 직접 입력 모두 처리
        var _allCats = currentMode==='mania' ? _MANIA_CATS : _BAY_CATS;
        if(_allCats.indexOf(q)>=0){
            _searchByCategory(q, botD, idx);
            document.getElementById('chatBox').scrollTop=99999;
            return;
        }

        // 카테고리 검색 (매니아 전용: 일반/충전/결제/사고) — 하위호환
        if(currentMode==='mania'&&(kw==='일반'||kw==='충전'||kw==='결제'||kw==='사고')){
            var _catLabel = kw==='충전'?'충전':kw==='결제'?'결제':kw;
            var _catList=titles.filter(function(t){
                var pr=MANUAL_RANGES[normalizeKey(t)];
                if(!pr) return false;
                var cat=pr.category?pr.category:'일반';
                return cat===kw;
            });
            if(_catList.length){
                var _use3c = _catList.length >= 8;
                var _ch='<strong>🏷️ '+escHtml(_catLabel)+' 카테고리 전체 ('+_catList.length+'건):</strong>';
                _ch += _use3c ? '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px;">' : '<div class="choice-card-wrap">';
                _catList.forEach(function(t){_ch+="<button class='choice-card' onclick='showContentById(\""+t.replace(/\"/g,'&quot;')+"\")'>▶ "+escHtml(t)+"</button>";});
                _ch+='</div>';
                botD.innerHTML=_ch;
            } else {
                botD.innerHTML='<span>'+escHtml(_catLabel)+' 카테고리 항목을 찾을 수 없습니다.</span>';
            }
            document.getElementById('chatBox').scrollTop=99999;
            return;
        }

        // 1. 완전 일치 - 바로 표시
        var exactMatch = titles.find(function(t){return t.toLowerCase()===kw;});
        if(exactMatch){showContent(exactMatch,botD,idx);return;}

        // 2. 부분 일치 - 단어 분리해서 검색 (공백 없이도 검색 가능)
        var matched=titles.filter(function(t){
            var tl=t.toLowerCase();
            // 공백 제거 버전도 비교 (신용카드결제 -> 신용카드 결제)
            var tlNoSpace=tl.replace(/\s/g,'');
            var kwNoSpace=kw.replace(/\s/g,'');
            return tl.indexOf(kw)>=0 || tlNoSpace.indexOf(kwNoSpace)>=0;
        });

        if(matched.length===0){
            searchByKeyword(kw, function(kwResults) {
                if(kwResults.length === 0) {
                    // 제목·Firebase 키워드 모두 실패 → 매뉴얼 내용(value) 직접 검색
                    var kwNoSp=kw.replace(/\s/g,'');
                    var contentMatched=Object.keys(idx).filter(function(t){
                        var val=(typeof idx[t]==='string'?idx[t]:(idx[t].text||idx[t].content||'')).toLowerCase();
                        var valNoSp=val.replace(/\s/g,'');
                        return val.indexOf(kw)>=0 || valNoSp.indexOf(kwNoSp)>=0;
                    });
                    if(contentMatched.length===1){showContent(contentMatched[0],botD,idx);return;}
                    if(contentMatched.length>1){
                        var hc='<strong>\''+escHtml(q)+'\' 내용 검색 결과 '+contentMatched.length+'개:</strong><div class="choice-card-wrap">';
                        contentMatched.slice(0,10).forEach(function(t){hc+="<button class='choice-card' onclick='showContentById(\""+t.replace(/"/g,'&quot;')+"\")'>\u25B6 "+escHtml(t)+"</button>";});
                        hc+='</div>';
                        botD.innerHTML=hc;
                        document.getElementById('chatBox').scrollTop=99999;
                        return;
                    }
                    askClaude(q, botD);
                    return;
                }
                if(kwResults.length === 1) { showContent(kwResults[0], botD, idx); return; }
                var h2 = '<strong>' + escHtml(q) + ' \uD0A4\uC6CC\uB4DC ' + kwResults.length + '\uAC1C:</strong><div class="choice-card-wrap">';
                kwResults.forEach(function(t){ h2 += "<button class='choice-card' onclick='showContentById(\""+t.replace(/"/g,'&quot;')+"\")'>\u25B6 "+escHtml(t)+"</button>"; });
                h2 += '</div>';
                botD.innerHTML = h2;
                document.getElementById('chatBox').scrollTop=99999;
            });
            return;
        }
        if(matched.length===1){showContent(matched[0],botD,idx);return;}

        var h="<strong>'"+q+"' \uAD00\uB828 \uD56D\uBAA9 "+matched.length+"\uAC1C\uB97C \uCC3E\uC558\uC2B5\uB2C8\uB2E4:</strong><div class='choice-card-wrap'>";
        matched.forEach(function(t){
            h+="<button class='choice-card' onclick='showContentById(\""+t.replace(/\"/g,'&quot;')+"\")'>\u25B6 "+t+"</button>";
        });
        h+='</div>';
        botD.innerHTML=h;
        document.getElementById('chatBox').scrollTop=99999;
        inp.focus();
    }

    var _lastShowById = 0;
    function showContentById(title){
        var now = Date.now();
        if(now - _lastShowById < 600) return;
        _lastShowById = now;
        addMsg(title,'user');
        var lid="L"+now; addMsg("","bot",lid);
        var botD=document.getElementById(lid).querySelector('.bubble');
        var idx = currentMode==='bay' ? BAY_MANUAL_INDEX : MANUAL_INDEX;
        showContent(title,botD,idx);
        setTimeout(function(){document.getElementById('userInput').focus();},200);
    }

    // ===== 이미지 크롭 시스템 =====
    window._currentCropData = {dbPath:'', cropTop:0, cropBottom:100, imgUrl:''};

    function _applyCrop(img, topPct, botPct) {
        if(topPct<=0 && botPct>=100) return;
        if(botPct <= topPct) return;
        var natW = img.naturalWidth, natH = img.naturalHeight;
        if(!natW || !natH) return;
        var natCropH = natH * (botPct - topPct) / 100;
        // object-position P% = topPct*100/(100-botPct+topPct) → object-fit:cover로 올바른 슬라이스 표시
        var posP = topPct > 0 ? (topPct * 100 / (100 - botPct + topPct)).toFixed(3) : '0';
        // 싱글페이지는 --mania-mv-w 변수 사용, 멀티뷰 셀은 100%
        var wrap = img.parentElement;
        var ww = (wrap && wrap.classList && wrap.classList.contains('mv-cell')) ? '100%' : 'var(--mania-mv-w,60%)';
        img.style.cssText = 'width:'+ww+';height:auto;display:block;cursor:zoom-in;margin:0 auto 4px;'
            + 'aspect-ratio:'+natW+'/'+natCropH.toFixed(2)+';'
            + 'object-fit:cover;object-position:0 '+posP+'%;';
    }

    var _cropEditorPageIdx = 0;
    function _cropEditorGetUrls() {
        var d = window._currentCropData || {};
        return (d.imgUrls && d.imgUrls.length) ? d.imgUrls : (d.imgUrl ? [d.imgUrl] : []);
    }
    // 해당 항목의 크롭 데이터로 에디터 열기 (여러 항목 동시 표시 시 올바른 항목 적용)
    function _openCropEditorByTitle(btn){
        var t = decodeURIComponent(btn.dataset.cropTitle);
        var d = window._cropDataByTitle && window._cropDataByTitle[t];
        if(d) window._currentCropData = d;
        _cropEditorPageIdx = 0;
        openCropEditor();
    }
    // 현재 페이지의 크롭값을 슬라이더에 로드
    function _cropEditorLoadPageCrop(pageIdx){
        var d = window._currentCropData || {};
        var pg = d.cropPages && d.cropPages[pageIdx];
        var urls = _cropEditorGetUrls();
        var top, bot;
        if(pg){
            top = pg.top||0; bot = pg.bot!==undefined?pg.bot:100;
        } else {
            // backward-compat: 첫 페이지→cropTop, 마지막→cropBottom, 나머지→0/100
            top = pageIdx===0 ? (d.cropTop||0) : 0;
            bot = pageIdx===urls.length-1 ? (d.cropBottom!==undefined?d.cropBottom:100) : 100;
        }
        document.getElementById('cropEditorTopSlider').value = top;
        document.getElementById('cropEditorBotSlider').value = bot;
    }
    function _cropEditorUpdatePageNav() {
        var urls = _cropEditorGetUrls();
        var nav = document.getElementById('cropEditorPageNav');
        var lbl = document.getElementById('cropEditorPageLabel');
        if(!nav) return;
        if(urls.length > 1) {
            nav.style.display = 'flex';
            if(lbl) lbl.textContent = (_cropEditorPageIdx + 1) + ' / ' + urls.length;
        } else {
            nav.style.display = 'none';
        }
    }
    function _cropEditorPrevPage() {
        if(_cropEditorPageIdx <= 0) return;
        _cropEditorPageIdx--;
        document.getElementById('cropEditorImg').src = _cropEditorGetUrls()[_cropEditorPageIdx] || '';
        _cropEditorLoadPageCrop(_cropEditorPageIdx);
        updateCropPreview();
        _cropEditorUpdatePageNav();
    }
    function _cropEditorNextPage() {
        var urls = _cropEditorGetUrls();
        if(_cropEditorPageIdx >= urls.length - 1) return;
        _cropEditorPageIdx++;
        document.getElementById('cropEditorImg').src = urls[_cropEditorPageIdx] || '';
        _cropEditorLoadPageCrop(_cropEditorPageIdx);
        updateCropPreview();
        _cropEditorUpdatePageNav();
    }
    function openCropEditor() {
        var urls = _cropEditorGetUrls();
        if(!urls.length){ alert('이미지가 있는 항목에서만 사용할 수 있습니다.'); return; }
        var modal = document.getElementById('cropEditorModal');
        if(!modal) return;
        _cropEditorPageIdx = 0;
        document.getElementById('cropEditorImg').src = urls[0];
        _cropEditorLoadPageCrop(0); // 현재 페이지 크롭값 로드
        _cropEditorUpdatePageNav();
        updateCropPreview();
        modal.classList.remove('hidden');
    }
    function closeCropEditor() {
        document.getElementById('cropEditorModal').classList.add('hidden');
        document.body.focus();
    }
    function updateCropPreview() {
        var top = parseInt(document.getElementById('cropEditorTopSlider').value);
        var bot = parseInt(document.getElementById('cropEditorBotSlider').value);
        if(bot <= top){ bot = Math.min(top + 2, 100); document.getElementById('cropEditorBotSlider').value = bot; }
        document.getElementById('cropEditorTopVal').textContent = top;
        document.getElementById('cropEditorBotVal').textContent = bot;
        document.getElementById('cropEditorTopDim').style.height = top + '%';
        document.getElementById('cropEditorBotDim').style.height = (100 - bot) + '%';
        document.getElementById('cropEditorTopLine').style.top = top + '%';
        document.getElementById('cropEditorBotLine').style.top = bot + '%';
    }
    function saveCropSettings() {
        var d = window._currentCropData || {};
        var top = parseInt(document.getElementById('cropEditorTopSlider').value);
        var bot = parseInt(document.getElementById('cropEditorBotSlider').value);
        // 등록 대기 항목 콜백 모드
        if(d._pendingCallback){
            d.cropTop = top; d.cropBottom = bot;
            d._pendingCallback(top, bot);
            closeCropEditor();
            return;
        }
        if(!d.dbPath){ alert('저장 경로가 없습니다.'); return; }
        // 페이지별 저장: cropPages/{pageIdx}
        if(!d.cropPages) d.cropPages = {};
        d.cropPages[_cropEditorPageIdx] = {top: top, bot: bot};
        var update = {};
        update['cropPages/'+_cropEditorPageIdx] = {top: top, bot: bot};
        db.ref(d.dbPath).update(update, function(err){
            if(err){ alert('저장 실패: ' + err.message); return; }
            var pgLabel = d.pageStart ? 'p.'+(Number(d.pageStart)+_cropEditorPageIdx) : (_cropEditorPageIdx+1)+'/'+_cropEditorGetUrls().length+'페이지';
            closeCropEditor();
            alert('✅ '+pgLabel+' 저장됐습니다. 다시 검색하면 적용됩니다.');
        });
    }
    function resetCropSettings() {
        var d = window._currentCropData || {};
        if(!d.dbPath) return;
        if(!confirm('이 페이지의 크롭 설정을 초기화하시겠습니까?')) return;
        if(d.cropPages) delete d.cropPages[_cropEditorPageIdx];
        var update = {};
        update['cropPages/'+_cropEditorPageIdx] = null;
        db.ref(d.dbPath).update(update, function(){
            _cropEditorLoadPageCrop(_cropEditorPageIdx);
            updateCropPreview();
            closeCropEditor();
            alert('초기화됐습니다.');
        });
    }
    // ===== 크롭 시스템 끝 =====

    // ===== 페이지범위 1회 마이그레이션 =====
    // 해킹머니_해킹아이템: 147페이지(구매이후재판매 내용) 포함 + cropBottom=44
    // 롤백: 147페이지 상단 해킹머니 내용 제거 → cropTop=44
    (function _splitBundledNotices(){
        db.ref('_migrations/split_notices_v1').once('value',function(ms){
            if(ms.val()) return;
            var ref=db.ref('notices_mania');
            var _d=function(y,m,d,h,mi){
                return new Date(y,m-1,d,h||9,mi||0).toLocaleString('ko-KR',{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',weekday:'long'});
            };
            var items={};
            // 2026.03 공지 6건
            var k1=new Date(2026,2,4,9,0).getTime();
            items[k1]={date:'2026. 3. 4.',content:'[2026.03.04] 오류_[정상적인 경로를 이용해주세요. er 005] 수정\n\n자택 연락처 정확하지 않을 시 물품 등록 및 신청할 때 발생되는 오류 수정 완료'};
            var k2=new Date(2026,2,5,9,0).getTime();
            items[k2]={date:'2026. 3. 5.',content:'[2026.03.05] 모바일 메인 화면 변경'};
            var k3=new Date(2026,2,5,10,0).getTime();
            items[k3]={date:'2026. 3. 5.',content:'[2026.03.05] APP 무한 로딩 발생 및 계정물품 채팅창 오류 수정\n\n3/4일 해당 오류 수정되어 구글/원스토어/갤럭시스토어에 배포\n앱 리뷰글에도 버전 업데이트 완료 답변 처리되었으며,\n동일한 현상 발생되는 경우 회원이 고객센터로 문의할 수 있으니 업무 시 참고 바랍니다.'};
            var k4=new Date(2026,2,9,9,0).getTime();
            items[k4]={date:'2026. 3. 9.',content:'[2026.03.09] PC/모바일 아이디/비번찾기 시 [본인 명의 휴대폰 인증] 상단 노출'};
            var k5=new Date(2026,2,9,11,50).getTime();
            items[k5]={date:'2026. 3. 9.',content:'[2026.03.09] 비거래 숨김 해제 가능\n\n적용 : 3월 9일 11:50분경\n비거래 숨김 처리 시 3시간 이후 숨김 해제 가능\n(자동 해제는 아니며, 해제 가능 상태로 변경)\n\n- 비거래 숨김 시 재등록 불가\n- 비거래 숨김 시 자동재등록 사용자의 경우 숨김 상태 유지되며 재등록 됨.'};
            var k6=new Date(2026,2,10,9,0).getTime();
            items[k6]={date:'2026. 3. 10.',content:'[2026.03.10] 모바일 > 이전 종료내역 노출 적용'};
            // 2026.04 공지 2건
            var k7=new Date(2026,3,7,9,0).getTime();
            items[k7]={date:'2026. 4. 7.',content:'[2026.04.07] 상품등록 - 수량 입력 개선\n\n1. 기존 단위 선택(만/억/조) 기능 삭제\n- 수량 입력 시 한국어 단위(만/억/조) 자동 변환 표기\n예) 12,345,678,900,000 → 12조 3,456억\n\n2. 시세 있는 게임 상품 등록 개선\n① 분할 선택 시 거래 단위 기본값 제공 - 고객이 수정 가능\n예) 아이온2 - 100만, 리니지클래식 - 1만\n② 거래 금액 인풋 필드 상단에 시세 표현\n③ 게임머니 명칭 통일 : "개"\n④ 시세 대비 100배 이상, 이하인 경우 상품 등록 불가\n- 상품 등록시 등록 불가 얼럿으로 처리.\n- 문구 : "시세 대비 과도하게 벗어난 가격은 등록할 수 없습니다. 수량 또는 금액을 다시 확인해 주세요."\n- 게임[패스오브엑자일] 의 경우 시세 노출부분이 제외됨.\n\n※ 공지사항에는 1번 항목만 게시되어있습니다.\n시세있는 게임 상품 등록 개선은 고객이 직접 이용 시에 개선 체감이 가능하니 참고해주시면 감사하겠습니다.'};
            var k8=new Date(2026,3,8,10,57).getTime();
            items[k8]={date:'2026. 4. 8.',content:'[2026.04.08] 마일리지 결제 입금대기 삭제(04/08 오전 10시 57분경 적용)\n\n마일리지 결제 시 입금대기(30분)를 악용해 판매를 방해하는 문제를 개선\n\n주요 변경 내용\n- (기존) 마일리지 잔액 부족 여부와 무관하게 구매신청 시 30분 입금대기 생성\n- (변경) 마일리지 잔액 부족 시 즉시 얼럿 표시 → 입금대기 미생성\n- 얼럿 문구: "마일리지가 부족합니다 충전 후 사용하세요"'};

            ref.once('value',function(s){
                var all=s.val()||{};
                var updates={};
                // 새 공지 추가
                Object.keys(items).forEach(function(k){
                    var it=items[k];
                    updates[k]={title:it.content.split('\n')[0].substring(0,35),content:it.content,date:it.date};
                });
                // 기존 번들 공지(홈페이지 적용 안내) 삭제
                Object.keys(all).forEach(function(id){
                    var t=all[id].title||'';
                    if(t.indexOf('홈페이지 적용 안내')!==-1&&(t.indexOf('2026.04')!==-1||t.indexOf('2026.03')!==-1)){
                        updates[id]=null;
                    }
                });
                ref.update(updates,function(err){
                    if(!err) db.ref('_migrations/split_notices_v1').set(Date.now());
                });
            });
        });
    })();

    (function _addMarchNotices(){
        db.ref('_migrations/march_notices_v1').once('value',function(ms){
            if(ms.val()) return;
            var ref=db.ref('notices_mania');
            var u={};
            function n(ts,date,content){u[ts]={title:content.split('\n')[0].substring(0,35),content:content,date:date};}
            // 3.10 기존 항목 내용 업데이트 + 신규 항목
            n(new Date(2026,2,10,9,0).getTime(),'2026. 3. 10.','[2026.03.10] 모바일 > 이전 종료내역 노출 적용\n\n모바일 > 고객센터 > 거래사고신고 > 거래종료건\n\n이전 판매종료내역\n이전 구매종료내역');
            n(new Date(2026,2,10,10,0).getTime(),'2026. 3. 10.','[2026.03.10] 모바일 메인 하단 사업자정보노출 방식 변경');
            n(new Date(2026,2,11,9,0).getTime(),'2026. 3. 11.','[2026.03.11] 거래 취소율 하락 목적으로 일부 변경\n\n① 판매자 거래 취소 경고 문구 변경 (*팝니다, 삽니다 모두 적용)\n- 기존 : 거래를 취소하겠습니까?\n- 변경 : 거래를 취소하겠습니까?\n[주의] 잦은 거래 취소로 인해 취소율이 높아질 경우, 서비스 이용 정책에 따라 이용 제재를 받을 수 있습니다.\n\n② [분할물품] 판, 구매 등록 상품 보유 수량 변동 시점 변경\n- 기존 : 거래 종료 시 차감 (중복 구매 노출 위험 존재)\n- 변경 : 거래 중 상태(물품 점유)시 즉시 차감 (중복 신청 방지) / 관리자도 동일\nㄴ취소 시 원복 로직은 기존과 동일');
            n(new Date(2026,2,16,9,0).getTime(),'2026. 3. 16.','[2026.03.16] 물품검색란 내 [팝니다/삽니다] 노출 변경');
            n(new Date(2026,2,17,9,0).getTime(),'2026. 3. 17.','[2026.03.17] 상품 제목 특문 미노출 적용 및 상점명 추가\n\n1. 상품 제목 특문 미노출\n- 상품 등록 시 제목에 특문 및 연속되는 자음모음 등 입력불가\n- 영문 대소문자 / 한글 / 숫자 / 기호 [ . , + ~ % / ] 6개 이외 모두 비허용\n- 제외된 특수문자/이모티콘은 띄어쓰기로 대체\n→ 가급적 한글 텍스트 위주로 제목 입력을 권유 드립니다.\n- 적용시점에서 이전 등록된 상품 제목도 모두 특문 등 미노출 처리\n- 일괄등록 시 수량오류로 등록 불가 문의 시, 파일 내 제목 특문 여부 확인\n\n2. 상점명\n- 제목에 특문 등 입력 불가로 의한 대체 강조 기능인 \'상점명\' 설정 기능 추가\n- 한글 기준 최대 6자리 입력 가능, 이모티콘/특수 문자 이용 가능\n- 신규 등록 : 상품 등록 시 제목 옆 [상점명 설정하기] / 마이룸 > 상점명 관리\n- 상점명 변경은 [마이룸 > 상점명 관리]에서만 가능\n- 게임 당 1개 / 전체게임으로 총 5개 까지 상점명 설정 가능\n- 해당 게임내 이미 등록된 상점명으로는 설정 불가\n- 상점명 미적용 시 노출된 (-) 부분은 신용등급만 보이도록 수정 완료');
            n(new Date(2026,2,17,10,0).getTime(),'2026. 3. 17.','[2026.03.17] 출금계좌 예금주 공백 오류 수정\n\n출금계좌 예금주명 등록 시 앞뒤 공백 저장 안됨, 글자 중간 공백은 가능.');
            n(new Date(2026,2,18,9,0).getTime(),'2026. 3. 18.','[2026.03.18] 종료영역 및 서버 노출 방식 개선\n\n1. 실시간 거래 종료 영역 노출 방식 개선\n- 기존 [제목 / 금액] 노출 방식을 [게임명 / 서버명 / 상품 종류 / 금액] 구조로 변경 (좌/우 2개 단위로 노출)\n- 게임명 및 서버명이 6자를 초과하는 경우 (...)로 축약 표시\n- 금액은 최대 1억까지 표시\n\n2. 게임 검색 시 서버 노출 방식 개선\n- 서버 목록은 검색 화면에서 1줄만 노출되도록 변경\n- 기본 노출 서버는 거래가 많은 서버 순으로 우선 노출\n- 추가 서버 목록은 [전체 서버 보기 v] 클릭 시 전체 확인 가능하도록 개선\n* 채널이 있는 게임의 경우, 전체 서버 보기 시 채널 정보까지 함께 노출\n- 그 외 검색 항목은 [필터 전체보기 v] 클릭 시 확인 가능');
            n(new Date(2026,2,19,9,0).getTime(),'2026. 3. 19.','[2026.03.19] 검색 정렬 기본값 및 보상제도 문구 변경\n\n1. 낮은가격순 검색 정렬\n- 물품 낮은 가격순, 높은 가격순, 최근 등록순 조회 시 검색 기본값이 [거래전체 → 거래대기]로 변경\n\n2. 100% 보상제도 문구 추가\n고객센터 > 보상제도 > 보상이 불가능한 경우 9번 항목 하단 문구 추가\n(물품 종류가 [기타]인 경우, 해당 금액은 산정 대상에서 제외)');
            n(new Date(2026,2,24,9,0).getTime(),'2026. 3. 24.','[2026.03.24] 채팅창 인수/인계 간편 조치\n\n- 채팅창에서 [인수/인계] 버튼 클릭 시 페이지 이동 없이 채팅창에서 즉시 반영되는 기능\n- 예외\n① 삽니다 - 인수 - 결제인증 필요 시에는 페이지 이동이 있음.\n② 계정거래 - 전자계약서 서명 필요한 경우 페이지 이동 있음\n(게스트, 선물 계정은 전자계약서 서명 없음)');
            n(new Date(2026,2,24,10,0).getTime(),'2026. 3. 24.','[2026.03.24] 상점명 관련 알아두기 적용\n\n상점명 관련으로 홈페이지 내 알아두기가 추가');
            n(new Date(2026,2,26,9,0).getTime(),'2026. 3. 26.','[2026.03.26] 거래 관련 메시지(SMS/알림톡) 발송 변경\n\n[기존]\nSMS (X), 알림톡 (X) ---> SMS으로 발송\nSMS (O), 알림톡 (X) ---> SMS으로 발송\nSMS (O), 알림톡 (O) ---> 알림톡으로 발송\nSMS (X), 알림톡 (O) ---> 알림톡으로 발송\n\n[변경]\nSMS (O), 알림톡 (O) ---> SMS으로 발송\nSMS (X), 알림톡 (O) ---> 알림톡으로 발송\nSMS (X), 알림톡 (X) ---> SMS으로 발송\nSMS (O), 알림톡 (X) ---> SMS으로 발송\n※ 자세한 내용은 이메일 (첨부파일) 확인 해주세요.');
            n(new Date(2026,2,31,9,0).getTime(),'2026. 3. 31.','[2026.03.31] 채팅 개선 내용\n\n1. 채팅 거래 상태 안내문구 추가\n입금 전과 입금 후 상태를 쉽게 구분할 수 있도록 채팅방 상단에 안내 문구와 색상 표시를 추가했습니다.\n\n2. 채팅방 노출 정책 개선\n- 동일 상품에 여러 채팅방이 있는 경우, 결제 완료 이후에는 실제 거래가 진행 중인 채팅방만 활성 상태로 보이며\n그 외 미입금 채팅방은 회색으로 비활성 처리됩니다.\n- 사전 채팅을 했더라도 실제 거래당사자가 아닌 경우에는 실제 거래 상태값(거래중, 거래완료, 거래취소)은 노출되지 않습니다.\n해당 상품이 거래불가로 표시됩니다.');
            ref.update(u,function(err){
                if(!err) db.ref('_migrations/march_notices_v1').set(Date.now());
            });
        });
    })();

    (function _migratePageRanges(){
        var _m='manual_page_ranges/mania/';
        db.ref(_m+'해킹머니_해킹아이템').once('value',function(s){
            var r=s.val();
            if(r && r.end===146){ db.ref(_m+'해킹머니_해킹아이템').update({end:147,cropBottom:44}); }
        });
        db.ref(_m+'롤백').once('value',function(s){
            var r=s.val();
            if(r && (r.cropTop===undefined||r.cropTop===null||r.cropTop===0)){
                db.ref(_m+'롤백').update({cropTop:44});
            }
        });
    })();

    function showContent(title,botD,manualIdx){
        if(!manualIdx) manualIdx = currentMode==='bay' ? BAY_MANUAL_INDEX : MANUAL_INDEX;
        botD.innerHTML='<div style="text-align:center;padding:20px;opacity:0.5">\uD83D\uDCC4 \uBD88\uB7EC\uC624\uB294 \uC911...</div>';
        var key=normalizeKey(title);
        var dbPath = currentMode==='bay' ? 'manual_page_ranges/bay/'+key : 'manual_page_ranges/mania/'+key;
        db.ref(dbPath).once('value',function(snap){
            var range=snap.val();
            // \uD0A4 \uBD88\uC77C\uCE58 \uD3F4\uBC31: title \uD544\uB4DC\uBA85\uC774 \uB2E4\uB97C \uB54C MANUAL_RANGES\uC5D0\uC11C title \uD544\uB4DC\uB85C \uC7AC\uD0D0\uC0C9
            if(!range){
                var mr = currentMode==='bay' ? BAY_MANUAL_RANGES : MANUAL_RANGES;
                var found = Object.entries(mr).find(function(e){
                    return e[1] && (e[1].title===title || normalizeKey(e[1].title||'')===key);
                });
                if(found){ range=found[1]; dbPath=(currentMode==='bay'?'manual_page_ranges/bay/':'manual_page_ranges/mania/')+found[0]; }
            }
            if(!range){
                var content=manualIdx[title];
                if(content && typeof content==='object') content=content.text||content.content||'';
                var kwHtml2 = buildKeywordBar(title);
                botD.innerHTML=content
                    ?'<div class="mt-card"><div class="mt-header">\uD83D\uDCCB '+escHtml(title)+'</div><pre class="mt-raw">'+escHtml(content)+'</pre>'+kwHtml2+'</div>'
                    :"\uD83D\uDCED \uD574\uB2F9 \uD56D\uBAA9\uC744 \uCC3E\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";
                if(content){ loadKeywords(title, botD); _appendRelatedNotices(title, botD); _appendTemplateBtn(title, botD); }
                document.getElementById('chatBox').scrollTop=99999;
                document.getElementById('userInput').focus();
                return;
            }
            var start=range.start, end=range.end;
            if(end < start){ end = start; db.ref(dbPath).update({end:end}); } // end<start 오류 자동 수정
            var promises=[];
            for(var p=start;p<=end;p++){
                (function(pg){
                    var curMode=currentMode;
                    promises.push(
                        _getPageDataUrl(curMode,pg).then(function(url){ return url?{page:pg,url:url}:null; })
                    );
                })(p);
            }
            Promise.allSettled(promises).then(function(results){
                var succeeded=results.filter(function(r){return r.status==='fulfilled'&&r.value;}).map(function(r){return r.value;});
                succeeded.sort(function(a,b){return a.page-b.page;});
                var urls=succeeded.map(function(r){return r.url;});
                if(!urls.length){
                    var content=manualIdx[title];
                    if(content && typeof content==='object') content=content.text||content.content||'';
                    botD.innerHTML='<div class="mt-card"><div class="mt-header">📋 '+escHtml(title)+'</div><pre class="mt-raw">'+escHtml(content||'내용 없음')+'</pre></div>';
                    _appendRelatedNotices(title, botD);
                    _appendTemplateBtn(title, botD);
                    document.getElementById('chatBox').scrollTop=99999;
                    return;
                }
                var imgKey='_imgs_'+Date.now();
                window[imgKey]=urls;
                window[imgKey+'_plat']=currentMode;
                var _cT=(range&&range.cropTop!=null)?Number(range.cropTop):0;
                var _cB=(range&&range.cropBottom!=null)?Number(range.cropBottom):100;
                var _cPS=(range&&range.start!=null)?Number(range.start):null;
                var _cPages=(range&&range.cropPages)||{};
                var _cropEntry={dbPath:dbPath,cropTop:_cT,cropBottom:_cB,cropPages:_cPages,pageStart:_cPS,imgUrl:urls[0]||'',imgUrls:urls};
                window._cropDataByTitle=window._cropDataByTitle||{};
                window._cropDataByTitle[title]=_cropEntry;
                window[imgKey+'_crop']=_cropEntry; // imgKey별 크롭 데이터
                window._currentCropData=_cropEntry;
                var kwHtml=buildKeywordBar(title);
                var pgHtml='';
                var _pgLabel=function(i,tot){ return _cPS ? 'p.'+(+_cPS+i) : (i+1)+'/'+tot; };
                if(currentMode==='bay'){
                    var tot=urls.length;
                    var _bayCell=function(u,i){
                        return '<div class="mv-cell" onclick="openImgModal(\''+imgKey+'\','+i+')">'
                            +'<span class="mv-num">'+_pgLabel(i,tot)+'</span>'
                            +'<img src="'+u+'" loading="lazy" onerror="this.style.display=\'none\'"></div>';
                    };
                    if(tot===1){
                        pgHtml='<div class="mt-pages">'
                            +'<div style="position:relative;width:calc(var(--bay-mv-w,65%) / 2 + 3px);max-width:100%;margin:0 auto;">'
                            +'<span class="mv-num">'+_pgLabel(0,1)+'</span>'
                            +'<img src="'+urls[0]+'" loading="lazy" style="width:100%;display:block;border-radius:4px;cursor:zoom-in;" onclick="openImgModal(\''+imgKey+'\',0)" onerror="this.style.display=\'none\'"></div></div>';
                    } else if(tot<=3){
                        pgHtml='<div class="bay-multiview">'+urls.map(_bayCell).join('')+'</div>';
                    } else {
                        pgHtml='<div class="bay-multiview" style="flex-wrap:wrap;">'+urls.map(function(u,i){
                            return '<div class="mv-cell" style="flex:0 0 calc(50% - 3px);" onclick="openImgModal(\''+imgKey+'\','+i+')">'
                                +'<span class="mv-num">'+_pgLabel(i,tot)+'</span>'
                                +'<img src="'+u+'" loading="lazy" onerror="this.style.display=\'none\'"></div>';
                        }).join('')+'</div>';
                    }
                } else {
                    var md=urls;
                    function _maniaCell(u,i){
                        var _pg=_cPages&&_cPages[i];
                        var ct=_pg?(_pg.top||0):(i===0?_cT:0);
                        var cb=_pg?(_pg.bot!==undefined?_pg.bot:100):(i===md.length-1?_cB:100);
                        var hc=ct>0||cb<100;
                        return '<div class="mv-cell"'+(hc?' style="overflow:hidden;position:relative;"':'')
                            +' onclick="openImgModal(\''+imgKey+'\','+i+')">'
                            +'<span class="mv-num">'+_pgLabel(i,md.length)+'</span>'
                            +'<img src="'+u+'" loading="lazy"'+(hc?' style="width:100%;display:block;" onload="_applyCrop(this,'+ct+','+cb+')"':'')
                            +' onerror="this.style.display=\'none\'"></div>';
                    }
                    if(md.length===1){
                        if(_cT>0||_cB<100){
                            pgHtml='<div style="margin:8px auto 0;width:var(--mania-mv-w,60%);max-width:100%;">'
                                +'<div class="mv-cell" style="overflow:hidden;position:relative;" onclick="openImgModal(\''+imgKey+'\',0)">'
                                +'<span class="mv-num">'+_pgLabel(0,1)+'</span>'
                                +'<img src="'+md[0]+'" loading="lazy" style="width:100%;display:block;" onload="_applyCrop(this,'+_cT+','+_cB+')" onerror="this.style.display=\'none\'"></div></div>';
                        } else {
                            pgHtml='<div style="margin:8px auto 0;width:var(--mania-mv-w,60%);max-width:100%;">'
                                +'<div class="mv-cell" onclick="openImgModal(\''+imgKey+'\',0)">'
                                +'<span class="mv-num">'+_pgLabel(0,1)+'</span>'
                                +'<img src="'+md[0]+'" loading="lazy" style="width:100%;display:block;border-radius:4px;cursor:zoom-in;" onerror="this.style.display=\'none\'"></div></div>';
                        }
                    } else if(md.length===2){
                        pgHtml='<div class="mania-2col">'+md.map(_maniaCell).join('')+'</div>';
                    } else {
                        pgHtml='<div class="mania-multiview">'+md.map(_maniaCell).join('')+'</div>';
                    }
                }
                botD.innerHTML='<div class="mt-card"><div class="mt-header">📋 '+escHtml(title)+'</div>'+pgHtml+kwHtml+'</div>';
                loadKeywords(title, botD);
                _appendRelatedNotices(title, botD);
                _appendTemplateBtn(title, botD);
                document.getElementById('chatBox').scrollTop=99999;
                document.getElementById('userInput').focus();
            });
        });
    }

    function _getRelatedNotices(title){
        var _stop=new Set(['안내','관련','이용','서비스','기능','방법','내용','경우','완료','제공','해당','통해','위한','대한']);
        var notices=allNotices[currentMode]||{};
        var raw=title.toLowerCase().replace(/[\/\(\)\[\]\.,·\-_:]/g,' ').split(/\s+/).filter(function(w){ return w.length>=2&&!/^\d+$/.test(w); });
        var words=raw.filter(function(w){ return !_stop.has(w); });
        if(!words.length) words=raw;
        if(!words.length) return [];
        // 핵심어: 4자 이상 단어 + 인접 단어 bigram
        var primary=[];
        words.forEach(function(w,i){
            if(w.length>=4) primary.push(w);
            if(i<words.length-1) primary.push(w+words[i+1]);
        });
        // 4자 이상 단어가 없으면 짧은 단어 전체를 primary로 사용 (롤백 등 2글자 특수 용어 처리)
        if(!primary.length) primary = words.slice();
        var results=[];
        Object.keys(notices).forEach(function(id){
            try{
                var n=notices[id];
                if(!n||typeof n!=='object') return;
                var hay=((n.title||'')+' '+(n.content||'')).toLowerCase();
                if(primary.some(function(w){ return hay.indexOf(w)>=0; })){
                    results.push({id:id, title:n.title||'', date:n.date||'', _ts:_parseDateNum(n)});
                }
            }catch(e){}
        });
        results.sort(function(a,b){ return b._ts - a._ts; });
        return results.slice(0,5);
    }
    function _appendRelatedNotices(title, botD){
        var related=_getRelatedNotices(title);
        if(!related.length) return;
        var wrap=document.createElement('div');
        wrap.style.cssText='margin-top:12px;border-top:1.5px solid var(--border-ui);padding-top:10px;display:block;';
        var h='<div style="font-size:10px;font-weight:900;opacity:0.45;text-transform:uppercase;letter-spacing:0.12em;margin-bottom:8px;">📢 관련 공지 ('+related.length+'건 · 최신순)</div>'
            +'<div style="display:flex;flex-direction:column;gap:5px;">';
        related.forEach(function(n){
            h+='<button class="notice-ref-btn" onclick="event.stopPropagation();openViewModal(\''+n.id+'\')">'
                +'<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+escHtml(n.title)+'</span>'
                +'<span style="font-size:10px;opacity:0.55;flex-shrink:0;margin-left:8px;">'+escHtml(n.date)+'</span>'
                +'</button>';
        });
        h+='</div>';
        wrap.innerHTML=h;
        botD.appendChild(wrap);
        setTimeout(function(){ document.getElementById('chatBox').scrollTop=99999; }, 50);
    }

    function escHtml(t){
        if(t==null)return'';
        return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    /* ── 매뉴얼 탭: QNA 생성 버튼 ── */
    function _appendTemplateBtn(title, botD){
        var btn=document.createElement('button');
        btn.textContent='❓ QNA 생성';
        btn.style.cssText='margin-top:8px;width:100%;padding:9px 0;border-radius:8px;border:2px solid var(--active-focus-color);color:var(--active-focus-color);background:none;cursor:pointer;font-size:11px;font-weight:900;transition:0.15s;';
        btn.addEventListener('mouseenter',function(){if(!btn.disabled){btn.style.background='var(--active-focus-color)';btn.style.color='#fff';}});
        btn.addEventListener('mouseleave',function(){if(!btn.disabled){btn.style.background='none';btn.style.color='var(--active-focus-color)';}});
        btn.addEventListener('click',function(){
            if(btn.disabled)return;
            btn.disabled=true; btn.style.opacity='0.5'; btn.textContent='생성 중...';
            _reqTemplate(title);
        });
        botD.appendChild(btn);
    }
    function _reqTemplate(title){
        if(!CLAUDE_API_KEY){alert('⚠️ Claude API 키를 먼저 설정해주세요.');return;}
        var idx=currentMode==='bay'?BAY_MANUAL_INDEX:MANUAL_INDEX;
        var val=idx[title]||'';
        if(typeof val==='object') val=val.text||val.content||'';
        addMsg('❓ QNA 생성: '+title,'user');
        var lid='L'+Date.now();
        addMsg('<span style="opacity:0.5;font-style:italic;">분석 중...</span>','bot',lid);
        var botEl=document.getElementById(lid); if(!botEl)return;
        var botD=botEl.querySelector('.bubble');
        _generateQnA(title,val,title,botEl,botD);
    }

    /* ── 메모 패드 (플로팅 스티커) ── */
    var MEMO_KEY_PFX='imi_memos_';
    var _memos=[];
    var _mfZTop=4000;
    var _memoSaveTimer=null;

    function _memoFbPath(){
        if(!_currentUser||!_currentUser.name) return null;
        return 'user_memos/'+_ukey(_currentUser.name)+'/'+currentMode;
    }
    var MCOL=[
        {id:'y',bg:'#fef9c3',bar:'#fde047',text:'#713f12'},
        {id:'b',bg:'#dbeafe',bar:'#93c5fd',text:'#1e3a5f'},
        {id:'g',bg:'#dcfce7',bar:'#86efac',text:'#14532d'},
        {id:'p',bg:'#fce7f3',bar:'#f9a8d4',text:'#831843'}
    ];
    function mcol(cid){return MCOL.find(function(c){return c.id===cid;})||MCOL[0];}

    function loadMemos(){
        var path=_memoFbPath();
        if(!path){ _memos=[]; renderDockedMemos(); return; }
        db.ref(path).once('value',function(snap){
            var data=snap.val();
            if(data&&typeof data==='object'){
                _memos=Object.values(data);
            } else {
                _memos=[];
                // 구버전 localStorage에서 Firebase로 1회 마이그레이션
                try{
                    var legacyKey=MEMO_KEY_PFX+currentMode+'_v1';
                    var old=JSON.parse(localStorage.getItem(legacyKey));
                    if(old&&old.length){ _memos=old; saveMemos(); }
                }catch(e){}
            }
            renderDockedMemos();
        });
    }
    function saveMemos(){
        var path=_memoFbPath();
        if(!path) return;
        clearTimeout(_memoSaveTimer);
        _memoSaveTimer=setTimeout(function(){
            var obj={};
            _memos.forEach(function(m){ obj[m.id]=m; });
            db.ref(path).set(obj);
        },600);
    }
    function unloadMemos(){
        _memos.forEach(function(m){var el=document.getElementById('mf_'+m.id);if(el)el.remove();});
        _memos=[];
    }

    function memoSorted(){
        return _memos.slice().sort(function(a,b){
            if(a.pinned&&!b.pinned)return -1;
            if(!a.pinned&&b.pinned)return 1;
            return (b.lastModified||b.id)-(a.lastModified||a.id);
        });
    }

    function addMemo(){
        var id=Date.now();
        var cx=Math.round(window.innerWidth/2-120), cy=Math.round(window.innerHeight/2-110);
        _memos.unshift({id:id,title:'새 메모',content:'',color:'y',x:cx,y:cy,w:240,h:190,pinned:false,lastModified:id,fontSize:12});
        saveMemos(); renderDockedMemos(); openMemoFloat(id);
    }

    function setMemoFontSize(id, delta){
        var m=_memos.find(function(m){return m.id===id;}); if(!m)return;
        m.fontSize=Math.min(20,Math.max(9,(m.fontSize||12)+delta));
        var ta=document.getElementById('mfta_'+id);
        if(ta)ta.style.fontSize=m.fontSize+'px';
        saveMemos();
    }

    function deleteMemo(id){
        if(!confirm('메모를 삭제할까요?'))return;
        var el=document.getElementById('mf_'+id); if(el)el.remove();
        _memos=_memos.filter(function(m){return m.id!==id;});
        saveMemos(); renderDockedMemos();
        if(document.getElementById('allMemosModal')&&!document.getElementById('allMemosModal').classList.contains('hidden'))renderAllMemos();
    }

    function toggleMemoPin(id){
        var m=_memos.find(function(m){return m.id===id;}); if(!m)return;
        m.pinned=!m.pinned; saveMemos(); renderDockedMemos();
        if(document.getElementById('allMemosModal')&&!document.getElementById('allMemosModal').classList.contains('hidden'))renderAllMemos();
    }

    function openMemoFloat(id){
        var m=_memos.find(function(m){return m.id===id;}); if(!m)return;
        var existing=document.getElementById('mf_'+id);
        if(existing){existing.style.display='flex';mfFront(id);return;}
        var c=mcol(m.color);
        var el=document.createElement('div');
        el.className='memo-float'; el.id='mf_'+id;
        el.style.cssText='left:'+m.x+'px;top:'+m.y+'px;width:'+(m.w||240)+'px;height:'+(m.h||190)+'px;background:'+c.bg+';color:'+c.text+';';
        var dots=MCOL.map(function(c2){
            var act=m.color===c2.id?'transform:scale(1.3);box-shadow:0 0 0 2px rgba(0,0,0,0.35);':'';
            return '<div class="memo-float-cdot" style="background:'+c2.bar+';'+act+'" onclick="setMemoColor('+id+',\''+c2.id+'\')" title="색상"></div>';
        }).join('');
        el.innerHTML=
            '<div class="memo-float-bar" id="mfbar_'+id+'" style="background:'+c.bar+';">'+
            dots+
            '<span style="flex:1;"></span>'+
            '<button class="memo-float-fbtn" onclick="setMemoFontSize('+id+',-1)" title="글씨 작게" style="font-size:9px;border-radius:5px;">A-</button>'+
            '<button class="memo-float-fbtn" onclick="setMemoFontSize('+id+',1)" title="글씨 크게" style="font-size:9px;border-radius:5px;">A+</button>'+
            '<button class="memo-float-fbtn" onclick="addMemo()" title="새 메모 추가">+</button>'+
            '<button class="memo-float-fbtn" onclick="closeMemoFloat('+id+')" title="닫기 (왼쪽으로 최소화)">×</button>'+
            '</div>'+
            '<div class="memo-float-body">'+
            '<textarea class="memo-float-ta" id="mfta_'+id+'" placeholder="첫째 줄이 제목이 됩니다..." style="color:'+c.text+';font-size:'+(m.fontSize||12)+'px;" oninput="setMemoContent('+id+',this.value)">'+escHtml(m.content)+'</textarea>'+
            '</div>'+
            '<div class="memo-float-resize" title="크기 조절" id="mfrsz_'+id+'">⊿</div>';
        document.body.appendChild(el);
        mfFront(id);
        mfDraggable(el,document.getElementById('mfbar_'+id),id);
        mfResizable(el,document.getElementById('mfrsz_'+id),id);
        el.addEventListener('mousedown',function(){mfFront(id);});
        setTimeout(function(){var ta=document.getElementById('mfta_'+id);if(ta)ta.focus();},30);
        renderDockedMemos();
    }

    function closeMemoFloat(id){
        var el=document.getElementById('mf_'+id); if(!el)return;
        var m=_memos.find(function(m){return m.id===id;});
        if(m){m.x=el.offsetLeft;m.y=el.offsetTop;m.w=el.offsetWidth;m.h=el.offsetHeight;saveMemos();}
        el.style.display='none';
        renderDockedMemos();
    }

    function mfFront(id){
        _mfZTop++;
        var el=document.getElementById('mf_'+id); if(el)el.style.zIndex=_mfZTop;
    }

    function setMemoContent(id,val){
        var m=_memos.find(function(m){return m.id===id;}); if(!m)return;
        m.content=val;
        m.title=val.split('\n')[0].trim()||'새 메모';
        m.lastModified=Date.now();
        saveMemos(); renderDockedMemos();
    }
    function setMemoColor(id,cid){
        var m=_memos.find(function(m){return m.id===id;}); if(!m)return;
        m.color=cid; saveMemos();
        var el=document.getElementById('mf_'+id); if(el)el.remove();
        openMemoFloat(id);
    }

    function mfDraggable(el,bar,id){
        var drag=false,sx,sy,sl,st;
        bar.addEventListener('mousedown',function(e){
            if(e.target.tagName==='BUTTON'||e.target.classList.contains('memo-float-cdot'))return;
            drag=true; sx=e.clientX; sy=e.clientY; sl=el.offsetLeft; st=el.offsetTop;
            el.style.transition='none'; e.preventDefault();
        });
        document.addEventListener('mousemove',function(e){
            if(!drag)return;
            var nx=Math.max(0,Math.min(sl+e.clientX-sx,window.innerWidth-el.offsetWidth));
            var ny=Math.max(0,Math.min(st+e.clientY-sy,window.innerHeight-40));
            el.style.left=nx+'px'; el.style.top=ny+'px';
        });
        document.addEventListener('mouseup',function(){
            if(!drag)return; drag=false; el.style.transition='';
            var m=_memos.find(function(m){return m.id===id;});
            if(m){m.x=el.offsetLeft;m.y=el.offsetTop;saveMemos();}
        });
    }

    function mfResizable(el,handle,id){
        var rsz=false,sx,sy,sw,sh;
        handle.addEventListener('mousedown',function(e){
            rsz=true; sx=e.clientX; sy=e.clientY; sw=el.offsetWidth; sh=el.offsetHeight;
            e.preventDefault(); e.stopPropagation();
        });
        document.addEventListener('mousemove',function(e){
            if(!rsz)return;
            el.style.width=Math.max(180,sw+e.clientX-sx)+'px';
            el.style.height=Math.max(140,sh+e.clientY-sy)+'px';
        });
        document.addEventListener('mouseup',function(){
            if(!rsz)return; rsz=false;
            var m=_memos.find(function(m){return m.id===id;});
            if(m){m.w=el.offsetWidth;m.h=el.offsetHeight;saveMemos();}
        });
    }

    function renderDockedMemos(){
        var list=document.getElementById('memoList'); if(!list)return;
        var btnWrap=document.getElementById('allMemosBtnWrap');
        if(btnWrap)btnWrap.style.display='';
        if(!_memos.length){
            list.innerHTML='<div class="memo-empty">메모 없음<br>+ 눌러서 추가</div>';
            return;
        }
        var sorted=memoSorted();
        var visible=sorted.slice(0,15);
        list.innerHTML='';
        visible.forEach(function(m){
            var c=mcol(m.color);
            var floatEl=document.getElementById('mf_'+m.id);
            var isOpen=floatEl&&floatEl.style.display!=='none';
            var div=document.createElement('div');
            div.className='memo-dock';
            if(isOpen){
                div.style.borderColor=c.bar;
                div.style.background=c.bg;
            } else if(m.pinned){
                div.style.borderColor=c.bar;
            }
            div.onclick=function(){openMemoFloat(m.id);};
            div.innerHTML=
                '<span class="memo-dock-btn" onclick="event.stopPropagation();toggleMemoPin('+m.id+')" title="'+(m.pinned?'고정 해제':'고정')+'" style="'+(m.pinned?'opacity:1;color:var(--active-focus-color);':'')+'">📌</span>'+
                '<div class="memo-dock-dot" style="background:'+c.bar+'"></div>'+
                '<span class="memo-dock-title" style="color:'+(isOpen?c.text:'')+';">'+escHtml(m.title)+'</span>'+
                '<span class="memo-dock-btn" onclick="event.stopPropagation();deleteMemo('+m.id+')" title="삭제" style="color:#f87171;">×</span>';
            list.appendChild(div);
        });
        if(btnWrap)btnWrap.classList.remove('hidden');
    }

    function openAllMemosModal(){
        document.getElementById('allMemosModal').classList.remove('hidden');
        document.getElementById('allMemoSearch').value='';
        var sa=document.getElementById('memoSelectAll'); if(sa)sa.checked=false;
        renderAllMemos();
    }
    function closeAllMemosModal(){
        document.getElementById('allMemosModal').classList.add('hidden');
    }
    function memoToggleAll(checked){
        document.querySelectorAll('.memo-chk').forEach(function(cb){cb.checked=checked;});
    }
    function memoDeleteSelected(){
        var ids=[]; document.querySelectorAll('.memo-chk:checked').forEach(function(cb){ids.push(Number(cb.dataset.id));});
        if(!ids.length){alert('선택된 메모가 없습니다.');return;}
        if(!confirm(ids.length+'개 메모를 삭제할까요?'))return;
        ids.forEach(function(id){var el=document.getElementById('mf_'+id);if(el)el.remove();});
        _memos=_memos.filter(function(m){return ids.indexOf(m.id)<0;});
        saveMemos(); renderDockedMemos(); renderAllMemos();
        var sa=document.getElementById('memoSelectAll'); if(sa)sa.checked=false;
    }
    function memoDeleteAll(){
        if(!_memos.length){alert('삭제할 메모가 없습니다.');return;}
        if(!confirm('전체 메모 '+_memos.length+'개를 모두 삭제할까요?'))return;
        _memos.forEach(function(m){var el=document.getElementById('mf_'+m.id);if(el)el.remove();});
        _memos=[]; saveMemos(); renderDockedMemos();
        closeAllMemosModal();
    }
    function renderAllMemos(){
        var list=document.getElementById('allMemosList');
        var cnt=document.getElementById('allMemoCount');
        var search=(document.getElementById('allMemoSearch').value||'').toLowerCase().trim();
        var sorted=memoSorted();
        var filtered=sorted.filter(function(m){
            if(!search)return true;
            return m.title.toLowerCase().indexOf(search)>=0||(m.content||'').toLowerCase().indexOf(search)>=0;
        });
        if(cnt)cnt.innerText=filtered.length+'개';
        list.innerHTML='';
        if(!filtered.length){list.innerHTML='<div style="text-align:center;opacity:0.3;padding:30px;font-size:13px;">검색 결과 없음</div>';return;}
        filtered.forEach(function(m){
            var c=mcol(m.color);
            var floatEl=document.getElementById('mf_'+m.id);
            var isOpen=floatEl&&floatEl.style.display!=='none';
            var preview=(m.content||'').split('\n').slice(1).join(' ').trim().slice(0,80);
            var div=document.createElement('div');
            div.style.cssText='border:2px solid '+(isOpen?c.bar:'var(--border-ui)')+';border-radius:10px;padding:10px 12px;transition:0.15s;background:var(--bg-chat);display:flex;gap:10px;align-items:flex-start;';
            div.onmouseover=function(){this.style.borderColor=c.bar;};
            div.onmouseout=function(){this.style.borderColor=isOpen?c.bar:'var(--border-ui)';};
            var chk=document.createElement('input');
            chk.type='checkbox'; chk.className='memo-chk'; chk.dataset.id=m.id;
            chk.style.cssText='flex-shrink:0;margin-top:3px;cursor:pointer;';
            chk.onclick=function(e){e.stopPropagation();};
            div.appendChild(chk);
            var inner=document.createElement('div');
            inner.style.cssText='flex:1;min-width:0;cursor:pointer;';
            inner.onclick=function(){closeAllMemosModal();openMemoFloat(m.id);};
            inner.innerHTML=
                '<div style="display:flex;align-items:center;gap:6px;">'+
                '<div style="width:9px;height:9px;border-radius:50%;background:'+c.bar+';flex-shrink:0;"></div>'+
                '<div style="font-size:12px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">'+(m.pinned?'📌 ':'')+escHtml(m.title)+'</div>'+
                '</div>'+
                (preview?'<div style="font-size:11px;opacity:0.6;margin-top:3px;line-height:1.5;padding-left:15px;">'+escHtml(preview)+'</div>':'');
            div.appendChild(inner);
            var btns=document.createElement('div');
            btns.style.cssText='display:flex;flex-direction:column;gap:4px;flex-shrink:0;';
            btns.innerHTML=
                '<span onclick="toggleMemoPin('+m.id+')" title="'+(m.pinned?'고정 해제':'고정')+'" style="font-size:11px;cursor:pointer;opacity:'+(m.pinned?'1':'0.35')+';padding:2px 4px;border-radius:4px;transition:0.12s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity='+(m.pinned?'1':'0.35')+'">📌</span>'+
                '<span onclick="deleteMemo('+m.id+')" title="삭제" style="font-size:13px;cursor:pointer;opacity:0.35;color:#f87171;padding:2px 4px;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.35">×</span>';
            div.appendChild(btns);
            list.appendChild(div);
        });
    }

    /* ── 템플릿 관리 ── */
    var _tmplEditId = null;
    function openTmplMgr(){
        document.getElementById('tmplModeLabel').innerText = currentMode==='mania'?'(매니아)':'(베이)';
        renderTmplList();
        closeTmplForm();
        document.getElementById('tmplMgrModal').classList.remove('hidden');
    }
    function closeTmplMgr(){ document.getElementById('tmplMgrModal').classList.add('hidden'); }
    function renderTmplList(){
        var list = document.getElementById('tmplList');
        var tmpls = allTemplates[currentMode]||{};
        var keys = Object.keys(tmpls);
        if(!keys.length){
            list.innerHTML='<div style="opacity:0.4;font-size:12px;padding:20px;text-align:center;">등록된 템플릿이 없습니다.<br>+ 새 템플릿 버튼으로 추가하세요.</div>';
            return;
        }
        list.innerHTML='';
        keys.forEach(function(id){
            var t=tmpls[id];
            var el=document.createElement('div');
            el.style.cssText='background:var(--bg-chat);border:1.5px solid var(--border-ui);border-radius:10px;padding:10px 12px;';
            var kws=(t.keywords||'').split(',').map(function(k){return k.trim();}).filter(Boolean)
                .map(function(k){return '<span style="display:inline-block;background:var(--active-focus-color);color:#fff;font-size:10px;font-weight:900;border-radius:5px;padding:1px 7px;margin:0 2px 2px 0;">'+escHtml(k)+'</span>';}).join('');
            el.innerHTML='<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">'
                +'<div style="flex:1;">'
                +'<div style="font-size:12px;font-weight:900;margin-bottom:4px;">'+escHtml(t.title||'제목없음')+'</div>'
                +'<div style="margin-bottom:4px;">'+kws+'</div>'
                +(t.path?'<div style="font-size:10px;opacity:0.5;margin-bottom:3px;">📍 '+escHtml(t.path)+'</div>':'')
                +'<div style="font-size:10.5px;opacity:0.65;white-space:pre-wrap;">'+escHtml((t.template||'').slice(0,80))+(t.template&&t.template.length>80?'...':'')+'</div>'
                +'</div>'
                +'<div style="display:flex;gap:4px;flex-shrink:0;">'
                +'<button onclick="openTmplForm(\''+id+'\')" style="font-size:10px;font-weight:900;padding:3px 9px;border-radius:6px;border:1.5px solid var(--border-ui);">수정</button>'
                +'<button onclick="deleteTmpl(\''+id+'\')" style="font-size:10px;font-weight:900;padding:3px 9px;border-radius:6px;border:1.5px solid #f87171;color:#f87171;">삭제</button>'
                +'</div></div>';
            list.appendChild(el);
        });
    }
    function openTmplForm(id){
        _tmplEditId=id;
        var form=document.getElementById('tmplForm');
        form.classList.remove('hidden');
        document.getElementById('tmplFormTitle').innerText=id?'템플릿 수정':'새 템플릿';
        if(id){
            var t=(allTemplates[currentMode]||{})[id]||{};
            document.getElementById('tmplFTitle').value=t.title||'';
            document.getElementById('tmplFKeywords').value=t.keywords||'';
            document.getElementById('tmplFPath').value=t.path||'';
            document.getElementById('tmplFContent').value=t.template||'';
        } else {
            document.getElementById('tmplFTitle').value='';
            document.getElementById('tmplFKeywords').value='';
            document.getElementById('tmplFPath').value='';
            document.getElementById('tmplFContent').value='';
        }
    }
    function closeTmplForm(){
        _tmplEditId=null;
        document.getElementById('tmplForm').classList.add('hidden');
    }
    function saveTmpl(){
        var title=document.getElementById('tmplFTitle').value.trim();
        var keywords=document.getElementById('tmplFKeywords').value.trim();
        var path=document.getElementById('tmplFPath').value.trim();
        var template=document.getElementById('tmplFContent').value.trim();
        if(!keywords||!template){alert('키워드와 템플릿 내용은 필수입니다.');return;}
        var key=_tmplEditId||('t'+Date.now());
        db.ref('tmpl_'+currentMode).child(key).set({title:title,keywords:keywords,path:path,template:template},function(){
            closeTmplForm();
            renderTmplList();
        });
    }
    function deleteTmpl(id){
        if(!confirm('이 템플릿을 삭제할까요?'))return;
        db.ref('tmpl_'+currentMode).child(id).remove(function(){ renderTmplList(); });
    }
    function findMatchingTmpl(q){
        var tmpls=allTemplates[currentMode]||{};
        var qLower=q.toLowerCase();
        var found=null;
        Object.values(tmpls).some(function(t){
            var kws=(t.keywords||'').split(',').map(function(k){return k.trim().toLowerCase();}).filter(Boolean);
            if(kws.some(function(k){return qLower.indexOf(k)>=0;})){found=t;return true;}
        });
        return found;
    }

    async function updateAssistPanel(q) {
        var pathEl = document.getElementById('assistPath');
        var tmplEl = document.getElementById('assistTemplate');
        if (!pathEl || !tmplEl) return;
        var btn = document.getElementById('copyTemplateBtn');
        if (btn) { btn.className = 'copy-btn'; btn.innerText = '📋 템플릿 복사'; }

        // 등록된 템플릿 키워드 매칭 우선
        var matched = findMatchingTmpl(q);
        if (matched) {
            if (matched.path && matched.path.trim()) {
                var steps = matched.path.split('>').map(function(s){return s.trim();});
                pathEl.innerHTML = steps.map(function(s,i){
                    return '<span class="path-step">'+escHtml(s)+'</span>'+(i<steps.length-1?'<span class="path-arrow">›</span>':'');
                }).join('');
            } else {
                pathEl.innerHTML = '<span class="assist-placeholder">경로 정보 없음</span>';
            }
            tmplEl.innerText = matched.template || '';
            return;
        }

        pathEl.innerHTML = '<span class="assist-loading">⏳ 분석 중...</span>';
        tmplEl.innerHTML = '<span class="assist-loading">⏳ 생성 중...</span>';
        if (!CLAUDE_API_KEY) {
            pathEl.innerHTML='<span class="assist-placeholder">-</span>';
            tmplEl.innerHTML='<span class="assist-placeholder">등록된 템플릿 없음</span>';
            return;
        }
        /* 현재 모드에 맞는 매뉴얼에서 관련 항목 검색 */
        var _curIdx = currentMode==='bay' ? BAY_MANUAL_INDEX : MANUAL_INDEX;
        /* 검색어 → 정확한 매뉴얼 키 강제 매핑 (n-gram 오탐 방지) */
        var _searchAliases = {
            '무통장':'전용계좌','무통장입금':'전용계좌','가상계좌':'전용계좌','전용계좌입금':'전용계좌'
        };
        var _qLow = q.toLowerCase();
        /* 별칭 우선 체크 - 쿼리에 별칭 단어가 포함되면 해당 키 직접 반환 */
        var _aliasKey = null;
        Object.keys(_searchAliases).forEach(function(alias){
            if(!_aliasKey && _qLow.indexOf(alias)>=0 && _curIdx[_searchAliases[alias]]){
                _aliasKey = _searchAliases[alias];
            }
        });
        if(_aliasKey){
            var _aliasVal = _curIdx[_aliasKey];
            var _manCtxA = '\n\n[참고 매뉴얼 항목: '+_aliasKey+']\n'+_aliasVal.substring(0,400);
            var sysA = '당신은 아이템매니아 고객센터 상담사입니다. 고객에게 보낼 짧은 안내 문구를 작성합니다.\n규칙: ① 반드시 JSON만 반환 ② template은 2~3문장 이내 간결하게 ③ 절차/단계 나열 금지 ④ 핵심만 안내 ⑤ [참고 매뉴얼]에 근거하여 작성\n{"path":"메뉴 경로(해당없으면 빈문자열)","template":"2~3문장 이내 고객 안내 문구(해당없으면 빈문자열)"}'+_manCtxA;
            var stepsA = _aliasKey.split('>').map(function(s){return s.trim();});
            pathEl.innerHTML = stepsA.map(function(s,i){return '<span class="path-step">'+escHtml(s)+'</span>'+(i<stepsA.length-1?'<span class="path-arrow">›</span>':'');}).join('');
            try {
                var resA = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':CLAUDE_API_KEY,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:350,system:sysA,messages:[{role:'user',content:q}]})});
                if(!resA.ok) throw new Error('API err');
                var dataA = await resA.json();
                var textA = dataA.content[0].text.trim();
                var jsonA = textA.match(/\{[\s\S]*\}/);
                if(!jsonA) throw new Error('no json');
                var parsedA = JSON.parse(jsonA[0]);
                if(parsedA.path&&parsedA.path.trim()){var stA=parsedA.path.split('>').map(function(s){return s.trim();});pathEl.innerHTML=stA.map(function(s,i){return '<span class="path-step">'+escHtml(s)+'</span>'+(i<stA.length-1?'<span class="path-arrow">›</span>':'');}).join('');}
                else{pathEl.innerHTML='<span class="assist-placeholder">경로 정보 없음</span>';}
                if(parsedA.template&&parsedA.template.trim()){tmplEl.innerText=parsedA.template;}
                else{tmplEl.innerHTML='<span class="assist-placeholder">템플릿 없음</span>';}
            } catch(eA){pathEl.innerHTML='<span class="assist-placeholder">-</span>';tmplEl.innerHTML='<span class="assist-placeholder">-</span>';}
            return;
        }
        /* 지시어 불용어(stop-word) - 검색 키워드에서 제외 */
        var _stopSet = new Set(['템플릿','작성','부탁','부탁해','부탁해요','써줘','써주세요','알려줘','알려주세요','방법','어떻게','문의','처리','확인','내용','설명','관련','관해서','대해서','있나요','되나요','해주세요','해줘','이유가','뭐야','뭔가요','알고싶어요','안내','해','요','줘','좀','것','거']);
        var _kwMap = {};
        _qLow.split(/\s+/).forEach(function(w){
            /* 불용어 제거 */
            if(w.length<2 || _stopSet.has(w)) return;
            /* 단어 전체 + 2~6글자 부분 문자열 추가 */
            _kwMap[w] = w.length;
            for(var l=2; l<=Math.min(w.length,6); l++){
                for(var i=0; i<=w.length-l; i++){
                    var sub=w.substring(i,i+l);
                    if(_stopSet.has(sub)) continue;
                    if(!_kwMap[sub]||_kwMap[sub]<l) _kwMap[sub]=l;
                }
            }
        });
        var _bestKey=null, _bestVal=null, _bestScore=0;
        Object.keys(_curIdx).forEach(function(k){
            var v=_curIdx[k], kLow=k.toLowerCase(), vLow=v.toLowerCase(), sc=0;
            Object.keys(_kwMap).forEach(function(kw){
                if(kw.length<2) return;
                var wt=_kwMap[kw];
                if(kLow.indexOf(kw)>=0) sc+=wt*5; /* 제목 매칭: 5배 가중치 */
                else if(vLow.indexOf(kw)>=0) sc+=wt;
            });
            if(sc>_bestScore){_bestScore=sc;_bestKey=k;_bestVal=v;}
        });
        /* 관련 항목 없으면 AI 호출하지 않음 (훈련데이터 기반 허위 답변 방지) */
        if(!_bestKey || _bestScore<4){
            pathEl.innerHTML='<span class="assist-placeholder">경로 정보 없음</span>';
            tmplEl.innerHTML='<span style="font-size:11px;opacity:0.6;line-height:1.6;">매뉴얼에서 관련 항목을 찾지 못했습니다.<br>키워드를 바꿔서 다시 시도하거나 직접 매뉴얼을 검색해 주세요.</span>';
            return;
        }
        var _manCtx = '\n\n[참고 매뉴얼 항목: '+_bestKey+']\n'+_bestVal.substring(0,400);
        var sys = '당신은 아이템매니아 고객센터 상담사입니다. 고객에게 보낼 짧은 안내 문구를 작성합니다.\n규칙: ① 반드시 JSON만 반환 ② template은 2~3문장 이내 간결하게 ③ 절차/단계 나열 금지 ④ 핵심만 안내 ⑤ [참고 매뉴얼]에 근거하여 작성\n{"path":"메뉴 경로(해당없으면 빈문자열)","template":"2~3문장 이내 고객 안내 문구(해당없으면 빈문자열)"}'+_manCtx;
        try {
            var res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-api-key': CLAUDE_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
                body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 350, system: sys, messages: [{role: 'user', content: q}] })
            });
            if (!res.ok) throw new Error('API err');
            var data = await res.json();
            var text = data.content[0].text.trim();
            var jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('no json');
            var parsed = JSON.parse(jsonMatch[0]);
            if (parsed.path && parsed.path.trim()) {
                var steps = parsed.path.split('>').map(function(s){return s.trim();});
                pathEl.innerHTML = steps.map(function(s,i){
                    return '<span class="path-step">'+escHtml(s)+'</span>'+(i<steps.length-1?'<span class="path-arrow">›</span>':'');
                }).join('');
            } else {
                pathEl.innerHTML = '<span class="assist-placeholder">경로 정보 없음</span>';
            }
            if (parsed.template && parsed.template.trim()) {
                tmplEl.innerText = parsed.template;
            } else {
                tmplEl.innerHTML = '<span class="assist-placeholder">템플릿 없음</span>';
            }
        } catch(e) {
            pathEl.innerHTML = '<span class="assist-placeholder">-</span>';
            tmplEl.innerHTML = '<span class="assist-placeholder">-</span>';
        }
    }
    function copyAssistTemplate() {
        var tmplEl = document.getElementById('assistTemplate');
        var text = tmplEl ? tmplEl.innerText : '';
        if (!text || text === '템플릿 없음' || text === '-' || text === '질문하면 표시됩니다') return;
        navigator.clipboard.writeText(text).then(function() {
            var btn = document.getElementById('copyTemplateBtn');
            if (!btn) return;
            btn.className = 'copy-btn copied';
            btn.innerText = '✅ 복사됨!';
            setTimeout(function(){ btn.className='copy-btn'; btn.innerText='📋 템플릿 복사'; }, 2000);
        });
    }
    var _tmplViewText='';
    function openTmplViewModal(){
        var tmplEl=document.getElementById('assistTemplate');
        var text=tmplEl?tmplEl.innerText:'';
        if(!text||text==='질문하면 표시됩니다')return;
        _tmplViewText=text;
        document.getElementById('tmplViewContent').textContent=text;
        document.getElementById('tmplViewModal').classList.remove('hidden');
    }
    function copyTmplViewContent(){
        if(!_tmplViewText)return;
        navigator.clipboard.writeText(_tmplViewText).then(function(){
            var btn=document.getElementById('tmplViewCopyBtn');
            if(!btn)return;
            btn.textContent='✅ 복사됨!';
            setTimeout(function(){btn.textContent='📋 템플릿 복사';},2000);
        });
    }
    async function askClaude(q,botD){
        if(!CLAUDE_API_KEY){
            botD.innerHTML='<span style="opacity:0.6">📋 매뉴얼에서 일치하는 항목을 찾지 못했습니다.<br>AI 답변은 API 키 설정 후 이용 가능합니다. (<span style="cursor:pointer;text-decoration:underline" onclick="checkAppStatus()">키 설정</span>)</span>';
            document.getElementById('chatBox').scrollTop=99999;
            return;
        }
        var sys="\uC5C5\uBB34 \uB9E4\uB274\uC5BC \uB3C4\uC6B0\uBBF8\uC785\uB2C8\uB2E4. \uB9E4\uB274\uC5BC\uC5D0 \uC5C6\uC73C\uBA74 '\uD83D\uDCED \uB9E4\uB274\uC5BC\uC5D0 \uC5C6\uB294 \uB0B4\uC6A9\uC785\uB2C8\uB2E4.' \uB77C\uACE0\uB9CC \uB2F5\uD558\uC138\uC694.";
        try{
            var res=await fetch("https://api.anthropic.com/v1/messages",{
                method:"POST",
                headers:{
                    "Content-Type":"application/json",
                    "x-api-key":CLAUDE_API_KEY,
                    "anthropic-version":"2023-06-01",
                    "anthropic-dangerous-direct-browser-access":"true"
                },
                body:JSON.stringify({
                    model:"claude-haiku-4-5-20251001",
                    max_tokens:1000,
                    system:sys,
                    messages:[{role:"user",content:q}]
                })
            });
            if(!res.ok){
                var e=await res.json();
                botD.innerHTML="\u26A0\uFE0F \uC624\uB958: "+(e.error&&e.error.message?e.error.message:res.status);
                return;
            }
            var data=await res.json();
            botD.innerHTML=marked.parse(data.content[0].text);
        }catch(e){
            botD.innerHTML="\u26A0\uFE0F \uB124\uD2B8\uC6CC\uD06C \uC624\uB958: "+e.message;
        }
        document.getElementById('chatBox').scrollTop=99999;
    }

    var _mUrls=[], _mIdx=0, _mZoom=1.0, _mTX=0, _mTY=0, _mCropTop=0, _mCropBot=100, _mTotalUrls=0, _mCropPages={};
    var _noticeImgFiles=[], _noticeExistingImgs=[];
    function _genImgKey(){return 'img_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);}
    function _addNoticeImgFile(file){
        var key=_genImgKey();
        var reader=new FileReader();
        reader.onload=function(e){_noticeImgFiles.push({file:file,key:key,dataUrl:e.target.result});_renderNoticeImgPreviews();};
        reader.readAsDataURL(file);
    }
    function _removeNoticeImg(key){
        _noticeImgFiles=_noticeImgFiles.filter(function(x){return x.key!==key;});
        _noticeExistingImgs=_noticeExistingImgs.filter(function(x){return x.key!==key;});
        _renderNoticeImgPreviews();
    }
    function _renderNoticeImgPreviews(){
        var c=document.getElementById('noticeImgPreviews'); if(!c) return;
        c.innerHTML='';
        function makePreview(src,key,isnew){
            var div=document.createElement('div');
            div.style.cssText='position:relative;display:inline-block;';
            var img=document.createElement('img');
            img.src=src;
            img.style.cssText='width:80px;height:60px;object-fit:cover;border-radius:6px;border:2px solid '+(isnew?'var(--active-focus-color)':'var(--border-ui)')+';';
            var btn=document.createElement('button');
            btn.textContent='×';
            btn.style.cssText='position:absolute;top:-6px;right:-6px;background:#ef4444;color:#fff;border:none;border-radius:99px;width:18px;height:18px;font-size:12px;line-height:1;cursor:pointer;font-weight:900;padding:0;';
            btn.addEventListener('click',function(e){e.stopPropagation();_removeNoticeImg(key);});
            div.appendChild(img); div.appendChild(btn); c.appendChild(div);
        }
        _noticeExistingImgs.forEach(function(x){makePreview(x.url,x.key,false);});
        _noticeImgFiles.forEach(function(x){makePreview(x.dataUrl,x.key,true);});
    }
    var _mDrag={active:false,sx:0,sy:0,ox:0,oy:0};
    var _modalCropGen=0;
    var _mMultiView=false;
    var _mPlatform='mania';
    var _mvZoom=1.0, _mvTX=0, _mvTY=0;
    var _mvDrag={active:false,sx:0,sy:0,ox:0,oy:0};
    var _mvDragMoved=false, _mvEventsInit=false;
    var _mvIsPortrait=false;
    var _mvPage=0; // 현재 멀티뷰 페이지 (0-based)
    function _applyMvTransform(){
        var grid=document.querySelector('#imgMvWrap .im-mv-grid');
        if(grid) grid.style.transform='scale('+_mvZoom+') translate('+_mvTX+'px,'+_mvTY+'px)';
    }
    function _initMvEvents(){
        if(_mvEventsInit) return;
        _mvEventsInit=true;
        var wrap=document.getElementById('imgMvWrap');
        // 확대/축소
        wrap.addEventListener('wheel',function(e){
            e.preventDefault();
            var factor=e.deltaY<0?1.13:0.88;
            _mvZoom=Math.max(0.3,Math.min(10,_mvZoom*factor));
            _applyMvTransform();
        },{passive:false});
        // 드래그 팬 (페이지네이션 버튼 클릭은 드래그 제외)
        wrap.addEventListener('pointerdown',function(e){
            if(e.button!==0||e.target.tagName==='BUTTON') return;
            _mvDrag.active=true; _mvDragMoved=false;
            _mvDrag.sx=e.clientX; _mvDrag.sy=e.clientY;
            _mvDrag.ox=_mvTX; _mvDrag.oy=_mvTY;
            wrap.classList.add('mv-dragging');
            wrap.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        wrap.addEventListener('pointermove',function(e){
            if(!_mvDrag.active) return;
            var dx=e.clientX-_mvDrag.sx, dy=e.clientY-_mvDrag.sy;
            if(Math.abs(dx)>4||Math.abs(dy)>4) _mvDragMoved=true;
            _mvTX=_mvDrag.ox+dx/_mvZoom; _mvTY=_mvDrag.oy+dy/_mvZoom;
            _applyMvTransform();
            e.preventDefault();
        });
        wrap.addEventListener('pointerup',function(e){
            _mvDrag.active=false;
            wrap.classList.remove('mv-dragging');
            try{ wrap.releasePointerCapture(e.pointerId); }catch(_){}
        });
        wrap.addEventListener('pointercancel',function(){
            _mvDrag.active=false;
            wrap.classList.remove('mv-dragging');
        });
    }

    function openImgModal(keyOrArr,idx){
        var urls=(typeof keyOrArr==='string')?window[keyOrArr]:keyOrArr;
        if(!urls||!urls.length) return;
        _mUrls=urls; _mIdx=idx||0; _mZoom=1.0; _mTX=0; _mTY=0; _mTotalUrls=urls.length;
        _mMultiView=false;
        _mPlatform=(typeof keyOrArr==='string'?(window[keyOrArr+'_plat']||'mania'):'mania');
        // imgKey에 연결된 크롭 데이터 우선, 없으면 전역 폴백
        var cd=(typeof keyOrArr==='string'&&window[keyOrArr+'_crop'])?window[keyOrArr+'_crop']:(window._currentCropData||{});
        _mCropTop=cd.cropTop||0; _mCropBot=(cd.cropBottom!==undefined)?cd.cropBottom:100;
        _mCropPages=cd.cropPages||{};
        _updateModal();
        document.getElementById('imgModal').classList.add('open');
        document.addEventListener('keydown',_modalKey);
    }
    function _applyTransform(){
        var wrap=document.getElementById('imgModalWrap');
        if(!wrap) return;
        wrap.style.transform='translate('+_mTX+'px,'+_mTY+'px) scale('+_mZoom+')';
        var img=document.getElementById('imgModalImg');
        if(img) img.style.cursor=_mZoom>1?'grab':'default';
    }
    function _updateModal(){
        var singleWrap=document.getElementById('imgModalWrap');
        var mvWrap=document.getElementById('imgMvWrap');
        var mvBtn=document.getElementById('imgMvBtn');
        if(mvBtn) mvBtn.style.display=_mUrls.length>1?'flex':'none';
        if(_mMultiView){
            singleWrap.style.display='none';
            mvWrap.style.display='block';
            document.getElementById('imgModal').style.backdropFilter='none'; // compositor 레이어 해제 → 화질 보호
            // im-nav는 페이지네이션용으로 재활용 — totalPages 계산 후 표시 여부 결정
            document.querySelectorAll('.im-zoom-btn').forEach(function(b){b.style.visibility='';});
            if(mvBtn){mvBtn.style.background='rgba(59,130,246,0.65)';mvBtn.style.borderColor='#3abff8';mvBtn.style.opacity='1';}
            // 현재 이미지 비율로 가로/세로 판별
            var _mvImg=document.getElementById('imgModalImg');
            _mvIsPortrait=_mvImg&&_mvImg.naturalWidth>0&&_mvImg.naturalHeight>_mvImg.naturalWidth;
            // 세로형: 3열×1행(3장/페이지), 가로형: 2열×2행(4장/페이지)
            var gridCols=_mvIsPortrait?3:2;
            var gridRows=_mvIsPortrait?1:2;
            var perPage=gridCols*gridRows;
            var totalPages=Math.ceil(_mUrls.length/perPage);
            // 범위 초과만 클램프 (명시적 페이지 이동 시 자동 리셋 방지)
            _mvPage=Math.max(0,Math.min(_mvPage,totalPages-1));
            var startIdx=_mvPage*perPage;
            var pageUrls=_mUrls.slice(startIdx,startIdx+perPage);
            // 페이지 정보 표시 (하단 중앙 im-info)
            document.getElementById('imgPageInfo').innerText=totalPages>1
                ?(_mvPage+1)+' / '+totalPages+' 페이지 ('+_mUrls.length+'장 전체)'
                :_mUrls.length+'장 전체';
            // im-nav 좌우 화살표: totalPages>1일 때만 표시
            document.querySelectorAll('#imgModal .im-nav').forEach(function(n){
                n.style.display=totalPages>1?'':'none';
            });
            // 그리드 구성
            var badgePos=_mvIsPortrait?'top:8px;':'bottom:8px;';
            var html='<div class="im-mv-grid" style="grid-template-columns:repeat('+gridCols+',1fr);grid-template-rows:repeat('+gridRows+',1fr);">';
            pageUrls.forEach(function(url,i){
                var gi=startIdx+i;
                html+='<div class="im-mv-cell'+(gi===_mIdx?' im-mv-active':'')+'" onclick="_imgMvSelect('+gi+')">'
                    +'<img src="'+url+'" onerror="this.style.display=\'none\'">'
                    +'<div class="im-mv-num-badge" style="'+badgePos+'left:50%;transform:translateX(-50%);">'+(gi+1)+'</div>'
                    +'</div>';
            });
            html+='</div>';
            mvWrap.innerHTML=html;
        } else {
            mvWrap.style.display='none';
            singleWrap.style.display='';
            document.getElementById('imgModal').style.backdropFilter=''; // 단일뷰: backdrop-filter 복원
            document.querySelectorAll('.im-zoom-btn').forEach(function(b){b.style.visibility='';});
            if(mvBtn){mvBtn.style.background='';mvBtn.style.borderColor='';mvBtn.style.opacity='';}
            var img=document.getElementById('imgModalImg');
            img.src=_mUrls[_mIdx];
            _applyTransform();
            document.getElementById('imgPageInfo').innerText=(_mIdx+1)+' / '+_mUrls.length;
            document.querySelectorAll('#imgModal .im-nav').forEach(function(n){
                n.style.display=_mUrls.length>1?'':'none';
            });
            _applyModalCrop();
        }
    }
    function toggleImgMultiView(){
        _mMultiView=!_mMultiView;
        _mZoom=1.0;_mTX=0;_mTY=0;
        if(_mMultiView){
            _mvZoom=1.0;_mvTX=0;_mvTY=0;
            // 진입 시에만 현재 이미지 포함 페이지로 이동
            var _img=document.getElementById('imgModalImg');
            var _isP=_img&&_img.naturalWidth>0&&_img.naturalHeight>_img.naturalWidth;
            var _pp=_isP?3:4;
            _mvPage=Math.floor(_mIdx/_pp);
        }
        _updateModal();
        if(_mMultiView) _initMvEvents();
    }
    function _mvPrevPage(){
        if(_mvPage>0){_mvPage--;_mvZoom=1.0;_mvTX=0;_mvTY=0;_updateModal();}
    }
    function _mvNextPage(){
        var perPage=_mvIsPortrait?3:4;
        var totalPages=Math.ceil(_mUrls.length/perPage);
        if(_mvPage<totalPages-1){_mvPage++;_mvZoom=1.0;_mvTX=0;_mvTY=0;_updateModal();}
    }
    function _imgMvSelect(i){
        if(_mvDragMoved){_mvDragMoved=false;return;}
        _mIdx=i;_mMultiView=false;_mZoom=1.0;_mTX=0;_mTY=0;
        _updateModal();
    }
    function _applyModalCrop(){
        var img=document.getElementById('imgModalImg');
        var wrap=document.getElementById('imgModalWrap');
        if(!img||!wrap) return;
        var gen=++_modalCropGen;
        // 페이지별 크롭 우선, 없으면 backward-compat (첫/마지막 페이지 전역값)
        var _pgCrop=_mCropPages&&_mCropPages[_mIdx];
        var cTop=_pgCrop?(_pgCrop.top||0):((_mIdx===0)?_mCropTop:0);
        var cBot=_pgCrop?(_pgCrop.bot!==undefined?_pgCrop.bot:100):((_mIdx===_mTotalUrls-1)?_mCropBot:100);
        if(cTop<=0&&cBot>=100){ wrap.style.cssText=''; img.style.cssText=''; return; }
        function apply(){
            if(_modalCropGen!==gen) return;
            var natW=img.naturalWidth, natH=img.naturalHeight;
            if(!natW||!natH) return;
            var cropH=natH*(cBot-cTop)/100;
            var aspect=natW/cropH;
            var maxW=window.innerWidth*0.92, maxH=window.innerHeight*0.92;
            var dispW,dispH;
            if(maxW/maxH>=aspect){ dispH=maxH; dispW=maxH*aspect; }
            else{ dispW=maxW; dispH=maxW/aspect; }
            var fullImgH=dispW/natW*natH;
            var offY=fullImgH*cTop/100;
            wrap.style.cssText='position:relative;overflow:hidden;width:'+dispW.toFixed(0)+'px;height:'+dispH.toFixed(0)+'px;border-radius:10px;';
            img.style.cssText='position:absolute;width:'+dispW.toFixed(0)+'px;height:auto;left:0;top:-'+offY.toFixed(0)+'px;max-width:none;max-height:none;';
        }
        if(img.complete&&img.naturalWidth){ apply(); }
        else{ img.addEventListener('load',apply,{once:true}); }
    }
    function moveImg(dir){ _mIdx=(_mIdx+dir+_mUrls.length)%_mUrls.length; _mZoom=1.0; _mTX=0; _mTY=0; _updateModal(); }
    function zoomImg(d){
        if(_mMultiView){
            _mvZoom=Math.max(0.3,Math.min(10,_mvZoom*(d>0?1.2:0.85)));
            _applyMvTransform();
        } else {
            _mZoom=Math.max(0.3,Math.min(4.0,_mZoom+d));
            if(_mZoom<=1.0){_mTX=0;_mTY=0;}
            _applyTransform();
        }
    }
    function closeImgModal(e){
        // 배경 클릭으로는 닫지 않음 — X 버튼 또는 ESC만
        if(e&&e.target&&!e.target.classList.contains('im-close')) return;
        document.getElementById('imgModal').classList.remove('open');
        document.removeEventListener('keydown',_modalKey);
    }
    function _modalKey(e){
        if(e.key==='Escape') document.getElementById('imgModal').classList.remove('open');
        if(e.key==='ArrowLeft') moveImg(-1);
        if(e.key==='ArrowRight') moveImg(1);
    }

    function addMsg(t,r,id){
        var row=document.createElement('div');
        row.className=r==='user'?'flex justify-end w-full':'flex justify-start w-full';
        if(id) row.id=id;
        var b=document.createElement('div');
        b.className=r==='user'?'bubble user-bubble shadow-sm':'bubble bot-bubble shadow-sm';
        b.innerHTML=t;
        row.appendChild(b);
        document.getElementById('chatBox').appendChild(row);
        document.getElementById('chatBox').scrollTop=99999;
    }
    function clearChat(){
        document.getElementById('chatBox').innerHTML="";
        chatHistories[currentMode+'_manual']="";
    }
    function clearCurrentChat(){
        if(_currentChatTab===2){clearCSChat();}else{clearChat();}
    }

    /* ── 고객센터 템플릿 채팅 ── */
    function addCSMsg(html, role, id){
        var box=document.getElementById('csChatBox'); if(!box)return;
        var row=document.createElement('div');
        row.className=role==='user'?'flex justify-end w-full':'flex justify-start w-full';
        if(id)row.id=id;
        var b=document.createElement('div');
        b.className=role==='user'?'bubble user-bubble shadow-sm':'bubble bot-bubble shadow-sm';
        b.innerHTML=html;
        row.appendChild(b);
        box.appendChild(row);
        box.scrollTop=99999;
    }
    function clearCSChat(){
        var box=document.getElementById('csChatBox'); if(box)box.innerHTML='';
        chatHistories[currentMode+'_template']='';
    }
    var _csPendingQ='';
    async function askCS(){
        var inp=document.getElementById('csInput');
        var q=inp.value.trim(); if(!q)return;
        if(!CLAUDE_API_KEY){alert('⚠️ Claude API 키를 먼저 설정해주세요.');return;}
        addCSMsg(escHtml(q),'user');
        inp.value='';
        /* 베이 카테고리 분기 (BAY_CATEGORY_GROUPS 기반) */
        if(currentMode==='bay'){
            var _qLow2=q.toLowerCase().trim();
            var _bg2=BAY_CATEGORY_GROUPS[_qLow2]||BAY_CATEGORY_GROUPS[q.trim()]||null;
            if(!_bg2){
                var _bk2=Object.keys(BAY_CATEGORY_GROUPS).find(function(c){
                    return c===_qLow2||c.indexOf(_qLow2)>=0||_qLow2.indexOf(c)>=0;
                });
                if(_bk2) _bg2=BAY_CATEGORY_GROUPS[_bk2];
            }
            if(_bg2&&_bg2.length){
                var _csLidB='csL'+Date.now();
                addCSMsg('','bot',_csLidB);
                var _csBotDB=document.getElementById(_csLidB).querySelector('.bubble');
                var _bh2='<strong>🏷️ '+escHtml(q)+' 카테고리 전체 ('+_bg2.length+'건):</strong><br><div style="font-size:10px;opacity:0.55;margin-bottom:8px;">항목을 클릭하면 예상 QNA를 바로 생성합니다</div><div class="choice-card-wrap">';
                _bg2.forEach(function(t){_bh2+="<button class='choice-card' onclick='pickCSTemplate(\""+t.replace(/\"/g,'&quot;')+"\",this)'>▶ "+escHtml(t)+"</button>";});
                _bh2+='</div>';
                _csBotDB.innerHTML=_bh2;
                var _csBoxB=document.getElementById('csChatBox'); if(_csBoxB)_csBoxB.scrollTop=99999;
                return;
            }
        }
        /* 매니아 카테고리 분기 (일반/충전/결제/사고) */
        if(currentMode==='mania'&&(q==='일반'||q==='충전'||q==='결제'||q==='사고')){
            var _csLid='csL'+Date.now();
            addCSMsg('','bot',_csLid);
            var _csBotD=document.getElementById(_csLid).querySelector('.bubble');
            var _catLabel2=q==='충전'?'충전':q==='결제'?'결제':q;
            var _titles2=Object.keys(MANUAL_INDEX);
            var _catList2=_titles2.filter(function(t){
                var pr=MANUAL_RANGES[normalizeKey(t)];
                if(!pr) return false;
                var cat=pr.category?pr.category:'일반';
                return cat===q;
            });
            if(_catList2.length){
                var _ch2='<strong>🏷️ '+escHtml(_catLabel2)+' 카테고리 전체 ('+_catList2.length+'건):</strong><br><div style="font-size:10px;opacity:0.55;margin-bottom:8px;">항목을 클릭하면 예상 QNA를 바로 생성합니다</div><div class="choice-card-wrap">';
                _catList2.forEach(function(t){_ch2+="<button class='choice-card' onclick='pickCSTemplate(\""+t.replace(/\"/g,'&quot;')+"\",this)'>▶ "+escHtml(t)+"</button>";});
                _ch2+='</div>';
                _csBotD.innerHTML=_ch2;
            } else {
                _csBotD.innerHTML='<span>'+escHtml(_catLabel2)+' 카테고리 항목을 찾을 수 없습니다.</span>';
            }
            var _csBox0=document.getElementById('csChatBox'); if(_csBox0)_csBox0.scrollTop=99999;
            return;
        }
        var lid='csL'+Date.now();
        addCSMsg('<span style="opacity:0.5;font-style:italic;">매뉴얼 검색 중...</span>','bot',lid);
        var botEl=document.getElementById(lid); if(!botEl)return;
        var botD=botEl.querySelector('.bubble');
        var idx=currentMode==='bay'?BAY_MANUAL_INDEX:MANUAL_INDEX;
        /* 별칭 우선 매핑 */
        var _csAliases={'무통장':'전용계좌','무통장입금':'전용계좌','가상계좌':'전용계좌','전용계좌입금':'전용계좌'};
        var qLow=q.toLowerCase();
        var _aliasKey=null;
        Object.keys(_csAliases).forEach(function(a){if(!_aliasKey&&qLow.indexOf(a)>=0&&idx[_csAliases[a]])_aliasKey=_csAliases[a];});
        /* 스코어링 */
        var qWords=qLow.split(/\s+/).filter(function(w){return w.length>1;});
        var scored=Object.entries(idx).map(function(e){
            var key=e[0].toLowerCase();
            var val=(typeof e[1]==='string'?e[1]:(e[1].text||e[1].content||'')).toLowerCase();
            var keyNS=key.replace(/\s/g,'');
            var valNS=val.replace(/\s/g,'');
            var sc=0;
            qWords.forEach(function(w){
                var wNS=w.replace(/\s/g,'');
                if(key.includes(w)||keyNS.includes(wNS))sc+=3;
                if(val.includes(w)||valNS.includes(wNS))sc+=2;
            });
            return {k:e[0],v:(typeof e[1]==='string'?e[1]:(e[1].text||e[1].content||'')),s:sc};
        });
        scored.sort(function(a,b){return b.s-a.s;});
        /* 별칭 항목 최상위로 */
        if(_aliasKey){
            scored=scored.filter(function(e){return e.k!==_aliasKey;});
            scored.unshift({k:_aliasKey,v:idx[_aliasKey],s:999});
        }
        var topHits=scored.filter(function(e){return e.s>1;}).slice(0,5);
        if(topHits.length===0){
            // 매뉴얼에 없어도 공지에서 찾으면 QNA 생성
            var _qw=qLow.split(/\s+/).filter(function(w){return w.length>=2;});
            var _noticesObj=allNotices[currentMode]||{};
            var _noticeHit=Object.keys(_noticesObj).some(function(id){
                var n=_noticesObj[id]; if(!n||typeof n!=='object')return false;
                var hay=((n.title||'')+(n.content||'')).toLowerCase();
                return _qw.some(function(w){return hay.indexOf(w)>=0;});
            });
            if(_noticeHit){
                _csPendingQ=q;
                await _generateQnA(q,'',q,botEl,botD);
            } else {
                botD.innerHTML='<span style="font-size:11px;opacity:0.55;">매뉴얼과 공지에서 관련 항목을 찾지 못했습니다. 키워드를 바꿔서 다시 시도해 주세요.</span>';
            }
            var box2=document.getElementById('csChatBox'); if(box2)box2.scrollTop=99999;
            return;
        }
        /* 1개 또는 별칭 강제 → 바로 생성 */
        if(topHits.length===1||_aliasKey){
            _csPendingQ=q;
            await _generateQnA(topHits[0].k,topHits[0].v,q,botEl,botD);
        } else {
            /* 여러 항목 → 선택 버튼 */
            _csPendingQ=q;
            var h='<div style="font-size:11px;font-weight:700;opacity:0.7;margin-bottom:8px;">관련 항목 '+topHits.length+'개를 찾았습니다.<br>어떤 항목의 예상 QNA를 뽑을까요?</div>';
            h+='<div style="display:flex;flex-direction:column;gap:5px;">';
            topHits.forEach(function(e){
                h+='<button onclick="pickCSTemplate(\''+e.k.replace(/\\/g,'\\\\').replace(/\'/g,"\\'")+'\',this)" style="text-align:left;padding:8px 12px;border-radius:8px;border:2px solid var(--border-ui);background:var(--bg-card);cursor:pointer;font-size:11px;font-weight:700;color:var(--text-main);transition:0.15s;" onmouseover="this.style.borderColor=\'var(--active-focus-color)\';this.style.color=\'var(--active-focus-color)\'" onmouseout="this.style.borderColor=\'var(--border-ui)\';this.style.color=\'var(--text-main)\'">▶ '+escHtml(e.k)+'</button>';
            });
            h+='</div>';
            botD.innerHTML=h;
        }
        var box=document.getElementById('csChatBox'); if(box)box.scrollTop=99999;
    }
    async function pickCSTemplate(key, btn){
        var idx=currentMode==='bay'?BAY_MANUAL_INDEX:MANUAL_INDEX;
        var val=idx[key]; if(val===undefined)return;
        /* 선택한 버튼 강조 */
        if(btn){var p=btn.parentElement;if(p)p.querySelectorAll('button').forEach(function(b){b.disabled=true;b.style.opacity='0.4';});btn.style.opacity='1';btn.style.borderColor='var(--active-focus-color)';btn.style.color='var(--active-focus-color)';}
        addCSMsg(key,'user');
        var lid='csL'+Date.now();
        addCSMsg('<span style="opacity:0.5;font-style:italic;">QNA 분석 중...</span>','bot',lid);
        var botEl=document.getElementById(lid); if(!botEl)return;
        var botD=botEl.querySelector('.bubble');
        await _generateQnA(key,val,_csPendingQ||key,botEl,botD);
        var box=document.getElementById('csChatBox'); if(box)box.scrollTop=99999;
    }
    async function _generateCSTemplate(key,val,q,botEl,botD){
        botD.innerHTML='<span style="opacity:0.5;font-style:italic;font-size:12px;">템플릿 생성 중...</span>';
        var siteName=currentMode==='mania'?'아이템매니아':'아이템베이';
        var sys='당신은 '+siteName+' 고객센터 상담원 도우미입니다.\n아래 매뉴얼 내용만을 근거로 고객 응대용 안내 템플릿을 작성하세요.\n\n[매뉴얼 내용]\n# '+key+'\n'+val+'\n\n[작성 규칙]\n- 반드시 아래 구조를 따를 것\n  1줄: 안녕하세요, '+siteName+' 고객센터입니다.\n  빈줄\n  본문\n  빈줄\n  마지막줄: 감사합니다.\n- 본문은 매뉴얼의 모든 조건·예외사항·절차를 빠짐없이 포함할 것 (임의로 축약하지 말 것)\n- 조건이나 절차가 여러 개면 번호(1. 2. 3.) 또는 줄바꿈으로 나열하여 가독성 있게 작성\n- 각 항목은 줄바꿈으로 구분\n- 고객 개인정보 부분만 [고객 아이디], [날짜], [주문번호] 등 대괄호 변수로 표시\n- 매뉴얼에 없는 내용 추가 금지\n- 주석·설명 없이 템플릿 본문만 출력';
        try{
            var res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':CLAUDE_API_KEY,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1200,system:sys,messages:[{role:'user',content:q}]})});
            if(!res.ok){var err=await res.json();botD.innerHTML='⚠️ 오류: '+(err.error&&err.error.message?err.error.message:res.status);return;}
            var data=await res.json();
            var txt=data.content[0].text;
            var copyBtn=document.createElement('button');
            copyBtn.className='copy-btn';
            copyBtn.style.cssText='margin-top:8px;display:inline-block;width:auto;padding:5px 16px;font-size:0.8em;';
            copyBtn.textContent='📋 템플릿 복사';
            copyBtn.onclick=function(){navigator.clipboard.writeText(txt).then(function(){copyBtn.textContent='✅ 복사됨';copyBtn.classList.add('copied');setTimeout(function(){copyBtn.textContent='📋 템플릿 복사';copyBtn.classList.remove('copied');},2000);});};
            var pre=document.createElement('pre');
            pre.style.cssText='white-space:pre-wrap;font-family:inherit;font-size:0.9em;line-height:1.75;margin:0 0 4px;padding:0;border:none;background:transparent;color:var(--text-main);word-break:break-word;';
            pre.textContent=txt;
            botD.innerHTML='';
            botD.appendChild(pre);
            botD.appendChild(copyBtn);
        }catch(e){botD.innerHTML='⚠️ 네트워크 오류: '+e.message;}
    }

    /* ── 금칙어 조회 ── */
    var _badwordsCache={};
    // 각 글자 사이에 비알파벳·비한글 문자가 끼어들어도 감지하는 퍼지 패턴
    // 예: "버스" → /버[^a-zA-Z0-9가-힣ㄱ-ㅎㅏ-ㅣ]*스/i
    var _SEP='\\s*';
    function _buildFuzzyRe(word){
        var pat=Array.from(word).map(function(c){
            return c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        }).join(_SEP);
        return new RegExp(pat,'i');
    }
    // 원본 title에서 퍼지 매치 위치를 찾아 HTML 하이라이트
    function _highlightFuzzy(title,words){
        var spans=[];
        words.forEach(function(w){
            var re=new RegExp(_buildFuzzyRe(w).source,'gi');
            var m;
            while((m=re.exec(title))!==null){
                spans.push({s:m.index,e:m.index+m[0].length});
                if(m[0].length===0)re.lastIndex++;
            }
        });
        spans.sort(function(a,b){return a.s-b.s;});
        var merged=[];
        spans.forEach(function(sp){
            if(merged.length&&sp.s<=merged[merged.length-1].e)
                merged[merged.length-1].e=Math.max(merged[merged.length-1].e,sp.e);
            else merged.push({s:sp.s,e:sp.e});
        });
        var out='',pos=0;
        merged.forEach(function(sp){
            out+=escHtml(title.slice(pos,sp.s));
            out+='<mark style="background:#ef4444;color:#fff;border-radius:4px;padding:1px 4px;font-weight:900;">'+escHtml(title.slice(sp.s,sp.e))+'</mark>';
            pos=sp.e;
        });
        return out+escHtml(title.slice(pos));
    }
    function _loadBadwords(mode,cb){
        if(_badwordsCache[mode]){cb(_badwordsCache[mode]);return;}
        db.ref('/imi_badwords/'+mode).once('value',function(snap){
            _badwordsCache[mode]=snap.val()||{};
            cb(_badwordsCache[mode]);
        });
    }
    function checkBadwords(){
        var inp=document.getElementById('badwordInput');
        var title=inp?inp.value.trim():'';
        var result=document.getElementById('badwordResult');
        if(!title){
            if(result)result.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:200px;gap:10px;color:var(--text-muted,#888);text-align:center;">'
                +'<div style="font-size:36px;opacity:0.4;">🚫</div>'
                +'<div style="font-size:15px;">물품 제목을 입력하세요.</div>'
                +'</div>';
            return;
        }
        _loadBadwords(currentMode,function(data){
            var matched=[];
            (data['전체게임']||[]).forEach(function(w){
                if(_buildFuzzyRe(w).test(title)){
                    var ex=matched.find(function(m){return m.word.toLowerCase()===w.toLowerCase();});
                    if(ex){if(ex.games.indexOf('전체게임')<0)ex.games.push('전체게임');}
                    else matched.push({word:w,games:['전체게임']});
                }
            });
            Object.keys(data).forEach(function(game){
                if(game==='전체게임')return;
                (data[game]||[]).forEach(function(w){
                    if(_buildFuzzyRe(w).test(title)){
                        var ex=matched.find(function(m){return m.word.toLowerCase()===w.toLowerCase();});
                        if(ex)ex.games.push(game);
                        else matched.push({word:w,games:[game]});
                    }
                });
            });
            if(!result)return;

            var hlTitle=matched.length>0?_highlightFuzzy(title,matched.map(function(m){return m.word;})):escHtml(title);
            var html='<div style="padding:16px;display:flex;flex-direction:column;gap:14px;">';

            // ── 검사 제목 카드
            html+='<div style="background:rgba(239,68,68,0.06);border:1.5px solid rgba(239,68,68,0.22);border-radius:14px;padding:14px 18px;">'
                +'<div style="font-size:11px;font-weight:800;color:#ef4444;letter-spacing:1px;margin-bottom:8px;">📌 검사 제목</div>'
                +'<div style="font-size:18px;font-weight:700;line-height:1.7;word-break:break-all;">'+hlTitle+'</div>'
                +'</div>';

            if(matched.length===0){
                // ── 금칙어 없음
                html+='<div style="display:flex;align-items:center;gap:16px;background:rgba(34,197,94,0.08);border:1.5px solid rgba(34,197,94,0.3);border-radius:14px;padding:18px 20px;">'
                    +'<span style="font-size:36px;line-height:1;">✅</span>'
                    +'<div>'
                    +'<div style="font-size:18px;font-weight:900;color:#22c55e;">금칙어 없음</div>'
                    +'<div style="font-size:13px;opacity:0.6;margin-top:4px;">입력한 제목에서 금칙어가 발견되지 않았습니다.</div>'
                    +'</div>'
                    +'</div>';
            } else {
                // ── 요약 헤더
                html+='<div style="display:flex;align-items:center;gap:8px;">'
                    +'<span style="font-size:15px;font-weight:800;color:#ef4444;">🚫 감지된 금칙어</span>'
                    +'<span style="background:#ef4444;color:#fff;font-size:13px;font-weight:900;padding:2px 10px;border-radius:20px;">'+matched.length+'개</span>'
                    +'</div>';
                // ── 키워드 카드 그리드
                html+='<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;">';
                matched.forEach(function(m){
                    html+='<div style="background:var(--bg-body,#0f172a);border:2px solid rgba(239,68,68,0.35);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:10px;">'
                        +'<div style="font-size:22px;font-weight:900;color:#ef4444;word-break:break-all;">'+escHtml(m.word)+'</div>'
                        +'<div style="height:1px;background:rgba(239,68,68,0.18);"></div>'
                        +'<div style="display:flex;flex-wrap:wrap;gap:5px;">'
                        +m.games.map(function(g){
                            var isAll=g==='전체게임';
                            return '<span style="font-size:12px;font-weight:700;padding:3px 9px;border-radius:6px;'
                                +(isAll?'background:rgba(127,29,29,0.55);color:#fca5a5;border:1px solid rgba(239,68,68,0.35);':'background:rgba(30,58,95,0.55);color:#93c5fd;border:1px solid rgba(59,130,246,0.35);')
                                +'">'+escHtml(g)+'</span>';
                        }).join('')
                        +'</div>'
                        +'</div>';
                });
                html+='</div>';
            }

            html+='</div>';
            result.innerHTML=html;
            result.scrollTop=0;
        });
    }

    /* ── 고객 예상 QNA 생성 ── */
    function _renderQnA(txt){
        // Q: 와 A: 사이에 빈 줄이 있어도 하나의 블록으로 합침
        var normalized=txt
            .replace(/\n{3,}/g,'\n\n')
            .replace(/(Q\d*[：:．.][^\n]+)\n\n(A\d*[：:．.])/gi,'$1\n$2');
        var blocks=normalized.split(/\n{2,}/).map(function(b){return b.trim();}).filter(Boolean);
        var num=0;
        var html='<div style="display:flex;flex-direction:column;gap:14px;">';
        blocks.forEach(function(block){
            var qm=block.match(/^Q\d*[：:．.]\s*(.+?)(?:\n|$)/i);
            var am=block.match(/A\d*[：:．.]\s*([\s\S]+)$/i);
            if(qm&&am){
                num++;
                html+='<div style="border:2px solid var(--border-ui);border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">'
                    // Q row
                    +'<div style="padding:0.7em 1em;background:var(--active-focus-color);display:flex;align-items:flex-start;gap:0.6em;">'
                    +'<span style="flex-shrink:0;background:rgba(255,255,255,0.25);color:#fff;border-radius:6px;padding:0.1em 0.45em;font-size:0.85em;font-weight:900;letter-spacing:0.04em;line-height:1.5;">Q'+(num)+'</span>'
                    +'<span style="color:#fff;font-size:1em;font-weight:900;line-height:1.55;word-break:keep-all;">'+escHtml(qm[1].trim())+'</span>'
                    +'</div>'
                    // A row
                    +'<div style="padding:0.75em 1em 0.85em;display:flex;align-items:flex-start;gap:0.6em;background:var(--bg-card);">'
                    +'<span style="flex-shrink:0;color:var(--active-focus-color);font-size:0.85em;font-weight:900;border:1.5px solid var(--active-focus-color);border-radius:6px;padding:0.1em 0.4em;line-height:1.5;margin-top:0.05em;">A</span>'
                    +'<span style="font-size:0.95em;font-weight:700;line-height:1.75;white-space:pre-wrap;color:var(--text-body,#e2e8f0);word-break:keep-all;">'+escHtml(am[1].trim())+'</span>'
                    +'</div>'
                    +'</div>';
            } else {
                html+='<div style="font-size:0.9em;white-space:pre-wrap;color:var(--text-main);opacity:0.9;padding:0.4em 0.6em;line-height:1.7;border-left:2px solid var(--border-ui);">'+escHtml(block)+'</div>';
            }
        });
        html+='</div>';
        return html;
    }
    async function _generateQnA(key,val,q,botEl,botD){
        botD.innerHTML='<span style="opacity:0.5;font-style:italic;font-size:12px;">매뉴얼 + 공지 분석 중...</span>';
        var siteName=currentMode==='mania'?'아이템매니아':'아이템베이';
        var valStr=typeof val==='object'?(val.text||val.content||''):String(val||'');

        // MANUAL_RANGES에서 키워드 추가 컨텍스트 확보
        var rangeData=(currentMode==='bay'?BAY_MANUAL_RANGES:MANUAL_RANGES)[normalizeKey(key)]||{};
        var kwCtx=rangeData.keywords?'\n[관련 키워드] '+rangeData.keywords:'';

        // 관련 공지 수집: 매뉴얼 키 기준 + 검색어 기준 합산
        var noticesObj=allNotices[currentMode]||{};
        var seenIds=new Set();
        var relatedArr=[];
        // 1) 매뉴얼 제목 기준 관련 공지
        _getRelatedNotices(key).forEach(function(n){
            if(!seenIds.has(n.id)){seenIds.add(n.id);relatedArr.push(n);}
        });
        // 2) 검색어 단어 기준 추가 매칭
        var qWords=q.toLowerCase().split(/\s+/).filter(function(w){return w.length>=2;});
        Object.keys(noticesObj).forEach(function(id){
            if(seenIds.has(id))return;
            var n=noticesObj[id]; if(!n||typeof n!=='object')return;
            var hay=((n.title||'')+(n.content||'')).toLowerCase();
            if(qWords.some(function(w){return hay.indexOf(w)>=0;})){
                seenIds.add(id);
                relatedArr.push({id:id,title:n.title||'',date:n.date||'',_ts:_parseDateNum(n)});
            }
        });
        relatedArr.sort(function(a,b){return(b._ts||0)-(a._ts||0);});
        // 날짜가 지난 이벤트성 공지 제외 (점검/이벤트/종료 등 일회성 공지)
        var _nowMs=Date.now();
        relatedArr=relatedArr.filter(function(n){
            var full=noticesObj[n.id]; if(!full)return true;
            var text=((full.title||'')+' '+(full.content||''));
            var isEvent=/점검|정기\s*점검|긴급\s*점검|시스템\s*점검/.test(text);
            if(!isEvent)return true;
            var dateRe=/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/g;
            var m2; var hasFuture=false; var hasDate=false;
            while((m2=dateRe.exec(text))!==null){
                hasDate=true;
                var d=new Date(parseInt(m2[1]),parseInt(m2[2])-1,parseInt(m2[3])+1); // +1: 당일까지 허용
                if(d.getTime()>=_nowMs){hasFuture=true;break;}
            }
            if(!hasDate)return true; // 날짜 없는 공지는 유지
            return hasFuture; // 미래 날짜가 하나라도 있으면 유지
        });
        var topNotices=relatedArr.slice(0,6);
        var noticeCtx='';
        if(topNotices.length){
            noticeCtx='\n\n[관련 공지 — 공지에 최신 정책이 있으면 공지 기준 우선 적용]\n';
            topNotices.forEach(function(n){
                var full=noticesObj[n.id];
                if(full&&full.content) noticeCtx+='■ '+n.title+' ('+n.date+')\n'+full.content+'\n\n';
            });
        }

        var hasManualContent = valStr.trim().length > 0;
        var sys='당신은 '+siteName+' 고객센터 숙련 상담원입니다.\n'
            +'아래 자료를 참고하여, 실제 고객이 문의했을 때 상담원이 직접 안내하는 예상 QNA를 6~8개 작성하세요.\n'
            +(hasManualContent
                ? '매뉴얼 내용을 우선 기반으로 하되, 자료에 명시되지 않은 세부 상황도 실무 경험 기반으로 합리적으로 보완하세요.\n'
                : '매뉴얼 본문이 이미지 형태라 텍스트가 없습니다. 주제·키워드·공지·'+siteName+' 실무 경험을 바탕으로 실질적으로 도움이 되는 QNA를 작성하세요.\n'
            )
            +'공지에 더 최신 정책이 있으면 공지 내용을 우선 적용하세요.\n\n'
            +'[주제] '+key+kwCtx+'\n'
            +(hasManualContent ? '[매뉴얼 내용]\n'+valStr+'\n' : '')
            +noticeCtx
            +'\n[작성 규칙]\n'
            +'- 출력 형식: Q: 질문\nA: 답변 (각 QNA 사이 빈 줄 하나)\n'
            +'- Q: 실제 고객 말투 ("~하면 어떻게 되나요?", "~가 안 돼요" 등)\n'
            +'- A: 고객에게 직접 안내하는 2인칭 ("~하시면 됩니다", "~확인 부탁드립니다")\n'
            +'- 고객이 직접 할 수 있는 것은 구체적 방법을 안내, 처리가 필요한 건만 "고객센터 문의" 안내\n'
            +'- 단계가 있으면 번호(1. 2. 3.)로 순서 안내\n'
            +'- 다양한 케이스 커버: 기본 절차, 예외/오류 상황, 조건·기간 관련\n'
            +'- "고객센터에 문의하세요"만 반복하지 말고, 가능한 범위 내에서 구체적 안내 우선\n'
            +'- 주석·설명 없이 QNA 목록만 출력';
        try{
            var res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':CLAUDE_API_KEY,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-haiku-4-5-20251001',max_tokens:1800,system:sys,messages:[{role:'user',content:'[주제] '+key+'\n[검색어] '+q}]})});
            if(!res.ok){var err=await res.json();botD.innerHTML='⚠️ 오류: '+(err.error&&err.error.message?err.error.message:res.status);return;}
            var data=await res.json();
            var txt=data.content[0].text;
            var srcTag=topNotices.length
                ?'<div style="font-size:0.75em;opacity:0.55;margin-bottom:10px;font-weight:700;">📚 매뉴얼 + 📢 관련 공지 '+topNotices.length+'건 참고</div>'
                :'<div style="font-size:0.75em;opacity:0.55;margin-bottom:10px;font-weight:700;">📚 매뉴얼 참고</div>';
            botD.innerHTML=srcTag+_renderQnA(txt);
            var box=document.getElementById('csChatBox'); if(box)box.scrollTop=99999;
        }catch(e){botD.innerHTML='⚠️ 네트워크 오류: '+e.message;}
    }

    var _currentChatTab=1;
    function switchChatTab(tab){
        _currentChatTab=tab;
        var r1=document.getElementById('chatRoom1');
        var r2=document.getElementById('chatRoom2');
        var t1=document.getElementById('maniaLink');
        var t2=document.getElementById('bayLink');
        var cColor=currentMode==='mania'?'var(--mania-color)':'var(--bay-color)';
        if(tab===1){
            if(r1) r1.style.display='flex';
            if(r2) r2.style.display='none';
            if(t1){ t1.style.background=cColor; t1.style.color='white'; t1.style.borderColor=cColor; }
            if(t2){ t2.style.background=''; t2.style.color=''; t2.style.borderColor=''; }
        } else {
            if(r1) r1.style.display='none';
            if(r2) r2.style.display='flex';
            if(t2){ t2.style.background=cColor; t2.style.color='white'; t2.style.borderColor=cColor; }
            if(t1){ t1.style.background=''; t1.style.color=''; t1.style.borderColor=''; }
            var bRes=document.getElementById('badwordResult');
            if(bRes&&!bRes._bwInited){
                bRes._bwInited=true;
                var _kbdStyle='font-size:11px;padding:2px 6px;border-radius:4px;font-weight:900;background:#ef4444;color:#fff;border:none;font-family:inherit;';
                bRes.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;padding:24px 20px;gap:16px;">'
                    +'<div style="text-align:center;">'
                    +'<div style="font-size:36px;margin-bottom:8px;">🕵️</div>'
                    +'<div style="font-size:15px;font-weight:900;color:var(--text-main);">금칙어</div>'
                    +'<div style="font-size:12px;margin-top:5px;color:var(--text-sub);font-weight:600;">물품 제목을 아래 입력창에 입력하고 조회 버튼을 누르세요.</div>'
                    +'</div>'
                    +'<div style="width:100%;max-width:420px;background:var(--bg-body);border:2px solid var(--border-ui);border-radius:14px;padding:16px 18px;">'
                    +'<div style="font-size:11px;font-weight:900;color:#ef4444;letter-spacing:0.8px;margin-bottom:12px;">📋 물품 제목 입력이 어려운 경우</div>'
                    +'<div style="display:flex;flex-direction:column;gap:10px;">'
                    +'<div style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:var(--text-main);line-height:1.5;"><span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#ef4444;color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;">1</span><span>관리자 화면 물품 제목 복사 <kbd style="'+_kbdStyle+'">Ctrl+C</kbd></span></div>'
                    +'<div style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:var(--text-main);line-height:1.5;"><span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#ef4444;color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;">2</span><span>관리자 본인 아이디 검색 → 메시지 쓰기</span></div>'
                    +'<div style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:var(--text-main);line-height:1.5;"><span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#ef4444;color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;">3</span><span>물품 제목 붙여넣기 <kbd style="'+_kbdStyle+'">Ctrl+V</kbd> → 보내기</span></div>'
                    +'<div style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:var(--text-main);line-height:1.5;"><span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#ef4444;color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;">4</span><span>인터넷 PC 아이템매니아 본인 아이디 접속</span></div>'
                    +'<div style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:var(--text-main);line-height:1.5;"><span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#ef4444;color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;">5</span><span>메시지함 → 메시지 내용 복사 <kbd style="'+_kbdStyle+'">Ctrl+C</kbd></span></div>'
                    +'<div style="display:flex;align-items:center;gap:10px;font-size:13px;font-weight:700;color:var(--text-main);line-height:1.5;"><span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#ef4444;color:#fff;font-size:11px;font-weight:900;display:flex;align-items:center;justify-content:center;">6</span><span>IMI PRO 금칙어 조회 입력창 붙여넣기 <kbd style="'+_kbdStyle+'">Ctrl+V</kbd> → 조회</span></div>'
                    +'</div>'
                    +'</div>'
                    +'</div>';
            }
            var bInp=document.getElementById('badwordInput'); if(bInp)setTimeout(function(){bInp.focus();},80);
        }
    }

    /* ── 금칙어 목록 관리 ── */
    var _bwData = {}; // 현재 로드된 데이터 (게임명 → [단어...])

    function _bwSwitchTab(tab){
        var isQuery = tab==='query';
        var tQ=document.getElementById('bwTabQuery'), tL=document.getElementById('bwTabList');
        var vQ=document.getElementById('bwViewQuery'), vL=document.getElementById('bwViewList');
        if(!tQ||!tL||!vQ||!vL)return;
        tQ.style.borderBottomColor=isQuery?'#ef4444':'transparent';
        tQ.style.background=isQuery?'#0f172a':'#1e293b';
        tQ.style.color=isQuery?'#ef4444':'#475569';
        tL.style.borderBottomColor=!isQuery?'#ef4444':'transparent';
        tL.style.background=!isQuery?'#0f172a':'#1e293b';
        tL.style.color=!isQuery?'#ef4444':'#475569';
        vQ.style.display=isQuery?'flex':'none';
        if(isQuery) vQ.style.flexDirection='column';
        vL.style.display=!isQuery?'flex':'none';
        if(!isQuery){ vL.style.flexDirection='column'; _badwordsCache[currentMode]=null; _renderBwList(); }
    }

    function _renderBwList(){
        var filter=(document.getElementById('bwSearchInput')||{}).value||'';
        filter=filter.toLowerCase().trim();
        var content=document.getElementById('bwListContent');
        if(!content)return;
        content.innerHTML='<div style="text-align:center;padding:20px;opacity:0.4;font-size:12px;">로딩 중...</div>';
        _loadBadwords(currentMode,function(data){
            _bwData=data;
            var games=Object.keys(data).sort(function(a,b){ return a==='전체게임'?-1:b==='전체게임'?1:a.localeCompare(b,'ko'); });
            var html='';
            var total=0;
            games.forEach(function(game){
                var words=data[game]||[];
                var filtered=filter?words.filter(function(w){return w.toLowerCase().indexOf(filter)>=0;}):words;
                if(!filtered.length)return;
                total+=filtered.length;
                html+='<div style="margin-bottom:14px;">';
                html+='<div style="font-size:11px;font-weight:900;color:var(--text-sub);padding:5px 2px;border-bottom:1px solid var(--border-ui);margin-bottom:5px;display:flex;justify-content:space-between;align-items:center;">'
                    +'<span>📂 '+escHtml(game)+' <span style="opacity:0.6;">('+filtered.length+')</span></span>'
                    +'<button onclick="_bwQuickAdd(\''+escHtml(game).replace(/\'/g,"\\'")+'\')" style="font-size:10px;padding:2px 8px;border-radius:6px;background:var(--bg-body);border:1px solid var(--border-ui);color:var(--text-sub);cursor:pointer;">+ 추가</button>'
                    +'</div>';
                filtered.forEach(function(word){
                    var realIdx=words.indexOf(word);
                    html+='<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:8px;background:var(--bg-body);margin-bottom:3px;" id="bwRow_'+escHtml(game)+'_'+realIdx+'">'
                        +'<span style="flex:1;font-size:13px;font-weight:700;color:var(--text-main);">'+escHtml(word)+'</span>'
                        +'<button onclick="_bwEditWord(\''+escHtml(game).replace(/\'/g,"\\'")+'\',' +realIdx+')" style="font-size:10px;padding:3px 10px;border-radius:6px;border:1px solid var(--border-ui);background:none;color:var(--text-sub);cursor:pointer;flex-shrink:0;">수정</button>'
                        +'<button onclick="_bwDeleteWord(\''+escHtml(game).replace(/\'/g,"\\'")+'\',' +realIdx+')" style="font-size:10px;padding:3px 10px;border-radius:6px;border:none;background:#ef4444;color:#fff;cursor:pointer;flex-shrink:0;">삭제</button>'
                        +'</div>';
                });
                html+='</div>';
            });
            if(!html)html='<div style="text-align:center;padding:30px;opacity:0.4;font-size:13px;">'+(filter?'검색 결과 없음':'등록된 금칙어가 없습니다.')+'</div>';
            else html='<div style="font-size:11px;color:var(--text-sub);margin-bottom:8px;font-weight:700;">총 '+total+'개</div>'+html;
            content.innerHTML=html;
        });
    }

    function _bwShowAddForm(){
        document.getElementById('bwBulkForm').style.display='none';
        var form=document.getElementById('bwAddForm');
        var sel=document.getElementById('bwAddGame');
        var games=Object.keys(_bwData).sort(function(a,b){return a==='전체게임'?-1:b==='전체게임'?1:a.localeCompare(b,'ko');});
        sel.innerHTML='<option value="">카테고리 선택...</option>'
            +games.map(function(g){return '<option value="'+escHtml(g)+'">'+escHtml(g)+'</option>';}).join('')
            +'<option value="__new__">+ 새 카테고리</option>';
        sel.onchange=function(){
            var ni=document.getElementById('bwAddGameNew');
            ni.style.display=sel.value==='__new__'?'block':'none';
        };
        form.style.display='flex';
        document.getElementById('bwAddWord').focus();
    }

    function _bwHideAddForm(){
        document.getElementById('bwAddForm').style.display='none';
        document.getElementById('bwAddWord').value='';
        document.getElementById('bwAddGameNew').style.display='none';
    }

    function _bwShowBulkForm(){
        document.getElementById('bwAddForm').style.display='none';
        var bulkForm = document.getElementById('bwBulkForm');
        var sel = document.getElementById('bwBulkGame');
        var games = Object.keys(_bwData).sort(function(a,b){return a==='전체게임'?-1:b==='전체게임'?1:a.localeCompare(b,'ko');});
        sel.innerHTML = '<option value="">카테고리 선택...</option>'
            + games.map(function(g){return '<option value="'+escHtml(g)+'">'+escHtml(g)+'</option>';}).join('')
            + '<option value="__new__">+ 새 카테고리</option>';
        sel.onchange = function(){
            var ni = document.getElementById('bwBulkGameNew');
            ni.style.display = sel.value==='__new__' ? 'block' : 'none';
        };
        bulkForm.style.display = 'flex';
        bulkForm.style.flexDirection = 'column';
        document.getElementById('bwBulkWords').focus();
    }

    function _bwHideBulkForm(){
        document.getElementById('bwBulkForm').style.display = 'none';
        document.getElementById('bwBulkWords').value = '';
        document.getElementById('bwBulkGameNew').style.display = 'none';
        document.getElementById('bwBulkCountLabel').textContent = '0개 단어';
    }

    function _bwBulkCount(){
        var ta = document.getElementById('bwBulkWords');
        var cnt = (ta.value||'').split('\n').map(function(l){return l.trim();}).filter(Boolean).length;
        document.getElementById('bwBulkCountLabel').textContent = cnt + '개 단어';
    }

    async function _bwDoBulkAdd(){
        var sel = document.getElementById('bwBulkGame');
        var ni = document.getElementById('bwBulkGameNew');
        var game = sel.value==='__new__' ? ni.value.trim() : sel.value;
        if(!game || game==='카테고리 선택...'){ alert('카테고리를 선택하세요.'); return; }
        var ta = document.getElementById('bwBulkWords');
        var newWords = (ta.value||'').split('\n').map(function(l){return l.trim();}).filter(Boolean);
        if(!newWords.length){ alert('단어를 입력하세요.'); return; }
        var existing = (_bwData[game]||[]).slice();
        var added = [], skipped = [];
        newWords.forEach(function(w){
            if(existing.indexOf(w)>=0) skipped.push(w);
            else { existing.push(w); added.push(w); }
        });
        if(!added.length){ alert('모두 이미 등록된 단어입니다.\n중복: '+skipped.join(', ')); return; }
        try{
            await _authFetch('imi_badwords/'+currentMode+'/'+encodeURIComponent(game)+'.json','PUT',existing);
            _badwordsCache[currentMode] = null;
            _bwHideBulkForm();
            _renderBwList();
            var msg = added.length+'개 등록 완료.';
            if(skipped.length) msg += '\n중복 제외 '+skipped.length+'개: '+skipped.join(', ');
            alert(msg);
        }catch(e){ alert('저장 실패: '+e.message); }
    }

    function _bwQuickAdd(game){
        _bwShowAddForm();
        var sel=document.getElementById('bwAddGame');
        for(var i=0;i<sel.options.length;i++){ if(sel.options[i].value===game){ sel.selectedIndex=i; break; } }
        document.getElementById('bwAddWord').focus();
    }

    async function _bwDoAdd(){
        var sel=document.getElementById('bwAddGame');
        var ni=document.getElementById('bwAddGameNew');
        var game=sel.value==='__new__'?ni.value.trim():sel.value;
        var word=(document.getElementById('bwAddWord').value||'').trim();
        if(!game||game==='카테고리 선택...'){ alert('카테고리를 선택하세요.'); return; }
        if(!word){ alert('금칙어를 입력하세요.'); return; }
        var words=(_bwData[game]||[]).slice();
        if(words.indexOf(word)>=0){ alert('이미 등록된 금칙어입니다.'); return; }
        words.push(word);
        try{
            await _authFetch('imi_badwords/'+currentMode+'/'+encodeURIComponent(game)+'.json','PUT',words);
            _badwordsCache[currentMode]=null;
            _bwHideAddForm();
            _renderBwList();
        }catch(e){ alert('저장 실패: '+e.message); }
    }

    async function _bwDeleteWord(game, idx){
        var words=(_bwData[game]||[]).slice();
        var word=words[idx];
        if(!confirm('"'+word+'" 금칙어를 삭제하시겠습니까?'))return;
        words.splice(idx,1);
        try{
            if(words.length===0) await _authFetch('imi_badwords/'+currentMode+'/'+encodeURIComponent(game)+'.json','DELETE');
            else await _authFetch('imi_badwords/'+currentMode+'/'+encodeURIComponent(game)+'.json','PUT',words);
            _badwordsCache[currentMode]=null;
            _renderBwList();
        }catch(e){ alert('삭제 실패: '+e.message); }
    }

    async function _bwEditWord(game, idx){
        var words=(_bwData[game]||[]).slice();
        var oldWord=words[idx];
        var newWord=prompt('금칙어 수정 ('+game+'):', oldWord);
        if(newWord===null||newWord===oldWord)return;
        newWord=newWord.trim();
        if(!newWord){ alert('금칙어를 입력하세요.'); return; }
        words[idx]=newWord;
        try{
            await _authFetch('imi_badwords/'+currentMode+'/'+encodeURIComponent(game)+'.json','PUT',words);
            _badwordsCache[currentMode]=null;
            _renderBwList();
        }catch(e){ alert('수정 실패: '+e.message); }
    }

    function toggleNoticePin(id, e){
        if(e){e.stopPropagation();}
        var n=allNotices[currentMode][id]; if(!n)return;
        var newPinned=!n.pinned;
        db.ref('notices_'+currentMode).child(id).update({pinned:newPinned});
    }
    /* Firebase 리스너가 allNotices 업데이트하면 자동으로 renderNotices/renderAllNotices 재호출됨 */
    function _parseDateNum(n){
        var m=(n.date||'').match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
        return m?parseInt(m[1])*10000+parseInt(m[2])*100+parseInt(m[3]):0;
    }
    function renderNotices(){
        var list=document.getElementById('noticeList');
        var search=document.getElementById('noticeSearch').value.toLowerCase();
        var date=document.getElementById('datePicker').value;
        list.innerHTML='';
        var notices=allNotices[currentMode]||{};
        var isFiltering=search||date;
        var allIds=Object.keys(notices).sort(function(a,b){var da=_parseDateNum(notices[a]),db=_parseDateNum(notices[b]);if(da!==db)return db-da;return a>b?-1:a<b?1:0;});
        var pinnedIds=allIds.filter(function(id){return notices[id].pinned;});
        var normalIds=allIds.filter(function(id){return !notices[id].pinned;});
        var sorted=pinnedIds.concat(normalIds);
        var count=0;
        sorted.forEach(function(id){
            var n=notices[id];
            if(!isFiltering&&count>=13)return;
            if(n.title.toLowerCase().indexOf(search)>=0&&(!date||n.date.indexOf(date.replace(/-/g,'. ').replace(/\. 0(\d)/g,'. $1'))>=0)){
                var card=document.createElement('div');
                card.className='notice-card shadow-sm transition-all';
                card.style.position='relative';
                card.onclick=function(){openViewModal(id);};
                var prev=n.content.split('\n').length>1?n.content.split('\n').slice(1).join(' '):n.content;
                card.innerHTML=
                    '<div class="n-title font-black">'+(n.pinned?'📌 ':'')+n.title+'</div>'+
                    '<div class="n-content">'+prev+'</div>'+
                    '<div class="text-[9px] opacity-50 mt-3 font-black">'+n.date+(n.author?' · ✍️ '+n.author:'')+'</div>';
                list.appendChild(card);
                count++;
            }
        });
        updateTicker();
        updateBellBadge();
    }
    /* --- 긴급공지 티커 & 벨 --- */
    var URGENT_TTL = 48 * 3600 * 1000; // 48시간
    function isUrgentActive(n){
        if(n.permanent) return true;
        var expiresAt = n.expiresAt || ((n.timestamp||0) + URGENT_TTL);
        return Date.now() < expiresAt;
    }
    function getUrgentRemaining(n){
        if(n.permanent) return '영구';
        var expiresAt = n.expiresAt || ((n.timestamp||0) + URGENT_TTL);
        var ms = expiresAt - Date.now();
        if(ms <= 0) return '만료됨';
        return '잔여 '+Math.ceil(ms/3600000)+'h';
    }
    function getPinnedNotices(){
        return Object.entries(urgentNotices)
            .filter(function(e){ return isUrgentActive(e[1]) && e[1].showInTicker !== false; })
            .sort(function(a,b){ return (b[1].timestamp||0)-(a[1].timestamp||0); })
            .map(function(e){ return {id:e[0],title:e[1].title,date:e[1].date,content:e[1].content,timestamp:e[1].timestamp}; });
    }
    function updateTicker(){
        var items=getPinnedNotices();
        var track=document.getElementById('tickerTrack');
        var inner=document.getElementById('tickerInner');
        if(!track)return;
        if(items.length===0){
            track.innerHTML='<span style="font-size:11px;opacity:0.4;font-weight:700;">등록된 긴급 공지 없음</span>';
            track.style.animation='none';
            track.style.removeProperty('--ticker-start');
            return;
        }
        var html='';
        items.forEach(function(item){
            html+='<span class="ticker-item" onclick="openUrgentDetail(\''+item.id+'\')">📌 '+escHtml(item.title||'')+'</span>';
            html+='<span class="ticker-sep">◆</span>';
        });
        track.innerHTML=html;
        var containerW=(inner?inner.clientWidth:0)||400;
        track.style.setProperty('--ticker-start', containerW+'px');
        var duration=Math.max(15, Math.min(120, items.length*5));
        track.style.animation='tickerScroll '+duration+'s linear infinite';
    }
    function getBellSeenKey(){return 'bell_seen_urgent';}
    function getBellSeen(){try{return JSON.parse(localStorage.getItem(getBellSeenKey())||'[]');}catch(e){return[];}}
    function setBellSeen(arr){localStorage.setItem(getBellSeenKey(),JSON.stringify(arr));}
    function getNoticeBellSeen(){try{return JSON.parse(localStorage.getItem('bell_seen_notices')||'[]');}catch(e){return[];}}
    function setNoticeBellSeen(arr){localStorage.setItem('bell_seen_notices',JSON.stringify(arr));}

    function _formatBellTime(ts){
        if(!ts||ts<1000000000000) return '';
        var diff=Date.now()-ts;
        if(diff<60000) return '방금';
        if(diff<3600000) return Math.floor(diff/60000)+'분 전';
        if(diff<86400000) return Math.floor(diff/3600000)+'시간 전';
        var d=new Date(ts);
        return (d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
    }

    function getUnseenNotices(){
        var seenN=getNoticeBellSeen();
        var cutoff=Date.now()-3*86400000;
        var result=[];
        ['mania','bay'].forEach(function(mode){
            var notices=allNotices[mode]||{};
            Object.entries(notices).forEach(function(e){
                var ts=parseInt(e[0]);
                if(ts>cutoff && seenN.indexOf(e[0])<0){
                    result.push({id:e[0],mode:mode,n:e[1],ts:ts});
                }
            });
        });
        return result.sort(function(a,b){return b.ts-a.ts;});
    }

    function _buildBellItems(){
        /* 긴급공지 + 일반공지 전체 합쳐서 최신순 정렬 */
        var seenU=getBellSeen();
        var items=[];
        // 긴급공지 - 이미 확인한 것은 제외
        Object.entries(urgentNotices).forEach(function(e){
            var id=e[0]; var n=e[1];
            if(!isUrgentActive(n)) return;
            if(seenU.indexOf(id)>=0) return;
            items.push({type:'urgent',id:id,ts:n.timestamp||parseInt(id),n:n,unread:true});
        });
        // 일반공지 (매니아+베이, 3일 이내 미확인)
        var seenN=getNoticeBellSeen();
        var cutoff=Date.now()-3*86400000;
        ['mania','bay'].forEach(function(mode){
            var notices=allNotices[mode]||{};
            Object.entries(notices).forEach(function(e){
                var ts=parseInt(e[0]);
                if(ts>cutoff && seenN.indexOf(e[0])<0){
                    items.push({type:'notice',mode:mode,id:e[0],ts:ts,n:e[1],unread:true});
                }
            });
        });
        return items.sort(function(a,b){return b.ts-a.ts;});
    }

    function updateBellBadge(){
        var seenU=getBellSeen();
        var pinned=getPinnedNotices();
        var unreadUrgent=pinned.filter(function(p){return seenU.indexOf(p.id)<0;}).length;
        var unreadNotice=getUnseenNotices().length;
        var unread=unreadUrgent+unreadNotice;
        var badge=document.getElementById('bellBadge');
        if(!badge)return;
        if(unread>0){badge.textContent=unread;badge.classList.remove('hidden');}
        else{badge.classList.add('hidden');}
    }

    function openBellModal(){
        var items=_buildBellItems();
        var totalUnread=items.filter(function(i){return i.unread;}).length;
        document.getElementById('bellModalTitle').textContent='🔔 알림'+(totalUnread>0?' ('+totalUnread+'건)':'');
        var list=document.getElementById('bellModalList');
        list.innerHTML='';
        if(items.length===0){
            list.innerHTML='<div style="text-align:center;opacity:0.4;font-size:13px;font-weight:700;padding:30px 0;">새로운 알림이 없습니다.</div>';
        } else {
            items.forEach(function(item){
                var n=item.n;
                var div=document.createElement('div');
                div.className='bell-notice-item';
                var timeStr=_formatBellTime(item.ts);
                if(item.type==='urgent'){
                    var remaining=getUrgentRemaining(n);
                    var isPerm=!!n.permanent;
                    div.style.borderLeftColor='#ef4444';
                    div.style.borderColor='rgba(239,68,68,0.35)';
                    div.innerHTML=
                        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">'
                            +'<span style="font-size:10px;font-weight:900;padding:2px 8px;border-radius:5px;background:rgba(239,68,68,0.15);color:#ef4444;white-space:nowrap;">🚨 긴급공지</span>'
                            +(isPerm?'<span style="font-size:10px;font-weight:900;padding:2px 8px;border-radius:5px;background:rgba(139,92,246,0.15);color:#8b5cf6;">♾️ 영구</span>':'<span style="font-size:10px;font-weight:700;opacity:0.45;">'+remaining+'</span>')
                            +'<span style="margin-left:auto;font-size:10px;font-weight:700;opacity:0.4;white-space:nowrap;">'+timeStr+'</span>'
                        +'</div>'
                        +'<div style="font-size:13px;font-weight:900;line-height:1.4;margin-bottom:6px;">'+escHtml(n.title||'')+'</div>'
                        +'<div style="font-size:11px;opacity:0.65;line-height:1.6;white-space:pre-wrap;">'+escHtml((n.content||'').substring(0,180))+'</div>'
                        +(n.author?'<div style="font-size:10px;opacity:0.4;font-weight:700;margin-top:6px;">✍️ '+escHtml(n.author)+'</div>':'');
                    (function(id){
                        div.onclick=function(){
                            var s=getBellSeen(); if(s.indexOf(id)<0){s.push(id);setBellSeen(s);}
                            updateBellBadge();
                            closeBellModal(); openUrgentDetail(id);
                        };
                    })(item.id);
                } else {
                    var isMania=item.mode==='mania';
                    var modeColor=isMania?'var(--mania-color)':'var(--bay-color)';
                    var modeBg=isMania?'rgba(2,132,199,0.12)':'rgba(219,39,119,0.12)';
                    var modeLabel=isMania?'📌 매니아 공지':'📌 베이 공지';
                    div.style.borderLeftColor=isMania?'#0284c7':'#db2777';
                    div.style.borderColor=isMania?'rgba(2,132,199,0.3)':'rgba(219,39,119,0.3)';
                    var prev=(n.content||'').replace(/\n+/g,' ').substring(0,150);
                    div.innerHTML=
                        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:7px;">'
                            +'<span style="font-size:10px;font-weight:900;padding:2px 8px;border-radius:5px;background:'+modeBg+';color:'+modeColor+';white-space:nowrap;">'+modeLabel+'</span>'
                            +'<span style="margin-left:auto;font-size:10px;font-weight:700;opacity:0.4;white-space:nowrap;">'+timeStr+'</span>'
                        +'</div>'
                        +'<div style="font-size:13px;font-weight:900;line-height:1.4;margin-bottom:6px;">'+escHtml(n.title||'')+'</div>'
                        +'<div style="font-size:11px;opacity:0.65;line-height:1.6;">'+escHtml(prev)+'</div>'
                        +(n.author?'<div style="font-size:10px;opacity:0.4;font-weight:700;margin-top:6px;">✍️ '+escHtml(n.author)+'</div>':'');
                    (function(id,mode){
                        div.onclick=function(){
                            var s=getNoticeBellSeen(); if(s.indexOf(id)<0){s.push(id);setNoticeBellSeen(s);}
                            updateBellBadge();
                            closeBellModal(); if(currentMode!==mode){switchMode(mode);} openViewModal(id);
                        };
                    })(item.id,item.mode);
                }
                list.appendChild(div);
            });
        }
        document.getElementById('bellModal').classList.remove('hidden');
    }
    function closeBellModal(){document.getElementById('bellModal').classList.add('hidden');}
    function markAllBellRead(){
        var pinned=getPinnedNotices();
        var seenU=getBellSeen();
        pinned.forEach(function(p){if(seenU.indexOf(p.id)<0)seenU.push(p.id);});
        setBellSeen(seenU);
        var unseenN=getUnseenNotices();
        var seenN=getNoticeBellSeen();
        unseenN.forEach(function(e){if(seenN.indexOf(e.id)<0)seenN.push(e.id);});
        setNoticeBellSeen(seenN);
        updateBellBadge();
        var list=document.getElementById('bellModalList');
        if(list) list.innerHTML='<div style="text-align:center;opacity:0.4;font-size:13px;font-weight:700;padding:30px 0;">모두 확인하셨습니다.</div>';
    }
    var _currentUrgentId=null;
    function openUrgentHistory(){
        renderUrgentHistoryModal();
        document.getElementById('urgentHistoryModal').classList.remove('hidden');
        _urgentFont.init();
    }
    function closeUrgentHistory(){
        document.getElementById('urgentHistoryModal').classList.add('hidden');
    }
    function renderUrgentHistoryModal(){
        var hist=document.getElementById('urgentHistoryModalList');
        hist.innerHTML='';
        var all=Object.entries(urgentNotices).sort(function(a,b){return (b[1].timestamp||b[1].createdAt||0)-(a[1].timestamp||a[1].createdAt||0);});
        /* 툴바 */
        var toolbar=document.createElement('div');
        toolbar.style.cssText='position:sticky;top:0;z-index:2;background:var(--bg-card);display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1.5px solid var(--border-ui);flex-shrink:0;';
        toolbar.innerHTML='<input type="checkbox" id="urgentSelectAll" style="cursor:pointer;accent-color:#ef4444;width:15px;height:15px;" onchange="toggleSelectAllUrgent(this.checked)">'
            +'<label for="urgentSelectAll" style="font-size:12px;font-weight:700;cursor:pointer;color:var(--text-main);">전체 선택</label>'
            +'<span id="urgentSelectedCount" style="font-size:11px;opacity:0.55;font-weight:700;">0개 선택</span>'
            +'<button onclick="deleteSelectedUrgentNotices()" style="margin-left:auto;padding:5px 14px;border-radius:8px;font-size:12px;font-weight:900;background:#ef4444;color:#fff;border:none;cursor:pointer;transition:0.15s;" onmouseover="this.style.background=\'#dc2626\'" onmouseout="this.style.background=\'#ef4444\'">🗑 선택 삭제</button>';
        hist.appendChild(toolbar);
        if(all.length===0){
            var empty=document.createElement('div');
            empty.style.cssText='flex:1;display:flex;align-items:center;justify-content:center;opacity:0.4;font-size:13px;font-weight:700;';
            empty.textContent='등록된 긴급공지 내역이 없습니다.';
            hist.appendChild(empty);
            return;
        }
        var grid=document.createElement('div');
        grid.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px 16px;align-content:start;';
        all.forEach(function(e){
            var id=e[0]; var n=e[1];
            var active=isUrgentActive(n);
            var isPermanent=!!n.permanent;
            var showInTicker=n.showInTicker!==false;
            var remaining=getUrgentRemaining(n);
            var borderColor=isPermanent?'#8b5cf6':active?'#ef4444':'var(--border-ui)';
            var card=document.createElement('div');
            card.style.cssText='position:relative;background:var(--bg-chat);border:2px solid '+borderColor+';border-radius:12px;padding:10px 12px 10px 10px;cursor:pointer;transition:0.18s;display:flex;flex-direction:column;justify-content:space-between;min-height:110px;opacity:'+(active?'1':'0.5')+';';
            card.onmouseover=function(){this.style.transform='translateY(-2px)';this.style.boxShadow='0 4px 16px rgba(0,0,0,0.12)';};
            card.onmouseout=function(){this.style.transform='';this.style.boxShadow='';};
            card.onclick=function(ev){if(ev.target.type==='checkbox')return;openUrgentDetail(id);};
            /* 체크박스 */
            var cb=document.createElement('input');
            cb.type='checkbox'; cb.dataset.urgentId=id;
            cb.style.cssText='position:absolute;top:8px;right:8px;cursor:pointer;accent-color:#ef4444;width:15px;height:15px;z-index:1;';
            cb.onclick=function(ev){ev.stopPropagation();updateUrgentSelectedCount();};
            card.appendChild(cb);
            /* 뱃지 */
            var badge='<span style="font-size:9px;font-weight:900;padding:2px 7px;border-radius:4px;background:'+(isPermanent?'rgba(139,92,246,0.15)':active?'rgba(239,68,68,0.12)':'var(--border-ui)')+';color:'+(isPermanent?'#8b5cf6':active?'#ef4444':'var(--text-sub)')+';">'+remaining+'</span>';
            var tickerBadge=showInTicker&&active?'<span style="font-size:9px;font-weight:900;padding:2px 7px;border-radius:4px;background:rgba(59,191,248,0.15);color:var(--active-focus-color);">티커노출</span>':'';
            var inner=document.createElement('div');
            inner.innerHTML='<div style="display:flex;gap:5px;margin-bottom:7px;flex-wrap:wrap;padding-right:18px;">'+badge+tickerBadge+'</div>'
                +'<div style="font-size:12.5px;font-weight:900;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">'+(isPermanent?'♾️ ':active?'🚨 ':'')+escHtml(n.title||n.content||'')+'</div>';
            var dateEl=document.createElement('div');
            dateEl.style.cssText='font-size:10px;opacity:0.4;font-weight:700;margin-top:8px;';
            dateEl.textContent=(n.date||'')+(n.author?' · ✍️ '+n.author:'');
            card.appendChild(inner);
            card.appendChild(dateEl);
            grid.appendChild(card);
        });
        hist.appendChild(grid);
    }
    function toggleSelectAllUrgent(checked){
        document.querySelectorAll('input[data-urgent-id]').forEach(function(cb){cb.checked=checked;});
        updateUrgentSelectedCount();
    }
    function updateUrgentSelectedCount(){
        var all=document.querySelectorAll('input[data-urgent-id]');
        var checked=document.querySelectorAll('input[data-urgent-id]:checked').length;
        var el=document.getElementById('urgentSelectedCount');
        if(el) el.textContent=checked+'개 선택';
        var sa=document.getElementById('urgentSelectAll');
        if(sa){sa.checked=checked===all.length&&all.length>0;sa.indeterminate=checked>0&&checked<all.length;}
    }
    function deleteSelectedUrgentNotices(){
        var cbs=document.querySelectorAll('input[data-urgent-id]:checked');
        if(!cbs.length){alert('삭제할 공지를 선택하세요.');return;}
        if(!confirm(cbs.length+'개의 긴급공지를 삭제하시겠습니까?'))return;
        cbs.forEach(function(cb){
            var id=cb.dataset.urgentId;
            db.ref('urgent_notices').child(id).remove();
            delete urgentNotices[id];
        });
        updateTicker(); updateBellBadge(); renderUrgentHistoryModal();
    }
    /* --- 상세 모달 --- */
    function openUrgentDetail(id){
        _currentUrgentId=id;
        refreshUrgentDetail();
        _resetModalPos('urgentDetailContent');
        document.getElementById('urgentDetailModal').classList.remove('hidden');
        window._udFontSet(_udFontSz);
    }
    function refreshUrgentDetail(){
        var id=_currentUrgentId; if(!id)return;
        var n=urgentNotices[id]; if(!n){closeUrgentDetail();return;}
        var active=isUrgentActive(n);
        var isPermanent=!!n.permanent;
        var showInTicker=n.showInTicker!==false;
        var remaining=getUrgentRemaining(n);
        /* 상단 상태 */
        var statusColor=isPermanent?'#8b5cf6':active?'#ef4444':'var(--text-sub)';
        document.getElementById('udStatus').innerHTML='<span style="font-size:10px;font-weight:900;padding:2px 9px;border-radius:5px;background:'+(isPermanent?'rgba(139,92,246,0.15)':active?'rgba(239,68,68,0.12)':'var(--border-ui)')+';color:'+statusColor+';">'+(isPermanent?'♾️ 영구공지':active?'🚨 진행중':'만료됨')+'</span>';
        document.getElementById('udTitle').textContent=n.title;
        document.getElementById('udDate').textContent=n.date||'';
        var udAuth=document.getElementById('udAuthor');
        if(udAuth) udAuth.textContent=n.author?'✍️ '+n.author:'';
        document.getElementById('udContent').textContent=n.content;
        /* +24h 버튼 */
        var extBtn=document.getElementById('udExtendBtn');
        extBtn.textContent='⏱ '+remaining+(isPermanent?'':' (+24h)');
        extBtn.style.opacity=isPermanent?'0.4':'1';
        extBtn.style.cursor=isPermanent?'default':'pointer';
        extBtn.style.borderColor=isPermanent?'var(--border-ui)':active?'#ef4444':'var(--border-ui)';
        /* 영구 버튼 */
        var permBtn=document.getElementById('udPermBtn');
        permBtn.textContent=isPermanent?'♾️ 영구중 (해제)':'♾️ 영구적용';
        permBtn.style.background=isPermanent?'#8b5cf6':'none';
        permBtn.style.color=isPermanent?'#fff':'var(--text-main)';
        permBtn.style.borderColor=isPermanent?'#8b5cf6':'var(--border-ui)';
        /* 티커 체크박스 */
        document.getElementById('udTickerChk').checked=showInTicker;
        /* 모달 테두리 색 */
        document.querySelector('#urgentDetailModal > div').style.borderColor=isPermanent?'#8b5cf6':active?'#ef4444':'var(--border-ui)';
    }
    function closeUrgentDetail(){
        document.getElementById('urgentDetailModal').classList.add('hidden');
        _currentUrgentId=null;
    }
    function extendUrgentDetail(){
        var id=_currentUrgentId; var n=urgentNotices[id]; if(!n||n.permanent)return;
        var currentExpiry=n.expiresAt||((n.timestamp||0)+URGENT_TTL);
        db.ref('urgent_notices').child(id).update({expiresAt:currentExpiry+86400000});
    }
    function toggleUrgentPermanentDetail(){
        var id=_currentUrgentId; var n=urgentNotices[id]; if(!n)return;
        db.ref('urgent_notices').child(id).update({permanent:!n.permanent});
    }
    function toggleUrgentTickerDetail(val){
        var id=_currentUrgentId; if(!id)return;
        db.ref('urgent_notices').child(id).update({showInTicker:val});
    }
    function deleteUrgentDetail(){
        var id=_currentUrgentId; if(!id)return;
        if(!confirm('이 긴급공지를 삭제하시겠습니까?'))return;
        db.ref('urgent_notices').child(id).remove(function(){
            closeUrgentDetail();
            if(!document.getElementById('urgentHistoryModal').classList.contains('hidden')) renderUrgentHistoryModal();
        });
    }
    function editUrgentDetail(){
        var n=urgentNotices[_currentUrgentId]; if(!n)return;
        var titleEl=document.getElementById('udTitle');
        titleEl.innerHTML='<input id="udEditTitle" type="text" style="width:100%;padding:5px 8px;border-radius:7px;border:1.5px solid var(--border-ui);background:var(--bg-chat);color:var(--text-main);font-size:14px;font-weight:900;outline:none;box-sizing:border-box;">';
        document.getElementById('udEditTitle').value=n.title;
        var contentEl=document.getElementById('udContent');
        contentEl.style.padding='10px 20px';
        contentEl.innerHTML='<textarea id="udEditContent" style="width:100%;height:100%;min-height:120px;padding:8px;border-radius:7px;border:1.5px solid var(--border-ui);background:var(--bg-chat);color:var(--text-main);font-size:13px;font-weight:500;line-height:1.8;resize:none;outline:none;box-sizing:border-box;"></textarea>';
        document.getElementById('udEditContent').value=n.content;
        document.getElementById('udEditBtn').style.display='none';
        document.getElementById('udSaveEditBtn').style.display='';
        document.getElementById('udCancelEditBtn').style.display='';
        document.getElementById('udExtendBtn').style.display='none';
        document.getElementById('udPermBtn').style.display='none';
    }
    function cancelUrgentEditDetail(){
        document.getElementById('udEditBtn').style.display='';
        document.getElementById('udSaveEditBtn').style.display='none';
        document.getElementById('udCancelEditBtn').style.display='none';
        document.getElementById('udExtendBtn').style.display='';
        document.getElementById('udPermBtn').style.display='';
        document.getElementById('udContent').style.padding='16px 20px';
        refreshUrgentDetail();
    }
    function saveUrgentEditDetail(){
        var id=_currentUrgentId; if(!id)return;
        var titleEl=document.getElementById('udEditTitle');
        var contentEl=document.getElementById('udEditContent');
        if(!titleEl||!contentEl)return;
        var newTitle=titleEl.value.trim();
        var newContent=contentEl.value.trim();
        if(!newTitle){alert('제목을 입력하세요.');return;}
        db.ref('urgent_notices').child(id).update({title:newTitle,content:newContent},function(){
            document.getElementById('udEditBtn').style.display='';
            document.getElementById('udSaveEditBtn').style.display='none';
            document.getElementById('udCancelEditBtn').style.display='none';
            document.getElementById('udExtendBtn').style.display='';
            document.getElementById('udPermBtn').style.display='';
            document.getElementById('udContent').style.padding='16px 20px';
            refreshUrgentDetail();
            if(!document.getElementById('urgentHistoryModal').classList.contains('hidden')) renderUrgentHistoryModal();
        });
    }
    /* --- end 긴급공지 --- */

    /* ── 스케줄 이미지 자동 등록 ── */
    var _schedImportData = null;
    var _pasteRawRows=[];
    function openSchedTextPaste(){
        document.getElementById('schedImgYear').value=_schedYear;
        document.getElementById('schedImgMonth').value=_schedMonth;
        document.getElementById('schedImgPreviewModal').classList.remove('hidden');
        _pasteRawRows=[];
        _schedImportData=null;
        document.getElementById('schedImgPreviewBody').innerHTML=
            '<div id="pasteDrop" tabindex="0" style="outline:none;width:100%;min-height:120px;border:2px dashed var(--border-ui);border-radius:10px;display:flex;align-items:center;justify-content:center;cursor:text;box-sizing:border-box;padding:18px;background:var(--bg-chat);transition:border-color 0.2s;" '+
            'onpaste="_onSchedPaste(event)" onclick="document.getElementById(\'_hiddenPasteTA\').focus()">'+
            '<div id="pasteDropHint" style="text-align:center;pointer-events:none;">'+
            '<div style="font-size:28px;margin-bottom:6px;">📋</div>'+
            '<div style="font-size:13px;font-weight:900;margin-bottom:4px;">여기를 클릭 후 Ctrl+V</div>'+
            '<div style="font-size:10.5px;opacity:0.55;line-height:1.7;">엑셀에서 날짜·그룹헤더·직원이름 포함 전체 선택 후 복사하세요<br>색상은 무시되고 텍스트만 인식됩니다</div>'+
            '</div></div>'+
            '<textarea id="_hiddenPasteTA" style="position:absolute;opacity:0;width:1px;height:1px;pointer-events:none;" onpaste="_onSchedPaste(event)"></textarea>'+
            '<div id="pasteTableWrap" style="margin-top:10px;overflow-x:auto;display:none;max-height:260px;overflow-y:auto;border-radius:8px;border:1px solid var(--border-ui);"></div>'+
            '<div id="pasteAnalysisWrap" style="margin-top:10px;display:none;"></div>';
        setTimeout(function(){
            var el=document.getElementById('pasteDrop');
            if(el)el.focus();
        },120);
    }
    function _onSchedPaste(e){
        e.preventDefault();
        var cd=e.clipboardData||window.clipboardData;
        var text=cd.getData('text/plain')||'';
        if(!text.trim()){return;}
        _pasteRawRows=text.split('\n').map(function(r){return r.replace(/\r$/,'').split('\t');});
        _renderPasteGrid(_pasteRawRows);
        analyzeSchedPasteText();
    }
    function _renderPasteGrid(rows){
        if(!rows||rows.length===0)return;
        /* 헤더행, 그룹행 인식 */
        var staffHdrIdx=0, singleGrp=-1;
        /* 첫 행이 "09시"/"15시" 등 단일 시간그룹 셀인지 확인 */
        var row0ne=(rows[0]||[]).filter(function(c){return(c||'').trim();});
        if(row0ne.length===1&&_PASTE_GRP[(row0ne[0]||'').trim()]!==undefined){
            staffHdrIdx=1;
            singleGrp=_PASTE_GRP[row0ne[0].trim()];
        } else {
            for(var i=0;i<Math.min(rows.length-1,6);i++){
                if(/^[1-9]\d?$/.test((rows[i+1]&&rows[i+1][0])||'')){staffHdrIdx=i;break;}
            }
        }
        var grpHdrIdx=(singleGrp<0&&staffHdrIdx>0)?staffHdrIdx-1:-1;
        var colGrpMap=grpHdrIdx>=0?_buildPasteColGrpMap(rows[grpHdrIdx]):{};
        var headers=rows[staffHdrIdx]||[];
        var dateCol=-1;
        for(var c=0;c<headers.length;c++){if(headers[c]==='날짜'||headers[c]==='일'){dateCol=c;break;}}
        /* 날짜 헤더 없으면 첫 셀이 숫자인 데이터행 여부로 판단 */
        if(dateCol<0){for(var r2=staffHdrIdx+1;r2<Math.min(rows.length,staffHdrIdx+5);r2++){if(/^[1-9]\d?$/.test(((rows[r2]||[])[0]||'').trim())){dateCol=0;break;}}}
        var KNOWN_VAL={휴무:1,연차:1,반차:1,안식:1,교육:1,'9시':1,'12시':1,'15시':1,'17시':1,출장:1,육아:1,제외:1};
        /* 테이블 HTML */
        var html='<table style="border-collapse:collapse;font-size:10.5px;white-space:nowrap;width:100%;">';
        rows.forEach(function(row,ri){
            var isTimeHdr=singleGrp>=0&&ri===0;
            var isGrpHdr=ri===grpHdrIdx;
            var isStaffHdr=ri===staffHdrIdx;
            /* 날짜열 있으면 해당 셀이 숫자, 없으면 staffHdrIdx+1부터 모두 데이터행 */
            var isDataRow=ri>staffHdrIdx&&(dateCol>=0?/^[1-9]\d?$/.test((row[dateCol]||'').trim()):row.some(function(cc){return(cc||'').trim();}));
            var trStyle='';
            if(isTimeHdr){var tc=_GCOL[singleGrp]||'#eab308';trStyle='background:'+tc+'28;';}
            else if(isGrpHdr)trStyle='background:rgba(99,102,241,0.13);';
            else if(isStaffHdr)trStyle='background:rgba(59,130,246,0.13);';
            else if(isDataRow&&ri%2===0)trStyle='background:rgba(0,0,0,0.04);';
            html+='<tr style="'+trStyle+'">';
            row.forEach(function(cell,ci){
                cell=(cell||'').trim();
                var tdStyle='padding:3px 6px;border:1px solid rgba(128,128,128,0.15);max-width:80px;overflow:hidden;text-overflow:ellipsis;';
                var content=cell;
                if(isTimeHdr&&cell){
                    var tc2=_GCOL[singleGrp]||'#eab308';
                    content='<b style="color:'+tc2+';font-size:11px;">'+cell+'</b>';
                } else if(isStaffHdr&&_isPasteName(cell)){
                    var gc=_GCOL[colGrpMap[ci]!==undefined?colGrpMap[ci]:(singleGrp>=0?singleGrp:0)]||'#888';
                    content='<b style="color:'+gc+'">'+cell+'</b>';
                } else if(isGrpHdr&&_PASTE_GRP[cell]!==undefined){
                    var gc2=_GCOL[_PASTE_GRP[cell]]||'#888';
                    content='<span style="color:'+gc2+';font-weight:900;">'+cell+'</span>';
                } else if(isDataRow&&KNOWN_VAL[cell]){
                    var vc={'휴무':'#ef4444','연차':'#f59e0b','반차':'#f97316','안식':'#8b5cf6','교육':'#2563eb','9시':'#eab308','12시':'#d946ef','15시':'#06b6d4','17시':'#22c55e','출장':'#0ea5e9','육아':'#ec4899','제외':'#6b7280'}[cell]||'#6b7280';
                    content='<span style="background:'+vc+'22;color:'+vc+';padding:1px 5px;border-radius:5px;font-weight:900;font-size:9.5px;">'+cell+'</span>';
                }
                if(isTimeHdr||isGrpHdr||isStaffHdr)tdStyle+='font-weight:700;';
                html+='<td style="'+tdStyle+'">'+content+'</td>';
            });
            html+='</tr>';
        });
        html+='</table>';
        var wrap=document.getElementById('pasteTableWrap');
        if(wrap){wrap.innerHTML=html;wrap.style.display='block';}
        /* 붙여넣기 존 축소 */
        var drop=document.getElementById('pasteDrop');
        if(drop){drop.style.minHeight='36px';drop.style.padding='6px 12px';drop.style.borderStyle='solid';drop.style.justifyContent='flex-start';}
        var hint=document.getElementById('pasteDropHint');
        if(hint)hint.innerHTML='<span style="font-size:10.5px;opacity:0.55;">다시 붙여넣으려면 여기를 클릭 후 Ctrl+V</span>';
    }
    /* 그룹 헤더 키워드 → gIdx */
    var _PASTE_GRP={'09시':0,'9시':0,'12시':3,'15시':1,'17시':4,'야간':2,'나이트':2};
    /* 직원명이 아닌 셀 판별 (2~3글자 순수 한글만 직원명으로 인정) */
    function _isPasteName(s){return /^[가-힣]{2,3}$/.test(s)&&!({'날짜':1,'요일':1,'합계':1,'평일':1,'주말':1,'공휴':1,'야간':1,'12시':1,'15시':1,'17시':1,'09시':1,'9시':1}[s]);}
    /* 그룹 헤더 행 → 열별 gIdx 맵 */
    function _buildPasteColGrpMap(grpRow){
        var map={},cur=-1;
        for(var c=0;c<grpRow.length;c++){
            var cell=(grpRow[c]||'').trim();
            if(_PASTE_GRP[cell]!==undefined){cur=_PASTE_GRP[cell];}
            else if(cell&&!_isPasteName(cell)){cur=-1;} /* 비그룹 구분자(휴무가능 등) → 리셋 */
            if(cur>=0)map[c]=cur;
        }
        return map;
    }
    function analyzeSchedPasteText(){
        var rows=_pasteRawRows;
        if(!rows||rows.length<2){return;}
        /* 직원헤더 행 탐색 */
        var staffHdrIdx=0, singleGrp=-1;
        /* 첫 행이 "09시"/"15시" 등 단일 시간그룹 셀인지 확인 */
        var row0ne=(rows[0]||[]).filter(function(c){return(c||'').trim();});
        if(row0ne.length===1&&_PASTE_GRP[(row0ne[0]||'').trim()]!==undefined){
            staffHdrIdx=1;
            singleGrp=_PASTE_GRP[row0ne[0].trim()];
        } else {
            for(var i=0;i<Math.min(rows.length-1,6);i++){
                if(/^[1-9]\d?$/.test(((rows[i+1]||[])[0]||'').trim())){staffHdrIdx=i;break;}
            }
        }
        var grpHdrIdx=(singleGrp<0&&staffHdrIdx>0)?staffHdrIdx-1:-1;
        var colGrpMap=grpHdrIdx>=0?_buildPasteColGrpMap(rows[grpHdrIdx]):{};
        var headers=rows[staffHdrIdx];
        /* 날짜열 감지: 헤더에 날짜/일이 있거나, 데이터행 첫 셀이 숫자인 경우만 날짜열 존재 */
        var dateCol=-1;
        for(var c=0;c<headers.length;c++){var hc=(headers[c]||'').trim();if(hc==='날짜'||hc==='일'){dateCol=c;break;}}
        if(dateCol<0){
            /* 날짜 헤더 없으면 데이터행 첫 셀 실제 확인 */
            for(var r=staffHdrIdx+1;r<Math.min(rows.length,staffHdrIdx+5);r++){
                if(/^[1-9]\d?$/.test(((rows[r]||[])[0]||'').trim())){dateCol=0;break;}
            }
        }
        /* 직원 목록 – 붙여넣기 열 순서대로 수집 */
        var pasteStaff=[];
        for(var c=0;c<headers.length;c++){
            if(dateCol>=0&&c===dateCol)continue;
            var h=(headers[c]||'').trim();
            if(!_isPasteName(h))continue;
            var gIdx=colGrpMap[c]!==undefined?colGrpMap[c]:(singleGrp>=0?singleGrp:0);
            pasteStaff.push({c:c,name:h,gIdx:gIdx});
        }
        var aw=document.getElementById('pasteAnalysisWrap');
        if(pasteStaff.length===0){
            if(aw){aw.innerHTML='<div style="color:#ef4444;padding:12px;font-weight:700;font-size:11.5px;">⚠️ 직원 이름(2~3글자 한글)을 인식하지 못했습니다.<br><span style="font-size:10px;opacity:0.7;">첫 행에 직원 이름이 있는지 확인하세요.</span></div>';aw.style.display='block';}
            return;
        }
        /* 붙여넣기 열 순서대로 staffId 0,1,2… 부여 (그룹별 독립) */
        var gCounter={};
        SCHED_GROUPS.forEach(function(g,gi){gCounter[gi]=0;});
        var colStaffMap={},newStaff=[],staffGroupUpdates={};
        pasteStaff.forEach(function(item){
            var sid=gCounter[item.gIdx]++;
            var gKey=SCHED_GROUPS[item.gIdx].key;
            var m=_findBestStaffMatch(item.name);
            var isNew=!m||m.score<60;
            colStaffMap[item.c]={gIdx:item.gIdx,staffId:sid,name:item.name,isNew:isNew};
            if(isNew)newStaff.push({gKey:gKey,staffId:sid,name:item.name,gIdx:item.gIdx});
            if(!staffGroupUpdates[gKey])staffGroupUpdates[gKey]={};
            staffGroupUpdates[gKey][sid]=item.name; /* 그룹 전체 덮어쓰기용 */
        });
        var year=parseInt(document.getElementById('schedImgYear').value)||_schedYear;
        var month=parseInt(document.getElementById('schedImgMonth').value)||_schedMonth;
        var updates={};var statusCnt=0;var clearCnt=0;
        /* 직원 등록: 그룹 전체 오브젝트 교체 (기존 ID 정리됨) */
        Object.keys(staffGroupUpdates).forEach(function(gKey){
            updates[_schedFbRoot()+'staff_by_month/'+year+'/'+month+'/'+gKey]=staffGroupUpdates[gKey];
        });
        var KNOWN={'휴무':1,'연차':1,'반차':1,'안식':1,'교육':1,'9시':1,'12시':1,'15시':1,'17시':1,'출장':1,'육아':1,'제외':1};
        for(var r=staffHdrIdx+1;r<rows.length;r++){
            var row=rows[r];
            var day;
            if(dateCol>=0){
                day=parseInt((row[dateCol]||'').trim());
                if(isNaN(day)||day<1||day>31)continue;
            } else {
                day=r-staffHdrIdx;
                if(day<1||day>31)continue;
                if(row.every(function(cc){return!(cc||'').trim();}))continue;
            }
            for(var cv in colStaffMap){
                var info=colStaffMap[cv];
                var cell=(row[parseInt(cv)]||'').trim();
                var fbKey=_schedFbRoot()+year+'/'+month+'/cells/'+info.gIdx+'_'+info.staffId+'_'+day;
                var status;
                if(KNOWN[cell]){
                    status=cell;           /* 연차/안식/반차/휴무 → 그대로 */
                } else if(cell){
                    status='휴무';         /* 이름 또는 기타 텍스트 있음 = 휴무 */
                } else {
                    status=null;           /* 빈칸 = 정상근무 */
                }
                if(status!==null)statusCnt++;else clearCnt++;
                updates[fbKey]=status;
            }
        }
        var existTags='',newTags='';
        Object.keys(colStaffMap).forEach(function(c){
            var info=colStaffMap[c];var gc=_GCOL[info.gIdx]||'#888';
            var tag='<span style="display:inline-block;padding:2px 9px;border-radius:12px;background:'+gc+'22;border:1px solid '+gc+'55;font-size:10.5px;font-weight:900;margin:2px;color:'+gc+'">'+SCHED_GROUPS[info.gIdx].label+' '+info.name+(info.isNew?' 🆕':'')+'</span>';
            if(info.isNew)newTags+=tag;else existTags+=tag;
        });
        var modeNote=dateCol<0?'<span style="color:#3b82f6;font-size:10px;">📅 날짜열 없음 → 1행=1일 자동 적용</span><br>':'';
        var html='<div style="margin-bottom:8px;padding:10px 12px;border-radius:10px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);font-size:11.5px;">';
        html+='<b>인식된 직원</b> (붙여넣기 순서 기준)<br>'+(existTags||'<span style="opacity:0.4;font-size:10px;">없음</span>');
        if(newTags)html+='<br><b style="margin-top:4px;display:block;">신규 자동 추가 🆕</b>'+newTags;
        html+='</div>';
        html+='<div style="font-size:11.5px;padding:10px 12px;border-radius:8px;background:var(--bg-body);line-height:2.1;">';
        html+=modeNote;
        html+='📝 휴무·연차·안식·반차 등록: <b>'+statusCnt+'개</b>&nbsp;&nbsp;✅ 정상근무: <b>'+clearCnt+'개</b><br>';
        if(newStaff.length>0)html+='<span style="color:#f59e0b;font-weight:900;">⚠ 신규 직원 '+newStaff.length+'명이 함께 등록됩니다</span><br>';
        html+='<span style="opacity:0.45;font-size:10px;">위 직원들의 '+year+'년 '+month+'월 전체 스케줄이 교체됩니다</span></div>';
        if(aw){aw.innerHTML=html;aw.style.display='block';}
        _schedImportData={direct:true,updates:updates,year:year,month:month,newStaff:newStaff,staffGroupUpdates:staffGroupUpdates};
    }
    function _findBestStaffMatch(name){
        var best=null,bestScore=-1;
        SCHED_GROUPS.forEach(function(g,gIdx){
            var names=_schedNames[g.key]||{};
            Object.keys(names).forEach(function(sid){
                var sname=names[sid]||''; if(!sname)return;
                var score=0;
                if(sname===name)score=100;
                else if(sname.includes(name)||name.includes(sname))score=60;
                else{for(var i=0;i<name.length;i++){if(sname.includes(name[i]))score+=2;}}
                if(score>bestScore){bestScore=score;best={gIdx:gIdx,gKey:g.key,staffId:parseInt(sid),name:sname,score:score};}
            });
        });
        return (best&&best.score>=20)?best:null;
    }
    function confirmSchedImport(){
        if(!_schedImportData||!_schedImportData.direct)return;
        var year=_schedImportData.year,month=_schedImportData.month;
        var ns=_schedImportData.newStaff||[];
        var sgu=_schedImportData.staffGroupUpdates||{};
        var confirmMsg=year+'년 '+month+'월 스케줄을 붙여넣은 내용으로 교체하시겠습니까?';
        if(ns.length>0)confirmMsg+='\n\n신규 직원 '+ns.length+'명도 함께 등록됩니다:\n'+ns.map(function(s){return '- '+s.name+' ('+SCHED_GROUPS[s.gIdx].label+')';}).join('\n');
        if(!confirm(confirmMsg))return;
        var cachedSgu=sgu;
        db.ref().update(_schedImportData.updates,function(err){
            if(err){alert('오류: '+err.message);return;}
            Object.keys(cachedSgu).forEach(function(gKey){
                _schedNames[gKey]=Object.assign({},cachedSgu[gKey]);
            });
            alert('✅ 완료!'+(ns.length>0?' (신규 직원 '+ns.length+'명 등록됨)':''));
            closeSchedImgPreview();
            if(year===_schedYear&&month===_schedMonth)_loadScheduleAll();
        });
    }
    function closeSchedImgPreview(){
        document.getElementById('schedImgPreviewModal').classList.add('hidden');
        _schedImportData=null;
        _pasteRawRows=[];
    }
    /* ── end 스케줄 이미지 등록 ── */
    var _anmYear=null, _anmMonth=null;
    function openAllNoticesModal(){
        _anmYear=null; _anmMonth=null;
        document.getElementById('allNoticeSearch').value='';
        buildAnmSidebar();
        renderAllNotices();
        document.getElementById('allNoticesModal').classList.remove('hidden');
        _noticeFont.init();
    }
    function closeAllNoticesModal(){
        document.getElementById('allNoticesModal').classList.add('hidden');
    }
    function buildAnmSidebar(){
        var notices=allNotices[currentMode]||{};
        var ymap={};
        Object.values(notices).forEach(function(n){
            var m=(n.date||'').match(/^(\d{4})\.\s*(\d{1,2})\./);
            if(!m)return;
            var y=m[1], mo=parseInt(m[2]);
            if(!ymap[y])ymap[y]={};
            ymap[y][mo]=(ymap[y][mo]||0)+1;
        });
        var sb=document.getElementById('allNoticesSidebar');
        sb.innerHTML='';
        var allBtn=document.createElement('button');
        allBtn.className='anm-year-btn'+(!_anmYear?' active':'');
        allBtn.innerHTML='전체';
        allBtn.onclick=function(){_anmYear=null;_anmMonth=null;buildAnmSidebar();renderAllNotices();};
        sb.appendChild(allBtn);
        Object.keys(ymap).sort(function(a,b){return b-a;}).forEach(function(y){
            var yTotal=Object.values(ymap[y]).reduce(function(a,b){return a+b;},0);
            var yBtn=document.createElement('button');
            var yActive=_anmYear===y;
            yBtn.className='anm-year-btn'+(yActive?' active':'');
            yBtn.innerHTML=y+'<span style="font-size:10px;opacity:0.5;margin-left:3px;">('+yTotal+')</span>';
            yBtn.onclick=function(){_anmYear=yActive?null:y;_anmMonth=null;buildAnmSidebar();renderAllNotices();};
            sb.appendChild(yBtn);
            if(yActive){
                Object.keys(ymap[y]).map(Number).sort(function(a,b){return b-a;}).forEach(function(mo){
                    var moBtn=document.createElement('button');
                    var moActive=_anmMonth===mo;
                    moBtn.className='anm-mo-btn'+(moActive?' active':'');
                    moBtn.innerHTML=mo+'월<span style="font-size:10px;opacity:0.5;margin-left:2px;">('+ymap[y][mo]+')</span>';
                    moBtn.onclick=function(){_anmMonth=moActive?null:mo;buildAnmSidebar();renderAllNotices();};
                    sb.appendChild(moBtn);
                });
            }
        });
    }
    var NOTICE_PW='mania3001!';
    function noticeCheckPw(){
        var pw=prompt('비밀번호를 입력하세요');
        if(pw===null)return false;
        if(pw!==NOTICE_PW){alert('비밀번호가 틀렸습니다.');return false;}
        return true;
    }
    function noticeToggleAll(checked){
        document.querySelectorAll('.notice-chk').forEach(function(cb){cb.checked=checked;});
    }
    function noticeDeleteSelected(){
        var ids=[]; document.querySelectorAll('.notice-chk:checked').forEach(function(cb){ids.push(cb.dataset.id);});
        if(!ids.length){alert('선택된 공지가 없습니다.');return;}
        if(!noticeCheckPw())return;
        if(!confirm(ids.length+'개 공지를 삭제할까요?'))return;
        var ref=db.ref('notices_'+currentMode);
        ids.forEach(function(id){ref.child(id).remove();});
        var sa=document.getElementById('noticeSelectAll'); if(sa)sa.checked=false;
    }
    function noticeDeleteAll(){
        var notices=allNotices[currentMode]||{};
        if(!Object.keys(notices).length){alert('삭제할 공지가 없습니다.');return;}
        if(!noticeCheckPw())return;
        if(!confirm('현재 모드의 전체 공지를 삭제할까요? 이 작업은 되돌릴 수 없습니다.'))return;
        db.ref('notices_'+currentMode).remove();
        closeAllNoticesModal();
    }
    function renderAllNotices(){
        var list=document.getElementById('allNoticesList');
        var search=document.getElementById('allNoticeSearch').value.toLowerCase();
        list.innerHTML='';
        var notices=allNotices[currentMode]||{};
        var sorted=Object.keys(notices).sort(function(a,b){var da=_parseDateNum(notices[a]),db=_parseDateNum(notices[b]);if(da!==db)return db-da;return a>b?-1:a<b?1:0;});
        var cnt=0;
        sorted.forEach(function(id){
            var n=notices[id];
            if(_anmYear||_anmMonth){
                var dm=(n.date||'').match(/^(\d{4})\.\s*(\d{1,2})\./);
                if(!dm)return;
                if(_anmYear&&dm[1]!==_anmYear)return;
                if(_anmMonth&&parseInt(dm[2])!==_anmMonth)return;
            }
            if(search&&n.title.toLowerCase().indexOf(search)<0&&(n.content||'').toLowerCase().indexOf(search)<0)return;
            var card=document.createElement('div');
            card.className='notice-card-sm';
            card.style.position='relative';
            // 체크박스 (우상단)
            var chk=document.createElement('input');
            chk.type='checkbox'; chk.className='notice-chk'; chk.dataset.id=id;
            chk.style.cssText='position:absolute;top:6px;right:6px;cursor:pointer;z-index:3;';
            chk.onclick=function(e){e.stopPropagation();};
            card.appendChild(chk);
            // 고정핀 (좌상단)
            var pinBtn=document.createElement('span');
            pinBtn.title=n.pinned?'고정 해제':'고정';
            pinBtn.style.cssText='position:absolute;top:5px;left:6px;font-size:11px;cursor:pointer;opacity:'+(n.pinned?'1':'0.2')+';z-index:3;transition:opacity 0.15s;';
            pinBtn.textContent='📌';
            pinBtn.onmouseover=function(){this.style.opacity=1;};
            pinBtn.onmouseout=function(){this.style.opacity=n.pinned?'1':'0.2';};
            pinBtn.onclick=function(e){e.stopPropagation();toggleNoticePin(id,e);};
            card.appendChild(pinBtn);
            card.onclick=function(){document.getElementById('allNoticesModal').classList.add('hidden');_returnToAllNotices=true;openViewModal(id);};
            var prev=(n.content||'').replace(/\n+/g,' ').slice(0,90);
            var inner=document.createElement('div');
            inner.innerHTML='<div class="ncm-title" style="padding-right:18px;padding-left:'+(n.pinned?'18px':'4px')+';">'+(n.pinned?'📌 ':'')+n.title+'</div><div class="ncm-content">'+prev+'</div><div class="ncm-date">'+n.date+(n.author?' · ✍️ '+n.author:'')+'</div>';
            card.appendChild(inner);
            list.appendChild(card);
            cnt++;
        });
        var info=document.getElementById('allNoticeCount');
        if(info)info.innerText=cnt+'건';
    }
    function renderNoticeContent(text) {
        if (!text) return '';
        // HTML 특수문자 이스케이프
        var s = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        // 구분선: --- 또는 ─── 또는 ===
        s = s.replace(/^(-{3,}|={3,}|─{3,})$/gm, '<hr style="border:none;border-top:1px solid var(--border-ui);margin:10px 0;">');
        // 굵게: **텍스트** 또는 [제목] 형태
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        s = s.replace(/(\[[^\]]+\])/g, '<strong>$1</strong>');
        // URL 자동 링크
        s = s.replace(/(https?:\/\/[^\s\n<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--active-focus-color);text-decoration:underline;">$1</a>');
        s = s.replace(/(^|[\s(：:])((www\.[^\s\n<]+))/gm, function(m,pre,url){return pre+'<a href="https://'+url+'" target="_blank" rel="noopener" style="color:var(--active-focus-color);text-decoration:underline;">'+url+'</a>';});
        // 줄바꿈 → <br>
        s = s.replace(/\n/g, '<br>');
        return s;
    }
    function openViewModal(id){
        var n=allNotices[currentMode][id]; currentEditId=id;
        document.getElementById('modalDate').innerText="📅 "+n.date;
        var updEl=document.getElementById('viewUpdatedAt');
        if(updEl){
            if(n.updatedAt){updEl.textContent='✏️ 최종 수정: '+n.updatedAt;updEl.classList.remove('hidden');}
            else{updEl.classList.add('hidden');}
        }
        var authorEl=document.getElementById('viewAuthor');
        if(authorEl){
            if(n.author){authorEl.textContent='✍️ 작성자: '+n.author;authorEl.classList.remove('hidden');}
            else{authorEl.classList.add('hidden');}
        }
        document.getElementById('viewTitle').innerText=n.title;
        document.getElementById('viewTitle').style.color='var(--active-focus-color)';
        document.getElementById('viewContent').innerHTML=renderNoticeContent(n.content);
        var imgArea=document.getElementById('viewImgArea');
        if(imgArea){
            if(n.images&&n.images.length){
                imgArea.innerHTML='';
                n.images.forEach(function(url,i){
                    var img=document.createElement('img');
                    img.src=url;
                    img.style.cssText='max-width:100%;border-radius:8px;margin-bottom:6px;cursor:zoom-in;display:block;';
                    img.addEventListener('click',function(){openImgModal(n.images,i);});
                    imgArea.appendChild(img);
                });
            } else { imgArea.innerHTML=''; }
        }
        var urlWrap=document.getElementById('viewUrlWrap');
        var urlEl=document.getElementById('viewUrl');
        if(n.url&&typeof n.url==='string'&&n.url.trim()&&n.url!=='undefined'){
            urlEl.href=n.url.trim(); urlEl.innerText=n.url.trim();
            urlWrap.classList.remove('hidden');
        } else {
            urlWrap.classList.add('hidden');
        }
        updateModalPinBtn(n.pinned);
        switchToViewMode();
        _resetModalPos('noticeModalContent');
        document.getElementById('noticeModal').classList.remove('hidden');
        window._nvFontSet(_nvFontSz);
    }
    function updateModalPinBtn(isPinned){
        var btn=document.getElementById('modalPinBtn'); if(!btn)return;
        if(isPinned){
            btn.textContent='📌 고정됨';
            btn.style.borderColor='var(--active-focus-color)';
            btn.style.color='var(--active-focus-color)';
        } else {
            btn.textContent='📌 고정';
            btn.style.borderColor='';
            btn.style.color='';
        }
    }
    function toggleCurrentNoticePin(){
        if(!currentEditId)return;
        var n=allNotices[currentMode][currentEditId]; if(!n)return;
        var newPinned=!n.pinned;
        db.ref('notices_'+currentMode).child(currentEditId).update({pinned:newPinned});
        updateModalPinBtn(newPinned);
    }
    var _returnToAllNotices=false;
    function closeModal(){
        document.getElementById('noticeModal').classList.add('hidden');
        if(_returnToAllNotices){ _returnToAllNotices=false; document.getElementById('allNoticesModal').classList.remove('hidden'); }
    }
    function openCreateModal(){
        currentEditId=null;
        document.getElementById('editContent').value="";
        document.getElementById('editUrl').value="";
        _noticeImgFiles=[]; _noticeExistingImgs=[]; _renderNoticeImgPreviews();
        switchToEditMode();
        _resetModalPos('noticeModalContent');
        document.getElementById('noticeModal').classList.remove('hidden');
    }
    function switchToEditMode(){
        document.getElementById('viewMode').classList.add('hidden');
        document.getElementById('editMode').classList.remove('hidden');
        var f=document.getElementById('noticeViewFooter'); if(f) f.style.display='none';
        var ef=document.getElementById('noticeEditFooter'); if(ef){ ef.style.display='flex'; }
        if(currentEditId){
            var n=allNotices[currentMode][currentEditId];
            document.getElementById('editContent').value=(n&&n.content)?n.content:'';
            document.getElementById('editUrl').value=(n&&n.url&&n.url!=='undefined')?n.url:'';
            _noticeImgFiles=[];
            _noticeExistingImgs=(n&&n.images&&Array.isArray(n.images))
                ?n.images.map(function(url,i){return{url:url,key:'ex_'+i+'_'+Date.now()};})
                :[];
        } else {
            _noticeImgFiles=[]; _noticeExistingImgs=[];
        }
        _renderNoticeImgPreviews();
    }
    function switchToViewMode(){
        document.getElementById('editMode').classList.add('hidden');
        document.getElementById('viewMode').classList.remove('hidden');
        var f=document.getElementById('noticeViewFooter'); if(f) f.style.display='flex';
        var ef=document.getElementById('noticeEditFooter'); if(ef) ef.style.display='none';
    }
    function openUrgentCreate(){
        var inp=document.getElementById('urgentInput'); if(inp) inp.value='';
        var d48=document.getElementById('urgentDur48'); if(d48) d48.checked=true;
        var am=document.getElementById('urgentAlsoMania'); if(am) am.checked=false;
        var ab=document.getElementById('urgentAlsoBay'); if(ab) ab.checked=false;
        document.getElementById('urgentCreateModal').classList.remove('hidden');
    }
    function closeUrgentCreateModal(){
        document.getElementById('urgentCreateModal').classList.add('hidden');
        _urgentSaving=false;
    }
    var _urgentSaving=false;
    function saveUrgentNotice(){
        if(_urgentSaving)return;
        var content=document.getElementById('urgentInput').value.trim();
        if(!content)return;
        _urgentSaving=true;
        var now=Date.now();
        var durEl=document.querySelector('input[name="urgentDuration"]:checked');
        var durVal=durEl?durEl.value:'48';
        var permanent=durVal==='0';
        var hours=permanent?0:parseInt(durVal);
        var dateStr=new Date(now).toLocaleString('ko-KR',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',weekday:'short'});
        var author=_currentUser&&_currentUser.name?_currentUser.name:'알 수 없음';
        var obj={title:content.split('\n')[0].substring(0,60),content:content,timestamp:now,date:dateStr,expiresAt:permanent?null:now+hours*3600000,showInTicker:true,permanent:permanent,author:author};
        db.ref('urgent_notices').child(String(now)).set(obj, function(err){
            if(err){ alert('🚨 Firebase 오류: '+err.message+'\n\n경로: urgent_notices'); }
        });
        urgentNotices[String(now)]=obj; updateTicker(); updateBellBadge();
        // 오른쪽 공지 등록 (매니아/베이 각각 체크)
        var alsoMania=document.getElementById('urgentAlsoMania');
        var alsoBay=document.getElementById('urgentAlsoBay');
        var noticeObj={title:obj.title,content:content,date:dateStr};
        if(alsoMania&&alsoMania.checked) db.ref('notices_mania').child(String(now)).set(noticeObj);
        if(alsoBay&&alsoBay.checked)     db.ref('notices_bay').child(String(now)).set(noticeObj);
        closeUrgentCreateModal();
        setTimeout(function(){_urgentSaving=false;},1500);
    }
    /* ── 중복 공지 감지 ── */
    var _dupSaveCallback=null;
    function _noticeNorm(t){return(t||'').toLowerCase().replace(/\s+/g,'').replace(/[^가-힣ㄱ-㆏a-z0-9]/g,'');}
    function _noticeSimilarity(a,b){
        var na=_noticeNorm(a), nb=_noticeNorm(b);
        if(!na||!nb) return 0;
        if(na===nb) return 1;
        // 한쪽이 다른쪽을 포함하면 높은 유사도
        if(na.indexOf(nb)>=0||nb.indexOf(na)>=0) return 0.9;
        // Jaccard (2글자 단위 바이그램)
        function bigrams(s){var r={};for(var i=0;i<s.length-1;i++){var g=s[i]+s[i+1];r[g]=(r[g]||0)+1;}return r;}
        var ba=bigrams(na), bb=bigrams(nb);
        var keys=new Set(Object.keys(ba).concat(Object.keys(bb)));
        var inter=0,union=0;
        keys.forEach(function(k){var x=ba[k]||0,y=bb[k]||0;inter+=Math.min(x,y);union+=Math.max(x,y);});
        return union?inter/union:0;
    }
    function _findRecentDupNotices(content){
        var cutoff=Date.now()-30*24*3600*1000; // 최근 30일
        var notices=allNotices[currentMode]||{};
        var results=[];
        Object.keys(notices).forEach(function(id){
            var n=notices[id]; if(!n) return;
            // 날짜 파싱 (Firebase key는 timestamp ms)
            var ts=parseInt(id)||0;
            if(ts>0&&ts<cutoff) return; // 30일 초과 제외
            var sim=_noticeSimilarity(content, n.content||'');
            if(sim>=0.6) results.push({id:id,notice:n,sim:sim});
        });
        results.sort(function(a,b){return b.sim-a.sim;});
        return results;
    }
    function _showDupModal(dups, newContent, isExact, onProceed){
        _dupSaveCallback=onProceed;
        document.getElementById('dupNew').textContent=newContent;
        var exEl=document.getElementById('dupExisting');
        exEl.innerHTML='';
        dups.forEach(function(d){
            var pct=Math.round(d.sim*100);
            var card=document.createElement('div');
            card.style.cssText='padding:10px 12px;background:var(--bg-body);border:1.5px solid var(--border-ui);border-radius:10px;font-size:11px;font-weight:700;line-height:1.7;white-space:pre-wrap;word-break:break-all;flex-shrink:0;';
            var badge='<span style="display:inline-block;font-size:9px;font-weight:900;padding:1px 7px;border-radius:5px;margin-bottom:6px;'+(pct>=95?'background:#7f1d1d;color:#fca5a5;':'background:#1e3a5f;color:#93c5fd;')+'">유사도 '+pct+'%'+(pct>=95?' — 동일':'')+' · '+(d.notice.date||'').substring(0,10)+'</span>\n';
            card.innerHTML=badge+escHtml(d.notice.content||'');
            exEl.appendChild(card);
        });
        var sub=document.getElementById('dupModalSub');
        var proceedBtn=document.getElementById('dupProceedBtn');
        if(isExact){
            sub.textContent='동일한 공지가 이미 등록되어 있습니다. 등록할 수 없습니다.';
            sub.style.color='#ef4444';
            proceedBtn.style.display='none';
        } else {
            sub.textContent='최근 1개월 이내 유사한 공지가 있습니다. 등록 전 확인해 주세요.';
            sub.style.color='';
            proceedBtn.style.display='';
        }
        document.getElementById('dupNoticeModal').classList.remove('hidden');
    }
    function closeDupModal(){
        document.getElementById('dupNoticeModal').classList.add('hidden');
        _dupSaveCallback=null;
    }
    function proceedDupSave(){
        document.getElementById('dupNoticeModal').classList.add('hidden');
        if(_dupSaveCallback){var cb=_dupSaveCallback;_dupSaveCallback=null;cb();}
    }

    function saveNotice(){
        var content=document.getElementById('editContent').value.trim(); if(!content) return;
        var urlVal=document.getElementById('editUrl').value.trim();
        var existingDate = currentEditId && allNotices[currentMode] && allNotices[currentMode][currentEditId]
            ? allNotices[currentMode][currentEditId].date : null;
        var dateStr = existingDate || new Date().toLocaleString('ko-KR',{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',weekday:'long'});
        var obj={title:content.split('\n')[0].substring(0,35),content:content,date:dateStr};
        var existingNotice=currentEditId&&allNotices[currentMode]?allNotices[currentMode][currentEditId]:null;
        var existingAuthor=existingNotice?existingNotice.author:null;
        obj.author=existingAuthor||(_currentUser&&_currentUser.name?_currentUser.name:'알 수 없음');
        if(existingNotice&&existingNotice.pinned) obj.pinned=true;
        if(urlVal) obj.url=urlVal;
        if(currentEditId) obj.updatedAt=new Date().toLocaleString('ko-KR',{year:'numeric',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
        var saveKey=currentEditId||String(Date.now());
        var existingUrls=_noticeExistingImgs.map(function(x){return x.url;});
        var btn=document.getElementById('saveBtn');

        function _doSave(){
            if(_noticeImgFiles.length===0){
                if(existingUrls.length>0) obj.images=existingUrls;
                db.ref('notices_'+currentMode).child(saveKey).set(obj);
                closeModal();
            } else {
                if(btn){btn.disabled=true;btn.textContent='업로드 중...';}
                var uploads=_noticeImgFiles.map(function(item){
                    var ref=storage.ref('notice_images/'+saveKey+'_'+item.key);
                    return ref.put(item.file).then(function(){return ref.getDownloadURL();});
                });
                Promise.all(uploads).then(function(newUrls){
                    obj.images=existingUrls.concat(newUrls);
                    db.ref('notices_'+currentMode).child(saveKey).set(obj);
                    closeModal();
                }).catch(function(err){
                    alert('이미지 업로드 실패: '+err.message);
                    if(btn){btn.disabled=false;btn.textContent='저장 완료';}
                });
            }
        }

        // 새 공지 등록일 때만 중복 검사 (수정 시 제외)
        if(!currentEditId){
            var dups=_findRecentDupNotices(content);
            if(dups.length>0){
                var isExact=dups[0].sim>=0.95;
                _showDupModal(dups,content,isExact,isExact?null:_doSave);
                return;
            }
        }
        _doSave();
    }
    function clearCSChat(){
        var box=document.getElementById('csChatBox');
        if(box) box.innerHTML='';
    }
    function deleteNotice(){
        if(confirm("\uC0AD\uC81C?")){
            db.ref('notices_'+currentMode).child(currentEditId).remove();
            closeModal();
        }
    }

    function switchMode(newMode){
        chatHistories[currentMode+'_manual']=document.getElementById('chatBox').innerHTML;
        var _csBox=document.getElementById('csChatBox');
        chatHistories[currentMode+'_template']=_csBox?_csBox.innerHTML:'';
        currentMode=newMode;
        document.getElementById('chatBox').innerHTML=chatHistories[currentMode+'_manual']||'';
        var _csBox2=document.getElementById('csChatBox');
        if(_csBox2) _csBox2.innerHTML=chatHistories[currentMode+'_template']||'';
        var isMania=newMode==='mania';
        var cColor='var(--'+newMode+'-color)';
        document.documentElement.style.setProperty('--active-focus-color',cColor);
        document.getElementById('mBtn').className='mode-btn flex-1 '+(isMania?'active-mania':'');
        document.getElementById('bBtn').className='mode-btn flex-1 '+(!isMania?'active-bay':'');
        document.getElementById('homeLinkMania').style.display=isMania?'flex':'none';
        document.getElementById('homeLinkBay').style.display=isMania?'none':'flex';
        switchChatTab(_currentChatTab);
        ['askBtn','csAskBtn','writeBtn','modalEditBtn','saveBtn'].forEach(function(id){
            var el=document.getElementById(id);
            if(el){el.style.backgroundColor=cColor;el.style.borderColor=cColor;el.style.color="white";}
        });
        updateStatusBadge(); renderNotices(); syncManuals();
        unloadMemos(); loadMemos();
    }

    /* 키워드 시스템 */
    function buildKeywordBar(title) {
        var eid = encodeURIComponent(title);
        return '<div class="kw-bar" id="kwBar_'+eid+'">' +
            '<div style="font-size:11px;font-weight:800;color:var(--active-focus-color);margin-bottom:6px;">' +
            '\uD0A4\uC6CC\uB4DC <span style="font-weight:500;color:var(--text-sub)">- \uC774 \uD56D\uBAA9\uC5D0 \uB4F1\uB85D\uB41C \uD0A4\uC6CC\uB4DC\uB85C \uAC80\uC0C9\uD560 \uC218 \uC788\uC5B4\uC694</span>' +
            '</div>' +
            '<div id="kwTags_'+eid+'"></div>' +
            '<div class="kw-input-wrap">' +
            '<input class="kw-input" id="kwInput_'+eid+'" placeholder="\uD0A4\uC6CC\uB4DC1, \uD0A4\uC6CC\uB4DC2 (\uC27C\uD45C\uB85C \uC5EC\uB7EC \uAC1C \uC785\uB825)" />' +
            '<button class="kw-save-btn" onclick="saveKeywords(\''+eid+'\')">\uC800\uC7A5</button>' +
            '</div>' +
            '<div class="kw-hint">\uC27C\uD45C(,)\uB85C \uAD6C\uBD84\uD558\uC5EC \uC5EC\uB7EC \uAC1C \uB3D9\uC2DC \uC785\uB825 \uAC00\uB2A5</div>' +
            '<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--border-ui);">' +
            '<button data-crop-title="'+eid+'" onclick="_openCropEditorByTitle(this)" style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:6px;border:1.5px solid var(--border-ui);background:none;color:var(--text-sub);cursor:pointer;opacity:0.55;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.55">\u2702\uFE0F \uC774\uBBF8\uC9C0 \uC601\uC5ED \uC124\uC815</button>' +
            '</div>' +
            '</div>';
    }

    function loadKeywords(title, container) {
        var mode = currentMode;
        var key = 'keywords/' + mode + '/' + encodeForDb(title);
        db.ref(key).once('value', function(snap) {
            var tags = snap.val() || [];
            renderKeywordTags(title, tags);
            var eid = encodeURIComponent(title);
            var inputEl = document.getElementById('kwInput_' + eid);
            if(inputEl && !inputEl.value && window._lastManualSearchQ && window._lastManualSearchQ !== title) {
                inputEl.value = window._lastManualSearchQ;
            }
        });
    }

    function renderKeywordTags(title, tags) {
        var el = document.getElementById('kwTags_' + encodeURIComponent(title));
        if(!el) return;
        var etitle = encodeURIComponent(title);
        if(!tags || tags.length === 0) {
            el.innerHTML = '<span style="font-size:11px;color:var(--text-sub);opacity:0.6;">\uB4F1\uB85D\uB41C \uD0A4\uC6CC\uB4DC \uC5C6\uC74C</span>';
            return;
        }
        el.innerHTML = tags.map(function(kw) {
            return '<span class="kw-tag">' + escHtml(kw) +
                '<span class="del" data-title="'+etitle+'" data-kw="'+escHtml(kw)+'" onclick="delKwTag(this)" title="\uC0AD\uC81C">\xD7</span></span>';
        }).join('');
    }
    function delKwTag(el) {
        var kw = el.dataset.kw;
        var title = decodeURIComponent(el.dataset.title);
        if(!confirm('"' + kw + '" \uD0A4\uC6CC\uB4DC\uB97C \uC0AD\uC81C\uD558\uC2DC\uACA0\uC5B4\uC694?')) return;
        var key = 'keywords/' + currentMode + '/' + encodeForDb(title);
        db.ref(key).once('value', function(snap) {
            var tags = (snap.val() || []).filter(function(t){ return t !== kw; });
            db.ref(key).set(tags).then(function() { renderKeywordTags(title, tags); });
        });
    }

    function saveKeywords(eid) {
        var title = decodeURIComponent(eid);
        var inputEl = document.getElementById('kwInput_' + eid);
        if(!inputEl) return;
        var raw = inputEl.value.trim();
        if(!raw) { alert('\uD0A4\uC6CC\uB4DC\uB97C \uC785\uB825\uD574\uC8FC\uC138\uC694.'); return; }
        var newTags = raw.split(',').map(function(t){ return t.trim(); }).filter(function(t){ return t.length > 0; });
        if(newTags.length === 0) return;
        var key = 'keywords/' + currentMode + '/' + encodeForDb(title);
        db.ref(key).once('value', function(snap) {
            var existing = snap.val() || [];
            newTags.forEach(function(kw) {
                if(existing.indexOf(kw) < 0) existing.push(kw);
            });
            db.ref(key).set(existing).then(function() {
                inputEl.value = '';
                renderKeywordTags(title, existing);
                // 저장 완료 표시
                var btn = inputEl.nextElementSibling;
                if(btn) { btn.innerText = '\u2705 \uC800\uC7A5\uB428'; setTimeout(function(){ btn.innerText = '\uC800\uC7A5'; }, 1500); }
            });
        });
    }

    function removeKeyword(title, kw) {
        var key = 'keywords/' + currentMode + '/' + encodeForDb(title);
        db.ref(key).once('value', function(snap) {
            var tags = (snap.val() || []).filter(function(t) { return t !== kw; });
            db.ref(key).set(tags).then(function() {
                renderKeywordTags(title, tags);
            });
        });
    }

    function encodeForDb(str) {
        return str.replace(/[.#$\[\]\/]/g, '_').replace(/\s/g, '_');
    }

    // 키워드로 항목 찾기
    function searchByKeyword(kw, callback) {
        var mode = currentMode;
        var kwL = kw.toLowerCase();
        var kwNS = kwL.replace(/\s/g, ''); // 공백 제거 버전
        db.ref('keywords/' + mode).once('value', function(snap) {
            var data = snap.val() || {};
            var results = [];
            Object.keys(data).forEach(function(dbKey) {
                var tags = data[dbKey] || [];
                if(tags.some(function(t) {
                    var tL = t.toLowerCase();
                    return tL.indexOf(kwL) >= 0 || tL.replace(/\s/g,'').indexOf(kwNS) >= 0;
                })) {
                    results.push(dbKey.replace(/_/g, ' '));
                }
            });
            callback(results);
        });
    }

    // 협의정정 키워드·페이지범위 자동 등록 (최초 1회)
    function seedKeywords(){
        var seeds=[
            {mode:'mania', title:'협의정정 마일리지 권한 직원 주의사항', keywords:['협의정정','마일리지 협의정정']}
        ];
        seeds.forEach(function(s){
            var dbKey='keywords/'+s.mode+'/'+s.title.replace(/[.#$\[\]\/]/g,'_').replace(/\s/g,'_');
            db.ref(dbKey).once('value',function(snap){
                var existing=snap.val()||[];
                var changed=false;
                s.keywords.forEach(function(kw){if(existing.indexOf(kw)<0){existing.push(kw);changed=true;}});
                if(changed) db.ref(dbKey).set(existing);
            });
        });
    }

    function _syncHdrBtnWidths(){
        var L=document.getElementById('hdrLeftBtns');
        var R=document.getElementById('hdrRightBtns');
        if(!L||!R) return;
        L.style.minWidth=''; R.style.minWidth='';
        var lw=L.offsetWidth, rw=R.offsetWidth;
        if(lw>rw) R.style.minWidth=lw+'px';
        else if(rw>lw) L.style.minWidth=rw+'px';
    }
    setTimeout(_syncHdrBtnWidths, 200);

    /* ── 모달 드래그 & 리사이즈 ── */
    function _resetModalPos(contentId){
        var c=document.getElementById(contentId);
        if(!c) return;
        c.style.left='50%'; c.style.top='50%'; c.style.transform='translate(-50%,-50%)';
        c.style.width=''; c.style.height='600px'; c.style.maxHeight='600px';
    }
    (function(){
        function _makeDraggable(contentId, handleId){
            var content=document.getElementById(contentId);
            var handle=document.getElementById(handleId);
            if(!content||!handle) return;
            var pressing=false, moved=false, dist, prevX, prevY;
            handle.addEventListener('mousedown',function(e){
                if(e.button!==0) return;
                if(e.target.closest('button,a,input,label,select,textarea,[data-resize]')) return;
                pressing=true; moved=false; dist=0;
                prevX=e.clientX; prevY=e.clientY;
            });
            document.addEventListener('mousemove',function(e){
                if(!pressing) return;
                var ddx=e.clientX-prevX, ddy=e.clientY-prevY;
                prevX=e.clientX; prevY=e.clientY;
                dist+=Math.hypot(ddx,ddy);
                if(dist<5) return;
                if(!moved){
                    var r=content.getBoundingClientRect();
                    content.style.transform='none';
                    content.style.left=Math.round(r.left)+'px';
                    content.style.top=Math.round(r.top)+'px';
                    moved=true;
                }
                content.style.left=(parseFloat(content.style.left)+ddx)+'px';
                content.style.top=(parseFloat(content.style.top)+ddy)+'px';
            });
            document.addEventListener('mouseup',function(){pressing=false; moved=false;});
        }
        function _makeResizable(contentId){
            var content=document.getElementById(contentId);
            if(!content) return;
            /* 핸들을 테두리 바깥 6px까지 확장 — 배경 클릭 오인 방지 */
            var dirs=[
                {d:'n',  cur:'n-resize',  t:'-6px', l:'-6px', r:'-6px', b:'auto', w:'auto', h:'12px'},
                {d:'ne', cur:'ne-resize', t:'-6px', l:'auto',  r:'-6px', b:'auto', w:'20px', h:'20px'},
                {d:'e',  cur:'e-resize',  t:'-6px', l:'auto',  r:'-6px', b:'-6px', w:'12px', h:'auto'},
                {d:'se', cur:'se-resize', t:'auto', l:'auto',  r:'-6px', b:'-6px', w:'20px', h:'20px'},
                {d:'s',  cur:'s-resize',  t:'auto', l:'-6px',  r:'-6px', b:'-6px', w:'auto', h:'12px'},
                {d:'sw', cur:'sw-resize', t:'auto', l:'-6px',  r:'auto', b:'-6px', w:'20px', h:'20px'},
                {d:'w',  cur:'w-resize',  t:'-6px', l:'-6px',  r:'auto', b:'-6px', w:'12px', h:'auto'},
                {d:'nw', cur:'nw-resize', t:'-6px', l:'-6px',  r:'auto', b:'auto', w:'20px', h:'20px'}
            ];
            dirs.forEach(function(cfg){
                var el=document.createElement('div');
                el.setAttribute('data-resize', cfg.d);
                el.style.cssText='position:absolute;z-index:20;cursor:'+cfg.cur+';'
                    +'top:'+cfg.t+';left:'+cfg.l+';right:'+cfg.r+';bottom:'+cfg.b+';'
                    +'width:'+cfg.w+';height:'+cfg.h+';';
                content.appendChild(el);
                var resizing=false, sx,sy,sw,sh,sl,st;
                el.addEventListener('mousedown',function(e){
                    if(e.button!==0) return;
                    e.preventDefault(); e.stopPropagation();
                    var r=content.getBoundingClientRect();
                    if(content.style.transform){
                        content.style.transform='none';
                        content.style.left=r.left+'px';
                        content.style.top=r.top+'px';
                    }
                    sx=e.clientX; sy=e.clientY;
                    sw=r.width; sh=r.height; sl=r.left; st=r.top;
                    resizing=true;
                });
                el.addEventListener('click',function(e){ e.stopPropagation(); });
                document.addEventListener('mousemove',function(e){
                    if(!resizing) return;
                    var dx=e.clientX-sx, dy=e.clientY-sy;
                    var d=cfg.d;
                    var minW=300, minH=200;
                    if(d.indexOf('e')>=0){ content.style.width=Math.max(minW,sw+dx)+'px'; }
                    if(d.indexOf('w')>=0){ var nw=Math.max(minW,sw-dx); content.style.width=nw+'px'; content.style.left=(sl+sw-nw)+'px'; }
                    if(d.indexOf('s')>=0){ content.style.height=Math.max(minH,sh+dy)+'px'; content.style.maxHeight='none'; }
                    if(d.indexOf('n')>=0){ var nh=Math.max(minH,sh-dy); content.style.height=nh+'px'; content.style.maxHeight='none'; content.style.top=(st+sh-nh)+'px'; }
                });
                document.addEventListener('mouseup',function(){ resizing=false; });
            });
        }
        _makeDraggable('urgentDetailContent','urgentDetailDragHandle');
        _makeDraggable('noticeModalContent','noticeModalDragHandle');
        _injectStyle('_modalFixedSize',
            '#noticeModalContent{width:min(95vw,800px)!important;min-width:0!important;height:600px!important;max-height:600px!important;overflow:hidden!important;}' +
            '#urgentDetailContent{width:min(95vw,800px)!important;min-width:0!important;height:600px!important;max-height:600px!important;overflow:hidden!important;}'
        );
    })();

    /* ── 플립 시계 ── */
    var _fcPrev={}, _fcBusy={};
    function _fcMake(id){
        return '<div class="fc-d" id="'+id+'"><div class="fc-n cur">0</div></div>';
    }
    function _fcInit(){
        var el=document.getElementById('liveClock');
        if(!el||el.querySelector('.fc-wrap')) return;
        el.innerHTML='<div class="fc-wrap">'
            +'<div class="fc-date" id="fcDate"></div>'
            +'<div class="fc-row">'
            +_fcMake('fc0')+_fcMake('fc1')
            +'<div class="fc-sep">:</div>'
            +_fcMake('fc2')+_fcMake('fc3')
            +'<div class="fc-sep">:</div>'
            +_fcMake('fc4')+_fcMake('fc5')
            +'</div></div>';
    }
    function _fcSet(id, ch){
        if(_fcPrev[id]===ch||_fcBusy[id]) return;
        _fcPrev[id]=ch; _fcBusy[id]=true;
        var el=document.getElementById(id); if(!el){_fcBusy[id]=false;return;}
        var cur=el.querySelector('.fc-n.cur');
        var nxt=document.createElement('div');
        nxt.className='fc-n in'; nxt.textContent=ch;
        el.appendChild(nxt);
        cur.classList.add('out');
        setTimeout(function(){
            cur.remove();
            nxt.classList.remove('in'); nxt.classList.add('cur');
            _fcBusy[id]=false;
        },200);
    }
    function updateClock(){
        _fcInit();
        var now=new Date();
        var days=['일','월','화','수','목','금','토'];
        var hh=String(now.getHours()).padStart(2,'0');
        var mm=String(now.getMinutes()).padStart(2,'0');
        var ss=String(now.getSeconds()).padStart(2,'0');
        _fcSet('fc0',hh[0]); _fcSet('fc1',hh[1]);
        _fcSet('fc2',mm[0]); _fcSet('fc3',mm[1]);
        _fcSet('fc4',ss[0]); _fcSet('fc5',ss[1]);
        var fd=document.getElementById('fcDate');
        if(fd){
            var mo=now.getMonth()+1;
            fd.textContent=now.getFullYear()+'.'+mo+'.'+now.getDate()+' ('+days[now.getDay()]+')';
        }
    }
    /* ══════════════════════════════════════════
       📜 이용약관 모달
    ══════════════════════════════════════════ */
    // _TERMS: terms.js 에서 로드됨

    var _termsCurrentTab = 1;
    var _termsMatchIdx = 0;

    // ── 모달별 폰트 크기 조절 ──────────────────────
    function _injectStyle(id, css){
        var s = document.getElementById(id);
        if(!s){ s = document.createElement('style'); s.id = id; document.head.appendChild(s); }
        s.textContent = css;
    }
    function _makeModalFont(contentId, rangeId, storageKey){
        var BASE = 13;
        var sz = parseInt(localStorage.getItem(storageKey)||''+BASE);
        var styleId = '_mf_' + contentId;
        var set = function(v){
            sz = Math.min(22, Math.max(11, parseInt(v)||BASE));
            localStorage.setItem(storageKey, sz);
            var c = document.getElementById(contentId);
            if(c) c.style.fontSize = sz + 'px';
            var r = document.getElementById(rangeId);
            if(r) r.value = sz;
        };
        return { set: set, adj: function(d){ set(sz+d); }, init: function(){ set(sz); } };
    }
    var _urgentFont = _makeModalFont('urgentHistoryModalList','urgentFontRange','imi_urgent_font');
    var _noticeFont = _makeModalFont('allNoticesList','noticeFontRange','imi_notice_font');
    window._urgentFontSet = function(v){ _urgentFont.set(v); };
    window._urgentFontAdj = function(d){ _urgentFont.adj(d); };
    window._noticeFontSet = function(v){ _noticeFont.set(v); };
    window._noticeFontAdj = function(d){ _noticeFont.adj(d); };
    // 이용약관 폰트 — style 주입으로 CSS 규칙 override
    var _termsFontSz = parseInt(localStorage.getItem('imi_terms_font')||'13');
    window._termsFontSet = function(sz){
        _termsFontSz = Math.min(22, Math.max(11, parseInt(sz)||13));
        localStorage.setItem('imi_terms_font', _termsFontSz);
        _injectStyle('_sTerms',
            '#termsContent,#termsContent p,#termsContent li,#termsContent td,#termsContent th{font-size:'+_termsFontSz+'px!important}'
            +'#termsContent h2{font-size:'+Math.round(_termsFontSz*1.1)+'px!important}'
            +'#termsContent h3{font-size:'+Math.round(_termsFontSz*0.95)+'px!important}');
        var r = document.getElementById('termsFontRange');
        if(r) r.value = _termsFontSz;
    };
    window._termsFontAdj = function(delta){ window._termsFontSet(_termsFontSz + delta); };
    // 긴급공지 상세 폰트
    var _udFontSz = parseInt(localStorage.getItem('imi_udnot_font')||'15');
    window._udFontSet = function(sz){
        _udFontSz = Math.min(22, Math.max(11, parseInt(sz)||15));
        localStorage.setItem('imi_udnot_font', _udFontSz);
        var c = document.getElementById('udContent');
        if(c) c.style.fontSize = _udFontSz + 'px';
        var r = document.getElementById('udFontRange');
        if(r) r.value = _udFontSz;
    };
    window._udFontAdj = function(d){ window._udFontSet(_udFontSz + d); };
    // 일반공지 상세 폰트
    var _nvFontSz = parseInt(localStorage.getItem('imi_nvnot_font')||'14');
    window._nvFontSet = function(sz){
        _nvFontSz = Math.min(22, Math.max(11, parseInt(sz)||14));
        localStorage.setItem('imi_nvnot_font', _nvFontSz);
        var c = document.getElementById('viewContent');
        if(c) c.style.fontSize = _nvFontSz + 'px';
        var r = document.getElementById('nvFontRange');
        if(r) r.value = _nvFontSz;
    };
    window._nvFontAdj = function(d){ window._nvFontSet(_nvFontSz + d); };

    // ── 업데이트 알림 시스템 ──
    var _updateNoticeOff = null; // Firebase 리스너 해제 함수
    var _updateNoticeDismissed = false; // 이번 세션 나중에 누름 여부

    var _currentNoticeTsForRestart = null;
    function _startUpdateNoticeListener(){
        if(_updateNoticeOff) return; // 중복 방지
        _updateNoticeOff = db.ref('system_flags/update_notice').on('value', function(snap){
            var notice = snap.val();
            if(notice && notice.ts && notice.msg){
                _currentNoticeTsForRestart = notice.ts;
                var restarted = localStorage.getItem('imi_restarted_for_notice');
                if(_updateNoticeDismissed || String(restarted) === String(notice.ts)){
                    _hideUpdateNoticePopup();
                } else {
                    _showUpdateNoticePopup(notice.msg);
                }
            } else {
                _currentNoticeTsForRestart = null;
                _hideUpdateNoticePopup();
            }
        });
    }
    function _showUpdateNoticePopup(msg){
        var popup = document.getElementById('updateNoticePopup');
        var msgEl = document.getElementById('updateNoticeMsg');
        if(msgEl) msgEl.textContent = msg;
        if(popup) popup.style.display = '';
    }
    function _hideUpdateNoticePopup(){
        var popup = document.getElementById('updateNoticePopup');
        if(popup) popup.style.display = 'none';
    }
    window._dismissUpdateNotice = function(){
        _updateNoticeDismissed = true;
        _hideUpdateNoticePopup();
        localStorage.setItem('imi_pending_restart', '1');
    };
    window._doRestartUpdate = function(){
        if(_currentNoticeTsForRestart){
            localStorage.setItem('imi_restarted_for_notice', String(_currentNoticeTsForRestart));
        }
        _hideUpdateNoticePopup();
        if(window.electronAPI && window.electronAPI.restartApp){
            window.electronAPI.restartApp();
        } else {
            alert('Electron 환경에서만 재시작이 가능합니다.\n앱을 직접 껐다 켜주세요.');
        }
    };
    // 관리자 전용: 알림 발송 모달 열기
    window._openUpdateNoticeSend = function(){
        var modal = document.getElementById('updateNoticeSendModal');
        if(modal){ modal.style.display = 'flex'; }
        // 유저 메뉴 닫기
        var menu = document.getElementById('authUserMenu');
        if(menu) menu.style.display = 'none';
    };
    window._cancelUpdateNotice = function(){
        var modal = document.getElementById('updateNoticeSendModal');
        if(modal) modal.style.display = 'none';
    };
    window._sendUpdateNotice = function(){
        var inp = document.getElementById('updateNoticeInput');
        var msg = inp ? inp.value.trim() : '';
        if(!msg){ alert('알림 내용을 입력해주세요.'); return; }
        db.ref('system_flags/update_notice').set({ ts: Date.now(), msg: msg });
        if(inp) inp.value = '';
        window._cancelUpdateNotice();
    };
    window._clearUpdateNotice = function(){
        if(!confirm('업데이트 알림을 취소하시겠습니까?\n실무자 화면에서 팝업이 사라집니다.')) return;
        db.ref('system_flags/update_notice').remove();
        window._cancelUpdateNotice();
    };

    function openTermsModal(){
        document.getElementById('termsModal').classList.remove('hidden');
        document.getElementById('termsSearchInput').value = '';
        document.getElementById('termsMatchInfo').textContent = '';
        var isBay = currentMode === 'bay';
        document.getElementById('termTab1').style.display = isBay ? 'none' : '';
        document.getElementById('termTab2').style.display = isBay ? 'none' : '';
        document.getElementById('termTab3').style.display = isBay ? '' : 'none';
        switchTermsTab(isBay ? 3 : 1);
        window._termsFontSet(_termsFontSz);
        setTimeout(function(){document.getElementById('termsSearchInput').focus();}, 150);
    }
    function closeTermsModal(){
        document.getElementById('termsModal').classList.add('hidden');
    }
    function switchTermsTab(n){
        _termsCurrentTab = n;
        [1,2,3].forEach(function(i){
            var el = document.getElementById('termTab'+i);
            if(el) el.classList.toggle('mon-tab-active', i===n);
        });
        _termsRender();
    }
    function _termsMdToHtml(md){
        var lines = md.split('\n');
        var out = '';
        var inArticle = false;
        function closeArticle(){ if(inArticle){ out += '</div>'; inArticle = false; } }
        function openArticle(){ closeArticle(); out += '<div class="terms-article">'; inArticle = true; }

        var i = 0;
        while(i < lines.length){
            var t = lines[i].trim();
            // markdown table: collect consecutive | lines
            if(t.startsWith('|')){
                var tableLines = [];
                while(i < lines.length && lines[i].trim().startsWith('|')){
                    tableLines.push(lines[i].trim()); i++;
                }
                out += '<table style="border-collapse:collapse;width:100%;margin:6px 0;font-size:12px;">';
                var headerDone = false;
                tableLines.forEach(function(row){
                    // separator row: every cell contains only -, :, spaces
                    if(row.split('|').slice(1,-1).every(function(c){ return /^[\s\-:]*$/.test(c); })) return;
                    var cells = row.split('|').slice(1,-1);
                    var tag = headerDone ? 'td' : 'th';
                    headerDone = true;
                    out += '<tr>';
                    cells.forEach(function(c){
                        var cv = c.trim();
                        out += '<'+tag+' style="border:1px solid var(--border-ui);padding:4px 8px;text-align:center;">'+escHtml(cv).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')+'</'+tag+'>';
                    });
                    out += '</tr>';
                });
                out += '</table>';
                continue;
            }
            i++;
            if(!t){ out += '<div style="height:0.35em;"></div>'; continue; }

            // strip ** wrapper (베이 약관: **제 N 조 (...)**)
            var bare = t.replace(/^\*\*\s*/, '').replace(/\s*\*\*$/, '');

            // 장 (Chapter) → h2
            if(/^제\s*\d+\s*장/.test(bare) || /^\[?\(?부칙\)?\]?$/.test(bare)){
                closeArticle();
                out += '<h2>'+escHtml(bare)+'</h2>'; continue;
            }
            if(t.startsWith('## ')){
                closeArticle();
                out += '<h2>'+escHtml(t.slice(3))+'</h2>'; continue;
            }

            // 조 (Article) → h3, wrapped in .terms-article
            if(/^제\s*\d+\s*조/.test(bare)){
                openArticle();
                out += '<h3>'+escHtml(bare)+'</h3>'; continue;
            }
            if(t.startsWith('### ')){
                openArticle();
                out += '<h3>'+escHtml(t.slice(4))+'</h3>'; continue;
            }

            if(t === '---'){
                closeArticle();
                out += '<hr>'; continue;
            }
            var pad = 0;
            if(/^[가-힣]\.\s/.test(t)) pad = 22;
            else if(/^\d+\.\s/.test(t)) pad = 16;
            var padS = pad ? 'padding-left:'+pad+'px;' : '';
            var proc = escHtml(t).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
            out += '<p style="margin:3px 0;'+padS+'">'+proc+'</p>';
        }
        closeArticle();
        return out;
    }
    function _termsRender(){
        var md = _termsCurrentTab === 1 ? _TERMS.service : _termsCurrentTab === 3 ? _TERMS.bay : _TERMS.trade;
        var html = _termsMdToHtml(md);
        var term = document.getElementById('termsSearchInput').value.trim();
        document.getElementById('termsContent').innerHTML = html;
        if(term) _termsHighlight(term);
    }
    function _termsHighlight(term){
        var content = document.getElementById('termsContent');
        var re = new RegExp(
            term.trim().replace(/\s+/g,' ')
                .replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
                .replace(/ /g,'\\s*'),
            'gi');
        var tw = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, null, false);
        var nodes = [];
        var node;
        while((node = tw.nextNode())) nodes.push(node);
        nodes.forEach(function(n){
            if(!re.test(n.textContent)) return;
            re.lastIndex = 0;
            var frag = document.createDocumentFragment();
            var last = 0, m;
            while((m = re.exec(n.textContent)) !== null){
                if(m.index > last) frag.appendChild(document.createTextNode(n.textContent.slice(last, m.index)));
                var mark = document.createElement('mark');
                mark.className = 'terms-hi';
                mark.textContent = m[0];
                frag.appendChild(mark);
                last = re.lastIndex;
            }
            if(last < n.textContent.length) frag.appendChild(document.createTextNode(n.textContent.slice(last)));
            n.parentNode.replaceChild(frag, n);
        });
        var marks = content.querySelectorAll('mark.terms-hi');
        document.getElementById('termsMatchInfo').textContent = marks.length ? '1/'+marks.length+' 일치' : '없음';
        _termsMatchIdx = 0;
        if(marks.length){ marks[0].classList.add('cur'); marks[0].scrollIntoView({behavior:'smooth',block:'center'}); }
    }
    function _termsSearch(){
        _termsMatchIdx = 0;
        _termsRender();
    }
    function _termsNavMatch(dir){
        var marks = document.getElementById('termsContent').querySelectorAll('mark.terms-hi');
        if(!marks.length) return;
        marks[_termsMatchIdx].classList.remove('cur');
        _termsMatchIdx = (_termsMatchIdx + dir + marks.length) % marks.length;
        marks[_termsMatchIdx].classList.add('cur');
        marks[_termsMatchIdx].scrollIntoView({behavior:'smooth',block:'center'});
        document.getElementById('termsMatchInfo').textContent = (_termsMatchIdx+1)+'/'+marks.length+' 일치';
    }

    // 창 크기에 맞게 전체 비율 자동 조정 (기준: 1400px → zoom 0.9)
    function _applyBodyZoom() {
        var z = Math.min(0.9, Math.max(0.55, 0.9 * window.innerWidth / 1400));
        document.body.style.zoom   = z;
        document.body.style.width  = 'calc(100vw / ' + z + ')';
        document.body.style.height = 'calc(100vh / ' + z + ')';
    }
    window.addEventListener('resize', _applyBodyZoom);
    _applyBodyZoom();

    window.onload = function(){
        // 페이지 로드 시 main.js 깜빡임 상태 초기화
        if (window.electronAPI && window.electronAPI.blinkTitle) window.electronAPI.blinkTitle(false, []);
        // '나중에' 눌렀던 경우 → 이번 실행에서 자동 재시작으로 업데이트 적용
        if(localStorage.getItem('imi_pending_restart') === '1' && window.electronAPI && window.electronAPI.restartApp){
            localStorage.removeItem('imi_pending_restart');
            window.electronAPI.restartApp();
            return;
        }
        var saved=localStorage.getItem('imi_theme_v2')||'light'; applyTheme(saved);
        _loadNotifPrefs();
        _loadGlobalTodayOnly();
        _authInit();
        updateClock(); setInterval(updateClock,1000);
        seedKeywords();
        // 알림 권한 안내 배너
        (function(){
            if (!('Notification' in window)) return;
            if (Notification.permission === 'granted') return;
            var b = document.createElement('div');
            b.id = '_notifBanner';
            b.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);z-index:99998;background:#1e293b;border:2px solid #f59e0b;border-radius:12px;padding:12px 18px;font-size:12px;font-weight:700;color:#fff;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);white-space:nowrap;';
            if (Notification.permission === 'default') {
                b.innerHTML = '🔔 사기글 감지 알림을 받으려면 <button id="_notifAllow" style="background:#f59e0b;color:#000;border:none;border-radius:6px;padding:4px 12px;font-weight:900;cursor:pointer;font-size:12px;">알림 허용</button> <span onclick="this.parentNode.remove()" style="opacity:0.4;cursor:pointer;margin-left:4px;">✕</span>';
                b.querySelector('#_notifAllow').onclick = function(){
                    Notification.requestPermission().then(function(p){
                        b.remove();
                        if(p==='denied'){
                            alert('알림이 차단됐습니다.\nChrome 주소창 왼쪽 🔒 아이콘 → 알림 → 허용으로 변경해주세요.');
                        }
                    });
                };
            } else if (Notification.permission === 'denied') {
                b.innerHTML = '⚠️ 알림이 차단됨 — Chrome 주소창 🔒 → 알림 → <b>허용</b>으로 변경하세요 <span onclick="this.parentNode.remove()" style="opacity:0.4;cursor:pointer;margin-left:8px;">✕</span>';
                b.style.borderColor = '#ef4444';
            }
            setTimeout(function(){ document.body && document.body.appendChild(b); }, 1500);
        })();
        // 이미지 모달 스크롤 줌 (단일뷰) — document 레벨로 걸어야 display:flex 전환 후도 확실히 동작
        document.addEventListener('wheel',function(e){
            if(!document.getElementById('imgModal').classList.contains('open')) return;
            if(_mMultiView) return;
            e.preventDefault();
            var factor=e.deltaY<0?1.13:0.88;
            _mZoom=Math.max(0.3,Math.min(8,_mZoom*factor));
            if(_mZoom<=1.0){_mTX=0;_mTY=0;}
            _applyTransform();
        },{passive:false});
        // 이미지 모달 드래그 이동
        var _imgEl=document.getElementById('imgModalWrap');
        if(_imgEl){
            _imgEl.addEventListener('mousedown',function(e){
                if(_mZoom<=1) return;
                e.preventDefault();
                _mDrag.active=true; _mDrag.sx=e.clientX; _mDrag.sy=e.clientY; _mDrag.ox=_mTX; _mDrag.oy=_mTY;
                _imgEl.style.cursor='grabbing';
            });
        }
        document.addEventListener('mousemove',function(e){
            if(!_mDrag.active) return;
            _mTX=_mDrag.ox+(e.clientX-_mDrag.sx);
            _mTY=_mDrag.oy+(e.clientY-_mDrag.sy);
            _applyTransform();
        });
        document.addEventListener('mouseup',function(){
            if(!_mDrag.active) return;
            _mDrag.active=false;
            var wrap=document.getElementById('imgModalWrap');
            if(wrap) wrap.style.cursor=_mZoom>1?'grab':'default';
        });
        document.getElementById('userInput').addEventListener('keydown',function(e){
            if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();ask();}
        });
        // 공지 이미지 첨부 — 파일 선택
        document.getElementById('noticeImgInput').addEventListener('change',function(e){
            Array.from(e.target.files).forEach(function(f){_addNoticeImgFile(f);});
            e.target.value='';
        });
        // 공지 이미지 첨부 — 붙여넣기 (Ctrl+V)
        document.getElementById('editContent').addEventListener('paste',function(e){
            var items=e.clipboardData&&e.clipboardData.items; if(!items) return;
            for(var i=0;i<items.length;i++){
                if(items[i].type.indexOf('image')===0){
                    e.preventDefault();
                    _addNoticeImgFile(items[i].getAsFile());
                    return;
                }
            }
        });
        // ESC로 공지 모달 닫기
        document.addEventListener('keydown',function(e){
            if(e.key==='Escape'){
                if(!document.getElementById('termsModal').classList.contains('hidden')){closeTermsModal();return;}
                if(!document.getElementById('noticeModal').classList.contains('hidden')){closeModal();}
                else if(!document.getElementById('allNoticesModal').classList.contains('hidden')){closeAllNoticesModal();}
                document.getElementById('imgModal').classList.remove('open');
                if(!document.getElementById('urgentDetailModal').classList.contains('hidden'))closeUrgentDetail();
                else if(!document.getElementById('urgentHistoryModal').classList.contains('hidden'))closeUrgentHistory();
                else if(!document.getElementById('urgentCreateModal').classList.contains('hidden'))closeUrgentCreateModal();
                else if(!document.getElementById('allMemosModal').classList.contains('hidden'))closeAllMemosModal();
                else if(document.getElementById('manualFilesModal').style.display==='flex')closeManualFilesModal();
                else if(!document.getElementById('bellModal').classList.contains('hidden'))closeBellModal();
                else if(!document.getElementById('logPanel').classList.contains('hidden'))closeLogPanel();
                else if(!document.getElementById('monitorModal').classList.contains('hidden'))closeMonitorModal();
                else if(!document.getElementById('cropEditorModal').classList.contains('hidden'))closeCropEditor();
                // 가장 앞의 플로팅 메모 닫기
                var topZ=-1, topId=null;
                _memos.forEach(function(m){
                    var el=document.getElementById('mf_'+m.id);
                    if(el&&el.style.display!=='none'){
                        var z=parseInt(el.style.zIndex)||0;
                        if(z>topZ){topZ=z;topId=m.id;}
                    }
                });
                if(topId!==null)closeMemoFloat(topId);
            }
        // Alt + M: 새 메모 추가 단축키
        if(e.altKey && (e.key === 'm' || e.key === 'M')){
            e.preventDefault();
            addMemo();
        }
        });
        var _savedFont = parseInt(localStorage.getItem('imi_font_size')) || 16;
        switchMode('mania'); updateFontSize(_savedFont); loadMemos(); switchChatTab(1);
        // 레이아웃 완전 정착 후 이미지 크기 재계산 (초기 chatBox.clientWidth=0 문제 해결)
        setTimeout(function(){ updateFontSize(parseInt(localStorage.getItem('imi_font_size')) || 16); }, 200);
        setTimeout(function(){ updateFontSize(parseInt(localStorage.getItem('imi_font_size')) || 16); }, 800);
        if(localStorage.getItem('tickerCollapsed')==='1') toggleTicker();
        window.addEventListener('resize', function(){ updateFontSize(parseInt(localStorage.getItem('imi_font_size')) || 16); });
        // chatBox 크기 변동 시 이미지 크기 자동 재계산
        (function(){
            var cb = document.getElementById('chatBox');
            if(!cb || !window.ResizeObserver) return;
            var _lastW = 0;
            new ResizeObserver(function(){
                var w = cb.clientWidth;
                if(w > 0 && w !== _lastW){ _lastW = w; updateFontSize(parseInt(localStorage.getItem('imi_font_size')) || 16); }
            }).observe(cb);
        })();
        // 채팅창 휠 스크롤 세분화 (기본 스크롤보다 작은 고정 단계)
        (function(){
            var cb = document.getElementById('chatBox');
            if(!cb) return;
            cb.addEventListener('wheel', function(e){
                e.preventDefault();
                cb.scrollTop += e.deltaY > 0 ? 90 : -90;
            }, { passive: false });
        })();
        _fbAuthPromise.then(function(){
            // REST로 직접 읽기 (SDK 리스너가 보안규칙에 막힐 경우 대비)
            _authFetch('config/claude_api_key.json').then(function(val){
                if(val && typeof val === 'string'){
                    // 이중 직렬화로 저장된 따옴표 제거: "\"sk-ant-...\"" → sk-ant-...
                    var _clean = val.replace(/^"+|"+$/g, '');
                    if(_clean && !CLAUDE_API_KEY){
                        CLAUDE_API_KEY = _clean;
                        updateStatusBadge();
                    }
                }
            }).catch(function(){});
            var _apiKeyFirstLoad = true;
            db.ref('config/claude_api_key').on('value', function(snap){
                var _v = snap.val() || '';
                // SDK가 빈값을 반환해도 이미 REST로 로드된 키가 있으면 덮어쓰지 않음
                if(_v || !CLAUDE_API_KEY) CLAUDE_API_KEY = _v.replace(/^"+|"+$/g, '');
                updateStatusBadge();
                if(_apiKeyFirstLoad){
                    _apiKeyFirstLoad = false;
                    if(!CLAUDE_API_KEY){
                        setTimeout(function(){
                            addMsg('👋 안녕하세요! IMI PRO v49.0입니다.<br><br><strong>상단 배지를 클릭</strong>하여 Claude API 키를 입력해주세요.','bot');
                        },300);
                    }
                }
            });
        });

        // 비거래 감지 인페이지 알림 — Firebase imi_watch_alerts 리스너
        (function(){
            var _shownAlerts = {};
            var _startAt = Date.now();
            var _alertsRef = db.ref('imi_watch_alerts').limitToLast(20);
            function _setupWatchAlertListeners() {
                _alertsRef.off('child_added');
                _alertsRef.off('child_changed');
                _alertsRef.on('child_added', function(snap){
                    var d = snap.val();
                    if(!d || _shownAlerts[snap.key]) return;
                    if(d.done) return;
                    if(d.seen) {
                        // 이미 표시된 알림 — 재시작 시 깜빡임 안 함
                        return;
                    }
                    if((d.at||0) < _startAt - 300000) {
                        // 5분 이전 알림 — 1시간 이내만 깜빡임 (오래된 데이터 오작동 방지)
                        if((d.at||0) > _startAt - 3600000) {
                            if(typeof _startTabBlink==='function') _startTabBlink('비거래', d.count||0, 'watch');
                        }
                        return;
                    }
                    _shownAlerts[snap.key] = true;
                    db.ref('imi_watch_alerts/'+snap.key+'/seen').set(true);
                    _showWatchAlert(d, snap.key);
                });
                _alertsRef.on('child_changed', function(snap){
                    var d = snap.val();
                    if(d && d.done){
                        var el = document.getElementById('_imiWatchAlert');
                        if(el && el.dataset.alertKey === snap.key) el.remove();
                    }
                });
            }
            _setupWatchAlertListeners();
            firebase.auth().onAuthStateChanged(function(user){
                if(user) _setupWatchAlertListeners(); // auth 완료 후 재구독
            });
        })();

        // 거래번호 감시 배너 — 비거래 버튼(watchHeaderTab)이 보일 때만 표시
        var _watchBannerActive = [];
        function _syncWatchBanner() {
            var banner = document.getElementById('watchBanner');
            var watchTab = document.getElementById('watchHeaderTab');
            if(!banner) return;
            var tabVis = watchTab && watchTab.style.display === 'flex';
            if(!_watchBannerActive.length || !tabVis) {
                banner.style.display = 'none'; banner.innerHTML = ''; return;
            }
            banner.style.display = 'flex';
            var parts = ['<span style="white-space:nowrap;flex-shrink:0;">📦 비거래 노출 감지 —</span>'];
            _watchBannerActive.forEach(function(v, i){
                var label = escHtml(v.label || '');
                var tid = escHtml(v.tid || '');
                var inner = v.url
                    ? '<a href="'+escHtml(v.url)+'" target="_blank" style="color:#22c55e;text-decoration:underline;font-weight:900;">'+(label||'#'+tid)+'</a>'
                    : '<strong style="color:#22c55e;">'+(label||'#'+tid)+'</strong>';
                if(tid && label) inner += ' <span style="opacity:0.75;">(#'+(typeof _fmtTid==='function'?_fmtTid(tid):tid)+')</span>';
                if(i > 0) parts.push('<span style="white-space:nowrap;opacity:0.4;">|</span>');
                parts.push('<span style="white-space:nowrap;">'+inner+'</span>');
            });
            banner.innerHTML = parts.join('');
        }
        db.ref('imi_watch_banner').on('value', function(snap){
            var data = snap.val() || {};
            _watchBannerActive = Object.entries(data)
                .filter(function(e){ return e[1] && e[1].active && !e[0].startsWith('wsr_'); })
                .map(function(e){ return e[1]; });
            _syncWatchBanner();
        });

    };

    var _watchAlertMinimized = false;
    var _watchBlinkTimer = null;
    var _tabBlinkLabels = {};
    var _tabTitleTimer  = null;
    function _doTitleBlink(activeLabels) {
        if (_tabTitleTimer) { clearInterval(_tabTitleTimer); _tabTitleTimer = null; }
        if (activeLabels.length === 0) {
            document.title = 'IMI PRO';
            if (window.electronAPI) {
                if (window.electronAPI.flashFrame) window.electronAPI.flashFrame(false);
                if (window.electronAPI.blinkTitle) window.electronAPI.blinkTitle(false, []);
            }
            return;
        }
        if (window.electronAPI) {
            if (window.electronAPI.flashFrame) window.electronAPI.flashFrame(true);
            if (window.electronAPI.blinkTitle) window.electronAPI.blinkTitle(true, activeLabels);
        }
        var bt = activeLabels.length === 1
            ? ['🚨 ' + activeLabels[0] + ' 감지', 'IMI PRO']
            : activeLabels.map(function(l){ return '🚨 ' + l + ' 감지'; });
        var bi = 0;
        document.title = bt[0];
        _tabTitleTimer = setInterval(function(){ document.title = bt[bi++ % bt.length]; }, 900);
    }
    function _startTabBlink(label, count, type) {
        _tabBlinkLabels[type || 'default'] = label || '';
        _doTitleBlink(Object.values(_tabBlinkLabels));
    }
    function _stopTabBlink(type) {
        delete _tabBlinkLabels[type || 'default'];
        _doTitleBlink(Object.values(_tabBlinkLabels));
    }

    // 비거래 탭 사라지면 깜빡임 정지 (시작은 새 알림 감지 시에만)
    var _autoWatchBlink = false;
    setInterval(function() {
        if (!window.electronAPI || !window.electronAPI.blinkTitle) return;
        var tab = document.getElementById('watchHeaderTab');
        var visible = !!(tab && tab.offsetParent !== null && tab.innerHTML.trim() !== '');
        if (!visible && _autoWatchBlink) {
            _autoWatchBlink = false;
            window.electronAPI.blinkTitle(false, []);
        }
    }, 500);

    function _startWatchBlink() {
        if(_watchBlinkTimer) return;
        var on = false;
        _watchBlinkTimer = setInterval(function(){
            var t = document.getElementById('watchHeaderTab');
            if(!t || !_watchAlertMinimized){ _stopWatchBlink(); return; }
            on = !on;
            t.style.background = on ? 'rgba(34,197,94,0.55)' : 'rgba(34,197,94,0.15)';
            t.style.borderColor = on ? '#86efac' : '#22c55e';
        }, 425);
    }
    function _stopWatchBlink() {
        if(_watchBlinkTimer){ clearInterval(_watchBlinkTimer); _watchBlinkTimer = null; }
        var t = document.getElementById('watchHeaderTab');
        if(t){ t.style.background = ''; t.style.borderColor = ''; }
    }

    function _updateWatchFraudRow(){
        var w = document.getElementById('watchHeaderTab');
        var f = document.getElementById('fraudHeaderTab');
        var row = document.getElementById('watchFraudBtnRow');
        if(!row) return;
        var wVis = !!(w && w.style.display && w.style.display !== 'none');
        var fVis = !!(f && f.style.display && f.style.display !== 'none');
        row.style.display = (wVis || fVis) ? '' : 'none';
    }


    function _watchPanelToggle(){
        // watchPopup 모드면 하단 토스트 컨테이너 토글
        if(_notifPrefs && _notifPrefs.watchPopup) {
            var toasts = document.getElementById('_imi_watch_toasts');
            if(toasts) toasts.style.display = (toasts.style.display === 'none') ? '' : 'none';
            return;
        }
        var panel = document.getElementById('watchDropPanel');
        var tab   = document.getElementById('watchHeaderTab');
        if(!panel) return;
        var open = panel.style.maxHeight && panel.style.maxHeight !== '0px' && panel.style.maxHeight !== '4px';
        if(open){
            var hasItems = panel.querySelectorAll('[data-tid]').length > 0;
            if(hasItems){
                panel.style.maxHeight = '4px';
                panel.style.borderColor = '#22c55e';
                panel.classList.add('watch-panel-blink');
                _watchAlertMinimized = true;
                _startWatchBlink();
            } else {
                panel.style.maxHeight = '0px';
                panel.style.borderColor = 'transparent';
                panel.classList.remove('watch-panel-blink');
            }
        } else {
            panel.style.maxHeight = '75vh';
            panel.style.borderColor = '#22c55e';
            panel.style.borderWidth = '2px 2px 2px 2px';
            panel.classList.remove('watch-panel-blink');
            _watchAlertMinimized = false;
            _stopWatchBlink();
        }
    }

    function _fraudPanelToggle(){
        // popup 모드면 하단 토스트 컨테이너 토글
        if(_notifPrefs && _notifPrefs.popup) {
            var toasts = document.getElementById('_imi_fraud_toasts');
            if(toasts) {
                var wasHidden = toasts.style.display === 'none';
                toasts.style.display = wasHidden ? '' : 'none';
                if(wasHidden && typeof _removeChatBorderFlash === 'function') _removeChatBorderFlash();
            }
            return;
        }
        var panel = document.getElementById('fraudDropPanel');
        var tab   = document.getElementById('fraudHeaderTab');
        if(!panel) return;
        if(typeof _stopTabBlink === 'function') _stopTabBlink('fraud');
        var open = panel.style.maxHeight && panel.style.maxHeight !== '0px' && panel.style.maxHeight !== '4px';
        if(open){
            var hasItems = panel.querySelectorAll('[data-tid]').length > 0;
            if(hasItems){
                panel.style.maxHeight = '4px';
                panel.style.borderColor = '#ef4444';
                panel.classList.add('fraud-panel-blink');
                if(tab) tab.classList.add('hdr-tab-blink');
                _startTabBlink('사기글', 0, 'fraud');
            } else {
                panel.style.maxHeight = '0px';
                panel.style.borderColor = 'transparent';
                panel.classList.remove('fraud-panel-blink');
            }
        } else {
            panel.style.maxHeight = '75vh';
            panel.style.borderColor = '#ef4444';
            panel.classList.remove('fraud-panel-blink');
        }
    }

    function _showWatchAlert(data, alertKey){
        // watchPopup ON → 하단 팝업만 표시
        if(_notifPrefs && _notifPrefs.watchPopup){
            if(typeof _showInPagePopup==='function') _showInPagePopup('watch',{ruleName:data.label||'비거래',ruleKeyword:data.keyword||'',itemCount:data.count||0,itemRows:data.itemRows||[]});
            if(window.electronAPI && window.electronAPI.blinkTitle) { _autoWatchBlink = true; window.electronAPI.blinkTitle(true, ['비거래']); }
            // 상단바 탭 배지 표시
            var wTab = document.getElementById('watchHeaderTab');
            if(wTab) {
                wTab.style.display = 'flex'; _updateWatchFraudRow();
                wTab._popupCount = data.count || 0;
                wTab.innerHTML = '⚠️ 비거래&nbsp;<span style="background:#22c55e;color:#000;border-radius:99px;padding:0 6px;font-size:10px;font-weight:900;">'+wTab._popupCount+'</span>';
                _syncWatchBanner();
            }
            return;
        }
        var panel = document.getElementById('watchDropPanel');
        var tab   = document.getElementById('watchHeaderTab');
        if(!panel || !tab) return;

        // 기존 Firebase 리스너 정리
        if(panel._procRef && panel._procListener){ panel._procRef.off('value', panel._procListener); panel._procRef = null; }
        if(panel._doneRef && panel._doneListener){ panel._doneRef.off('value', panel._doneListener); panel._doneRef = null; }

        var tids     = data.tids || (data.tid ? [data.tid] : []);
        var itemRows = data.itemRows || [];
        var label    = data.label   || data.keyword || '감시 항목';
        var keyword  = data.keyword || '';
        var count    = data.count   || tids.length || 0;

        // 탭 표시 (패널 열린 상태면 깜빡임 없음)
        tab.style.display = 'flex'; _updateWatchFraudRow();
        tab.innerHTML = '⚠️ 비거래&nbsp;<span style="background:#22c55e;color:#000;border-radius:99px;padding:0 6px;font-size:10px;font-weight:900;">'+count+'</span>';
        if(_watchAlertMinimized) {
            _startWatchBlink();
        } else {
            _stopWatchBlink();
        }
        // 작업표시줄 깜빡임 — 새 비거래 감지 시 1회 시작
        if(window.electronAPI && window.electronAPI.blinkTitle) {
            _autoWatchBlink = true;
            window.electronAPI.blinkTitle(true, ['비거래']);
        }

        // 패널 내용 초기화
        panel.innerHTML = '';

        // 스티키 헤더 — 규칙명 + 개수 배지 + 키워드 접기/펼치기
        var panelHdr = document.createElement('div');
        panelHdr.style.cssText = 'position:sticky;top:0;z-index:2;padding:9px 14px 8px;background:rgba(34,197,94,0.08);border-bottom:2px solid rgba(34,197,94,0.5);flex-shrink:0;';

        // 1행: 규칙명 + 개수 배지
        var phRow1 = document.createElement('div');
        phRow1.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
        var panelHdrLabel = document.createElement('span');
        panelHdrLabel.style.cssText = 'font-size:12px;color:#16a34a;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;';
        panelHdrLabel.textContent = '🟢 '+label;
        var panelHdrCount = document.createElement('span');
        panelHdrCount.id = '_watchPanelCount';
        panelHdrCount.style.cssText = 'flex-shrink:0;font-size:12px;font-weight:900;background:#22c55e;color:#fff;border-radius:20px;padding:2px 10px;line-height:1.6;';
        panelHdrCount.textContent = count+'개';
        phRow1.appendChild(panelHdrLabel);
        phRow1.appendChild(panelHdrCount);
        panelHdr.appendChild(phRow1);

        // 2행: 키워드 (접힘 기본 — 5개까지만 표시)
        if(keyword && keyword !== label){
            var kwArr = keyword.split(',').map(function(k){return k.trim();}).filter(Boolean);
            var kwShort = kwArr.slice(0,5).join(', ')+(kwArr.length>5?' …':'');
            var phRow2 = document.createElement('div');
            phRow2.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:5px;';
            var kwSpan = document.createElement('span');
            kwSpan.style.cssText = 'flex:1;font-size:10px;color:var(--text-sub);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;';
            kwSpan.textContent = kwShort;
            phRow2.appendChild(kwSpan);
            if(kwArr.length > 5){
                var kwBtn = document.createElement('button');
                kwBtn.style.cssText = 'flex-shrink:0;font-size:10px;font-weight:700;color:#16a34a;background:none;border:1px solid rgba(34,197,94,0.45);border-radius:4px;padding:1px 7px;cursor:pointer;white-space:nowrap;transition:0.12s;';
                kwBtn.textContent = '자세히 ▼';
                var _kwOpen = false;
                kwBtn.onclick = function(){
                    _kwOpen = !_kwOpen;
                    if(_kwOpen){
                        kwSpan.style.whiteSpace='normal'; kwSpan.style.overflow=''; kwSpan.style.textOverflow='';
                        kwSpan.textContent = keyword;
                        kwBtn.textContent = '접기 ▲';
                    } else {
                        kwSpan.style.whiteSpace='nowrap'; kwSpan.style.overflow='hidden'; kwSpan.style.textOverflow='ellipsis';
                        kwSpan.textContent = kwShort;
                        kwBtn.textContent = '자세히 ▼';
                    }
                };
                phRow2.appendChild(kwBtn);
            }
            panelHdr.appendChild(phRow2);
        }
        panel.appendChild(panelHdr);

        var inner = document.createElement('div');
        inner.style.cssText = 'padding:8px 12px 10px;max-height:calc(75vh - 80px);overflow-y:auto;scrollbar-width:thin;scrollbar-color:#334155 transparent;';

        var tidContainer = document.createElement('div');
        tidContainer.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
        inner.appendChild(tidContainer);
        panel.appendChild(inner);

        function _updateTabBlink(){
            if(!document.contains(tidContainer)) return;
            var activeItems = Array.from(tidContainer.children).filter(function(r){ return !r.dataset.doneShown; }).length;
            if(_watchAlertMinimized && activeItems > 0){
                _startWatchBlink();
            } else {
                _stopWatchBlink();
            }
        }

        function _checkAllDone(){
            if(!document.contains(tidContainer)) return;
            if(!tidContainer.children.length){
                if(panel._procRef && panel._procListener){ panel._procRef.off('value', panel._procListener); panel._procRef = null; }
                if(panel._doneRef && panel._doneListener){ panel._doneRef.off('value', panel._doneListener); panel._doneRef = null; }
                if(alertKey) db.ref('imi_watch_alerts/'+alertKey+'/done').set(true);
                tab.style.display = 'none'; _updateWatchFraudRow();
                tab.innerHTML = '';
                panel.style.maxHeight = '0px';
                panel.style.borderColor = 'transparent';
                panel.innerHTML = '';
                _stopWatchBlink();
                if(typeof _stopTabBlink === 'function') _stopTabBlink('watch');
            } else {
                var remaining = Array.from(tidContainer.children).filter(function(r){ return !r.dataset.doneShown; }).length;
                panelHdrCount.textContent = remaining + '개';
                var tabSpan = tab.querySelector('span');
                if(tabSpan) tabSpan.textContent = remaining;
                _updateTabBlink();
            }
        }

        if(tids.length > 0){
            tids.forEach(function(tid){
                var rowData = itemRows.find(function(r){ return r.tid === tid; }) || {};
                var itemKey   = rowData.key || (rowData.t || '').substring(0,30).trim();
                var itemTitle = rowData.t || '';

                var row = document.createElement('div');
                row.dataset.tid = tid;
                row.style.cssText = 'display:flex;flex-direction:column;gap:0;background:var(--bg-card);border:2px solid rgba(34,197,94,0.5);border-radius:8px;overflow:hidden;';

                // 상단: 거래번호 + 물품명
                var infoArea = document.createElement('div');
                infoArea.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:7px 10px 6px;';

                var tidRow = document.createElement('div');
                tidRow.style.cssText = 'display:flex;align-items:center;gap:7px;';

                var tidLink = document.createElement('a');
                tidLink.href = 'https://www.itemmania.com/sell/application.html?id='+tid;
                tidLink.target = '_blank';
                tidLink.style.cssText = 'color:#38bdf8;text-decoration:none;font-weight:900;font-size:20px;letter-spacing:0.04em;white-space:nowrap;flex-shrink:0;';
                tidLink.textContent = '#'+(typeof _fmtTid==='function'?_fmtTid(tid):tid);
                tidRow.appendChild(tidLink);

                var _kw4Badge = rowData.matchedKw || '';
                if(_kw4Badge){
                    var kwBadgeEl = document.createElement('span');
                    kwBadgeEl.style.cssText = 'font-size:11px;font-weight:900;color:#22c55e;background:rgba(34,197,94,0.12);border:1.5px solid rgba(34,197,94,0.45);border-radius:12px;padding:2px 9px;flex-shrink:0;white-space:nowrap;';
                    kwBadgeEl.textContent = _kw4Badge;
                    tidRow.appendChild(kwBadgeEl);
                }
                infoArea.appendChild(tidRow);

                if(itemTitle){
                    var titleEl2 = document.createElement('div');
                    titleEl2.style.cssText = 'font-size:11px;color:var(--text-main);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
                    titleEl2.textContent = itemTitle;
                    infoArea.appendChild(titleEl2);
                }
                row.appendChild(infoArea);

                // 하단 액션 바: 필터제외(좌) — 처리완료(우)
                var actionBar = document.createElement('div');
                actionBar.setAttribute('data-actionbar','1');
                actionBar.style.cssText = 'display:flex;align-items:stretch;border-top:1px solid var(--border-ui);';

                if(itemKey){
                    var filterBtn = document.createElement('button');
                    filterBtn.textContent = '필터제외';
                    filterBtn.style.cssText = 'flex:1;padding:6px 0;font-size:10px;font-weight:900;background:none;border:none;border-right:1px solid var(--border-ui);color:#f87171;cursor:pointer;';
                    filterBtn.onclick = function(){
                        filterBtn.disabled = true;
                        filterBtn.textContent = '제외됨';
                        row.style.opacity = '0.4';
                        setTimeout(function(){ if(!document.contains(tidContainer)) return; row.remove(); _checkAllDone(); }, 600);
                        db.ref('/imi_blocked').once('value', function(snap){
                            var list = snap.val() || [];
                            if(!Array.isArray(list)) list = [];
                            var addedBy = (typeof _currentUser!=='undefined'&&_currentUser)?(_currentUser.name||''):'';
                            list.push({key:itemKey, title:itemTitle, tid:tid, addedBy:addedBy, addedAt:Date.now(), type:'watch'});
                            db.ref('/imi_blocked').set(list);
                        });
                    };
                    actionBar.appendChild(filterBtn);
                }

                var doneBtn = document.createElement('button');
                doneBtn.textContent = '✅ 처리완료';
                doneBtn.style.cssText = 'flex:1;padding:6px 0;font-size:10px;font-weight:900;background:none;border:none;color:#22c55e;cursor:pointer;';
                doneBtn.onclick = function(){
                    var byName = (typeof _currentUser!=='undefined'&&_currentUser)?(_currentUser.name||''):'';
                    db.ref('imi_watch_done/'+tid).set({at:Date.now(), by:byName});
                    if(alertKey) db.ref('imi_watch_alerts/'+alertKey+'/processedTids/'+tid).set(byName||true);
                    else { row.remove(); _checkAllDone(); }
                };
                actionBar.appendChild(doneBtn);
                row.appendChild(actionBar);
                tidContainer.appendChild(row);
            });

            // 처리자 표시 헬퍼
            function _markRowDone(r, byName) {
                if (r.dataset.doneShown) return;
                r.dataset.doneShown = '1';
                var ab = r.querySelector('[data-actionbar]');
                if (ab) {
                    ab.innerHTML = '<div style="flex:1;text-align:center;padding:5px 0;font-size:10px;font-weight:700;color:#22c55e;opacity:0.8;">✅ 처리완료'+(byName?' · '+byName:'')+'</div>';
                }
                r.style.opacity = '0.45';
                setTimeout(function(){ if(!document.contains(tidContainer)) return; r.remove(); _checkAllDone(); }, 4000);
            }

            if(alertKey){
                var procRef = db.ref('imi_watch_alerts/'+alertKey+'/processedTids');
                var procListener = procRef.on('value', function(snap){
                    var processed = snap.val() || {};
                    Array.from(tidContainer.querySelectorAll('[data-tid]')).forEach(function(r){
                        var v = processed[r.dataset.tid];
                        if(!v) return;
                        _markRowDone(r, typeof v==='string' ? v : '');
                    });
                    _checkAllDone();
                });
                panel._procRef = procRef; panel._procListener = procListener;
            }
            var _alertOpenedAt = Date.now();
            var doneRef = db.ref('imi_watch_done');
            var doneListener = doneRef.on('value', function(snap){
                var doneObj = snap.val() || {};
                Array.from(tidContainer.querySelectorAll('[data-tid]')).forEach(function(r){
                    var v = doneObj[r.dataset.tid];
                    if(!v) return;
                    // 이 알림 팝업이 열린 이후에 처리된 것만 반영
                    // (이전 세션의 처리완료 기록이 새 알림을 자동으로 닫는 버그 방지)
                    var at = typeof v === 'object' ? (v.at || 0) : 0;
                    if(at < _alertOpenedAt) return;
                    var byName = typeof v==='object' ? (v.by||'') : '';
                    _markRowDone(r, byName);
                });
                _checkAllDone();
            });
            panel._doneRef = doneRef; panel._doneListener = doneListener;
        }

        // 패널 열기 (최소화 상태면 탭만 표시)
        if(!_watchAlertMinimized){
            panel.style.maxHeight = '75vh';
            panel.style.borderColor = '#22c55e';
            panel.style.borderWidth = '2px 2px 2px 2px';
        }
    }

    db.ref('notices_mania').on('value',function(s){
        allNotices.mania=s.val()||{};
        if(currentMode==='mania'){
            renderNotices();
            if(!document.getElementById('allNoticesModal').classList.contains('hidden'))renderAllNotices();
        }
    });
    db.ref('notices_bay').on('value',function(s){
        allNotices.bay=s.val()||{};
        if(currentMode==='bay'){
            renderNotices();
            if(!document.getElementById('allNoticesModal').classList.contains('hidden'))renderAllNotices();
        }
    });
    db.ref('urgent_notices').on('value',function(s){
        urgentNotices=s.val()||{};
        updateTicker();
        updateBellBadge();
        if(!document.getElementById('urgentHistoryModal').classList.contains('hidden')) renderUrgentHistoryModal();
        if(!document.getElementById('urgentDetailModal').classList.contains('hidden')) refreshUrgentDetail();
    });
    db.ref('tmpl_mania').on('value',function(s){allTemplates.mania=s.val()||{};});
    db.ref('tmpl_bay').on('value',function(s){allTemplates.bay=s.val()||{};});

    // ── Electron 자동 업데이트 UI ──────────────────────────
    function _installAndRestart(){
        if(window.electronAPI && window.electronAPI.installUpdate){
            window.electronAPI.installUpdate();
        }
    }

    (function(){
        if(!window.electronAPI || !window.electronAPI.onUpdateStatus) return;
        var overlay  = document.getElementById('updateOverlay');
        var icon     = document.getElementById('upd-icon');
        var title    = document.getElementById('upd-title');
        var sub      = document.getElementById('upd-sub');
        var bar      = document.getElementById('upd-bar');
        var pct      = document.getElementById('upd-pct');
        var restBtn  = document.getElementById('upd-restart-btn');
        var note     = document.getElementById('upd-note');

        window.electronAPI.onUpdateStatus(function(data){
            overlay.style.display = 'none'; /* 기존 큰 오버레이는 항상 숨김 */
            if(data.type === 'downloaded'){
                /* 작은 토스트 배너 — 8초 후 자동 사라짐 */
                var old = document.getElementById('_updToast');
                if(old) old.remove();
                var t = document.createElement('div');
                t.id = '_updToast';
                t.style.cssText = 'position:fixed;top:56px;right:24px;z-index:99999;'
                    +'background:#1e293b;border:1.5px solid #22c55e;border-radius:12px;'
                    +'padding:12px 18px;display:flex;align-items:center;gap:12px;'
                    +'box-shadow:0 4px 20px rgba(0,0,0,0.5);font-size:12px;color:#e2e8f0;'
                    +'animation:_toastIn 0.3s ease;max-width:320px;';
                t.innerHTML = '<span style="font-size:18px;">✅</span>'
                    +'<div><div style="font-weight:900;color:#22c55e;margin-bottom:2px;">업데이트 준비 완료 (v'+data.version+')</div>'
                    +'<div style="opacity:0.7;font-size:11px;">다음에 껐다 켜면 자동 적용됩니다.</div></div>'
                    +'<span onclick="this.parentNode.remove()" style="cursor:pointer;opacity:0.4;font-size:16px;margin-left:4px;">✕</span>';
                document.body.appendChild(t);
                setTimeout(function(){ if(t.parentNode) t.remove(); }, 8000);
            }
        });
    })();
