# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## What this is

A premium **static** wedding invitation site for "Yegor & Diana"
(26.08.2026, Saint Petersburg). Plain HTML/CSS/JS — **no build step, no npm,
no backend**. The whole site lives in `yegor-diana-wedding/` and is published
at the root of GitHub Pages.

> Background: the repository started out as an analysis of the production
> WordPress version of the site (`https://yegor.diana.yarover.ru`). That
> analysis is kept in `yegor-diana-wedding/CLAUDE.md` as a **reference** — the
> current code has nothing to do with WordPress, it is an independent static
> rebuild.

Besides the site, the repository hosts local Claude Code infrastructure — the
`.claude/` directory (the `repo-map` skill and a permissions allowlist). That
is a separate layer: site changes don't touch it and vice versa.

## Layout

```
.
├── CLAUDE.md                       — this file (the current guide)
├── .github/workflows/deploy-pages.yml  — GitHub Pages deployment
├── .claude/                        — Claude Code infrastructure (not part of the site)
│   ├── settings.json               — allowlist of read-only commands and MCP calls
│   └── skills/repo-map/            — the "repository map" skill
│       ├── SKILL.md                — instructions (frontmatter + playbook)
│       ├── README.md               — usage and installation
│       ├── install.sh              — one-line installer for other repos
│       ├── reference/collect.md    — how to collect data (repos, branches, PRs)
│       ├── reference/render.md     — how to render the output
│       └── assets/template.html    — HTML template for the map
└── yegor-diana-wedding/            — THE SITE ITSELF (published at the Pages root)
    ├── index.html                  — all markup, one page (~670 lines)
    ├── favicon.svg                 — the "Е&Д" monogram
    ├── README.md                   — preview, RSVP setup, notes on assets
    ├── CLAUDE.md                   — reference analysis of the original WP site (do NOT treat as code)
    └── assets/
        ├── css/styles.css          — design system, sections, animations (~1990 lines)
        └── js/main.js              — all client logic, a single IIFE (~720 lines)
```

## Commands

There is no build and there are no tests. The working loop:

```bash
# Local preview
cd yegor-diana-wedding && python3 -m http.server   # → http://localhost:8000

# Check the JS before committing (required)
node --check yegor-diana-wedding/assets/js/main.js
```

There is no linter or formatter in the repository — `node --check` is the only
automated check available; everything else is verified by eye in a browser.

## Deployment and branches

`.github/workflows/deploy-pages.yml` publishes the `yegor-diana-wedding/`
folder at the root of GitHub Pages. It is triggered by a push **only** to the
`claude/website-analysis-claude-md-kd3foj` branch (plus manual
`workflow_dispatch`).

⚠️ The default branch on origin is `claude/create-claude-md-s7amj`, which does
**not** match the deploy branch. Merging into the default branch does not
update Pages by itself: to ship changes you need a push to
`claude/website-analysis-claude-md-kd3foj` or a manual workflow run. To preview
a branch/PR without Pages, use githack (raw.githack.com pointed at
`index.html`).

The repository doubles as a sandbox: origin holds a couple dozen unrelated
branches (`claude/pixel-rpg-…`, `claude/telegram-finance-bot-…`, and so on).
Only your working branch and the deploy branch are relevant.

## Architecture

**`index.html`** — a single page. Overlay stacking order by `z-index`:
preloader (120) → intro video (100) → scroll progress (95) → navigation (90).
Anchored sections in order: `#hero`, `#countdown`, `#gallery`, `#story`,
`#program`, `#location`, `#details`, `#rsvp`, `#flowers`. Not all of them are
in the nav menu — only `#story`, `#program`, `#location`, `#details`, `#rsvp`,
`#flowers`.

**`assets/js/main.js`** — a single IIFE (`'use strict'`), ES5 style (`var`,
`Array.prototype.slice.call`), no dependencies. Above the IIFE sits the only
global constant, `RSVP_ENDPOINT` (line 6). Inside, the very first thing is
`var reduceMotion` (the `prefers-reduced-motion` flag) — every animation
branches off it. The file is divided by comment blocks:

| Block | What it does |
| --- | --- |
| `0a` | Hero names: split into spans + staggered reveal |
| `0`  | Preloader (hidden on `load`) |
| `1`  | Intro video: Play / Skip / `ended` → fade |
| `2`  | Navigation: background, mobile menu, smooth scroll, active item, scroll progress |
| `3`  | Scroll reveal via IntersectionObserver (`.reveal` + `.anim-draw`) |
| `4`  | Hero/gallery parallax via rAF |
| `5`  | Countdown to 26.08.2026 10:00 + count-up |
| `6`  | "Add to calendar": `.ics` via Blob |
| `7`  | Lightbox: gallery + Love Story (←/→/Esc, focus trap, aria) |
| `8`  | RSVP form: validation, honeypot, Formspree or demo mode |

