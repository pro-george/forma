//! Forma: architecture. Walls, doors, windows and levels, built from the engine's own features
//! so a design stays an ordinary design: it opens anywhere, exports as any other, and every
//! piece can be edited by hand.
//!
//! - A wall (`arch.wall`) is a thin extrude along a plan sketch, its height, thickness and
//!   alignment design parameters (`Wall1_height`, `Wall1_thickness`, `Wall1_align`). The
//!   alignment says where the wall lies against its line, from 1 (all on the plan's inner side,
//!   the line its outer face) through 0 (centred) to -1 (all outside, the line its inner face):
//!   the extrude takes `thickness * (1 + align) / 2` inside and `thickness * (1 - align) / 2`
//!   outside, so changing it is changing a parameter.
//! - A door or window (`arch.door`, `arch.window`) sits in one straight line of a wall's plan. Its
//!   features are drawn on a plane square to the plan that holds that line, whose frame starts at
//!   the line's first point and runs along it, so the opening keeps its distance from that point
//!   when the plan changes. A second plane, offset from it by the wall's alignment, runs down
//!   the middle of the wall, and the rest is drawn on that: the opening is cut through the wall, the frame is a thin extrude
//!   inside it, and each leaf or sash is drawn on a plane turned about its hinge (a construction
//!   axis on a sketch line), so its opening angle is a parameter too. A sliding one is drawn on
//!   a plane beside the wall and moves by a fraction.
//! - A level (`arch.level`) is a plane parallel to XY at an elevation, for a storey's plan.
//!
//! Each element's features go in one timeline folder named after it, its parameters are named
//! after it, and what it is (kind, type, wall, line, hinge, swing) is kept in the design's
//! properties under `ro.artea.forma.arch.<prefix>`, which `arch.edit`, `arch.delete` and
//! `arch.list` read. Everything one command does is one undo step, and a command that fails
//! leaves the design as it was.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::CommandSpec;
use crate::params::bad;
use crate::schema::arch::{
    ArchDeleted, ArchEditParams, ArchElementMade, ArchElementParams, ArchList, ArchListParams, LevelParams, OpeningParams, WallAlign, WallParams,
};
use crate::schema::{TypedContract, output_schema_for};
use crate::{Result, Session};

const WALL: TypedContract<WallParams> = TypedContract::new();
const OPENING: TypedContract<OpeningParams> = TypedContract::new();
const EDIT: TypedContract<ArchEditParams> = TypedContract::new();
const ELEMENT: TypedContract<ArchElementParams> = TypedContract::new();
const LIST: TypedContract<ArchListParams> = TypedContract::new();
const LEVEL: TypedContract<LevelParams> = TypedContract::new();

/// The design-property key the elements' records live under, one key per element.
pub const META: &str = "ro.artea.forma.arch";

/// How many points a wall's line may have.
const MAX_POINTS: usize = 200;

pub static COMMANDS: &[CommandSpec] = &[
    CommandSpec::new("arch.wall", "Wall", crate::checked!("arch.wall", wall))
        .icon("arch_wall")
        .contract(&WALL)
        .output(output_schema_for::<ArchElementMade>)
        .params(
            "points: [[x,y]…] (plan, at least two; numbers or length expressions), closed?: bool, or sketch: plan sketch name, curves?: [ids]; \
             height?: expr (2700 mm), thickness?: expr (250 mm), align?: center|inside|outside|left|right or -1…1 (center; inside: the line is the outer face, \
             outside: the inner face), level?: plane name (XY), name? → element, kind, parameters, bodies, group",
        ),
    CommandSpec::new("arch.door", "Door", crate::checked!("arch.door", door))
        .icon("arch_door")
        .contract(&OPENING)
        .output(output_schema_for::<ArchElementMade>)
        .params(
            "wall: wall name; segment?: plan line id (the wall's first); type?: single|double|sliding|opening (single); position?: expr (from the line's \
             first point to the near edge, 600 mm); width? (900 mm), height? (2100 mm), sill? (0); hinge?: start|end; swing?: left|right (looking along \
             the line); angle?: open angle (0 deg); open?: sliding, 0…1; frame? (60 mm), depth? (100 mm), leaf?: leaf thickness (40 mm); name?",
        ),
    CommandSpec::new("arch.window", "Window", crate::checked!("arch.window", window))
        .icon("arch_window")
        .contract(&OPENING)
        .output(output_schema_for::<ArchElementMade>)
        .params(
            "wall: wall name; segment?: plan line id (the wall's first); type?: fixed|casement|double|sliding (casement); position?: expr (600 mm); \
             width? (1200 mm), height? (1400 mm), sill? (900 mm); hinge?: start|end; swing?: left|right; angle?: open angle (0 deg); open?: sliding, \
             0…1; frame? (70 mm), depth? (100 mm), leaf?: sash face width (60 mm); name?",
        ),
    CommandSpec::new("arch.level", "Level", crate::checked!("arch.level", level))
        .icon("arch_level")
        .contract(&LEVEL)
        .output(output_schema_for::<ArchElementMade>)
        .params("elevation?: expr above XY (3000 mm); name? → a plane to draw a storey's walls on (arch.wall level)"),
    CommandSpec::new("arch.edit", "Edit Element", crate::checked!("arch.edit", edit))
        .icon("edit")
        .contract(&EDIT)
        .output(output_schema_for::<ArchElementMade>)
        .params(
            "element: name; any of the element's numbers (height, thickness, position, width, sill, angle, open, frame, depth, leaf, elevation) change \
             its parameters; a wall's align (center|inside|outside|left|right or -1…1) moves it about its line, its doors and windows with it; \
             type, hinge, swing, wall or segment rebuild a door or window",
        ),
    CommandSpec::new("arch.delete", "Delete Element", crate::checked!("arch.delete", delete))
        .icon("delete")
        .contract(&ELEMENT)
        .output(output_schema_for::<ArchDeleted>)
        .params("element: name (a wall takes its doors and windows; a level its walls) → deleted: [names]"),
    CommandSpec::new("arch.list", "List Architecture Elements", crate::checked!("arch.list", list))
        .icon("list")
        .contract(&LIST)
        .output(output_schema_for::<ArchList>)
        .noundo()
        .doc_only()
        .params("→ elements: [{name, kind, type, wall, segment, hinge, swing, level, values: {role: expression}}]"),
];

