# SkillForge MCP — Marketing Copy Drafts

Pre-written launch copy for the v1.3.0 announcement. Each file is platform-tuned and ready to copy-paste; rewrite freely before posting if voice or angle needs adjusting.

| File | Platform | Tone | Length |
|------|----------|------|--------|
| `twitter-thread.md` | Twitter / X | Punchy, technical-but-accessible | 8 tweets ≤ 280 chars each + reply-ready Q&A |
| `linkedin-post.md` | LinkedIn | Professional, long-form, problem-first | ~1500 chars |
| `reddit-posts.md` | r/ClaudeAI, r/LocalLLaMA, r/SaaS | One variant per subreddit, audience-tuned | Variable per post |
| `show-hn.md` | Hacker News | Understated, technical specifics, design-decision focus | Title + URL + ~700-word first comment |

## Posting order recommendation

1. **GitHub release first** — every post links back, so the release page should be live with `RELEASE_NOTES.md` body before any social post.
2. **npm publish** — same reason; `npx -y @lyupro/skillforge-mcp` snippets stop working if the package isn't on the registry yet.
3. **Show HN** — earliest in the cycle; HN traffic peaks within 6-12 hours of submission. Post Tuesday-Thursday morning US Eastern time for the best window.
4. **r/ClaudeAI + r/LocalLLaMA** — same day or next morning. Reddit's algorithm tolerates the same project across multiple subs as long as the bodies are differentiated (these are).
5. **Twitter thread** — same day. Pin the first tweet. Engage in replies for 2-3 days.
6. **LinkedIn** — 24-48h after the social burst so the LinkedIn audience sees a "this is gaining traction" angle rather than "this just dropped".
7. **r/SaaS** — last; SaaS audience cares more about the business angle, so post it after you have early engagement signals to mention.

## Self-review checklist before posting

For every variant:

- [ ] No false claims (e.g. "production-tested on 1000 users" — we have 0 external users yet).
- [ ] No "lazy" hype language that contradicts the modular-architecture honesty of the codebase.
- [ ] Links resolve: GitHub repo, npm package (after publish), marketplace catalog, docs files.
- [ ] Brand consistency: public-facing brand is **Lyu Pro**. Internal project codenames are never mentioned in launch copy.
- [ ] No internal-only references (plan section numbers, OMC, internal stage numbering — those live in private docs, not the launch copy).
- [ ] Test count and gate numbers reflect the **actual** v1.3.0 release (561 tests / 61 files / 7 docs).
- [ ] The line "MIT licensed" appears in every variant.

## Out of scope for this file

- Visual assets — screenshots, OG images, demo GIFs. Add them under `marketing/assets/` (not yet created) once available.
- Mailing list / Substack / dev.to cross-posts — add new files here when the channels are decided.
- Anthropic-official marketplace submission body — that goes via their submission form, not a social post; keep its text in `docs/PUBLISHING.md` as part of release ops if needed.

## Tested

This is plain text copy. The only verification done is a manual character-count check on the Twitter tweets (each ≤ 280) and a visual proofread of every variant. Re-run the character counter (`twurl`, or `wc -m`) if you edit Twitter copy.
