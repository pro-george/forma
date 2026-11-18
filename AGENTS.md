# Forma: instructions for agents

Forma is George's parametric 3D modeler for printing. Its foundation is a fork of SolidCraft
(tangency-labs/solidcraft): the Rust engine, the solidcore kernel, the sketch solver, the egui
interface code and the web build below are SolidCraft's under MIT OR Apache-2.0, and SolidCraft's
own rules further down still apply to that code. Forma-specific facts first:

- **Licence line, never crossed.** On 2026-11-10 SolidCraft placed its UI kit (`crates/ui-kit`), look
  (`crates/look`: icons, glyphs, fonts, themes), theme tokens (`crates/theme`), name, logo and app
  icon under a separate Brand and Interface Licence. Forma carries none of that. Its three crates
  at those paths are its own, grown from SolidCraft's last MIT/Apache release before that date
  (`v0.40.0-nightly.20261110.117.1`). When the interface crate (`crates/ui-egui`, still MIT/Apache)
  needs something the kit lacks, write it from the call sites. **Never read, copy or consult
  upstream's versions of those three crates, `assets/branding` or `assets/icons/app` after that
  nightly**, in the working tree or in git history. Each crate's README says the same.
- Merging upstream: `scripts/forma-merge-upstream.sh <tag>`, which keeps those paths and
  upstream's workflows out. Then build, and fill the kit's gaps as above. Keep Forma's edits to
  upstream files small, local and marked with a `Forma:` comment, so merges stay clean.
- Branches: `forma-next` is the SolidCraft v0.43.0 fork with Forma's kit, look and brand; `main-sc`
  is the earlier v0.29.0 fork that the live site was built from; `upstream` is the remote for
  tangency-labs/solidcraft.
- Brand: the product is **Forma**. Its identity comes from Artea (floral white `#f5eee6`, dark slate
  grey `#30321d`, lime `#d5e8b8`, terracotta `#b5642a`): the `artea` theme is the default, with
  `artea-night` for dark; the interface face is Hanken Grotesk (OFL), since Artea's PP Mori is a
  commercial face that cannot ship in a public repository; the mark is the F in `crates/look`.
  The interface crate's build script replaces "SolidCraft" with "Forma" in every message catalog,
  so catalogs stay upstream's files. Crate, binary and command names still say `solidcraft`.
  Reports and update checks point at pro-george/forma, never upstream.
- `legacy-ts/` holds the earlier TypeScript Forma (Manifold mesh kernel, the Materializr-style
  im-touch studio, a sketch constraint solver, Bambu Studio / AMS 3MF export with per-part extruder
  slots, parametric ready-made parts such as the relief vase) and Artea Studio (studio.artea.ro's
  lampshade configurator). Its full history is on the `forma-ts` branch. Port features from it onto
  the Rust engine one at a time; do not develop new features there, except Artea Studio.
- Deploy: `.github/workflows/pages.yml` runs on pushes to `forma-next`: it builds
  `apps/solidcraft-web` with trunk at the site's root and Artea Studio at `/lampi/`, copies
  `examples/forma/<name>/<name>.sc` to `/designs/`, and hands the site to GitHub Pages as an
  artifact (Pages source = GitHub Actions; the `github-pages` environment must allow `forma-next`).
  Not a `gh-pages` push: the wasm file is over git's 100 MB a file. `/forma/`, the app's address
  until November 2026, redirects to the root (`deploy/forma-moved/`) and serves the service
  worker unbuilt so kept copies retire. The app's worker has the whole origin as its scope, so
  anything else published under the root must be named in `OUTSIDE` in `apps/solidcraft-web/sw.js`,
  or its pages answer 503 once the worker is installed. `forma-check.yml` runs the look crate's
  tests. Upstream's other workflows are removed on purpose.
- Looking at the app here: `cargo build --profile ci -j 1 -p solidcraft` (the dev profile runs out of
  memory on a small machine), then run it under `Xvfb` with `--control <port>` and take
  `ui.screenshot`; `--theme-file <path>` follows a theme file without rebuilding. The context's lock
  is not re-entrant: never call `ctx.options`, `ctx.data` or another context accessor inside an
  `input(|i| ...)` closure, the first frame hangs.
- `solidcraft_look::install_tables()` hands the kit Forma's icons, glyphs and built-in theme files;
  a test that reads themes calls it first. Theme `order` numbers are unique across `crates/look/themes`.
