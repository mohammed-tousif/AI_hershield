/* Shared mobile panel behavior; capture avoids competing legacy click handlers. */
(() => {
    'use strict';
    let returnFocus = null;
    const byId = id => document.getElementById(id);
    function closePanels(restore = true) {
        ['sidebar','quickActionsPanel','mobileOverlay'].forEach(id => byId(id)?.classList.remove('active'));
        document.body.classList.remove('mobile-menu-open', 'hs-admin-open');
        ['fixedSidebarToggle','fixedActionsToggle','hsAdminMenu'].forEach(id => byId(id)?.setAttribute('aria-expanded','false'));
        if (restore && returnFocus?.isConnected) returnFocus.focus();
    }
    function prepare() {
        byId('sidebarCloseBtn')?.setAttribute('aria-label', 'Close navigation');
        byId('closeQuickActions')?.setAttribute('aria-label', 'Close quick actions');
        document.querySelectorAll('.modal').forEach(modal => {
            if (modal.parentElement !== document.body) document.body.appendChild(modal);
            modal.querySelectorAll('.btn-close').forEach(button => button.setAttribute('aria-label', 'Close dialog'));
        });
        [['fixedSidebarToggle','Open navigation','sidebar'],['fixedActionsToggle','Open quick actions','quickActionsPanel']].forEach(([id,label,panel]) => {
            const button = byId(id); if (!button) return;
            button.setAttribute('aria-label', label); button.setAttribute('aria-controls',panel);
            if (!button.hasAttribute('aria-expanded')) button.setAttribute('aria-expanded','false');
        });
    }
    document.addEventListener('click', event => {
        const trigger = event.target.closest('#fixedSidebarToggle,#fixedActionsToggle,#sidebarCloseBtn,#closeQuickActions,#mobileOverlay,#hsAdminMenu,#hsAdminOverlay');
        if (!trigger) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const id = trigger.id;
        if (id === 'hsAdminMenu') {
            const opening = !document.body.classList.contains('hs-admin-open'); closePanels(false);
            if (opening) { returnFocus = trigger; document.body.classList.add('hs-admin-open'); trigger.setAttribute('aria-expanded','true'); document.querySelector('.sidebar a,.sidebar button')?.focus(); }
            return;
        }
        const panelId = id === 'fixedSidebarToggle' ? 'sidebar' : id === 'fixedActionsToggle' ? 'quickActionsPanel' : null;
        const opening = panelId && !byId(panelId)?.classList.contains('active');
        closePanels();
        if (opening) {
            returnFocus = trigger; byId(panelId)?.classList.add('active'); byId('mobileOverlay')?.classList.add('active');
            document.body.classList.add('mobile-menu-open'); trigger.setAttribute('aria-expanded','true');
            byId(panelId)?.querySelector('button,a')?.focus();
        }
    }, true);
    document.addEventListener('show.bs.modal', () => closePanels(false));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closePanels();
        if (event.key !== 'Tab' || document.querySelector('.modal.show')) return;
        const panel = document.querySelector('.hershield-sidebar.active,.quick-actions-panel.active,body.hs-admin-open .sidebar');
        if (!panel) return;
        const items = [...panel.querySelectorAll('button,a[href],input,select,textarea')].filter(el => !el.disabled && el.getClientRects().length);
        if (!items.length) return;
        const first=items[0], last=items.at(-1);
        if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first.focus(); }
    });
    document.addEventListener('DOMContentLoaded', () => {
        if (location.pathname.endsWith('/admin-dashboard.html')) {
            document.body.classList.add('hs-admin');
            const button=document.createElement('button'); button.id='hsAdminMenu'; button.className='hs-admin-menu'; button.textContent='☰'; button.setAttribute('aria-label','Toggle admin navigation'); button.setAttribute('aria-expanded','false');
            const overlay=document.createElement('div'); overlay.id='hsAdminOverlay'; overlay.className='hs-admin-overlay';
            document.body.append(button,overlay);
            document.querySelectorAll('.sidebar .nav-item').forEach(item => item.addEventListener('click',()=>closePanels()));
        }
        prepare();
        new MutationObserver(prepare).observe(document.body,{childList:true,subtree:true});
    });
})();
