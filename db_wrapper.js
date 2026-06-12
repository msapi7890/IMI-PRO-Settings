(function(){
'use strict';

var _API = 'http://1.221.202.77:20002/api.php';

function _post(body){
    return fetch(_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
        .then(function(r){return r.json();})
        .then(function(r){if(!r.ok)throw new Error(r.error||'API오류');return r.data;});
}

function _snap(path,val){
    return {
        val:function(){return val;},
        key:path?path.split('/').pop():null,
        exists:function(){return val!==null&&val!==undefined;},
        forEach:function(cb){
            if(val&&typeof val==='object'){
                Object.keys(val).forEach(function(k){cb(_snap(path+'/'+k,val[k]));});
            }
        },
        child:function(cp){return _snap(path+'/'+cp,val&&typeof val==='object'?val[cp]:undefined);}
    };
}

function _makeRef(path,opts){
    path=(path||'').replace(/^\/+/,'').replace(/\/+$/,'');
    opts=opts||{};
    var _listeners=[];

    function _get(){return _post({action:'get',path:path});}

    function _limit(val){
        if(!opts.limitToLast)return val;
        if(val&&typeof val==='object'&&!Array.isArray(val)){
            var keys=Object.keys(val).sort();
            if(keys.length>opts.limitToLast){
                var r={};keys.slice(-opts.limitToLast).forEach(function(k){r[k]=val[k];});return r;
            }
        }
        return val;
    }

    var self={
        key:path?path.split('/').pop():null,

        child:function(cp){return _makeRef(path?path+'/'+cp:cp);},

        once:function(evt,cb){
            var p=_get().then(function(val){
                val=_limit(val);
                var s=_snap(path,val);if(cb)cb(s);return s;
            }).catch(function(e){
                console.warn('[DB:once]',path,e.message);
                var s=_snap(path,null);if(cb)cb(s);return s;
            });
            return p;
        },

        on:function(evt,cb,errCb){
            self.once(evt,cb);
            var timer=setInterval(function(){
                _get().then(function(val){cb(_snap(path,_limit(val)));}).catch(function(e){if(errCb)errCb(e);});
            },30000);
            _listeners.push({evt:evt,cb:cb,timer:timer});
            return cb;
        },

        off:function(evt,cb){
            _listeners=_listeners.filter(function(l){
                if(l.evt===evt&&l.cb===cb){clearInterval(l.timer);return false;}
                return true;
            });
        },

        set:function(data,cb){
            return _post({action:'set',path:path,data:data})
                .then(function(){if(cb)cb(null);}).catch(function(e){if(cb)cb(e);});
        },

        update:function(data,cb){
            return _post({action:'update',path:path,data:data})
                .then(function(){if(cb)cb(null);}).catch(function(e){if(cb)cb(e);});
        },

        remove:function(cb){
            return _post({action:'remove',path:path})
                .then(function(){if(cb)cb(null);}).catch(function(e){if(cb)cb(e);});
        },

        push:function(data,cb){
            return _post({action:'push',path:path,data:data}).then(function(r){
                var newRef=_makeRef(path+'/'+(r&&r.key?r.key:Date.now()));
                if(cb)cb(null,newRef);return newRef;
            }).catch(function(e){if(cb)cb(e);});
        },

        limitToLast:function(n){return _makeRef(path,{limitToLast:n});},
        orderByChild:function(){return self;},
        equalTo:function(){return self;},
        toString:function(){return path;}
    };
    return self;
}

window._mysqlDb={
    ref:function(path){return _makeRef(path||'');}
};

})();
