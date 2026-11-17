//! The Browser panel: a tree of rows ([`crate::Row`], drawn by [`crate::tree_row`]) with what a
//! tree needs around them, so a host describes each row and reads back what happened to it.
//!
//! The panel keeps, per presentation ([`BrowserState`]): the anchor a Shift range starts from and
//! the order of the selectable rows, the slower second click that asks to rename a row, a drag
//! over the eyes, and (in the egui context, so one presentation can drop on another) the rows
//! being dragged. It knows nothing of what a row stands for: the host gives each a [`NodeId`],
//! says whether it is selectable, renamable, draggable and what it takes when something is
//! dropped on it, and gets [`Event`]s.
//!
//! Written for Forma. The row drawing is the kit's; the selection, rename timing and drag and
//! drop follow what SolidCraft's Browser did in its interface crate at its last MIT OR Apache-2.0
//! nightly (v0.40.0-nightly.20261110), gathered behind one API.

use std::any::Any;
use std::sync::Arc;

use egui::{Pos2, Rect, Stroke, pos2};
use solidcraft_theme::Tokens;

use crate::Row;

/// A row's identity: the same for the same thing every frame, unique within its tree.
pub type NodeId = u64;

/// Where rows are: the document they belong to (`scope`) and the presentation of its tree they
/// are drawn in (the Browser itself, a second view of it).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub struct Source {
    pub scope: u64,
    pub presentation: u64,
}

/// What the host attaches to rows being dragged: any value of its own, read back by type where
/// they are dropped.
#[derive(Clone)]
pub struct Payload(Arc<dyn Any + Send + Sync>);

impl Payload {
    pub fn new<T: Any + Send + Sync>(value: T) -> Self {
        Self(Arc::new(value))
    }

    /// The value, when it is a `T`.
    pub fn get<T: Any>(&self) -> Option<&T> {
        self.0.downcast_ref()
    }
}

impl PartialEq for Payload {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}

impl std::fmt::Debug for Payload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Payload(..)")
    }
}

/// The rows being dragged: where from, the kind their row gave ([`Node::drag`]), which rows, and
/// the host's payload.
#[derive(Clone, Debug, PartialEq)]
pub struct Dragged {
    pub source: Source,
    pub kind: Option<u32>,
    pub nodes: Vec<NodeId>,
    pub data: Option<Payload>,
}

/// Where on a row a drop lands: before it (its top part) or into it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Zone {
    Before,
    Into,
}

/// The drops a row takes at all; its [`Node::accept`] then says which drags.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Drops {
    pub before: bool,
    pub into: bool,
}

/// Whether a click on the row is a selection. Rows of the same group form one order for Shift
/// ranges.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Selectable {
    #[default]
    No,
    Yes(u32),
}

/// Whether the row's name can be edited: by the host's own editor, asked for with
/// [`Event::RenameRequested`].
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Rename {
    #[default]
    Never,
    Host,
}

/// Whether a right-click on the row asks the host for its menu ([`Event::Menu`]).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NodeMenu {
    #[default]
    None,
    Host,
}

/// How a click selects: the row alone, toggled in the selection (Ctrl), or every row from the
/// anchor to it (Shift), replacing the selection or added to it (Ctrl+Shift).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum How {
    Only,
    Toggle,
    Range(Vec<NodeId>),
    RangeAdd(Vec<NodeId>),
}

/// A drag over the eyes begins or ends: the host makes what it changed one undo step.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gesture {
    Begin,
    End,
}

