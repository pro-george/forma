//! Forma: what covers and floors a building: slabs (`arch.slab`) and roofs (`arch.roof`).
//!
//! Both are built over a wall's plan sketch, so they follow the plan as it changes:
//!
//! - A slab is the plan's enclosed area extruded `thickness` down from its top face, which sits
//!   `top` above the level. To reach the wall's outer face it is joined with a band the shape of
//!   the wall (the same thin extrude of the plan lines, `thickness * (1 ± align) / 2` each side);
//!   to stop at the inner face that band is cut out of it instead.
//! - A roof's footprint is the same, its band reaching `overhang` past the wall's outer face,
//!   standing on the wall's top. A flat roof is that footprint `thickness` thick. A pitched roof
//!   is the footprint extruded tall and cut, for each eave, above a plane rising from the eave at
//!   the pitch: a plane through the plan line, turned about it to the pitch and moved out to the
//!   eave (its distance `height * cos(pitch) + reach * sin(pitch)`, `reach` being the outer
//!   face's distance from the line plus the overhang). A hollow pitched roof stands its slopes
//!   `thickness` higher, so its eaves keep a fascia, and has its attic cut out: the same
//!   construction one thickness in from the fascias and under the slopes, open underneath.

use super::*;
use crate::schema::arch::{RoofParams, SlabParams};

pub(super) const SLAB: TypedContract<SlabParams> = TypedContract::new();
pub(super) const ROOF: TypedContract<RoofParams> = TypedContract::new();

const SLAB_COLOR: &str = "#d8d0c2";
const ROOF_COLOR: &str = "#b5642a";
pub(super) const ROOF_TYPES: &[&str] = &["flat", "shed", "gable", "hip"];

/// A wall's thicknesses either side of its line (inside, outside), as expressions.
fn sides_of(wall: &Record) -> (String, String) {
    let t = wall.params.get("thickness").cloned().unwrap_or_else(|| "250 mm".into());
    match wall.params.get("align") {
        Some(a) => wall_sides(&t, a),
        None => (format!("{t} / 2"), format!("{t} / 2")),
    }
}

fn wall_of(s: &Session, cmd: &str, name: &str) -> Result<Record> {
    let wall = record(s, cmd, name)?;
    if wall.kind != "wall" {
        return Err(bad(cmd, format!("`{name}` is not a wall")));
    }
    if wall.sketch.is_none() {
        return Err(bad(cmd, format!("{name} has no plan sketch")));
    }
    Ok(wall)
}

/// A plan line's id and its ends in the plan sketch's own coordinates (mm).
pub(super) struct PlanLine {
    pub(super) id: String,
    pub(super) a: [f64; 2],
    pub(super) b: [f64; 2],
}

/// The straight lines among `curves`, and whether every curve is one.
pub(super) fn plan_lines(s: &Session, cmd: &str, plan: &str, curves: &[String]) -> Result<(Vec<PlanLine>, bool)> {
    let id = s.doc.features.iter().find(|f| f.name == plan).map(|f| f.id).ok_or_else(|| bad(cmd, format!("no plan sketch named `{plan}`")))?;
    let state = s.model.state();
    let ss = state.sketch(id).ok_or_else(|| bad(cmd, format!("{plan} has no solved geometry")))?;
    let mut lines = Vec::new();
    let mut all_lines = true;
    for c in curves {
        let ci = ss.sketch.curve_index(c).ok_or_else(|| bad(cmd, format!("{plan} has no curve `{c}`")))?;
        match ss.sketch.curves.get(ci).map(|k| &k.kind) {
            Some(crate::sketch::CurveKind::Line { a, b }) => {
                let (Some(pa), Some(pb)) = (ss.sketch.point(*a), ss.sketch.point(*b)) else {
                    return Err(bad(cmd, format!("{plan}'s `{c}` has no ends")));
                };
                lines.push(PlanLine { id: c.clone(), a: [pa.x, pa.y], b: [pb.x, pb.y] });
            }
            _ => all_lines = false,
        }
    }
    Ok((lines, all_lines))
}

fn length(l: &PlanLine) -> f64 {
    (l.b[0] - l.a[0]).hypot(l.b[1] - l.a[1])
}

