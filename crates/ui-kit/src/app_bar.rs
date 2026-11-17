//! The application bar as components: the bar ([`show`]) and its document tabs ([`tabs`]). The bar: the app's mark and name, Home, the File button, the file
//! actions (Save, Undo, Redo…), room for the app's quick-access buttons, and at the right Help,
//! Settings, Report a bug, the command search's place and the version. The app describes the bar
//! as plain data ([`AppBar`]); [`show`] draws it inside the title bar's content rect and returns
//! what was chosen ([`BarAction`]) with the places it leaves to the app ([`BarOut`]): its quick
//! access buttons, an offer pill, the document tabs, the assistant and the search field. Its parts
//! are published in the widget registry under the names the app gives ([`Handles`]).

use crate::BackingTooltipExt as _;
use egui::{Align2, FontId, Painter, Pos2, Rect, Sense, Stroke, pos2, vec2};
use solidcraft_theme::Tokens;

/// The bar's height: the window's title bar on desktop builds.
pub const HEIGHT: f32 = 34.0;
/// Room for the version between Report a bug and the caption buttons, at the least.
pub const RIGHT_GROUP: f32 = 60.0;
/// The right-hand cluster's buttons (Assistant, Settings, Help) before Report a bug.
pub const CLUSTER_BUTTONS: f32 = 108.0;
/// The least room the document tabs keep when a long version takes its extra width: one tab and
/// its + button.
const TABS_KEPT: f32 = 124.0;
/// Where the Report a bug text starts, from the button's left edge.
pub const REPORT_TEXT_X: f32 = 29.0;
/// Space between the search field and Settings.
pub const SEARCH_GAP: f32 = 4.0;
/// A bar narrower than this shows no product name, no Undo and Redo, and narrower file actions.
const COMPACT: f32 = 640.0;

/// Where the bar publishes its parts in the widget registry.
#[derive(Clone, Copy, Debug)]
pub struct Handles<'a> {
    /// Home's centre under each of these names, and its rect under each of `home_rect`.
    pub home: &'a [&'a str],
    pub home_rect: &'a [&'a str],
    /// The File button, likewise.
    pub file: &'a [&'a str],
    pub file_rect: &'a [&'a str],
    /// The Plugins button's rect and centre.
    pub plugins: &'a str,
    /// A button's rect as a target, under each prefix followed by its id.
    pub button: &'a [&'a str],
    /// A separator's rect, this prefix followed by its group.
    pub separator: &'a str,
    pub search: &'a str,
    pub report: &'a str,
    /// A link pill's rect, this prefix followed by its id; its hide button adds `:hide`.
    pub pill: &'a str,
    /// Settings' rect and centre.
    pub settings: &'a str,
    pub version: &'a str,
}

/// A bar button: an icon with its hover text.
#[derive(Clone, Copy, Debug)]
pub struct BarButton<'a> {
    /// Its name in handles and the action it returns.
    pub id: &'a str,
    /// A kit icon name.
    pub icon: &'a str,
    pub tip: &'a str,
    pub enabled: bool,
    /// Narrower on a compact bar.
    pub narrow: bool,
    /// Left out of a compact bar (its shortcut and menus remain).
    pub wide_only: bool,
}

/// Report a bug: its label, its hover text when labelled, and whether it is always the icon.
#[derive(Clone, Copy, Debug)]
pub struct Report<'a> {
    pub label: &'a str,
    pub tip: &'a str,
    pub icon_only: bool,
}

/// The height of a link pill.
pub const PILL_HEIGHT: f32 = 22.0;
/// The bar width from which the named link pills carry their name.
pub const PILL_LABEL_MIN: f32 = 1180.0;

/// Fills for link pills to well-known services, in those services' own colours.
pub mod brand {
    use egui::Color32;
    pub const KOFI: Color32 = Color32::from_rgb(0xff, 0x5e, 0x5b);
    pub const DISCORD: Color32 = Color32::from_rgb(0x58, 0x65, 0xf2);
}

/// A link pill in the bar, before Report a bug: an icon on its own fill, with its name when
/// `labelled`, and a small × on hover that asks to hide it.
#[derive(Clone, Copy, Debug)]
pub struct Pill<'a> {
    /// Its name in handles and the actions it returns.
    pub id: &'a str,
    /// A kit icon name.
    pub icon: &'a str,
    pub label: &'a str,
    pub labelled: bool,
    /// Hover texts of the pill and of its ×, and their accessible names.
    pub tip: &'a str,
    pub hide_tip: &'a str,
    pub name: &'a str,
    pub hide_name: &'a str,
    pub fill: egui::Color32,
    pub ink: egui::Color32,
}

/// The version at the bar's right end, linking to `url`.
#[derive(Clone, Copy, Debug)]
pub struct Version<'a> {
    pub text: &'a str,
    pub url: &'a str,
}

/// The bar as the app describes it this frame.
pub struct AppBar<'a> {
    /// The app's mark, painted centred at the point given, and its name beside it.
    pub mark: &'a dyn Fn(&Painter, Pos2),
    pub name: &'a str,
    pub home: BarButton<'a>,
    /// The File button's label; it is enabled with `home`, and drawn held while its menu is open.
    pub file: &'a str,
    pub file_open: bool,
    /// The Plugins menu button after File: its label, whether its menu is open, and its accessible
    /// name. None for an app without plugins. A compact bar leaves it to the File menu.
    pub plugins: Option<(&'a str, bool, &'a str)>,
    /// The file actions after File.
    pub actions: Vec<BarButton<'a>>,
    /// How many quick-access buttons the app draws after them (one `step` each).
    pub quick: usize,
    pub help: BarButton<'a>,
    pub settings: BarButton<'a>,
    pub report: Report<'a>,
    /// The link pills before the right cluster, left to right.
    pub pills: Vec<Pill<'a>>,
    /// The bar holds the command search field, just before Settings.
    pub search: bool,
    /// The shortcut the closed search field shows, as the keymap displays it; it sets the field's
    /// width.
    pub search_shortcut: Option<&'a str>,
    /// The bar keeps a place for the app's assistant button.
    pub assistant: bool,
    pub version: Option<Version<'a>>,
    pub handles: Handles<'a>,
}

/// What the user chose on the bar this frame.
#[derive(Clone, Debug, PartialEq)]
pub enum BarAction {
    Home,
    /// The File button, at `rect`.
    File {
        rect: Rect,
    },
    /// The Plugins button, at `rect`.
    Plugins {
        rect: Rect,
    },
    /// A file action or Settings, by its id.
    Button {
        id: String,
    },
    /// Help, its menu anchored at `x`.
    Help {
        x: f32,
    },
    Report,
    /// A link pill was clicked, or its × was.
    Pill {
        id: String,
    },
    HidePill {
        id: String,
    },
    /// The version's link.
    Version,
}

/// The bar drawn: what was chosen, and the places it leaves to the app.
#[derive(Debug)]
pub struct BarOut {
    pub actions: Vec<BarAction>,
    /// The File button, where its menu opens.
    pub file: Rect,
    /// The quick-access buttons: the first one's centre x and the step between them.
    pub quick: Option<(f32, f32)>,
    /// Where an offer pill may go (right-aligned in it), and whether it may carry its label.
    pub offer: Rect,
    pub offer_labeled: bool,
    /// The document tabs run from here to the offer pill (or `controls_left` without one).
    pub tabs_start: f32,
    pub controls_left: f32,
    pub search: Option<Rect>,
    pub assistant: Option<Rect>,
    /// The bar had no room for the Plugins button: the File menu offers the plugins instead.
    pub plugins_in_file: bool,
}

fn handle(prefix: &str, key: &str) -> String {
    format!("{prefix}{key}")
}

/// The room right of Report a bug for the version (`version_width`, measured), or None where the
/// bar shows none. The version sits 12 points from the caption buttons with a gap before the
/// button, so a longer one moves the button left instead of covering it. Its width over
/// [`RIGHT_GROUP`] comes only from the document tabs' spare room: where it would leave them less
/// than [`TABS_KEPT`], the version is hidden, as it is on a narrow bar.
pub fn version_room(bar: Rect, captions: f32, tabs_start: f32, version_width: f32) -> Option<f32> {
    if bar.width() < COMPACT {
        return None;
    }
    let need = 12.0 + version_width + 8.0;
    let room = RIGHT_GROUP.max(need);
    // The tabs end 8 points before the cluster, with Report a bug as an icon at the least.
    let tabs = bar.right() - captions - room - 28.0 - CLUSTER_BUTTONS - 8.0 - tabs_start;
    (need <= RIGHT_GROUP || tabs >= TABS_KEPT).then_some(room)
}

/// The centre of Help, between Settings and Report a bug.
pub fn help_x(report: Rect) -> f32 {
    report.left() - 18.0
}

/// The Report a bug button: labelled unless `icon_only`, when there is room for its text
/// (`label_width`, measured), otherwise just the icon. An icon-only button is a square the size of
/// Settings and Help. `version_width`: the measured version, when the bar shows it.
pub fn report_rect(bar: Rect, captions: f32, tabs_start: f32, label_width: f32, version_width: Option<f32>, icon_only: bool) -> (Rect, bool) {
    let room = version_width.and_then(|width| version_room(bar, captions, tabs_start, width));
    let right = bar.right() - captions - room.unwrap_or(8.0);
    if icon_only {
        return (Rect::from_min_size(pos2(right - 32.0, bar.center().y - 16.0), vec2(32.0, 32.0)), false);
    }
    // Icon, text and a margin that mirrors the icon side.
    let full = REPORT_TEXT_X + label_width + 11.0;
    let labeled = right - CLUSTER_BUTTONS - tabs_start >= 216.0 + full;
    let width = if labeled { full } else { 28.0 };
    (Rect::from_min_size(pos2(right - width, bar.center().y - 13.0), vec2(width, 26.0)), labeled)
}

