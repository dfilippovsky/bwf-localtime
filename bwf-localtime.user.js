// ==UserScript==
// @name         BWF World Tour — local match times
// @namespace    https://github.com/dfilippovsky/bwf-localtime
// @version      1.1.0
// @description  Shows BWF World Tour match start times in your own timezone instead of the stadium's.
// @author       Dan Filippovsky
// @license      MIT
// @homepageURL  https://github.com/dfilippovsky/bwf-localtime
// @supportURL   https://github.com/dfilippovsky/bwf-localtime/issues
// @downloadURL  https://raw.githubusercontent.com/dfilippovsky/bwf-localtime/master/bwf-localtime.user.js
// @updateURL    https://raw.githubusercontent.com/dfilippovsky/bwf-localtime/master/bwf-localtime.user.js
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
    const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

    // 'ok' — times converted; 'na' — the API answered in an unexpected format, times left as is.
    let status = 'ok';

    // "2026-10-15 07:00:00" (UTC) -> "2026-10-15 09:00:00" in the browser's timezone.
    function utcToLocalString(utc) {
        const m = DATE_TIME_RE.exec(utc);
        if (!m) return null;
        const d = new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
            `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    // Whole days between the stadium date and the local date of the same match (-1, 0, +1).
    function dayShift(stadium, local) {
        const a = DATE_TIME_RE.exec(stadium), b = DATE_TIME_RE.exec(local);
        if (!a || !b) return 0;
        return Math.round((Date.UTC(+b[1], b[2] - 1, +b[3]) - Date.UTC(+a[1], a[2] - 1, +a[3])) / 864e5);
    }

    // Local "HH:MM" -> { shift, date } for matches that land on another day in the user's zone.
    // Filled while localizing, used to put "+1"/"−1" marks next to the rendered times.
    const shiftedTimes = new Map();

    function rememberShift(stadium, local) {
        const shift = dayShift(stadium, local);
        const key = local.slice(11, 16);
        const prev = shiftedTimes.get(key);
        // The same local time on different days would be ambiguous — don't mark it at all.
        if (prev && prev.shift !== shift) shiftedTimes.set(key, { shift: 0 });
        else if (!prev) shiftedTimes.set(key, { shift, date: local.slice(0, 10) });
    }

    // Recursively rewrite matchTime for every match (team ties carry nested `matches`).
    // Returns counters so the caller can tell whether the response still looks as expected.
    function localize(node, stats = { matches: 0, converted: 0 }) {
        if (Array.isArray(node)) {
            node.forEach(v => localize(v, stats));
        } else if (node && typeof node === 'object') {
            if ('matchTime' in node) stats.matches++;
            if (typeof node.matchTimeUtc === 'string' && typeof node.matchTime === 'string') {
                const local = utcToLocalString(node.matchTimeUtc);
                if (local) {
                    node.matchTimeStadium = node.matchTime;
                    node.matchTime = local;
                    stats.converted++;
                    rememberShift(node.matchTimeStadium, local);
                }
            }
            Object.values(node).forEach(v => { if (v && typeof v === 'object') localize(v, stats); });
        }
        return stats;
    }

    function setStatus(s) {
        status = s;
        updateBadge();
    }

    // Patch XMLHttpRequest so the page's Vue component receives already-localized times.
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        this.__bwfLocalize = API_RE.test(String(url));
        return origOpen.apply(this, arguments);
    };

    const textDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
    const respDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');

    // Never break the page: on any surprise return the original response untouched.
    function transformedText(xhr) {
        const raw = textDesc.get.call(xhr);
        if (!xhr.__bwfLocalize || getMode() !== 'local' || xhr.readyState !== 4 || !raw) return raw;
        if (xhr.__bwfCache && xhr.__bwfCache.raw === raw) return xhr.__bwfCache.out;
        let out = raw;
        try {
            const data = JSON.parse(raw);
            const stats = localize(data);
            if (stats.matches > 0 && stats.converted === 0) {
                setStatus('na'); // matches are there, but without a usable matchTimeUtc
            } else {
                out = JSON.stringify(data);
                if (stats.converted) setStatus('ok');
            }
        } catch (e) {
            out = raw;
            setStatus('na');
        }
        xhr.__bwfCache = { raw, out };
        scheduleMarkDays();
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

    // Browsers may still report legacy IANA aliases (e.g. Chrome on Windows gives "Europe/Kiev").
    const TZ_ALIASES = {
        'Europe/Kiev': 'Europe/Kyiv',
        'Europe/Uzhgorod': 'Europe/Kyiv',
        'Europe/Zaporozhye': 'Europe/Kyiv',
        'Asia/Calcutta': 'Asia/Kolkata',
        'Asia/Saigon': 'Asia/Ho_Chi_Minh',
        'Asia/Katmandu': 'Asia/Kathmandu',
        'Asia/Rangoon': 'Asia/Yangon',
    };

    // Small badge so it's obvious which time is shown.
    function addBadge() {
        if (document.getElementById('bwf-localtime-badge')) return;
        const b = document.createElement('div');
        b.id = 'bwf-localtime-badge';
        b.style.cssText = 'position:fixed;top:0;left:12px;z-index:99999;padding:6px 10px;' +
            'border-radius:6px;font:12px/1.3 system-ui,sans-serif;cursor:pointer;color:#fff;' +
            'box-shadow:0 2px 6px rgba(0,0,0,.3);will-change:transform';
        b.addEventListener('click', () => {
            setMode(getMode() === 'local' ? 'stadium' : 'local');
            location.reload();
        });
        document.body.appendChild(b);
        updateBadge();
        followHeader(b);
    }

    function updateBadge() {
        const b = document.getElementById('bwf-localtime-badge');
        if (!b) return;
        const rawTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const tz = TZ_ALIASES[rawTz] || rawTz;
        let text = `TZ: ${tz}`, bg = '#df2027', title = 'Click to switch between your time and stadium time';
        if (getMode() !== 'local') {
            text = 'TZ: Stadium';
            bg = '#6e7781';
        } else if (status === 'na') {
            text = 'TZ: n/a';
            bg = '#9a6700';
            title = 'The BWF API returned data in an unexpected format, so the original stadium times ' +
                'are shown. Click to switch to stadium mode.';
        }
        b.textContent = text;
        b.title = title;
        b.style.background = bg;
    }

    // Mark rendered times whose local day differs from the stadium day: "02:00 +1".
    // The widget's markup is not ours, so look for text nodes that are exactly a shifted time.
    const MARK_CLASS = 'bwf-localtime-day';

    // "9:05", "09:05", "Est. 9:05 PM" -> "09:05" / "21:05"; anything else -> null.
    function timeKey(text) {
        const m = /^(?:[A-Za-z]+\.?\s+)?(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?[Mm]\.?)?$/.exec(text.trim());
        if (!m) return null;
        let h = +m[1];
        if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
        return `${pad(h)}:${m[2]}`;
    }

    function markDays() {
        if (getMode() !== 'local' || !document.body) return;
        if (![...shiftedTimes.values()].some(i => i.shift)) return;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const hits = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.nodeValue.length > 24) continue;
            const key = timeKey(n.nodeValue);
            const info = key && shiftedTimes.get(key);
            if (!info || !info.shift) continue;
            const next = n.nextSibling;
            if (next && next.classList && next.classList.contains(MARK_CLASS)) continue;
            hits.push([n, info]);
        }
        hits.forEach(([n, info]) => {
            const s = document.createElement('sup');
            s.className = MARK_CLASS;
            s.textContent = info.shift > 0 ? `+${info.shift}` : `−${-info.shift}`;
            s.title = `${info.date} in your timezone`;
            s.style.cssText = 'font-size:.7em;font-weight:600;margin-left:2px;color:#df2027';
            n.parentNode.insertBefore(s, n.nextSibling);
        });
    }

    let markTimer = 0;
    function scheduleMarkDays() {
        clearTimeout(markTimer);
        markTimer = setTimeout(markDays, 50);
    }

    // Vue re-renders the list (tab switches, live updates), so re-apply marks after DOM changes.
    function observeSchedule() {
        const isMark = node => node.classList && node.classList.contains(MARK_CLASS);
        new MutationObserver(muts => {
            if (muts.some(m => m.type !== 'childList' || ![...m.addedNodes].every(isMark))) scheduleMarkDays();
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
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
    function init() {
        addBadge();
        observeSchedule();
        scheduleMarkDays();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
