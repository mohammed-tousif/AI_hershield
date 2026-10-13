/** Shared API routing and Firebase bearer-token transport. Load before page scripts. */
(function () {
    'use strict';
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
    const backend = local ? location.origin : 'https://ai-hershield.onrender.com';
    window.HERSHIELD_BACKEND = backend;
    window.HERSHIELD_FRONTEND = local ? location.origin : 'https://hershield-web.web.app';
    window.hsEscapeHTML = value => String(value ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
    const originalFetch = window.fetch.bind(window);
    window.hsWithTimeout = function (promise, ms, message = 'The connection is taking too long. Please retry.') {
        let timer;
        return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]).finally(() => clearTimeout(timer));
    };
    window.hsConnectionNotice = function (message) {
        if (!document.body) return;
        let banner = document.getElementById('hsConnectionNotice');
        if (!banner) {
            banner = document.createElement('aside'); banner.id = 'hsConnectionNotice'; banner.setAttribute('role','status');
            const text=document.createElement('span'); text.className='hs-connection-message';
            const retry=document.createElement('button'); retry.type='button'; retry.textContent='Retry connection';
            retry.addEventListener('click',async()=>{
                retry.disabled=true;
                try { const response=await originalFetch(backend+'/api/health',{signal:AbortSignal.timeout(15000)}); if(!response.ok) throw new Error(); banner.remove(); window.dispatchEvent(new Event('hershield:retry')); }
                catch { text.textContent='Still unable to reach the server. Check your connection and try again.'; }
                finally { retry.disabled=false; }
            });
            const dismiss=document.createElement('button'); dismiss.type='button'; dismiss.textContent='×'; dismiss.setAttribute('aria-label','Dismiss connection notice'); dismiss.onclick=()=>banner.remove();
            banner.append(text,retry,dismiss); document.body.appendChild(banner);
        }
        banner.querySelector('.hs-connection-message').textContent=message;
    };
    window.addEventListener('offline',()=>window.hsConnectionNotice('You are offline. Live location and alerts cannot be sent until the connection returns.'));
    let authModule;
    window.getHerShieldToken = async function () {
        authModule ||= import('./firebase-config.js').catch(error => { authModule = null; throw error; });
        const { auth } = await window.hsWithTimeout(authModule, 15000);
        await window.hsWithTimeout(auth.authStateReady(), 15000);
        return auth.currentUser ? window.hsWithTimeout(auth.currentUser.getIdToken(), 15000) : null;
    };
    window.getHerShieldUser = async function () {
        authModule ||= import('./firebase-config.js').catch(error => { authModule = null; throw error; });
        const { auth } = await window.hsWithTimeout(authModule, 15000); await window.hsWithTimeout(auth.authStateReady(), 15000); return auth.currentUser;
    };
    const publicPaths = new Set(['/api/health','/api/dashboard/stats','/api/legal/topics',
        '/api/community/posts','/api/community/alerts','/api/community/incident-reports',
        '/api/safety/heatmap','/api/safety/incidents','/api/safety/incident-points',
        '/api/safety/stats','/api/safety/locations','/api/safety/locations/stats']);
    const publicCache = new Map();
    const inFlight = new Map();
    window.fetch = async function (input, init) {
        const source = input instanceof Request ? input.url : String(input);
        let url = new URL(source, location.href);
        const trusted = url.origin === location.origin || url.origin === backend;
        if (!trusted || !url.pathname.startsWith('/api/')) return originalFetch(input, init);
        if (url.origin === location.origin) url = new URL(url.pathname + url.search, backend);
        const request = new Request(url, input instanceof Request ? input : undefined);
        const options = { ...init };
        const headers = new Headers(init?.headers || request.headers);
        const method = (init?.method || request.method || 'GET').toUpperCase();
        const publicRead = ['GET','HEAD'].includes(method) && (publicPaths.has(url.pathname) || url.pathname.startsWith('/api/live-tracker/view/'));
        const cacheable = method === 'GET' && publicPaths.has(url.pathname) && !init?.signal && !(input instanceof Request) && !headers.has('Authorization');
        const key=url.href;
        if(cacheable && publicCache.get(key)?.until>Date.now()) return publicCache.get(key).response.clone();
        if(cacheable && inFlight.has(key)) return (await inFlight.get(key)).clone();
        const controller = new AbortController();
        const callerSignal=init?.signal || (input instanceof Request ? input.signal : null);
        const onAbort=()=>controller.abort(callerSignal.reason);
        if(callerSignal?.aborted) onAbort(); else callerSignal?.addEventListener('abort',onAbort,{once:true});
        const timeoutMs = method==='GET' ? 15000 : init?.body instanceof FormData ? 45000 : 30000;
        // hsQuiet: background telemetry (live location pings) whose caller shows its own status.
        const quiet = init?.hsQuiet === true;
        const timer=setTimeout(()=>controller.abort(new DOMException('Request timed out','TimeoutError')),timeoutMs);
        const slow=setTimeout(()=>{ if(!quiet) window.hsConnectionNotice('This is taking longer than usual. The server may be waking up; you can still use navigation.'); },5000);
        const execute=(async()=>{
            try {
                if (!headers.has('Authorization') && !publicRead && !url.pathname.startsWith('/api/admin/')) {
                    const token=await window.hsWithTimeout(window.getHerShieldToken(),timeoutMs);
                    if (token) headers.set('Authorization','Bearer '+token);
                }
                options.headers=headers; options.signal=controller.signal;
                const response=await originalFetch(request,options);
                // Keep the deadline active through response-body download too.
                const bytes=await response.arrayBuffer();
                const complete=new Response([204,205,304].includes(response.status) || method==='HEAD' ? null : bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
                if(cacheable && response.ok) {
                    if(publicCache.size>30) publicCache.clear();
                    publicCache.set(key,{until:Date.now()+15000,response:complete.clone()});
                }
                if(!['GET','HEAD'].includes(method)) publicCache.clear();
                const notice=document.querySelector('#hsConnectionNotice .hs-connection-message');
                if (response.ok && notice?.textContent.startsWith('This is taking longer')) notice.parentElement.remove();
                return complete;
            } catch(error) {
                const text=method==='GET'?'Unable to load this information. Check your connection and retry.':'The server did not confirm this action. Check its status before trying again to avoid sending it twice.';
                if(!callerSignal?.aborted && !quiet) window.hsConnectionNotice(text);
                throw new Error(text,{cause:error});
            } finally {
                clearTimeout(timer);clearTimeout(slow);callerSignal?.removeEventListener('abort',onAbort);inFlight.delete(key);
            }
        })();
        if(cacheable) inFlight.set(key,execute);
        return (await execute).clone();
    };
})();
