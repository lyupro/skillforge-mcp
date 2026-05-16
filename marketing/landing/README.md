# SkillForge MCP — Landing Page

Self-contained landing page for [`lyupro.com/skillforge-mcp`](https://lyupro.com/skillforge-mcp). One file: HTML + inline CSS + inline JS. No external assets, no build step, no JavaScript framework.

## What's inside

`index.html` includes:

- **Hero** — title, tagline, badges, primary CTA (GitHub) + secondary CTA (npm).
- **Pain section** — 4 cards (tool-specific formats / eager auto-load / no team registry / script security).
- **Features section** — 4 mirrored solution cards.
- **Token savings calculator** — 4 inputs (skills, sessions, used, tokens), live-updates 5 result rows + monthly-saved highlight.
- **Install tabs** — Claude Code / Codex CLI / Cursor / Custom MCP client, one accessible tab panel each.
- **Sample skills showcase** — 10 chips covering prompt / script / hybrid strategies.
- **Documentation grid** — 6 cards linking to README + 5 docs.
- **Footer** — GitHub / npm / Issues / Security / Lyu Pro links + copyright.

All styles are scoped to `.sfm-landing` so the snippet is safe to drop into WordPress next to other content.

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

No server needed. The calculator and tabs run client-side.

## Deploy options

### A. Static host (Cloudflare Pages / Vercel / GitHub Pages)

Drop the file at the root of a static site. The canonical URL is set to `https://lyupro.com/skillforge-mcp`; adjust the `<link rel="canonical">` and Open Graph URL if you publish under a different path.

### B. WordPress (lyupro.com today)

Two paths depending on your block editor preference:

1. **Custom HTML block** (recommended for verbatim paste):
   - Edit the target page (`lyupro.com/skillforge-mcp`).
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
| Footer links | `.sfm-footer` block | Add Twitter / Discord / etc. |

## When to refresh

- After every npm publish: version badge + test-count badge in hero (currently `v1.3.0` / `561 tests` literals).
- After adding sample skills: chip grid.
- After landing on the official Anthropic marketplace: add badge and link.
- Keep the Cursor install tab pointed at `~/.cursor/mcp.json` with a top-level `mcpServers` key — Cursor does not read the VS Code-style nested `mcp.servers` shape.

## Not included (on purpose)

- No external CDN libraries — pure HTML/CSS/JS keeps the page fast and immune to third-party drift.
- No analytics — add Plausible / GA snippet inside `<head>` if you want them.
- No GitHub stars / npm download badges (Shields.io); embed via `<img>` in the hero if desired.
- No screenshots — placeholder area can be added between hero and pain section once final stills are ready.

## Tested

Pure static HTML; no test suite. Manual checks performed:

- Renders correctly in latest Chrome, Firefox, Safari (DevTools responsive viewports 360 / 768 / 1280 / 1600 px width).
- Calculator updates live on `input` events for all four fields.
- Tab switching toggles `aria-selected` and `aria-hidden` consistently.
- Keyboard focus visible on inputs (outline ring).
