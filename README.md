# BWF World Tour — local match times

A userscript for [bwfworldtour.bwfbadminton.com](https://bwfworldtour.bwfbadminton.com/) that shows
match start times in **your** timezone instead of the tournament (stadium) local time.

## How it works

The schedule on a tournament's `results/<date>` page is loaded from
`https://extranet-lv.bwfbadminton.com/api/tournaments/day-matches`. Each match there has both
`matchTime` (stadium time, which the site displays) and `matchTimeUtc`. The script intercepts that
response and replaces `matchTime` with `matchTimeUtc` converted to your browser's timezone, so the
site's own widget renders correct times. The original value is kept as `matchTimeStadium`.

## Installation

1. Install a userscript manager: [Tampermonkey](https://www.tampermonkey.net/) or
   [Violentmonkey](https://violentmonkey.github.io/).
2. Open the manager → *Create a new script*, paste the contents of `bwf-localtime.user.js`, save.
   (Or drag the file into the browser if the manager offers to install it.)
3. Open any tournament results page, e.g.
   `https://bwfworldtour.bwfbadminton.com/tournament/5210/victor-denmark-open-2026/results/2026-10-15`.

> Chrome/Edge: Tampermonkey requires *Allow User Scripts* (or Developer mode) to be enabled
> in the extension settings.

## Usage

- A badge in the top-left corner (just below the red site header) shows which time is displayed:
  `TZ: Europe/Kyiv` or `TZ: Stadium`. Click it to switch.
- The site's own **Stadium Time / Your Time** buttons (which do nothing on the original site)
  also switch the mode.
- The choice is stored in `localStorage` (`bwfLocalTime.mode`).

## Limitations

- Only the day schedule (`results/<date>`) is converted. Other pages that show times are left as is.
- The date tabs at the top are still stadium dates; a match may show a different day in your zone.
