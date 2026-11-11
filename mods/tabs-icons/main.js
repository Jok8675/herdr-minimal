import { View, div, svg, image } from "gpui-kit";
import { h_flex, ScrollHandle, Slider, SliderState, SliderTrack, SliderIndicator, SliderThumb } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings,
  appHome, readTextFile, writeTextFile, exec, playSound, notify } from "herdr";

// THE ALERT VOLUME (Jok, 2026-11-11: "add a volume slider to the tab bar all the way at the right to set the current
// volume of the notification sound"). Herdr has no volume for its alert sounds: settings.json names a file for "done"
// and "blocked" and Herdr plays it as is. So the slider makes the file: on release, ffmpeg writes a copy of the picked
// sound at that level into sounds/volume/ and settings.json points at it (100% points back at the original). The
// sound you picked (Settings > Alerts) is remembered in shared "alert-volume".src; picking a new one there makes that
// the original. 0% (or a click on the speaker) turns alerts off with settings' own "enabled"; the speaker turns them
// back on at the last level. The curve is the desktop's (PipeWire / PulseAudio): 50% = an eighth = -18 dB.
const VOL_KEY = "alert-volume";
const VOL_DIR = "sounds/volume";
const VOL_STEP = 5; // per wheel notch over the slider
const volGain = (level) => Math.pow(level / 100, 3);
const volOurs = (p) => typeof p === "string" && (p.startsWith(`${VOL_DIR}/`) || p.includes(`/herdr-app/${VOL_DIR}/`));
const volBase = (p) => p.split("/").pop().replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_");

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// YOUR OWN TAB PICTURES: a tab listed here wears this picture instead of its program's icon. Keyed by tab id, so a
// rename keeps it: run `herdr-app ls` and copy the tab's "id" (it starts with "tb"). Leave the map empty and every tab
// shows its program's icon. The tile is the tab's full height (TILE = 29 px at zoom 1) with the tab's own 7 px corners,
// tucked into its left end (a tab wearing one has no border and no left padding), so draw your PNG square with rounded
// corners already in it, at 29 x your display scale (46 px at 1.6) for a crisp edge. Put it in this folder and add a
// line like the one below with your tab's id.
const TAB_ICONS = {
  // "tb0123456789abcdef0123456789abcdef": "mods/tabs-icons/my-project.png",
};
const TILE = 29;
const ICON = 19; // program icons in the other tabs (herdr ships 14; Jok: "make the icons larger")
function tabIcon(id) {
  const e = TAB_ICONS[id];
  return e ? image(e).size(TILE).flex_none() : null;
}

// THE SEGMENTED LOOK: every tab sits in one rounded track; the shown one is a raised segment with a hairline edge and
// a soft shadow, the rest are bare until hovered. Corners stay concentric with the 7 px tiles: tab 7, track 7 + its
// 3 px padding = 10. The washes are white on a dark theme and black on a light one.
const wash = (alpha) => (settings()?.dark === false ? "#000000" : "#ffffff") + alpha;