/// What happened in the panel.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// A click on a selectable row.
    Select { node: NodeId, how: How },
    /// A click on a row that is not selectable.
    Click(NodeId),
    /// A double click.
    Open(NodeId),
    /// The slower second click on a renamable row: the host opens its name editor.
    RenameRequested(NodeId),
    /// A name typed in the panel's own editor (none yet: the host's editor renames).
    Rename { node: NodeId, name: String },
    /// The fold arrow: `open` is what it asks for.
    Fold { node: NodeId, open: bool },
    /// The eye, clicked or passed over by an eye drag: `visible` is what it asks for.
    Eye { node: NodeId, visible: bool },
    /// The radio that makes the row's thing the active one.
    Activate(NodeId),
    /// The button after the row's name ([`Row::action`]).
    NameAction(NodeId),
    /// A right-click, at `at`.
    Menu { node: NodeId, at: Pos2 },
    /// Rows dropped on `target`.
    Move { target: NodeId, zone: Zone, source: Source, data: Option<Payload> },
    /// One of the row's trailing actions, by its target name.
    Action { node: NodeId, action: String },
    /// A row asked to be scrolled into view is.
    Revealed(NodeId),
    EyeGesture(Gesture),
}

/// One row as the host describes it.
#[derive(Default)]
pub struct Node<'a> {
    pub id: NodeId,
    /// The host's own name for the row (its tree key), for diagnostics.
    pub key: &'a str,
    pub row: Row<'a>,
    pub select: Selectable,
    pub rename: Rename,
    /// The row can be dragged, as this kind.
    pub drag: Option<u32>,
    pub drops: Drops,
    pub menu: NodeMenu,
    /// Whether the rows being dragged may land on this one, in that zone.
    pub accept: Option<&'a dyn Fn(&Dragged, Zone) -> bool>,
}

/// A row as drawn: where it and its parts are, and its events (with [`Browser::events_per_row`]).
#[derive(Default)]
pub struct RowOut {
    pub rect: Option<Rect>,
    /// From where the name starts to the row's end: where a host edits the name in place.
    pub label_rect: Option<Rect>,
    /// The row's egui id.
    pub widget: Option<egui::Id>,
    pub hovered: bool,
    pub response: Option<egui::Response>,
    /// The press began on the fold arrow, eye or radio: it is not a drag of the row.
    pub on_control: bool,
    /// A drag of the row began: the host says what is dragged with [`Rows::drag_with`].
    pub drag_started: bool,
    pub fold_at: Option<Pos2>,
    pub eye_at: Option<Pos2>,
    pub eye_rect: Option<Rect>,
    pub radio_at: Option<Pos2>,
    pub events: Vec<Event>,
}

/// A row the panel drew, for automation: its label, its rect, its fold arrow and whether it is
/// open.
#[derive(Clone, Debug, PartialEq)]
pub struct DrawnRow {
    pub label: String,
    pub rect: Rect,
    pub fold: Option<Rect>,
    pub open: Option<bool>,
}

/// The panel drawn.
#[derive(Clone, Debug, Default)]
pub struct Output {
    /// The events no row carries (and every event, without [`Browser::events_per_row`]).
    pub events: Vec<Event>,
    /// The rows' whole height, drawn or not.
    pub content_height: f32,
    pub drawn: Vec<DrawnRow>,
    /// The pointer is over a row.
    pub pointer_owned: bool,
}

/// How the rows are drawn: compact single-line rows, and the eye before the name.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Style {
    pub compact: bool,
    pub eye_left: bool,
}

/// What the panel remembers of one presentation between frames.
#[derive(Debug, Default)]
pub struct BrowserState {
    /// The row a Shift range starts from: the last one clicked without Shift.
    anchor: Option<NodeId>,
    /// The selectable rows in drawing order, with their group: this frame's so far, and the last
    /// frame's whole list.
    order: Vec<(NodeId, u32)>,
    previous: Vec<(NodeId, u32)>,
    /// The row last clicked: a second, slower click on it asks to rename it.
    last_click: Option<NodeId>,
    /// That second click, waiting out the double-click delay, and when it came.
    pending_rename: Option<(NodeId, f64)>,
    /// A drag over the eyes is under way.
    eye_drag: bool,
}

fn drag_id() -> egui::Id {
    egui::Id::unique("sc_kit_browser_drag")
}