/// What an element is, as saved in the design's properties.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
struct Record {
    name: String,
    /// `wall`, `door`, `window` or `level`.
    kind: String,
    /// The start of its parameters' names (`Door1` for `Door1_width`).
    prefix: String,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    kind_type: Option<String>,
    /// A door's or window's wall.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    wall: Option<String>,
    /// The plan line it sits in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    segment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hinge: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    swing: Option<String>,
    /// A wall's plan sketch and the curves it follows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    sketch: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    curves: Vec<String>,
    /// Where a wall lies against its line, as last asked: `center`, `inside`, `outside`, `left`,
    /// `right` or `custom` (its `align` parameter holds the number).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    align: Option<String>,
    /// The plane a wall's plan is drawn on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    level: Option<String>,
    /// Its timeline folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    group: Option<u64>,
    /// Its features, for an element without a folder (a level).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    features: Vec<u64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    bodies: Vec<String>,
    /// Its parameters by role (`width` → `Door1_width`).
    #[serde(default)]
    params: BTreeMap<String, String>,
}

fn key_of(prefix: &str) -> String {
    format!("{META}.{prefix}")
}

/// Every element of the design, in name order.
fn records(s: &Session) -> Vec<Record> {
    let start = format!("{META}.");
    let mut v: Vec<Record> = s
        .doc
        .metadata
        .0
        .iter()
        .filter(|(k, _)| k.starts_with(&start))
        .filter_map(|(_, v)| serde_json::from_value::<Record>(v.clone()).ok())
        .collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}

fn record(s: &Session, cmd: &str, name: &str) -> Result<Record> {
    records(s).into_iter().find(|r| r.name == name).ok_or_else(|| bad(cmd, format!("no architecture element named `{name}`")))
}

fn save(s: &mut Session, r: &Record) -> Result<()> {
    let value = serde_json::to_value(r).map_err(|e| bad("arch", e.to_string()))?;
    run(s, "document.metadata.set", json!({ "key": key_of(&r.prefix), "value": value }))?;
    Ok(())
}

fn forget(s: &mut Session, r: &Record) -> Result<()> {
    run(s, "document.metadata.set", json!({ "key": key_of(&r.prefix), "value": Value::Null }))?;
    Ok(())
}

fn run(s: &mut Session, cmd: &str, p: Value) -> Result<Value> {
    s.execute(cmd, &p)
}

fn parse<T: for<'de> Deserialize<'de>>(cmd: &str, p: &Value) -> Result<T> {
    let p = if p.is_null() { json!({}) } else { p.clone() };
    serde_json::from_value(p).map_err(|e| bad(cmd, e.to_string()))
}

/// The start of an element's parameter names: its name's letters and digits, Romanian letters
/// written without their marks, never starting with a digit.
fn prefix_of(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| match c {
            'ă' | 'â' => 'a',
            'Ă' | 'Â' => 'A',
            'î' => 'i',
            'Î' => 'I',
            'ș' | 'ş' => 's',
            'Ș' | 'Ş' => 'S',
            'ț' | 'ţ' => 't',
            'Ț' | 'Ţ' => 'T',
            c => c,
        })
        .filter(char::is_ascii_alphanumeric)
        .take(40)
        .collect();
    if out.chars().next().is_none_or(|c| c.is_ascii_digit()) {
        out.insert(0, 'E');
    }
    out
}

/// Whether `name` (or its parameter prefix) is taken by an element, a feature or a folder.
fn taken(s: &Session, name: &str) -> bool {
    let prefix = prefix_of(name);
    let start = format!("{prefix}_");
    records(s).iter().any(|r| r.name == name || r.prefix == prefix)
        || s.doc.features.iter().any(|f| f.name == name || f.name.starts_with(&format!("{name} ")))
        || s.doc.timeline_groups.iter().any(|g| g.name == name)
        || s.doc.params.iter().any(|p| p.name.starts_with(&start))
}

/// The name a new element takes: the one given (refused when taken), or `base N`, the first free.
fn new_name(s: &Session, cmd: &str, given: Option<&str>, base: &str) -> Result<String> {
    if let Some(name) = given {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control) {
            return Err(bad(cmd, "`name` must be 1…60 characters, without control characters"));
        }
        if taken(s, name) {
            return Err(bad(cmd, format!("`{name}` is already used in this design")));
        }
        return Ok(name.to_string());
    }
    (1..10_000).map(|n| format!("{base} {n}")).find(|n| !taken(s, n)).ok_or_else(|| bad(cmd, format!("no free name for a new {base}")))
}

/// What a parameter holds: a length, an angle or a plain number.
#[derive(Clone, Copy)]
enum Unit {
    Length,
    Angle,
    Number,
}

/// Make the parameter `name`, or change it when it exists and a value is given; returns `name`.
fn ensure(s: &mut Session, name: &str, given: Option<&str>, default: &str, unit: Unit, comment: &str) -> Result<String> {
    if s.doc.param(name).is_some() {
        if let Some(e) = given {
            run(s, "parameters.change", json!({ "name": name, "expression": e }))?;
        }
    } else {
        let unit = match unit {
            Unit::Length => s.doc.units.clone(),
            Unit::Angle => "deg".to_string(),
            Unit::Number => String::new(),
        };
        run(s, "parameters.add", json!({ "name": name, "expression": given.unwrap_or(default), "unit": unit, "comment": comment }))?;
    }
    Ok(name.to_string())
}

fn feature_id(v: &Value) -> Option<u64> {
    v.get("feature").or_else(|| v.get("sketch")).and_then(Value::as_u64)
}

