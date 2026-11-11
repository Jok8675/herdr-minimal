// prefix+l (Jok, 2026-11-11: "make prefix+l list open sessions"): every open session in a popup, in Omarchy's tmux
// words (a session is a space, a window a tab): each space with its tabs under it, what each tab's agent is on (its
// terminal title), where it is (folder, branch) and its status, live. It opens on the tab you're in.
// ↑/↓ (j/k, ctrl+p/n, Tab) move, Enter (or l) goes there, 1-9 go straight to that tab, Esc (or q) closes.
// Styled after the prefix popup (omarchy-prefix): the accent chip, keycaps, the popover colour. A tab with its own
// picture in the tab bar (tabs-icons' TAB_ICONS, shared as "tab-icons") wears it here too.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import * as gpuiBase from "gpui-base";
// Herdr 0.1.15 calls it ScrollHandle; 0.1.14 only has VirtualListScrollHandle.
const ScrollHandle = gpuiBase.ScrollHandle ?? gpuiBase.VirtualListScrollHandle;
import { spaces, panes, run, props, closeOverlay, theme, shared, home } from "herdr";

// The spaces' colours, as the shipped picker draws them (shared "space.colors": a theme colour name or #rrggbb).
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const MODIFIER_KEYS = new Set(["shift", "control", "ctrl", "alt", "platform", "cmd", "super", "function", "fn"]);

const ago = (ms) => {
  if (!ms) return "";
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? "<1m" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
};

export default class Sessions extends View {
  init(_props, cx) {
    this.at = null; // the selected row (tabs only), null = the tab you're in
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The popup may not hold the keyboard until it has drawn once.
    cx.timer.after(30, () => this.handle.focus());
    // The working / idle times are in minutes.
    cx.timer.every(20000, (cx) => cx.notify());
  }

  rows() {
    const out = [];
    for (const s of spaces()) {
      out.push({ kind: "head", s });
      for (const tab of s.tabs) out.push({ kind: "tab", s, tab });
    }
    return out;
  }

  close() {
    this.done = true;
    if (props()?.overlay) closeOverlay(props().overlay);
  }

  go(r) {
    if (!r) return;
    this.close();
    if (!r.s.active) run("space.select", { id: r.s.id });
    run("tab.select", { id: r.tab.id });
  }

  key(e, cx) {
    if (this.done || MODIFIER_KEYS.has(e.key)) return;
    cx.stop_propagation();
    const tabs = this.rows().filter((r) => r.kind === "tab");
    const m = e.modifiers ?? {};
    const k = e.key;
    const move = (d) => { this.at = (Math.max(0, this.at ?? 0) + d + tabs.length) % tabs.length; cx.notify(); };
    if (k === "up" || (!m.control && k === "k") || (m.control && k === "p") || (m.shift && k === "tab")) return move(-1);
    if (k === "down" || (!m.control && k === "j") || (m.control && k === "n") || k === "tab") return move(1);
    if (k === "home") { this.at = 0; return cx.notify(); }
    if (k === "end") { this.at = tabs.length - 1; return cx.notify(); }
    if (k === "enter" || k === "l" || k === "right") return this.go(tabs[this.at ?? 0]);
    if (/^[1-9]$/.test(k) && !m.control && !m.alt) return this.go(tabs[Number(k) - 1]);
    if (k === "escape" || k === "q") return this.close();
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const tabs = rows.filter((r) => r.kind === "tab");
    if (this.at === null) this.at = Math.max(0, tabs.findIndex((r) => r.s.active && r.tab.active));
    this.at = Math.min(this.at, Math.max(0, tabs.length - 1));
    const sel = tabs[this.at];
    if (sel && this.shownAt !== this.at) { this.shownAt = this.at; this.scroll.scroll_to_item(rows.indexOf(sel)); }

    const icons = shared("tab-icons") ?? {};
    const colors = shared("space.colors") ?? {};
    const spaceColor = (s) => { const c = colors[s.id]; return !c ? t.dim : c.startsWith("#") ? c : MARK[c] ?? t[c] ?? t.dim; };
    const homeDir = home();
    const tilde = (p) => (p && homeDir && p.startsWith(homeDir) ? "~" + p.slice(homeDir.length) : p ?? "");
    const keycap = (k, on) => div().min_w(18).px(5).flex_none().flex().justify_center().rounded(4)
      .bg(on ? t.accent : t.raised).text_color(on ? t.solid_foreground ?? t.background : t.foreground).font_semibold().child(k);

    const status = (tab) => {
      const st = tab.status;
      if (st === "working") return h_flex().gap(6).items_center().text_color(t.working)
        .child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().spin(900))
        .child(`working${tab.working_since ? " " + ago(tab.working_since) : ""}`);
      if (st === "blocked") return h_flex().gap(6).items_center().text_color(t.blocked).font_semibold()
        .child(div().size(7).rounded(4).bg(t.blocked)).child("needs you");
      if (st === "done") return h_flex().gap(6).items_center().text_color(t.done)
        .child(div().size(7).rounded(4).bg(t.done)).child("done");
      if (st === "idle") return h_flex().gap(6).items_center().text_color(t.dim)
        .child(div().size(7).rounded(4).border(1).border_color(t.dim)).child(`idle${tab.changed_at ? " " + ago(tab.changed_at) : ""}`);
      return div().text_color(t.dim).child("shell");
    };