/// The rows being dragged in `ctx`, from any presentation.
pub fn dragged(ctx: &egui::Context) -> Option<Dragged> {
    ctx.data(|data| data.get_temp::<Dragged>(drag_id()))
}

fn clear_drag(ctx: &egui::Context) {
    ctx.data_mut(|data| data.remove::<Dragged>(drag_id()));
}

/// Give up the drag under way when its rows belong to the document `scope` (it closed).
pub fn cancel_drag(ctx: &egui::Context, scope: u64) {
    if dragged(ctx).is_some_and(|d| d.source.scope == scope) {
        clear_drag(ctx);
    }
}

/// End what the panel holds for the presentation `source`, which is no longer drawn: its eye
/// drag (returned as [`Event::EyeGesture`]`(End)`), its row drag, a rename waiting.
pub fn end_gestures(ctx: &egui::Context, state: &mut BrowserState, source: Source) -> Vec<Event> {
    let mut ended = Vec::new();
    if std::mem::take(&mut state.eye_drag) {
        ended.push(Event::EyeGesture(Gesture::End));
    }
    if dragged(ctx).is_some_and(|d| d.source == source) {
        clear_drag(ctx);
    }
    state.pending_rename = None;
    ended
}

/// The rows from `anchor` to `to` (either way round) in `order`, of `to`'s group. None when the
/// order lacks either of them.
fn range(order: &[(NodeId, u32)], anchor: NodeId, to: NodeId, group: u32) -> Option<Vec<NodeId>> {
    let i = order.iter().position(|(id, _)| *id == anchor)?;
    let j = order.iter().position(|(id, _)| *id == to)?;
    let rows = order.get(i.min(j)..=i.max(j))?;
    Some(rows.iter().filter(|(_, g)| *g == group).map(|(id, _)| *id).collect())
}

/// The panel for one frame.
pub struct Browser<'s> {
    state: &'s mut BrowserState,
    style: Style,
    source: Source,
    active: bool,
    scroll: bool,
    shrink: bool,
    per_row: bool,
}

impl<'s> Browser<'s> {
    /// The panel over the rows of the document `scope`, keeping its state in `state`.
    pub fn new(state: &'s mut BrowserState, style: Style, scope: u64) -> Self {
        Self { state, style, source: Source { scope, presentation: 0 }, active: true, scroll: false, shrink: false, per_row: false }
    }

    /// Which presentation of the tree this is.
    pub fn presentation(mut self, presentation: u64) -> Self {
        self.source.presentation = presentation;
        self
    }

    /// Whether the rows answer the pointer. An inactive panel draws them and reports nothing.
    pub fn active(mut self, active: bool) -> Self {
        self.active = active;
        self
    }

    /// The rows in a vertical scroll area, which with `shrink` is only as high as they are.
    pub fn scroll(mut self, scroll: bool) -> Self {
        self.scroll = scroll;
        self
    }

    pub fn shrink(mut self, shrink: bool) -> Self {
        self.shrink = shrink;
        self
    }

    /// Each row's events come back with the row ([`RowOut::events`]) instead of all together.
    pub fn events_per_row(mut self, per_row: bool) -> Self {
        self.per_row = per_row;
        self
    }

