//! Forma: typed contracts for the architecture commands (`arch.*`): walls, doors, windows and
//! levels, built from the engine's own features (see `cmd/arch.rs`).

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::types::{AngleExpr, LengthExpr, NumberExpr, present};

/// A point of a wall's line in plan: `[x, y]`, each a number in the design's length unit or an
/// expression such as `"Room_w + 250 mm"`.
#[derive(Debug, Deserialize, JsonSchema)]
pub struct PlanPoint(pub [LengthExpr; 2]);

/// Where a wall lies against its plan line.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum WallAlign {
    /// `center` (the default), `inside` (the whole thickness on the plan's inner side: a closed
    /// plan's enclosed area, an open one's the side it bends toward, a straight one's left; the
    /// line is the wall's outer face), `outside` (the line is the inner face: a room keeps its
    /// drawn size inside), `left` or `right` (of the wall's first line, looking along it as
    /// drawn).
    Named(String),
    /// A fraction from -1 (all outside) through 0 (centred) to 1 (all inside).
    Fraction(f64),
}

/// Raise a wall along a line in plan.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct WallParams {
    /// The wall's line in plan, at least two points (at most 200). Give these, or `sketch`.
    #[serde(default, deserialize_with = "present")]
    pub points: Option<Vec<PlanPoint>>,
    /// Close the line back to its first point: a room.
    #[serde(default)]
    pub closed: bool,
    /// Instead of `points`: a plan sketch already drawn, whose lines and arcs the wall follows.
    #[serde(default, deserialize_with = "present")]
    pub sketch: Option<String>,
    /// With `sketch`: which of its curves (default: all that are not construction geometry).
    #[serde(default, deserialize_with = "present")]
    pub curves: Option<Vec<String>>,
    /// The wall's height (default 2700 mm).
    #[serde(default, deserialize_with = "present")]
    pub height: Option<LengthExpr>,
    /// The wall's thickness (default 250 mm).
    #[serde(default, deserialize_with = "present")]
    pub thickness: Option<LengthExpr>,
    /// Where the wall lies against its line (default `center`).
    #[serde(default, deserialize_with = "present")]
    pub align: Option<WallAlign>,
    /// The plane the plan is drawn on: a level made by `arch.level`, or XY (the default).
    #[serde(default, deserialize_with = "present")]
    pub level: Option<String>,
    /// The wall's name (default `Wall N`); its parameters are named after it.
    #[serde(default, deserialize_with = "present")]
    pub name: Option<String>,
}

/// Put a door or a window in a wall, or rebuild one (`replace`).
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct OpeningParams {
    /// The wall's name (an `arch.wall` element).
    pub wall: String,
    /// Which straight line of the wall's plan it goes in: a curve id such as `l2` (default: the
    /// wall's first).
    #[serde(default, deserialize_with = "present")]
    pub segment: Option<String>,
    /// A door: `single`, `double`, `sliding` or `opening` (the opening alone). A window:
    /// `fixed`, `casement`, `double` or `sliding`.
    #[serde(default, rename = "type", deserialize_with = "present")]
    pub kind: Option<String>,
    /// From the line's first point to the opening's near edge.
    #[serde(default, deserialize_with = "present")]
    pub position: Option<LengthExpr>,
    #[serde(default, deserialize_with = "present")]
    pub width: Option<LengthExpr>,
    #[serde(default, deserialize_with = "present")]
    pub height: Option<LengthExpr>,
    /// Height of the opening's bottom above the wall's base (a door's is 0).
    #[serde(default, deserialize_with = "present")]
    pub sill: Option<LengthExpr>,
    /// Which jamb the leaf or sash turns on: `start` (towards the line's first point) or `end`.
    #[serde(default, deserialize_with = "present")]
    pub hinge: Option<String>,
    /// Which side of the wall it opens or slides to, looking along the line from its first
    /// point: `left` or `right`.
    #[serde(default, deserialize_with = "present")]
    pub swing: Option<String>,
    /// How far a hinged leaf or sash stands open (0 = closed).
    #[serde(default, deserialize_with = "present")]
    pub angle: Option<AngleExpr>,
    /// How far a sliding leaf or sash stands open, 0 (closed) to 1.
    #[serde(default, deserialize_with = "present")]
    pub open: Option<NumberExpr>,
    /// The frame's face width.
    #[serde(default, deserialize_with = "present")]
    pub frame: Option<LengthExpr>,
    /// The frame's depth through the wall.
    #[serde(default, deserialize_with = "present")]
    pub depth: Option<LengthExpr>,
    /// A door leaf's thickness, or a window sash's face width.
    #[serde(default, deserialize_with = "present")]
    pub leaf: Option<LengthExpr>,
    /// The element's name (default `Door N` or `Window N`); its parameters are named after it.
    #[serde(default, deserialize_with = "present")]
    pub name: Option<String>,
}

