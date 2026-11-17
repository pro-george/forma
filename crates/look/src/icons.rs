//! Forma's icon set: the SVG masters in `icons/design/svg`, drawn by the kit's renderer
//! ([`solidcraft_ui_kit::icons`]).
//!
//! The masters, `palette.toml` (every colour role in light and dark, and the accents) and
//! `aliases.toml` are embedded at build time (see `build.rs`) as the [`SET`] the app installs at
//! startup and in its test contexts ([`crate::install_tables`]). A master never carries a colour
//! of its own: it names a palette role. `palette.toml` owns defaults; theme files may override
//! display roles and semantic ramps.

use solidcraft_ui_kit::icons::{self, IconData, IconSet};

include!(concat!(env!("OUT_DIR"), "/icon_data.rs"));

const _: () = assert!(
    ROLE_NAMES.len() <= icons::MAX_ROLES && ACCENT_NAMES.len() <= icons::MAX_ACCENTS,
    "a theme file must be able to override every role and accent"
);

/// Forma's icons.
pub static SET: IconSet = IconSet::new(IconData {
    role_names: ROLE_NAMES,
    role_source_hex: ROLE_SOURCE_HEX,
    palette: PALETTE,
    accent_names: ACCENT_NAMES,
    accents: ACCENTS,
    accent_variants: ACCENT_VARIANTS,
    masters: SVGS,
    aliases: ALIASES,
    icon_accents: ICON_ACCENTS,
    danger_accent: "constraint",
});

#[cfg(test)]
mod tests {
    use super::*;
    use solidcraft_ui_kit::icons::PLACEHOLDER;

    #[test]
    fn every_master_parses() {
        for (id, fam, src) in SVGS {
            if let Err(e) = SET.parse(src) {
                panic!("{fam}/{id}: {e}");
            }
        }
        assert!(SET.has_master(PLACEHOLDER), "the placeholder master exists");
    }

    #[test]
    fn aliases_point_at_masters_and_known_accents() {
        for (alias, master, accent) in ALIASES {
            assert!(SET.has_master(master), "{alias} -> {master}");
            assert!(accent.is_empty() || ACCENT_NAMES.contains(accent), "{alias}: accent {accent}");
            assert!(!SET.resolve(alias).placeholder);
        }
    }
}
