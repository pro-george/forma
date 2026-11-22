//! Forma: a building as a scale model to print (`arch.maquette`).
//!
//! The work happens on a copy of the session, so the design is left as it is:
//!
//! 1. Doors and windows are closed (their angle and opening set to 0), and every wall, slab,
//!    roof shell, frame, depth, leaf, sash and glass thinner than the printer's thinnest wall at
//!    this scale is thickened, by changing its parameter on the copy: the elements rebuild
//!    around the new numbers as they would in the design.
//! 2. The bodies are sorted into the parts of pieces: a piece per level (its walls, floors,
//!    doors and windows), and the roofs and the slabs on top of walls as pieces to lift off.
//!    Each part has its filament slot by what it is (walls, slabs, frames, leaves, glass, roof).
//!    A body smaller than the thinnest wall in some direction (a door handle) is left out.
//! 3. A piece larger than the plate is split by planes into pieces that fit, and where a wall
//!    crosses a cut square enough and thick enough, away from its openings, holes for 1.75 mm
//!    filament pins are drilled across the cut.
//! 4. The pieces are laid on plates and written as a 3MF whose parts carry their slots.

use super::*;
use crate::schema::arch::{MaquetteMade, MaquetteParams, MaquettePiece, Thickened};

pub(super) const MAQUETTE: TypedContract<MaquetteParams> = TypedContract::new();

/// A filament pin's hole and how far it reaches into each side of a cut (print millimetres).
const PIN_HOLE: f64 = 1.9;
const PIN_DEPTH: f64 = 4.0;
/// Room left around pieces on the plate (print millimetres).
const MARGIN: f64 = 5.0;
const GAP: f64 = 4.0;

/// A body's bounding box in the design (mm).
#[derive(Clone, Copy, Debug)]
struct BBox {
    min: [f64; 3],
    max: [f64; 3],
}

impl BBox {
    fn union(self, o: BBox) -> BBox {
        BBox { min: [0, 1, 2].map(|i| self.min[i].min(o.min[i])), max: [0, 1, 2].map(|i| self.max[i].max(o.max[i])) }
    }
    fn size(&self) -> [f64; 3] {
        [0, 1, 2].map(|i| self.max[i] - self.min[i])
    }
    fn center(&self, i: usize) -> f64 {
        (self.min[i] + self.max[i]) / 2.0
    }
}

fn boxes(m: &mut Session, cmd: &str, bodies: &[String]) -> Result<BTreeMap<String, BBox>> {
    let mut out = BTreeMap::new();
    if bodies.is_empty() {
        return Ok(out);
    }
    let r = run(m, "inspect.measure", json!({ "bodies": bodies }))?;
    for b in r["bodies"].as_array().into_iter().flatten() {
        let v3 = |v: &Value| [0, 1, 2].map(|i| v[i].as_f64().unwrap_or(0.0));
        let Some(name) = b["name"].as_str() else { continue };
        out.insert(name.to_string(), BBox { min: v3(&b["bbox"]["min"]), max: v3(&b["bbox"]["max"]) });
    }
    if out.is_empty() {
        return Err(bad(cmd, "the model has no bodies to print"));
    }
    Ok(out)
}

/// What a body is, for its filament slot.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Part {
    Walls,
    Slabs,
    Frames,
    Leaves,
    Glass,
    Roof,
    Other,
}