/// The closed search field in the bar, ending `right`: whole when the document tabs keep the room
/// Report a bug's label leaves them (`tabs_room`: theirs without the field), else just its
/// magnifier.
pub fn search_rect(ctx: &egui::Context, shortcut: Option<&str>, bar: Rect, right: f32, tabs_room: f32) -> Rect {
    let height = 26.0;
    let full = crate::CommandSearch::closed_width(ctx, shortcut);
    let whole = bar.width() >= COMPACT && tabs_room - full - SEARCH_GAP >= 216.0;
    let width = if whole { full } else { crate::CommandSearch::compact_width(height) };
    Rect::from_min_size(pos2(right - width, bar.center().y - height / 2.0), vec2(width, height))
}

/// A short divider between the bar's groups.
pub fn separator(ui: &egui::Ui, bar: Rect, x: f32, group: &str, handles: &Handles) {
    let t = Tokens::get();
    let rect = Rect::from_center_size(pos2(x, bar.center().y), vec2(1.0, 20.0));
    ui.painter().line_segment([rect.center_top(), rect.center_bottom()], Stroke::new(1.0, t.app_bar.lerp_to_gamma(t.app_bar_separator, 0.4)));
    solidcraft_ui_registry::publish_rect(&handle(handles.separator, group), rect);
}

/// An icon button of the bar, dimmed and deaf to clicks when disabled (its tip still shows).
/// Returns whether it was clicked.
fn icon_button(ui: &mut egui::Ui, bar: Rect, at: f32, b: &BarButton, compact: bool, handles: &Handles) -> bool {
    let t = Tokens::get();
    let width = if compact && b.narrow { 22.0 } else { 32.0 };
    let br = Rect::from_center_size(pos2(at, bar.center().y), vec2(width, 32.0));
    let resp = ui.interact(br, ui.scope_id().with(("ab", b.id)), if b.enabled { Sense::click() } else { Sense::hover() });
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, b.enabled, b.tip));
    for prefix in handles.button {
        solidcraft_ui_registry::publish_target(&handle(prefix, b.id), br);
    }
    if b.enabled && (resp.hovered() || resp.has_focus()) {
        ui.painter().rect_filled(br.shrink(3.0), t.radius_sm, t.app_bar_hover_button);
    }
    crate::icons::paint_app_bar(ui.painter(), Rect::from_center_size(br.center(), vec2(18.0, 18.0)), b.icon, if b.enabled { 1.0 } else { 0.35 });
    let clicked = resp.backing_on_hover_text(b.tip).clicked();
    b.enabled && clicked
}

/// Draws the bar in `bar`, its controls within `content` (the title bar's room between the
/// window's own buttons).
pub fn show(ui: &mut egui::Ui, data: &AppBar, bar: Rect, content: Rect) -> BarOut {
    let t = Tokens::get();
    let h = &data.handles;
    let r = bar;
    let left = content.left();
    let compact = r.right() - left < COMPACT;
    let mut actions = Vec::new();
    (data.mark)(ui.painter(), pos2(left + 20.0, r.center().y));
    if !compact {
        ui.painter().text(
            pos2(left + 36.0, r.center().y),
            Align2::LEFT_CENTER,
            data.name,
            crate::type_face::semibold(t.font_heading),
            t.app_bar_text,
        );
    }
    let mut x = left + if compact { 56.0 } else { 128.0 };
    // Home.
    let home = Rect::from_center_size(pos2(x - 4.0, r.center().y), vec2(32.0, 32.0));
    let idle = data.home.enabled;
    let home_response = ui.interact(home, ui.scope_id().with("appbar_home"), if idle { Sense::click() } else { Sense::hover() });
    home_response.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, idle, data.home.tip));
    for name in h.home {
        solidcraft_ui_registry::publish_handle(name, home.center());
    }
    for name in h.home_rect {
        solidcraft_ui_registry::publish_rect(name, home);
    }
    if idle && (home_response.hovered() || home_response.has_focus()) {
        ui.painter().rect_filled(home.shrink(3.0), t.radius_sm, t.app_bar_hover_button);
    }
    crate::icons::paint_app_bar(ui.painter(), home.shrink(7.0), data.home.icon, if idle { 1.0 } else { 0.35 });
    if home_response.backing_on_hover_text(data.home.tip).clicked() && idle {
        actions.push(BarAction::Home);
    }
    x = home.right() + 8.0;
    separator(ui, r, x, "brand", h);
    x += 16.0;
    // The File menu's text button.
    let galley = ui.painter().layout_no_wrap(data.file.to_string(), FontId::proportional(t.font_button), t.app_bar_text);
    let file = Rect::from_min_size(pos2(x - 13.0, r.center().y - 13.0), vec2(galley.size().x + 16.0, 26.0));
    x = file.right() + 17.0;
    let resp = ui.interact(file, ui.scope_id().with(("ab", "file")), if idle { Sense::click() } else { Sense::hover() });
    resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, idle, data.file));
    for name in h.file {
        solidcraft_ui_registry::publish_handle(name, file.center());
    }
    for name in h.file_rect {
        solidcraft_ui_registry::publish_rect(name, file);
    }
    if idle && (resp.hovered() || resp.has_focus() || data.file_open) {
        ui.painter().rect_filled(file, t.radius_sm, t.app_bar_hover);
    }
    let ink = if idle { t.app_bar_text } else { t.app_bar_text.gamma_multiply(0.35) };
    ui.painter().galley(pos2(file.left() + 8.0, file.center().y - galley.size().y / 2.0), galley, ink);
    if idle && resp.clicked() {
        actions.push(BarAction::File { rect: file });
    }
    // The Plugins menu's text button, where the bar is wide enough for it.
    let plugins_in_file = data.plugins.is_some() && compact;
    if let Some((label, open, name)) = data.plugins.filter(|_| !compact) {
        let galley = ui.painter().layout_no_wrap(label.to_string(), FontId::proportional(t.font_button), t.app_bar_text);
        let rect = Rect::from_min_size(pos2(x - 13.0, r.center().y - 13.0), vec2(galley.size().x + 16.0, 26.0));
        x = rect.right() + 17.0;
        let resp = ui.interact(rect, ui.scope_id().with(("ab", "plugins")), if idle { Sense::click() } else { Sense::hover() });
        resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, idle, name));
        solidcraft_ui_registry::publish_target(h.plugins, rect);
        if idle && (resp.hovered() || resp.has_focus() || open) {
            ui.painter().rect_filled(rect, t.radius_sm, t.app_bar_hover);
        }
        ui.painter().galley(pos2(rect.left() + 8.0, rect.center().y - galley.size().y / 2.0), galley, ink);
        if idle && resp.clicked() {
            actions.push(BarAction::Plugins { rect });
        }
    }
    // The file actions, then the app's quick-access buttons.
    let step = if compact { 22.0 } else { 34.0 };
    for b in data.actions.iter().filter(|b| !(compact && b.wide_only)) {
        if icon_button(ui, r, x, b, compact, h) {
            actions.push(BarAction::Button { id: b.id.to_string() });
        }
        x += step;
    }
    let mut quick = None;
    if !compact && data.quick > 0 {
        separator(ui, r, x - step / 2.0 + 8.0, "quick_access", h);
        x += 8.0;
        quick = Some((x, step));
        x += data.quick as f32 * step;
    }
    // The document tabs follow the file actions.
    let captions = r.right() - content.right();
    let separator_x = x - step + if compact { 19.0 } else { 24.0 };
    separator(ui, r, separator_x, "documents", h);
    let tabs_start = separator_x + 10.0;
    let report_font = FontId::proportional(t.font_button);
    let label_width = ui.painter().layout_no_wrap(data.report.label.to_string(), report_font.clone(), t.app_bar_text).size().x;
    // The version links to its release notes; measured here so Report a bug leaves it room.
    let version = data.version.map(|v| (v, ui.painter().layout_no_wrap(v.text.to_string(), FontId::proportional(t.font_small), t.app_bar_text)));
    let version_width = version.as_ref().map(|(_, galley)| galley.size().x);
    let (report, report_label) = report_rect(r, captions, tabs_start, label_width, version_width, data.report.icon_only);
    // Settings' left edge; the search field, when the bar holds it, sits just before it and moves
    // the assistant and the end of the document tabs left by its width.
    let gear_left = report.left() - 68.0;
    let search =
        data.search.then(|| search_rect(ui.ctx(), data.search_shortcut, r, gear_left - SEARCH_GAP, report.left() - CLUSTER_BUTTONS - tabs_start));
    let search_shift = search.map_or(0.0, |s| s.width() + SEARCH_GAP);
    if let Some(search) = search {
        solidcraft_ui_registry::publish_target(h.search, search);
    }
    if icon_button(ui, r, help_x(report), &data.help, compact, h) {
        actions.push(BarAction::Help { x: help_x(report) });
    }
    // An offer (a newer release) sits before the right cluster, in the space up to the file
    // actions; labelled where Report a bug is (an icon-only one leaves it to fit by room).
    let mut controls_left = report.left() - CLUSTER_BUTTONS - search_shift;
    // The link pills, right to left before the cluster, while the document tabs keep their room.
    if !compact {
        let font = crate::type_face::semibold(t.font_small);
        for pill in data.pills.iter().rev() {
            let label = (pill.labelled && !pill.label.is_empty()).then(|| ui.painter().layout_no_wrap(pill.label.to_string(), font.clone(), pill.ink));
            let width = label.as_ref().map_or(PILL_HEIGHT + 6.0, |g| PILL_HEIGHT + 4.0 + g.size().x + 10.0);
            if controls_left - width - 6.0 - tabs_start < TABS_KEPT {
                break;
            }
            let rect = Rect::from_min_size(pos2(controls_left - width - 6.0, r.center().y - PILL_HEIGHT / 2.0), vec2(width, PILL_HEIGHT));
            controls_left = rect.left();
            let resp = ui.interact(rect, ui.scope_id().with(("ab_pill", pill.id)), Sense::click());
            resp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Link, true, pill.name));
            solidcraft_ui_registry::publish_target(&handle(h.pill, pill.id), rect);
            let over = ui.rect_contains_pointer(rect);
            let fill = if over || resp.has_focus() { pill.fill.lerp_to_gamma(pill.ink, 0.12) } else { pill.fill };
            ui.painter().rect_filled(rect, PILL_HEIGHT / 2.0, fill);
            let icon = Rect::from_center_size(pos2(rect.left() + PILL_HEIGHT / 2.0 + 3.0, rect.center().y), vec2(14.0, 14.0));
            crate::icons::paint_ink(ui.painter(), icon, pill.icon, pill.ink);
            if let Some(g) = label {
                ui.painter().galley(pos2(icon.right() + 4.0, rect.center().y - g.size().y / 2.0), g, pill.ink);
            }
            // Its ×, over the pill's right end while the pointer is on the pill.
            let hide = Rect::from_center_size(pos2(rect.right() - 2.0, rect.top() + 2.0), vec2(14.0, 14.0));
            let hresp = ui.interact(hide, ui.scope_id().with(("ab_pill_hide", pill.id)), Sense::click());
            hresp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, pill.hide_name));
            solidcraft_ui_registry::publish_target(&format!("{}:hide", handle(h.pill, pill.id)), hide);
            if over || hresp.hovered() || hresp.has_focus() {
                ui.painter().circle_filled(hide.center(), 7.0, t.app_bar);
                ui.painter().circle_stroke(hide.center(), 7.0, Stroke::new(1.0, t.app_bar_separator));
                crate::icons::paint_app_bar(ui.painter(), hide.shrink(3.0), "close", if hresp.hovered() { 1.0 } else { 0.7 });
            }
            if hresp.backing_on_hover_text(pill.hide_tip).clicked() {
                actions.push(BarAction::HidePill { id: pill.id.to_string() });
            } else if resp.backing_on_hover_text(pill.tip).clicked() {
                actions.push(BarAction::Pill { id: pill.id.to_string() });
            }
        }
    }
    let offer = Rect::from_min_max(pos2(x, report.top()), pos2(controls_left - 2.0, report.bottom()));
    let offer_labeled = report_label || (data.report.icon_only && r.width() >= COMPACT);
    // Report a bug.
    let response = ui.interact(report, ui.scope_id().with("sc_report_button"), Sense::click());
    response.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, ui.is_enabled(), data.report.label));
    solidcraft_ui_registry::publish_target(h.report, report);
    let hot = response.hovered() || response.has_focus();
    let tip = if data.report.icon_only {
        // Drawn like Settings and Help beside it.
        if hot {
            ui.painter().rect_filled(report.shrink(3.0), t.radius_sm, t.app_bar_hover_button);
        }
        crate::icons::paint_app_bar(ui.painter(), report.shrink(7.0), "bug_report", 1.0);
        data.report.label
    } else {
        ui.painter().rect_filled(report, t.radius_sm, if hot { t.app_bar_hover_button } else { t.app_bar });
        ui.painter().rect_stroke(report, t.radius_sm, Stroke::new(1.0, t.app_bar_separator), egui::StrokeKind::Inside);
        let icon = Rect::from_center_size(pos2(report.left() + 14.0, report.center().y), vec2(18.0, 18.0));
        crate::icons::paint_app_bar(ui.painter(), icon, "bug_report", 1.0);
        if report_label {
            ui.painter().text(
                pos2(report.left() + REPORT_TEXT_X, report.center().y),
                Align2::LEFT_CENTER,
                data.report.label,
                report_font,
                t.app_bar_text,
            );
        }
        data.report.tip
    };
    if response.backing_on_hover_text(tip).clicked() {
        actions.push(BarAction::Report);
    }
    // Settings sits immediately left of Help.
    let gear = Rect::from_center_size(pos2(report.left() - 52.0, r.center().y), vec2(32.0, 32.0));
    let gresp = ui.interact(gear, ui.scope_id().with("sc_prefs_button"), Sense::click());
    if gresp.hovered() || gresp.has_focus() {
        ui.painter().rect_filled(gear.shrink(3.0), t.radius_sm, t.app_bar_hover_button);
    }
    crate::icons::paint_app_bar(ui.painter(), gear.shrink(7.0), data.settings.icon, 1.0);
    solidcraft_ui_registry::publish_rect(h.settings, gear);
    let assistant = data.assistant.then(|| Rect::from_center_size(pos2(report.left() - 86.0 - search_shift, r.center().y), vec2(32.0, 32.0)));
    solidcraft_ui_registry::publish_handle(h.settings, gear.center());
    if gresp.backing_on_hover_text(data.settings.tip).clicked() {
        actions.push(BarAction::Button { id: data.settings.id.to_string() });
    }
    if let Some((v, galley)) = version
        && version_room(r, captions, tabs_start, galley.size().x).is_some()
    {
        let vrect = Align2::RIGHT_CENTER.anchor_size(pos2(r.right() - 12.0 - captions, r.center().y), galley.size());
        let vresp = ui.interact(
            vrect.expand2(vec2(2.0, 4.0)).intersect(Rect::everything_right_of(report.right())),
            ui.scope_id().with("sc_version_link"),
            Sense::click(),
        );
        let vresp = vresp.on_hover_cursor(egui::CursorIcon::PointingHand).backing_on_hover_text(v.url);
        if vresp.hovered() || vresp.has_focus() {
            ui.painter().hline(vrect.x_range(), vrect.bottom(), Stroke::new(1.0, t.app_bar_text));
        }
        ui.painter().galley(vrect.min, galley, t.app_bar_text);
        solidcraft_ui_registry::publish_handle(h.version, vrect.center());
        if vresp.clicked() {
            actions.push(BarAction::Version);
        }
    }
    BarOut { actions, file, quick, offer, offer_labeled, tabs_start, controls_left, search, assistant, plugins_in_file }
}

