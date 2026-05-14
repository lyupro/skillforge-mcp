# Publishing SkillForge MCP

Internal runbook for cutting a new release. Audience: maintainers only.

## 1. Pre-flight

Verify all three manifests agree on the release version.

```bash
node -e "
const p = require('./package.json');
const pl = require('./plugin.json');
const m = require('./manifest.json');
console.log({package: p.version, plugin: pl.version, manifest: m.version});
"
```

All three values must match the tag you are about to cut.

## 2. Full verification

```bash
pnpm test         # 370 + 1 win32-skip
pnpm lint         # tsc --noEmit
pnpm check:size   # all source files ≤ 400 lines
pnpm build        # tsc -p tsconfig.json — produces dist/
pnpm smoke        # subprocess end-to-end via dist/server.js
```

All five gates must exit zero. If any gate fails, **do not publish**; fix on master first.

## 3. Tarball preview (dry run)

```bash
npm pack --dry-run
```

Expected root entries in the tarball:

- `CHANGELOG.md`
- `LICENSE`
- `README.md`
- `manifest.json`
- `package.json`
- `dist/**` — TypeScript build output (≈ 190 files)

Expected tarball size: ≈ 60 KB compressed, ≈ 230 KB unpacked. If the size jumps drastically, inspect `package.json#files` for accidental inclusion.

Notes on intentional exclusions:

- **`plugin.json`** lives at the GitHub repository root for the marketplace catalog; it is not consumed at runtime and ships only via the marketplace listing, not the npm tarball.
- **`RELEASE_NOTES.md`** is the GitHub Release body; CHANGELOG.md is the canonical machine-readable changelog inside the package.
- **`docs/`, `examples/`, `skills/`, `marketing/`, `scripts/`, `src/`, `tests/`** are not in `package.json#files`; npm consumers receive only the built artifacts.

## 4. npm authentication

```bash
npm whoami            # confirm logged in as the publishing identity
npm login             # if needed; 2FA is mandatory for the @lyupro scope
```

If `npm whoami` errors, run `npm login` with the npm account that owns the `@lyupro` scope.

## 5. Publish

```bash
npm publish --access public
```

`prepublishOnly` runs `pnpm build` automatically; the published tarball reflects the freshly compiled `dist/`.

Verify the listing landed:

```bash
npm view @lyupro/skillforge-mcp
npm view @lyupro/skillforge-mcp dist-tags
```

The `latest` tag should point at the version you just published.

## 6. Git tag + GitHub Release

```bash
git tag -a v1.0.0 -m "SkillForge MCP v1.0.0"
git push origin v1.0.0
```

On GitHub, create a Release from the tag and paste the body of `RELEASE_NOTES.md`. Attach `lyupro-skillforge-mcp-<version>.tgz` produced by `npm pack` if you want a release artifact bound to the source tag.

## 7. Update marketplace catalog

In the sibling [`llm-plugins-marketplace`](https://github.com/lyupro/llm-plugins-marketplace) repository, bump `plugins[0].version` to the new value, commit, and push.

```bash
cd ../llm-plugins-marketplace
# edit marketplace.json — bump skillforge-mcp version
git add marketplace.json
git commit -m "feat(skillforge-mcp): bump to v<version>"
git push
```

## 8. Smoke against the published package

```bash
# Fresh temporary shell
npx -y @lyupro/skillforge-mcp --help    # exits 0 (MCP server prints handshake)
claude mcp add skillforge -- npx -y @lyupro/skillforge-mcp
```

In a Claude Code session, run `skills__list` to confirm the npm-installed server responds.

## 9. Rollback

If a critical defect is discovered immediately after publish:

```bash
npm deprecate "@lyupro/skillforge-mcp@<bad-version>" "Deprecated due to <reason>. Use <good-version>."
```

`npm unpublish` is reserved for the 72-hour window and only for genuine accidents (secrets leaked, wrong tarball). Prefer `deprecate` once the version has any download.

## 10. Post-release checklist

- [ ] All three manifest files match the published version.
- [ ] CHANGELOG.md has the new version section.
- [ ] GitHub Release published with `RELEASE_NOTES.md` body.
- [ ] Marketplace catalog `plugins[0].version` updated.
- [ ] `npm view @lyupro/skillforge-mcp` returns the new version as `latest`.
- [ ] Smoke test against the published package passes.
