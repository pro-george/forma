//! Forma: the Architecture workspace's dialogs. Wall, Door, Window, Level, Edit Element and
//! Delete Element fill in the `arch.*` commands' parameters (see the engine's `cmd/arch.rs`).
//! A wall face picked in the view chooses the wall, the plan line it runs along, the side the
//! door or window opens to (the one picked) and where along the line it goes (centred on the
//! pick); its fields can then be changed before OK.

use serde_json::{Value, json};
use solidcore_record::Vec3;
use solidcraft_engine::Sel;
use solidcraft_engine::geom::prelude::*;
use solidcraft_engine::sketch::CurveKind;

use crate::SolveApp;
use crate::dialogs::Kind;
use crate::selection::{BODIES, FACES, SKETCH_LINES, SelInput};
use crate::ui_kit::{Text, choice_row, expr_row, row as form_row, text, text_row};

/// Where the elements' records live in the design's properties (the engine's `arch::META`).
const META: &str = "ro.artea.forma.arch.";

/// Where a wall lies against its line (the engine's `align` names), then a number set by hand.
const ALIGNS: &[&str] = &["center", "inside", "outside", "left", "right"];

/// Where a slab sits, how far it reaches, and the roofs there are (the engine's names).
const SLAB_AT: &[&str] = &["base", "top"];
const EXTENTS: &[&str] = &["auto", "inside", "outside", "line"];
const ROOF_TYPES: &[&str] = &["flat", "shed", "gable", "hip"];

/// A scale model's scales (denominators; the last choice is a scale typed in) and plates
/// (width × depth; the last is typed in).
const SCALES: &[f64] = &[50.0, 100.0, 200.0, 500.0];
const PLATES: &[[f64; 2]] = &[[256.0, 256.0], [180.0, 180.0], [350.0, 320.0]];
/// The parts that take a filament slot, as `arch.maquette` names them, and their defaults.
const SLOT_PARTS: &[(&str, usize)] = &[("walls", 1), ("slabs", 1), ("frames", 2), ("leaves", 2), ("glass", 3), ("roof", 4)];

const DOOR_TYPES: &[&str] = &["single", "double", "sliding", "opening"];
const WINDOW_TYPES: &[&str] = &["fixed", "casement", "double", "sliding"];

/// Which command the dialog builds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    Wall,
    Door,
    Window,
    Level,
    Slab,
    Roof,
    Maquette,
    Edit,
    Delete,
}

/// The dialog's values; the picks are its selection inputs.
#[derive(Clone, Debug)]
pub struct Arch {
    pub mode: Mode,
    /// A wall: 0, a rectangular room from the origin; 1, along plan lines picked.
    pub source: usize,
    pub room_width: String,
    pub room_depth: String,
    pub height: String,
    pub thickness: String,
    /// Where a wall lies against its line: an index into `ALIGNS`, or `ALIGNS.len()` for a
    /// number set by hand on the parameter (left alone).
    pub align: usize,
    /// Edit: the alignment the wall had, sent again only when changed.
    pub align_loaded: Option<usize>,
    /// The plane its plan is on: 0 is XY, then the levels in name order.
    pub level: usize,
    /// A door's or window's type (an index into its kind's types).
    pub kind_type: usize,
    pub position: String,
    pub width: String,
    pub opening_height: String,
    pub sill: String,
    /// 0: on the jamb towards the line's first point; 1: the other.
    pub hinge: usize,
    /// 0: opens to the left of the line, 1: to the right.
    pub swing: usize,
    pub angle: String,
    pub open: String,
    pub frame: String,
    pub depth: String,
    pub leaf: String,
    pub elevation: String,
    /// A slab: an index into `SLAB_AT`, and into `EXTENTS` (`auto` lets `at` choose).
    pub slab_at: usize,
    pub extent: usize,
    /// A slab's or roof's thickness, and a slab's top face above its level (empty: from `at`).
    pub cover_thickness: String,
    pub top: String,
    /// A roof: an index into `ROOF_TYPES`, its pitch and overhang, and whether it is hollow.
    pub roof_type: usize,
    pub pitch: String,
    pub overhang: String,
    pub hollow: bool,
    /// Edit: what the slab or roof had, so only what changes is sent (a change rebuilds it).
    pub loaded: Option<(usize, usize, usize, bool)>,
    /// A scale model: an index into `SCALES` (its length: `scale_text`), the thinnest wall, an
    /// index into `PLATES` (its length: `plate_text`), its pieces and pins, and each part's
    /// filament slot (index 0 is slot 1).
    pub scale: usize,
    pub scale_text: String,
    pub min_thickness: String,
    pub plate: usize,
    pub plate_text: [String; 2],
    pub close_openings: bool,
    pub split_levels: bool,
    pub lift_roof: bool,
    pub pins: bool,
    pub slots: [usize; 6],
    pub name: String,
    /// What the picks found: the wall element and its plan line.
    pub wall: Option<String>,
    pub segment: Option<String>,
    /// The pick the values above were last taken from.
    pub picked: Option<Sel>,
    /// A wall: how many plan lines were picked when last looked at (picking some switches the
    /// plan to them).
    pub lines: usize,
    /// Edit and Delete: the element picked and its kind.
    pub element: Option<String>,
    pub element_kind: Option<String>,
}

