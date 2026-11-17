//! Forma's look, ready to install into the UI kit: icon masters and their colour roles
//! ([`icons`]), code-drawn glyphs ([`glyphs`], [`compass`], [`pointer`]), interface faces
//! ([`fonts`]) and built-in themes ([`themes`]).
//!
//! Everything here is Forma's own or comes from SolidCraft's last MIT OR Apache-2.0 nightly
//! (v0.40.0-nightly.20261110); nothing is taken from the crates SolidCraft later placed under its
//! brand licence. See `README.md`.

pub mod compass;
pub mod fonts;
pub mod glyphs;
pub mod icons;
pub mod pointer;
pub mod themes;

/// Forma's code-drawn glyphs, as the kit draws them ([`solidcraft_ui_kit::icons::glyphs`]).
pub static GLYPHS: solidcraft_ui_kit::icons::glyphs::Glyphs = solidcraft_ui_kit::icons::glyphs::Glyphs {
    transport: glyphs::transport_glyph,
    caption: glyphs::paint_glyph,
    badge: glyphs::badge,
    pin: glyphs::pin_icon,
    cross: glyphs::cross,
    breadcrumb: glyphs::breadcrumb,
    axis_tip: compass::axis_tip_scaled,
    axis_radius: compass::AXIS_RADIUS,
    pointer: pointer::paint,
    brand_mark: glyphs::brand_mark_silhouette,
};

/// Make Forma's icons and glyphs the ones the kit draws: at startup, before the first frame, and
/// in every test context. Calling it again does nothing.
pub fn install_tables() {
    solidcraft_ui_kit::icons::install(&icons::SET);
    solidcraft_ui_kit::icons::glyphs::install(&GLYPHS);
}

/// The whole look for one egui context: the tables and the bundled faces.
pub fn install(ctx: &egui::Context) {
    install_tables();
    fonts::apply(ctx, fonts::definitions());
}