    /// Draw the rows `add` lays out.
    pub fn show(self, ui: &mut egui::Ui, add: impl FnOnce(&mut Rows<'_>)) -> Output {
        let Browser { state, style, source, active, scroll, shrink, per_row } = self;
        let mut events = Vec::new();
        let (down, released) = ui.input(|i| (i.pointer.primary_down(), i.pointer.primary_released()));
        // A drag over the eyes ends with the button.
        if state.eye_drag && !down {
            state.eye_drag = false;
            events.push(Event::EyeGesture(Gesture::End));
        }
        // A row drag whose release no row took a frame ago is over.
        if !down && !released && dragged(ui.ctx()).is_some_and(|d| d.source == source) {
            clear_drag(ui.ctx());
        }
        if dragged(ui.ctx()).is_some() {
            ui.ctx().set_cursor_icon(egui::CursorIcon::Grabbing);
        }
        state.previous = std::mem::take(&mut state.order);
        let held = &mut *state;
        let body = |ui: &mut egui::Ui| {
            let top = ui.cursor().top();
            let mut rows =
                Rows { ui, state: held, style, source, active, per_row, events: Vec::new(), drawn: Vec::new(), pointer_owned: false, drag_kind: None };
            add(&mut rows);
            let Rows { ui, events, drawn, pointer_owned, .. } = rows;
            (events, drawn, pointer_owned, ui.cursor().top() - top)
        };
        let (row_events, drawn, pointer_owned, content_height) =
            if scroll { egui::ScrollArea::vertical().auto_shrink([false, shrink]).show(ui, body).inner } else { body(ui) };
        events.extend(row_events);
        // The kit's rows start an eye drag themselves (`crate::eye_drag_id`); the panel says so once.
        if active && !state.eye_drag && down && ui.ctx().data(|data| data.get_temp::<bool>(crate::eye_drag_id())).is_some() {
            state.eye_drag = true;
            events.push(Event::EyeGesture(Gesture::Begin));
        }
        Output { events, content_height: content_height.max(0.0), drawn, pointer_owned }
    }
}

/// The rows being laid out, top to bottom.
pub struct Rows<'a> {
    ui: &'a mut egui::Ui,
    state: &'a mut BrowserState,
    style: Style,
    source: Source,
    active: bool,
    per_row: bool,
    events: Vec<Event>,
    drawn: Vec<DrawnRow>,
    pointer_owned: bool,
    /// The kind of the row whose drag began this frame, for [`Rows::drag_with`].
    drag_kind: Option<u32>,
}

