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

/// A 5 × 4 m room, its walls 250 mm thick and 2.7 m high, centred on their lines.
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
fn hostile_architecture_params_never_panic() {
    let mut s = Session::default();
    room(&mut s);
    let values = [json!(null), json!(-1), json!(1e300), json!("x".repeat(5000)), json!([]), json!({}), json!("Wall 1"), json!("1 / 0")];
    for cmd in ["arch.wall", "arch.door", "arch.window", "arch.edit", "arch.delete", "arch.level"] {
        for key in ["wall", "points", "sketch", "position", "width", "type", "angle", "element", "name", "segment", "elevation"] {
            for v in &values {
                let _ = s.execute(cmd, &json!({ key: v }));
                let _ = s.execute(cmd, &json!({ "wall": "Wall 1", key: v }));
            }
        }
    }
}
