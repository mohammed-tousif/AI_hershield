/** Read-only, expiring share-link viewer. No login or private profile access. */
(() => {
    'use strict';
    const params=new URLSearchParams(location.search);
    if (!params.has('code') && !params.has('track')) return;
    const code=params.get('code');
    document.addEventListener('DOMContentLoaded', () => {
        const shell=document.createElement('section'); shell.id='viewerMode';
        shell.style.cssText='position:fixed;inset:0;z-index:210000;background:#fff8f2;display:grid;grid-template-rows:auto auto minmax(0,1fr);font-family:system-ui;';
        shell.innerHTML='<header style="padding:16px;display:flex;gap:12px;flex-wrap:wrap;background:#713c32;color:white"><strong>HerShield · Shared journey</strong><span id="viewerStatusText" role="status">Connecting…</span></header><div style="padding:12px;display:flex;gap:12px;flex-wrap:wrap"><span id="viewerCoords">Waiting for location</span><span id="viewerLastUpdate"></span><a id="viewerOpenMaps" target="_blank" rel="noopener noreferrer" hidden>Open in Maps</a></div><div style="position:relative;min-height:0"><div id="viewerMap" style="position:absolute;inset:0"></div><p id="viewerWaitingMsg" style="position:relative;background:#fff;padding:16px;margin:12px">Connecting to the journey…</p></div>';
        document.body.appendChild(shell);
        const status=document.getElementById('viewerStatusText'), message=document.getElementById('viewerWaitingMsg');
        let ended=false, timer=null, socket=null, map=null, marker=null, accuracyCircle=null, polling=false;
        function stop(text) { ended=true; clearInterval(timer); socket?.disconnect(); status.textContent='Sharing ended'; message.hidden=false; message.textContent=text; }
        if (!/^[A-F0-9]{64}$/.test(code || '')) { stop('This old or invalid link cannot be used. Ask the sender to start a new journey and share its new link.'); return; }
        function apply(data) {
            if (ended || !Number.isFinite(data.lat) || !Number.isFinite(data.lng)) return;
            const age=Date.now()-Date.parse(data.timestamp);
            status.textContent=Number.isFinite(age)&&age<30000?'Receiving recent locations':'Location may be stale';
            document.getElementById('viewerCoords').textContent=data.lat.toFixed(5)+', '+data.lng.toFixed(5);
            document.getElementById('viewerLastUpdate').textContent=(data.timestamp?'Updated '+new Date(data.timestamp).toLocaleTimeString():'Update time unavailable')+(Number.isFinite(data.accuracy)?' · accuracy ±'+Math.round(data.accuracy)+' m':' · accuracy unknown');
            const link=document.getElementById('viewerOpenMaps'); link.href='https://maps.google.com/?q='+data.lat+','+data.lng; link.hidden=false;
            if (!window.google?.maps) { message.textContent='Map unavailable. Use Open in Maps to view the last reported position.'; return; }
            message.hidden=true; const position={lat:data.lat,lng:data.lng};
            if (!map) { map=new google.maps.Map(document.getElementById('viewerMap'),{center:position,zoom:16}); marker=new google.maps.Marker({map,position}); }
            else { marker.setPosition(position); map.panTo(position); }
            if (Number.isFinite(data.accuracy)) {
                if (!accuracyCircle) accuracyCircle=new google.maps.Circle({map,strokeColor:'#9b4938',strokeWeight:1,fillColor:'#ff9a86',fillOpacity:.15});
                accuracyCircle.setCenter(position); accuracyCircle.setRadius(data.accuracy);
            }
        }
        async function poll() {
            if (ended || polling) return;
            polling=true;
            try {
                const response=await fetch('/api/live-tracker/view/'+encodeURIComponent(code));
                const data=await response.json();
                if (ended) return;
                if (response.status===410) { stop(data.message); return; }
                if (!response.ok || !data.success) throw new Error('Location service unavailable');
                if (data.lat==null) { status.textContent='Waiting for GPS'; message.textContent='The sender has not shared a position yet.'; return; }
                apply(data);
            } catch { if (!ended) status.textContent='Connection lost — retrying'; }
            finally { polling=false; }
        }
        if (window.io) {
            socket=io(window.HERSHIELD_BACKEND || location.origin,{transports:['polling']});
            socket.on('connect',()=>socket.emit('joinSession',{code}, result=>{if(!result?.success) poll();}));
            socket.on('locationUpdated',()=>poll()); // REST rechecks expiry/revocation before display.
            socket.on('sessionEnded',()=>stop('The sender ended sharing, or this link expired.'));
            socket.on('trackingUnavailable',()=>{status.textContent='Location service unavailable';});
        }
        poll(); timer=setInterval(poll,10000);
        window.addEventListener('pagehide',()=>{clearInterval(timer);socket?.disconnect();},{once:true});
    });
})();