/// Read `top`/`at` for a slab: the default expression of its top face's height.
fn slab_top_default(cmd: &str, at: &str, wall: Option<&Record>, thickness: &str) -> Result<String> {
    match (at, wall) {
        ("base", _) => Ok("0 mm".into()),
        ("top", Some(w)) => {
            let h = w.params.get("height").cloned().ok_or_else(|| bad(cmd, format!("{} has no height parameter", w.name)))?;
            Ok(format!("{h} + {thickness}"))
        }
        ("top", None) => Err(bad(cmd, "`at: top` needs a `wall` to stand on")),
        _ => Err(bad(cmd, "`at` is base or top")),
    }
}

pub(super) fn slab(s: &mut Session, p: &Value) -> Result<Value> {
    let q: SlabParams = parse("arch.slab", p)?;
    slab_build(s, q, None)
}

fn slab_build(s: &mut Session, q: SlabParams, rebuilt: Option<&Record>) -> Result<Value> {
    const CMD: &str = "arch.slab";
    let name = match rebuilt {
        Some(r) => r.name.clone(),
        None => new_name(s, CMD, q.name.as_deref(), "Slab")?,
    };
    let prefix = prefix_of(&name);
    let wall = match &q.wall {
        Some(w) => Some(wall_of(s, CMD, w)?),
        None => None,
    };
    let at = q.at.clone().unwrap_or_else(|| "base".into());
    if at != "base" && at != "top" {
        return Err(bad(CMD, "`at` is base or top"));
    }
    let extent = q.extent.clone().unwrap_or_else(|| {
        if wall.is_none() {
            "line".into()
        } else if at == "top" {
            "outside".into()
        } else {
            "inside".into()
        }
    });
    if !["inside", "outside", "line"].contains(&extent.as_str()) {
        return Err(bad(CMD, "`extent` is inside, outside or line"));
    }
    if wall.is_none() && extent != "line" {
        return Err(bad(CMD, "`extent: inside` or `outside` needs a `wall` to reach to"));
    }
    let mut made = Made::default();
    let (plan, curves, level) = match (&wall, &q.points, &q.sketch) {
        (Some(w), None, None) => {
            if q.level.is_some() || q.curves.is_some() {
                return Err(bad(CMD, "a slab over a wall takes the wall's plan and level"));
            }
            (w.sketch.clone().unwrap_or_default(), w.curves.clone(), w.level.clone().unwrap_or_else(|| "XY".into()))
        }
        (None, Some(points), None) => {
            if points.len() < 3 || points.len() > MAX_POINTS {
                return Err(bad(CMD, format!("`points` must hold 3…{MAX_POINTS} points")));
            }
            let level = q.level.clone().unwrap_or_else(|| "XY".into());
            let points: Vec<[&str; 2]> = points.iter().map(|p| [p.0[0].0.as_str(), p.0[1].0.as_str()]).collect();
            let plan = format!("{name} outline");
            let curves = sketch(s, &mut made, &level, &plan, &[("sketch.line", json!({ "points": points, "closed": true, "infer": false }))])?;
            (plan, curves, level)
        }
        (None, None, Some(plan)) => {
            let curves = match &q.curves {
                Some(c) => c.clone(),
                None => {
                    let r = run(s, "sketch.inspect", json!({ "sketch": plan }))?;
                    r.get("curves")
                        .and_then(Value::as_array)
                        .map(|a| {
                            a.iter()
                                .filter(|c| !c.get("construction").and_then(Value::as_bool).unwrap_or(false))
                                .filter_map(|c| c.get("id").and_then(Value::as_str).map(str::to_string))
                                .collect()
                        })
                        .unwrap_or_default()
                }
            };
            (plan.clone(), curves, q.level.clone().unwrap_or_else(|| "XY".into()))
        }
        _ => return Err(bad(CMD, "give one of `wall`, `points` or `sketch`")),
    };
    if curves.is_empty() || curves.len() > 1000 {
        return Err(bad(CMD, "the slab's outline needs 1…1000 curves"));
    }
    let mut params = BTreeMap::new();
    let thickness = ensure(
        s,
        &format!("{prefix}_thickness"),
        q.thickness.as_ref().map(|e| e.0.as_str()),
        "200 mm",
        Unit::Length,
        &format!("{name}: thickness"),
    )?;
    params.insert("thickness".to_string(), thickness.clone());
    let top_default = slab_top_default(CMD, &at, wall.as_ref(), &thickness)?;
    // A rebuild keeps the top's expression unless `at` or `top` was given.
    let top_given = q.top.as_ref().map(|e| e.0.as_str().to_string()).or_else(|| (rebuilt.is_none() || q.at.is_some()).then(|| top_default.clone()));
    let top = ensure(s, &format!("{prefix}_top"), top_given.as_deref(), &top_default, Unit::Length, &format!("{name}: height of its top face above its level"))?;
    params.insert("top".to_string(), top.clone());
    let start = format!("{top} - {thickness}");
    let r = run(
        s,
        "solid.extrude",
        json!({ "sketch": plan, "profiles": [{ "curves": curves }], "distance": thickness, "start_offset": start,
                "operation": "new_body", "name": name, "body_name": name }),
    )
    .map_err(|e| bad(CMD, format!("the outline must close around an area: {e}")))?;
    made.add(&r);
    let body = strings(&r, "created_bodies").first().cloned().unwrap_or_else(|| name.clone());
    if let (Some(w), "inside" | "outside") = (&wall, extent.as_str()) {
        let (inner, outer) = sides_of(w);
        let r = run(
            s,
            "solid.extrude",
            json!({ "sketch": plan, "thin": true, "curves": curves, "thickness": inner, "thickness2": outer, "side": "two_sides",
                    "distance": thickness, "start_offset": start, "operation": if extent == "outside" { "join" } else { "cut" },
                    "targets": [body], "name": format!("{name} edge") }),
        )?;
        made.add(&r);
    }
    paint(s, std::slice::from_ref(&body), SLAB_COLOR, 1.0)?;
    let group = finish(s, &made, &name)?;
    let record = Record {
        name,
        kind: "slab".into(),
        prefix,
        kind_type: Some(at),
        extent: Some(extent),
        wall: q.wall.clone(),
        sketch: Some(plan),
        curves,
        level: Some(level),
        group,
        bodies: vec![body],
        params,
        ..Record::default()
    };
    save(s, &record)?;
    reply(&record)
}

