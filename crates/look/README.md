# Forma's look

Forma's icon masters and their colour roles (`icons/`), code-drawn glyphs and brand mark
(`src/glyphs.rs`, `src/compass.rs`, `src/pointer.rs`), interface faces (`fonts/`) and built-in
themes (`themes/`), compiled into one crate the app installs into the UI kit at startup
(`solidcraft_look::install_tables`).

## Where this comes from, and its licence

Everything in this crate is under **MIT OR Apache-2.0** (the fonts under the SIL Open Font
License, see `ATTRIBUTION.md`). None of it comes from the crate of the same path that SolidCraft
placed under its Brand and Interface Licence on 2026-11-10:

- The icon masters, palette, aliases and tools, the control glyphs, the compass ends, the agent
  pointer, the IBM Plex Mono face and the theme files other than Forma's come from SolidCraft's
  last release published before that licence, `v0.40.0-nightly.20261110.117.1`, where they lived
  under `assets/` and in the interface crate under MIT OR Apache-2.0.
- Forma's own: the brand mark (`glyphs::brand_mark`), the `artea` and `artea-night` themes, the
  choice of Hanken Grotesk as the interface face, and the code that puts the crate together.

Keep it that way: never copy from upstream's `crates/look`, `crates/ui-kit` or `crates/theme`
after that nightly, and never read them to see how something is done. `scripts/forma-merge-upstream.sh`
keeps upstream's later versions of these three folders out of a merge.

## The mark

An F on a grid 76 wide and 100 tall: a stem (x 0..24), a top arm (y 0..24), both with round ends,
and a dot of radius 13 centred at (51, 51) for the middle arm. `assets/icons/app/shared/source/app_icon.rs`
draws the application icon from the same numbers.