/// Where the tab strip publishes its parts: each prefix is followed by the tab's place.
#[derive(Clone, Copy, Debug)]
pub struct TabHandles<'a> {
    pub tab: &'a str,
    pub close: &'a str,
    /// The » button listing every tab, and the + button.
    pub more: &'a str,
    pub new: &'a str,
    /// The name field while a tab is renamed.
    pub rename: &'a str,
    /// A row of a tab's menu, this prefix followed by the row's id; a row of the » list, by place.
    pub menu_row: &'a str,
    pub more_row: &'a str,
    /// A view of the shown design and its ×, each prefix followed by the view's place; the +
    /// that opens another view, the » listing every view, and the view switcher.
    pub view: &'a str,
    pub view_close: &'a str,
    pub view_new: &'a str,
    pub view_more: &'a str,
    pub switcher: &'a str,
}

/// The shield a design tab shows before its name: what the last check of its signatures found.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TabBadge {
    /// Signed by a key the user trusts.
    Verified,
    /// Signed, by a key not (yet) trusted, or changed since.
    Signed,
    /// A signature that does not match the design.
    Invalid,
    /// Signed, but the signature does not cover everything in the file.
    NotCovered,
    /// Signed in a way this build cannot check.
    Unsupported,
}

/// What a view's tab says about its view beside its name.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ViewState {
    #[default]
    Normal,
    /// Working (a render under way): a small dot in the view's colour.
    Busy,
    /// Something in it wants attention (a sheet whose source moved on): a dot in the warning colour.
    Attention,
}

/// One view of a design (its model, a sketch, a sheet, a render…), as the strip draws it.
#[derive(Clone, Copy, Debug)]
pub struct ViewTab<'a> {
    pub name: &'a str,
    /// A kit icon name, drawn in `accent`; `underline` runs under the view while it is shown.
    pub icon: &'a str,
    pub accent: egui::Color32,
    pub underline: egui::Color32,
    pub state: ViewState,
    /// The view its design shows.
    pub active: bool,
    pub tip: &'a str,
}

/// The words the strip's view controls carry (hover texts and accessible names).
#[derive(Clone, Copy, Debug)]
pub struct ViewText<'a> {
    pub close_view: &'a str,
    pub close_design: &'a str,
    pub new_view: &'a str,
    pub more: &'a str,
    pub switch_view: &'a str,
}

/// One document tab.
#[derive(Clone, Copy, Debug)]
pub struct DocTab<'a> {
    /// The name the tab shows, and the one the » list shows.
    pub name: &'a str,
    pub list_name: &'a str,
    /// It has unsaved changes (a bullet after its name).
    pub dirty: bool,
    /// Its hover text (where it is saved); its full name goes above it when the tab cuts it short.
    pub place: &'a str,
    /// The shield before its name, for a design that carries signatures.
    pub security: Option<TabBadge>,
    /// Its views, in order. The strip shows them for the shown design when it has more than one.
    pub views: &'a [ViewTab<'a>],
}

/// A row of a tab's menu (Close, Close Other Tabs…), with its label and the key shown when the
/// menu is the selected tab's.
#[derive(Clone, Copy, Debug)]
pub struct TabMenuRow<'a> {
    pub id: &'a str,
    pub label: &'a str,
    pub key_on_selected: &'a str,
    /// Offered only while there are other tabs.
    pub needs_others: bool,
    /// A kit icon before the label (empty for none), in `accent` when it has one.
    pub icon: &'a str,
    pub accent: Option<egui::Color32>,
    /// A group title, not a choice.
    pub heading: bool,
    /// A line above the row sets its group apart.
    pub separated: bool,
}

impl<'a> TabMenuRow<'a> {
    /// A row that runs `id`, showing `key` when the menu is the selected tab's.
    pub const fn new(id: &'a str, label: &'a str, key: &'a str) -> Self {
        Self { id, label, key_on_selected: key, needs_others: false, icon: "", accent: None, heading: false, separated: false }
    }
    /// A group title.
    pub const fn heading(label: &'a str) -> Self {
        Self { id: "", label, key_on_selected: "", needs_others: false, icon: "", accent: None, heading: true, separated: false }
    }
    pub const fn with_icon(mut self, icon: &'a str, accent: Option<egui::Color32>) -> Self {
        self.icon = icon;
        self.accent = accent;
        self
    }
    pub const fn separated(mut self) -> Self {
        self.separated = true;
        self
    }
    pub const fn needing_others(mut self) -> Self {
        self.needs_others = true;
        self
    }
}

