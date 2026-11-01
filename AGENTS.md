# Forma: instructions for agents

Forma is George's parametric 3D modeler for printing. Since 2026-11 its foundation is a fork of
SolidCraft (tangency-labs/solidcraft, MIT OR Apache-2.0): the Rust engine, kernel, sketch solver,
egui UI and web build below are SolidCraft's, and SolidCraft's own rules further down still apply
to that code. Forma-specific facts first:

- `main` is the SolidCraft fork plus Forma's additions; `upstream` is tangency-labs/solidcraft, merged
  in from time to time, so keep Forma changes small, local and commented, and never rewrite upstream
  files wholesale when a hook or a new module would do.
- `legacy-ts/` holds the earlier TypeScript Forma (Manifold mesh kernel, the Materializr-style
  im-touch studio, a sketch constraint solver, Bambu Studio / AMS 3MF export with per-part extruder
  slots, parametric ready-made parts such as the relief vase) and Artea Studio (studio.artea.ro's
  lampshade configurator). Its full history is on the `forma-ts` branch. Port features from it onto
  the Rust engine one at a time; do not develop new features there, except Artea Studio.
- Deploy: `.github/workflows/pages.yml` builds `apps/solidcraft-web` with trunk at `/forma/` and
  Artea Studio at `/`, and publishes `gh-pages` under studio.artea.ro. Upstream's other workflows
  (release, packaging, bots) are removed on purpose.
- Branding so far: only the web shell's title, meta and manifest say Forma; crates, binaries and
  in-app strings still say SolidCraft until the rebranding subject is taken up.
- Forma's own standing rules: no prices anywhere in Forma; 3MF for Bambu Studio must carry per-part
  extruder slots (see `legacy-ts/packages/core/src/export/threemf.ts` for the proven layout); units
  are mm, Z up.

---

# SolidCraft: instructions for agents (upstream rules, apply to the Rust code)

SolidCraft is a clean-room, pure-Rust parametric 3D CAD app (sketch solver, feature timeline, B-rep kernel, an egui UI that agents drive). This file is a router: the hard rules, then the skill to read for your task. Humans: CONTRIBUTING.md.

## Start here
Work: ROADMAP.md, "Where help is wanted most" in CONTRIBUTING.md, issues labelled `help wanted`, `good first issue`, `needs-triage`; architecture in `docs/architecture.md`. Act when the code, docs and rules settle a question; ask only when it changes what users see. Local `plan/` notes are optional.

## Hard rules (what enforces each)
- Independent: never copy another product's code, icons, text or templates; never drive or take data from commercial CAD. `skills/solidcraft-ground-rules/SKILL.md`.
- No GPL/LGPL/AGPL code, not even reading it (OpenCASCADE, FreeCAD, SolveSpace, CadQuery, LibreCAD, QCAD): `cargo xtask licences --check`.
- Every asset is original or openly licensed with a row in ATTRIBUTION.md; read `assets/AGENTS.md` before icon work: `cargo xtask assets`, `cargo xtask icons`.
- Never crash: no unwrap/expect/panic/unsafe in non-test code (unsafe allowlist in crash-safety), errors are `Result`, input is hostile: clippy `-D warnings`, `hostile_params_never_panic`.
- Everything is a command and programmatic calls never open dialogs: `skills/solidcraft-commands/SKILL.md`.
- Layering (geom, sketch/kernel/render, doc, io, engine, ui-egui, apps); only `crates/kernel` uses truck: `cargo xtask layers`.
- One outer UI container, one camera path (`navigation::handle`), colours from theme tokens: `cargo xtask ui-containers`.
- Application code is Rust only and builds for wasm: `cargo xtask wasm`, `cargo xtask web-offline-test`.
- The product name is SolidCraft; the old name lives only in `docs/compatibility.md`.
- Sorted lists (message catalogs, `mod` lines, languages) stay sorted: `cargo xtask lists`. Never edit generated files (`docs/features.md`, `THIRD-PARTY-LICENSES.txt`) in a PR.
- A design-format change is ONE new file in `crates/doc/src/format/pending/`: `scripts/test-format-pending.sh`.
- A command has input and output schemas (will become required; `schema/unconverted.txt` only shrinks): `skills/solidcraft-commands/SKILL.md`.
- New UI strings go in `assets/locales/pending/<slug>.json`, ATTRIBUTION rows in `attribution/pending/<slug>.md`: `cargo xtask lists`.
- A changed default keeps the old behaviour behind a preference and fills the PR's `Changes a default:` line, and no second PR for an issue a lower-numbered one closes: `pr-checks.yml`.
- A regression test goes in the area's existing test file, never a per-bug file (#3226).
- Look at open PRs first, claim with a draft PR (lowest number wins), one topic per PR, never force-push `main`, no pushes just to catch up with `main`: `skills/solidcraft-contributing/SKILL.md`.
- Show observable changes with real screenshots or a recording, captured yourself.
- Run `cargo xtask ci` before every commit, without switching branches while it runs. `cargo xtask skills` keeps this file and `skills/` honest.

## Working on X: read the skill first
| Working on | Read |
|---|---|
| A PR, a claim, review, CI or evidence | `skills/solidcraft-contributing/SKILL.md` |
| Licences, assets, clean-room, the name | `skills/solidcraft-ground-rules/SKILL.md` |
| Non-test Rust, hostile input, a crash report | `skills/solidcraft-crash-safety/SKILL.md` |
| A command, a crate boundary | `skills/solidcraft-commands/SKILL.md` |
| A dialog, panel, camera, icon, colour | `skills/solidcraft-ui/SKILL.md` |
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