fn strings(v: &Value, key: &str) -> Vec<String> {
    v.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

/// The features and bodies one element makes, as it makes them.
#[derive(Default)]
struct Made {
    features: Vec<u64>,
    bodies: Vec<String>,
    /// Planes, axes and sketches to hide once it is built.
    hidden: Vec<String>,
}

impl Made {
    fn add(&mut self, r: &Value) {
        if let Some(id) = feature_id(r) {
            self.features.push(id);
        }
        self.bodies.extend(strings(r, "created_bodies"));
    }
}

/// Draw a sketch on `plane` with `draw` (sketch commands), finish it, and return the curve ids
/// the drawing commands made, in order.
fn sketch(s: &mut Session, made: &mut Made, plane: &str, name: &str, draw: &[(&str, Value)]) -> Result<Vec<String>> {
    let r = run(s, "sketch.create", json!({ "plane": plane, "name": name }))?;
    made.add(&r);
    made.hidden.push(name.to_string());
    let mut curves = Vec::new();
    for (cmd, p) in draw {
        let r = run(s, cmd, p.clone())?;
        curves.extend(strings(&r, "curves"));
    }
    run(s, "sketch.finish", json!({}))?;
    Ok(curves)
}

/// A rectangle from (x0, y0) to (x1, y1), each a length expression.
fn rect(x0: &str, y0: &str, x1: &str, y1: &str) -> (&'static str, Value) {
    ("sketch.rectangle.two_point", json!({ "p0": [x0, y0], "p1": [x1, y1] }))
}

/// A closed loop through `points`.
fn loop_(points: &[[&str; 2]]) -> (&'static str, Value) {
    ("sketch.line", json!({ "points": points, "closed": true, "infer": false }))
}

/// Extrude a sketch's profiles symmetrically about its plane as a new body.
fn slab(s: &mut Session, made: &mut Made, sketch: &str, depth: &str, body: &str) -> Result<()> {
    let r = run(
        s,
        "solid.extrude",
        json!({ "sketch": sketch, "distance": depth, "direction": "symmetric", "operation": "new_body", "name": body, "body_name": body }),
    )?;
    made.add(&r);
    Ok(())
}

/// A frame of face width `face` inside the loop or chain `curves` of `sketch`, `depth` deep.
fn ring(s: &mut Session, made: &mut Made, sketch: &str, curves: &[String], face: &str, depth: &str, body: &str) -> Result<()> {
    let r = run(
        s,
        "solid.extrude",
        json!({ "sketch": sketch, "thin": true, "curves": curves, "thickness": face, "side": "inside", "distance": depth,
                "direction": "symmetric", "operation": "new_body", "name": body, "body_name": body }),
    )?;
    made.add(&r);
    Ok(())
}

fn paint(s: &mut Session, bodies: &[String], color: &str, opacity: f64) -> Result<()> {
    if !bodies.is_empty() {
        run(s, "appearance.assign", json!({ "bodies": bodies, "color": color, "opacity": opacity }))?;
    }
    Ok(())
}

/// Put `made`'s features in a timeline folder named `name`, and hide its helpers.
fn finish(s: &mut Session, made: &Made, name: &str) -> Result<Option<u64>> {
    if !made.hidden.is_empty() {
        run(s, "browser.visibility", json!({ "visible": false, "items": made.hidden }))?;
    }
    if made.features.is_empty() {
        return Ok(None);
    }
    let r = run(s, "timeline.group", json!({ "name": name, "features": made.features }))?;
    Ok(r.get("group").and_then(Value::as_u64))
}

fn reply(r: &Record) -> Result<Value> {
    let made = ArchElementMade { element: r.name.clone(), kind: r.kind.clone(), parameters: r.params.clone(), bodies: r.bodies.clone(), group: r.group };
    serde_json::to_value(made).map_err(|e| bad("arch", e.to_string()))
}

const WALL_COLOR: &str = "#e9e2d6";
const FRAME_COLOR: &str = "#f4f1ea";
const LEAF_COLOR: &str = "#c9a27a";
const GLASS_COLOR: &str = "#bcd8e6";
const HANDLE_COLOR: &str = "#30321d";

/// For each of a wall's plan curves, whether the wall's inner side lies to the left of the curve
/// as drawn (`None` for one of no length).
fn inside_left(s: &Session, cmd: &str, plan: &str, curves: &[String]) -> Result<Vec<Option<bool>>> {
    let id = s.doc.features.iter().find(|f| f.name == plan).map(|f| f.id).ok_or_else(|| bad(cmd, format!("no plan sketch named `{plan}`")))?;
    let state = s.model.state();
    let ss = state.sketch(id).ok_or_else(|| bad(cmd, format!("{plan} has no solved geometry")))?;
    let segs = curves
        .iter()
        .map(|c| {
            let ci = ss.sketch.curve_index(c).ok_or_else(|| bad(cmd, format!("{plan} has no curve `{c}`")))?;
            Ok(ss.sketch.exact_segs(ci).unwrap_or_else(|| ss.sketch.segs(ci)))
        })
        .collect::<Result<Vec<_>>>()?;
    crate::sketch::thin_wall_inside_left(&segs).map_err(|e| bad(cmd, e.to_string()))
}

/// A wall's alignment as the number its `align` parameter holds, and the name it was asked by.
/// `first_left` is whether the inner side lies left of the wall's first line, for `left` and
/// `right`.
fn align_of(cmd: &str, given: Option<&WallAlign>, first_left: bool) -> Result<(String, String)> {
    let named = |f: f64, label: &str| Ok((format!("{f}"), label.to_string()));
    match given {
        None => named(0.0, "center"),
        Some(WallAlign::Named(n)) => match n.trim().to_ascii_lowercase().as_str() {
            "center" | "centre" | "centered" | "centred" => named(0.0, "center"),
            "inside" | "interior" => named(1.0, "inside"),
            "outside" | "exterior" => named(-1.0, "outside"),
            "left" => named(if first_left { 1.0 } else { -1.0 }, "left"),
            "right" => named(if first_left { -1.0 } else { 1.0 }, "right"),
            _ => Err(bad(cmd, "`align` is center, inside, outside, left, right or a number from -1 to 1")),
        },
        Some(WallAlign::Fraction(f)) => {
            if !(f.is_finite() && (-1.0..=1.0).contains(f)) {
                return Err(bad(cmd, "a numeric `align` runs from -1 (outside) to 1 (inside)"));
            }
            let label = if *f == 0.0 {
                "center"
            } else if *f == 1.0 {
                "inside"
            } else if *f == -1.0 {
                "outside"
            } else {
                "custom"
            };
            named(*f, label)
        }
    }
}

/// The thin extrude's fields for a wall `thickness` thick aligned by the parameter `align`.
fn wall_sides(thickness: &str, align: &str) -> (String, String) {
    (format!("{thickness} * (1 + {align}) / 2"), format!("{thickness} * (1 - {align}) / 2"))
}

fn wall(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "arch.wall";
    let w: WallParams = parse(CMD, p)?;
    let name = new_name(s, CMD, w.name.as_deref(), "Wall")?;
    let prefix = prefix_of(&name);
    let level = w.level.clone().unwrap_or_else(|| "XY".to_string());
    let height = ensure(s, &format!("{prefix}_height"), w.height.as_ref().map(|e| e.0.as_str()), "2700 mm", Unit::Length, &format!("{name}: height"))?;
    let thickness =
        ensure(s, &format!("{prefix}_thickness"), w.thickness.as_ref().map(|e| e.0.as_str()), "250 mm", Unit::Length, &format!("{name}: thickness"))?;
    let mut made = Made::default();
    let (plan, curves) = match (&w.points, &w.sketch) {
        (Some(points), None) => {
            if points.len() < 2 || points.len() > MAX_POINTS || (w.closed && points.len() < 3) {
                return Err(bad(CMD, format!("`points` must hold 2…{MAX_POINTS} points (3 for a closed wall)")));
            }
            let points: Vec<[&str; 2]> = points.iter().map(|p| [p.0[0].0.as_str(), p.0[1].0.as_str()]).collect();
            let plan = format!("{name} plan");
            let curves = sketch(s, &mut made, &level, &plan, &[("sketch.line", json!({ "points": points, "closed": w.closed, "infer": false }))])?;
            (plan, curves)
        }
        (None, Some(plan)) => {
            if w.closed {
                return Err(bad(CMD, "`closed` goes with `points`"));
            }
            let r = run(s, "sketch.inspect", json!({ "sketch": plan }))?;
            let all: Vec<(String, bool)> = r
                .get("curves")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|c| Some((c.get("id")?.as_str()?.to_string(), c.get("construction").and_then(Value::as_bool).unwrap_or(false))))
                        .collect()
                })
                .unwrap_or_default();
            let curves = match &w.curves {
                Some(given) => {
                    if let Some(missing) = given.iter().find(|c| !all.iter().any(|(id, _)| id == *c)) {
                        return Err(bad(CMD, format!("{plan} has no curve `{missing}`")));
                    }
                    given.clone()
                }
                None => all.into_iter().filter(|(_, construction)| !construction).map(|(id, _)| id).collect(),
            };
            (plan.clone(), curves)
        }
        _ => return Err(bad(CMD, "give `points` (a new plan) or `sketch` (a plan already drawn), not both")),
    };
    if curves.is_empty() || curves.len() > 1000 {
        return Err(bad(CMD, "the wall needs 1…1000 plan curves"));
    }
    let first_left = inside_left(s, CMD, &plan, &curves)?.into_iter().flatten().next().unwrap_or(true);
    let (fraction, align_label) = align_of(CMD, w.align.as_ref(), first_left)?;
    let align = ensure(
        s,
        &format!("{prefix}_align"),
        Some(&fraction),
        "0",
        Unit::Number,
        &format!("{name}: where the wall lies against its line, 1 inside, 0 centred, -1 outside"),
    )?;
    let (inner, outer) = wall_sides(&thickness, &align);
    let r = run(
        s,
        "solid.extrude",
        json!({ "sketch": plan, "thin": true, "curves": curves, "thickness": inner, "thickness2": outer, "side": "two_sides",
                "distance": height, "operation": "new_body", "name": name, "body_name": name }),
    )?;
    made.add(&r);
    paint(s, &made.bodies, WALL_COLOR, 1.0)?;
    // A plan drawn by hand stays where it is in the timeline, outside the wall's folder.
    let group = finish(s, &made, &name)?;
    let record = Record {
        name: name.clone(),
        kind: "wall".into(),
        prefix,
        sketch: Some(plan),
        curves,
        align: Some(align_label),
        level: Some(level),
        group,
        bodies: made.bodies.clone(),
        params: BTreeMap::from([("height".into(), height), ("thickness".into(), thickness), ("align".into(), align)]),
        ..Record::default()
    };
    save(s, &record)?;
    reply(&record)
}

