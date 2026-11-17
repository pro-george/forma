//! Forma's application icon, drawn in code so every app and tool makes the same picture at any
//! size: a warm paper tile with the Forma mark, an F made of a stem, a top arm and a dot for the
//! middle arm. Included by path into the desktop app, the CLI and xtask, so it uses only `std`.
//!
//! The mark's geometry is the one `solidcraft_look::glyphs` draws in the application bar: a grid
//! 76 wide and 100 tall, the stem at x 0..24, the arm at y 0..24 (both with round ends) and a
//! dot of radius 13 centred at (51, 51).

/// The tile, the mark and the dot: Artea's floral white, dark slate grey and terracotta.
const TILE: [u8; 3] = [0xf5, 0xee, 0xe6];
const INK: [u8; 3] = [0x30, 0x32, 0x1d];
const DOT: [u8; 3] = [0xb5, 0x64, 0x2a];

/// The parts of the mark on its 76 × 100 grid, sorted by name: (name, left, top, right, bottom).
/// The dot's box is the square around its circle.
#[allow(dead_code)]
pub const PARTS: [(&str, f64, f64, f64, f64); 3] = [("arm", 0.0, 0.0, 76.0, 24.0), ("dot", 38.0, 38.0, 64.0, 64.0), ("stem", 0.0, 0.0, 24.0, 100.0)];

/// The share of the tile's side the mark's height takes, and the tile's corner radius.
const MARK_HEIGHT: f64 = 0.56;
const TILE_RADIUS: f64 = 0.225;

/// Whether the point is inside the rounded rectangle (`radius` clamps to half its shorter side).
fn in_round_rect(x: f64, y: f64, (left, top, right, bottom): (f64, f64, f64, f64), radius: f64) -> bool {
    if x < left || x > right || y < top || y > bottom {
        return false;
    }
    let radius = radius.min((right - left) / 2.0).min((bottom - top) / 2.0);
    let cx = x.clamp(left + radius, right - radius);
    let cy = y.clamp(top + radius, bottom - radius);
    (x - cx).powi(2) + (y - cy).powi(2) <= radius * radius
}

/// The colour at a point of the unit square, or None outside the tile.
fn colour_at(x: f64, y: f64) -> Option<[u8; 3]> {
    if !in_round_rect(x, y, (0.0, 0.0, 1.0, 1.0), TILE_RADIUS) {
        return None;
    }
    // The point on the mark's grid: the mark is centred in the tile.
    let scale = MARK_HEIGHT / 100.0;
    let (gx, gy) = ((x - (0.5 - 38.0 * scale)) / scale, (y - (0.5 - 50.0 * scale)) / scale);
    if (gx - 51.0).powi(2) + (gy - 51.0).powi(2) <= 13.0 * 13.0 {
        return Some(DOT);
    }
    if in_round_rect(gx, gy, (0.0, 0.0, 24.0, 100.0), 12.0) || in_round_rect(gx, gy, (0.0, 0.0, 76.0, 24.0), 12.0) {
        return Some(INK);
    }
    Some(TILE)
}

/// The icon as `size` × `size` RGBA pixels (straight alpha), each averaged over a 4 × 4 grid of
/// samples. An error for a size no icon has.
pub fn rgba(size: usize) -> Result<Vec<u8>, String> {
    if size == 0 || size > 4096 {
        return Err(format!("icon: {size} is not a size an icon has"));
    }
    const SAMPLES: usize = 4;
    let mut out = Vec::with_capacity(size * size * 4);
    for py in 0..size {
        for px in 0..size {
            let (mut sum, mut covered) = ([0u32; 3], 0u32);
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let x = (px as f64 + (sx as f64 + 0.5) / SAMPLES as f64) / size as f64;
                    let y = (py as f64 + (sy as f64 + 0.5) / SAMPLES as f64) / size as f64;
                    if let Some(colour) = colour_at(x, y) {
                        covered += 1;
                        for (total, channel) in sum.iter_mut().zip(colour) {
                            *total += u32::from(channel);
                        }
                    }
                }
            }
            let total = (SAMPLES * SAMPLES) as u32;
            for channel in sum {
                out.push(if covered == 0 { 0 } else { ((channel + covered / 2) / covered) as u8 });
            }
            out.push(((covered * 255 + total / 2) / total) as u8);
        }
    }
    Ok(out)
}
