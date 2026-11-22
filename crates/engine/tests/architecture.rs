//! Forma: walls, doors and windows (`arch.*`), their volumes worked out by hand from their
//! sizes, and how they follow the wall and their parameters.

use serde_json::{Value, json};

use solidcraft_engine::Session;

fn run(s: &mut Session, id: &str, p: Value) -> Value {
    match s.execute(id, &p) {
        Ok(v) => v,
        Err(e) => panic!("{id} {p}: {e}"),
    }
}

/// Each named body's volume (mm³) and bounding box.
fn measure(s: &mut Session, body: &str) -> (f64, [f64; 3], [f64; 3]) {
    let r = run(s, "inspect.measure", json!({ "bodies": [body] }));
    let b = &r["bodies"][0];
    let v3 = |v: &Value| [0, 1, 2].map(|i| v[i].as_f64().unwrap_or(f64::NAN));
    (b["volume_mm3"].as_f64().unwrap_or(f64::NAN), v3(&b["bbox"]["min"]), v3(&b["bbox"]["max"]))
}

fn close(a: f64, b: f64) {
    assert!((a - b).abs() <= 1e-6 * b.abs().max(1.0), "{a} != {b}");
}

fn bodies(s: &mut Session) -> Vec<String> {
    let r = run(s, "inspect.measure", json!({}));
    r["bodies"].as_array().map(|a| a.iter().filter_map(|b| b["name"].as_str().map(str::to_string)).collect()).unwrap_or_default()
}

/// A 5 × 4 m room, its walls 250 mm thick and 2.7 m high, centred on their lines (the default).
fn room(s: &mut Session) {
    let r = run(s, "arch.wall", json!({ "points": [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], "closed": true }));
    assert_eq!(r["element"], "Wall 1");
    assert_eq!(r["parameters"]["height"], "Wall1_height");
}

/// The room's walls: the ring between 5250 × 4250 and 4750 × 3750, 2700 high.
const ROOM: f64 = (5250.0 * 4250.0 - 4750.0 * 3750.0) * 2700.0;