fn level(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "arch.level";
    let l: LevelParams = parse(CMD, p)?;
    let name = new_name(s, CMD, l.name.as_deref(), "Level")?;
    let prefix = prefix_of(&name);
    let elevation =
        ensure(s, &format!("{prefix}_elevation"), l.elevation.as_ref().map(|e| e.0.as_str()), "3000 mm", Unit::Length, &format!("{name}: elevation"))?;
    let r = run(s, "construct.plane.offset", json!({ "base": "XY", "offset": elevation, "name": name }))?;
    let record = Record {
        name: name.clone(),
        kind: "level".into(),
        prefix,
        features: feature_id(&r).into_iter().collect(),
        params: BTreeMap::from([("elevation".into(), elevation)]),
        ..Record::default()
    };
    save(s, &record)?;
    reply(&record)
}

/// Doors and windows.
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Door,
    Window,
}

impl Kind {
    fn word(self) -> &'static str {
        match self {
            Kind::Door => "door",
            Kind::Window => "window",
        }
    }
    fn types(self) -> &'static [&'static str] {
        match self {
            Kind::Door => &["single", "double", "sliding", "opening"],
            Kind::Window => &["fixed", "casement", "double", "sliding"],
        }
    }
    /// The defaults: (type, position, width, height, sill, frame, depth, leaf).
    fn defaults(self) -> [&'static str; 8] {
        match self {
            Kind::Door => ["single", "600 mm", "900 mm", "2100 mm", "0 mm", "60 mm", "100 mm", "40 mm"],
            Kind::Window => ["casement", "600 mm", "1200 mm", "1400 mm", "900 mm", "70 mm", "100 mm", "60 mm"],
        }
    }
}