export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // The sessions popup (prefix+l) shows the same pictures.
    if (JSON.stringify(shared("tab-icons")) !== JSON.stringify(TAB_ICONS)) setShared("tab-icons", TAB_ICONS);
    this.volSeq = 0;
    this.vol = SliderState.new({ min: 0, max: 100, step: 1, value: shared(VOL_KEY)?.level ?? 100 });
    this.volIcon = this.volIconOf(this.vol.value());
    // The icon follows the drag (a redraw only when it changes); the file is made once, on release.
    this.vol.on("change", (v, cx) => { const i = this.volIconOf(v); if (i !== this.volIcon) { this.volIcon = i; cx.notify(); } });
    this.vol.on("release", (v, cx) => this.volSet(cx, { level: Math.round(v), preview: true }));
  }

  volIconOf(level) { return level <= 0 ? "x" : level < 50 ? "1" : "2"; }

  // Sets the level and/or on-off, writes the sound files and settings.json, then (preview) plays the result.
  volSet(cx, { level, on, preview }) {
    const seq = ++this.volSeq;
    cx.spawn(async (cx) => {
      try {
        const st = shared(VOL_KEY) ?? {};
        const lvl = Math.max(0, Math.min(100, level ?? st.level ?? 100));
        const enabled = on ?? lvl > 0;
        const home = appHome(), file = `${home}/settings.json`;
        let src = { ...(st.src ?? {}) }, wrote = null;
        for (let attempt = 0; attempt < 3 && !wrote; attempt++) {
          const text = await readTextFile(file);
          const s = text ? JSON.parse(text) : {};
          const snd = { ...(s.sounds ?? {}) };
          src = { ...(st.src ?? {}) };
          // A sound that isn't one of ours was picked in Settings: it's the new original.
          for (const k of ["done", "blocked"]) if (snd[k] && !volOurs(snd[k])) src[k] = snd[k]; else if (!snd[k]) src[k] = null;
          if (!src.done && !src.blocked && lvl > 0 && lvl < 100) {
            notify({ title: "Alert volume", level: "warning", body: volOurs(snd.done) || volOurs(snd.blocked)
              ? "The original sound was forgotten: pick it again in Settings > Alerts."
              : "Herdr's built-in sounds can't be scaled. Pick a sound file in Settings > Alerts first." });
            break;
          }
          if (enabled && lvl > 0) {
            await exec("mkdir", ["-p", VOL_DIR], { cwd: home });
            for (const k of ["done", "blocked"]) {
              if (!src[k]) continue;
              const out = lvl >= 100 ? src[k] : `${VOL_DIR}/${k}-${volBase(src[k])}-${lvl}.mp3`;
              if (out !== src[k] && out !== snd[k]) {
                const r = await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", src[k],
                  "-filter:a", `volume=${volGain(lvl).toFixed(5)}`, "-c:a", "libmp3lame", "-q:a", "2", out], { cwd: home });
                if (r.code !== 0) throw new Error(r.stderr?.trim() || `ffmpeg exited ${r.code}`);
              }
              snd[k] = out;
            }
          }
          if (seq !== this.volSeq) return; // a newer move is on its way
          snd.enabled = enabled;
          s.sounds = snd;
          try { await writeTextFile(file, JSON.stringify(s, null, 2) + "\n", text); wrote = snd; }
          catch (e) { if (attempt === 2) throw e; } // settings.json changed under us: read it again
        }
        if (!wrote || seq !== this.volSeq) return;
        setShared(VOL_KEY, { level: lvl, last: lvl > 0 ? lvl : st.last ?? 100, src });
        // Keep only the files settings.json now names.
        const keep = [wrote.done, wrote.blocked].filter(volOurs).flatMap(p => ["!", "-name", p.split("/").pop()]);
        await exec("find", [VOL_DIR, "-maxdepth", "1", "-name", "*.mp3", ...keep, "-delete"], { cwd: home }).catch(() => {});
        if (preview && enabled && lvl > 0) playSound(wrote.done ?? "done");
      } catch (e) {
        notify({ title: "Alert volume", body: String(e?.message ?? e), level: "error" });
      }
      cx.notify();
    });
  }

  volume(t, stop) {
    const st = shared(VOL_KEY) ?? {};
    // The slider shows the saved level (after a reload, or a move made in another copy); a drag in progress
    // isn't saved yet, so it isn't pulled back.
    const saved = st.level ?? 100;
    if (this.volShown !== saved) {
      this.volShown = saved;
      if (Math.round(this.vol.value()) !== saved) this.vol.set_value(saved);
      this.volIcon = this.volIconOf(saved);
    }
    const level = Math.round(this.vol.value());
    const off = settings()?.sounds?.enabled === false || level <= 0;
    const icon = off ? "x" : this.volIconOf(level);
    const ink = off ? t.dim : t.muted;
    return h_flex().id("alert-volume").h(26).pl(2).pr(4).gap(4).flex_none().items_center().rounded(6)
      .on_mouse_down("left", stop)
      // The wheel over it is the volume, not the tabs (the bar's own wheel switches tabs).
      .on_scroll_wheel((e, cx) => {
        cx.stop_propagation();
        if (Math.abs(e.delta.y) < 1) return;
        const next = Math.max(0, Math.min(100, Math.round(this.vol.value()) + (e.delta.y > 0 ? VOL_STEP : -VOL_STEP)));
        this.vol.set_value(next); this.volIcon = this.volIconOf(next); cx.notify();
        this.volWheel?.cancel();
        this.volWheel = cx.timer.after(400, (cx) => this.volSet(cx, { level: next, preview: true }));
      })
      .child(div().id("alert-volume-mute").size(24).flex_none().flex().items_center().justify_center().rounded(6)
        .text_color(ink).hover(s => s.bg(t.hover).text_color(t.foreground))
        .tooltip(off ? "Alert sounds off: click to turn on" : `Alert volume ${level}%: click to mute`)
        .on_click((_e, cx) => {
          if (!off) return this.volSet(cx, { on: false });
          const back = level > 0 ? level : st.last > 0 ? st.last : 100;
          this.vol.set_value(back); this.volIcon = this.volIconOf(back);
          this.volSet(cx, { level: back, on: true, preview: true });
        })
        .child(svg(`mods/tabs-icons/volume-${icon}.svg`).size(16)))
      .child(Slider.new(this.vol).child(
        SliderTrack.new(this.vol).flex().items_center().h(24).w(76).child(
          SliderIndicator.new(this.vol).relative().w_full().h(4).rounded(2).bg(t.border) // ("input" is the bar's own colour on some themes)
            .range_style(fill => fill.rounded(2).bg(off ? t.dim : t.muted))
            .child(SliderThumb.new(this.vol).id("alert-volume-thumb").size(12).rounded(6).ml(-6).mt(-4)
              .bg(off ? t.muted : t.foreground)))));
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      // A segment of the track (see THE SEGMENTED LOOK).
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? wash("12") : "#00000000").bg(c.active ? t.raised : "#00000000")
        .text_color(c.active ? t.foreground : t.muted)
        .when(Boolean(c.active), el => el.shadow_sm()).when(!c.active, el => el.hover(s => s.bg(wash("0a"))))
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(TAB_ICONS[c.id]), el => el.pl(0).child(tabIcon(c.id)))
        .when(!TAB_ICONS[c.id] && Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(ICON).flex_none().text_color(t.muted) : image(program.icon).size(ICON).flex_none()))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])));
        // (no close x on the highlighted tab: Jok, 2026-11-11 "remove the x when one is highlighted"; close from the right-click menu or prefix+k)
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return h_flex().id(`panel-${id}`).h(26).px(8).gap(5).flex_none().items_center().rounded(6)
        .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14)).child(label);
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      // The track (see THE SEGMENTED LOOK) is the scroller itself: it hugs the tabs, scrolls only once they outgrow the
      // bar, and scroll_to_item still reaches each tab, its direct children. overflow_x_scroll, not _scrollbar: the
      // scrollbar version fills its parent, stretching the track bar-wide.
      .child(h_flex().flex_1().min_w(0).h_full().items_center()
        .child(h_flex().id("tab-scroll").flex_initial().min_w(0).gap(2).p(3).rounded(10).bg(wash("08")).border(1).border_color(wash("0a"))
          .overflow_x_scroll().track_scroll(this.scroll)
          .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
          .children(shown.map(item))))
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      // The sidebar closes all the way (workspace-chrome-jok hides it, no rail), so this brings it back. It sits at the
      // right end because the sidebar is on the right (Jok, 2026-11-11: "put the sidebar and it's open button on the right"),
      // in the same corner as the sidebar's own close button once it's open.
      .when(Boolean(sidebar?.hidden), el => el.child(div().w(3).flex_none()).child(button("sidebar-open", svg("mods/workspace-chrome-jok/sidebar.svg").size(15), () => run("layout.show", { id: "sidebar" }))))
      // The alert volume, the bar's right end (before the window buttons on systems that draw none of their own).
      .child(div().w(1).h(16).mx(4).flex_none().bg(t.border))
      .child(this.volume(t, stop))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/tabs-icons/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/tabs-icons/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/tabs-icons/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
