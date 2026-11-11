// Omarchy's tmux/Herdr prefix (Ctrl+Space) for the Herdr app, which has no
// key chords of its own. keys.json opens this popup on ctrl-space; it takes
// the next key, runs what Omarchy's herdr config.toml binds to prefix+<key>,
// and closes. Esc, Ctrl+Space again, or any unbound key just closes it.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, theme } from "herdr";

// prefix+<key> in /usr/share/omarchy/config/herdr/config.toml
const KEYS = {
  // Panes
  h: ["pane.split", { direction: "down" }],
  v: ["pane.split", { direction: "right" }],
  x: ["pane.close"],
  z: ["pane.zoom"],
  // Windows -> tabs
  c: ["tab.new"],
  r: ["tab.rename"],
  k: ["tab.close"],
  n: ["tab.next"],
  p: ["tab.prev"],
  // Sessions -> spaces
  C: ["space.new"],
  R: ["space.rename"],
  K: ["space.close"],
  N: ["space.next"],
  P: ["space.prev"],
  // Help, detach (closing the window leaves every terminal running in herdr-core)
  "?": ["app.help"],
  d: ["window.close"],
  // Every open session in a popup (Jok, 2026-11-11; not in Omarchy's config): the sessions mod
  l: ["mod.open", { name: "sessions" }],
  // Open / close the sidebar (Jok, 2026-11-11), as ctrl-shift-b does
  s: ["layout.toggle", { id: "sidebar" }],
};
for (let i = 1; i <= 9; i++) KEYS[String(i)] = ["tab.select", { index: i }];

const HINTS = [
  ["c", "new tab"], ["r", "rename"], ["k", "close tab"], ["1-9", "tab"], ["p n", "prev/next"],
  ["h v", "split"], ["x", "close pane"], ["z", "zoom"], ["l", "sessions"], ["s", "sidebar"],
  ["C R K", "space new/rename/close"], ["P N", "prev/next space"], ["?", "help"], ["d", "detach"],
];

const MODIFIER_KEYS = new Set(["shift", "control", "ctrl", "alt", "platform", "cmd", "super", "function", "fn"]);

export default class Prefix extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    // The popup may not hold the keyboard until it has drawn once.
    cx.timer.after(30, () => { if (!this.done) this.handle.focus(); });
  }

  key(e, cx) {
    if (MODIFIER_KEYS.has(e.key)) return;
    cx.stop_propagation();
    const m = e.modifiers ?? {};
    let ch = m.control || m.alt || m.platform ? null : e.key_char ?? (m.shift && e.key.length === 1 ? e.key.toUpperCase() : e.key);
    if (ch && ch.length === 1 && m.shift && /[a-z]/.test(ch)) ch = ch.toUpperCase();
    const action = ch ? KEYS[ch] : null;
    this.done = true;
    if (props()?.overlay) closeOverlay(props().overlay);
    if (action) run(action[0], action[1] ?? {});
  }

  render() {
    const t = theme();
    const hint = ([k, what]) => h_flex().gap(5).items_center()
      .child(div().px(5).rounded(4).bg(t.raised).text_color(t.foreground).font_semibold().child(k))
      .child(div().text_color(t.muted).child(what));
    return v_flex()
      .id("omarchy-prefix")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .size_full()
      .px(14)
      .py(10)
      .gap(8)
      .bg(t.popover)
      .text_size(11.5)
      .child(h_flex().items_center().gap(8)
        .child(div().px(7).py(1).rounded(4).bg(t.accent).text_color(t.solid_foreground ?? t.background).font_semibold().child("PREFIX"))
        .child(div().flex_1().text_color(t.dim).child("Ctrl+Space, then a key"))
        .child(div().text_color(t.dim).child("Esc")))
      .child(h_flex().flex_wrap().gap_x(12).gap_y(4).children(HINTS.map(hint)));
  }
}