/// Lay a floor or ceiling slab: over a wall's plan, or an outline of its own.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct SlabParams {
    /// The wall whose plan it covers (a closed plan). Give this, `points` or `sketch`.
    #[serde(default, deserialize_with = "present")]
    pub wall: Option<String>,
    /// An outline of its own in plan, at least three points, closed.
    #[serde(default, deserialize_with = "present")]
    pub points: Option<Vec<PlanPoint>>,
    /// A plan sketch already drawn, with a closed outline.
    #[serde(default, deserialize_with = "present")]
    pub sketch: Option<String>,
    /// With `sketch`: the curves of its outline (default: all that are not construction).
    #[serde(default, deserialize_with = "present")]
    pub curves: Option<Vec<String>>,
    /// `base` (the default: its top at the level, a floor) or `top` (on top of the wall: a
    /// ceiling or flat roof). Only with `wall`.
    #[serde(default, deserialize_with = "present")]
    pub at: Option<String>,
    /// How far it reaches against the wall: `inside` (to the wall's inner face, the default at the
    /// base), `outside` (to its outer face, the default on top) or `line` (to the plan line).
    #[serde(default, deserialize_with = "present")]
    pub extent: Option<String>,
    /// The slab's thickness (default 200 mm).
    #[serde(default, deserialize_with = "present")]
    pub thickness: Option<LengthExpr>,
    /// The height of its top face above its level (default from `at`: 0, or the wall's height
    /// plus the slab's thickness).
    #[serde(default, deserialize_with = "present")]
    pub top: Option<LengthExpr>,
    /// Without `wall`: the plane its outline is drawn on (XY).
    #[serde(default, deserialize_with = "present")]
    pub level: Option<String>,
    /// The slab's name (default `Slab N`); its parameters are named after it.
    #[serde(default, deserialize_with = "present")]
    pub name: Option<String>,
}

/// Put a roof on a wall: flat, shed, gable or hip.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct RoofParams {
    /// The wall it covers (a closed plan of straight lines for a pitched roof).
    pub wall: String,
    /// `flat`, `shed` (one slope, rising from its eave), `gable` (two slopes from opposite
    /// eaves, the default) or `hip` (a slope from every line of a convex plan).
    #[serde(default, rename = "type", deserialize_with = "present")]
    pub kind: Option<String>,
    /// The slopes' pitch (default 30 deg, a shed's 15 deg).
    #[serde(default, deserialize_with = "present")]
    pub pitch: Option<AngleExpr>,
    /// How far the eaves reach past the wall's outer face (default 300 mm).
    #[serde(default, deserialize_with = "present")]
    pub overhang: Option<LengthExpr>,
    /// A flat roof's thickness, or a hollow pitched roof's (default 200 mm).
    #[serde(default, deserialize_with = "present")]
    pub thickness: Option<LengthExpr>,
    /// A pitched roof as a shell `thickness` thick, open underneath (default: solid, as a
    /// scale model prints best).
    #[serde(default)]
    pub hollow: bool,
    /// The plan lines the slopes rise from (default by type: a shed's longest line, a gable's
    /// two longest parallel ones, every line of a hip).
    #[serde(default, deserialize_with = "present")]
    pub eaves: Option<Vec<String>>,
    /// The roof's name (default `Roof N`); its parameters are named after it.
    #[serde(default, deserialize_with = "present")]
    pub name: Option<String>,
}