impl Rows<'_> {
    /// The panel's ui, for what the host draws between rows.
    pub fn ui(&mut self) -> &mut egui::Ui {
        self.ui
    }

    fn sample(&self) -> Row<'static> {
        Row { compact: self.style.compact, eye_left: self.style.eye_left, ..Default::default() }
    }

    fn note_order(&mut self, id: NodeId, select: Selectable) {
        if let Selectable::Yes(group) = select {
            self.state.order.push((id, group));
        }
    }

    /// Whether the next row would be in view: a host skips the work of a row that is not.
    pub fn next_visible(&self) -> bool {
        self.ui.is_rect_visible(crate::tree_row_rect(self.ui, &self.sample()))
    }

    /// A row out of view: it takes its place and its part in Shift ranges, and nothing is drawn.
    pub fn skip(&mut self, id: NodeId, select: Selectable) {
        self.note_order(id, select);
        let rect = crate::tree_row_rect(self.ui, &self.sample());
        self.ui.allocate_space(rect.size());
    }

    /// A row the host passes over itself (it gives it its place): only its part in Shift ranges.
    pub fn pass(&mut self, id: NodeId, select: Selectable) {
        self.note_order(id, select);
    }

    /// What is dragged, for the row whose [`RowOut::drag_started`] was just returned: these rows,
    /// with the host's payload.
    pub fn drag_with(&mut self, nodes: Vec<NodeId>, data: Option<Payload>) {
        let drag = Dragged { source: self.source, kind: self.drag_kind, nodes, data };
        self.ui.ctx().data_mut(|store| store.insert_temp(drag_id(), drag));
    }

    /// How a click on the selectable row `id` selects, by the modifiers held; it becomes the
    /// anchor unless it ends a Shift range.
    fn how(&mut self, id: NodeId, group: u32, modifiers: egui::Modifiers) -> How {
        let add = modifiers.command || modifiers.ctrl;
        if modifiers.shift
            && let Some(anchor) = self.state.anchor
            && let Some(ids) = range(&self.state.previous, anchor, id, group).or_else(|| range(&self.state.order, anchor, id, group))
        {
            return if add { How::RangeAdd(ids) } else { How::Range(ids) };
        }
        self.state.anchor = Some(id);
        if add { How::Toggle } else { How::Only }
    }

    /// Draw a row and read what happened to it.
    pub fn row(&mut self, node: Node<'_>) -> RowOut {
        let Node { id, key: _, row, select, rename, drag, drops, menu, accept } = node;
        let t = Tokens::get();
        let widget = egui::Id::unique(("sc_browser_node", self.source.presentation, id));
        self.note_order(id, select);
        let row = Row { compact: self.style.compact, eye_left: self.style.eye_left, ..row };
        let mut drawn = crate::tree_row(self.ui, widget, &row);
        let rect = drawn.rect;
        // A row out of view was only given its place.
        let shown = drawn.resp.is_some();
        if !self.active {
            drawn.resp = None;
        }
        let response = drawn.resp.clone();
        let hovered = self.active && drawn.hovered && response.as_ref().is_some_and(egui::Response::contains_pointer);
        let mut events = Vec::new();
        if let Some(r) = rect.filter(|_| shown) {
            let x = r.left() + if row.compact { t.space_8 } else { 2.0 } + row.depth as f32 * 14.0;
            let fold = row.fold.map(|_| Rect::from_min_max(pos2(x - 4.0, r.top()), pos2(x + 15.0, r.bottom())));
            self.drawn.push(DrawnRow { label: row.label.to_string(), rect: r, fold, open: row.fold });
            self.pointer_owned |= hovered || response.as_ref().is_some_and(egui::Response::contains_pointer);
        }
        let mut drag_started = false;
        if self.active && shown {
            let (now, modifiers, delay) =
                self.ui.input(|i| (i.time, i.modifiers, self.ui.ctx().options(|o| o.input_options.max_double_click_delay)));
            if drawn.fold {
                events.push(Event::Fold { node: id, open: !row.fold.unwrap_or(false) });
            }
            if drawn.eye {
                events.push(Event::Eye { node: id, visible: !row.eye.unwrap_or(true) });
            }
            if drawn.radio {
                events.push(Event::Activate(id));
            }
            if drawn.action {
                events.push(Event::NameAction(id));
            }
            for (action, clicked) in row.actions.iter().zip(&drawn.actions) {
                if clicked.clicked() {
                    events.push(Event::Action { node: id, action: action.target.to_string() });
                }
            }
            if let Some(at) = drawn.secondary.filter(|_| menu == NodeMenu::Host) {
                events.push(Event::Menu { node: id, at });
            }
            if drawn.double {
                self.state.pending_rename = None;
                self.state.last_click = Some(id);
                events.push(Event::Open(id));
            } else if drawn.clicked {
                // The second plain click on the row just clicked waits: it renames unless a
                // double click follows.
                if rename == Rename::Host && !modifiers.any() && self.state.last_click == Some(id) {
                    self.state.pending_rename = Some((id, now));
                } else {
                    self.state.pending_rename = None;
                    self.state.last_click = Some(id);
                    events.push(match select {
                        Selectable::Yes(group) => Event::Select { node: id, how: self.how(id, group, modifiers) },
                        Selectable::No => Event::Click(id),
                    });
                }
            }
            if let Some((_, since)) = self.state.pending_rename.filter(|(waiting, _)| *waiting == id) {
                if now - since > f64::from(delay) {
                    self.state.pending_rename = None;
                    events.push(Event::RenameRequested(id));
                } else {
                    self.ui.ctx().request_repaint_after(std::time::Duration::from_secs_f64((f64::from(delay) - (now - since)).max(0.0) + 0.01));
                }
            }
            // A drag of the row itself (never one that began on its arrow, eye or radio).
            if !drawn.on_control && response.as_ref().is_some_and(egui::Response::drag_started) {
                drag_started = true;
                self.drag_kind = drag;
                self.state.pending_rename = None;
            }
            // Rows dragged over this one: mark where they would land, and take them on release.
            if (drops.before || drops.into)
                && let Some(r) = rect
                && let Some(held) = dragged(self.ui.ctx())
                && let Some(pointer) = self.ui.input(|i| i.pointer.hover_pos().or(i.pointer.latest_pos()))
                && r.contains(pointer)
                && self.ui.clip_rect().contains(pointer)
            {
                let top = pointer.y < r.top() + r.height() * 0.3;
                let zone = if drops.before && (top || !drops.into) { Zone::Before } else { Zone::Into };
                if accept.is_some_and(|accept| accept(&held, zone)) {
                    let painter = self.ui.painter();
                    match zone {
                        Zone::Before => {
                            painter.hline(r.x_range(), r.top(), Stroke::new(2.0, t.accent));
                        }
                        Zone::Into => {
                            painter.rect_stroke(r.shrink(0.5), t.radius_sm.saturating_sub(1), Stroke::new(1.5, t.accent), egui::StrokeKind::Inside);
                        }
                    }
                    if self.ui.input(|i| i.pointer.primary_released()) {
                        events.push(Event::Move { target: id, zone, source: held.source, data: held.data.clone() });
                        clear_drag(self.ui.ctx());
                    }
                }
            }
        }
        let label_rect = rect.zip(drawn.label_left).map(|(r, left)| Rect::from_min_max(pos2(left.min(r.right()), r.top()), r.right_bottom()));
        let events = if self.per_row {
            events
        } else {
            self.events.append(&mut events);
            Vec::new()
        };
        RowOut {
            rect,
            label_rect,
            widget: Some(widget),
            hovered,
            response,
            on_control: drawn.on_control,
            drag_started,
            fold_at: drawn.fold_at,
            eye_at: drawn.eye_at,
            eye_rect: drawn.eye_rect,
            radio_at: drawn.radio_at,
            events,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_shift_range_runs_either_way_and_keeps_to_its_group() {
        let order = [(1, 0), (2, 0), (3, 1), (4, 0), (5, 0)];
        assert_eq!(range(&order, 2, 5, 0), Some(vec![2, 4, 5]));
        assert_eq!(range(&order, 5, 2, 0), Some(vec![2, 4, 5]));
        assert_eq!(range(&order, 2, 2, 0), Some(vec![2]));
        assert_eq!(range(&order, 9, 2, 0), None);
    }

    #[test]
    fn a_payload_gives_back_its_own_type_only() {
        let payload = Payload::new(vec![1u64, 2]);
        assert_eq!(payload.get::<Vec<u64>>(), Some(&vec![1, 2]));
        assert!(payload.get::<String>().is_none());
        assert_eq!(payload.clone(), payload);
        assert_ne!(Payload::new(1u8), Payload::new(1u8));
    }

    #[test]
    fn ending_gestures_reports_an_eye_drag_once_and_drops_a_drag_from_that_presentation() {
        let ctx = egui::Context::default();
        let source = Source { scope: 7, presentation: 1 };
        let mut state = BrowserState { eye_drag: true, pending_rename: Some((3, 0.0)), ..Default::default() };
        ctx.data_mut(|data| data.insert_temp(drag_id(), Dragged { source, kind: None, nodes: vec![3], data: None }));
        assert_eq!(end_gestures(&ctx, &mut state, source), vec![Event::EyeGesture(Gesture::End)]);
        assert!(dragged(&ctx).is_none() && state.pending_rename.is_none());
        assert!(end_gestures(&ctx, &mut state, source).is_empty());
        ctx.data_mut(|data| data.insert_temp(drag_id(), Dragged { source, kind: None, nodes: vec![3], data: None }));
        cancel_drag(&ctx, 8);
        assert!(dragged(&ctx).is_some(), "another document's close leaves it");
        cancel_drag(&ctx, 7);
        assert!(dragged(&ctx).is_none());
    }
}
