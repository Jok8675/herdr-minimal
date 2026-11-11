// Omarchy's alt+shift+left (tmux swap-window) for the Herdr app: tab.move
// only takes a position, so this works it out, moves the shown tab one step
// left, and closes straight away. Opened by keys.json with mod.open.

import { View, div } from "gpui-kit";
import { run, props, closeOverlay, focused, spaces } from "herdr";

export default class TabMove extends View {
  init() {
    const f = focused();
    const space = f && spaces().find((s) => s.id === f.space);
    const tab = space?.tabs.find((t) => t.id === f.tab);
    const overlay = props()?.overlay;
    if (overlay) closeOverlay(overlay);
    if (!tab) return;
    const index = tab.index + (-1);
    if (index >= 1 && index <= space.tabs.length) run("tab.move", { id: tab.id, index });
  }

  render() {
    return div();
  }
}