fn door(s: &mut Session, p: &Value) -> Result<Value> {
    let o: OpeningParams = parse("arch.door", p)?;
    opening(s, "arch.door", Kind::Door, o, None)
}

fn window(s: &mut Session, p: &Value) -> Result<Value> {
    let o: OpeningParams = parse("arch.window", p)?;
    opening(s, "arch.window", Kind::Window, o, None)
}

/// Build a door or a window; `rebuilt` is the record of the one it replaces (its features
/// already deleted, its parameters kept).
fn opening(s: &mut Session, cmd: &str, kind: Kind, o: OpeningParams, rebuilt: Option<&Record>) -> Result<Value> {
    let wall = record(s, cmd, &o.wall)?;
    if wall.kind != "wall" {
        return Err(bad(cmd, format!("`{}` is not a wall", o.wall)));
    }
    let segment = o.segment.clone().or_else(|| wall.curves.first().cloned()).ok_or_else(|| bad(cmd, "the wall has no plan line"))?;
    if !wall.curves.contains(&segment) {
        return Err(bad(cmd, format!("`{segment}` is not one of {}'s lines ({})", wall.name, wall.curves.join(", "))));
    }
    let [d_type, d_pos, d_w, d_h, d_sill, d_frame, d_depth, d_leaf] = kind.defaults();
    let kind_type = o.kind.clone().unwrap_or_else(|| d_type.to_string());
    if !kind.types().contains(&kind_type.as_str()) {
        return Err(bad(cmd, format!("a {} is {}", kind.word(), kind.types().join(", "))));
    }
    let hinge = o.hinge.clone().unwrap_or_else(|| "start".into());
    if hinge != "start" && hinge != "end" {
        return Err(bad(cmd, "`hinge` is start or end"));
    }
    let swing = o.swing.clone().unwrap_or_else(|| "left".into());
    if swing != "left" && swing != "right" {
        return Err(bad(cmd, "`swing` is left or right"));
    }
    let name = match rebuilt {
        Some(r) => r.name.clone(),
        None => new_name(s, cmd, o.name.as_deref(), if kind == Kind::Door { "Door" } else { "Window" })?,
    };
    let prefix = prefix_of(&name);
    let level = wall.level.clone().unwrap_or_else(|| "XY".into());
    let plan = wall.sketch.clone().ok_or_else(|| bad(cmd, "the wall has no plan sketch"))?;
    let wall_body = wall.bodies.first().cloned().unwrap_or_else(|| wall.name.clone());
    let wall_t = wall.params.get("thickness").cloned().unwrap_or_else(|| "250 mm".into());

    let mut params = BTreeMap::new();
    let mut par = |s: &mut Session, role: &str, given: Option<&str>, default: &str, unit: Unit| -> Result<String> {
        let n = ensure(s, &format!("{prefix}_{role}"), given, default, unit, &format!("{name}: {role}"))?;
        params.insert(role.to_string(), n.clone());
        Ok(n)
    };
    let e = |x: &Option<crate::schema::LengthExpr>| x.as_ref().map(|e| e.0.as_str().to_string());
    let pos = par(s, "position", e(&o.position).as_deref(), d_pos, Unit::Length)?;
    let w = par(s, "width", e(&o.width).as_deref(), d_w, Unit::Length)?;
    let h = par(s, "height", e(&o.height).as_deref(), d_h, Unit::Length)?;
    let sill = par(s, "sill", e(&o.sill).as_deref(), d_sill, Unit::Length)?;
    let bare = kind_type == "opening";
    let sliding = kind_type == "sliding";
    let hinged = !bare && !sliding && kind_type != "fixed";
    let (f, depth, leaf) = if bare {
        (String::new(), String::new(), String::new())
    } else {
        (
            par(s, "frame", e(&o.frame).as_deref(), d_frame, Unit::Length)?,
            par(s, "depth", e(&o.depth).as_deref(), d_depth, Unit::Length)?,
            par(s, "leaf", e(&o.leaf).as_deref(), d_leaf, Unit::Length)?,
        )
    };
    let angle = if hinged { par(s, "angle", o.angle.as_ref().map(|a| a.0.as_str()), "0 deg", Unit::Angle)? } else { String::new() };
    let open = if sliding { par(s, "open", o.open.as_ref().map(|a| a.0.as_str()), "0", Unit::Number)? } else { String::new() };

    // The opening's corners, in the plane along the wall line (x from its first point, y up).
    let x0 = pos.clone();
    let x1 = format!("{pos} + {w}");
    let y0 = sill.clone();
    let y1 = format!("{sill} + {h}");
    let mut made = Made::default();
    let line_plane = format!("{name} plane");
    let r = run(s, "construct.plane.perpendicular", json!({ "plane": level, "line": { "sketch": plan, "curve": segment }, "name": line_plane }))?;
    made.add(&r);
    made.hidden.push(line_plane.clone());
    // The wall's middle: the line's plane moved by the wall's alignment (its normal points to
    // the line's right; the wall's inner side is left of a line its chain runs along).
    let plane = match wall.params.get("align") {
        Some(align) => {
            let k = wall.curves.iter().position(|c| *c == segment);
            let left = inside_left(s, cmd, &plan, &wall.curves)?;
            let left = k.and_then(|k| left.get(k).copied().flatten()).unwrap_or(true);
            let half = format!("{wall_t} * {align} / 2");
            let offset = if left { format!("-({half})") } else { half };
            let centre = format!("{name} centre");
            let r = run(s, "construct.plane.offset", json!({ "base": line_plane, "offset": offset, "name": centre }))?;
            made.add(&r);
            made.hidden.push(centre.clone());
            centre
        }
        // A wall made before alignment is centred on its line.
        None => line_plane,
    };
    let cut = format!("{name} opening");
    sketch(s, &mut made, &plane, &cut, &[rect(&x0, &y0, &x1, &y1)])?;
    let r = run(
        s,
        "solid.extrude",
        json!({ "sketch": cut, "distance": format!("2 * {wall_t} + 20 mm"), "direction": "symmetric", "operation": "cut",
                "targets": [wall_body], "name": format!("{name} cut") }),
    )?;
    made.add(&r);

    let mut frames = Vec::new();
    let mut leaves = Vec::new();
    let mut glass = Vec::new();
    let mut handles = Vec::new();
    if !bare {
        // The frame, inside the opening; a door's has no sill.
        let outline = format!("{name} frame outline");
        let draw = match kind {
            Kind::Door => ("sketch.line", json!({ "points": [[&x0, &y0], [&x0, &y1], [&x1, &y1], [&x1, &y0]], "infer": false })),
            Kind::Window => loop_(&[[&x0, &y0], [&x1, &y0], [&x1, &y1], [&x0, &y1]]),
        };
        let curves = sketch(s, &mut made, &plane, &outline, &[draw])?;
        let before = made.bodies.len();
        ring(s, &mut made, &outline, &curves, &f, &depth, &format!("{name} frame"))?;
        frames.extend(made.bodies[before..].iter().cloned());

        // The clear opening inside the frame.
        let ix0 = format!("{x0} + {f}");
        let ix1 = format!("{x1} - {f}");
        let iy0 = match kind {
            Kind::Door => format!("{y0} + 10 mm"),
            Kind::Window => format!("{y0} + {f}"),
        };
        let iy1 = format!("{y1} - {f}");
        let mid = format!("{pos} + {w} / 2");
        // Panels: (from x, to x, hinge at the start side?) along the clear opening.
        let panels: Vec<(String, String, bool)> = match kind_type.as_str() {
            "double" => vec![(ix0.clone(), format!("{mid} - 2 mm"), true), (format!("{mid} + 2 mm"), ix1.clone(), false)],
            "fixed" => vec![],
            _ => vec![(ix0.clone(), ix1.clone(), hinge == "start")],
        };
        let left = swing == "left";
        // A sash sits inside its frame's depth.
        let sash_depth = format!("{depth} - 20 mm");
        if hinged {
            // A hinge line per panel on its jamb; the panel turns about it towards `swing`.
            let hinges_sketch = format!("{name} hinges");
            let lines: Vec<(&str, Value)> = panels
                .iter()
                .map(|(a, b, at_start)| {
                    let hx = if *at_start { a } else { b };
                    ("sketch.line", json!({ "points": [[hx, &iy0], [hx, &iy1]], "construction": true, "infer": false }))
                })
                .collect();
            let hinge_lines = sketch(s, &mut made, &plane, &hinges_sketch, &lines)?;
            for (i, ((a, b, at_start), line)) in panels.iter().zip(&hinge_lines).enumerate() {
                let n = if panels.len() > 1 { format!(" {}", i + 1) } else { String::new() };
                let axis = format!("{name} hinge{n}");
                let r = run(s, "construct.axis.edge", json!({ "edge": { "sketch": hinges_sketch, "curve": line }, "name": axis }))?;
                made.add(&r);
                made.hidden.push(axis.clone());
                // Turning about an upward axis, a panel that runs from its hinge towards the
                // line's end goes left for a positive angle; one that runs back, right.
                let positive = *at_start == left;
                let turned = format!("{name} leaf plane{n}");
                let a_expr = if positive { angle.clone() } else { format!("-{angle}") };
                let r = run(s, "construct.plane.at_angle", json!({ "base": plane, "axis": axis, "angle": a_expr, "name": turned }))?;
                made.add(&r);
                made.hidden.push(turned.clone());
                panel(s, &mut made, kind, &turned, &name, &n, (a, b, &iy0, &iy1), *at_start, (&leaf, &sash_depth), (&mut leaves, &mut glass, &mut handles))?;
            }
        } else if sliding {
            match kind {
                Kind::Door => {
                    // One leaf on a track beside the wall, overlapping the jambs, sliding along it.
                    let side = if left { "-" } else { "" };
                    let track = format!("{name} track");
                    let r = run(
                        s,
                        "construct.plane.offset",
                        json!({ "base": plane, "offset": format!("{side}({depth} / 2 + {leaf} / 2 + 5 mm)"), "name": track }),
                    )?;
                    made.add(&r);
                    made.hidden.push(track.clone());
                    let shift = format!("{open} * ({w} - 2 * {f})");
                    let a = format!("{ix0} - 30 mm + {shift}");
                    let b = format!("{ix1} + 30 mm + {shift}");
                    let top = format!("{y1} - {f} + 30 mm");
                    panel(s, &mut made, kind, &track, &name, "", (&a, &b, &iy0, &top), hinge == "start", (&leaf, &leaf), (&mut leaves, &mut glass, &mut handles))?;
                }
                Kind::Window => {
                    // Two sashes on two tracks inside the frame; the one at the end slides back.
                    let sash_depth = format!("{depth} / 2 - 10 mm");
                    for (i, (sign, a, b)) in [
                        ("-", ix0.clone(), format!("{mid} + 25 mm")),
                        ("", format!("{mid} - 25 mm - {open} * ({w} / 2 - {f})"), format!("{ix1} - {open} * ({w} / 2 - {f})")),
                    ]
                    .into_iter()
                    .enumerate()
                    {
                        let n = format!(" {}", i + 1);
                        let track = format!("{name} track{n}");
                        let r = run(s, "construct.plane.offset", json!({ "base": plane, "offset": format!("{sign}{depth} / 4"), "name": track }))?;
                        made.add(&r);
                        made.hidden.push(track.clone());
                        panel(s, &mut made, kind, &track, &name, &n, (&a, &b, &iy0, &iy1), true, (&leaf, &sash_depth), (&mut leaves, &mut glass, &mut handles))?;
                    }
                }
            }
        } else {
            // A fixed window: glass in the frame.
            let g = format!("{name} glass");
            sketch(s, &mut made, &plane, &g, &[rect(&ix0, &iy0, &ix1, &iy1)])?;
            let before = made.bodies.len();
            slab(s, &mut made, &g, "24 mm", &g)?;
            glass.extend(made.bodies[before..].iter().cloned());
        }
    }
    paint(s, &frames, FRAME_COLOR, 1.0)?;
    paint(s, &leaves, if kind == Kind::Door { LEAF_COLOR } else { FRAME_COLOR }, 1.0)?;
    paint(s, &glass, GLASS_COLOR, 0.35)?;
    paint(s, &handles, HANDLE_COLOR, 1.0)?;
    let group = finish(s, &made, &name)?;
    // A rebuild to another type: the parameters of roles it no longer has go, unless used.
    if let Some(old) = rebuilt {
        for (role, param) in &old.params {
            if !params.contains_key(role) && s.doc.param(param).is_some() {
                let _ = run(s, "parameters.delete", json!({ "name": param }));
            }
        }
    }
    let record = Record {
        name,
        kind: kind.word().into(),
        prefix,
        kind_type: Some(kind_type),
        wall: Some(wall.name.clone()),
        segment: Some(segment),
        hinge: Some(hinge),
        swing: Some(swing),
        group,
        bodies: made.bodies.clone(),
        params,
        ..Record::default()
    };
    save(s, &record)?;
    reply(&record)
}