/// Change an element: its numbers change its parameters; a new type, hinge, swing, wall or
/// segment rebuilds it.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct ArchEditParams {
    /// The element's name.
    pub element: String,
    #[serde(default, deserialize_with = "present")]
    pub wall: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub segment: Option<String>,
    #[serde(default, rename = "type", deserialize_with = "present")]
    pub kind: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub position: Option<LengthExpr>,
    #[serde(default, deserialize_with = "present")]
    pub width: Option<LengthExpr>,
    #[serde(default, deserialize_with = "present")]
    pub height: Option<LengthExpr>,
    #[serde(default, deserialize_with = "present")]
    pub sill: Option<LengthExpr>,
    #[serde(default, deserialize_with = "present")]
    pub hinge: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub swing: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub angle: Option<AngleExpr>,
    #[serde(default, deserialize_with = "present")]
    pub open: Option<NumberExpr>,
    #[serde(default, deserialize_with = "present")]
    pub frame: Option<LengthExpr>,
    #[serde(default, deserialize_with = "present")]
    pub depth: Option<LengthExpr>,
    #[serde(default, deserialize_with = "present")]
    pub leaf: Option<LengthExpr>,
    #[serde(default, deserialize_with = "present")]
    pub thickness: Option<LengthExpr>,
    /// A wall: where it lies against its line; its doors and windows stay centred in it.
    #[serde(default, deserialize_with = "present")]
    pub align: Option<WallAlign>,
    /// A slab: its top face's height above its level.
    #[serde(default, deserialize_with = "present")]
    pub top: Option<LengthExpr>,
    /// A slab: `base` or `top` (its top face moves there).
    #[serde(default, deserialize_with = "present")]
    pub at: Option<String>,
    /// A slab: `inside`, `outside` or `line` (rebuilds it).
    #[serde(default, deserialize_with = "present")]
    pub extent: Option<String>,
    /// A roof's pitch.
    #[serde(default, deserialize_with = "present")]
    pub pitch: Option<AngleExpr>,
    /// A roof's overhang.
    #[serde(default, deserialize_with = "present")]
    pub overhang: Option<LengthExpr>,
    /// A pitched roof: hollow or solid (rebuilds it).
    #[serde(default, deserialize_with = "present")]
    pub hollow: Option<bool>,
    /// A roof's eaves (rebuilds it).
    #[serde(default, deserialize_with = "present")]
    pub eaves: Option<Vec<String>>,
    #[serde(default, deserialize_with = "present")]
    pub elevation: Option<LengthExpr>,
}

/// Remove an element and what it made (a wall takes its doors and windows with it).
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct ArchElementParams {
    /// The element's name.
    pub element: String,
}

/// List the design's architecture elements (takes nothing).
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct ArchListParams {}

/// Add a level: a plane parallel to XY at an elevation, to draw a storey's walls on.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(deny_unknown_fields)]
pub struct LevelParams {
    /// Height above XY (default 3000 mm).
    #[serde(default, deserialize_with = "present")]
    pub elevation: Option<LengthExpr>,
    /// The level's name (default `Level N`).
    #[serde(default, deserialize_with = "present")]
    pub name: Option<String>,
}

/// What an `arch.*` command made or changed.
#[derive(Debug, Serialize, JsonSchema)]
pub struct ArchElementMade {
    /// The element's name.
    pub element: String,
    /// `wall`, `door`, `window` or `level`.
    pub kind: String,
    /// Its parameters, by role (`height`, `width`, …): the design parameter's name.
    pub parameters: std::collections::BTreeMap<String, String>,
    /// The bodies it made.
    pub bodies: Vec<String>,
    /// Its timeline folder, when it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<u64>,
}

/// The elements `arch.delete` removed.
#[derive(Debug, Serialize, JsonSchema)]
pub struct ArchDeleted {
    pub deleted: Vec<String>,
}

/// The design's architecture elements.
#[derive(Debug, Serialize, JsonSchema)]
pub struct ArchList {
    /// Each element's record as saved (name, kind, type, wall, segment, …) with its
    /// parameters' current expressions under `values`.
    pub elements: Vec<serde_json::Value>,
}