impl Arch {
    fn new(mode: Mode) -> Arch {
        let window = mode == Mode::Window;
        Arch {
            mode,
            source: 0,
            room_width: "5000 mm".into(),
            room_depth: "4000 mm".into(),
            height: "2700 mm".into(),
            thickness: "250 mm".into(),
            align: 0,
            align_loaded: None,
            level: 0,
            kind_type: usize::from(window),
            position: "600 mm".into(),
            width: if window { "1200 mm" } else { "900 mm" }.into(),
            opening_height: if window { "1400 mm" } else { "2100 mm" }.into(),
            sill: if window { "900 mm" } else { "0 mm" }.into(),
            hinge: 0,
            swing: 0,
            angle: "0 deg".into(),
            open: "0".into(),
            frame: if window { "70 mm" } else { "60 mm" }.into(),
            depth: "100 mm".into(),
            leaf: if window { "60 mm" } else { "40 mm" }.into(),
            elevation: "3000 mm".into(),
            slab_at: 0,
            extent: 0,
            cover_thickness: "200 mm".into(),
            top: String::new(),
            roof_type: 2,
            pitch: "30 deg".into(),
            overhang: "300 mm".into(),
            hollow: false,
            loaded: None,
            scale: 1,
            scale_text: "100".into(),
            min_thickness: "0.8 mm".into(),
            plate: 0,
            plate_text: ["256 mm".into(), "256 mm".into()],
            close_openings: true,
            split_levels: true,
            lift_roof: true,
            pins: true,
            slots: [0, 0, 1, 1, 2, 3],
            name: String::new(),
            wall: None,
            segment: None,
            picked: None,
            lines: 0,
            element: None,
            element_kind: None,
        }
    }

    /// The command OK runs.
    pub fn command(&self) -> &'static str {
        match self.mode {
            Mode::Wall => "arch.wall",
            Mode::Door => "arch.door",
            Mode::Window => "arch.window",
            Mode::Level => "arch.level",
            Mode::Slab => "arch.slab",
            Mode::Roof => "arch.roof",
            Mode::Maquette => "arch.maquette",
            Mode::Edit => "arch.edit",
            Mode::Delete => "arch.delete",
        }
    }

    /// The dialog's title (a message id).
    pub fn title(&self) -> &'static str {
        match self.mode {
            Mode::Wall => "ui.arch.title_wall",
            Mode::Door => "ui.arch.title_door",
            Mode::Window => "ui.arch.title_window",
            Mode::Level => "ui.arch.title_level",
            Mode::Slab => "ui.arch.title_slab",
            Mode::Roof => "ui.arch.title_roof",
            Mode::Maquette => "ui.arch.title_maquette",
            Mode::Edit => "ui.arch.title_edit",
            Mode::Delete => "ui.arch.title_delete",
        }
    }

    /// A door's or a window's: the one being made, or the element being edited.
    fn opening_kind(&self) -> Option<&'static str> {
        match (self.mode, self.element_kind.as_deref()) {
            (Mode::Door, _) | (Mode::Edit, Some("door")) => Some("door"),
            (Mode::Window, _) | (Mode::Edit, Some("window")) => Some("window"),
            _ => None,
        }
    }

    fn types(&self) -> &'static [&'static str] {
        if self.opening_kind() == Some("window") { WINDOW_TYPES } else { DOOR_TYPES }
    }

    fn type_name(&self) -> &'static str {
        self.types().get(self.kind_type).copied().unwrap_or("single")
    }
}

/// The dialog for an `arch.*` command, with the picks it takes.
pub fn start(_app: &SolveApp, id: &str) -> Option<(Kind, Vec<SelInput>)> {
    let (mode, inputs) = match id {
        "arch.wall" => (Mode::Wall, vec![SelInput::new("ui.arch.plan_lines", SKETCH_LINES, true)]),
        "arch.door" => (Mode::Door, vec![SelInput::new("ui.arch.wall_face", FACES, false)]),
        "arch.window" => (Mode::Window, vec![SelInput::new("ui.arch.wall_face", FACES, false)]),
        "arch.level" => (Mode::Level, Vec::new()),
        "arch.maquette" => (Mode::Maquette, Vec::new()),
        "arch.slab" => (Mode::Slab, vec![SelInput::new("ui.arch.wall_or_body", FACES | BODIES, false)]),
        "arch.roof" => (Mode::Roof, vec![SelInput::new("ui.arch.wall_or_body", FACES | BODIES, false)]),
        "arch.edit" => (Mode::Edit, vec![SelInput::new("ui.arch.element", FACES | BODIES, false)]),
        "arch.delete" => (Mode::Delete, vec![SelInput::new("ui.arch.element", FACES | BODIES, false)]),
        _ => return None,
    };
    Some((Kind::Arch(Arch::new(mode)), inputs))
}