/// The selected tab's name being edited: its text and whether the field has taken the focus.
pub struct TabRename<'a> {
    pub text: &'a mut String,
    pub focused: &'a mut bool,
    /// The longest name taken, in characters.
    pub max: usize,
}

/// The tab strip as the app describes it this frame.
pub struct TabStrip<'a> {
    pub tabs: Vec<DocTab<'a>>,
    /// The selected tab (the strip keeps it in view), and the one drawn selected (None while the
    /// app shows something else, its start page).
    pub selected: usize,
    pub shown_selected: Option<usize>,
    /// The tabs are part of the window's title bar: dragging the only tab, or one mostly up or
    /// down, moves the window, and a double click maximizes it (unless it renames).
    pub title_bar: bool,
    /// A double click on the selected tab renames it.
    pub double_click_renames: bool,
    pub rename: Option<TabRename<'a>>,
    pub menu: &'a [TabMenuRow<'a>],
    /// Hover texts and names: the close button's accessible name and tip, the » button's and the
    /// + button's tips.
    pub close_name: &'a str,
    pub close_tip: &'a str,
    pub more_tip: &'a str,
    pub new_tip: &'a str,
    /// Where the strip keeps its drag, menu and list state.
    pub id: egui::Id,
    pub handles: TabHandles<'a>,
    /// The shown design's views are tabs after its name; otherwise one switcher button lists them.
    pub views_as_tabs: bool,
    pub view_text: ViewText<'a>,
    /// A view's right-click menu; `view_right_row` is its row that needs a view to the right.
    pub view_menu: &'a [TabMenuRow<'a>],
    pub view_right_row: &'a str,
    /// The view (by place) whose name is being typed.
    pub view_rename: Option<(usize, TabRename<'a>)>,
    /// The + button's menu, and the rows under the switcher's list of views.
    pub plus_menu: &'a [TabMenuRow<'a>],
    pub switcher_menu: &'a [TabMenuRow<'a>],
    /// A design tab released this far below the bar is torn off into its own window.
    pub tear_off_below: f32,
}

/// Whether the strip that keeps its state at `id` ([`TabStrip::id`]) has its list of every tab
/// open.
pub fn tab_list_open(ctx: &egui::Context, id: egui::Id) -> bool {
    ctx.data(|d| d.get_temp::<bool>(id.with("more")).unwrap_or(false))
}

/// What the user chose on the tab strip this frame.
#[derive(Clone, Debug, PartialEq)]
pub enum TabAction {
    Select(usize),
    Close(usize),
    /// A row of tab `tab`'s menu.
    Menu {
        tab: usize,
        id: String,
    },
    /// A tab dragged from one place to another.
    Reorder {
        from: usize,
        to: usize,
    },
    /// Rename tab `tab` in place (its rect, where a menu would open).
    StartRename {
        tab: usize,
        rect: Rect,
    },
    /// The name typed was kept, or the edit given up.
    RenameDone,
    RenameCancelled,
    Maximize,
    New,
    /// Show the shown design's view at this place, or close it.
    SelectView(usize),
    CloseView(usize),
    /// Open another view of the shown design (the + button without a menu).
    NewView,
    /// A view dragged from one place to another.
    ReorderView {
        from: usize,
        to: usize,
    },
    /// A row of view `view`'s menu, of the + menu, or of the switcher's footer.
    ViewMenu {
        view: usize,
        id: String,
    },
    PlusMenu {
        id: String,
    },
    SwitcherMenu {
        id: String,
    },
    /// Design tab `0` was dragged off the bar: it wants its own window.
    TearOff(usize),
    /// The name typed into view `view` was kept, or the edit given up.
    ViewRenameDone {
        view: usize,
    },
    ViewRenameCancelled,
}

/// A tab dragged along the strip: the tab and where along it the pointer grabbed it.
#[derive(Clone, Copy, Debug)]
struct TabDrag {
    from: usize,
    grab: f32,
}

/// Which tabs the strip shows in `room` points: (first, how many, tab width). Tabs shrink to
/// `MIN_TAB`; past that a window of tabs around `selected` is shown and the rest go in the »
/// list.
pub fn tab_layout(n: usize, selected: usize, room: f32) -> (usize, usize, f32) {
    const MIN_TAB: f32 = 90.0;
    let n = n.max(1);
    let avail = (room - 34.0).max(MIN_TAB);
    if avail / n as f32 >= MIN_TAB {
        return (0, n, (avail / n as f32).min(220.0));
    }
    // Leave room for the » button.
    let fit = (((avail - 26.0) / MIN_TAB).floor() as usize).max(1);
    let first = selected.saturating_sub(fit - 1).min(n - fit);
    (first, fit, MIN_TAB)
}

/// The place among the shown tabs (`first..`, `widths` wide in strip order from `x0`) for tab
/// `from` whose left edge is dragged to `left`: the slot whose place for it is nearest.
pub fn drop_slot(left: f32, x0: f32, widths: &[f32], first: usize, from: usize) -> usize {
    let mut best = (0, f32::INFINITY);
    let mut at = x0;
    let others = widths.iter().enumerate().filter(|(k, _)| first + k != from).map(|(_, w)| *w);
    for (k, w) in others.map(Some).chain([None]).enumerate() {
        if (left - at).abs() < best.1 {
            best = (k, (left - at).abs());
        }
        at += w.unwrap_or(0.0);
    }
    first + best.0
}

/// A tab's hover text: where its design is (`place`), under its full name when the tab `cut` it
/// short.
pub fn tab_tip(name: &str, place: &str, cut: bool) -> String {
    if cut { format!("{name}\n{place}") } else { place.to_string() }
}

/// Tabs are rounded chips on the bar; the selected one has the stronger fill.
pub fn tab_shape(painter: &Painter, t: &Tokens, r: Rect, active: bool, hovered: bool) {
    let fill = if active {
        t.app_bar_tab_active
    } else if hovered {
        t.app_bar_hover
    } else {
        egui::Color32::TRANSPARENT
    };
    painter.rect_filled(r, t.radius_md, fill);
}

/// The selected tab's name field: Enter or leaving the field keeps the name, Escape gives it up.
fn rename_field(ui: &mut egui::Ui, rect: Rect, rename: &mut TabRename, handles: &TabHandles) -> Option<TabAction> {
    let t = Tokens::get();
    ui.painter().rect_filled(rect, t.radius_sm, t.field);
    let id = ui.scope_id().with("doc_tab_rename");
    let response = crate::inline_name(ui, rect.shrink2(vec2(4.0, 0.0)), id, rename.text);
    if rename.text.chars().count() > rename.max {
        *rename.text = rename.text.chars().take(rename.max).collect();
    }
    solidcraft_ui_registry::publish_target(handles.rename, rect);
    let was_focused = *rename.focused;
    if !*rename.focused {
        // The whole name selected, so typing replaces it.
        if let Some(mut state) = egui::TextEdit::load_state(ui.ctx(), id) {
            let end = rename.text.chars().count();
            state.cursor.set_char_range(Some(egui::text::CCursorRange::two(egui::text::CCursor::new(0), egui::text::CCursor::new(end))));
            state.store(ui.ctx(), id);
        }
        response.request_focus();
        *rename.focused = true;
    }
    if ui.input(|i| i.key_pressed(egui::Key::Escape)) {
        Some(TabAction::RenameCancelled)
    } else if ui.input(|i| i.key_pressed(egui::Key::Enter)) || (was_focused && response.lost_focus()) {
        Some(TabAction::RenameDone)
    } else {
        None
    }
}

/// A view being dragged along its design's tab: the view and where along it the pointer grabbed it.
#[derive(Clone, Copy, Debug)]
struct ViewDrag {
    from: usize,
    grab: f32,
}

/// The switcher button's width, and the + and » buttons' inside a design tab.
const SWITCHER_W: f32 = 30.0;
const VIEW_BUTTON_W: f32 = 22.0;

/// Which of a design's views the strip shows as tabs in `room` points, given their natural widths:
/// (first, how many). All of them where they fit; otherwise a run that keeps `active` in view.
pub fn view_window(widths: &[f32], active: usize, room: f32) -> (usize, usize) {
    let n = widths.len();
    if n == 0 || widths.iter().sum::<f32>() <= room {
        return (0, n);
    }
    let active = active.min(n - 1);
    // Grow around the active view: first to its right, then to its left, while the run fits.
    let (mut first, mut last) = (active, active);
    let mut used = widths[active];
    loop {
        let before = used;
        if last + 1 < n && used + widths[last + 1] <= room {
            last += 1;
            used += widths[last];
        }
        if first > 0 && used + widths[first - 1] <= room {
            first -= 1;
            used += widths[first];
        }
        if used == before {
            break;
        }
    }
    (first, last - first + 1)
}

/// A popup of [`TabMenuRow`]s at `at`: headings, separators, icons and keys as the rows say. A row
/// is off where `enabled` says so. Returns the row chosen and whether the popup should close.
fn row_menu(
    ui: &egui::Ui,
    area: egui::Id,
    at: Pos2,
    rows: &[TabMenuRow],
    keys: bool,
    enabled: &dyn Fn(&TabMenuRow) -> bool,
    handle_prefix: &str,
    lead: &mut dyn FnMut(&mut egui::Ui) -> bool,
) -> (Option<String>, bool) {
    let resp = crate::Container::new(ui.ctx(), crate::Surface::Popup).area(area).fixed_pos(at).order(egui::Order::Foreground).show(ui.ctx(), |ui| {
        crate::menu::menu_frame(ui, |ui| {
            let mut chosen = None;
            let led = lead(ui);
            for (k, row) in rows.iter().enumerate() {
                if row.heading {
                    crate::menu::Menu::heading(ui, row.label);
                    continue;
                }
                if row.separated && (k > 0 || led) {
                    crate::menu::Menu::separator(ui);
                }
                let mut item = crate::Item::action(row.id, row.label, row.icon);
                if keys && !row.key_on_selected.is_empty() {
                    item = item.key(row.key_on_selected);
                }
                item.enabled = enabled(row);
                let top = ui.cursor().top();
                let picked = crate::menu::list_row(ui, &item);
                let rect = Rect::from_min_max(pos2(ui.min_rect().left(), top), pos2(ui.min_rect().right(), ui.cursor().top()));
                // A view kind's icon again in its own colour, over the menu's ink.
                if let Some(accent) = row.accent.filter(|_| !row.icon.is_empty() && item.enabled) {
                    let icon = Rect::from_center_size(pos2(rect.left() + 18.0, rect.center().y), vec2(16.0, 16.0));
                    crate::icons::paint_ink(ui.painter(), icon, row.icon, accent);
                }
                solidcraft_ui_registry::publish_handle(&format!("{handle_prefix}{}", row.id), rect.center());
                if picked.is_some() {
                    chosen = Some(row.id.to_string());
                }
            }
            chosen
        })
    });
    let pressed_outside = ui.ctx().input(|x| x.pointer.any_pressed()) && !resp.response.contains_pointer();
    let close = resp.inner.is_some() || pressed_outside || ui.ctx().input(|x| x.key_pressed(egui::Key::Escape));
    (resp.inner, close)
}