/// One leaf (door) or sash with its glass (window), on `plane`, over x `a`…`b`, y `y0`…`y1`
/// in its frame; `hinge_at_start` puts a door's handle at the other edge. `sizes` is (leaf
/// thickness or sash face width, sash depth).
#[allow(clippy::too_many_arguments)]
fn panel(
    s: &mut Session,
    made: &mut Made,
    kind: Kind,
    plane: &str,
    name: &str,
    n: &str,
    (a, b, y0, y1): (&str, &str, &str, &str),
    hinge_at_start: bool,
    (leaf, depth): (&str, &str),
    (leaves, glass, handles): (&mut Vec<String>, &mut Vec<String>, &mut Vec<String>),
) -> Result<()> {
    match kind {
        Kind::Door => {
            let sk = format!("{name} leaf{n} outline");
            sketch(s, made, plane, &sk, &[rect(a, y0, b, y1)])?;
            let before = made.bodies.len();
            slab(s, made, &sk, leaf, &format!("{name} leaf{n}"))?;
            leaves.extend(made.bodies[before..].iter().cloned());
            // A handle near the free edge, 1 m up.
            let (hx0, hx1) = if hinge_at_start { (format!("{b} - 100 mm"), format!("{b} - 70 mm")) } else { (format!("{a} + 70 mm"), format!("{a} + 100 mm")) };
            let hk = format!("{name} handle{n} outline");
            sketch(s, made, plane, &hk, &[rect(&hx0, &format!("{y0} + 990 mm"), &hx1, &format!("{y0} + 1120 mm"))])?;
            let before = made.bodies.len();
            slab(s, made, &hk, &format!("{leaf} + 120 mm"), &format!("{name} handle{n}"))?;
            handles.extend(made.bodies[before..].iter().cloned());
        }
        Kind::Window => {
            let sk = format!("{name} sash{n} outline");
            let curves = sketch(s, made, plane, &sk, &[loop_(&[[a, y0], [b, y0], [b, y1], [a, y1]])])?;
            let before = made.bodies.len();
            ring(s, made, &sk, &curves, leaf, depth, &format!("{name} sash{n}"))?;
            leaves.extend(made.bodies[before..].iter().cloned());
            let gk = format!("{name} glass{n} outline");
            sketch(s, made, plane, &gk, &[rect(&format!("{a} + {leaf}"), &format!("{y0} + {leaf}"), &format!("{b} - {leaf}"), &format!("{y1} - {leaf}"))])?;
            let before = made.bodies.len();
            slab(s, made, &gk, "24 mm", &format!("{name} glass{n}"))?;
            glass.extend(made.bodies[before..].iter().cloned());
        }
    }
    Ok(())
}

