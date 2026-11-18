//! The theme files shipped with Forma (`themes/*.json`), embedded at build time.

include!(concat!(env!("OUT_DIR"), "/builtin_themes.rs"));

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_built_in_theme_reads_and_they_are_sorted() {
        // The icon roles a theme may recolour are the installed icon set's, and its per-tab
        // tables are keyed by the host's tab names: the ones the shipped themes use.
        use solidcraft_theme::{AccentRamp, TabStyle, TabTable};
        const TABS: &[TabStyle] = &[
            TabStyle { name: "FORM", ramp: AccentRamp::Main, icon_accent: None },
            TabStyle { name: "MESH", ramp: AccentRamp::Main, icon_accent: None },
            TabStyle { name: "MODEL", ramp: AccentRamp::Main, icon_accent: None },
            TabStyle { name: "RENDER", ramp: AccentRamp::Main, icon_accent: None },
            TabStyle { name: "SHEET METAL", ramp: AccentRamp::Main, icon_accent: None },
            TabStyle { name: "SKETCH", ramp: AccentRamp::Main, icon_accent: None },
            TabStyle { name: "SURFACE", ramp: AccentRamp::Main, icon_accent: None },
        ];
        crate::install_tables();
        solidcraft_theme::install_tabs(TabTable::new(TABS));
        let themes = solidcraft_ui_kit::theme_files::read_builtin(BUILTIN).expect("every shipped theme file is valid");
        assert_eq!(themes.len(), BUILTIN.len());
        assert!(BUILTIN.windows(2).all(|pair| pair[0].0 < pair[1].0), "source entries are sorted by id");
        for id in ["artea", "artea-night"] {
            assert!(BUILTIN.iter().any(|(theme, _)| *theme == id), "{id} ships");
            // Through the kit, as the app finds its default theme: `install_tables` hands the files over.
            assert!(solidcraft_ui_kit::theme_files::find(id, &[]).is_some(), "{id} is installed");
        }
    }
}
