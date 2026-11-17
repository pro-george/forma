//! Forma's code-drawn glyphs: transport, window caption, badges, pin, cross, breadcrumb and the
//! brand mark. The control glyphs come from SolidCraft's last MIT OR Apache-2.0 nightly
//! (v0.40.0-nightly.20261110, caption geometry adapted there from VectorCraft, same licences);
//! the brand mark is Forma's own.
use solidcraft_ui_kit::window_chrome::Caption;
use egui::{Color32, Pos2, Rect, Stroke, Ui, pos2, vec2};

pub fn transport_glyph(p: &egui::Painter, c: egui::Pos2, what: &str, col: Color32) {
    let tri = |dir: f32, dx: f32| {
        let pts = vec![pos2(c.x + dx - 4.0 * dir, c.y - 5.0), pos2(c.x + dx + 4.0 * dir, c.y), pos2(c.x + dx - 4.0 * dir, c.y + 5.0)];
        p.add(egui::Shape::convex_polygon(pts, col, Stroke::NONE));
    };
    let bar = |dx: f32| p.line_segment([pos2(c.x + dx, c.y - 5.0), pos2(c.x + dx, c.y + 5.0)], Stroke::new(1.6, col));
    match what {
        "first" => {
            bar(-5.0);
            tri(-1.0, 1.0);
        }
        "back" => tri(-1.0, 0.0),
        "forward" => tri(1.0, 0.0),
        // Play History: larger than the step arrows so it doesn't read as Forward, and two bars
        // while it plays.
        "play" => {
            let pts = vec![pos2(c.x - 4.5, c.y - 7.0), pos2(c.x + 6.5, c.y), pos2(c.x - 4.5, c.y + 7.0)];
            p.add(egui::Shape::convex_polygon(pts, col, Stroke::NONE));
        }
        "pause" => {
            for dx in [-3.0, 3.0] {
                p.rect_filled(Rect::from_center_size(pos2(c.x + dx, c.y), vec2(3.0, 12.0)), 0.5, col);
            }
        }
        _ => {
            tri(1.0, -1.0);
            bar(5.0);
        }
    }
}

pub fn paint_glyph(ui: &Ui, c: Caption, maximized: bool, at: egui::Pos2, s: Stroke) {
    let p = ui.painter();
    let g = Rect::from_center_size(at, vec2(10.0, 10.0));
    match c {
        Caption::Minimize => {
            p.line_segment([g.left_center(), g.right_center()], s);
        }
        // Restore: a front square with the corner of the one behind it.
        Caption::Maximize if maximized => {
            let front = Rect::from_min_max(g.min + vec2(0.0, 2.0), g.max - vec2(2.0, 0.0));
            p.rect_stroke(front, 0.0, s, egui::StrokeKind::Middle);
            p.line(vec![g.min + vec2(2.0, 2.0), g.min + vec2(2.0, 0.0), g.right_top(), g.max - vec2(0.0, 2.0), g.max - vec2(2.0, 2.0)], s);
        }
        Caption::Maximize => {
            p.rect_stroke(g, 0.0, s, egui::StrokeKind::Middle);
        }
        Caption::Close => {
            p.line_segment([g.left_top(), g.right_bottom()], s);
            p.line_segment([g.right_top(), g.left_bottom()], s);
        }
    }
}

pub fn badge(p: &egui::Painter, r: Rect, name: &str, c: Color32) {
    let s = Stroke::new(1.3, c);
    match name {
        "lock" => {
            let body = Rect::from_min_max(pos2(r.left() + 1.5, r.center().y - 0.5), pos2(r.right() - 1.5, r.bottom() - 0.5));
            p.rect_filled(body, 1.5, c);
            let top = pos2(r.center().x, r.top() + 4.0);
            p.add(egui::Shape::line(
                (0..=8)
                    .map(|k| {
                        let a = std::f32::consts::PI * (k as f32 / 8.0);
                        pos2(top.x - 3.2 * a.cos(), top.y - 3.2 * a.sin() + 1.0)
                    })
                    .chain([pos2(top.x + 3.2, body.top())])
                    .collect(),
                s,
            ));
            p.line_segment([pos2(top.x - 3.2, top.y + 1.0), pos2(top.x - 3.2, body.top())], s);
        }
        "pin" => {
            let head = pos2(r.center().x + 2.0, r.top() + 4.0);
            p.circle_filled(head, 3.2, c);
            p.line_segment([head, pos2(r.left() + 1.5, r.bottom() - 1.0)], Stroke::new(1.6, c));
        }
        _ => {}
    }
}