/// Delete an element's features (its folder, or its listed features).
fn remove_features(s: &mut Session, r: &Record) -> Result<()> {
    match r.group {
        Some(g) if s.doc.timeline_groups.iter().any(|x| x.id == g) => {
            run(s, "timeline.delete", json!({ "groups": [g] }))?;
        }
        _ => {
            let ids: Vec<u64> = r.features.iter().copied().filter(|id| s.doc.features.iter().any(|f| f.id == *id)).collect();
            if !ids.is_empty() {
                run(s, "timeline.delete", json!({ "features": ids }))?;
            }
        }
    }
    Ok(())
}

fn delete(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "arch.delete";
    let e: ArchElementParams = parse(CMD, p)?;
    let target = record(s, CMD, &e.element)?;
    // What goes with it: a level's walls, a wall's doors and windows; the dependents first.
    let all = records(s);
    let mut order = vec![target.clone()];
    let mut i = 0;
    while i < order.len() {
        let parent = order[i].clone();
        for r in &all {
            let depends = (parent.kind == "level" && r.kind == "wall" && r.level.as_deref() == Some(parent.name.as_str()))
                || (parent.kind == "wall" && r.wall.as_deref() == Some(parent.name.as_str()));
            if depends && !order.iter().any(|o| o.name == r.name) {
                order.push(r.clone());
            }
        }
        i += 1;
    }
    let mut deleted = Vec::new();
    for r in order.iter().rev() {
        remove_features(s, r)?;
        // Parameters something else still uses stay.
        for param in r.params.values() {
            if s.doc.param(param).is_some() {
                let _ = run(s, "parameters.delete", json!({ "name": param }));
            }
        }
        forget(s, r)?;
        deleted.push(r.name.clone());
    }
    serde_json::to_value(ArchDeleted { deleted }).map_err(|e| bad(CMD, e.to_string()))
}