/// A small square button inside a design tab (the +, the », the switcher's caret).
fn tab_button(ui: &mut egui::Ui, rect: Rect, id: egui::Id, handle: &str, open: bool) -> egui::Response {
    let t = Tokens::get();
    let resp = ui.interact(rect, id, Sense::click());
    solidcraft_ui_registry::publish_target(handle, rect);
    if resp.hovered() || resp.has_focus() || open {
        ui.painter().rect_filled(rect.shrink2(vec2(1.0, 3.0)), t.radius_sm, t.app_bar_hover_strong);
    }
    resp
}

/// Draws the document tabs in `r` from `x0` to `x1`: click to select, × to close, drag to
/// reorder (or off the bar, to tear a design off), a right-click for the tab's menu, » for every
/// tab when they don't all fit, + for a new one. The shown design carries its views: as tabs after
/// its name, or behind one switcher button.
pub fn tabs(ui: &mut egui::Ui, strip: &mut TabStrip, r: Rect, x0: f32, x1: f32) -> Vec<TabAction> {
    let t = Tokens::get();
    let h = strip.handles;
    let n = strip.tabs.len();
    let mut actions = Vec::new();
    // Each tab fits its name (up to MAX_FIT) while all of them fit; otherwise they share the room.
    const MAX_FIT: f32 = 200.0;
    // The selected tab grows with a name being typed into it.
    let typed = strip.rename.as_ref().map(|r| r.text.clone());
    let natural: Vec<f32> = strip
        .tabs
        .iter()
        .enumerate()
        .map(|(i, tab)| {
            let shown_name = match &typed {
                Some(text) if i == strip.selected => text.clone(),
                _ => tab.name.to_string(),
            };
            let label = format!("{shown_name}{}", if tab.dirty { " •" } else { "" });
            let text = ui.painter().layout_no_wrap(label, crate::type_face::semibold(t.font_button), t.app_bar_text).size().x;
            (text + 40.0 + if tab.security.is_some() { 16.0 } else { 0.0 }).clamp(72.0, MAX_FIT)
        })
        .collect();
    // The shown design's views: tabs after its name, or one switcher button; then its + button.
    let shown_tab = strip.shown_selected.filter(|i| *i < n);
    let views: &[ViewTab] = shown_tab.and_then(|i| strip.tabs.get(i)).map_or(&[], |tab| tab.views);
    let several = views.len() > 1;
    let as_tabs = strip.views_as_tabs && several;
    let has_plus = shown_tab.is_some() && !strip.plus_menu.is_empty();
    let view_font = FontId::proportional(t.font_small);
    let view_typed = strip.view_rename.as_ref().map(|(place, r)| (*place, r.text.clone()));
    let view_natural: Vec<f32> = if as_tabs {
        views
            .iter()
            .enumerate()
            .map(|(k, v)| {
                let name = match &view_typed {
                    Some((place, text)) if *place == k => text.as_str(),
                    _ => v.name,
                };
                let text = ui.painter().layout_no_wrap(name.to_string(), view_font.clone(), t.app_bar_text).size().x;
                (24.0 + text + 22.0).clamp(58.0, 160.0)
            })
            .collect()
    } else {
        Vec::new()
    };
    let active_view = views.iter().position(|v| v.active).unwrap_or(0);
    let views_room = ((x1 - x0) * 0.55 - VIEW_BUTTON_W).max(120.0);
    let (view_first, view_shown) = view_window(&view_natural, active_view, views_room);
    let views_cut = as_tabs && view_shown < views.len();
    let views_w: f32 = view_natural.iter().skip(view_first).take(view_shown).sum();
    let extra = if as_tabs { views_w + 6.0 + if views_cut { VIEW_BUTTON_W + 6.0 } else { 0.0 } } else if several { SWITCHER_W } else { 0.0 }
        + if has_plus { VIEW_BUTTON_W } else { 0.0 };
    let (first, shown, w) = tab_layout(n, strip.selected, x1 - x0 - extra);
    let fit_all = shown == n && natural.iter().sum::<f32>() + extra <= x1 - x0 - 34.0;
    let menu_id = strip.id.with("menu");
    let mut menu: Option<(usize, Pos2)> = ui.ctx().data(|d| d.get_temp(menu_id));
    // The shown tabs' widths, in strip order.
    let widths: Vec<f32> = (first..first + shown)
        .map(|i| if fit_all { natural.get(i).copied().unwrap_or(w) } else { w } + if shown_tab == Some(i) { extra } else { 0.0 })
        .collect();
    let width = |i: usize| i.checked_sub(first).and_then(|k| widths.get(k)).copied().unwrap_or(w);
    let strip_end = x0 + widths.iter().sum::<f32>();
    // A tab being dragged to a new place follows the pointer and the others make room for it;
    // Escape puts it back.
    let drag_id = strip.id.with("drag");
    let (held_down, released, escape) = ui.input(|i| (i.pointer.primary_down(), i.pointer.primary_released(), i.key_pressed(egui::Key::Escape)));
    let mut drag =
        ui.ctx().data(|d| d.get_temp::<TabDrag>(drag_id)).filter(|d| (held_down || released) && !escape && (first..first + shown).contains(&d.from));
    let pointer = ui.ctx().pointer_latest_pos();
    let held = drag.zip(pointer).map(|(d, p)| (d.from, (p.x - d.grab).clamp(x0, (strip_end - width(d.from)).max(x0))));
    let to = held.map(|(from, left)| (from, drop_slot(left, x0, &widths, first, from)));
    // Where each shown tab sits: in strip order, or with the dragged tab moved to its slot.
    let mut slots: Vec<usize> = (first..first + shown).filter(|&i| to.is_none_or(|(from, _)| from != i)).collect();
    if let Some((from, to)) = to {
        slots.insert(to.saturating_sub(first).min(slots.len()), from);
    }
    let mut lefts = vec![x0; shown];
    let mut at = x0;
    for &i in &slots {
        if let Some(l) = i.checked_sub(first).and_then(|k| lefts.get_mut(k)) {
            *l = at;
        }
        at += width(i);
    }
    // The dragged tab is drawn last, over the others.
    let mut order: Vec<usize> = (first..first + shown).filter(|&i| held.is_none_or(|(from, _)| from != i)).collect();
    order.extend(held.map(|(from, _)| from));
    let mut dropped: Option<(usize, usize)> = None;
    let (mut pick, mut shut) = (None, None);
    // Where the shown design's view controls go, found while its tab is drawn.
    let mut view_area: Option<Rect> = None;
    for i in order {
        let Some(tab) = strip.tabs.get(i).copied() else {
            continue;
        };
        let w = width(i);
        let left = match held {
            Some((from, left)) if from == i => left,
            _ => i.checked_sub(first).and_then(|k| lefts.get(k)).copied().unwrap_or(x0),
        };
        let tr = Rect::from_min_size(pos2(left, r.top() + 4.0), vec2(w - 2.0, r.height() - 8.0));
        let active = strip.shown_selected == Some(i);
        let tab_extra = if shown_tab == Some(i) { extra } else { 0.0 };
        let resp = ui.interact(tr, ui.scope_id().with(("doc_tab", i)), Sense::click_and_drag());
        solidcraft_ui_registry::publish_target(&format!("{}{i}", h.tab), tr);
        // Dragging a tab along the strip moves it. The tabs are also part of the title bar:
        // dragging the only tab, or one mostly up or down, moves the window. A double click
        // renames the tab (the first click selected it), or maximizes the window as the bar's
        // empty space does.
        if resp.drag_started_by(egui::PointerButton::Primary) {
            let origin = ui.input(|i| i.pointer.press_origin()).unwrap_or(tr.center());
            let moved = pointer.unwrap_or(origin) - origin;
            if n > 1 && (!strip.title_bar || moved.x.abs() >= moved.y.abs()) {
                drag = Some(TabDrag { from: i, grab: origin.x - tr.left() });
            } else if strip.title_bar {
                crate::window_chrome::hand_press_to_os(ui.ctx(), egui::ViewportCommand::StartDrag);
            }
        } else if resp.double_clicked() {
            if strip.double_click_renames {
                if active {
                    actions.push(TabAction::StartRename { tab: i, rect: tr });
                }
            } else if strip.title_bar {
                actions.push(TabAction::Maximize);
            }
        }
        if resp.drag_stopped() && drag.is_some_and(|d| d.from == i) {
            match pointer {
                // Released well below the bar: the design wants its own window.
                Some(p) if strip.tear_off_below > 0.0 && p.y > r.bottom() + strip.tear_off_below => actions.push(TabAction::TearOff(i)),
                // Released over the bar: the tab lands in its slot.
                Some(p) if p.y < r.bottom() + r.height() => dropped = to,
                _ => {}
            }
            drag = None;
        }
        let lit = resp.hovered() || held.is_some_and(|(from, _)| from == i);
        tab_shape(ui.painter(), &t, tr, active, lit || resp.has_focus());
        let ink = if active || lit { t.app_bar_text } else { t.app_bar_text.gamma_multiply(0.7) };
        // The shield of a signed design, before its name.
        let mut name_left = tr.left() + 10.0;
        if let Some(badge) = tab.security {
            let colour = match badge {
                TabBadge::Verified => t.form_success,
                TabBadge::Signed => ink.gamma_multiply(0.8),
                TabBadge::Invalid => t.error,
                TabBadge::NotCovered | TabBadge::Unsupported => t.warning,
            };
            crate::icons::paint_ink(ui.painter(), Rect::from_center_size(pos2(name_left + 6.0, tr.center().y), vec2(13.0, 13.0)), "shield", colour);
            name_left += 16.0;
        }
        let label = format!("{}{}", tab.name, if tab.dirty { " •" } else { "" });
        let font = if active { crate::type_face::semibold(t.font_button) } else { FontId::proportional(t.font_button) };
        let g = ui.painter().layout_no_wrap(label, font, ink);
        let text_w = (tr.right() - tab_extra - 20.0 - name_left).max(10.0);
        let tip = tab_tip(tab.name, tab.place, g.size().x > text_w);
        let clip = Rect::from_min_max(tr.min, pos2(name_left + text_w, tr.bottom()));
        match strip.rename.as_mut().filter(|_| active) {
            Some(rename) => {
                let field = Rect::from_min_max(pos2(name_left - 4.0, tr.top() + 3.0), pos2(name_left + text_w, tr.bottom() - 3.0));
                actions.extend(rename_field(ui, field, rename, &h));
            }
            None => {
                ui.painter().with_clip_rect(clip).galley(pos2(name_left, tr.center().y - g.size().y / 2.0), g, ink);
            }
        }
        if tab_extra > 0.0 {
            view_area = Some(Rect::from_min_max(pos2(name_left + text_w + 4.0, tr.top()), pos2(tr.right() - 22.0, tr.bottom())));
        }
        // ×
        let xr = Rect::from_center_size(pos2(tr.right() - 13.0, tr.center().y), vec2(16.0, 16.0));
        let show_close = active || resp.hovered() || ui.rect_contains_pointer(tr);
        let xresp = ui.interact(xr, ui.scope_id().with(("doc_close", i)), if show_close { Sense::click() } else { Sense::hover() });
        solidcraft_ui_registry::publish_target(&format!("{}{i}", h.close), xr);
        if show_close && (xresp.hovered() || xresp.has_focus()) {
            ui.painter().rect_filled(xr, t.radius_sm.saturating_sub(1), t.app_bar_hover_strong);
        }
        if show_close {
            let opacity = if xresp.hovered() || xresp.has_focus() { 1.0 } else { 0.55 };
            crate::icons::paint_app_bar(ui.painter(), Rect::from_center_size(xr.center(), vec2(14.0, 14.0)), "close", opacity);
        }
        if resp.secondary_clicked() {
            menu = Some((i, ui.ctx().pointer_interact_pos().unwrap_or(tr.left_bottom())));
        }
        // Named apart from a dialog's Close: egui names an unnamed widget after its tooltip.
        xresp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, show_close, strip.close_name));
        // A design with several views says that its × closes all of them.
        let close_tip = if tab.views.len() > 1 { strip.view_text.close_design } else { strip.close_tip };
        // A middle click closes the tab, as in a web browser.
        if resp.middle_clicked() || xresp.middle_clicked() || xresp.backing_on_hover_text(close_tip).clicked() {
            shut = Some(i);
        } else if (if held.is_some() { resp } else { resp.backing_on_hover_text(tip) }).clicked() {
            pick = Some(i);
        }
    }
    ui.ctx().data_mut(|d| match drag {
        Some(v) => {
            d.insert_temp(drag_id, v);
        }
        None => d.remove::<TabDrag>(drag_id),
    });
    // In the order they happened: a later choice this frame (the list's, the menu's) wins.
    actions.extend(shut.map(TabAction::Close));
    actions.extend(pick.map(TabAction::Select));
    if let Some(area) = view_area.filter(|_| held.is_none()) {
        view_controls(
            ui,
            strip,
            area,
            r,
            &ViewLayout { as_tabs, has_plus, cut: views_cut, first: view_first, shown: view_shown, widths: &view_natural },
            &mut actions,
        );
    }
    let mut x = strip_end;
    // More tabs than fit: a chevron lists them all.
    if shown < n {
        let mr = Rect::from_center_size(pos2(x + 12.0, r.center().y), vec2(20.0, 22.0));
        let mresp = ui.interact(mr, ui.scope_id().with("doc_more"), Sense::click());
        solidcraft_ui_registry::publish_handle(h.more, mr.center());
        if mresp.hovered() {
            ui.painter().rect_filled(mr, t.radius_sm, t.app_bar_hover_button);
        }
        ui.painter().text(mr.center(), Align2::CENTER_CENTER, format!("»{}", n - shown), FontId::proportional(t.font_body), t.app_bar_text);
        let id = strip.id.with("more");
        if mresp.clone().backing_on_hover_text(strip.more_tip).clicked() {
            ui.ctx().data_mut(|d| d.insert_temp(id, !d.get_temp::<bool>(id).unwrap_or(false)));
        }
        if tab_list_open(ui.ctx(), strip.id) {
            let mut listed = None;
            let resp = crate::Container::new(ui.ctx(), crate::Surface::Popup)
                .area(id.with("area"))
                .fixed_pos(pos2(mr.left(), r.bottom()))
                .order(egui::Order::Foreground)
                .show(ui.ctx(), |ui| {
                    crate::menu::menu_frame(ui, |ui| {
                        for (i, tab) in strip.tabs.iter().enumerate() {
                            let label = format!("{}{}", tab.list_name, if tab.dirty { " •" } else { "" });
                            if crate::list_picker(ui, &format!("{}{i}", h.more_row), &label, i == strip.selected).clicked() {
                                listed = Some(i);
                            }
                        }
                    })
                });
            let pressed_outside = ui.ctx().input(|i| i.pointer.any_pressed()) && !resp.response.contains_pointer() && !mresp.contains_pointer();
            if listed.is_some() || pressed_outside {
                ui.ctx().data_mut(|d| d.insert_temp(id, false));
            }
            actions.extend(listed.map(TabAction::Select));
        }
        x += 26.0;
    }
    // The tab's menu.
    if let Some((i, at)) = menu.filter(|(i, _)| *i < n) {
        let (chosen, close) =
            row_menu(ui, menu_id.with("area"), at, strip.menu, i == strip.selected, &|row| !row.needs_others || n > 1, h.menu_row, &mut |_| false);
        if let Some(id) = chosen {
            actions.push(TabAction::Menu { tab: i, id });
        }
        menu = if close { None } else { Some((i, at)) };
    }
    ui.ctx().data_mut(|d| match menu {
        Some(m) => {
            d.insert_temp(menu_id, m);
        }
        None => {
            d.remove::<(usize, Pos2)>(menu_id);
        }
    });
    // A new tab.
    let pr = Rect::from_center_size(pos2(x + 14.0, r.center().y), vec2(22.0, 22.0));
    let presp = ui.interact(pr, ui.scope_id().with("doc_new"), Sense::click());
    if presp.hovered() {
        ui.painter().rect_filled(pr, t.radius_sm, t.app_bar_hover_button);
    }
    crate::icons::paint_app_bar(
        ui.painter(),
        Rect::from_center_size(pr.center(), vec2(16.0, 16.0)),
        "plus",
        if presp.hovered() { 1.0 } else { 0.55 },
    );
    solidcraft_ui_registry::publish_handle(h.new, pr.center());
    if presp.backing_on_hover_text(strip.new_tip).clicked() {
        actions.push(TabAction::New);
    }
    actions.extend(dropped.map(|(from, to)| TabAction::Reorder { from, to }));
    actions
}

