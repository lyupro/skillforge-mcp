# SkillForge MCP — Landing Page

Self-contained landing page for [`lyupro.com/tools/skillforge`](https://lyupro.com/tools/skillforge). One file: HTML + inline CSS + inline JS. No build step, no JavaScript framework, no external CDN libraries.

The page **self-updates from Git**: at load it fetches `site-data.json` (version / test count / sample-skill count) and `CHANGELOG.md` from raw GitHub, so editing those files in the repo refreshes the live page with no HTML re-edit. If a fetch fails the page falls back to hardcoded values — it never breaks.

## What's inside

`index.html` includes:

- **Hero** — title, tagline, badges, primary CTA (GitHub) + secondary CTA (npm).
- **What's new** — latest release entry, fetched live from `CHANGELOG.md` on GitHub and rendered inline.
- **Pain section** — 4 cards (tool-specific formats / eager auto-load / no team registry / script security).
- **Features section** — 4 mirrored solution cards.
- **Token savings calculator** — 4 inputs (skills, sessions, used, tokens), live-updates 5 result rows + monthly-saved highlight.
- **Install section** — one-command `install --all` block, then tabs for Claude Code / Codex CLI / Cursor / Any MCP host, one accessible tab panel each.
- **Sample skills showcase** — 10 chips covering prompt / script / hybrid strategies.
- **Documentation grid** — 6 cards linking to README + 5 docs.
- **Footer** — GitHub / npm / Issues / Security / Lyu Pro links + copyright.

All styles are scoped to `.sfm-landing` so the snippet is safe to drop into WordPress next to other content.

## Self-updating content

Two pieces of the page are pulled live from the repo so the site stays current without touching `index.html`:

| Source file | Drives | Mechanism |
|-------------|--------|-----------|
| `marketing/landing/site-data.json` | Hero version + test-count badges, sample-skill count | `fetch` on load → fills every `[data-sf]` element |
| `CHANGELOG.md` (repo root) | The "What's new" section | `fetch` on load → latest entry rendered by a tiny built-in Markdown renderer |

Both are fetched from `raw.githubusercontent.com/lyupro/skillforge-mcp/master/…`. Consequences:

- **Paste once.** Drop the HTML into WordPress a single time. Every later release only needs an edit to `site-data.json` and `CHANGELOG.md` in Git — the live page picks it up. No re-paste.
- **Requires the repo to be public and pushed.** Until the release commits are pushed, the live fetch 404s and the page shows its hardcoded fallbacks (still correct, just not auto-fresh).
- **~5-minute lag.** `raw.githubusercontent.com` is CDN-cached; edits appear within a few minutes, not instantly.
- **Graceful failure.** Network error, private repo, or JS disabled → the hardcoded fallback text and a static changelog link remain. The page never blanks.

## Local preview

Open the file directly in a browser:

```bash
# Windows
start marketing\landing\index.html

# macOS
open marketing/landing/index.html

# Linux
xdg-open marketing/landing/index.html
```

No server needed. The calculator and tabs run client-side. The version badges and "What's new" section fetch from GitHub — offline, they show the hardcoded fallbacks.

## Deploy options

### A. Static host (Cloudflare Pages / Vercel / GitHub Pages)

Drop the file at the root of a static site. The canonical URL is set to `https://lyupro.com/tools/skillforge`; adjust the `<link rel="canonical">` and Open Graph URL if you publish under a different path.

### B. WordPress (lyupro.com today)

Two paths depending on your block editor preference:

1. **Custom HTML block** (recommended for verbatim paste):
   - Edit the target page (`lyupro.com/tools/skillforge`).
   - Add a **Custom HTML** block.
   - Open `index.html`, copy everything **between** `<body class="sfm-landing">` and `</body>` (inclusive of the inner `<div class="sfm-landing">` wrapper + `<style>` block — the `<style>` block before `</head>` should be copied **into** the HTML block as well so the styles travel with the content).
   - Paste into the Custom HTML block.
   - Preview → Publish.

2. **Page template override**:
   - Use a child-theme template that loads the full `index.html` body.
   - Recommended only if the page sits outside the regular post flow and you have child-theme experience.

### C. Embed only the snippet (any Markdown / static-site host)

The styles are scoped to `.sfm-landing`, so the inner `<div class="sfm-landing">…</div>` block plus the `<style>` block can be embedded as a fragment into any host that allows raw HTML (e.g. a Hugo / Astro / Eleventy page).

## Customisation knobs

| Knob | Where | Effect |
|------|-------|--------|
| Accent colour | `--accent` / `--accent-strong` CSS variables in `<style>` | Recolour CTAs, badges, focus rings. |
| Hero badges | `<div class="badges">` in hero section | Add / remove version / build / license / stars. |
| Calculator defaults | `value` attrs on the 4 `<input>` elements | Change the starting numbers users see. |
| Tab labels & content | `.sfm-tabs button` + each `.sfm-tab-panel` | Add tools or rewrite snippets. |
| Sample skills chips | `.sfm-skills-grid` block | Update as the catalog grows. |
| Live facts | `site-data.json` | Version / test-count / sample-skill numbers — edited in Git, not in the HTML. |
| Footer links | `.sfm-footer` block | Add Twitter / Discord / etc. |

## When to refresh

Most releases need **no HTML edit** — update the Git sources instead:

- **Every release:** bump `site-data.json` (`version`, `tests`, `sampleSkills`) and add the entry to `CHANGELOG.md`. The live page reflects both within minutes.
- **Edit `index.html` only for structural change:** new section, new install tab, reworded copy, sample-skill chip grid.
- Keep the Cursor install tab pointed at `~/.cursor/mcp.json` with a top-level `mcpServers` key — Cursor does not read the VS Code-style nested `mcp.servers` shape.
- After landing on the official Anthropic marketplace: add a badge and link.

## Not included (on purpose)

- No external CDN libraries — pure HTML/CSS/JS. The only runtime network calls are two `fetch`es to `raw.githubusercontent.com` for self-update; both degrade gracefully if blocked.
- No analytics — add Plausible / GA snippet inside `<head>` if you want them.
- No GitHub stars / npm download badges (Shields.io); embed via `<img>` in the hero if desired.
- No screenshots — placeholder area can be added between hero and pain section once final stills are ready.

## Tested

Pure static HTML; no test suite. Manual checks performed:

- Renders correctly in latest Chrome, Firefox, Safari (DevTools responsive viewports 360 / 768 / 1280 / 1600 px width).
- Calculator updates live on `input` events for all four fields.
- Tab switching toggles `aria-selected` and `aria-hidden` consistently.
- Keyboard focus visible on inputs (outline ring).
- Self-update fetches degrade gracefully — fallback badge text and the static changelog link remain when the fetches are blocked.