pub fn pin_icon(p: &egui::Painter, r: Rect, on: bool, col: Color32) {
    let c = r.center();
    let (sin, cos) = if on { (0.0, 1.0) } else { std::f32::consts::FRAC_PI_4.sin_cos() };
    // Local coordinates: the pin points down, its head on top.
    let at = |x: f32, y: f32| c + vec2(x * cos - y * sin, x * sin + y * cos);
    let head = vec![at(-2.5, -7.0), at(2.5, -7.0), at(3.0, -2.0), at(-3.0, -2.0)];
    let stroke = Stroke::new(1.4, col);
    if on {
        p.add(egui::Shape::convex_polygon(head, col, stroke));
    } else {
        p.add(egui::Shape::closed_line(head, stroke));
    }
    p.line_segment([at(-5.5, -2.0), at(5.5, -2.0)], stroke);
    p.line_segment([at(0.0, -2.0), at(0.0, 7.0)], stroke);
}

/// A breadcrumb separator ("Sketch › Create"): a thin chevron about 3 by 6 px, centred on `c`.
/// Drawn rather than typed, because a font's "›" sits on the baseline in some languages
/// (Japanese), where it reads as a comma.
pub fn breadcrumb(p: &egui::Painter, c: egui::Pos2, col: Color32) {
    let s = Stroke::new(1.0, col);
    p.line_segment([pos2(c.x - 1.5, c.y - 3.0), pos2(c.x + 1.5, c.y)], s);
    p.line_segment([pos2(c.x + 1.5, c.y), pos2(c.x - 1.5, c.y + 3.0)], s);
}

/// Forma's mark in the theme's logo colours: an F made of a stem, a top arm and a dot for the
/// middle arm. `c` is its centre; it is 20 points tall.
pub fn brand_mark(p: &egui::Painter, c: Pos2) {
    brand_mark_styled(p, c, 20.0, solidcraft_theme::Tokens::get().logo);
}

/// The same mark in one ink, at any height.
pub fn brand_mark_silhouette(p: &egui::Painter, c: Pos2, height: f32, ink: Color32) {
    brand_mark_styled(p, c, height, [ink; 3]);
}

/// The mark on a 100-unit-tall grid, 76 wide: stem 0..24 × 0..100, arm 0..76 × 0..24 (both with
/// round ends), dot of radius 13 centred at (51, 51). `colours` are stem, arm and dot.
fn brand_mark_styled(p: &egui::Painter, c: Pos2, height: f32, colours: [Color32; 3]) {
    let s = height / 100.0;
    let at = |x: f32, y: f32| pos2(c.x + (x - 38.0) * s, c.y + (y - 50.0) * s);
    let [stem, arm, dot] = colours;
    let round = (12.0 * s).min(255.0);
    p.rect_filled(Rect::from_min_max(at(0.0, 0.0), at(24.0, 100.0)), round, stem);
    p.rect_filled(Rect::from_min_max(at(0.0, 0.0), at(76.0, 24.0)), round, arm);
    p.circle_filled(at(51.0, 51.0), 13.0 * s, dot);
}

pub fn cross(p: &egui::Painter, r: Rect, s: Stroke) {
    p.line_segment([r.left_top(), r.right_bottom()], s);
    p.line_segment([r.right_top(), r.left_bottom()], s);
}