/// How the shown design's views are laid out inside its tab this frame.
struct ViewLayout<'a> {
    as_tabs: bool,
    has_plus: bool,
    /// Not every view fits: a » lists them all.
    cut: bool,
    first: usize,
    shown: usize,
    widths: &'a [f32],
}

/// The shown design's views inside its tab, in `area`: one tab each (click to show, × to close,
/// drag to reorder, right-click for the view's menu, a name field while one is renamed) or the
/// switcher button, then » and +. `bar` is the application bar, under which the popups open.
fn view_controls(ui: &mut egui::Ui, strip: &mut TabStrip, area: Rect, bar: Rect, layout: &ViewLayout, actions: &mut Vec<TabAction>) {
    let t = Tokens::get();
    let h = strip.handles;
    let Some(views) = strip.shown_selected.and_then(|i| strip.tabs.get(i)).map(|tab| tab.views) else {
        return;
    };
    let count = views.len();
    let font = FontId::proportional(t.font_small);
    let mut x = area.left();
    let view_menu_id = strip.id.with("view_menu");
    let mut view_menu: Option<(usize, Pos2)> = ui.ctx().data(|d| d.get_temp(view_menu_id));
    if layout.as_tabs {
        // A view dragged along the tab follows the pointer; the others keep their places until
        // it is dropped.
        let drag_id = strip.id.with("view_drag");
        let (down, released, escape) = ui.input(|i| (i.pointer.primary_down(), i.pointer.primary_released(), i.key_pressed(egui::Key::Escape)));
        let mut drag = ui
            .ctx()
            .data(|d| d.get_temp::<ViewDrag>(drag_id))
            .filter(|d| (down || released) && !escape && (layout.first..layout.first + layout.shown).contains(&d.from));
        let pointer = ui.ctx().pointer_latest_pos();
        let shown_widths: Vec<f32> = layout.widths.iter().skip(layout.first).take(layout.shown).copied().collect();
        let run_end = x + shown_widths.iter().sum::<f32>();
        let width = |k: usize| k.checked_sub(layout.first).and_then(|j| shown_widths.get(j)).copied().unwrap_or(58.0);
        let held = drag.zip(pointer).map(|(d, p)| (d.from, (p.x - d.grab).clamp(x, (run_end - width(d.from)).max(x))));
        let to = held.map(|(from, left)| (from, drop_slot(left, x, &shown_widths, layout.first, from)));
        let mut lefts = Vec::with_capacity(layout.shown);
        let mut at = x;
        for w in &shown_widths {
            lefts.push(at);
            at += w;
        }
        let mut order: Vec<usize> = (layout.first..layout.first + layout.shown).filter(|&k| held.is_none_or(|(from, _)| from != k)).collect();
        order.extend(held.map(|(from, _)| from));
        let (mut pick, mut shut, mut moved) = (None, None, None);
        for k in order {
            let Some(view) = views.get(k).copied() else { continue };
            let w = width(k);
            let left = match held {
                Some((from, left)) if from == k => left,
                _ => k.checked_sub(layout.first).and_then(|j| lefts.get(j)).copied().unwrap_or(x),
            };
            let vr = Rect::from_min_size(pos2(left, area.top() + 2.0), vec2(w - 2.0, area.height() - 4.0));
            let resp = ui.interact(vr, ui.scope_id().with(("doc_view", k)), Sense::click_and_drag());
            solidcraft_ui_registry::publish_target(&format!("{}{k}", h.view), vr);
            resp.widget_info(|| egui::WidgetInfo::selected(egui::Role::Tab, true, view.active, view.name));
            if resp.drag_started_by(egui::PointerButton::Primary) && count > 1 {
                let origin = ui.input(|i| i.pointer.press_origin()).unwrap_or(vr.center());
                drag = Some(ViewDrag { from: k, grab: origin.x - vr.left() });
            }
            if resp.drag_stopped() && drag.is_some_and(|d| d.from == k) {
                moved = to.filter(|(from, to)| from != to);
                drag = None;
            }
            let over = resp.hovered() || held.is_some_and(|(from, _)| from == k);
            if view.active {
                ui.painter().rect_filled(vr, t.radius_sm, t.app_bar_hover_strong);
            } else if over || resp.has_focus() {
                ui.painter().rect_filled(vr, t.radius_sm, t.app_bar_hover_subtle);
            }
            // The view's line, under the one shown.
            if view.active {
                ui.painter().hline((vr.left() + 5.0)..=(vr.right() - 5.0), vr.bottom() - 1.0, Stroke::new(2.0, view.underline));
            }
            let icon = Rect::from_center_size(pos2(vr.left() + 12.0, vr.center().y), vec2(14.0, 14.0));
            crate::icons::paint_ink(ui.painter(), icon, view.icon, view.accent);
            if view.state != ViewState::Normal {
                let dot = if view.state == ViewState::Busy { view.accent } else { t.warning };
                ui.painter().circle_filled(pos2(icon.right() - 1.0, icon.top() + 1.0), 3.0, dot);
            }
            let ink = if view.active || over { t.app_bar_text } else { t.app_bar_text.gamma_multiply(0.7) };
            let text_w = (vr.width() - 24.0 - 18.0).max(8.0);
            let renaming = strip.view_rename.as_mut().filter(|(place, _)| *place == k);
            match renaming {
                Some((_, rename)) => {
                    let field = Rect::from_min_max(pos2(vr.left() + 20.0, vr.top() + 2.0), pos2(vr.right() - 4.0, vr.bottom() - 2.0));
                    match rename_field(ui, field, rename, &h) {
                        Some(TabAction::RenameDone) => actions.push(TabAction::ViewRenameDone { view: k }),
                        Some(TabAction::RenameCancelled) => actions.push(TabAction::ViewRenameCancelled),
                        _ => {}
                    }
                }
                None => {
                    let g = ui.painter().layout_no_wrap(view.name.to_string(), font.clone(), ink);
                    let clip = Rect::from_min_max(pos2(vr.left() + 22.0, vr.top()), pos2(vr.left() + 22.0 + text_w, vr.bottom()));
                    ui.painter().with_clip_rect(clip).galley(pos2(vr.left() + 22.0, vr.center().y - g.size().y / 2.0), g, ink);
                }
            }
            // Its ×, while the view is shown or pointed at.
            let xr = Rect::from_center_size(pos2(vr.right() - 10.0, vr.center().y), vec2(14.0, 14.0));
            let show_close = count > 1 && (view.active || ui.rect_contains_pointer(vr)) && strip.view_rename.as_ref().is_none_or(|(place, _)| *place != k);
            let xresp = ui.interact(xr, ui.scope_id().with(("doc_view_close", k)), if show_close { Sense::click() } else { Sense::hover() });
            solidcraft_ui_registry::publish_target(&format!("{}{k}", h.view_close), xr);
            xresp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, show_close, strip.view_text.close_view));
            if show_close {
                if xresp.hovered() || xresp.has_focus() {
                    ui.painter().rect_filled(xr, t.radius_sm.saturating_sub(1), t.app_bar_hover_strong);
                }
                crate::icons::paint_app_bar(ui.painter(), xr.shrink(1.5), "close", if xresp.hovered() || xresp.has_focus() { 1.0 } else { 0.55 });
            }
            if resp.secondary_clicked() {
                view_menu = Some((k, ui.ctx().pointer_interact_pos().unwrap_or(vr.left_bottom())));
            }
            if show_close && (resp.middle_clicked() || xresp.backing_on_hover_text(strip.view_text.close_view).clicked()) {
                shut = Some(k);
            } else if (if held.is_some() { resp } else { resp.backing_on_hover_text(view.tip) }).clicked() {
                pick = Some(k);
            }
        }
        ui.ctx().data_mut(|d| match drag {
            Some(v) => {
                d.insert_temp(drag_id, v);
            }
            None => d.remove::<ViewDrag>(drag_id),
        });
        actions.extend(shut.map(TabAction::CloseView));
        actions.extend(pick.map(TabAction::SelectView));
        actions.extend(moved.map(|(from, to)| TabAction::ReorderView { from, to }));
        x = run_end + 4.0;
        // Not every view fits: » lists them all.
        if layout.cut {
            let id = strip.id.with("view_more");
            let open = ui.ctx().data(|d| d.get_temp::<bool>(id).unwrap_or(false));
            let mr = Rect::from_min_size(pos2(x, area.top()), vec2(VIEW_BUTTON_W, area.height()));
            let mresp = tab_button(ui, mr, ui.scope_id().with("doc_view_more"), h.view_more, open);
            ui.painter().text(mr.center(), Align2::CENTER_CENTER, format!("»{}", count - layout.shown), font.clone(), t.app_bar_text);
            if mresp.clone().backing_on_hover_text(strip.view_text.more).clicked() {
                ui.ctx().data_mut(|d| d.insert_temp(id, !open));
            } else if open {
                let (listed, close) = view_list(ui, id.with("area"), pos2(mr.left(), bar.bottom()), views, &h, &[], &mut Vec::new());
                actions.extend(listed.map(TabAction::SelectView));
                if close && !mresp.contains_pointer() {
                    ui.ctx().data_mut(|d| d.insert_temp(id, false));
                }
            }
            x += VIEW_BUTTON_W + 6.0;
        }
    } else if count > 1 {
        // One button for all the views: the shown one's icon and a caret; its list has every view
        // and, under them, the switcher's own rows.
        let id = strip.id.with("switcher");
        let open = ui.ctx().data(|d| d.get_temp::<bool>(id).unwrap_or(false));
        let sr = Rect::from_min_size(pos2(x, area.top()), vec2(SWITCHER_W - 2.0, area.height()));
        let sresp = tab_button(ui, sr, ui.scope_id().with("doc_view_switcher"), h.switcher, open);
        sresp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, strip.view_text.switch_view));
        if let Some(view) = views.iter().find(|v| v.active).or(views.first()) {
            crate::icons::paint_ink(ui.painter(), Rect::from_center_size(pos2(sr.left() + 10.0, sr.center().y), vec2(14.0, 14.0)), view.icon, view.accent);
        }
        crate::icons::paint_app_bar(ui.painter(), Rect::from_center_size(pos2(sr.right() - 7.0, sr.center().y), vec2(9.0, 9.0)), "chevron", 0.8);
        if sresp.clone().backing_on_hover_text(strip.view_text.switch_view).clicked() {
            ui.ctx().data_mut(|d| d.insert_temp(id, !open));
        } else if open {
            let mut footer = Vec::new();
            let (listed, close) = view_list(ui, id.with("area"), pos2(sr.left(), bar.bottom()), views, &h, strip.switcher_menu, &mut footer);
            actions.extend(listed.map(TabAction::SelectView));
            actions.extend(footer.into_iter().map(|id| TabAction::SwitcherMenu { id }));
            if close && !sresp.contains_pointer() {
                ui.ctx().data_mut(|d| d.insert_temp(id, false));
            }
        }
        x += SWITCHER_W;
    }
    // + opens another view: its menu where the app gives one.
    if layout.has_plus {
        let id = strip.id.with("view_plus");
        let open = ui.ctx().data(|d| d.get_temp::<bool>(id).unwrap_or(false));
        let pr = Rect::from_min_size(pos2(x, area.top()), vec2(VIEW_BUTTON_W - 2.0, area.height()));
        let presp = tab_button(ui, pr, ui.scope_id().with("doc_view_new"), h.view_new, open);
        presp.widget_info(|| egui::WidgetInfo::labeled(egui::Role::Button, true, strip.view_text.new_view));
        crate::icons::paint_app_bar(ui.painter(), Rect::from_center_size(pr.center(), vec2(12.0, 12.0)), "plus", if presp.hovered() || open { 1.0 } else { 0.6 });
        if presp.clone().backing_on_hover_text(strip.view_text.new_view).clicked() {
            ui.ctx().data_mut(|d| d.insert_temp(id, !open));
        } else if open {
            let (chosen, close) =
                row_menu(ui, id.with("area"), pos2(pr.left(), bar.bottom()), strip.plus_menu, true, &|row| !row.needs_others || count > 1, h.menu_row, &mut |_| false);
            actions.extend(chosen.map(|id| TabAction::PlusMenu { id }));
            if close && !presp.contains_pointer() {
                ui.ctx().data_mut(|d| d.insert_temp(id, false));
            }
        }
    }
    // A view's own menu. Its row for the views to the right is off on the last view.
    if let Some((k, at)) = view_menu.filter(|(k, _)| *k < count) {
        let right_row = strip.view_right_row;
        let enabled = |row: &TabMenuRow| if row.id == right_row { k + 1 < count } else { !row.needs_others || count > 1 };
        let (chosen, close) = row_menu(ui, view_menu_id.with("area"), at, strip.view_menu, true, &enabled, h.menu_row, &mut |_| false);
        actions.extend(chosen.map(|id| TabAction::ViewMenu { view: k, id }));
        view_menu = if close { None } else { Some((k, at)) };
    }
    ui.ctx().data_mut(|d| match view_menu {
        Some(m) => {
            d.insert_temp(view_menu_id, m);
        }
        None => {
            d.remove::<(usize, Pos2)>(view_menu_id);
        }
    });
}