#[test]
fn a_door_and_a_window_cut_the_wall_and_fill_the_opening() {
    let mut s = Session::default();
    room(&mut s);
    close(measure(&mut s, "Wall 1").0, ROOM);
    run(&mut s, "arch.door", json!({ "wall": "Wall 1", "segment": "l1", "position": 800 }));
    // The opening through the wall, 900 × 2100 × 250.
    close(measure(&mut s, "Wall 1").0, ROOM - 900.0 * 2100.0 * 250.0);
    // A frame without a sill: two jambs 60 × 2100 and a head 780 × 60, 100 deep.
    let (v, min, max) = measure(&mut s, "Door 1 frame");
    close(v, (2.0 * 60.0 * 2100.0 + 780.0 * 60.0) * 100.0);
    close(min[0], 800.0);
    close(max[0], 1700.0);
    close(min[1], -50.0);
    close(max[1], 50.0);
    // The leaf between the jambs, 10 mm off the floor, 40 thick; closed, it lies in the wall.
    let (v, min, max) = measure(&mut s, "Door 1 leaf");
    close(v, 780.0 * 2030.0 * 40.0);
    close(min[1], -20.0);
    close(max[1], 20.0);
    close(measure(&mut s, "Door 1 handle").0, 30.0 * 130.0 * 160.0);

    // A casement window in the second line, which runs up from (5000, 0).
    run(&mut s, "arch.window", json!({ "wall": "Wall 1", "segment": "l2", "position": 1500 }));
    close(measure(&mut s, "Wall 1").0, ROOM - 900.0 * 2100.0 * 250.0 - 1200.0 * 1400.0 * 250.0);
    let (v, min, max) = measure(&mut s, "Window 1 frame");
    close(v, (1200.0 * 1400.0 - 1060.0 * 1260.0) * 100.0);
    close(min[1], 1500.0);
    close(max[1], 2700.0);
    close(min[2], 900.0);
    close(max[2], 2300.0);
    close(measure(&mut s, "Window 1 sash").0, (1060.0 * 1260.0 - 940.0 * 1140.0) * 80.0);
    close(measure(&mut s, "Window 1 glass").0, 940.0 * 1140.0 * 24.0);

    let list = run(&mut s, "arch.list", json!({}));
    let names: Vec<&str> = list["elements"].as_array().unwrap().iter().map(|e| e["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["Door 1", "Wall 1", "Window 1"]);
    assert_eq!(list["elements"][0]["values"]["width"], "900 mm");
}

#[test]
fn a_door_opens_by_its_angle_to_the_side_asked() {
    let mut s = Session::default();
    room(&mut s);
    run(&mut s, "arch.door", json!({ "wall": "Wall 1", "segment": "l1", "position": 800, "angle": 90, "swing": "left" }));
    // Square to the wall, on its left (inside the room drawn anticlockwise): along +Y from the
    // hinge at x = 860, its volume unchanged.
    let (v, min, max) = measure(&mut s, "Door 1 leaf");
    close(v, 780.0 * 2030.0 * 40.0);
    close(min[0], 840.0);
    close(max[0], 880.0);
    close(min[1], 0.0);
    close(max[1], 780.0);
    // The other side, and the other jamb.
    run(&mut s, "arch.edit", json!({ "element": "Door 1", "swing": "right", "hinge": "end" }));
    let (_, min, max) = measure(&mut s, "Door 1 leaf");
    close(min[0], 1620.0);
    close(max[0], 1660.0);
    close(min[1], -780.0);
    close(max[1], 0.0);
    // Closed again through its parameter.
    run(&mut s, "arch.edit", json!({ "element": "Door 1", "angle": 0 }));
    let (_, min, max) = measure(&mut s, "Door 1 leaf");
    close(min[1], -20.0);
    close(max[1], 20.0);
}

#[test]
fn the_door_keeps_its_distance_from_the_lines_first_point_when_the_plan_changes() {
    let mut s = Session::default();
    room(&mut s);
    run(&mut s, "arch.door", json!({ "wall": "Wall 1", "segment": "l2", "position": 1000 }));
    let (_, min, _) = measure(&mut s, "Door 1 frame");
    close(min[1], 1000.0);
    // Move the room's corner (5000, 0) to (5000, -1000): the line now starts 1 m lower.
    run(&mut s, "sketch.edit", json!({ "sketch": "Wall 1 plan" }));
    run(&mut s, "sketch.move_point", json!({ "point": "l2.start", "to": [5000, -1000] }));
    run(&mut s, "sketch.finish", json!({}));
    let (_, min, max) = measure(&mut s, "Door 1 frame");
    close(min[1], 0.0);
    close(max[1], 900.0);
    // And its parameters drive it: wider, the frame grows.
    run(&mut s, "arch.edit", json!({ "element": "Door 1", "width": "1000 mm" }));
    let (_, _, max) = measure(&mut s, "Door 1 frame");
    close(max[1], 1000.0);
    run(&mut s, "arch.edit", json!({ "element": "Wall 1", "height": "3000 mm", "thickness": 300 }));
    close(measure(&mut s, "Wall 1").2[2], 3000.0);
}

#[test]
fn every_type_builds_and_a_new_type_rebuilds_in_place() {
    let mut s = Session::default();
    room(&mut s);
    for (cmd, kind, segment, position) in [
        ("arch.door", "double", "l1", 300),
        ("arch.door", "sliding", "l3", 300),
        ("arch.door", "opening", "l4", 300),
        ("arch.window", "fixed", "l2", 300),
        ("arch.window", "double", "l2", 2600),
        ("arch.window", "sliding", "l3", 2500),
    ] {
        let mut p = json!({ "wall": "Wall 1", "segment": segment, "type": kind, "position": position });
        // Only the types that move take the motion they need.
        if kind == "sliding" {
            p["open"] = json!(0.5);
        } else if kind == "double" {
            p["angle"] = json!(30);
        }
        let r = run(&mut s, cmd, p);
        assert!(r["group"].as_u64().is_some(), "{kind}: {r}");
    }
    let all = bodies(&mut s);
    for b in ["Door 1 leaf 1", "Door 1 leaf 2", "Door 2 leaf", "Window 1 glass", "Window 2 sash 1", "Window 2 sash 2", "Window 3 glass 2"] {
        assert!(all.iter().any(|x| x == b), "{b} in {all:?}");
    }
    assert!(!all.iter().any(|x| x.starts_with("Door 3 ")), "an opening has no frame: {all:?}");
    // A single door becomes a double one: rebuilt with the same name and parameters.
    run(&mut s, "arch.door", json!({ "wall": "Wall 1", "segment": "l4", "position": 2000, "angle": 15, "name": "Front" }));
    run(&mut s, "arch.edit", json!({ "element": "Front", "type": "double" }));
    let all = bodies(&mut s);
    assert!(all.iter().any(|x| x == "Front leaf 2") && !all.iter().any(|x| x == "Front leaf"), "{all:?}");
    assert_eq!(s.doc.params.iter().filter(|p| p.name == "Front_angle").count(), 1);
}

#[test]
fn deleting_a_wall_takes_its_doors_and_windows_and_parameters() {
    let mut s = Session::default();
    room(&mut s);
    run(&mut s, "arch.door", json!({ "wall": "Wall 1" }));
    run(&mut s, "arch.window", json!({ "wall": "Wall 1", "segment": "l3" }));
    let r = run(&mut s, "arch.delete", json!({ "element": "Wall 1" }));
    assert_eq!(r["deleted"].as_array().map(Vec::len), Some(3));
    assert!(bodies(&mut s).is_empty());
    assert!(s.doc.params.iter().all(|p| !p.name.starts_with("Wall1_") && !p.name.starts_with("Door1_")));
    assert_eq!(run(&mut s, "arch.list", json!({}))["elements"], json!([]));
}

#[test]
fn one_command_is_one_undo_step_and_a_refusal_changes_nothing() {
    let mut s = Session::default();
    room(&mut s);
    run(&mut s, "arch.door", json!({ "wall": "Wall 1" }));
    run(&mut s, "edit.undo", json!({}));
    assert_eq!(bodies(&mut s), ["Wall 1"]);
    close(measure(&mut s, "Wall 1").0, ROOM);
    let before = s.doc.clone();
    for (cmd, p) in [
        ("arch.door", json!({ "wall": "Nope" })),
        ("arch.door", json!({ "wall": "Wall 1", "segment": "l9" })),
        ("arch.door", json!({ "wall": "Wall 1", "type": "revolving" })),
        ("arch.window", json!({ "wall": "Wall 1", "hinge": "middle" })),
        ("arch.door", json!({ "wall": "Wall 1", "width": "wide" })),
        ("arch.wall", json!({ "points": [[0, 0]] })),
        ("arch.wall", json!({ "points": [[0, 0], [1, 1]], "sketch": "Wall 1 plan" })),
        ("arch.wall", json!({ "points": [[0, 0], [1000, 0]], "name": "Wall 1" })),
        ("arch.edit", json!({ "element": "Wall 1", "angle": 30 })),
        ("arch.delete", json!({ "element": "Nothing" })),
    ] {
        assert!(s.execute(cmd, &p).is_err(), "{cmd} {p}");
        assert!(std::sync::Arc::ptr_eq(&s.doc, &before), "{cmd} {p} changed the design");
    }
}

#[test]
fn a_door_made_from_its_dialog_keeps_its_construction_hidden() {
    // A dialog's OK computes on a scratch copy and accepts the result: the planes and axes the
    // door builds on stay hidden as they do when the command runs directly, and Undo shows the
    // view as it was.
    let mut s = Session::default();
    room(&mut s);
    let door = vec![("arch.door".to_string(), json!({ "wall": "Wall 1", "segment": "l1", "position": 800, "angle": 30 }))];
    let prepared = s.scratch().compute_commands(&door, None).unwrap();
    s.accept_commands(prepared).unwrap();
    for name in ["Door 1 plane", "Door 1 leaf plane", "Door 1 hinge"] {
        assert!(s.visibility.hidden_origin.iter().any(|n| n == name), "{name} hidden: {:?}", s.visibility.hidden_origin);
    }
    run(&mut s, "edit.undo", json!({}));
    assert!(!s.visibility.hidden_origin.iter().any(|n| n.starts_with("Door 1")), "{:?}", s.visibility.hidden_origin);
}

#[test]
fn walls_follow_a_plan_drawn_by_hand_and_stand_on_their_level() {
    let mut s = Session::default();
    run(&mut s, "arch.level", json!({ "elevation": "3 m" }));
    run(&mut s, "sketch.create", json!({ "plane": "Level 1", "name": "Upstairs" }));
    run(&mut s, "sketch.line", json!({ "points": [[0, 0], [3000, 0], [3000, 2000]] }));
    run(&mut s, "sketch.finish", json!({}));
    run(&mut s, "arch.wall", json!({ "sketch": "Upstairs", "level": "Level 1", "thickness": 200, "height": "2500 mm" }));
    let (v, min, max) = measure(&mut s, "Wall 1");
    // Two lines meeting in a mitred corner: 3100 + 2000 along the outside, less the 100 square
    // the inside misses; 200 thick, 2500 high, from z = 3000.
    close(v, ((3100.0 + 2100.0) * 100.0 + (2900.0 + 1900.0) * 100.0) * 2500.0);
    close(min[2], 3000.0);
    close(max[2], 5500.0);
    run(&mut s, "arch.window", json!({ "wall": "Wall 1", "segment": "l1", "position": 500 }));
    let (_, min, _) = measure(&mut s, "Window 1 frame");
    close(min[2], 3900.0);
}

#[test]
fn a_wall_lies_inside_outside_or_centred_on_its_line_and_its_openings_follow() {
    let mut s = Session::default();
    // Inside: the drawn 5 × 4 m outline is the walls' outer face.
    let r = run(&mut s, "arch.wall", json!({ "points": [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], "closed": true, "align": "inside" }));
    assert_eq!(r["parameters"]["align"], "Wall1_align");
    let (v, min, max) = measure(&mut s, "Wall 1");
    close(v, (5000.0 * 4000.0 - 4500.0 * 3500.0) * 2700.0);
    close(min[0], 0.0);
    close(max[0], 5000.0);
    close(min[1], 0.0);
    close(max[1], 4000.0);
    run(&mut s, "arch.door", json!({ "wall": "Wall 1", "segment": "l1", "position": 800 }));
    run(&mut s, "arch.window", json!({ "wall": "Wall 1", "segment": "l2", "position": 1500 }));
    let openings = 900.0 * 2100.0 * 250.0 + 1200.0 * 1400.0 * 250.0;
    close(measure(&mut s, "Wall 1").0, (5000.0 * 4000.0 - 4500.0 * 3500.0) * 2700.0 - openings);
    // Each sits in the middle of its wall: l1's runs y 0…250, l2's (up x = 5000) x 4750…5000.
    let middle = |s: &mut Session, body: &str, axis: usize, at: f64, half: f64| {
        let (_, min, max) = measure(s, body);
        close(min[axis], at - half);
        close(max[axis], at + half);
    };
    middle(&mut s, "Door 1 frame", 1, 125.0, 50.0);
    middle(&mut s, "Door 1 leaf", 1, 125.0, 20.0);
    middle(&mut s, "Window 1 frame", 0, 4875.0, 50.0);

    // Outside: the outline is the room's inner face; the door and window move with the wall.
    run(&mut s, "arch.edit", json!({ "element": "Wall 1", "align": "outside" }));
    let (v, min, max) = measure(&mut s, "Wall 1");
    close(v, (5500.0 * 4500.0 - 5000.0 * 4000.0) * 2700.0 - openings);
    close(min[0], -250.0);
    close(max[1], 4250.0);
    middle(&mut s, "Door 1 frame", 1, -125.0, 50.0);
    middle(&mut s, "Window 1 frame", 0, 5125.0, 50.0);

    // A number between: three quarters of the 250 inside, a quarter outside.
    run(&mut s, "arch.edit", json!({ "element": "Wall 1", "align": 0.5 }));
    let (_, min, _) = measure(&mut s, "Wall 1");
    close(min[0], -62.5);
    middle(&mut s, "Door 1 frame", 1, 62.5, 50.0);

    // Centred, and a thicker wall keeps everything in its middle.
    run(&mut s, "arch.edit", json!({ "element": "Wall 1", "align": "center", "thickness": 300 }));
    let (_, min, _) = measure(&mut s, "Wall 1");
    close(min[0], -150.0);
    middle(&mut s, "Door 1 frame", 1, 0.0, 50.0);
    let list = run(&mut s, "arch.list", json!({}));
    let wall = list["elements"].as_array().and_then(|a| a.iter().find(|e| e["name"] == "Wall 1")).cloned().unwrap_or_default();
    assert_eq!(wall["align"], "center");
    assert_eq!(wall["values"]["align"], "0");
}

#[test]
fn left_and_right_follow_the_wall_as_drawn_and_a_reversed_corner_keeps_its_doors_in_the_wall() {
    let mut s = Session::default();
    let span = |s: &mut Session, body: &str| {
        let (_, min, max) = measure(s, body);
        (min, max)
    };
    // Straight walls: left and right of the way they were drawn.
    run(&mut s, "arch.wall", json!({ "points": [[0, 0], [4000, 0]], "align": "left" }));
    let (min, max) = span(&mut s, "Wall 1");
    close(min[1], 0.0);
    close(max[1], 250.0);
    run(&mut s, "arch.wall", json!({ "points": [[0, 1000], [4000, 1000]], "align": "right" }));
    let (min, max) = span(&mut s, "Wall 2");
    close(min[1], 750.0);
    close(max[1], 1000.0);
    run(&mut s, "arch.wall", json!({ "points": [[4000, 2000], [0, 2000]], "align": "left" }));
    let (min, max) = span(&mut s, "Wall 3");
    close(min[1], 1750.0);
    close(max[1], 2000.0);

    // A corner drawn turning right: its chain runs the other way, so `left` of its first line
    // is its outside. The wall wraps the corner on the outer side.
    run(&mut s, "arch.wall", json!({ "points": [[13000, 2000], [13000, 0], [10000, 0]], "align": "left", "thickness": 200 }));
    let (min, max) = span(&mut s, "Wall 4");
    close(min[0], 10000.0);
    close(max[0], 13200.0);
    close(min[1], -200.0);
    close(max[1], 2000.0);
    // A door in its first line (x = 13000, drawn downwards) sits in the wall's middle, x 13100.
    run(&mut s, "arch.door", json!({ "wall": "Wall 4", "segment": "l1", "position": 500 }));
    let (min, max) = span(&mut s, "Door 1 frame");
    close(min[0], 13050.0);
    close(max[0], 13150.0);
    // And one in its second line (y = 0, drawn towards -x), y -100.
    run(&mut s, "arch.window", json!({ "wall": "Wall 4", "segment": "l2", "position": 500 }));
    let (min, max) = span(&mut s, "Window 1 frame");
    close(min[1], -150.0);
    close(max[1], -50.0);
    assert!(s.execute("arch.wall", &json!({ "points": [[0, 0], [1, 0]], "align": "diagonal" })).is_err());
    assert!(s.execute("arch.wall", &json!({ "points": [[0, 0], [1, 0]], "align": 2 })).is_err());
    assert!(s.execute("arch.edit", &json!({ "element": "Door 1", "align": "inside" })).is_err());
}

#[test]
fn a_wall_made_before_alignment_takes_it_and_rebuilds_its_openings_in_its_middle() {
    let mut s = Session::default();
    room(&mut s);
    // What a wall from before alignment was: centred on its lines, no `align` parameter or
    // record, and doors drawn on the line's plane.
    run(&mut s, "timeline.edit", json!({ "feature": "Wall 1", "set": { "thin.side": "center", "thin.thickness": "Wall1_thickness", "thin.thickness2": "Wall1_thickness" } }));
    let list = run(&mut s, "arch.list", json!({}));
    let mut record = list["elements"][0].clone();
    if let Some(m) = record.as_object_mut() {
        m.remove("values");
        m.remove("align");
    }
    if let Some(m) = record["params"].as_object_mut() {
        m.remove("align");
    }
    run(&mut s, "document.metadata.set", json!({ "key": "ro.artea.forma.arch.Wall1", "value": record }));
    run(&mut s, "parameters.delete", json!({ "name": "Wall1_align" }));
    close(measure(&mut s, "Wall 1").0, ROOM);
    run(&mut s, "arch.door", json!({ "wall": "Wall 1", "segment": "l1", "position": 800, "width": 1000 }));
    assert!(!s.doc.features.iter().any(|f| f.name == "Door 1 centre"));

    run(&mut s, "arch.edit", json!({ "element": "Wall 1", "align": "inside" }));
    let (_, min, max) = measure(&mut s, "Wall 1");
    close(min[1], 0.0);
    close(max[0], 5000.0);
    // The door was rebuilt on the wall's middle, keeping its own numbers.
    assert!(s.doc.features.iter().any(|f| f.name == "Door 1 centre"));
    let (_, min, max) = measure(&mut s, "Door 1 frame");
    close(min[1], 75.0);
    close(max[1], 175.0);
    close(max[0] - min[0], 1000.0);
    // And from now on alignment is a parameter.
    run(&mut s, "arch.edit", json!({ "element": "Wall 1", "align": "outside" }));
    let (_, min, _) = measure(&mut s, "Door 1 frame");
    close(min[1], -175.0);
}

#[test]
fn slabs_reach_the_walls_inner_or_outer_face_or_the_line_at_the_base_or_on_top() {
    let mut s = Session::default();
    room(&mut s);
    let check = |s: &mut Session, body: &str, v: f64, x: [f64; 2], z: [f64; 2]| {
        let (vol, min, max) = measure(s, body);
        close(vol, v);
        close(min[0], x[0]);
        close(max[0], x[1]);
        close(min[2], z[0]);
        close(max[2], z[1]);
    };
    // A floor: its top at the level, reaching the walls' inner faces.
    let r = run(&mut s, "arch.slab", json!({ "wall": "Wall 1" }));
    assert_eq!(r["element"], "Slab 1");
    check(&mut s, "Slab 1", 4750.0 * 3750.0 * 200.0, [125.0, 4875.0], [-200.0, 0.0]);
    // On top of the walls, covering them to their outer faces.
    run(&mut s, "arch.slab", json!({ "wall": "Wall 1", "at": "top" }));
    check(&mut s, "Slab 2", 5250.0 * 4250.0 * 200.0, [-125.0, 5125.0], [2700.0, 2900.0]);
    // To the plan line, 150 thick, its top 50 below the level.
    run(&mut s, "arch.slab", json!({ "wall": "Wall 1", "extent": "line", "thickness": 150, "top": "-50 mm", "name": "Screed" }));
    check(&mut s, "Screed", 5000.0 * 4000.0 * 150.0, [0.0, 5000.0], [-200.0, -50.0]);

    // They follow the wall: thicker, and taller.
    run(&mut s, "arch.edit", json!({ "element": "Wall 1", "thickness": 300, "height": "3000 mm" }));
    check(&mut s, "Slab 1", 4700.0 * 3700.0 * 200.0, [150.0, 4850.0], [-200.0, 0.0]);
    check(&mut s, "Slab 2", 5300.0 * 4300.0 * 200.0, [-150.0, 5150.0], [3000.0, 3200.0]);
    // A new extent rebuilds it in place; `at` moves its top.
    run(&mut s, "arch.edit", json!({ "element": "Slab 2", "extent": "inside", "thickness": 100 }));
    check(&mut s, "Slab 2", 4700.0 * 3700.0 * 100.0, [150.0, 4850.0], [3000.0, 3100.0]);
    run(&mut s, "arch.edit", json!({ "element": "Slab 1", "at": "top" }));
    check(&mut s, "Slab 1", 4700.0 * 3700.0 * 200.0, [150.0, 4850.0], [3000.0, 3200.0]);

    // An outline of its own.
    run(&mut s, "arch.slab", json!({ "points": [[10000, 0], [11000, 0], [11000, 500]] }));
    check(&mut s, "Slab 3", 1000.0 * 500.0 / 2.0 * 200.0, [10000.0, 11000.0], [-200.0, 0.0]);
    assert!(s.execute("arch.slab", &json!({ "points": [[0, 0], [1, 0], [1, 1]], "extent": "inside" })).is_err());
    assert!(s.execute("arch.slab", &json!({ "points": [[0, 0], [1, 0], [1, 1]], "at": "top" })).is_err());
    assert!(s.execute("arch.edit", &json!({ "element": "Wall 1", "extent": "inside" })).is_err());

    // Deleting the wall takes its slabs; the outline's own stays.
    run(&mut s, "arch.delete", json!({ "element": "Wall 1" }));
    assert_eq!(bodies(&mut s), ["Slab 3"]);
}

#[test]
fn roofs_flat_shed_gable_and_hip_stand_on_the_wall_and_follow_their_parameters() {
    let mut s = Session::default();
    room(&mut s);
    // With a 300 overhang past the 125 outer half of the wall: 5850 × 4850, from the wall's top.
    run(&mut s, "arch.roof", json!({ "wall": "Wall 1", "type": "flat", "name": "Flat" }));
    let (v, min, max) = measure(&mut s, "Flat");
    close(v, 5850.0 * 4850.0 * 200.0);
    close(min[0], -425.0);
    close(max[1], 4425.0);
    close(min[2], 2700.0);
    close(max[2], 2900.0);
    run(&mut s, "arch.delete", json!({ "element": "Flat" }));

    // A gable on the two long lines, 30°: a prism of the triangle 4850 wide.
    let r = run(&mut s, "arch.roof", json!({ "wall": "Wall 1" }));
    assert_eq!(r["parameters"]["pitch"], "Roof1_pitch");
    let gable = |w: f64, l: f64, deg: f64| {
        let h = w / 2.0 * deg.to_radians().tan();
        (w * h / 2.0 * l, h)
    };
    let (vol, h) = gable(4850.0, 5850.0, 30.0);
    let (v, min, max) = measure(&mut s, "Roof 1");
    close(v, vol);
    close(min[0], -425.0);
    close(max[0], 5425.0);
    close(min[1], -425.0);
    close(max[1], 4425.0);
    close(min[2], 2700.0);
    close(max[2], 2700.0 + h);

    // Its parameters: steeper, then no overhang.
    run(&mut s, "arch.edit", json!({ "element": "Roof 1", "pitch": "45 deg" }));
    close(measure(&mut s, "Roof 1").0, gable(4850.0, 5850.0, 45.0).0);
    run(&mut s, "arch.edit", json!({ "element": "Roof 1", "overhang": 0 }));
    let (vol, h) = gable(4250.0, 5250.0, 45.0);
    let (v, _, max) = measure(&mut s, "Roof 1");
    close(v, vol);
    close(max[2], 2700.0 + h);

    // A hip: the gable less a pyramid at each end.
    run(&mut s, "arch.edit", json!({ "element": "Roof 1", "type": "hip" }));
    let (w, l) = (4250.0, 5250.0);
    let h = w / 2.0;
    let (v, _, max) = measure(&mut s, "Roof 1");
    close(v, w * h / 2.0 * (l - w / 3.0));
    close(max[2], 2700.0 + h);

    // A shed rising from the first line across the whole width.
    run(&mut s, "arch.edit", json!({ "element": "Roof 1", "type": "shed", "eaves": ["l1"] }));
    let (v, min, max) = measure(&mut s, "Roof 1");
    close(v, w * w / 2.0 * l);
    close(min[2], 2700.0);
    close(max[2], 2700.0 + w);

    // Hollow: a shell open underneath, the same outside.
    run(&mut s, "arch.edit", json!({ "element": "Roof 1", "type": "gable", "hollow": true }));
    let (v, min, max) = measure(&mut s, "Roof 1");
    let (solid, h) = gable(4250.0, 5250.0, 45.0);
    assert!(v > 0.0 && v < solid * 0.6, "{v} of {solid}");
    close(min[2], 2700.0);
    // Its slopes stand 200 higher, square to them, leaving a fascia at the eaves.
    close(max[2], 2700.0 + h + 200.0 / 45f64.to_radians().cos());

    // A roof follows the wall's height.
    run(&mut s, "arch.edit", json!({ "element": "Wall 1", "height": "3000 mm" }));
    let (_, min, _) = measure(&mut s, "Roof 1");
    close(min[2], 3000.0);

    // A hip needs every line's slope to keep the rest of the plan: not on an L.
    run(&mut s, "arch.wall", json!({ "points": [[10000, 0], [14000, 0], [14000, 2000], [12000, 2000], [12000, 4000], [10000, 4000]], "closed": true }));
    assert!(s.execute("arch.roof", &json!({ "wall": "Wall 2", "type": "hip" })).is_err());
    run(&mut s, "arch.roof", json!({ "wall": "Wall 2", "type": "flat" }));
    assert!(s.execute("arch.roof", &json!({ "wall": "Wall 1", "type": "dome" })).is_err());
    assert!(s.execute("arch.roof", &json!({ "wall": "Wall 1", "eaves": ["l9"] })).is_err());
}

/// A house: the room with a door left open, a window, a floor and a gable roof, and a storey
/// above on its own level.
fn house(s: &mut Session) {
    room(s);
    run(s, "arch.door", json!({ "wall": "Wall 1", "segment": "l1", "position": 800, "angle": "60 deg" }));
    run(s, "arch.window", json!({ "wall": "Wall 1", "segment": "l2", "position": 1500 }));
    run(s, "arch.slab", json!({ "wall": "Wall 1" }));
    run(s, "arch.level", json!({ "elevation": "2700 mm" }));
    run(s, "arch.wall", json!({ "points": [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], "closed": true, "level": "Level 1", "name": "Upstairs" }));
    run(s, "arch.roof", json!({ "wall": "Upstairs" }));
}

#[test]
fn a_scale_model_is_thickened_split_by_level_and_roof_and_leaves_the_design_alone() {
    let mut s = Session::default();
    house(&mut s);
    let before = s.doc.clone();
    let r = run(&mut s, "arch.maquette", json!({ "scale": 100 }));
    // At 1:100 a 0.8 mm wall is 80 mm: frames, the leaf, the sash and the glass thicken; the
    // 250 mm walls and 200 mm slab do not; the handle is too small and stays out.
    let thick: Vec<&str> = r["thickened"].as_array().map(|a| a.iter().filter_map(|t| t["parameter"].as_str()).collect()).unwrap_or_default();
    for p in ["Door1_frame", "Door1_leaf", "Window1_frame", "Window1_leaf", "Window1_glass"] {
        assert!(thick.contains(&p), "{p} in {thick:?}");
    }
    assert!(!thick.iter().any(|p| p.starts_with("Wall1") || p.starts_with("Slab1")), "{thick:?}");
    assert!(r["omitted"].as_array().is_some_and(|a| a.iter().any(|b| b == "Door 1 handle")), "{}", r["omitted"]);
    // Pieces: the ground floor, the storey above, and the roof to lift off.
    let piece = |name: &str| r["pieces"].as_array().and_then(|a| a.iter().find(|p| p["name"] == name)).cloned().unwrap_or_default();
    let ground = piece("Ground");
    let slot = |piece: &Value, body: &str| piece["parts"].as_array().and_then(|a| a.iter().find(|p| p[0] == body)).map(|p| p[1].clone());
    assert_eq!(slot(&ground, "Wall 1"), Some(json!(1)));
    assert_eq!(slot(&ground, "Slab 1"), Some(json!(1)));
    assert_eq!(slot(&ground, "Door 1 frame"), Some(json!(2)));
    assert_eq!(slot(&ground, "Door 1 leaf"), Some(json!(2)));
    assert_eq!(slot(&ground, "Window 1 glass"), Some(json!(3)));
    // 5250 × 4250, from the slab's underside (-200) to the wall's top (2700): 1:100.
    let size: Vec<f64> = ground["size"].as_array().map(|a| a.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
    assert_eq!(size, [52.5, 42.5, 29.0]);
    assert_eq!(slot(&piece("Level 1"), "Upstairs"), Some(json!(1)));
    assert_eq!(slot(&piece("Roof 1"), "Roof 1"), Some(json!(4)));
    assert_eq!(r["plates"], 1);
    assert_eq!(r["cuts"], 0);
    // The design is as it was: its door still open, its frames as drawn.
    assert!(std::sync::Arc::ptr_eq(&s.doc, &before));

    // Written: a slicer object per piece (its parts are components of it).
    let path = std::env::temp_dir().join(format!("forma-maquette-{}.3mf", std::process::id()));
    let path_s = path.to_string_lossy().to_string();
    let r = run(&mut s, "arch.maquette", json!({ "scale": 100, "path": path_s, "slots": { "glass": 5 } }));
    assert!(r["bytes"].as_u64().is_some_and(|b| b > 1000), "{r}");
    let bytes = std::fs::read(&path).unwrap_or_default();
    let (objects, _) = solidcraft_io::read_3mf(&bytes).unwrap_or_default();
    assert_eq!(objects.len(), 3, "{:?}", objects.iter().map(|o| &o.name).collect::<Vec<_>>());
    let _ = std::fs::remove_file(&path);

    // One piece for the whole building when asked.
    let r = run(&mut s, "arch.maquette", json!({ "scale": 100, "levels": false, "roof": false }));
    assert_eq!(r["pieces"].as_array().map(Vec::len), Some(1), "{}", r["pieces"]);
    assert!(s.execute("arch.maquette", &json!({ "scale": 0 })).is_err());
    assert!(s.execute("arch.maquette", &json!({ "plate": [10, 10] })).is_err());
}

#[test]
fn a_scale_model_larger_than_the_plate_is_cut_into_pieces_that_fit_with_pin_holes() {
    let mut s = Session::default();
    room(&mut s);
    // At 1:50 the room is 105 × 85 mm; a 100 × 70 plate (90 × 60 to use) takes it in 2 × 2.
    let r = run(&mut s, "arch.maquette", json!({ "scale": 50, "plate": [100, 70] }));
    assert_eq!(r["cuts"], 2, "{r}");
    let names: Vec<&str> = r["pieces"].as_array().map(|a| a.iter().filter_map(|p| p["name"].as_str()).collect()).unwrap_or_default();
    for n in ["Ground 1-1", "Ground 2-1", "Ground 1-2", "Ground 2-2"] {
        assert!(names.contains(&n), "{n} in {names:?}");
    }
    for p in r["pieces"].as_array().into_iter().flatten() {
        let size: Vec<f64> = p["size"].as_array().map(|a| a.iter().filter_map(Value::as_f64).collect()).unwrap_or_default();
        assert!(size[0] <= 90.0 && size[1] <= 60.0, "{p}");
    }
    // 250 mm walls are 5 mm at 1:50: room for a 1.9 mm hole each side of a pin; two pins in each
    // wall each cut crosses.
    assert_eq!(r["pins"], 8, "{r}");
    // At 1:100 they are 2.5 mm: no pins.
    let r = run(&mut s, "arch.maquette", json!({ "scale": 100, "plate": [50, 50] }));
    assert_eq!(r["pins"], 0, "{r}");
}

#[test]
fn hostile_architecture_params_never_panic() {
    let mut s = Session::default();
    room(&mut s);
    let values = [json!(null), json!(-1), json!(1e300), json!("x".repeat(5000)), json!([]), json!({}), json!("Wall 1"), json!("1 / 0")];
    for cmd in ["arch.wall", "arch.door", "arch.window", "arch.edit", "arch.delete", "arch.level", "arch.slab", "arch.roof"] {
        for key in ["wall", "points", "sketch", "position", "width", "type", "angle", "element", "name", "segment", "elevation", "align", "eaves", "pitch", "extent", "at", "top"] {
            for v in &values {
                let _ = s.execute(cmd, &json!({ key: v }));
                let _ = s.execute(cmd, &json!({ "wall": "Wall 1", key: v }));
            }
        }
    }
}