/// Every element's record, as the engine saved it.
fn records(app: &SolveApp) -> Vec<Value> {
    let mut v: Vec<Value> = app.session.doc.metadata.0.iter().filter(|(k, _)| k.starts_with(META)).map(|(_, v)| v.clone()).collect();
    v.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    v
}

fn element_of_body(app: &SolveApp, body: &str) -> Option<Value> {
    records(app).into_iter().find(|r| r["bodies"].as_array().is_some_and(|b| b.iter().any(|x| x.as_str() == Some(body))))
}

/// A parameter's expression, by its role in an element's record.
fn value(app: &SolveApp, record: &Value, role: &str) -> Option<String> {
    let name = record["params"][role].as_str()?;
    app.session.doc.param(name).map(|p| p.expr.clone())
}

fn levels(app: &SolveApp) -> Vec<String> {
    std::iter::once("XY".to_string())
        .chain(records(app).iter().filter(|r| r["kind"] == "level").filter_map(|r| r["name"].as_str().map(str::to_string)))
        .collect()
}

fn picked_body(sel: &Sel) -> Option<&str> {
    match sel {
        Sel::Face { body, .. } | Sel::Body { name: body } => Some(body),
        _ => None,
    }
}

/// Take what a new pick says: the wall, its line, the side picked and where along the line.
fn take_pick(app: &SolveApp, a: &mut Arch, inputs: &[SelInput]) {
    let pick = crate::selection::items(inputs, 0).first().cloned();
    if pick == a.picked {
        return;
    }
    a.picked = pick.clone();
    let Some(sel) = pick else {
        a.wall = None;
        a.segment = None;
        a.element = None;
        a.element_kind = None;
        return;
    };
    let Some(record) = picked_body(&sel).and_then(|b| element_of_body(app, b)) else {
        a.wall = None;
        a.element = None;
        a.element_kind = None;
        return;
    };
    match a.mode {
        Mode::Door | Mode::Window => {
            if record["kind"] != "wall" {
                a.wall = None;
                return;
            }
            a.wall = record["name"].as_str().map(str::to_string);
            a.segment = None;
            if let Sel::Face { body, index, point } = &sel
                && let Some((segment, side)) = wall_face(app, body, *index)
            {
                a.swing = usize::from(side == "right");
                if let Some((along, length)) = along_line(app, &record, &segment, *point) {
                    // Centred on the pick, and kept within the line.
                    let width = crate::prefs::parse_length_mm(&a.width, 1.0).unwrap_or(900.0);
                    let start = ((along - width / 2.0) / 10.0).round() * 10.0;
                    let last = ((length - width) / 10.0).floor() * 10.0;
                    a.position = format!("{} mm", start.min(last).max(0.0));
                }
                a.segment = Some(segment);
            }
        }
        Mode::Slab | Mode::Roof => {
            a.wall = (record["kind"] == "wall").then(|| record["name"].as_str().map(str::to_string)).flatten();
        }
        Mode::Edit | Mode::Delete => {
            a.element = record["name"].as_str().map(str::to_string);
            a.element_kind = record["kind"].as_str().map(str::to_string);
            if a.mode == Mode::Edit {
                load(app, a, &record);
            }
        }
        _ => {}
    }
}

/// Fill the fields from an element being edited.
fn load(app: &SolveApp, a: &mut Arch, record: &Value) {
    let get = |role: &str, field: &mut String| {
        if let Some(v) = value(app, record, role) {
            *field = v;
        }
    };
    let covering = record["kind"] == "slab" || record["kind"] == "roof";
    get("height", if record["kind"] == "wall" { &mut a.height } else { &mut a.opening_height });
    get("thickness", if covering { &mut a.cover_thickness } else { &mut a.thickness });
    if covering {
        a.top.clear();
        get("top", &mut a.top);
        get("pitch", &mut a.pitch);
        get("overhang", &mut a.overhang);
        let at = |list: &[&str], v: &Value| v.as_str().and_then(|t| list.iter().position(|x| *x == t));
        if record["kind"] == "slab" {
            a.slab_at = at(SLAB_AT, &record["type"]).unwrap_or(0);
            a.extent = at(EXTENTS, &record["extent"]).unwrap_or(0);
        } else {
            a.roof_type = at(ROOF_TYPES, &record["type"]).unwrap_or(2);
            a.hollow = record["hollow"].as_bool().unwrap_or(false);
        }
        a.loaded = Some((a.slab_at, a.extent, a.roof_type, a.hollow));
    }
    if record["kind"] == "wall" {
        // A wall from before alignment has none: it is centred.
        let named = record["align"].as_str().unwrap_or("center");
        a.align = ALIGNS.iter().position(|x| *x == named).unwrap_or(ALIGNS.len());
        a.align_loaded = Some(a.align);
    }
    get("position", &mut a.position);
    get("width", &mut a.width);
    get("sill", &mut a.sill);
    get("angle", &mut a.angle);
    get("open", &mut a.open);
    get("frame", &mut a.frame);
    get("depth", &mut a.depth);
    get("leaf", &mut a.leaf);
    get("elevation", &mut a.elevation);
    if let Some(t) = record["type"].as_str()
        && !covering
    {
        a.kind_type = a.types().iter().position(|x| *x == t).unwrap_or(0);
    }
    a.hinge = usize::from(record["hinge"] == "end");
    a.swing = usize::from(record["swing"] == "right");
}