/// Rebuild a slab whose `at` or `extent` changes, keeping what was not given.
pub(super) fn slab_rebuild(s: &mut Session, r: &Record, at: Option<String>, extent: Option<String>) -> Result<Value> {
    const CMD: &str = "arch.edit";
    let outline_wall = r.wall.clone();
    remove_features(s, r)?;
    let mut q = json!({ "at": at.or(r.kind_type.clone()), "extent": extent.or(r.extent.clone()) });
    match &outline_wall {
        Some(w) => q["wall"] = json!(w),
        None => {
            q["sketch"] = json!(r.sketch);
            q["curves"] = json!(r.curves);
            q["level"] = json!(r.level);
        }
    }
    let q: SlabParams = parse(CMD, &drop_nulls(q))?;
    slab_build(s, q, Some(r))
}

/// An object without its null members.
pub(super) fn drop_nulls(v: Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(m.into_iter().filter(|(_, v)| !v.is_null()).collect()),
        other => other,
    }
}

pub(super) fn roof(s: &mut Session, p: &Value) -> Result<Value> {
    let q: RoofParams = parse("arch.roof", p)?;
    roof_build(s, q, None)
}

pub(super) fn roof_build(s: &mut Session, q: RoofParams, rebuilt: Option<&Record>) -> Result<Value> {
    const CMD: &str = "arch.roof";
    let wall = wall_of(s, CMD, &q.wall)?;
    let kind_type = q.kind.clone().unwrap_or_else(|| "gable".into());
    if !ROOF_TYPES.contains(&kind_type.as_str()) {
        return Err(bad(CMD, format!("a roof is {}", ROOF_TYPES.join(", "))));
    }
    let pitched = kind_type != "flat";
    let name = match rebuilt {
        Some(r) => r.name.clone(),
        None => new_name(s, CMD, q.name.as_deref(), "Roof")?,
    };
    let prefix = prefix_of(&name);
    let plan = wall.sketch.clone().unwrap_or_default();
    let level = wall.level.clone().unwrap_or_else(|| "XY".into());
    let height = wall.params.get("height").cloned().ok_or_else(|| bad(CMD, format!("{} has no height parameter", wall.name)))?;
    let (inner, outer) = sides_of(&wall);

    // The plan, in numbers: to choose the eaves, check them and size the cuts.
    let (lines, all_lines) = plan_lines(s, CMD, &plan, &wall.curves)?;
    if pitched && !all_lines {
        return Err(bad(CMD, "a pitched roof rises from straight plan lines; this plan has arcs or curves (a flat roof takes any plan)"));
    }
    let left = inside_left(s, CMD, &plan, &wall.curves)?;
    let left_of = |id: &str| wall.curves.iter().position(|c| c == id).and_then(|k| left.get(k).copied().flatten()).unwrap_or(true);
    let eaves: Vec<String> = match (&q.eaves, kind_type.as_str()) {
        (_, "flat") => Vec::new(),
        (Some(given), _) => {
            if given.is_empty() || given.len() > 200 {
                return Err(bad(CMD, "`eaves` lists 1…200 plan lines"));
            }
            if let Some(bad_id) = given.iter().find(|g| !lines.iter().any(|l| l.id == **g)) {
                return Err(bad(CMD, format!("`{bad_id}` is not one of {}'s straight lines", wall.name)));
            }
            given.clone()
        }
        (None, "shed") => lines.iter().max_by(|a, b| length(a).total_cmp(&length(b))).map(|l| vec![l.id.clone()]).unwrap_or_default(),
        (None, "gable") => {
            // The longest pair of parallel lines facing each other.
            let mut best: Option<(f64, &PlanLine, &PlanLine)> = None;
            for (i, a) in lines.iter().enumerate() {
                for b in lines.iter().skip(i + 1) {
                    let (da, db) = ([a.b[0] - a.a[0], a.b[1] - a.a[1]], [b.b[0] - b.a[0], b.b[1] - b.a[1]]);
                    let cross = (da[0] * db[1] - da[1] * db[0]) / (length(a) * length(b)).max(1e-12);
                    if cross.abs() < 1e-6 {
                        let total = length(a) + length(b);
                        if best.is_none_or(|(t, _, _)| total > t + 1e-9) {
                            best = Some((total, a, b));
                        }
                    }
                }
            }
            let (_, a, b) = best.ok_or_else(|| bad(CMD, "a gable roof needs two parallel plan lines; name its `eaves`"))?;
            vec![a.id.clone(), b.id.clone()]
        }
        (None, _) => lines.iter().map(|l| l.id.clone()).collect(),
    };
    // Each slope cuts everything above its plane: the rest of the plan must lie inside its eave,
    // or the cut would take part of the roof away (a hip on an L-shaped plan).
    let points: Vec<[f64; 2]> = lines.iter().flat_map(|l| [l.a, l.b]).collect();
    let span = points.iter().flat_map(|p| points.iter().map(move |q| (p[0] - q[0]).hypot(p[1] - q[1]))).fold(0.0_f64, f64::max);
    for e in &eaves {
        let Some(l) = lines.iter().find(|l| l.id == *e) else { continue };
        let len = length(l).max(1e-9);
        let dir = [(l.b[0] - l.a[0]) / len, (l.b[1] - l.a[1]) / len];
        let inward = if left_of(e) { [-dir[1], dir[0]] } else { [dir[1], -dir[0]] };
        if points.iter().any(|p| (p[0] - l.a[0]) * inward[0] + (p[1] - l.a[1]) * inward[1] < -1e-6 * span.max(1.0)) {
            return Err(bad(
                CMD,
                format!("part of {}'s plan lies outside the eave `{e}`, so its slope would cut it away: choose other `eaves`, or roof the plan in convex parts", wall.name),
            ));
        }
    }

    let mut params = BTreeMap::new();
    let mut par = |s: &mut Session, role: &str, given: Option<&str>, default: &str, unit: Unit| -> Result<String> {
        let n = ensure(s, &format!("{prefix}_{role}"), given, default, unit, &format!("{name}: {role}"))?;
        params.insert(role.to_string(), n.clone());
        Ok(n)
    };
    let overhang = par(s, "overhang", q.overhang.as_ref().map(|e| e.0.as_str()), "300 mm", Unit::Length)?;
    let thickness = par(s, "thickness", q.thickness.as_ref().map(|e| e.0.as_str()), "200 mm", Unit::Length)?;
    let pitch = if pitched {
        Some(par(s, "pitch", q.pitch.as_ref().map(|e| e.0.as_str()), if kind_type == "shed" { "15 deg" } else { "30 deg" }, Unit::Angle)?)
    } else {
        None
    };
    // Far enough to cover the whole plan from any eave, with room for the overhang.
    let reach_mm = (2.0 * span + 20_000.0).ceil();
    let reach = format!("{reach_mm} mm");

    let mut made = Made::default();
    let tall = match &pitch {
        Some(pitch) => format!("{reach} * tan({pitch}) + {thickness}"),
        None => thickness.clone(),
    };
    let eave_reach = format!("{outer} + {overhang}");
    // The footprint: the plan's area and a band the shape of the wall reaching `out` past the
    // line, standing on the wall's top.
    let footprint = |s: &mut Session, made: &mut Made, body_name: &str, out: &str| -> Result<String> {
        let r = run(
            s,
            "solid.extrude",
            json!({ "sketch": plan, "profiles": [{ "curves": wall.curves }], "distance": tall, "start_offset": height,
                    "operation": "new_body", "name": body_name, "body_name": body_name }),
        )
        .map_err(|e| bad(CMD, format!("{}'s plan must close around an area: {e}", wall.name)))?;
        made.add(&r);
        let body = strings(&r, "created_bodies").first().cloned().unwrap_or_else(|| body_name.to_string());
        let r = run(
            s,
            "solid.extrude",
            json!({ "sketch": plan, "thin": true, "curves": wall.curves, "thickness": inner, "thickness2": out, "side": "two_sides",
                    "distance": tall, "start_offset": height, "operation": "join", "targets": [body], "name": format!("{body_name} eaves") }),
        )?;
        made.add(&r);
        Ok(body)
    };
    let body = footprint(s, &mut made, &name, &eave_reach)?;
    // A hollow roof: the attic inside it, one thickness in from its fascias and gable ends and
    // one thickness under its slopes, is cut out of it, open underneath.
    let hollow = pitch.is_some() && q.hollow;
    let attic = if hollow {
        // The footprint less a rim one thickness wide: the same prism shelled open at both ends.
        let rim = footprint(s, &mut made, &format!("{name} rim"), &eave_reach)?;
        let m = run(s, "inspect.measure", json!({ "bodies": [rim] }))?;
        let z = |k: &str| m["bodies"][0]["bbox"][k][2].as_f64().ok_or_else(|| bad(CMD, "the roof's footprint has no extent"));
        let (z0, z1) = (z("min")?, z("max")?);
        // A point just inside the plan, beside its first line's middle.
        let first = lines.first().ok_or_else(|| bad(CMD, "the plan has no straight line"))?;
        let len = length(first).max(1e-9);
        let dir = [(first.b[0] - first.a[0]) / len, (first.b[1] - first.a[1]) / len];
        let inward = if left_of(&first.id) { [-dir[1], dir[0]] } else { [dir[1], -dir[0]] };
        let inside = [(first.a[0] + first.b[0]) / 2.0 + inward[0], (first.a[1] + first.b[1]) / 2.0 + inward[1]];
        let r = run(
            s,
            "solid.shell",
            json!({ "faces": [[inside[0], inside[1], z0], [inside[0], inside[1], z1]], "thickness": thickness, "direction": "inside", "body": rim }),
        )
        .map_err(|e| bad(CMD, format!("the roof is too small for a shell {thickness} thick: {e}")))?;
        made.add(&r);
        let attic = footprint(s, &mut made, &format!("{name} attic"), &eave_reach)?;
        let r = run(s, "solid.combine", json!({ "target": attic, "tools": [rim], "operation": "cut", "name": format!("{name} attic rim") }))?;
        made.add(&r);
        Some(attic)
    } else {
        None
    };

    if let Some(pitch) = &pitch {
        for e in &eaves {
            let left = left_of(e);
            let base = format!("{name} {e} wall plane");
            let r = run(s, "construct.plane.perpendicular", json!({ "plane": level, "line": { "sketch": plan, "curve": e }, "name": base }))?;
            made.add(&r);
            made.hidden.push(base.clone());
            let axis = format!("{name} {e} line");
            let r = run(s, "construct.axis.edge", json!({ "edge": { "sketch": plan, "curve": e }, "name": axis }))?;
            made.add(&r);
            made.hidden.push(axis.clone());
            // The plane standing on the line, its normal to the line's right, turned down onto
            // the pitch towards the wall's inside.
            let tilt = if left { format!("-(90 deg - {pitch})") } else { format!("90 deg - {pitch}") };
            let turned = format!("{name} {e} pitch");
            let r = run(s, "construct.plane.at_angle", json!({ "base": base, "axis": axis, "angle": tilt, "name": turned }))?;
            made.add(&r);
            made.hidden.push(turned.clone());
            // Moved out to the eave. A hollow roof's slopes stand `thickness` higher, square to
            // them, so its eaves keep a fascia; its attic's slopes are where a solid roof's are.
            let rise = format!("{height} * cos({pitch}) + ({eave_reach}) * sin({pitch})");
            let lifted = if hollow { format!("{rise} + {thickness}") } else { rise.clone() };
            let cut_above = |s: &mut Session, made: &mut Made, label: &str, rise: &str, target: &str| -> Result<()> {
                let slope = format!("{label} {e} slope");
                let offset = if left { rise.to_string() } else { format!("-({rise})") };
                let r = run(s, "construct.plane.offset", json!({ "base": turned, "offset": offset, "name": slope }))?;
                made.add(&r);
                made.hidden.push(slope.clone());
                let cut = format!("{label} {e} cut");
                let neg = format!("-{reach_mm} mm");
                sketch(s, made, &slope, &cut, &[rect(&neg, &neg, &reach, &reach)])?;
                let r = run(
                    s,
                    "solid.extrude",
                    json!({ "sketch": cut, "distance": reach, "direction": if left { "positive" } else { "negative" },
                            "operation": "cut", "targets": [target], "name": format!("{label} {e} slope cut") }),
                )?;
                made.add(&r);
                Ok(())
            };
            cut_above(s, &mut made, &name, &lifted, &body)?;
            if let Some(attic) = &attic {
                cut_above(s, &mut made, &format!("{name} attic"), &rise, attic)?;
            }
        }
        if let Some(attic) = &attic {
            let r = run(s, "solid.combine", json!({ "target": body, "tools": [attic], "operation": "cut", "name": format!("{name} hollow") }))?;
            made.add(&r);
        }
    }
    paint(s, std::slice::from_ref(&body), ROOF_COLOR, 1.0)?;
    let group = finish(s, &made, &name)?;
    let record = Record {
        name,
        kind: "roof".into(),
        prefix,
        kind_type: Some(kind_type),
        hollow: q.hollow.then_some(true),
        wall: Some(wall.name.clone()),
        sketch: Some(plan),
        curves: eaves,
        level: Some(level),
        group,
        bodies: vec![body],
        params,
        ..Record::default()
    };
    save(s, &record)?;
    reply(&record)
}

/// Rebuild a roof whose type, eaves or hollowness changes; its numbers stay its parameters'.
pub(super) fn roof_rebuild(s: &mut Session, r: &Record, kind: Option<String>, eaves: Option<Vec<String>>, hollow: Option<bool>) -> Result<Value> {
    const CMD: &str = "arch.edit";
    let kind_changed = kind.is_some() && kind != r.kind_type;
    remove_features(s, r)?;
    let q = json!({
        "wall": r.wall,
        "type": kind.or(r.kind_type.clone()),
        "hollow": hollow.unwrap_or(r.hollow.unwrap_or(false)),
        // A new type chooses its own eaves unless they were given.
        "eaves": eaves.or_else(|| (!kind_changed && !r.curves.is_empty()).then(|| r.curves.clone())),
    });
    let q: RoofParams = parse(CMD, &drop_nulls(q))?;
    roof_build(s, q, Some(r))
}
