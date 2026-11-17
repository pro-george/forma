//! The theme files shipped with Forma (`themes/*.json`), embedded at build time.

include!(concat!(env!("OUT_DIR"), "/builtin_themes.rs"));

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_built_in_theme_reads_and_they_are_sorted() {
        let themes = solidcraft_ui_kit::theme_files::read_builtin(BUILTIN).expect("every shipped theme file is valid");
        assert_eq!(themes.len(), BUILTIN.len());
        assert!(BUILTIN.windows(2).all(|pair| pair[0].0 < pair[1].0), "source entries are sorted by id");
        for id in ["artea", "artea-night"] {
            assert!(BUILTIN.iter().any(|(theme, _)| *theme == id), "{id} ships");
        }
    }
}