/// The plan line and side of a wall face, from its name (`…:wall:l2:left`).
fn wall_face(app: &SolveApp, body: &str, index: usize) -> Option<(String, String)> {
    let state = crate::open_meshing::session_world(&app.session);
    let b = state.body(body)?;
    let names = solidcraft_engine::doc::naming::face_names(b);
    let name = names.get(index)?;
    let parts: Vec<&str> = name.split(':').collect();
    let at = parts.iter().position(|p| *p == "wall")?;
    let curve = parts.get(at + 1)?;
    let side = parts.get(at + 2).copied().unwrap_or("left");
    Some((curve.to_string(), side.to_string()))
}

/// How far along a wall's plan line `point` lies from the line's first point, and the line's
/// length (mm).
fn along_line(app: &SolveApp, record: &Value, segment: &str, point: Vec3) -> Option<(f64, f64)> {
    let plan = record["sketch"].as_str()?;
    let id = app.session.doc.features.iter().find(|f| f.name == plan)?.id;
    let state = app.session.model.state();
    let ss = state.sketch(id)?;
    let c = ss.sketch.curve_index(segment)?;
    let CurveKind::Line { a, b } = &ss.sketch.curves.get(c)?.kind else { return None };
    let (a, b) = (*a, *b);
    let (a, b) = (ss.plane.to_world(ss.sketch.point(a)?), ss.plane.to_world(ss.sketch.point(b)?));
    let along = b - a;
    let len = along.len();
    (len > 1e-9).then(|| ((point - a).dot(along) / len, len))
}

/// The dialog's rows after its picks; true when Enter was pressed in a value.
pub fn rows(app: &SolveApp, ui: &mut egui::Ui, a: &mut Arch, inputs: &[SelInput]) -> bool {
    take_pick(app, a, inputs);
    let tr = |id: &str| app.tr(id).to_string();
    let mut enter = false;
    match a.mode {
        Mode::Wall => {
            let lines = crate::selection::items(inputs, 0).len();
            if lines != a.lines {
                if lines > 0 {
                    a.source = 1;
                }
                a.lines = lines;
            }
            choice_row(ui, &tr("ui.arch.source"), "arch_source", &mut a.source, &[&tr("ui.arch.source_room"), &tr("ui.arch.source_lines")]);
            if a.source == 0 {
                enter |= expr_row(ui, &tr("ui.arch.room_width"), &mut a.room_width);
                enter |= expr_row(ui, &tr("ui.arch.room_depth"), &mut a.room_depth);
            } else if crate::selection::items(inputs, 0).is_empty() {
                text(ui, &tr("ui.arch.pick_lines"), Text::Hint("arch_pick_lines"));
            }
            enter |= expr_row(ui, &tr("ui.height"), &mut a.height);
            enter |= expr_row(ui, &tr("ui.thickness"), &mut a.thickness);
            align_rows(app, ui, a);
            let levels = levels(app);
            if levels.len() > 1 {
                let labels: Vec<&str> = levels.iter().map(String::as_str).collect();
                choice_row(ui, &tr("ui.arch.level"), "arch_level", &mut a.level, &labels);
            }
            enter |= text_row(ui, &tr("ui.arch.name"), &mut a.name, &tr("ui.arch.name_hint")).0;
        }
        Mode::Door | Mode::Window => {
            if a.wall.is_none() {
                text(ui, &tr("ui.arch.pick_wall"), Text::Hint("arch_pick_wall"));
            }
            enter |= opening_rows(app, ui, a);
            enter |= text_row(ui, &tr("ui.arch.name"), &mut a.name, &tr("ui.arch.name_hint")).0;
        }
        Mode::Slab | Mode::Roof => {
            if a.wall.is_none() {
                text(ui, &tr("ui.arch.pick_wall_cover"), Text::Hint("arch_pick_wall_cover"));
            }
            enter |= cover_rows(app, ui, a, a.mode == Mode::Roof);
            enter |= text_row(ui, &tr("ui.arch.name"), &mut a.name, &tr("ui.arch.name_hint")).0;
        }
        Mode::Maquette => enter |= maquette_rows(app, ui, a),
        Mode::Level => {
            enter |= expr_row(ui, &tr("ui.arch.elevation"), &mut a.elevation);
            enter |= text_row(ui, &tr("ui.arch.name"), &mut a.name, &tr("ui.arch.name_hint")).0;
        }
        Mode::Edit => match a.element_kind.as_deref() {
            None => {
                text(ui, &tr("ui.arch.pick_element"), Text::Hint("arch_pick_element"));
            }
            Some("wall") => {
                form_row(ui, &tr("ui.arch.name"), |ui| {
                    ui.label(a.element.clone().unwrap_or_default());
                });
                enter |= expr_row(ui, &tr("ui.height"), &mut a.height);
                enter |= expr_row(ui, &tr("ui.thickness"), &mut a.thickness);
                align_rows(app, ui, a);
            }
            Some(kind @ ("slab" | "roof")) => {
                let roof = kind == "roof";
                form_row(ui, &tr("ui.arch.name"), |ui| {
                    ui.label(a.element.clone().unwrap_or_default());
                });
                enter |= cover_rows(app, ui, a, roof);
            }
            Some(_) => {
                form_row(ui, &tr("ui.arch.name"), |ui| {
                    ui.label(a.element.clone().unwrap_or_default());
                });
                enter |= opening_rows(app, ui, a);
            }
        },
        Mode::Delete => match &a.element {
            None => {
                text(ui, &tr("ui.arch.pick_element"), Text::Hint("arch_pick_element"));
            }
            Some(name) => {
                let what = tr("ui.arch.delete_what").replace("{name}", name);
                text(ui, &what, Text::Hint("arch_delete_what"));
            }
        },
    }
    enter
}