/// The list of a design's views in a popup at `at`, each with its icon, the shown one marked;
/// `footer` rows follow under a line, and the ones chosen go to `chosen_footer`. Returns the view
/// picked and whether the popup should close.
fn view_list(
    ui: &egui::Ui,
    area: egui::Id,
    at: Pos2,
    views: &[ViewTab],
    handles: &TabHandles,
    footer: &[TabMenuRow],
    chosen_footer: &mut Vec<String>,
) -> (Option<usize>, bool) {
    let mut listed = None;
    let (chosen, close) = row_menu(ui, area, at, footer, true, &|_| true, handles.menu_row, &mut |ui| {
        for (k, view) in views.iter().enumerate() {
            let mut item = crate::Item::action(view.name, view.name, view.icon);
            item.enabled = true;
            let top = ui.cursor().top();
            let picked = crate::menu::list_row_lit(ui, &item, view.active);
            let rect = Rect::from_min_max(pos2(ui.min_rect().left(), top), pos2(ui.min_rect().right(), ui.cursor().top()));
            crate::icons::paint_ink(ui.painter(), Rect::from_center_size(pos2(rect.left() + 18.0, rect.center().y), vec2(16.0, 16.0)), view.icon, view.accent);
            solidcraft_ui_registry::publish_handle(&format!("{}{k}", handles.view), rect.center());
            if picked.is_some() {
                listed = Some(k);
            }
        }
        if !footer.is_empty() && !views.is_empty() {
            crate::menu::Menu::separator(ui);
        }
        false
    });
    chosen_footer.extend(chosen);
    (listed, close || listed.is_some())
}