pub(super) fn maquette(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "arch.maquette";
    let q: MaquetteParams = parse(CMD, p)?;
    let scale = q.scale.unwrap_or(100.0);
    if !(scale.is_finite() && (1.0..=10_000.0).contains(&scale)) {
        return Err(bad(CMD, "`scale` is the scale's denominator, 1…10000 (100 for 1:100)"));
    }
    let min_print = q.min_thickness.unwrap_or(0.8);
    if !(min_print.is_finite() && (0.1..=10.0).contains(&min_print)) {
        return Err(bad(CMD, "`min_thickness` is 0.1…10 mm"));
    }
    let [plate_w, plate_d] = q.plate.unwrap_or([256.0, 256.0]);
    if !(plate_w.is_finite() && plate_d.is_finite() && (50.0..=2000.0).contains(&plate_w) && (50.0..=2000.0).contains(&plate_d)) {
        return Err(bad(CMD, "`plate` is [width, depth], each 50…2000 mm"));
    }
    let slots = q.slots.unwrap_or_default();
    let slot_of = |k: Part| -> u8 {
        let (given, default) = match k {
            Part::Walls => (slots.walls, 1),
            Part::Slabs => (slots.slabs, 1),
            Part::Frames => (slots.frames, 2),
            Part::Leaves => (slots.leaves, 2),
            Part::Glass => (slots.glass, 3),
            Part::Roof => (slots.roof, 4),
            Part::Other => (slots.other, 1),
        };
        given.unwrap_or(default).clamp(1, 16)
    };
    let min_real = min_print * scale;

    // 1. The copy, closed and thickened.
    let mut m = s.scratch();
    let all = records(&m);
    let values = |m: &Session| m.doc.param_values().0;
    if q.close_openings.unwrap_or(true) {
        for r in all.iter().filter(|r| r.kind == "door" || r.kind == "window") {
            if let Some(a) = r.params.get("angle") {
                run(&mut m, "parameters.change", json!({ "name": a, "expression": "0 deg" }))?;
            }
            if let Some(o) = r.params.get("open") {
                run(&mut m, "parameters.change", json!({ "name": o, "expression": "0" }))?;
            }
        }
    }
    let mut thickened = Vec::new();
    for r in &all {
        let roles: &[&str] = match r.kind.as_str() {
            "wall" | "slab" => &["thickness"],
            "roof" if r.kind_type.as_deref() == Some("flat") || r.hollow == Some(true) => &["thickness"],
            "door" | "window" => &["frame", "depth", "leaf", "glass"],
            _ => &[],
        };
        for role in roles {
            let Some(param) = r.params.get(*role) else { continue };
            let now = values(&m).get(param).map(|v| v.v);
            if let Some(v) = now
                && v < min_real
            {
                run(&mut m, "parameters.change", json!({ "name": param, "expression": format!("{min_real} mm") }))?;
                thickened.push(Thickened { parameter: param.clone(), from: v, to: min_real });
            }
        }
    }

    // 2. Pieces and parts.
    let world = m.world_state()?;
    let hidden: Vec<String> = m.visibility.hidden_bodies.clone();
    let names: Vec<String> = world.bodies.iter().map(|b| b.name.clone()).filter(|n| !hidden.contains(n)).collect();
    drop(world);
    if names.is_empty() {
        return Err(bad(CMD, "the design has no visible bodies to print"));
    }
    let bbox = boxes(&mut m, CMD, &names)?;
    let level_of_wall = |wall: &str| all.iter().find(|r| r.name == wall).and_then(|w| w.level.clone()).unwrap_or_else(|| "XY".into());
    let piece_name = |level: &str| if level == "XY" { "Ground".to_string() } else { level.to_string() };
    let split_levels = q.levels.unwrap_or(true);
    let lift_roof = q.roof.unwrap_or(true);
    // Body → (piece, part).
    let mut place: BTreeMap<String, (String, Part)> = BTreeMap::new();
    let mut levels_in_order: Vec<String> = Vec::new();
    for r in &all {
        let level = match r.kind.as_str() {
            "wall" => r.level.clone().unwrap_or_else(|| "XY".into()),
            "door" | "window" | "roof" => r.wall.as_deref().map(level_of_wall).unwrap_or_else(|| "XY".into()),
            "slab" => r.wall.as_deref().map(level_of_wall).or(r.level.clone()).unwrap_or_else(|| "XY".into()),
            _ => continue,
        };
        if !levels_in_order.contains(&level) {
            levels_in_order.push(level.clone());
        }
        let in_level = if split_levels { piece_name(&level) } else { "Building".to_string() };
        for b in &r.bodies {
            let (piece, part) = match r.kind.as_str() {
                "wall" => (in_level.clone(), Part::Walls),
                "slab" if lift_roof && r.kind_type.as_deref() == Some("top") => (r.name.clone(), Part::Slabs),
                "slab" => (in_level.clone(), Part::Slabs),
                "roof" if lift_roof => (r.name.clone(), Part::Roof),
                "roof" => (in_level.clone(), Part::Roof),
                _ => {
                    let lower = b.to_lowercase();
                    let part = if lower.contains(" glass") {
                        Part::Glass
                    } else if lower.contains(" leaf") {
                        if r.kind == "door" { Part::Leaves } else { Part::Frames }
                    } else if lower.contains(" handle") {
                        Part::Leaves
                    } else {
                        Part::Frames
                    };
                    (in_level.clone(), part)
                }
            };
            place.insert(b.clone(), (piece, part));
        }
    }
    let mut omitted = Vec::new();
    let mut pieces: BTreeMap<String, Vec<(String, Part)>> = BTreeMap::new();
    for n in &names {
        let Some(b) = bbox.get(n) else { continue };
        if b.size().iter().any(|d| d / scale < min_print * 0.999) {
            omitted.push(n.clone());
            continue;
        }
        let (piece, part) = place.get(n).cloned().unwrap_or_else(|| (n.clone(), Part::Other));
        pieces.entry(piece).or_default().push((n.clone(), part));
    }
    if pieces.is_empty() {
        return Err(bad(CMD, format!("nothing is thick enough to print at 1:{scale}")));
    }

    // 3. Pieces larger than the plate are cut into pieces that fit.
    let avail = [plate_w - 2.0 * MARGIN, plate_d - 2.0 * MARGIN];
    let mut cuts = 0;
    let mut pins = 0;
    let mut out: Vec<(String, Vec<(String, Part)>)> = Vec::new();
    for (piece, parts) in pieces {
        let whole = parts.iter().filter_map(|(b, _)| bbox.get(b).copied()).reduce(BBox::union);
        let Some(whole) = whole else { continue };
        let size = whole.size();
        let n = [0, 1].map(|i| ((size[i] / scale) / avail[i]).ceil().max(1.0) as usize);
        if n == [1, 1] {
            out.push((piece, parts));
            continue;
        }
        let mut current: Vec<(String, Part, String)> = parts.iter().map(|(b, k)| (b.clone(), *k, b.clone())).collect();
        for axis in 0..2 {
            for k in 1..n[axis] {
                let c = whole.min[axis] + size[axis] * k as f64 / n[axis] as f64;
                let mut normal = [0.0, 0.0, 0.0];
                normal[axis] = 1.0;
                let origin = if axis == 0 { [c, 0.0, 0.0] } else { [0.0, c, 0.0] };
                let mut next = Vec::new();
                let boxes_now = boxes(&mut m, CMD, &current.iter().map(|(b, ..)| b.clone()).collect::<Vec<_>>())?;
                for (b, kind, source) in current {
                    let crosses = boxes_now.get(&b).is_some_and(|x| x.min[axis] < c - 1e-6 && x.max[axis] > c + 1e-6);
                    if crosses && let Ok(r) = m.execute("solid.split_body", &json!({ "body": b, "plane": { "origin": origin, "normal": normal } })) {
                        for made in strings(&r, "created_bodies") {
                            next.push((made, kind, source.clone()));
                        }
                    }
                    next.push((b, kind, source));
                }
                current = next;
                cuts += 1;
                if q.pins.unwrap_or(true) {
                    pins += drill(&mut m, &all, &current, axis, c, scale, min_print)?;
                }
            }
        }
        // Each part to the tile its middle lies in.
        let boxes_now = boxes(&mut m, CMD, &current.iter().map(|(b, ..)| b.clone()).collect::<Vec<_>>())?;
        let mut tiles: BTreeMap<(usize, usize), Vec<(String, Part)>> = BTreeMap::new();
        for (b, kind, _) in current {
            let Some(x) = boxes_now.get(&b) else { continue };
            let tile = [0, 1].map(|i| (((x.center(i) - whole.min[i]) / size[i].max(1e-9)) * n[i] as f64).floor().clamp(0.0, (n[i] - 1) as f64) as usize);
            tiles.entry((tile[0], tile[1])).or_default().push((b, kind));
        }
        for ((ix, iy), parts) in tiles {
            out.push((format!("{piece} {}-{}", ix + 1, iy + 1), parts));
        }
    }

    // 4. On plates: rows left to right, a new plate when one is full.
    let names_now: Vec<String> = out.iter().flat_map(|(_, parts)| parts.iter().map(|(b, _)| b.clone())).collect();
    let bbox = boxes(&mut m, CMD, &names_now)?;
    let mut laid: Vec<(String, Vec<(String, Part)>, BBox, usize, [f64; 2])> = Vec::new();
    let mut items: Vec<(String, Vec<(String, Part)>, BBox)> = out
        .into_iter()
        .filter_map(|(name, parts)| {
            let b = parts.iter().filter_map(|(p, _)| bbox.get(p).copied()).reduce(BBox::union)?;
            Some((name, parts, b))
        })
        .collect();
    items.sort_by(|a, b| (b.2.size()[1]).total_cmp(&a.2.size()[1]));
    let (mut plate, mut x, mut y, mut row) = (0usize, MARGIN, MARGIN, 0.0_f64);
    let mut tall = Vec::new();
    for (name, parts, b) in items {
        let [sx, sy, sz] = b.size().map(|d| d / scale);
        if x + sx > plate_w - MARGIN && x > MARGIN {
            x = MARGIN;
            y += row + GAP;
            row = 0.0;
        }
        if y + sy > plate_d - MARGIN && y > MARGIN {
            plate += 1;
            x = MARGIN;
            y = MARGIN;
            row = 0.0;
        }
        if sz > plate_w.max(plate_d) {
            tall.push(name.clone());
        }
        laid.push((name, parts, b, plate, [x, y]));
        x += sx + GAP;
        row = row.max(sy);
    }
    let plates = plate + 1;

    let report = |path: Option<String>, bytes: Option<usize>| MaquetteMade {
        scale,
        pieces: laid
            .iter()
            .map(|(name, parts, b, plate, _)| MaquettePiece {
                name: name.clone(),
                plate: plate + 1,
                size: b.size().map(|d| (d / scale * 100.0).round() / 100.0),
                parts: parts.iter().map(|(p, k)| (p.clone(), slot_of(*k))).collect(),
            })
            .collect(),
        plates,
        thickened: Vec::new(),
        omitted: omitted.clone(),
        cuts,
        pins,
        tall: tall.clone(),
        path,
        bytes,
    };
    let Some(path) = q.path.clone() else {
        let mut r = report(None, None);
        r.thickened = thickened;
        return serde_json::to_value(r).map_err(|e| bad(CMD, e.to_string()));
    };
    let world = m.world_state()?;
    let painted = m.doc.painted(&world);
    let mut objects = Vec::new();
    for (name, parts, b, plate, [px, py]) in &laid {
        // Plates side by side, a plate and a half apart.
        let at = [px + *plate as f64 * plate_w * 1.5, *py, 0.0];
        let mut slot_parts = Vec::new();
        for (body, kind) in parts {
            let part = solidcraft_io::slot_part(&painted, body, scale, b.min, at, slot_of(*kind), Default::default())
                .map_err(|e| bad(CMD, format!("{body}: {e}")))?;
            slot_parts.push(part);
        }
        objects.push(solidcraft_io::SlotObject { name: name.clone(), parts: slot_parts });
    }
    let title = format!("{} 1:{scale}", s.doc.name);
    let bytes = solidcraft_io::write_3mf_slots(&objects, &title).map_err(|e| bad(CMD, e.to_string()))?;
    solidcraft_io::vfs::write(&path, &bytes).map_err(|e| bad(CMD, format!("{path}: {e}")))?;
    let mut r = report(Some(path), Some(bytes.len()));
    r.thickened = thickened;
    serde_json::to_value(r).map_err(|e| bad(CMD, e.to_string()))
}

