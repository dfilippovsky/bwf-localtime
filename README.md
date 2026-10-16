# BWF World Tour — local match times

A userscript for [bwfworldtour.bwfbadminton.com](https://bwfworldtour.bwfbadminton.com/) that shows
match start times in **your** timezone instead of the tournament (stadium) local time.

| Before — stadium time (Denmark, CET) | After — your time (here Europe/Kyiv, +1 h) |
| :---: | :---: |
| ![Schedule in stadium time](docs/screenshot_stadium.png) | ![Schedule in the viewer's timezone](docs/screenshot_local.png) |

## How it works

The schedule on a tournament's `results/<date>` page is loaded from
`https://extranet-lv.bwfbadminton.com/api/tournaments/day-matches`. Each match there has both
`matchTime` (stadium time, which the site displays) and `matchTimeUtc`. The script intercepts that
response and replaces `matchTime` with `matchTimeUtc` converted to your browser's timezone, so the
site's own widget renders correct times. The original value is kept as `matchTimeStadium`.

## Installation

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Open **[bwf-localtime.user.js (raw)](https://raw.githubusercontent.com/dfilippovsky/bwf-localtime/master/bwf-localtime.user.js)**
   — the manager will offer to install it. Click *Install*.
3. Open any tournament results page, e.g.
   `https://bwfworldtour.bwfbadminton.com/tournament/5210/victor-denmark-open-2026/results/2026-10-15`.

The script declares `@updateURL`/`@downloadURL`, so the manager picks up new versions automatically.

> Chrome/Edge: Tampermonkey requires *Allow User Scripts* (or Developer mode) to be enabled
> in the extension settings.

> Violentmonkey: the script declares `@inject-into page`, because it must patch the page's own
> `XMLHttpRequest`/`fetch`. If the badge stays `TZ: n/a` on a schedule page, check that the
> script's injection mode isn't overridden to *content* in Violentmonkey's settings.

## Usage

- A badge in the top-left corner (just below the red site header) shows which time is displayed:
  `TZ: Europe/Kyiv` or `TZ: Stadium`. Click it to switch.
- If a match falls on a different day in your timezone than at the stadium, its time gets a small
  `+1` (or `−1`) mark; hover it to see the local date. Typical for tournaments in the Americas
  watched from Europe.
- The site's markup also contains **Stadium Time / Your Time** filter buttons, but they are
  currently commented out, so you won't see them (see [Proofs](#proofs)). If the site ever shows
  them again, the script hooks them up too, so they switch the mode just like the badge.
- The choice is stored in `localStorage` (`bwfLocalTime.mode`).
- Badge states:
  - `TZ: Europe/Kyiv` (red) — times are converted.
  - Dimmed badge — no schedule has been loaded on this page yet (normal on non-schedule pages).
  - `TZ: Europe/Kyiv ⚠` (amber) — some matches had no UTC time and still show stadium time;
    hover the badge to see how many.
  - `TZ: n/a` (amber) — the schedule couldn't be converted: the BWF API answered in an unexpected
    format, or on a `results/<date>` page no schedule request was intercepted within 15 s. The script
    then leaves the response untouched, so the page shows the original stadium times and keeps working.

## Limitations

- Only the day schedule (`results/<date>`) is converted. Other pages that show times are left as is.
- The date tabs at the top are still stadium dates; use the `+1`/`−1` marks to spot matches that
  fall on another day in your zone.
- `extranet-lv.bwfbadminton.com` is an undocumented internal API and may change without notice.

## Companion script: Match Centre popup skipper

[match-centre.bwfbadminton.com](https://match-centre.bwfbadminton.com/) shows a
"Stay Updated with BWF — Download the Badminton4u App" popup, and closing it only keeps it away
for 24 hours — after that it comes back.
**[bwf-matchcentre.user.js (raw)](https://raw.githubusercontent.com/dfilippovsky/bwf-localtime/master/bwf-matchcentre.user.js)**
(installed separately, same way as above):

- stops that popup from showing at all. The site's own × button remembers your choice in the
  `hero_app_banner_closed` cookie for just one day; the script sets it (and `bannerClosed` for the
  mobile bottom banner) for 400 days (Chrome’s maximum; refreshed on every visit), and also hides
  `.hero-app-banner` via CSS as a fallback;
- on a tournament landing page (`https://match-centre.bwfbadminton.com/<id>`) follows the
  **Order of Play** button in the same tab.
- The redirect only happens on a fresh visit: coming back with *Back* or reloading the page keeps
  you on the match centre. To disable the redirect entirely, set `AUTO_ORDER_OF_PLAY = false` at
  the top of the script.

## Proofs

Excerpts from the sites' own code, as served on 2026-10-16.

### 1. "Your Time" was planned by the site's developers, but never implemented

The results page (`bwfworldtour.bwfbadminton.com/tournament/<id>/<slug>/results/<date>`, inline
Vue component) already has a `time` setting with a "local time" value:

```js
data() {
    return {
        apiUrl: 'https://extranet-lv.bwfbadminton.com',
        // ...
        order: 2, // 1 - by time, 2 - by court
        time: 1, // 1 - stadium time, 2 - local time
```

and filter buttons for it (currently commented out in the markup):

```html
<!--<div class="filter-row">
    <span class="filter-name">Time</span>
    <div class="filter-options">
        <input type="button" value="Stadium Time" :class="{ 'active': time === 1}" value="By Court" @click="time = 1"/>
        <input type="button" value="Your Time"  :class="{ 'active': time === 2}" value="By Court" @click="time = 2"/>
    </div>
</div>-->
```

But `time` is never read anywhere. It isn't sent to the API (`order` is, `time` isn't):

```js
axios({
    url: this.apiUrl + '/api/tournaments/day-matches', // B4U API
    method: 'get',
    params: {
        tournamentCode: this.tournamentCode,
        date: this.date,
        order: this.order,
        court: this.selectedCourt,
    }
})
```

and the match card always formats the stadium `matchTime`; `matchTimeUtc` is only checked for
existence, never displayed:

```js
if (!this.match.matchTime && !this.match.matchTimeUtc) {
    return undefined;
}

const date = new Date(this.match.matchTime);
// ...
formattedTime = new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
}).format(date);
```

### 2. Closing the Match Centre app popup is remembered for one day only

`match-centre.bwfbadminton.com/js/app.06fa1f09.js` (minified). The full-screen
"Stay Updated with BWF — Download the Badminton4u App" popup (`HeroAppBanner`):

```js
M={name:"HeroAppBanner",data(){return{isVisible:!0}},methods:{
  onClose(){this.isVisible=!1,this.setCookie("hero_app_banner_closed","true",1),this.$emit("close")},
  setCookie(t,e,a){const s=new Date;s.setTime(s.getTime()+24*a*60*60*1e3);
    const i="expires="+s.toUTCString();document.cookie=t+"="+e+";"+i+";path=/"},
  ...
  checkCookie(){const t=this.getCookie("hero_app_banner_closed");t&&(this.isVisible=!1)}},
  mounted(){this.checkCookie()}}
```

`setCookie(name, value, days)` is called with `days = 1`, i.e. `expires` = now + 24 h. After that
the cookie is gone, `checkCookie()` finds nothing and the popup is shown again. The mobile bottom
banner does the same with its own cookie:

```js
closeBanner(){this.isClosed=!0,this.setCookie("bannerClosed","true",1)}
```

## License

[MIT](LICENSE)