    let n = 0;
    const row = (r, i) => {
      if (r.kind === "head") {
        const working = r.s.tabs.filter((x) => x.status === "working").length;
        return h_flex().id(`sess-head-${r.s.id}`).px(14).pt(i === 0 ? 4 : 12).pb(4).gap(8).items_center().text_size(11.5)
          .child(div().size(9).rounded(3).flex_none().bg(spaceColor(r.s)))
          .child(div().font_semibold().text_color(r.s.active ? t.foreground : t.muted).child(r.s.name))
          .when(Boolean(r.s.machine), (el) => el.child(div().text_color(t.dim).child(`on ${r.s.machine}`)))
          .child(div().flex_1().h(1).ml(4).bg(t.border))
          .child(div().text_color(t.dim).child(`${r.s.tabs.length} tab${r.s.tabs.length === 1 ? "" : "s"}${working ? ` · ${working} working` : ""}`));
      }
      const num = ++n;
      const on = r === sel, here = r.s.active && r.tab.active;
      const ps = panes().filter((p) => p.tab === r.tab.id);
      const lead = ps.find((p) => p.program?.agent) ?? ps.find((p) => p.focused) ?? ps[0];
      const program = lead?.program;
      const name = r.tab.named ? r.tab.name : program?.name ?? r.tab.name;
      // What the agent is on: the terminal's title, less the spinner glyph Claude Code puts in front.
      const title = (lead?.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
      const doing = title && title !== program?.name && title !== name ? title : "";
      const where = [tilde(lead?.cwd), lead?.branch].filter(Boolean).join("  ");
      const icon = icons[r.tab.id]
        ? image(icons[r.tab.id]).size(30).flex_none()
        : div().size(30).flex_none().rounded(7).flex().items_center().justify_center().bg(program?.tile ?? t.raised)
          .when(Boolean(program?.icon), (el) => el.child(program.tint
            ? svg(program.icon).size(18).text_color(program.color ?? t.foreground)
            : image(program.icon).size(18)));
      return h_flex().id(`sess-${r.tab.id}`).mx(6).px(8).h(48).gap(10).items_center().rounded(8).cursor_pointer()
        .bg(on ? t.selected : t.popover)
        .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .on_click(() => this.go(r))
        .child(num <= 9 ? keycap(String(num), on) : div().w(18).flex_none())
        .child(icon)
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().gap(7).items_center().min_w(0)
            .child(div().truncate().text_size(13).font_semibold().text_color(r.tab.settled ? t.muted : t.foreground).child(name))
            .when(here, (el) => el.child(div().px(5).rounded(4).flex_none().border(1).border_color(t.accent).text_size(10).text_color(t.accent).child("here")))
            .when(r.tab.settled, (el) => el.child(div().text_size(10.5).text_color(t.dim).child("settled")))
            .when(ps.length > 1, (el) => el.child(div().text_size(10.5).text_color(t.dim).child(`${ps.length} panes${r.tab.zoomed ? ", zoomed" : ""}`))))
          .child(h_flex().gap(8).min_w(0).text_size(11.5)
            .when(Boolean(doing), (el) => el.child(div().truncate().text_color(t.muted).child(doing)))
            .when(Boolean(where), (el) => el.child(div().flex_none().max_w(doing ? 190 : 420).truncate().text_color(t.dim).child(where)))))
        .child(div().flex_none().text_size(11.5).child(status(r.tab)));
    };

    const all = tabs.length, busy = tabs.filter((r) => r.tab.status === "working").length;
    const needs = tabs.filter((r) => r.tab.status === "blocked").length;
    const hint = (k, what) => h_flex().gap(5).items_center().child(keycap(k)).child(div().text_color(t.muted).child(what));
    return v_flex()
      .id("sessions")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .w_full()
      .bg(t.popover)
      .text_size(11.5)
      .child(h_flex().px(14).pt(10).pb(6).gap(8).items_center()
        .child(div().px(7).py(1).rounded(4).bg(t.accent).text_color(t.solid_foreground ?? t.background).font_semibold().child("SESSIONS"))
        .child(div().flex_1().text_color(t.dim).child(
          [`${all} open`, busy && `${busy} working`, needs && `${needs} need${needs === 1 ? "s" : ""} you`].filter(Boolean).join(" · ")))
        .child(div().text_color(t.dim).child("Esc")))
      .child(v_flex().id("sessions-list").max_h(470).pb(6).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(rows.map(row)))
      .child(h_flex().px(14).py(8).gap(14).items_center().border_t(1).border_color(t.border)
        .child(hint("↑↓", "move")).child(hint("⏎", "go")).child(hint("1-9", "jump")).child(hint("Esc", "close")));
  }
}