/// A row of the File menu: what it runs (its `id`), its label, shortcut and kit icon.
#[derive(Clone, Debug, PartialEq)]
pub struct FileItem {
    pub id: String,
    pub label: String,
    pub key: String,
    pub icon: String,
    pub enabled: bool,
}

/// The File menu's rows, in order.
#[derive(Clone, Debug, PartialEq)]
pub enum FileRow {
    /// A menu row with its shortcut.
    Item(FileItem),
    /// A plain button row, with an optional hover text.
    Button {
        item: FileItem,
        tip: Option<String>,
    },
    /// A submenu of rows (Open Recent).
    Sub {
        label: String,
        rows: Vec<FileRow>,
    },
    Separator,
}

/// The File menu drawn: the row chosen (its id), and whether the menu closes (a row was chosen or
/// a click landed elsewhere).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FileMenuOut {
    pub chosen: Option<String>,
    pub close: bool,
}

fn file_rows(ui: &mut egui::Ui, rows: &[FileRow], chosen: &mut Option<String>, in_sub: bool) {
    for row in rows {
        match row {
            FileRow::Item(item) => {
                let row = crate::Item::action(&item.label, &item.label, &item.icon).key(&item.key).on_if(item.enabled);
                if crate::menu::list_row(ui, &row).is_some() {
                    *chosen = Some(item.id.clone());
                    if in_sub {
                        ui.close();
                    }
                }
            }
            FileRow::Button { item, tip } => {
                let response = crate::menu::button(ui, &item.label, &item.icon);
                let response = match tip {
                    Some(tip) => response.backing_on_hover_text(tip),
                    None => response,
                };
                if response.clicked() {
                    *chosen = Some(item.id.clone());
                    if in_sub {
                        ui.close();
                    }
                }
            }
            FileRow::Sub { label, rows } => {
                crate::Menu::button(ui, label, |ui| file_rows(ui, rows, chosen, true));
            }
            FileRow::Separator => {
                ui.separator();
            }
        }
    }
}

/// Draws the File menu's `rows` at `at` (under the File button) in the area `id`. `just_opened`:
/// the click that opened it this pass is not a click elsewhere.
pub fn file_menu(ctx: &egui::Context, rows: &[FileRow], at: Pos2, id: egui::Id, just_opened: bool) -> FileMenuOut {
    use crate::{Container, Surface};
    let mut chosen = None;
    let resp = Container::new(ctx, Surface::Popup).area(id).fixed_pos(at).order(egui::Order::Foreground).show(ctx, |ui| {
        crate::Menu::show_frame(ui, crate::Menu::frame(), |ui| {
            ui.set_min_width(190.0);
            ui.visuals_mut().widgets.inactive.weak_bg_fill = egui::Color32::TRANSPARENT;
            ui.visuals_mut().widgets.inactive.bg_stroke = Stroke::NONE;
            ui.visuals_mut().widgets.hovered.weak_bg_fill = Tokens::get().hover;
            file_rows(ui, rows, &mut chosen, false);
        });
    });
    let close = chosen.is_some() || (!just_opened && resp.response.clicked_elsewhere());
    FileMenuOut { chosen, close }
}

/// The workspace switcher at the ribbon's left end: the workspace's icon and name over a caption
/// with a chevron (one line while the ribbon is folded, the stage bar's own look in a staged
/// workspace), under an accent strip.
pub struct Switcher<'a> {
    pub name: &'a str,
    pub caption: &'a str,
    /// A kit icon name.
    pub icon: &'a str,
    pub tip: &'a str,
    /// Its menu is open: drawn held.
    pub open: bool,
    /// On a floating card (rounder, its accent strip inset by the card's corner).
    pub floating: bool,
    /// The ribbon shows button labels (a taller switcher).
    pub labels: bool,
    /// The ribbon is folded to its tab row.
    pub folded: bool,
    /// The staged workspace's look.
    pub stage: bool,
    pub accent: egui::Color32,
    /// Its rect, and its rect as a target.
    pub handle_rect: &'a str,
    pub handle_target: &'a str,
}

/// Draws the switcher in `ws`; returns whether it was clicked (the app opens its workspace menu
/// from `ws`).
pub fn switcher(ui: &mut egui::Ui, data: &Switcher, ws: Rect) -> bool {
    let t = Tokens::get();
    let painter = ui.painter().clone();
    let wresp = ui.interact(ws, ui.scope_id().with("workspace_switcher"), Sense::click());
    if wresp.hovered() || data.open {
        painter.rect_filled(ws, if data.floating { t.radius_lg } else { 0 }, t.hover);
    }
    // Keep the accent straight while leaving the floating card's top corners round.
    let accent_inset = if data.stage {
        t.space_12
    } else if data.floating {
        f32::from(t.radius_lg)
    } else {
        0.0
    };
    let corner = if data.floating { t.radius_sm / 2 } else { 0 };
    painter.rect_filled(
        Rect::from_min_size(ws.left_top() + vec2(accent_inset, 0.0), vec2((ws.width() - 2.0 * accent_inset).max(0.0), t.space_3)),
        egui::CornerRadius { nw: 0, ne: 0, sw: corner, se: corner },
        data.accent,
    );
    if !data.floating {
        t.secondary_line(&painter, [ws.right_top(), ws.right_bottom()], t.border);
    }
    let caption_room = (ws.width() - 2.0 * t.space_8 - t.space_12).max(0.0);
    if data.stage {
        crate::StageBar::workspace(ui, ws, data.icon, data.name, data.caption);
    } else if data.folded {
        // Folded to the tab row: the workspace's name and its arrow, on one line.
        let galley = egui::WidgetText::from(egui::RichText::new(data.name).size(t.font_button).color(t.text)).into_galley(
            ui,
            Some(egui::TextWrapMode::Truncate),
            caption_room,
            egui::TextStyle::Button,
        );
        let label_width = galley.size().x;
        crate::ribbon::galley_at(ui, pos2(ws.center().x - 6.0, ws.center().y + 1.0), galley, t.text);
        crate::ribbon::dropdown_arrow(&painter, pos2(ws.center().x - 6.0 + label_width / 2.0 + 7.0, ws.center().y + 1.5), t.text_dim);
    } else {
        let labels = data.labels;
        let icon = Rect::from_center_size(pos2(ws.center().x, ws.top() + if labels { 39.0 } else { 25.0 }), vec2(30.0, 30.0));
        crate::icons::paint_icon(&painter, icon, data.icon, 1.0);
        crate::ribbon::text(ui, pos2(ws.center().x, ws.top() + if labels { 69.0 } else { 50.0 }), data.name, t.font_button, t.text, true);
        // Long translations share the switcher's width with the arrow and its gap.
        let galley = egui::WidgetText::from(egui::RichText::new(data.caption).size(t.font_small).color(t.text_dim)).into_galley(
            ui,
            Some(egui::TextWrapMode::Truncate),
            caption_room,
            egui::TextStyle::Button,
        );
        let label_width = galley.size().x;
        crate::ribbon::galley_at(ui, pos2(ws.center().x - 6.0, ws.top() + if labels { 89.0 } else { 70.0 }), galley, t.text_dim);
        let arrow = pos2(ws.center().x - 6.0 + label_width / 2.0 + 7.0, ws.top() + if labels { 89.5 } else { 70.5 });
        crate::ribbon::dropdown_arrow(&painter, arrow, t.text_dim);
    }
    let clicked = wresp.backing_on_hover_text(data.tip).clicked();
    solidcraft_ui_registry::publish_rect(data.handle_rect, ws);
    solidcraft_ui_registry::publish_target(data.handle_target, ws);
    clicked
}

#[cfg(test)]
#[path = "app_bar_tests.rs"]
mod tests;