/// A scale model's rows.
fn maquette_rows(app: &SolveApp, ui: &mut egui::Ui, a: &mut Arch) -> bool {
    let tr = |id: &str| app.tr(id).to_string();
    let mut enter = false;
    let mut scales: Vec<String> = SCALES.iter().map(|d| format!("1:{d}")).collect();
    scales.push(tr("ui.arch.custom"));
    let scales: Vec<&str> = scales.iter().map(String::as_str).collect();
    choice_row(ui, &tr("ui.arch.scale"), "arch_scale", &mut a.scale, &scales);
    if a.scale >= SCALES.len() {
        enter |= text_row(ui, &tr("ui.arch.scale_custom"), &mut a.scale_text, "100").0;
    }
    enter |= expr_row(ui, &tr("ui.arch.min_thickness"), &mut a.min_thickness);
    text(ui, &tr("ui.arch.min_thickness_hint"), Text::Hint("arch_min_hint"));
    let mut plates: Vec<String> = PLATES.iter().map(|[w, d]| format!("{w} × {d} mm")).collect();
    plates.push(tr("ui.arch.custom"));
    let plates: Vec<&str> = plates.iter().map(String::as_str).collect();
    choice_row(ui, &tr("ui.arch.plate"), "arch_plate", &mut a.plate, &plates);
    if a.plate >= PLATES.len() {
        let [w, d] = &mut a.plate_text;
        enter |= expr_row(ui, &tr("ui.width"), w);
        enter |= expr_row(ui, &tr("ui.depth"), d);
    }
    for (label, on) in [
        ("ui.arch.close_openings", &mut a.close_openings),
        ("ui.arch.split_levels", &mut a.split_levels),
        ("ui.arch.lift_roof", &mut a.lift_roof),
        ("ui.arch.pins", &mut a.pins),
    ] {
        form_row(ui, &tr(label), |ui| crate::dialogs::check(ui, on));
    }
    text(ui, &tr("ui.arch.slots_hint"), Text::Hint("arch_slots_hint"));
    let numbers: Vec<String> = (1..=8).map(|n| n.to_string()).collect();
    let numbers: Vec<&str> = numbers.iter().map(String::as_str).collect();
    for ((part, _), slot) in SLOT_PARTS.iter().zip(a.slots.iter_mut()) {
        choice_row(ui, &tr(&format!("ui.arch.slot_{part}")), &format!("arch_slot_{part}"), slot, &numbers);
    }
    enter
}