**`assets/css/styles.css`** — numbered sections marked by
`/* ===== N. … ===== */` banners: `:root` and base styles (through line 284) →
1 intro video → 2 navigation → 3 hero → 4 countdown → 5 gallery → 6 program →
7 details → 8 RSVP → 9 flowers → 10 footer → 11 preloader → 12 floral dividers
→ 13 calendar buttons → 14 Love Story → 15 maps → 16 lightbox → 17 responsive
rules for the newer blocks → **18 animations** → **19 reduced-motion resets**
(always at the end of the file). The design system lives in `:root` CSS
variables (wine-burgundy / cream / gold, a single `--fast` easing).

## Animation machinery (important when making changes)

This is the load-bearing structure — hang new effects on it, don't duplicate it:

- **`.reveal` + IntersectionObserver** — fade + rise + blur, staggered via
  `--reveal-delay` (`(index % 4) * 0.08s`); adds `.is-visible` and unobserves
  (`threshold: 0.12`, `rootMargin: 0px 0px -8% 0px`). The `.reveal--left/--right`
  modifiers produce a horizontal entrance. The final state ALWAYS preserves
  `rotate(var(--tilt,0deg))`.
- **`[data-parallax]`** — writes `transform` DIRECTLY on the node via rAF (the
  attribute value is the coefficient, ±0.03…0.06). ⚠️ Don't attach your own
  transform animations (Ken Burns, scaleX, pulse) to parallax nodes — they will
  be overwritten. Use inner `img` elements, wrappers, or separate elements.
- **`.anim-draw`** — "drawing in" the dividers (lines via `scaleX`, SVG via
  `stroke-dashoffset`); observed by the same reveal observer.
- **`.photo-mask`** — a photo wrapper: a `clip-path` curtain on the wrapper plus
  a Ken Burns `scale` on the inner `img`.
- **countdown count-up** — gated by the `countdownStarted` flag; exactly one
  `setInterval`. The remaining time is computed by the shared `getRemaining()`
  — do not duplicate it.
- **`--fast`** — the single easing used by every transition and animation.
- Under `reduceMotion` (or when `IntersectionObserver` is missing) every
  `.reveal` and `.anim-draw` gets `.is-visible` immediately, parallax never
  starts, and `scrollIntoView` switches to `behavior: 'auto'`.

## Conventions and constraints

- Every new animation MUST be disabled or made instant under
  `@media (prefers-reduced-motion: reduce)` (CSS — section 19; JS — branches on
  the `reduceMotion` flag). This is a requirement, not a suggestion.
- No external JS libraries and no build steps. CSS → `styles.css`,
  JS → `main.js`, markup → `index.html`. (The exceptions are non-JS: Google
  Fonts with `display=swap` and the Yandex Maps iframe.)
- JS style is ES5 inside the IIFE: `var`, function declarations, no arrow
  functions or template literals. Stick to it so the file stays uniform.
- Colors and easing come only from the design-system CSS variables; don't
  hardcode anything outside the palette.
- Content language is Russian, `lang="ru-RU"`, UTF-8. Preserve accessibility
  (aria) when changing the structure — especially the Hero names.
- The intro video must keep `muted` + `playsinline` (mobile autoplay) and keep
  both sources (`.mp4`/`.m4v`) plus the poster.
- The lightbox picks up images via the `.gallery__card img, .story__photo img`
  selector and reads `currentSrc||src` — don't break that selector when editing
  photos.
- Some assets (photos, video, dress code, QR) load from the live WordPress
  domain `yegor.diana.yarover.ru`. Every `<img>` carries
  `onerror="this.classList.add('img-failed')"` → CSS placeholder; the video has
  a poster. Add new external images with the same hook.
- Maps are a `yandex.ru/map-widget/v1/?text=…&z=16` iframe with
  `loading="lazy"`, no API key. The `.ics` file stores times in UTC
  (`20260826T070000Z`–`20260826T200000Z` = 10:00–23:00 MSK).
- **Don't edit `CLAUDE.md` as code** in site-related tasks: the root one is the
  guide, the nested one is reference analysis. The exception is a task that is
  explicitly about documentation.

## RSVP setup

By default the form is in demo mode: `RSVP_ENDPOINT` holds the `YOUR_FORM_ID`
placeholder, and `main.js` matches on the `YOUR_FORM_ID` substring to take the
"show a thank-you, send nothing" branch. To enable submission, put a real
Formspree endpoint in `RSVP_ENDPOINT` (`main.js`, line 6). Details — and the
Telegram alternative, including why it is worse for a public site — are in
`yegor-diana-wedding/README.md`. Keep the `website` honeypot field as spam
protection: if it is filled in, submit aborts silently.

## The `repo-map` skill

`.claude/skills/repo-map/` is a self-contained skill unrelated to the site. It
answers "where am I / what's in my GitHub": it collects repositories, branches,
open PRs, and file trees, then emits a summary into the chat **and** an
interactive HTML page built from `assets/template.html`. The logic is split
up: `SKILL.md` is the playbook, `reference/collect.md` covers data collection,
`reference/render.md` covers output. `install.sh` installs the skill into other
repositories. The read-only calls it needs (`git status/log/branch/…`,
`mcp__github__*`, `list_repos`) are already permitted in
`.claude/settings.json` — keep that allowlist current when editing the skill.
