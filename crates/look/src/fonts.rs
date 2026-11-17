//! Forma's interface faces: the bundled sans at four weights and the bundled mono, under the
//! family names the kit's type API gives ([`solidcraft_ui_kit::type_face`]). The host adds user
//! overrides and language fallbacks on top.
//!
//! Adapted from the font setup of SolidCraft's interface crate at its last MIT OR Apache-2.0
//! nightly (v0.40.0-nightly.20261110).

use std::sync::Arc;

use egui::{FontDefinitions, FontFamily};
use solidcraft_ui_kit::type_face::{BOLD_FAMILY, MEDIUM_FAMILY, SEMIBOLD_FAMILY, SYMBOL_FALLBACK, sans_families, semibold};

/// The bundled sans, Hanken Grotesk (a variable face: one file, every weight; SIL Open Font
/// License, `fonts/hanken-grotesk/OFL.txt`).
pub const UI_SANS: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/fonts/hanken-grotesk/HankenGrotesk-Variable.ttf"));
/// The bundled mono, IBM Plex Mono (SIL Open Font License, `fonts/ibm-plex-mono/OFL.txt`).
pub const UI_MONO: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/fonts/ibm-plex-mono/IBMPlexMono-Regular.ttf"));
/// The bundled sans under the name the interface crate's tests know it by.
pub const PLEX_SANS: &[u8] = UI_SANS;
/// The font-data name and weight of each sans family, in [`sans_families`] order.
pub const WEIGHTS: [(&str, f32); 4] = [("forma-sans", 400.0), (MEDIUM_FAMILY, 500.0), (SEMIBOLD_FAMILY, 600.0), (BOLD_FAMILY, 700.0)];

/// The bundled sans at 400/500/600/700 and the bundled mono, followed by egui's symbol/emoji
/// fallbacks. Each variable instance shares the embedded bytes and selects a real weight.
pub fn definitions() -> FontDefinitions {
    let mut fonts = FontDefinitions::default();
    let fallbacks = fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
    for ((name, weight), family) in WEIGHTS.into_iter().zip(sans_families()) {
        let mut data = egui::FontData::from_static(UI_SANS);
        data.tweak.coords = egui::epaint::text::VariationCoords::new([(b"wght", weight)]);
        fonts.font_data.insert(name.to_owned(), Arc::new(data));
        fonts.families.insert(family, std::iter::once(name.to_owned()).chain(fallbacks.iter().cloned()).collect());
    }
    fonts.font_data.insert("forma-mono".to_owned(), Arc::new(egui::FontData::from_static(UI_MONO)));
    fonts.families.entry(FontFamily::Monospace).or_default().insert(0, "forma-mono".to_owned());
    with_symbol_fallback(fonts)
}

/// `fonts` with egui's built-in Hack last in every sans family: the other fallbacks lack common
/// symbols such as ▲ ▼ ↑ ↓ → ⁻, which Hack has. Text the other faces draw keeps them.
pub fn with_symbol_fallback(mut fonts: FontDefinitions) -> FontDefinitions {
    if fonts.font_data.contains_key(SYMBOL_FALLBACK) {
        for family in sans_families() {
            let list = fonts.families.entry(family).or_default();
            list.retain(|name| name != SYMBOL_FALLBACK);
            list.push(SYMBOL_FALLBACK.to_owned());
        }
    }
    fonts
}

/// Give `ctx` these fonts, with headings in the semibold family.
pub fn apply(ctx: &egui::Context, fonts: FontDefinitions) {
    ctx.set_fonts(fonts);
    ctx.global_style_mut(|style| {
        if let Some(heading) = style.text_styles.get_mut(&egui::TextStyle::Heading) {
            heading.family = semibold(heading.size).family;
        }
    });
}
