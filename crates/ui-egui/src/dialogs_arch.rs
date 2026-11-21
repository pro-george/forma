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

const DOOR_TYPES: &[&str] = &["single", "double", "sliding", "opening"];
const WINDOW_TYPES: &[&str] = &["fixed", "casement", "double", "sliding"];

/// Which command the dialog builds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    Wall,
    Door,
    Window,
    Level,
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
    get("height", if record["kind"] == "wall" { &mut a.height } else { &mut a.opening_height });
    get("thickness", &mut a.thickness);
    get("position", &mut a.position);
    get("width", &mut a.width);
    get("sill", &mut a.sill);
    get("angle", &mut a.angle);
    get("open", &mut a.open);
    get("frame", &mut a.frame);
    get("depth", &mut a.depth);
    get("leaf", &mut a.leaf);
    get("elevation", &mut a.elevation);
    if let Some(t) = record["type"].as_str() {
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
        Mode::Edit => {
            let element = a.element.as_ref().ok_or_else(|| tr("ui.arch.pick_element"))?;
            put("element", json!(element));
            if a.element_kind.as_deref() == Some("wall") {
                put("height", json!(a.height.trim()));
                put("thickness", json!(a.thickness.trim()));
            } else {
                opening_params(a, &mut put);
            }
        }
        Mode::Delete => put("element", json!(a.element.as_ref().ok_or_else(|| tr("ui.arch.pick_element"))?)),
    }
    if matches!(a.mode, Mode::Wall | Mode::Door | Mode::Window | Mode::Level) && !a.name.trim().is_empty() {
        put("name", json!(a.name.trim()));
    }
    Ok(vec![(a.command().to_string(), Value::Object(p))])
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
