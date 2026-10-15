// ==UserScript==
// @name         BWF World Tour — local match times
// @namespace    https://github.com/dfilippovsky/bwf-localtime
// @version      1.2.0
// @description  Shows BWF World Tour match start times in your own timezone instead of the stadium's.
// @author       Dan Filippovsky
// @license      MIT
// @homepageURL  https://github.com/dfilippovsky/bwf-localtime
// @supportURL   https://github.com/dfilippovsky/bwf-localtime/issues
// @downloadURL  https://raw.githubusercontent.com/dfilippovsky/bwf-localtime/master/bwf-localtime.user.js
// @updateURL    https://raw.githubusercontent.com/dfilippovsky/bwf-localtime/master/bwf-localtime.user.js
// @match        https://bwfworldtour.bwfbadminton.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // The schedule widget fetches matches from this endpoint (axios -> XMLHttpRequest).
    const API_RE = /extranet-lv\.bwfbadminton\.com\/api\/tournaments\/day-matches(\?|$)/;
    const STORAGE_KEY = 'bwfLocalTime.mode'; // 'local' | 'stadium'
    // If a schedule page hasn't delivered a day-matches response by then, interception is broken.
    const PENDING_TIMEOUT_MS = 15000;

    function getMode() {
        try { return localStorage.getItem(STORAGE_KEY) || 'local'; } catch (e) { return 'local'; }
    }
    function setMode(mode) {
        try { localStorage.setItem(STORAGE_KEY, mode); } catch (e) { /* ignore */ }
    }

    const pad = n => String(n).padStart(2, '0');
    const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

    // 'pending' — no schedule response seen yet; 'ok' — all times converted;
    // 'partial' — some matches had no usable UTC time; 'na' — unexpected format, times left as is.
    const state = { status: 'pending', matches: 0, converted: 0 };

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

    // Local "HH:MM" -> { shift, date } for the latest schedule response.
    // Used to put "+1"/"−1" marks next to rendered times that land on another day in the user's zone.
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
            if (typeof node.matchTime === 'string' && node.matchTime) {
                stats.matches++;
                const local = typeof node.matchTimeUtc === 'string' && utcToLocalString(node.matchTimeUtc);
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

    function setStatus(status, stats) {
        state.status = status;
        state.matches = stats ? stats.matches : 0;
        state.converted = stats ? stats.converted : 0;
        updateBadge();
    }

    // Raw day-matches JSON -> localized JSON. Never breaks the page: on any surprise the
    // original text is returned untouched.
    function localizeText(raw) {
        if (getMode() !== 'local' || !raw) return raw;
        try {
            const data = JSON.parse(raw);
            shiftedTimes.clear(); // a new day was loaded — forget the previous one
            const stats = localize(data);
            if (stats.matches > 0 && stats.converted === 0) {
                shiftedTimes.clear();
                setStatus('na', stats); // matches are there, but without a usable matchTimeUtc
                return raw;
            }
            setStatus(stats.converted < stats.matches ? 'partial' : 'ok', stats);
            scheduleMarkDays();
            return JSON.stringify(data);
        } catch (e) {
            setStatus('na');
            return raw;
        }
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
        if (!xhr.__bwfLocalize || xhr.readyState !== 4 || !raw) return raw;
        if (xhr.__bwfCache && xhr.__bwfCache.raw === raw) return xhr.__bwfCache.out;
        const out = localizeText(raw);
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

    // The site uses XHR today; cover fetch too in case it switches.
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
        window.fetch = function (input) {
            const url = typeof input === 'string' ? input : input && input.url;
            const p = origFetch.apply(this, arguments);
            if (!API_RE.test(String(url))) return p;
            return p.then(res => res.clone().text().then(raw => {
                const out = localizeText(raw);
                if (out === raw) return res;
                const headers = new Headers(res.headers);
                headers.delete('content-length');
                return new Response(out, { status: res.status, statusText: res.statusText, headers });
            }, () => res));
        };
    }

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

    let placeBadge = () => {};

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
        placeBadge = followHeader(b);
    }

    function updateBadge() {
        const b = document.getElementById('bwf-localtime-badge');
        if (!b) return;
        const rawTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const tz = TZ_ALIASES[rawTz] || rawTz;
        const hint = 'Click to switch between your time and stadium time.';
        let text = `TZ: ${tz}`, bg = '#df2027', opacity = '1', title = hint;
        if (getMode() !== 'local') {
            text = 'TZ: Stadium';
            bg = '#6e7781';
        } else if (state.status === 'pending') {
            opacity = '.6';
            title = 'No match schedule has been loaded on this page yet.\n' + hint;
        } else if (state.status === 'partial') {
            text = `TZ: ${tz} ⚠`;
            bg = '#9a6700';
            title = `${state.matches - state.converted} of ${state.matches} matches have no UTC time ` +
                'and still show stadium time.\n' + hint;
        } else if (state.status === 'na') {
            text = 'TZ: n/a';
            bg = '#9a6700';
            title = 'The match schedule could not be converted (the BWF API answered in an unexpected ' +
                'format, or its request was not intercepted), so stadium times are shown.\n' + hint;
        }
        b.textContent = text;
        b.title = title;
        b.style.background = bg;
        b.style.opacity = opacity;
    }

    // On a schedule page, staying 'pending' means the request was never intercepted
    // (e.g. the site switched transport, or the script runs in an isolated context).
    function watchPending() {
        setTimeout(() => {
            if (state.status === 'pending' && getMode() === 'local' && /\/results\//.test(location.pathname)) {
                setStatus('na');
            }
        }, PENDING_TIMEOUT_MS);
    }

    // Mark rendered times whose local day differs from the stadium day: "Est. 2:00 AM +1".
    // The widget's markup is not ours, so look for text nodes that are exactly a shifted time.
    const MARK_CLASS = 'bwf-localtime-day';
    // No trailing \b: textContent glues "15 OCT" to the next line ("15 OCTFollowed By").
    const CARD_DATE_RE = /\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

    // "9:05", "09:05", "Est. 9:05 PM" -> "09:05" / "21:05"; anything else -> null.
    function timeKey(text) {
        const m = /^(?:[A-Za-z]+\.?\s+)?(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?[Mm]\.?)?$/.exec(text.trim());
        if (!m) return null;
        let h = +m[1];
        if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0);
        return `${pad(h)}:${m[2]}`;
    }

    // Only times inside a match card's time box ("15 OCT / Followed By / Est. 8:00 PM") count,
    // so unrelated "02:00" strings elsewhere on the page are left alone.
    function inMatchCard(node) {
        let el = node.parentElement;
        for (let i = 0; el && i < 4; i++, el = el.parentElement) {
            const t = el.textContent;
            if (t.length > 300) return false;
            if (CARD_DATE_RE.test(t)) return true;
        }
        return false;
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
            if (inMatchCard(n)) hits.push([n, info]);
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

    // Vue re-renders the list (tab switches, live updates) and may swap the header,
    // so re-apply marks and re-place the badge after DOM changes.
    function observeDom() {
        const isMark = node => node.classList && node.classList.contains(MARK_CLASS);
        new MutationObserver(muts => {
            if (muts.every(m => m.type === 'childList' && [...m.addedNodes].every(isMark))) return;
            scheduleMarkDays();
            placeBadge(true);
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

    // Keep the badge just below the header, which shrinks/grows on scroll; once the header scrolls
    // away, stick to the top. Only recomputed on scroll, resize, header resize and DOM changes —
    // no per-frame loop. Returns a function that schedules a re-placement.
    function followHeader(b) {
        let header = null, lastY = null, queued = false, redetect = true, settleTimer = 0;
        const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;

        function place() {
            queued = false;
            if (redetect || !header || !header.isConnected) {
                redetect = false;
                const h = findHeader();
                if (h !== header) {
                    if (ro) { ro.disconnect(); if (h) ro.observe(h); }
                    header = h;
                }
            }
            const bottom = header ? header.getBoundingClientRect().bottom : 72;
            const y = Math.round(Math.max(8, bottom + 8));
            if (y !== lastY) { b.style.transform = `translateY(${y}px)`; lastY = y; }
        }

        function schedule(findAgain) {
            if (findAgain) redetect = true;
            if (queued) return;
            queued = true;
            requestAnimationFrame(place);
        }

        function onScroll() {
            schedule();
            // The header may animate after scrolling stops (CSS transition) — settle once more.
            clearTimeout(settleTimer);
            settleTimer = setTimeout(() => schedule(), 350);
        }

        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', () => schedule(true), { passive: true });
        schedule(true);
        return schedule;
    }

    function init() {
        addBadge();
        observeDom();
        scheduleMarkDays();
        watchPending();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