/// `arch.maquette`'s parameters from the dialog (no `path`: the file dialog gives it).
fn maquette_params(a: &Arch) -> Result<Value, String> {
    let scale = match SCALES.get(a.scale) {
        Some(d) => *d,
        None => {
            let t = a.scale_text.trim();
            let t = t.strip_prefix("1:").unwrap_or(t).trim();
            t.parse::<f64>().ok().filter(|d| d.is_finite() && (1.0..=10_000.0).contains(d)).ok_or_else(|| "scale: 1…10000".to_string())?
        }
    };
    let min = crate::prefs::parse_length_mm(&a.min_thickness, 1.0).ok_or_else(|| "minimum thickness".to_string())?;
    let plate = match PLATES.get(a.plate) {
        Some(p) => *p,
        None => {
            let w = crate::prefs::parse_length_mm(&a.plate_text[0], 1.0).ok_or_else(|| "plate width".to_string())?;
            let d = crate::prefs::parse_length_mm(&a.plate_text[1], 1.0).ok_or_else(|| "plate depth".to_string())?;
            [w, d]
        }
    };
    let mut slots = serde_json::Map::new();
    for ((part, _), slot) in SLOT_PARTS.iter().zip(a.slots.iter()) {
        slots.insert(part.to_string(), json!(slot + 1));
    }
    Ok(json!({
        "scale": scale, "min_thickness": min, "plate": plate, "close_openings": a.close_openings, "levels": a.split_levels,
        "roof": a.lift_roof, "pins": a.pins, "slots": slots,
    }))
}

/// Export: ask where to save, then make the scale model there and say what it made.
pub fn run_maquette(app: &mut SolveApp, a: &Arch) -> Result<(), String> {
    let params = maquette_params(a)?;
    let scale = params["scale"].as_f64().unwrap_or(100.0);
    let name = format!("{} 1-{scale}", app.session.doc.name);
    app.pick_save(&format!("{name}.3mf"), &["3mf"], move |app, path| {
        let Some(path) = path else { return };
        let _language = solidcraft_ui_text::scope(&app.preferences.language);
        let mut params = params;
        params["path"] = json!(path);
        let Ok(r) = app.run("arch.maquette", params) else { return };
        let count = |k: &str| r[k].as_array().map_or(0, Vec::len);
        let n = |k: &str| r[k].as_u64().unwrap_or(0).to_string();
        let line = solidcraft_ui_text::format(
            "ui.arch.maquette_done",
            &[
                ("pieces", &count("pieces").to_string()),
                ("plates", &n("plates")),
                ("thickened", &count("thickened").to_string()),
                ("omitted", &count("omitted").to_string()),
                ("pins", &n("pins")),
                ("path", &path),
            ],
        );
        app.set_status(line, false);
    });
    Ok(())
}

/// A slab's or roof's own rows.
fn cover_rows(app: &SolveApp, ui: &mut egui::Ui, a: &mut Arch, roof: bool) -> bool {
    let tr = |id: &str| app.tr(id).to_string();
    let labels = |prefix: &str, list: &[&str]| -> Vec<String> { list.iter().map(|x| tr(&format!("{prefix}{x}"))).collect() };
    let mut enter = false;
    if roof {
        let before = a.roof_type;
        let names = labels("ui.arch.roof_", ROOF_TYPES);
        let names: Vec<&str> = names.iter().map(String::as_str).collect();
        choice_row(ui, &tr("ui.arch.type"), "arch_roof_type", &mut a.roof_type, &names);
        // A shed's usual pitch is lower; follow it while the pitch is still a default.
        let shed = ROOF_TYPES.get(a.roof_type) == Some(&"shed");
        if a.roof_type != before && (a.pitch.trim() == "30 deg" || a.pitch.trim() == "15 deg") {
            a.pitch = if shed { "15 deg" } else { "30 deg" }.into();
        }
        let flat = ROOF_TYPES.get(a.roof_type) == Some(&"flat");
        if !flat {
            enter |= expr_row(ui, &tr("ui.arch.pitch"), &mut a.pitch);
        }
        enter |= expr_row(ui, &tr("ui.arch.overhang"), &mut a.overhang);
        if !flat {
            form_row(ui, &tr("ui.arch.hollow"), |ui| crate::dialogs::check(ui, &mut a.hollow));
        }
        if flat || a.hollow {
            enter |= expr_row(ui, &tr("ui.thickness"), &mut a.cover_thickness);
        }
        let hint = if flat { "ui.arch.roof_flat_hint" } else { "ui.arch.roof_pitched_hint" };
        text(ui, &tr(hint), Text::Hint("arch_roof_hint"));
    } else {
        let names = labels("ui.arch.at_", SLAB_AT);
        let names: Vec<&str> = names.iter().map(String::as_str).collect();
        choice_row(ui, &tr("ui.arch.at"), "arch_slab_at", &mut a.slab_at, &names);
        let names = labels("ui.arch.extent_", EXTENTS);
        let names: Vec<&str> = names.iter().map(String::as_str).collect();
        choice_row(ui, &tr("ui.arch.extent"), "arch_extent", &mut a.extent, &names);
        enter |= expr_row(ui, &tr("ui.thickness"), &mut a.cover_thickness);
        if a.mode == Mode::Edit {
            enter |= expr_row(ui, &tr("ui.arch.top"), &mut a.top);
        }
    }
    enter
}