- SolidCraft's Ko-fi and Discord links are not shown (`crates/ui-egui/src/links.rs`, `LINKS` is empty).
- Upstream's tests of the kit's inner workings (`crates/ui-kit/src/*_tests.rs` and the interface
  crate's tests that name kit handles) were written against upstream's kit: some no longer
  compile or pass against Forma's. Fix or retire them as the kit is worked on; do not bend the
  kit to a test that only pinned upstream's pixels.
- Forma's own standing rules: no prices anywhere in Forma; 3MF for Bambu Studio must carry per-part
  extruder slots (see `legacy-ts/packages/core/src/export/threemf.ts` for the proven layout); units
  are mm, Z up.

---

# SolidCraft: instructions for agents (upstream rules, apply to the Rust code)

SolidCraft is a clean-room, pure-Rust parametric 3D CAD app (sketch solver, feature timeline, B-rep kernel, egui UI). This file is a router: the hard rules, then the skill to read for your task. Humans: CONTRIBUTING.md.

## Start here
Work: ROADMAP.md, "Where help is wanted most" in CONTRIBUTING.md, issues labelled `help wanted`, `good first issue`, `needs-triage`; architecture in `docs/architecture.md`.

## Hard rules (what enforces each)
- Integrations with other platforms need the maintainer's yes first: `skills/solidcraft-packaging/SKILL.md`.
- Independent: never copy another product's code, icons, text or templates; never drive or take data from commercial CAD. `skills/solidcraft-ground-rules/SKILL.md`.
- No GPL/LGPL/AGPL code, not even reading it (OpenCASCADE, FreeCAD, SolveSpace, CadQuery, LibreCAD, QCAD): `cargo xtask licences --check`.
- Every asset is original or openly licensed with a row in ATTRIBUTION.md; read `assets/AGENTS.md` before icon work: `cargo xtask assets`, `cargo xtask icons`.
- Never crash: no unwrap/expect/panic/unsafe in non-test code, errors are `Result`, input is hostile: clippy `-D warnings`, `hostile_params_never_panic`.
- Model decisions (what an operation does, which bodies it touches, which face or edge a point or name means, depths, nearness) use exact geometry; a mesh is for display, export, previews and mesh bodies (`xtask/mesh-decisions.txt` only shrinks): `cargo xtask mesh-decisions`.
- Everything is a command and programmatic calls never open dialogs: `skills/solidcraft-commands/SKILL.md`.
- Layering; only `crates/kernel` uses truck; solidcore only via `solidcore-ops`/`-tess`/`-record` (`xtask/solidcore-seam.txt`): `cargo xtask layers`; see `docs/layers.md`.
- One outer UI container, one camera path (`navigation::handle`), colours from theme tokens: `cargo xtask ui-containers`.
- Application code is Rust only and builds for wasm: `cargo xtask wasm`, `cargo xtask web-offline-test`.
- The product name is SolidCraft; the old name lives in `docs/compatibility.md`.
- Lists (message catalogs, `mod` lines, languages) stay sorted: `cargo xtask lists`. Never edit generated files (`docs/features.md`, `THIRD-PARTY-LICENSES.txt`) in a PR.
- A design-format change is ONE new file in `crates/doc/src/format/pending/`: `scripts/test-format-pending.sh`.
- A command has I/O schemas (soon required; `crates/engine/src/schema/unconverted.txt` only shrinks): `skills/solidcraft-commands/SKILL.md`.
- New UI strings go in `assets/locales/pending/<slug>.json`, ATTRIBUTION rows in `attribution/pending/<slug>.md`: `cargo xtask lists`.
- A changed default (existing UI, not kernel results) keeps the old behaviour behind a preference; fill the PR's `Changes a default:` line.
- A regression test goes in the area's existing test file, never a per-bug file (#3226).
- Look at open PRs first, claim with a draft PR (lowest number wins), one topic per PR: `skills/solidcraft-contributing/SKILL.md`.
- A PR's title and first sentence make sense to someone who never saw your chat or the issue: `skills/solidcraft-contributing/SKILL.md`.
- English throughout; independent work in parallel, dependent work in sequence: `skills/solidcraft-contributing/SKILL.md`.
- Show observable changes with screenshots or a recording you captured.
- Run `cargo xtask ci` before every commit; `cargo xtask skills` checks this file and `skills/`.

## Working on X: read the skill first
| Working on | Read |
|---|---|
| A PR, a claim, review, CI or evidence | `skills/solidcraft-contributing/SKILL.md` |
| Licences, assets, clean-room, the name | `skills/solidcraft-ground-rules/SKILL.md` |
| Non-test Rust, hostile input, a crash report | `skills/solidcraft-crash-safety/SKILL.md` |
| A command, a crate boundary | `skills/solidcraft-commands/SKILL.md` |
| SolidCraft or solidcore, kernel, geometry | `skills/solidcraft-layers/SKILL.md` |
| A dialog, panel, camera, icon, colour | `skills/solidcraft-ui/SKILL.md` |
| Sheet metal | `skills/solidcraft-sheetmetal/SKILL.md` |
| Labels, messages, translations | `skills/solidcraft-ui-text/SKILL.md` |
| Saving something new in a design, import, export | `skills/solidcraft-file-formats/SKILL.md` |
| Preferences, a changed default | `skills/solidcraft-preferences/SKILL.md` |
| Writing or running tests | `skills/solidcraft-tests/SKILL.md` |
| Slow work, the window thread, wasm | `skills/solidcraft-performance/SKILL.md` |
| Releases, installers, packages | `skills/solidcraft-packaging/SKILL.md` |
| Running the app, control channel, MCP tools | `skills/solidcraft-agent-tools/SKILL.md` |
| Building a part over MCP | `skills/solidcraft-modeling/SKILL.md` |
| Changing an existing design | `skills/solidcraft-editing/SKILL.md` |
| A bug report, a crash, a wrong result | `skills/solidcraft-reporting/SKILL.md` |
| Checking, porting, designs in git | `skills/solidcraft-checking/SKILL.md` |
| Assemblies, joints, motion | `skills/solidcraft-mechanisms/SKILL.md` |
