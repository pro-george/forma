//! Regenerate the exports of Forma's app icon together: the PNGs the web shell ships
//! (`assets/icons/app/exports/forma-<size>.png`). The picture is drawn by
//! `assets/icons/app/shared/source/app_icon.rs`, through `solidcraft-cli icon`.
use std::path::Path;

/// The sizes the web shell and its manifest name.
const SIZES: [usize; 3] = [32, 256, 512];

pub fn run(root: &Path) -> Result<(), String> {
    let stage = root.join("target/resources/app-icons");
    std::fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    let mut exports = Vec::new();
    for size in SIZES {
        let png = stage.join(format!("{size}.png"));
        draw(&png, size)?;
        exports.push((png, format!("exports/forma-{size}.png")));
    }
    // Finish generation before replacing any canonical exports.
    for (source, relative) in exports {
        let target = root.join("assets/icons/app").join(relative);
        if let Some(dir) = target.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        std::fs::copy(source, target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn draw(path: &Path, size: usize) -> Result<(), String> {
    let mut c = crate::cargo();
    c.args(["run", "-q", "--profile", "ci", "-p", "solidcraft-cli", "--", "icon", "--size", &size.to_string(), "--out"]).arg(path);
    crate::run(c, "solidcraft-cli icon")
}