/// Drill holes for filament pins across the cut at `c` along `axis`, where a wall crosses it
/// square enough, thick enough, and away from its ends and openings. Returns how many.
#[allow(clippy::too_many_arguments)]
fn drill(m: &mut Session, all: &[Record], current: &[(String, Part, String)], axis: usize, c: f64, scale: f64, min_print: f64) -> Result<usize> {
    let vals = m.doc.param_values().0;
    let num = |name: Option<&String>| name.and_then(|n| vals.get(n)).map(|v| v.v);
    let hole = PIN_HOLE * scale;
    let depth = PIN_DEPTH * scale;
    let margin = hole / 2.0 + min_print * scale;
    let mut made = 0;
    for w in all.iter().filter(|r| r.kind == "wall") {
        let (Some(t), Some(h)) = (num(w.params.get("thickness")), num(w.params.get("height"))) else { continue };
        // Thick enough for the hole and a wall each side of it.
        if t < hole + 2.0 * min_print * scale {
            continue;
        }
        let align = num(w.params.get("align")).unwrap_or(0.0);
        let base = match w.level.as_deref() {
            Some("XY") | None => 0.0,
            Some(level) => all.iter().find(|r| r.name == level).and_then(|l| num(l.params.get("elevation"))).unwrap_or(0.0),
        };
        let Some(plan) = w.sketch.clone() else { continue };
        let Ok((lines, _)) = cover::plan_lines(m, "arch.maquette", &plan, &w.curves) else { continue };
        let Ok(left) = inside_left(m, "arch.maquette", &plan, &w.curves) else { continue };
        // The wall's pieces near the cut.
        let pieces: Vec<String> = current.iter().filter(|(_, _, source)| w.bodies.contains(source)).map(|(b, ..)| b.clone()).collect();
        if pieces.is_empty() {
            continue;
        }
        for l in &lines {
            let (a, b) = (l.a[axis], l.b[axis]);
            if (a - c) * (b - c) >= 0.0 {
                continue;
            }
            let len = (l.b[0] - l.a[0]).hypot(l.b[1] - l.a[1]);
            let dir = [(l.b[0] - l.a[0]) / len, (l.b[1] - l.a[1]) / len];
            // Square enough to the cut (within 60°).
            if dir[axis].abs() < 0.5 {
                continue;
            }
            let f = (c - a) / (b - a);
            let along = f * len;
            if along < depth + margin || len - along < depth + margin {
                continue;
            }
            let k = w.curves.iter().position(|x| *x == l.id);
            let inner_left = k.and_then(|k| left.get(k).copied().flatten()).unwrap_or(true);
            let off = if inner_left { t * align / 2.0 } else { -t * align / 2.0 };
            let normal_left = [-dir[1], dir[0]];
            let p = [l.a[0] + dir[0] * along + normal_left[0] * off, l.a[1] + dir[1] * along + normal_left[1] * off];
            let openings: Vec<(f64, f64, f64, f64)> = all
                .iter()
                .filter(|o| o.wall.as_deref() == Some(w.name.as_str()) && o.segment.as_deref() == Some(l.id.as_str()))
                .filter_map(|o| Some((num(o.params.get("position"))?, num(o.params.get("width"))?, num(o.params.get("sill"))?, num(o.params.get("height"))?)))
                .collect();
            for zf in [0.2, 0.8] {
                let z = h * zf;
                let clear = openings.iter().all(|(pos, wd, sill, ht)| {
                    let reach = depth / dir[axis].abs() + margin;
                    along + reach < pos - margin || along - reach > pos + wd + margin || z + margin < *sill || z - margin > sill + ht
                });
                if !clear || z < margin || h - z < margin {
                    continue;
                }
                let mut start = [p[0], p[1], base + z];
                start[axis] = c - depth;
                // The wall's pieces the pin's hole reaches.
                let reach = |b: &BBox| {
                    (0..3).all(|i| {
                        let (lo, hi) = if i == axis { (c - depth, c + depth) } else { (start[i] - hole, start[i] + hole) };
                        b.min[i] < hi && b.max[i] > lo
                    })
                };
                let near = boxes(m, "arch.maquette", &pieces)?;
                let targets: Vec<String> = pieces.iter().filter(|b| near.get(*b).is_some_and(reach)).cloned().collect();
                if targets.is_empty() {
                    continue;
                }
                let r = m.execute(
                    "solid.cylinder",
                    &json!({ "diameter": hole, "height": 2.0 * depth, "base": start, "axis": if axis == 0 { "X" } else { "Y" },
                             "operation": "cut", "targets": targets }),
                );
                if r.is_ok() {
                    made += 1;
                }
            }
        }
    }
    Ok(made)
}