/// A wall's alignment: the choice, and what it means.
fn align_rows(app: &SolveApp, ui: &mut egui::Ui, a: &mut Arch) {
    let tr = |id: &str| app.tr(id).to_string();
    let mut labels: Vec<String> = ALIGNS.iter().map(|x| tr(&format!("ui.arch.align_{x}"))).collect();
    // A number set by hand on the parameter stays one of the choices until another is made.
    if a.align == ALIGNS.len() {
        labels.push(tr("ui.arch.align_custom"));
    }
    let labels: Vec<&str> = labels.iter().map(String::as_str).collect();
    choice_row(ui, &tr("ui.arch.align"), "arch_align", &mut a.align, &labels);
    let hint = ALIGNS.get(a.align).copied().unwrap_or("custom");
    text(ui, &tr(&format!("ui.arch.align_{hint}_hint")), Text::Hint("arch_align_hint"));
}

/// A door's or window's own rows.
fn opening_rows(app: &SolveApp, ui: &mut egui::Ui, a: &mut Arch) -> bool {
    let tr = |id: &str| app.tr(id).to_string();
    let mut enter = false;
    let labels: Vec<String> = a.types().iter().map(|t| tr(&format!("ui.arch.type_{t}"))).collect();
    let labels: Vec<&str> = labels.iter().map(String::as_str).collect();
    choice_row(ui, &tr("ui.arch.type"), "arch_type", &mut a.kind_type, &labels);
    let kind_type = a.type_name();
    enter |= expr_row(ui, &tr("ui.arch.position"), &mut a.position);
    enter |= expr_row(ui, &tr("ui.width"), &mut a.width);
    enter |= expr_row(ui, &tr("ui.height"), &mut a.opening_height);
    enter |= expr_row(ui, &tr("ui.arch.sill"), &mut a.sill);
    let hinged = !matches!(kind_type, "sliding" | "opening" | "fixed");
    if hinged && kind_type != "double" {
        choice_row(ui, &tr("ui.arch.hinge"), "arch_hinge", &mut a.hinge, &[&tr("ui.arch.hinge_start"), &tr("ui.arch.hinge_end")]);
    }
    if hinged || kind_type == "sliding" {
        choice_row(ui, &tr("ui.arch.swing"), "arch_swing", &mut a.swing, &[&tr("ui.arch.swing_left"), &tr("ui.arch.swing_right")]);
    }
    if hinged {
        enter |= expr_row(ui, &tr("ui.arch.angle"), &mut a.angle);
    } else if kind_type == "sliding" {
        enter |= expr_row(ui, &tr("ui.arch.open"), &mut a.open);
    }
    if kind_type != "opening" {
        enter |= expr_row(ui, &tr("ui.arch.frame"), &mut a.frame);
        enter |= expr_row(ui, &tr("ui.depth"), &mut a.depth);
        let leaf = if a.opening_kind() == Some("window") { "ui.arch.sash" } else { "ui.arch.leaf" };
        enter |= expr_row(ui, &tr(leaf), &mut a.leaf);
    }
    enter
}

