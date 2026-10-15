// ==UserScript==
// @name         BWF World Tour — local match times
// @namespace    https://github.com/dfilippovsky/bwf-localtime
// @version      1.0.7
// @description  Shows BWF World Tour match start times in your own timezone instead of the stadium's.
// @match        https://bwfworldtour.bwfbadminton.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // The schedule widget fetches matches from this endpoint (axios -> XMLHttpRequest).
    const API_RE = /extranet-lv\.bwfbadminton\.com\/api\/tournaments\/day-matches(\?|$)/;
    const STORAGE_KEY = 'bwfLocalTime.mode'; // 'local' | 'stadium'

    function getMode() {
        try { return localStorage.getItem(STORAGE_KEY) || 'local'; } catch (e) { return 'local'; }
    }
    function setMode(mode) {
        try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) { /* ignore */ }
    }

    const pad = n => String(n).padStart(2, '0');

    // "2026-10-15 07:00:00" (UTC) -> "2026-10-15 09:00:00" in the browser's timezone.
    function utcToLocalString(utc) {
        const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(utc);
        if (!m) return null;
        const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
            `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    // Recursively rewrite matchTime for every match (team ties carry nested `matches`).
    function localize(node) {
        if (Array.isArray(node)) {
            node.forEach(localize);
        } else if (node && typeof node === 'object') {
            if (typeof node.matchTimeUtc === 'string') {
                const local = utcToLocalString(node.matchTimeUtc);
                if (local) {
                    node.matchTimeStadium = node.matchTime;
                    node.matchTime = local;
                }
            }
            Object.values(node).forEach(v => { if (v && typeof v === 'object') localize(v); });
        }
        return node;
    }

    // Patch XMLHttpRequest so the page's Vue component receives already-localized times.
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        this.__bwfLocalize = API_RE.test(String(url));
        return origOpen.apply(this, arguments);
    };

    const textDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
    const respDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');

    function transformedText(xhr) {
        const raw = textDesc.get.call(xhr);
        if (!xhr.__bwfLocalize || getMode() !== 'local' || xhr.readyState !== 4 || !raw) return raw;
        if (xhr.__bwfCache && xhr.__bwfCache.raw === raw) return xhr.__bwfCache.out;
        let out = raw;
        try { out = JSON.stringify(localize(JSON.parse(raw))); } catch (e) { /* leave as is */ }
        xhr.__bwfCache = { raw, out };
        return out;
    }

    Object.defineProperty(XMLHttpRequest.prototype, 'responseText', {
        configurable: true,
        get() { return transformedText(this); },
    });
    Object.defineProperty(XMLHttpRequest.prototype, 'response', {
        configurable: true,
        get() {
            if (this.__bwfLocalize && (this.responseType === '' || this.responseType === 'text')) {
                return transformedText(this);
            }
            return respDesc.get.call(this);
        },
    });

    // The site already has "Stadium Time / Your Time" buttons that do nothing. Make them work.
    document.addEventListener('click', e => {
        const btn = e.target.closest && e.target.closest('input[type="button"]');
        if (!btn) return;
        const mode = btn.value === 'Your Time' ? 'local' : btn.value === 'Stadium Time' ? 'stadium' : null;
        if (!mode || mode === getMode()) return;
        setMode(mode);
        location.reload();
    }, true);

    // Small badge so it's obvious which time is shown.
    function addBadge() {
        if (document.getElementById('bwf-localtime-badge')) return;
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const local = getMode() === 'local';
        const b = document.createElement('div');
        b.id = 'bwf-localtime-badge';
        b.title = 'Click to switch between your time and stadium time';
        b.textContent = local ? `TZ: ${tz}` : 'TZ: Stadium';
        b.style.cssText = 'position:fixed;top:0;left:12px;z-index:99999;padding:6px 10px;' +
            'border-radius:6px;font:12px/1.3 system-ui,sans-serif;cursor:pointer;color:#fff;' +
            `background:${local ? '#df2027' : '#6e7781'};box-shadow:0 2px 6px rgba(0,0,0,.3);` +
            'will-change:transform';
        b.addEventListener('click', () => { setMode(local ? 'stadium' : 'local'); location.reload(); });
        document.body.appendChild(b);
        followHeader(b);
    }

    // The site's red top header (largest-bottom header-like strip at the top of the viewport).
    function findHeader() {
        let best = null, bestBottom = -Infinity;
        document.querySelectorAll('header, nav, [class*="header" i]').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.height < 20 || r.height > 250 || r.top > 10 || r.width < window.innerWidth / 2) return;
            if (r.bottom > bestBottom) { best = el; bestBottom = r.bottom; }
        });
        return best;
    }

    // Keep the badge just below the header every frame, so it moves together with the header
    // while it shrinks/grows on scroll; once the header scrolls away, stick to the top.
    function followHeader(b) {
        let header = null, lastY = null, frame = 0;
        (function tick() {
            // Vue renders the header late and may swap it, so re-detect it now and then.
            if (!header || !header.isConnected || frame++ % 60 === 0) header = findHeader();
            const bottom = header ? header.getBoundingClientRect().bottom : 72;
            const y = Math.round(Math.max(8, bottom + 8));
            if (y !== lastY) { b.style.transform = `translateY(${y}px)`; lastY = y; }
            requestAnimationFrame(tick);
        })();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addBadge);
    } else {
        addBadge();
    }
})();
