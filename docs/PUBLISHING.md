# Publishing SkillForge MCP

Internal runbook for cutting a new release. Audience: maintainers only.

## 1. Pre-flight

Verify all three manifests agree on the release version.

```bash
node -e "
const p = require('./package.json');
const pl = require('./.claude-plugin/plugin.json');
const mk = require('./.claude-plugin/marketplace.json');
const m = require('./manifest.json');
console.log({package: p.version, plugin: pl.version, manifest: m.version, marketplacePlugin: mk.plugins[0].version});
"
```

All four values must match the tag you are about to cut.

## 2. Full verification

```bash
pnpm test         # 532 passing + 1 win32-skip
pnpm lint         # tsc --noEmit
pnpm check:size   # all source files ≤ 400 lines
pnpm build        # tsc -p tsconfig.json — produces dist/
pnpm smoke        # subprocess end-to-end via dist/cli/dispatcher.js serve
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
- `.claude-plugin/**` — `plugin.json` + `marketplace.json` (Claude Code plugin manifests)
- `dist/**` — TypeScript build output

If the tarball size jumps drastically, inspect `package.json#files` for accidental inclusion.

Notes:

- **`.claude-plugin/`** ships in the npm tarball (it is listed in `package.json#files`) so the package is installable as a Claude Code plugin directly from npm — `plugin.json` is the plugin manifest, `marketplace.json` is the marketplace catalog.
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

**Alternative — push commits + tag together, version read from `package.json`** (no hardcoded version, single push):

```bash
VERSION="v$(node -p "require('./package.json').version")"
git tag -a "$VERSION" -m "SkillForge MCP $VERSION"   # skip if the tag already exists

# or simply:
git push --follow-tags        # branch commits + annotated tags, one push
```

`--follow-tags` pushes the branch plus any annotated tags reachable from the pushed commits, so the commit and its tag land in a single command. Reading `VERSION` from `package.json` keeps the tag in sync with the version stamped in step 1. If the tag already exists (release script, earlier session), drop the tagging lines and run `git push --follow-tags` on its own. It only pushes annotated tags reachable from the pushed commits — both hold for a tag made on the current branch; for lightweight tags or to force every local tag up, use `git push origin <branch> --tags` instead.

On GitHub, create a Release from the tag and paste the body of `RELEASE_NOTES.md`. Attach `lyupro-skillforge-mcp-<version>.tgz` produced by `npm pack` if you want a release artifact bound to the source tag.

## 7. Marketplace catalog

The marketplace catalog is `.claude-plugin/marketplace.json` inside this repo — there is no separate marketplace repository. Its `plugins[0].version` is bumped as part of the version sync in step 1, so no extra action is needed here. Confirm it matches:

```bash
node -e "console.log(require('./.claude-plugin/marketplace.json').plugins[0].version)"
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

- [ ] All four manifests (`package.json`, `manifest.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`) match the published version.
- [ ] CHANGELOG.md has the new version section.
- [ ] GitHub Release published with `RELEASE_NOTES.md` body.
- [ ] Marketplace catalog `plugins[0].version` updated.
- [ ] `npm view @lyupro/skillforge-mcp` returns the new version as `latest`.
- [ ] Smoke test against the published package passes.