/// The command OK runs, and the preview.
pub fn commands(app: &SolveApp, a: &Arch, inputs: &[SelInput]) -> Result<Vec<(String, Value)>, String> {
    let tr = |id: &str| app.tr(id).to_string();
    let mut p = serde_json::Map::new();
    let mut put = |k: &str, v: Value| {
        p.insert(k.to_string(), v);
    };
    match a.mode {
        Mode::Wall => {
            if a.source == 0 {
                let (w, d) = (a.room_width.trim(), a.room_depth.trim());
                put("points", json!([[0, 0], [w, 0], [w, d], [0, d]]));
                put("closed", json!(true));
            } else {
                let mut sketch = None;
                let mut curves = Vec::new();
                for sel in crate::selection::items(inputs, 0) {
                    let (id, sk) = match sel {
                        Sel::SketchCurve { id, sketch: Some(sk) } | Sel::ExternalSketchCurve { sketch: sk, id } => (id, *sk),
                        _ => continue,
                    };
                    if sketch.is_some_and(|s| s != sk) {
                        return Err(tr("ui.arch.one_sketch"));
                    }
                    sketch = Some(sk);
                    curves.push(id.clone());
                }
                let sketch = sketch.ok_or_else(|| tr("ui.arch.pick_lines"))?;
                let name = app.session.doc.feature(sketch).map(|f| f.name.clone()).ok_or_else(|| tr("ui.arch.pick_lines"))?;
                put("sketch", json!(name));
                put("curves", json!(curves));
            }
            put("height", json!(a.height.trim()));
            put("thickness", json!(a.thickness.trim()));
            put("align", json!(ALIGNS.get(a.align).copied().unwrap_or("center")));
            if let Some(level) = levels(app).get(a.level).filter(|l| *l != "XY") {
                put("level", json!(level));
            }
        }
        Mode::Door | Mode::Window => {
            let wall = a.wall.as_ref().ok_or_else(|| tr("ui.arch.pick_wall"))?;
            put("wall", json!(wall));
            if let Some(segment) = &a.segment {
                put("segment", json!(segment));
            }
            opening_params(a, &mut put);
        }
        Mode::Level => put("elevation", json!(a.elevation.trim())),
        Mode::Maquette => {
            if let Value::Object(m) = maquette_params(a)? {
                for (k, v) in m {
                    put(&k, v);
                }
            }
        }
        Mode::Slab | Mode::Roof => {
            let wall = a.wall.as_ref().ok_or_else(|| tr("ui.arch.pick_wall_cover"))?;
            put("wall", json!(wall));
            cover_params(a, a.mode == Mode::Roof, None, &mut put);
        }
        Mode::Edit => {
            let element = a.element.as_ref().ok_or_else(|| tr("ui.arch.pick_element"))?;
            put("element", json!(element));
            if let Some(kind @ ("slab" | "roof")) = a.element_kind.as_deref() {
                cover_params(a, kind == "roof", a.loaded, &mut put);
            } else if a.element_kind.as_deref() == Some("wall") {
                put("height", json!(a.height.trim()));
                put("thickness", json!(a.thickness.trim()));
                if Some(a.align) != a.align_loaded
                    && let Some(named) = ALIGNS.get(a.align)
                {
                    put("align", json!(named));
                }
            } else {
                opening_params(a, &mut put);
            }
        }
        Mode::Delete => put("element", json!(a.element.as_ref().ok_or_else(|| tr("ui.arch.pick_element"))?)),
    }
    if matches!(a.mode, Mode::Wall | Mode::Door | Mode::Window | Mode::Level | Mode::Slab | Mode::Roof) && !a.name.trim().is_empty() {
        put("name", json!(a.name.trim()));
    }
    Ok(vec![(a.command().to_string(), Value::Object(p))])
}

/// A slab's or roof's parameters; editing (`loaded` holds what it had), only what changed of
/// what rebuilds it.
fn cover_params(a: &Arch, roof: bool, loaded: Option<(usize, usize, usize, bool)>, put: &mut impl FnMut(&str, Value)) {
    let changed = |now: usize, then: Option<usize>| then != Some(now);
    if roof {
        let kind = ROOF_TYPES.get(a.roof_type).copied().unwrap_or("gable");
        if changed(a.roof_type, loaded.map(|l| l.2)) {
            put("type", json!(kind));
        }
        if kind != "flat" {
            put("pitch", json!(a.pitch.trim()));
            if loaded.map(|l| l.3) != Some(a.hollow) && (loaded.is_some() || a.hollow) {
                put("hollow", json!(a.hollow));
            }
        }
        put("overhang", json!(a.overhang.trim()));
        if kind == "flat" || a.hollow {
            put("thickness", json!(a.cover_thickness.trim()));
        }
    } else {
        if changed(a.slab_at, loaded.map(|l| l.0)) {
            put("at", json!(SLAB_AT.get(a.slab_at).copied().unwrap_or("base")));
        }
        if a.extent != 0 && changed(a.extent, loaded.map(|l| l.1)) {
            put("extent", json!(EXTENTS.get(a.extent).copied().unwrap_or("inside")));
        }
        put("thickness", json!(a.cover_thickness.trim()));
        if loaded.is_some() && !a.top.trim().is_empty() && !changed(a.slab_at, loaded.map(|l| l.0)) {
            put("top", json!(a.top.trim()));
        }
    }
}

/// A door's or window's parameters, as its type uses them.
fn opening_params(a: &Arch, put: &mut impl FnMut(&str, Value)) {
    let kind_type = a.type_name();
    put("type", json!(kind_type));
    put("position", json!(a.position.trim()));
    put("width", json!(a.width.trim()));
    put("height", json!(a.opening_height.trim()));
    put("sill", json!(a.sill.trim()));
    let hinged = !matches!(kind_type, "sliding" | "opening" | "fixed");
    if hinged || kind_type == "sliding" {
        put("hinge", json!(if a.hinge == 1 { "end" } else { "start" }));
        put("swing", json!(if a.swing == 1 { "right" } else { "left" }));
    }
    if hinged {
        put("angle", json!(a.angle.trim()));
    } else if kind_type == "sliding" {
        put("open", json!(a.open.trim()));
    }
    if kind_type != "opening" {
        put("frame", json!(a.frame.trim()));
        put("depth", json!(a.depth.trim()));
        put("leaf", json!(a.leaf.trim()));
    }
}
