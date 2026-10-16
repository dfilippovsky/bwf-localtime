// ==UserScript==
// @name         BWF Match Centre — skip app popup, open Order of Play
// @namespace    https://github.com/dfilippovsky/bwf-localtime
// @version      1.0.0
// @description  Stops the "Stay Updated with BWF" app popup on match-centre.bwfbadminton.com and goes straight to the tournament's Order of Play.
// @author       DF
// @license      MIT
// @homepageURL  https://github.com/dfilippovsky/bwf-localtime
// @supportURL   https://github.com/dfilippovsky/bwf-localtime/issues
// @downloadURL  https://raw.githubusercontent.com/dfilippovsky/bwf-localtime/master/bwf-matchcentre.user.js
// @updateURL    https://raw.githubusercontent.com/dfilippovsky/bwf-localtime/master/bwf-matchcentre.user.js
// @match        https://match-centre.bwfbadminton.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // Set to false to only suppress the popup and stay on the match centre page.
    const AUTO_ORDER_OF_PLAY = true;
    // The Order of Play link gets its href once the tournament data loads; give up after this.
    const WATCH_MS = 20000;

    // The site hides its banners when these cookies are set, but its own close button
    // sets them for one day only — hence the popup on (almost) every visit.
    // HeroAppBanner (the full-screen one) checks "hero_app_banner_closed",
    // BottomPopupBanner (mobile) checks "bannerClosed".
    // 400 days is the cap Chrome enforces anyway; the cookie is refreshed on every visit.
    const expires = new Date(Date.now() + 400 * 864e5).toUTCString();
    for (const name of ['hero_app_banner_closed', 'bannerClosed']) {
        document.cookie = `${name}=true; expires=${expires}; path=/`;
    }

    // Belt and braces, in case the cookie names change. HeroAppBanner renders
    // <div class="background-darkener"> immediately followed by <div class="hero-app-banner">,
    // so only the darkener directly preceding the banner is hidden.
    const style = document.createElement('style');
    style.textContent = '.hero-app-banner, .background-darkener:has(+ .hero-app-banner) ' +
        '{ display: none !important; }';
    (document.head || document.documentElement).appendChild(style);

    // Only the tournament landing page (/5210) redirects, and only on a fresh visit,
    // so Back / Reload still let you look at the match centre itself.
    function shouldRedirect() {
        if (!AUTO_ORDER_OF_PLAY || !/^\/\d+\/?$/.test(location.pathname)) return false;
        const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
        return !nav || nav.type === 'navigate';
    }
    if (!shouldRedirect()) return;

    // <div class="current-tmt-link"><a href="{tmtLink}" target="_self"> Order of Play <img></a></div>
    function orderOfPlayHref() {
        for (const a of document.querySelectorAll('.current-tmt-link a[href]')) {
            if (/order\s+of\s+play/i.test(a.textContent) && /^https?:/i.test(a.href)) return a.href;
        }
        return null;
    }

    let done = false;
    function tryRedirect() {
        if (done) return;
        const href = orderOfPlayHref();
        if (!href) return;
        done = true;
        observer.disconnect();
        location.assign(href);
    }

    const observer = new MutationObserver(tryRedirect);
    observer.observe(document.documentElement, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['href'],
    });
    setTimeout(() => observer.disconnect(), WATCH_MS);
    tryRedirect();
})();