fn edit(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "arch.edit";
    let e: ArchEditParams = parse(CMD, p)?;
    let mut r = record(s, CMD, &e.element)?;
    if let Some(a) = &e.align {
        if r.kind != "wall" {
            return Err(bad(CMD, format!("a {} has no alignment; a wall's does", r.kind)));
        }
        r = realign(s, CMD, r, a)?;
    }
    let len = |x: &Option<crate::schema::LengthExpr>| x.as_ref().map(|v| v.0.as_str().to_string());
    let numbers: Vec<(&str, Option<String>)> = vec![
        ("height", len(&e.height)),
        ("thickness", len(&e.thickness)),
        ("elevation", len(&e.elevation)),
        ("position", len(&e.position)),
        ("width", len(&e.width)),
        ("sill", len(&e.sill)),
        ("frame", len(&e.frame)),
        ("depth", len(&e.depth)),
        ("leaf", len(&e.leaf)),
        ("angle", e.angle.as_ref().map(|v| v.0.as_str().to_string())),
        ("open", e.open.as_ref().map(|v| v.0.as_str().to_string())),
    ];
    let structural = (e.kind.is_some() && e.kind != r.kind_type)
        || (e.hinge.is_some() && e.hinge != r.hinge)
        || (e.swing.is_some() && e.swing != r.swing)
        || (e.wall.is_some() && e.wall != r.wall)
        || (e.segment.is_some() && e.segment != r.segment);
    if structural {
        let kind = match r.kind.as_str() {
            "door" => Kind::Door,
            "window" => Kind::Window,
            other => return Err(bad(CMD, format!("a {other} has no type, hinge, swing or wall to change"))),
        };
        remove_features(s, &r)?;
        // The numbers given change the parameters as the rebuild makes them.
        let mut o = json!({
            "wall": e.wall.clone().or(r.wall.clone()),
            "segment": e.segment.clone().or(r.segment.clone()),
            "type": e.kind.clone().or(r.kind_type.clone()),
            "hinge": e.hinge.clone().or(r.hinge.clone()),
            "swing": e.swing.clone().or(r.swing.clone()),
        });
        for (role, value) in &numbers {
            if let Some(v) = value {
                o[*role] = json!(v);
            }
        }
        // A new wall or line: the old segment means nothing there, unless it was given.
        if e.wall.is_some() && e.wall != r.wall && e.segment.is_none() {
            o["segment"] = Value::Null;
        }
        let o = o.as_object().map(|m| m.iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect::<serde_json::Map<_, _>>());
        let o: OpeningParams = parse(CMD, &Value::Object(o.unwrap_or_default()))?;
        // Parameters of roles the new type has no use for are left to be deleted with it.
        let cmd = if kind == Kind::Door { "arch.door" } else { "arch.window" };
        return opening(s, cmd, kind, o, Some(&r));
    }
    for (role, value) in numbers {
        let Some(v) = value else { continue };
        let param = r.params.get(role).ok_or_else(|| bad(CMD, format!("{} has no `{role}`", r.name)))?;
        run(s, "parameters.change", json!({ "name": param, "expression": v }))?;
    }
    reply(&r)
}

/// Move a wall about its line; its doors and windows follow, being drawn on its middle.
fn realign(s: &mut Session, cmd: &str, mut r: Record, given: &WallAlign) -> Result<Record> {
    let plan = r.sketch.clone().ok_or_else(|| bad(cmd, "the wall has no plan sketch"))?;
    let first_left = inside_left(s, cmd, &plan, &r.curves)?.into_iter().flatten().next().unwrap_or(true);
    let (fraction, label) = align_of(cmd, Some(given), first_left)?;
    if let Some(param) = r.params.get("align") {
        run(s, "parameters.change", json!({ "name": param, "expression": fraction }))?;
        r.align = Some(label);
        save(s, &r)?;
        return Ok(r);
    }
    // A wall made before alignment: its extrude takes two sides, and its doors and windows are
    // rebuilt on its middle.
    let thickness = r.params.get("thickness").cloned().ok_or_else(|| bad(cmd, format!("{} has no thickness parameter", r.name)))?;
    let align = ensure(
        s,
        &format!("{}_align", r.prefix),
        Some(&fraction),
        "0",
        Unit::Number,
        &format!("{}: where the wall lies against its line, 1 inside, 0 centred, -1 outside", r.name),
    )?;
    let feature = s.doc.features.iter().find(|f| f.name == r.name).map(|f| f.id).ok_or_else(|| bad(cmd, format!("{}'s extrude is gone", r.name)))?;
    let (inner, outer) = wall_sides(&thickness, &align);
    run(s, "timeline.edit", json!({ "feature": feature, "set": { "thin.side": "two_sides", "thin.thickness": inner, "thin.thickness2": outer } }))?;
    r.params.insert("align".into(), align);
    r.align = Some(label);
    save(s, &r)?;
    for o in records(s).into_iter().filter(|o| o.wall.as_deref() == Some(r.name.as_str())) {
        let kind = if o.kind == "door" { Kind::Door } else { Kind::Window };
        remove_features(s, &o)?;
        let params: OpeningParams = parse(
            cmd,
            &json!({ "wall": r.name, "segment": o.segment, "type": o.kind_type, "hinge": o.hinge, "swing": o.swing })
                .as_object()
                .map(|m| Value::Object(m.iter().filter(|(_, v)| !v.is_null()).map(|(k, v)| (k.clone(), v.clone())).collect()))
                .unwrap_or(Value::Null),
        )?;
        opening(s, if kind == Kind::Door { "arch.door" } else { "arch.window" }, kind, params, Some(&o))?;
    }
    Ok(r)
}

fn list(s: &mut Session, p: &Value) -> Result<Value> {
    const CMD: &str = "arch.list";
    let _: ArchListParams = parse(CMD, p)?;
    let elements = records(s)
        .into_iter()
        .map(|r| {
            let values: BTreeMap<String, String> =
                r.params.iter().filter_map(|(role, param)| Some((role.clone(), s.doc.param(param)?.expr.clone()))).collect();
            let mut v = serde_json::to_value(&r).unwrap_or(Value::Null);
            v["values"] = json!(values);
            v
        })
        .collect();
    serde_json::to_value(ArchList { elements }).map_err(|e| bad(CMD, e.to_string()))
}

