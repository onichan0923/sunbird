// @description Material 3 Expressive theme with Android system appearance and dynamic color.
// @version 0.7.2
// @author onichan0923

(() => {
  const ui = phoenix.ui;
  // Fixed approximation of the supplied Monet palette: rose A1/A2 and warm N1/N2.
  const palettes = {
    dark: {
      canvas: 0xff22171a, sheet: 0xff291e21, row: 0xff35292c, pressed: 0xff49373e,
      ink: 0xfff1dfe3, muted: 0xffcfbfc2, accent: 0xffefb3c5,
      onAccent: 0xff4b2733, track: 0xff4d4145, handle: 0xffa38c93, ripple: 0x28efb3c5,
    },
    light: {
      canvas: 0xfffae9ed, sheet: 0xfffff6f7, row: 0xfffff8f8, pressed: 0xffefdee3,
      ink: 0xff35292c, muted: 0xff68585d, accent: 0xff814d5f,
      onAccent: 0xffffffff, track: 0xffe8dbe0, handle: 0xff827378, ripple: 0x20814d5f,
    },
  };
  const clearFill = {
    background: 0, backgroundGradient: null, activeBackgroundGradient: null,
    borderWidth: 0, borderColor: 0, focusBorderColor: 0, bgBorderWidth: 0, elevation: 0,
  };
  const corners = { outer: 22, inner: 3, gap: 2 };
  const menuRoot = "message.actions.root";
  const menuMatch = { prefix: "message.actions." };
  const settingsMatch = { prefix: "settings.row." };
  const dividerName = /(?:^|[.:_-])(?:divider|separator)(?:$|[.:_-])/i;
  const searchId = "user_settings_search_input";
  const messageMatch = { prefix: "message.content:" };
  const sendNames = ["send", "composer.send", "Send", "Send Message", "send-slot", "send-voice-message"];
  const voiceNames = ["voice-slot", "record-voice-message", "Record Voice Message"];
  const toolNames = ["composer.expressions", "composer.attachments", "composer.gift", ...voiceNames, ...sendNames];
  const sidebarMatches = ["navigation.messages", "navigation.add_server", ...[
    "navigation.channel:", "navigation.category:", "navigation.server:", "dm.row:",
  ].map(prefix => ({ prefix }))];
  const headerNames = ["chat-header", "chat-sticky-header", "dm.header"];
  const contextCancel = "composer.context.cancel";
  const detailMatches = ["account-age-group", "notif-in-app", "notif-behavior", "notif-other", "notif-system",
    "chat-swipe", "chat-media", "chat-camera", "chat-video-quality", "advanced-launch-pad", "contact-sync", "sensitive-content",
    "friend-request-settings", "build-status-launch-client"];
  const watchers = [];
  const recentGroups = new Map();
  const switchOwners = new Map();
  const switchSkins = new Map();
  const detailLists = new Map();
  let rules = [];
  let conversation;
  let palette, activeDark, selectedScheme;
  const appearance = phoenix.appearance;
  let system = appearance && appearance.get ? appearance.get() : null;

  function mix(first, second, fraction) {
    const channel = shift => Math.round(((first >>> shift) & 255) * (1 - fraction) + ((second >>> shift) & 255) * fraction);
    return (0xff000000 | channel(16) << 16 | channel(8) << 8 | channel(0)) >>> 0;
  }

  function colorsFor(dark) {
    const fallback = dark ? palettes.dark : palettes.light;
    const scales = system && system.monet;
    if (!scales) return fallback;
    const { accent1: a, neutral1: n, neutral2: v } = scales;
    const valid = (scale, tones) => scale && tones.every(tone => Number.isInteger(scale[tone]) && (scale[tone] >>> 24) === 255);
    if (!valid(a, [100, 200, 600, 800, 900]) || !valid(n, [0, 50, 100, 800, 900]) ||
        !valid(v, [100, 200, 400, 500, 700, 800])) return fallback;
    // Settings uses a tonal page with brighter preference surfaces. Use N1
    // for both elevations; N2 is the variant scale for outlines and labels.
    const canvas = dark ? mix(n[900], a[900], 0.16) : mix(n[50], a[100], 0.20);
    const row = dark ? mix(canvas, mix(n[800], a[800], 0.16), 0.72) : mix(n[0], canvas, 0.34);
    const accent = dark ? a[200] : a[600];
    return {
      canvas, row, sheet: mix(canvas, row, dark ? 0.42 : 0.80), pressed: mix(row, accent, 0.12),
      ink: dark ? mix(n[100], a[100], 0.14) : mix(n[800], a[800], 0.12), muted: dark ? v[200] : v[700],
      accent, onAccent: dark ? a[800] : n[0], track: dark ? mix(v[800], v[700], 0.6) : v[100],
      handle: dark ? v[400] : v[500], ripple: ((accent & 0xffffff) | (dark ? 0x28000000 : 0x20000000)) >>> 0,
    };
  }
  let lastList = null;
  let lastSettings = null;
  let lastSweep = 0;
  let draftInput = null;
  let hasDraft = false;
  let inferredSend = null;
  let pickedMessage = null, editingMessage = null, editLayer = null, pendingDialog = 0;
  const menuTargets = new Map();
  let joinedBar = null;
  let dialogWatch = null;
  const seenPanels = new Map();
  const layouts = new Map();
  let recordLayouts = false;
  let nativeScheme = null, lastNativeAt = 0;

  // AppState.setTheme uses the host method's field keys, a separate table
  // from ui.update's view property keys. The Android host applies background
  // to its content view and consumes these tokens for native controls/dialogs.
  const hostTheme = { dark: 583, lightBarIcons: 584, background: 587, surface: 588, surfaceHigh: 589,
    border: 591, pressed: 592, ripple: 593, raised: 594, raisedBorder: 595, brand: 596, brandText: 597,
    sliderTrack: 598, textMuted: 599, scrim: 600, navScrim: 601, textDefault: 602, baseLow: 603 };

  function applyNativePalette(force = false) {
    if (!palette || !phoenix.bridge || typeof phoenix.bridge.invoke !== "function") return;
    if (!force && nativeScheme === palette && Date.now() - lastNativeAt < 1200) return;
    const dark = activeDark;
    const colors = { dark, lightBarIcons: dark, background: palette.canvas, surface: palette.row, surfaceHigh: palette.sheet,
      border: palette.track, pressed: palette.pressed, ripple: palette.ripple, raised: palette.row, raisedBorder: palette.track,
      brand: palette.accent, brandText: palette.onAccent, sliderTrack: palette.track, textMuted: palette.muted,
      scrim: 0x99000000, navScrim: palette.canvas, textDefault: palette.ink, baseLow: palette.canvas };
    const fields = {};
    for (const key of Object.keys(colors)) fields[hostTheme[key]] = colors[key];
    if (phoenix.bridge.invoke(9, 84, fields)) {
      nativeScheme = palette;
      lastNativeAt = Date.now();
    }
  }

  function rememberLayout(name, root) {
    if (!recordLayouts || !root) return;
    let budget = 90;
    function shape(n, depth) {
      if (!n || budget-- <= 0) return "…";
      // Only fixed vocabulary is exported. Localized labels, account names,
      // message text and numeric identifiers never enter the report.
      const aid = n.accessibilityId || "";
      const known = [menuRoot, searchId, contextCancel, "composer", "guild.menu", "search.entry",
        ...headerNames, ...toolNames].includes(aid) ? aid : action(n) ? "action" : reaction(aid) ? "reaction" :
        aid.startsWith("message.content:") ? "message" : sidebarRow(n) ? "channel" : aid ? "named" : "";
      const label = [n.kind || "?", known, n.children.length].filter(x => x !== "").join("/");
      return depth && n.children.length ? [label, ...children(n).slice(0, 12).map(c => shape(c, depth - 1))] : label;
    }
    layouts.set(name, shape(root, 5));
  }

  function parent(node) {
    return node && node.parent != null ? ui.node(node.parent) : null;
  }

  function children(node) {
    return node ? node.children.map(id => ui.node(id)).filter(Boolean) : [];
  }

  function contains(node, match, depth = 3) {
    if (!node) return false;
    if (match(node)) return true;
    return depth > 0 && node.children.length <= 10 && children(node).some(n => contains(n, match, depth - 1));
  }

  function pressable(node) {
    return node && Array.isArray(node.on) && node.on.includes("press");
  }

  function shellNode(node) {
    return node && node.id !== ui.root() && (!node.kind || node.kind === "view" || node.kind === "stack");
  }

  function forLive(match, visit) {
    for (const id of ui.find(match)) {
      const node = ui.node(id);
      if (node) visit(node);
    }
  }

  function watch(match, visit) {
    watchers.push(ui.onNode(match, snapshot => {
      const node = ui.node(snapshot.id);
      if (node && node.accessibilityId === snapshot.accessibilityId) visit(node);
    }));
  }

  function patch(match, props) {
    rules.push(ui.patchProps(match, props));
    forLive(match, node => ui.update(node.id, props));
  }

  function tintIcon(button, color) {
    if (!button.children.length) return;
    const icon = ui.node(button.children[0]);
    if (icon && (icon.kind == null || icon.kind === "image")) ui.update(icon.id, { tint: color });
  }

  function iconBranch(node) {
    if (!node || /^(message\.|channel|profile|search\.)/.test(node.accessibilityId || "")) return false;
    let icon = node;
    for (let i = 0; i < 3 && shellNode(icon) && icon.children.length === 1; i++) icon = ui.node(icon.children[0]);
    return !!icon && !icon.children.length && (icon.kind === "image" || (!icon.kind && icon.id !== node.id));
  }

  // Restrict composer edits to a compact toolbar containing both the input and
  // at least one known action. The microphone can be outside the emoji/input row.
  function toolbarControls(group, inputId) {
    if (group.id === ui.root()) return null;
    const todo = [group.id], seen = new Set(), tools = [];
    let found = false;
    while (todo.length) {
      const id = todo.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      if (seen.size > 72) return null;
      const node = ui.node(id);
      if (!node || ["navigator", "list", "scroll", "sheet"].includes(node.kind)) return null;
      const name = node.accessibilityId || "";
      if (id === inputId) found = true;
      else if (toolNames.includes(name)) tools.push(node);
      else if (name && name !== "guard-gradient" && !name.toLowerCase().includes("composer") &&
        (id === group.id || node.children.length > 1 || /^(message\.|channel|profile|search\.)/.test(name))) return null;
      for (const child of node.children) todo.push(child);
    }
    return found && tools.length ? tools : null;
  }

  const flat = {
    ...clearFill, bg: 0, bgBorder: 0, shadow: null, bgShadow: null, activeShadow: null,
    shadowOutset: null, activeBorderWidth: 0, activeBorderColor: 0, elevationColor: 0,
  };

  function paintDock(bar) {
    let branch = bar;
    for (let depth = 0; depth < 6; depth++) {
      const host = parent(branch);
      if (!shellNode(host) || host.list != null || host.sheet != null ||
          (host.accessibilityId && !/^composer(?:[.:-]|$)/.test(host.accessibilityId))) break;
      const others = children(host).filter(n => n.id !== branch.id);
      const backing = n => !n.accessibilityId && shellNode(n) &&
        (!n.children.length || (n.children.length === 1 && children(n).every(c => shellNode(c) && !c.accessibilityId && !c.children.length)));
      // On release builds anonymous backdrop nodes have no kind. Clear their
      // paint, never their visibility or size, so an untagged child stays usable.
      if (others.length > 3 || !others.every(n => n.accessibilityId === "guard-gradient" || backing(n) ||
          contains(n, c => c.accessibilityId === contextCancel))) break;
      for (const n of others) {
        if (contains(n, c => c.accessibilityId === contextCancel)) continue;
        for (const layer of [n, ...children(n)]) ui.update(layer.id, { ...flat, gradient: null, backdropBlur: 0 });
      }
      ui.update(host.id, { ...flat, gradient: null, radius: 0 });
      branch = host;
    }
  }

  function barRadii(top, bottom) {
    return { radius: 0, radiusTopLeft: top, radiusTopRight: top,
      radiusBottomLeft: bottom, radiusBottomRight: bottom };
  }

  function commonFrame(a, b) {
    const chain = new Set();
    for (let i = 0; a && a.id !== ui.root() && i < 9; a = parent(a), i++) chain.add(a.id);
    for (let i = 0; b && b.id !== ui.root() && i < 9; b = parent(b), i++) {
      if (chain.has(b.id)) return b;
    }
    return null;
  }

  function styleComposer(input) {
    applyNativePalette();
    let group = parent(input), bar = null, buttons = [];
    for (let depth = 0; group && depth < 5; depth++, group = parent(group)) {
      const tools = toolbarControls(group, input.id);
      const extra = bar && group.children.length === 2 && group.children.includes(bar.id)
        ? ui.node(group.children.find(id => id !== bar.id)) : null;
      if (tools && (tools.length > buttons.length || (tools.length === buttons.length && iconBranch(extra)))) {
        bar = group;
        buttons = tools;
      }
    }
    if (!bar) return;
    rememberLayout("composer", parent(parent(bar)) || parent(bar) || bar);
    // Paint only the common outer bar. Clear nested backgrounds along control
    // paths without changing native height, hit targets, padding or flex layout.
    const cancel = ui.find(contextCancel).map(id => ui.node(id)).find(n => n && commonFrame(n, bar));
    ui.update(bar.id, { ...flat, background: palette.row, ...barRadii(cancel ? 0 : 20, 20) });
    if (cancel) joinedBar = { bar: bar.id, cancel: cancel.id };
    paintDock(bar);
    const cleared = new Set();
    for (const control of [input, ...buttons]) {
      for (let n = parent(control); n && n.id !== bar.id && !cleared.has(n.id); n = parent(n)) {
        cleared.add(n.id);
        ui.update(n.id, flat);
      }
    }
    const trailing = ui.node(bar.children[bar.children.length - 1]);
    const anonymousAction = !buttons.some(b => sendNames.includes(b.accessibilityId) || voiceNames.includes(b.accessibilityId))
      && trailing && !trailing.accessibilityId && iconBranch(trailing) &&
      !contains(trailing, n => toolNames.includes(n.accessibilityId)) ? trailing : null;
    if (inferredSend != null && (!anonymousAction || inferredSend !== anonymousAction.id)) {
      const previous = ui.node(inferredSend);
      if (previous && !previous.accessibilityId && iconBranch(previous)) paintTool(previous, false);
      inferredSend = null;
    }
    if (anonymousAction) {
      inferredSend = anonymousAction.id;
      paintTool(anonymousAction, draftInput === input.id && hasDraft);
    }
    for (const button of buttons) {
      if (button.accessibilityId === "send-slot" && buttons.some(n => n.id !== button.id && voiceNames.includes(n.accessibilityId))) {
        paintTool(button, false);
        continue;
      }
      paintTool(button, sendNames.includes(button.accessibilityId));
    }
  }

  function paintTool(button, send) {
    ui.update(button.id, { ...clearFill, background: send ? palette.accent : 0, activeBackground: palette.ripple, radius: 20 });
    let glyph = button;
    for (let depth = 0; depth < 4 && glyph.children.length === 1; depth++) {
      glyph = ui.node(glyph.children[0]);
      if (!glyph) return;
      if (send && shellNode(glyph) && glyph.children.length) ui.update(glyph.id, clearFill);
    }
    if (glyph.id !== button.id && !glyph.children.length && (!glyph.kind || glyph.kind === "image")) {
      ui.update(glyph.id, { tint: send ? palette.onAccent : palette.accent });
    }
  }

  function styleSearch(input) {
    // Captured Discord layout: frame > row > [search icon wrapper, input].
    const row = parent(input), frame = parent(row);
    if (!frame || row.children.length !== 2 || row.children[1] !== input.id ||
        frame.children.length !== 1 || frame.children[0] !== row.id || frame.id === ui.root()) return;
    const leading = ui.node(row.children[0]);
    if (!leading) return;
    ui.update(frame.id, { ...clearFill, background: palette.row, radius: 20 });
    ui.update(row.id, clearFill);
    if (leading.kind === "image") ui.update(leading.id, { tint: palette.accent });
    else tintIcon(leading, palette.accent);
  }

  function reaction(id) {
    return id === "message.actions.add_reaction" || (id || "").startsWith("message.actions.quick_reaction:");
  }

  function action(node) {
    const id = node && node.accessibilityId;
    return typeof id === "string" && id.startsWith(menuMatch.prefix) && id !== menuRoot && !reaction(id) && !dividerName.test(id);
  }

  // The client mixes named commands, attachment commands with localized or
  // absent IDs, and Sunbird's injected rows in the same action sheet.
  function menuRow(node) {
    if (!node || reaction(node.accessibilityId) || node.accessibilityId === menuRoot || !shellNode(node)) return false;
    if (action(node) || (node.accessibilityId || "").startsWith("phoenix.")) return true;
    let body = node;
    for (let depth = 0; depth < 3 && body.children.length === 1; depth++) {
      body = ui.node(body.children[0]);
      if (!body || reaction(body.accessibilityId)) return false;
      if (action(body)) return true;
    }
    const parts = children(body);
    if (parts.length < 2 || parts.length > 3 || parts.some(n => action(n) || reaction(n.accessibilityId))) return false;
    const fits = (branch, kind) => {
      let item = branch;
      for (let depth = 0; depth < 2 && shellNode(item) && item.children.length === 1; depth++) item = ui.node(item.children[0]);
      return item && !item.children.length && (!item.kind || item.kind === kind);
    };
    return fits(parts[0], "image") && fits(parts[1], "text") && (parts.length === 2 || fits(parts[2], "image"));
  }

  function menuAncestor(node) {
    for (let depth = 0; node && depth < 9; depth++, node = parent(node)) {
      if (node.accessibilityId === menuRoot) return node;
    }
    return null;
  }

  function paintMenuGroups(root) {
    // Same insertion point used by Sunbird's Target::Action.
    const groups = ui.node(root.children[root.children.length - 1]);
    if (!groups || reaction(groups.accessibilityId)) return;
    for (const group of children(groups)) {
      if (!shellNode(group) || group.accessibilityId || !group.children.length) continue;
      const kids = children(group);
      if (kids.some(reactionNode => reaction(reactionNode.accessibilityId))) continue;
      if (kids.some(action) || (kids.some(menuRow) && kids.every(n => menuRow(n) || divider(n)))) styleGroup(group, menuRow);
    }
  }

  function settingsRow(node) {
    if (!node || node.accessibilityId === searchId) return false;
    const name = node.accessibilityId || "";
    if (dividerName.test(name)) return false;
    if (name.startsWith(settingsMatch.prefix) || name === "phoenix-Sunbird") return true;
    // Other settings rows can have localized or absent IDs. Only call this
    // matcher inside a settings section established from a settings screen anchor.
    if (node.kind != null && node.kind !== "view") return false;
    if (node.children.length !== 1 && !pressable(node)) return false;
    const inner = node.children.length === 1 ? ui.node(node.children[0]) : node;
    if (!inner || inner.children.length < 2 || inner.children.length > 4) return false;
    const lead = ui.node(inner.children[0]);
    if (!lead || (lead.children.length ? !switchParts(node) :
        lead.kind && lead.kind !== "text" && lead.kind !== "image")) return false;
    return !inner.children.some(id => {
      const child = ui.node(id);
      return child && (child.kind === "input" || child.accessibilityId === searchId);
    });
  }

  function divider(node) {
    if (!node || (node.accessibilityId && !dividerName.test(node.accessibilityId))
      || (node.kind != null && node.kind !== "view")) return false;
    if (!node.children.length) return true;
    if (node.children.length !== 1) return false;
    const line = ui.node(node.children[0]);
    return !!line && !line.accessibilityId && !line.children.length && (line.kind == null || line.kind === "view");
  }

  function styleGroup(group, isRow) {
    if (!group) return false;
    const kids = group.children.map(id => ui.node(id));
    const rows = kids.map(isRow);
    if (isRow === menuRow && rows.some(Boolean)) {
      for (let i = 0; i < kids.length; i++) {
        const n = kids[i];
        if (rows[i] || !shellNode(n) || !n.children.length || reaction(n.accessibilityId) || divider(n)) continue;
        // Unnamed attachment actions still occupy a native row slot between
        // the same separator nodes, including at either end of a group.
        const left = i > 0 && divider(kids[i - 1]);
        const right = i + 1 < kids.length && divider(kids[i + 1]);
        if ((left || right) && contains(n, c => c.children.length >= 2, 3)) rows[i] = true;
      }
    }
    if (!rows.some(Boolean)) return false;
    const lines = kids.map((node, i) => rows[i - 1] && rows[i + 1] && divider(node));
    // Phoenix notifies once per named row in a mount batch. Write each group
    // once per burst; newly attached rows or dividers change the signature.
    const signature = kids.map((child, i) => {
      if (!child) return "-";
      const role = rows[i] ? "row" : lines[i] ? "divider" : "other";
      return [child.id, role, ...child.children].join(".");
    }).join(",");
    const previous = recentGroups.get(group.id), now = Date.now();
    if (previous && previous.signature === signature && now - previous.time < 120) return true;
    if (recentGroups.size >= 128) recentGroups.clear();
    recentGroups.set(group.id, { signature, time: now });
    if (group.accessibilityId !== menuRoot && group.kind !== "sheet" && kids.every((_, i) => rows[i] || lines[i])) {
      ui.update(group.id, { background: 0, radius: corners.outer, gap: 0, borderWidth: 0, borderColor: 0 });
    }
    for (let i = 0; i < kids.length; i++) {
      const node = kids[i];
      if (lines[i]) {
        // This is the native separator between two recognized rows. Collapse
        // its original inset and make the line invisible even if it has a child.
        ui.update(node.id, { opacity: 0, height: 0, minHeight: 0, margin: 0, padding: 0, background: 0, borderWidth: 0 });
        if (node.children.length === 1) {
          ui.update(node.children[0], { background: 0, opacity: 0, height: 0, borderWidth: 0 });
        }
        continue;
      }
      if (!rows[i]) continue;
      const before = rows[i-1] || lines[i-1], after = rows[i+1] || lines[i+1];
      ui.update(node.id, {
        background: palette.row, activeBackground: palette.pressed, borderWidth: 0, borderColor: 0,
        radiusTopLeft: before ? corners.inner : corners.outer, radiusTopRight: before ? corners.inner : corners.outer,
        radiusBottomLeft: after ? corners.inner : corners.outer, radiusBottomRight: after ? corners.inner : corners.outer,
        margin: [0, 0, 0, after ? corners.gap : 0],
      });
      if (isRow === settingsRow) tintSettingsRow(node);
      if (isRow === menuRow) tintMenuIcon(node, kids);
    }
    return true;
  }

  function tintMenuIcon(row, group) {
    const aid = row.accessibilityId || "";
    if (/(?:delete|remove|report|block|ban|kick|削除|刪除|删除)/i.test(aid)) return;
    if (!action(row) && group.some(n => n && n.accessibilityId === "message.actions.delete")) return;
    let lane = row;
    for (let d = 0; lane && lane.children.length === 1 && d < 3; d++) lane = ui.node(lane.children[0]);
    if (!lane || lane.children.length < 2 || lane.children.length > 3) return;
    let icon = ui.node(lane.children[0]);
    for (let d = 0; icon && icon.children.length === 1 && d < 2; d++) icon = ui.node(icon.children[0]);
    if (icon && !icon.children.length && (!icon.kind || icon.kind === "image")) ui.update(icon.id, { tint: palette.accent });
  }

  function switchParts(row) {
    const inner = row.children.length === 1 ? ui.node(row.children[0]) : row;
    const parts = children(inner);
    if (parts.length < 2 || parts.length > 3) return null;
    const label = parts[parts.length - 2], wrap = parts[parts.length - 1];
    if (wrap.children.length !== 1 || label.children.length > 2 || (label.kind === "image")) return null;
    const track = ui.node(wrap.children[0]);
    if (!shellNode(track) || track.children.length !== 1) return null;
    const knob = ui.node(track.children[0]);
    return shellNode(knob) && !knob.children.length ? { track, knob } : null;
  }

  function switchFace(props, kids = []) {
    return { kind: "view", props: { absolute: true, gravity: "center", pointerEvents: "none",
      accessibilityHidden: true, ...props }, children: kids };
  }

  function removeSkins(all) {
    for (const [id, skin] of switchSkins) {
      const track = !all && ui.node(id);
      if (track && track.children.includes(skin.knob)) continue;
      for (const remove of skin.remove) remove();
      switchSkins.delete(id);
    }
  }

  function skinSwitch(track, knob) {
    if (typeof ui.mount !== "function") return;
    const existing = switchSkins.get(track.id);
    if (existing && existing.knob === knob.id) return;
    if (existing) for (const remove of existing.remove) remove();
    // The mirror exposes the native thumb's 28dp travel, but omits its
    // checked value. Reveal the two faces with that same animation, including
    // on first mount and for switches changed outside this plugin.
    const offRail = () => switchFace({ width: 52, height: 32, radius: 16, background: palette.handle }, [
      switchFace({ width: 48, height: 28, radius: 14, background: palette.track }),
    ]);
    const stroke = (width, x, y, angle) => switchFace({ width, height: 1.8, radius: 0.9,
      translateX: x, translateY: y, rotation: angle, background: palette.accent });
    const checkedThumb = switchFace({ width: 24, height: 24, radius: 12,
      translateX: -2, background: palette.onAccent }, [
      stroke(5.7, -3.4, 1.2, 45), stroke(11.3, 1.9, -0.8, -45),
    ]);
    // x = 24 splits the 52dp rail between the 16dp off and 24dp on thumbs.
    const base = ui.mount(track.id, switchFace({ width: 52, height: 32, radius: 16, clip: true }, [
      offRail(),
      switchFace({ width: 16, height: 16, radius: 8, translateX: -10, background: palette.handle }),
      switchFace({ width: 28, height: 32, translateX: 12, clip: true, background: palette.accent }, [checkedThumb]),
    ]), { before: knob.id });
    // The two masks ride the original knob. At x=0 the right mask finishes
    // the outlined off rail. At x=28 the left mask finishes the primary rail.
    const moving = ui.mount(knob.id, switchFace({ width: 2, height: 2, clip: false }, [
      switchFace({ width: 52, height: 32, translateX: -25, background: palette.accent }),
      switchFace({ width: 28, height: 32, translateX: 43, clip: true, background: palette.handle }, [
        switchFace({ width: 52, height: 32, translateX: -12 }, [offRail()]),
      ]),
    ]));
    switchSkins.set(track.id, { knob: knob.id, remove: [base, moving] });
  }

  // Phoenix translates the original knob by 28dp. All artwork below the
  // knob shares that transform, even if the user reverses the spring.
  function liveSwitch(toggle, checked) {
    const { track, knob } = toggle;
    const previous = switchSkins.get(track.id);
    if (previous && previous.knob === knob.id && previous.checked === checked) return;
    // Limit the native 28dp spring to the Material handle's 20dp travel.
    // Counter-scale the art so circles stay circular. The hit box stays 52dp.
    const scale = 20 / 28;
    const wrap = parent(track);
    ui.update(wrap.id, { width: 52, height: 32, align: "center", justify: "center", radius: 16, clip: true });
    ui.update(track.id, { width: 52 / scale, minWidth: 52 / scale, height: 32, scaleX: scale, shrink: 0,
      padding: [16 / scale - 1, 0, 0, 0], align: "center", radius: 16, borderWidth: 0, background: 0, clip: false });
    ui.update(knob.id, { width: 2, height: 2, maxWidth: 2, maxHeight: 2, margin: 0, background: 0, clip: false });
    const rail = switchFace({ width: 52, height: 32, radius: 16, scaleX: 1 / scale,
      background: checked ? palette.accent : palette.handle },
      checked ? [] : [switchFace({ width: 48, height: 28, radius: 14, background: palette.track })]);
    const stroke = (width, x, y, rotation) => switchFace({ width, height: 1.8, radius: 0.9,
      background: palette.accent, translateX: x, translateY: y, rotation });
    const size = checked ? 24 : 16;
    const thumb = switchFace({ width: size, height: size, radius: size / 2, scaleX: 1 / scale,
      background: checked ? palette.onAccent : palette.handle }, checked ?
      [stroke(5.7, -3.4, 1.2, 45), stroke(11.3, 1.9, -0.8, -45)] : []);
    const base = ui.mount(track.id, rail, { before: knob.id });
    const cap = ui.mount(knob.id, thumb);
    if (previous) for (const remove of previous.remove) remove();
    switchSkins.set(track.id, { knob: knob.id, checked, remove: [base, cap] });
  }

  function tintSwitch(row, toggle, reported) {
    if (switchOwners.size >= 1024) {
      for (const [id, owner] of switchOwners) if (!ui.node(owner)) switchOwners.delete(id);
    }
    switchOwners.set(row.id, row.id);
    switchOwners.set(toggle.track.id, row.id);
    const last = switchSkins.get(toggle.track.id);
    const checked = [row.checked, toggle.track.checked, reported,
      last && last.knob === toggle.knob.id ? last.checked : null].find(v => typeof v === "boolean");
    if (typeof checked === "boolean" && ui.mount) {
      liveSwitch(toggle, checked);
      return;
    }
    if (typeof ui.mount !== "function") return;
    if (last && last.knob === toggle.knob.id) return;
    ui.update(toggle.track.id, { width: 52, height: 32, radius: 16, clip: true, align: "center",
      padding: 0, borderWidth: 0, background: palette.track });
    ui.update(toggle.knob.id, { width: 2, height: 2, margin: [-6, 0, 0, 0], clip: false, background: 0 });
    skinSwitch(toggle.track, toggle.knob);
  }

  function tintSettingsRow(row) {
    if (/logout|delete|remove|danger|ログアウト|削除|登出|退出登[錄录]|刪除|删除/i.test(row.accessibilityId || "")) return;
    const inner = row.children.length === 1 ? ui.node(row.children[0]) : row;
    if (!inner || inner.children.length < 2) return;
    const parts = children(inner);
    const toggle = switchParts(row);
    const accessory = parts.length === 3 && parts[1].children.length === 1 ? ui.node(parts[1].children[0]) : null;
    const valueRow = accessory && accessory.children.length === 1 && !toggle;
    const leading = parts[0], second = parts[1];
    const twoPartIcon = parts.length === 2 && !toggle && !(
      !second.children.length && second.kind === "image"
    ) && (!second.children.length || children(second).every(n => !n.children.length && (!n.kind || n.kind === "text")));
    const hasIcon = leading.kind === "image" || (!leading.kind && !leading.children.length && !valueRow &&
      (parts.length >= 3 || twoPartIcon));
    if (hasIcon) ui.update(parts[0].id, { tint: palette.accent });
    const label = parts[hasIcon ? 1 : 0];
    const labels = label.children.length ? children(label) : [label];
    labels.forEach((n, i) => {
      if (!n.children.length && (!n.kind || n.kind === "text")) {
        ui.update(n.id, { color: i ? palette.muted : palette.ink });
      }
    });
    if (toggle) {
      tintSwitch(row, toggle);
    } else {
      const arrow = parts[parts.length - 1];
      if (arrow !== label && arrow.children.length === 1) tintIcon(arrow, palette.muted);
    }
  }

  function styleSection(section, depth = 0) {
    if (!section || !section.children.length || depth > 3 || section.accessibilityId === searchId) return;
    const parts = children(section);
    const group = parts[parts.length - 1], heading = parts[0];
    const hasHeading = parts.length === 2 && !heading.children.length && (!heading.kind || heading.kind === "text");
    if ((hasHeading || parts.length === 1) && group && styleGroup(group, settingsRow)) {
      if (hasHeading) ui.update(heading.id, { color: palette.accent, margin: [0, 0, 0, 6] });
      return;
    }
    // Detail pages may place a row group directly in the scroll content, or
    // nest whole sections one level deeper. A row contains its own content row.
    const direct = parts.filter(n => (n.children.length === 1 || pressable(n)) && settingsRow(n));
    if (direct.length && parts.every(n => direct.includes(n) || divider(n))) {
      styleGroup(section, settingsRow);
    } else if (!section.accessibilityId && !pressable(section)) {
      for (const child of parts) if (shellNode(child) && child.children.length) styleSection(child, depth + 1);
    }
  }

  function radioParts(row) {
    let body = row;
    for (let n = 0; n < 2 && shellNode(body) && body.children.length === 1; n++) body = ui.node(body.children[0]);
    const parts = children(body);
    if (parts.length !== 2) return null;
    const [label, trailing] = parts;
    const words = children(label);
    if (words.length < 1 || words.length > 2 || words.some(n => n.children.length || (n.kind && n.kind !== "text"))) return null;
    if (!shellNode(trailing) || trailing.children.length > 1) return null;
    return { label: words, ring: trailing };
  }

  function radioGroup(group) {
    const items = children(group).filter(n => !divider(n));
    if (items.length < 2 || items.length > 12) return false;
    const shapes = items.map(radioParts);
    if (shapes.some(p => !p)) return false;
    // Some versions add a wrapper around each ring. A radio group has both
    // empty rings and a ring with a dot. Never infer selection from row order.
    if (shapes.every(p => p.ring.children.length === 1)) {
      for (const p of shapes) p.ring = ui.node(p.ring.children[0]);
    }
    if (shapes.some(p => !shellNode(p.ring) || p.ring.children.length > 1) ||
        !shapes.some(p => !p.ring.children.length) || !shapes.some(p => p.ring.children.length)) return false;
    const dots = shapes.map(p => p.ring.children.length ? ui.node(p.ring.children[0]) : null);
    if (dots.some(n => n && (!shellNode(n) || n.children.length))) return false;
    const rowIds = new Set(items.map(n => n.id));
    styleGroup(group, n => !!n && rowIds.has(n.id));
    shapes.forEach((p, i) => {
      ui.update(p.ring.id, { width: 22, height: 22, radius: 11, borderWidth: 2, borderColor: dots[i] ? palette.accent : palette.handle,
        background: palette.row, align: "center", justify: "center" });
      if (dots[i]) ui.update(dots[i].id, { width: 10, height: 10, radius: 5, background: palette.accent });
      p.label.forEach((n, j) => ui.update(n.id, { color: j ? palette.muted : palette.ink }));
    });
    return true;
  }

  function detailWidgets(list, route) {
    if (!route.startsWith("settings-phoenix")) rememberLayout(/connect|linked/.test(route) ? "connections" :
      /content|social/.test(route) ? "content" : /privacy|data/.test(route) ? "privacy" : "settings", list);
    const work = [[list, 0]], connection = /connect|linked|authorized/.test(route);
    if (/content|social/.test(route)) {
      let top = ui.node(list.children[0]);
      for (let i = 0; i < 4 && shellNode(top); i++) {
        const pieces = children(top);
        if (pieces.length === 1) { top = pieces[0]; continue; }
        const tabs = pieces.filter(buttonLabel);
        if (tabs.length === 2 && pieces.length <= 3) {
          ui.update(top.id, { background: palette.row });
          for (const tab of tabs) ui.update(buttonLabel(tab).id, { color: palette.ink });
          for (const mark of pieces) if (!tabs.includes(mark) && shellNode(mark) && !mark.children.length) ui.update(mark.id, { background: palette.track });
        }
        break;
      }
    }
    const painted = new Set();
    for (let budget = 450; work.length && budget > 0; budget--) {
      const [node, depth] = work.pop();
      if (depth > 10 || !node.children.length || node.accessibilityId === searchId) continue;
      if (radioGroup(node)) continue;
      const toggle = switchParts(node);
      if (toggle && !painted.has(toggle.track.id)) {
        painted.add(toggle.track.id);
        ui.update(node.id, { background: palette.row });
        tintSettingsRow(node);
        if (connection) {
          let block = parent(node);
          for (let n = 0; n < 3 && shellNode(block) && block.id !== list.id; n++, block = parent(block)) {
            const siblings = children(block);
            if (siblings.length > 8 || !siblings.some(s => s.id !== node.id && switchParts(s))) continue;
            ui.update(block.id, { background: palette.row, radius: corners.outer });
            const card = parent(block);
            if (shellNode(card) && card.id !== list.id && card.children.length >= 2 && card.children.length <= 4 &&
                card.children[0] !== block.id) {
              ui.update(card.id, { background: palette.row, radius: corners.outer });
              const head = ui.node(card.children[0]);
              if (shellNode(head)) ui.update(head.id, { background: palette.sheet });
            }
            break;
          }
        }
        continue;
      }
      for (const n of children(node)) if (shellNode(n)) work.push([n, depth + 1]);
    }
  }

  function paintSettingsChrome(scroll) {
    const body = parent(scroll);
    if (!shellNode(body) || body.children.length !== 4 || body.children[2] !== scroll.id) return;
    const [inset, line, ,header] = children(body);
    if (!shellNode(header) || !header.children.length || !inset || inset.children.length || !line || line.children.length) return;
    for (const n of [body, inset, line, header]) ui.update(n.id, { background: palette.canvas });
  }

  function settingsFromTitle(title) {
    if (!/^settings[-.].+[-.]title$/.test(title.accessibilityId || "")) return;
    applyNativePalette();
    ui.update(title.id, { color: palette.ink });
    let header = parent(title);
    for (let depth = 0; depth < 5 && shellNode(header); depth++, header = parent(header)) {
      const body = parent(header);
      if (!shellNode(body) || body.children.length < 2 || body.children.length > 6) continue;
      const siblings = children(body).filter(n => n.id !== header.id);
      const scroll = siblings.find(n => n.kind === "scroll") ||
        (body.children.length === 4 && body.children[3] === header.id ? ui.node(body.children[2]) : null);
      if (!scroll || scroll.children.length !== 1 || (scroll.kind && scroll.kind !== "scroll")) continue;
      const list = ui.node(scroll.children[0]);
      if (list) {
        if (detailLists.size > 48) detailLists.clear();
        detailLists.set(list.id, title.accessibilityId);
        paintSettingsList(list);
      }
      return;
    }
  }

  function paintSettingsList(list) {
    lastSettings = list.id;
    lastSweep = Date.now();
    ui.update(list.id, { background: palette.canvas, gap: 18 });
    const scroll = parent(list);
    if (scroll && scroll.id !== ui.root() && scroll.children.length === 1 &&
        (scroll.kind == null || scroll.kind === "scroll")) {
      ui.update(scroll.id, { background: palette.canvas });
      paintSettingsChrome(scroll);
    }
    for (const id of list.children) styleSection(ui.node(id));
    if (detailLists.has(list.id)) {
      removeSkins(false);
      detailWidgets(list, detailLists.get(list.id));
    }
  }

  // A localized settings page can mount its search box before its named rows.
  // Only accept a sibling section with a heading and multiple settings rows.
  function settingsFromSearch(input) {
    styleSearch(input);
    let branch = input;
    for (let depth = 0; depth < 8; depth++) {
      const host = parent(branch);
      if (!host || host.id === ui.root() || host.kind === "navigator") return;
      const confirmed = host.children.some(id => {
        const section = id !== branch.id && ui.node(id);
        if (!section || section.children.length !== 2) return false;
        const header = ui.node(section.children[0]), group = ui.node(section.children[1]);
        return header && !header.children.length && (!header.kind || header.kind === "text")
          && group && group.children.filter(kid => settingsRow(ui.node(kid))).length >= 2;
      });
      if (confirmed) { paintSettingsList(host); return; }
      branch = host;
    }
  }

  function styleSettings(anchor, force = false) {
    // Same anchor chain used by Sunbird to place its own entry on the Discord
    // settings home screen: settings row > group > section > list.
    const group = parent(anchor), section = parent(group), list = parent(section);
    if (!group) return;
    if (!list || list.id === ui.root() || !section.children.includes(group.id)) {
      styleGroup(group, settingsRow);
      return;
    }
    const now = Date.now();
    if (force || lastSettings !== list.id || now - lastSweep >= 400) {
      paintSettingsList(list);
    } else {
      styleSection(section);
    }
  }

  function detailRow(node) {
    if (node.children.length === 1 && settingsRow(node)) styleSettings(node);
  }

  function styleMenu(node) {
    if (["message.actions.edit", "message.actions.delete", "message.actions.reply"].includes(node.accessibilityId)) {
      if (menuTargets.size > 120) menuTargets.clear();
      const pending = [node];
      for (let i = 0; pending.length && i < 16; i++) {
        const item = pending.pop();
        menuTargets.set(item.id, node.accessibilityId);
        pending.push(...children(item));
      }
    }
    if (reaction(node.accessibilityId)) {
      // This is a horizontal strip of standalone buttons, outside the grouped actions.
      ui.update(node.id, { background: palette.row, activeBackground: palette.pressed, radius: 999,
        radiusTopLeft: 999, radiusTopRight: 999, radiusBottomLeft: 999, radiusBottomRight: 999 });
    } else if (node.accessibilityId === menuRoot) {
      const id = node.kind === "sheet" ? node.id : node.sheet;
      if (id != null) ui.update(id, {
        background: palette.sheet, radiusTopLeft: 24, radiusTopRight: 24,
        handleColor: palette.handle, scrimColor: 0x99000000,
      });
      paintMenuGroups(node);
      rememberLayout("message-menu", node);
    } else {
      const root = menuAncestor(node);
      if (!root) return;
      let row = node;
      for (let depth = 0; depth < 3; depth++) {
        const wrap = parent(row);
        if (!shellNode(wrap) || wrap.id === root.id || wrap.children.length !== 1 || wrap.accessibilityId) break;
        const group = parent(wrap);
        if (!group || !children(group).some(n => n.id !== wrap.id && (action(n) || divider(n)))) break;
        row = wrap;
      }
      const group = parent(row);
      if (group && group.id !== root.id) styleGroup(group, menuRow);
    }
  }

  function sidebarRow(node) {
    return /^(?:navigation\.(?:channel:|category:|server:|messages$|add_server$)|dm\.row:)/.test(node.accessibilityId || "");
  }

  function styleSidebar(node) {
    const content = /^(?:navigation\.(?:channel|category):|dm\.row:)/.test(node.accessibilityId || "");
    const fill = content ? paneSurface() : { background: conversation.header };
    if (node.list != null && node.list !== ui.root()) {
      ui.update(node.list, fill);
      if (content) paintChannelPane(ui.node(node.list));
      return;
    }
    let group = parent(node);
    for (let depth = 0; depth < 4 && shellNode(group); depth++, group = parent(group)) {
      if (group.accessibilityId && !/^navigation\./.test(group.accessibilityId)) break;
      const lanes = children(group);
      if (lanes.filter(n => sidebarRow(n) || (n.children.length === 1 && children(n).some(sidebarRow))).length >= 2) {
        ui.update(group.id, fill);
        if (content) paintChannelPane(group);
        return;
      }
    }
  }

  const dockSlots = ["panels-dock-slot", "main-tabs-screen-dock-slot", "main-tabs-over-stack-dock-slot", "over-stack-dock-slot"];
  const plainSurface = { ...flat, gradient: null, gradientMask: null, backdropBlur: 0 };
  const noLine = { ...plainSurface, height: 0, minHeight: 0, opacity: 0 };

  function paintUserDock(dock) {
    const queue = [[dock, 0]];
    for (let budget = 75; queue.length && budget > 0; budget--) {
      const [n, depth] = queue.shift();
      if (!shellNode(n) || n.sheet != null || n.list != null || !n.children.length ||
          /^(?:composer|message\.|navigation\.|guild\.|chat-header|search.entry|settings)/.test(n.accessibilityId || "")) continue;
      const parts = children(n);
      if (parts.length > 6 || contains(n, c => c.kind === "list" || c.kind === "scroll" || sidebarRow(c), 2)) continue;
      const hasIdentity = c => contains(c, leaf =>
        /avatar|current.user|user.profile|user.status/i.test(leaf.accessibilityId || "") ||
        (leaf.kind === "image" && !leaf.children.length), 3);
      const namedEnd = c => contains(c, leaf => /notif|inbox|bell/i.test(leaf.accessibilityId || ""), 3);
      const end = parts[parts.length - 1];
      if (parts.length >= 2 && namedEnd(end) &&
          parts.slice(0, -1).some(hasIdentity)) {
        ui.update(n.id, { ...plainSurface, background: conversation.userBar });
        if (shellNode(end)) ui.update(end.id, { background: palette.sheet });
        return true;
      }
      if (depth < 4) for (const child of parts) queue.push([child, depth + 1]);
    }
    return false;
  }

  function clearLabelRules(node) {
    // Date and unread rows may carry their label in a text or accessibility
    // node. Only their two flanking strokes are decorative.
    const parts = children(node);
    if (parts.length !== 3 || !parts[1].children.length && parts[1].kind !== "text" &&
        !parts[1].accessibilityId && parts[1].kind != null) return;
    for (const n of [parts[0], parts[2]]) {
      if (!n.accessibilityId && !n.children.length && !pressable(n) && (!n.kind || n.kind === "view"))
        ui.update(n.id, { ...plainSurface, opacity: 0 });
    }
  }

  function paneSurface() {
    return { background: conversation.body, ...barRadii(26, 0), clip: true, borderWidth: 0, borderColor: 0 };
  }

  function childOf(node, ancestorId) {
    for (let depth = 0; node && depth < 12; depth++, node = parent(node)) {
      if (node.parent === ancestorId) return node;
    }
    return null;
  }

  function joinHeaderAndList(head, list) {
    const pane = commonFrame(head, list);
    if (!shellNode(pane) || pane.id === head.id || pane.id === list.id) return;
    const upper = childOf(head, pane.id), lower = childOf(list, pane.id);
    if (!upper || !lower || upper.id === lower.id) return;
    const hi = pane.children.indexOf(upper.id), lo = pane.children.indexOf(lower.id);
    if (hi < 0 || lo !== hi + 2) return;
    const rule = ui.node(pane.children[hi + 1]);
    if (rule && dividerName.test(rule.accessibilityId || "") && !rule.children.length && !pressable(rule))
      ui.update(rule.id, noLine);
  }

  function paintChannelPane(list) {
    if (!list || Date.now() - (seenPanels.get(list.id) || 0) < 180) return;
    const head = ui.find("guild.menu").map(id => ui.node(id)).find(n => n && commonFrame(n, list));
    if (!head) return;
    if (seenPanels.size >= 64) seenPanels.clear();
    seenPanels.set(list.id, Date.now());
    const pane = commonFrame(head, list);
    rememberLayout("channel-pane", pane);
    styleGuildHeader(head);
    joinHeaderAndList(head, list);
    for (const key of dockSlots) forLive(key, paintUserDock);
    let lane = list;
    for (let i = 0; i < 7; i++) {
      const frame = parent(lane);
      if (!frame || frame.id === ui.root() || frame.sheet != null || frame.kind === "navigator") break;
      const parts = children(frame), at = frame.children.indexOf(lane.id);
      if (parts.length <= 7) for (const sibling of parts.slice(at + 1)) if (paintUserDock(sibling)) return;
      lane = frame;
    }
  }

  function paintTopInset(header) {
    if (!header || header.sheet != null || header.list != null) return;
    applyNativePalette();
    if (headerNames.includes(header.accessibilityId) || header.accessibilityId === "guild-header-row")
      ui.update(header.id, { background: conversation.header });
  }

  function styleHeader(search) {
    applyNativePalette();
    tintIcon(search, palette.accent);
  }

  function cardSurface(n) {
    ui.update(n.id, { background: palette.row });
  }

  function styleNamedEmbed(node) {
    if (!shellNode(node) || !node.children.length || /thumbnail|preview-image|media|footer|author|description|title/i.test(node.accessibilityId)) return;
    cardSurface(node);
  }

  function paintEmbeds(content) {
    // A rich embed has a decorative side stripe beside a column of content.
    // Photo-only attachments and inline text runs have neither this stripe nor
    // this layout. Never recolor the stripe or descend into a recognized card.
    const work = children(content).map(node => [node, 0]);
    // In compact messages the text anchor and the embed can be siblings. Limit
    // this second starting point to the rest of the same message's local row.
    const row = parent(content);
    if (shellNode(row) && row.id !== content.list && row.id !== content.sheet && row.children.length <= 8 &&
        (!row.accessibilityId || /^message[.:]/.test(row.accessibilityId))) {
      const siblings = children(row), index = siblings.findIndex(n => n.id === content.id);
      if (index >= 0 && !siblings.some(n => n.id !== content.id && (n.accessibilityId || "").startsWith(messageMatch.prefix))) {
        for (const n of siblings.slice(index + 1)) if (shellNode(n)) work.push([n, 0]);
      }
    }
    let visited = 0;
    while (work.length && visited++ < 44) {
      const [node, depth] = work.pop();
      if (!shellNode(node)) continue;
      const name = node.accessibilityId || "";
      if (name.startsWith("embed:")) { styleNamedEmbed(node); continue; }
      if (name || !node.children.length) continue;
      const parts = children(node);
      if (parts.length === 2) {
        const [stripe, body] = parts;
        if (shellNode(stripe) && !stripe.accessibilityId && !stripe.children.length && !pressable(stripe) &&
            shellNode(body) && !body.accessibilityId && body.children.length >= 2 &&
            children(body).some(n => n.kind === "text" || (shellNode(n) && n.children.length)) &&
            !parts.some(n => n.kind === "image")) {
          cardSurface(node);
          continue;
        }
      }
      if (depth < 3 && !pressable(node)) for (const child of parts) work.push([child, depth + 1]);
    }
  }

  function paintCallRows(list) {
    for (let row of children(list)) {
      for (let i = 0; i < 4 && shellNode(row) && row.children.length === 1; i++) row = ui.node(row.children[0]);
      if (!shellNode(row) || (row.children.length !== 3 && row.children.length !== 2) ||
          contains(row, n => /^message\.(?:content|author|avatar):/.test(n.accessibilityId || ""), 3)) continue;
      const parts = children(row);
      const [phone, text, avatars] = parts.length === 2 && parts[0].children.length === 2 ?
        [...children(parts[0]), parts[1]] : parts;
      if (!phone || !text || !avatars || text.children.length !== 2 ||
          !children(text).every(n => !n.children.length && (!n.kind || n.kind === "text"))) continue;
      const image = n => n.kind === "image" || (!n.kind && !n.children.length) || iconBranch(n);
      if (!image(phone) || !(image(avatars) || (avatars.children.length > 0 && children(avatars).every(image)))) continue;
      ui.update(row.id, { background: palette.row });
      ui.update(text.children[0], { color: palette.ink });
      ui.update(text.children[1], { color: palette.muted });
    }
  }

  function clearEditing() {
    if (editLayer) editLayer.remove();
    editLayer = null;
    editingMessage = null;
    if (joinedBar) {
      const bar = ui.node(joinedBar.bar);
      if (bar) ui.update(bar.id, barRadii(20, 20));
      joinedBar = null;
    }
  }

  function styleContext(cancel) {
    let lane = parent(cancel);
    for (let i = 0; i < 3 && shellNode(lane) && lane.children.length === 1; i++) lane = parent(lane);
    if (!shellNode(lane) || lane.children.length > 4 || contains(lane, n => n.accessibilityId === "composer")) return;
    ui.update(lane.id, { ...flat, background: palette.row, ...barRadii(20, 0) });
    for (const n of children(lane)) {
      if (n.id === cancel.id || contains(n, c => c.id === cancel.id)) continue;
      const label = n.children.length === 1 ? ui.node(n.children[0]) : n;
      if (label && !label.children.length && (!label.kind || label.kind === "text")) ui.update(label.id, { color: palette.accent });
    }
    tintIcon(cancel, palette.accent);
    const frame = parent(lane);
    rememberLayout("edit-bar", frame);
    if (shellNode(frame) && frame.children.length === 2 && frame.children[0] === lane.id) {
      const divider = ui.node(frame.children[1]);
      if (divider && !divider.accessibilityId && !divider.children.length && shellNode(divider)) {
        ui.update(frame.id, { ...flat, background: palette.row, ...barRadii(20, 0) });
        ui.update(divider.id, { ...flat, height: 0, minHeight: 0, opacity: 0 });
      }
    }
    forLive("composer", input => {
      if (!commonFrame(lane, input)) return;
      if (editingMessage) { draftInput = input.id; hasDraft = true; }
      styleComposer(input);
    });
    paintEditedMessage(cancel);
  }

  const messageAnchors = ["content", "author", "avatar", "timestamp"];
  function paintEditedMessage(cancel) {
    if (!editingMessage || !ui.mount || !cancel) return;
    for (const type of messageAnchors) {
      const anchors = ui.find("message." + type + ":" + editingMessage);
      for (const id of anchors) {
        const anchor = ui.node(id);
        if (!anchor || anchor.list == null) continue;
        let row = anchor;
        for (let i = 0; i < 14 && row && row.parent !== anchor.list; i++) row = parent(row);
        if (!row || row.parent !== anchor.list) continue;
        if (editLayer && editLayer.row === row.id && editLayer.anchor === anchor.id) return;
        if (editLayer) editLayer.remove();
        const removes = [];
        const highlight = host => {
          const layers = children(host);
          let before = "start";
          for (let i = 0; i + 1 < layers.length; i++) {
            const n = layers[i];
            const decoration = n.kind === "view" && !n.accessibilityId && !n.children.length && !pressable(n);
            if (!decoration && !/^(?:message[.-])?(?:background|highlight)$/.test(n.accessibilityId || "")) break;
            before = layers[i + 1].id;
          }
          removes.push(ui.mount(host.id, switchFace({ width: "fill", height: "fill", background: palette.pressed }), { before }));
        };
        if (row.id === anchor.id) highlight(row);
        for (let host = parent(anchor), i = 0; row.id !== anchor.id && host && i < 14; host = parent(host), i++) {
          if (shellNode(host) && (host.id === row.id || host.children.length > 1)) highlight(host);
          if (host.id === row.id) break;
        }
        editLayer = { row: row.id, anchor: anchor.id, cancel: cancel.id, remove: () => { for (const remove of removes) remove(); } };
        return;
      }
    }
  }

  function buttonLabel(button) {
    if (!shellNode(button) || !button.children.length) return null;
    let n = button;
    for (let d = 0; d < 4 && n && n.children.length === 1; d++) n = ui.node(n.children[0]);
    return n && !n.children.length && (!n.kind || n.kind === "text") ? n : null;
  }

  function paintDialog(card) {
    const parts = children(card);
    if (parts.length < 2 || parts.length > 9) return false;
    const last = parts[parts.length - 1], foot = children(last);
    const actions = foot.length === 2 && foot.every(buttonLabel) ? foot : parts.slice(-2);
    if (actions.length !== 2 || !actions.every(buttonLabel) || actions.includes(parts[0])) return false;
    const heading = parts[0];
    if (!contains(heading, n => !n.children.length && (!n.kind || n.kind === "text"), 3)) return false;
    rememberLayout("confirmation", card);
    ui.update(card.id, { ...flat, background: palette.sheet, ...barRadii(24, 24) });
    if (actions === foot) ui.update(last.id, { background: 0 });
    actions.forEach((n, i) => {
      ui.update(n.id, { ...clearFill, background: i ? palette.row : palette.accent, ...barRadii(18, 18), activeBackground: palette.pressed });
      const label = buttonLabel(n);
      for (let inner = parent(label), depth = 0; inner && inner.id !== n.id && depth < 8; inner = parent(inner), depth++) ui.update(inner.id, clearFill);
      ui.update(buttonLabel(n).id, { color: i ? palette.ink : palette.onAccent });
    });
    return true;
  }

  function maybeDialog(anchor) {
    let spot = anchor;
    for (let i = 0; i < 8 && spot && spot.id !== ui.root() && spot.list == null; i++, spot = parent(spot)) {
      if (spot.accessibilityId === menuRoot) break;
      if (shellNode(spot) && paintDialog(spot)) { finishDialogWatch(); return; }
    }
  }

  function finishDialogWatch() {
    pendingDialog = 0;
    if (dialogWatch) { dialogWatch(); dialogWatch = null; }
  }

  function awaitDialog() {
    finishDialogWatch();
    pendingDialog = Date.now() + 2200;
    // Localized dialogs can name only their buttons. Look at newly mounted
    // nodes after the user opens the confirmation, then drop the watcher.
    dialogWatch = ui.onNode({ prefix: "" }, event => {
      if (Date.now() > pendingDialog) { finishDialogWatch(); return; }
      const n = ui.node(event.id);
      if (n && n.list == null && !menuAncestor(n)) maybeDialog(n);
    });
    forLive("delete-message", maybeDialog);
    if (pendingDialog && pickedMessage) for (const type of messageAnchors) {
      forLive("message." + type + ":" + pickedMessage, n => { if (n.list == null) maybeDialog(n); });
    }
  }

  function paintBubble(anchor) {
    if (anchor.list == null || anchor.sheet != null) return;
    const id = anchor.accessibilityId.slice(messageMatch.prefix.length);
    if (!/^\d+$/.test(id)) return;
    let box = anchor;
    // Walk only up this message's column. An avatar, reply preview, another
    // message, a date separator or the list itself marks the outer boundary.
    for (let depth = 0; depth < 5; depth++) {
      const up = parent(box);
      if (!shellNode(up) || up.id === anchor.list || up.sheet != null || up.children.length > 8 ||
          (up.accessibilityId && up.accessibilityId !== "message.body:" + id)) break;
      const others = children(up).filter(n => n.id !== box.id);
      if (!others.length) { if (up.parent === anchor.list) break; box = up; continue; }
      let companion = false, unsafe = false, budget = 48;
      const scan = [...others];
      while (scan.length && budget-- > 0) {
        const n = scan.pop(), aid = n.accessibilityId || "";
        if (/^message\.(?:avatar|content|reply)/.test(aid) || /divider|separator|^navigation\./.test(aid) ||
            (/^message\.(?:author|timestamp):/.test(aid) && !aid.endsWith(":" + id))) { unsafe = true; break; }
        if (aid === "message.author:" + id || aid === "message.timestamp:" + id ||
            /^(?:embed:|attachment[.:]|message\.attachments?:)/.test(aid)) companion = true;
        scan.push(...children(n));
      }
      if (unsafe || scan.length || !companion) break;
      box = up;
    }
    // Some builds use a labelled row containing the avatar as the content
    // anchor. Only its text/media column should receive the background.
    if (contains(box, n => n.accessibilityId === "message.avatar:" + id, 4)) {
      const lane = children(box).find(n => !contains(n, c => c.accessibilityId === "message.avatar:" + id, 4) &&
        contains(n, c => c.accessibilityId === "message.author:" + id || c.accessibilityId === "message.timestamp:" + id, 4));
      if (!lane) return;
      box = lane;
    }
    const list = ui.node(anchor.list);
    const row = childOf(box, anchor.list);
    if (!row || !list) return;
    const pos = row && list ? list.children.indexOf(row.id) : -1;
    const startsGroup = n => contains(n, c => /^message\.(?:author|avatar|reply):|^reply-preview/.test(c.accessibilityId || ""), 5);
    const messageRow = n => contains(n, c => /^message\.content:\d+$/.test(c.accessibilityId || ""), 5);
    const prev = pos > 0 ? ui.node(list.children[pos - 1]) : null;
    const next = pos >= 0 && pos + 1 < list.children.length ? ui.node(list.children[pos + 1]) : null;
    const joinedAbove = messageRow(prev) && !startsGroup(row);
    const joinedBelow = messageRow(next) && !startsGroup(next);
    ui.update(box.id, { background: conversation.bubble, radius: 16,
      radiusTopLeft: joinedAbove ? 4 : 16, radiusTopRight: joinedAbove ? 4 : 16,
      radiusBottomLeft: joinedBelow ? 4 : 16, radiusBottomRight: joinedBelow ? 4 : 16,
      padding: [10, 5, 10, 5] });
  }

  function styleChat(node) {
    if (node.list != null && node.list !== lastList) {
      const list = ui.node(node.list);
      if (list) {
        ui.update(list.id, paneSurface());
        for (const name of headerNames) forLive(name, h => joinHeaderAndList(h, list));
      }
      lastList = node.list;
      paintCallRows(ui.node(node.list));
    }
    paintBubble(node);
    paintEmbeds(node);
    if (editingMessage && node.accessibilityId === "message.content:" + editingMessage) forLive(contextCancel, paintEditedMessage);
  }

  function apply(choice) {
    selectedScheme = choice;
    const dark = choice === "light" ? false : choice === "dark" ? true : !(system && system.dark === false);
    const next = colorsFor(dark);
    if (palette && activeDark === dark && Object.keys(next).every(k => next[k] === palette[k])) return;
    activeDark = dark;
    removeSkins(true);
    if (editLayer) { editLayer.remove(); editLayer = null; }
    palette = next;
    conversation = {
      header: palette.canvas,
      userBar: dark ? palette.row : palette.canvas,
      body: dark ? mix(palette.canvas, palette.row, 0.48) : palette.row,
      bubble: dark ? mix(palette.row, palette.accent, 0.055) : mix(palette.canvas, palette.accent, 0.045),
    };
    applyNativePalette(true);
    for (const remove of rules) remove();
    rules = [];
    lastList = lastSettings = null;
    recentGroups.clear();
    switchOwners.clear();
    seenPanels.clear();
    const textField = { ...flat, radius: 0, color: palette.ink, selectionColor: palette.accent, placeholderColor: palette.muted };
    patch("composer", textField);
    patch(searchId, textField);
    patch("search.entry", { background: 0, activeBackground: palette.ripple, radius: 20, activeRadius: 20.5 });
    patch({ prefix: "message.author:" }, { fontWeight: 700 });
    patch({ prefix: "message.timestamp:" }, { color: palette.muted });
    for (const name of [...headerNames, "guild-header-row"]) patch(name, { ...flat, background: conversation.header });
    patch("composer-floating", { ...flat, gradient: null });
    for (const name of headerNames) forLive(name, paintTopInset);
    forLive("guild.menu", styleGuildHeader);
    patch("guard-gradient", { ...clearFill, gradient: null, opacity: 0 });
    forLive("search.entry", styleHeader);
    forLive("composer", styleComposer);
    forLive(contextCancel, styleContext);
    forLive(searchId, settingsFromSearch);
    forLive(messageMatch, styleChat);
    for (const name of ["date-divider", "unread-divider"]) forLive(name, clearLabelRules);
    forLive(menuMatch, styleMenu);
    forLive({ prefix: "phoenix." }, n => { if (menuAncestor(n)) styleMenu(n); });
    for (const match of sidebarMatches) forLive(match, styleSidebar);
    for (const key of dockSlots) forLive(key, paintUserDock);
    forLive("delete-message", maybeDialog);
    forLive({ prefix: "alert-title:" }, maybeDialog);
    forLive({ prefix: "embed:" }, styleNamedEmbed);
    forLive({ prefix: "settings-" }, settingsFromTitle);
    forLive({ prefix: "phoenix-" }, detailRow);
    for (const name of detailMatches) forLive(name, detailRow);
    const groups = new Set();
    forLive(settingsMatch, node => {
      if (!groups.has(node.parent)) {
        groups.add(node.parent);
        styleSettings(node);
      }
    });
  }

  const settings = phoenix.settings.define({
    scheme: {
      type: "select", title: "外觀", description: "支援系統外觀的 Sunbird 可跟隨系統深淺，Android 12 以上使用系統莫奈色板。無色板時使用玫瑰配色。",
      default: "system", options: [{ value: "system", label: "跟隨系統" }, { value: "dark", label: "深色" }, { value: "light", label: "淺色" }],
      onChange: apply,
    },
    inspect: {
      type: "switch", title: "記錄介面結構", default: false,
      description: "在本機記錄元件的排列，供檢查漏色的位置。",
      onChange: value => { recordLayouts = value; if (!value) layouts.clear(); },
    },
    copyLayout: {
      type: "button", title: "複製介面結構",
      onPress: () => phoenix.ui.copy(JSON.stringify({ version: "0.7.2", layouts: Object.fromEntries(layouts) })),
    },
  });
  recordLayouts = settings.inspect === true;
  function styleGuildHeader(node) {
    applyNativePalette();
    for (let i = 0; node && i < 5; i++, node = parent(node)) {
      if (node.accessibilityId === "guild-header-row") { paintTopInset(node); return; }
    }
  }
  for (const slot of dockSlots) watch(slot, paintUserDock);
  watch("guild.menu", head => {
    styleGuildHeader(head);
    forLive({ prefix: "navigation.channel:" }, n => {
      if (n.list != null && !seenPanels.has(n.list)) paintChannelPane(ui.node(n.list));
    });
  });
  for (const name of headerNames) watch(name, header => {
    paintTopInset(header);
    const list = lastList == null ? null : ui.node(lastList);
    if (list) joinHeaderAndList(header, list);
  });
  watch(contextCancel, styleContext);
  watch("delete-message", maybeDialog);
  watch({ prefix: "alert-title:" }, maybeDialog);
  watch({ prefix: "phoenix." }, n => { if (menuAncestor(n)) styleMenu(n); });
  watch("search.entry", styleHeader);
  watch("composer", styleComposer);
  watch(searchId, settingsFromSearch);
  for (const name of toolNames) watch(name, () => forLive("composer", styleComposer));
  watch(menuMatch, styleMenu);
  watch(settingsMatch, styleSettings);
  watch({ prefix: "settings-" }, settingsFromTitle);
  watch({ prefix: "phoenix-" }, detailRow);
  for (const name of detailMatches) watch(name, detailRow);
  for (const match of sidebarMatches) watch(match, styleSidebar);
  watch({ prefix: "embed:" }, styleNamedEmbed);
  for (const name of ["date-divider", "unread-divider"]) watch(name, clearLabelRules);
  watch(messageMatch, n => { styleChat(n); if (pendingDialog > Date.now() && n.list == null && n.sheet == null) maybeDialog(n); });
  watchers.push(ui.onEvent("rowLongPress", e => { pickedMessage = e.messageId || null; }));
  watchers.push(ui.onEvent("longPress", e => {
    const match = /^message\.(?:content|author|avatar|timestamp):(\d+)$/.exec(e.accessibilityId || "");
    if (e.messageId || match) pickedMessage = e.messageId || match[1];
  }));
  watchers.push(ui.onEvent("press", e => {
    const target = e.accessibilityId || menuTargets.get(e.node);
    if (target === "message.actions.edit") {
      clearEditing();
      editingMessage = e.messageId || pickedMessage;
      forLive(contextCancel, styleContext);
    } else if (target === "message.actions.delete") {
      awaitDialog();
    } else if (e.accessibilityId === contextCancel || sendNames.includes(e.accessibilityId) || e.node === inferredSend) {
      clearEditing();
    } else if (editLayer && !ui.node(editLayer.cancel)) clearEditing();
  }));
  watchers.push(ui.onEvent("submit", e => { if (e.accessibilityId === "composer") clearEditing(); }));
  watchers.push(ui.onEvent("scrollSettle", event => {
    if (editingMessage) forLive(contextCancel, paintEditedMessage);
    if (joinedBar && !ui.node(joinedBar.cancel)) clearEditing();
    const scrolled = ui.node(event.node);
    if (scrolled && seenPanels.has(scrolled.id)) paintChannelPane(scrolled);
    const list = lastSettings == null ? null : ui.node(lastSettings);
    if (list && (event.node === list.id || event.node === list.parent)) {
      paintSettingsList(list);
    } else if (lastList == null || event.node === lastList) {
      forLive(messageMatch, styleChat);
      if (lastList != null) paintCallRows(ui.node(lastList));
    }
  }));
  watchers.push(ui.onEvent("appeared", event => {
    const name = event.accessibilityId;
    if (pendingDialog > Date.now()) {
      const candidate = ui.node(event.node);
      if (candidate && candidate.list == null && !menuAncestor(candidate) &&
          (candidate.kind === "modal" || /^delete-message$|^alert-|^message\.(content|author|avatar|timestamp):/.test(name || ""))) maybeDialog(candidate);
    }
    if (joinedBar && !ui.node(joinedBar.cancel)) clearEditing();
    if (name !== searchId && name !== "composer" && name !== menuRoot && !toolNames.includes(name)
        && !/^settings-.+-title$/.test(name || "")) return;
    const node = ui.node(event.node);
    if (!node || node.accessibilityId !== name) return;
    if (name === searchId) settingsFromSearch(node);
    else if (name === "composer") styleComposer(node);
    else if (toolNames.includes(name)) forLive("composer", styleComposer);
    else if (name.startsWith("settings-")) settingsFromTitle(node);
    else styleMenu(node);
  }));
  watchers.push(ui.onEvent("changeText", event => {
    if (event.accessibilityId !== "composer") return;
    const value = typeof event.payload === "string" ? event.payload : event.payload && event.payload.text;
    if (typeof value !== "string") return;
    const filled = value.length > 0;
    if (draftInput === event.node && hasDraft === filled) return;
    draftInput = event.node;
    hasDraft = filled;
    const input = ui.node(event.node);
    if (input && input.accessibilityId === "composer") styleComposer(input);
  }));
  if (typeof ui.onChecked === "function") {
    watchers.push(ui.onChecked(snapshot => {
      const node = ui.node(snapshot.id);
      if (!node || typeof node.checked !== "boolean") return;
      const owner = switchOwners.get(node.id);
      if (owner == null) return;
      const row = ui.node(owner);
      const toggle = row && switchParts(row);
      if (toggle) tintSwitch(row, toggle, node.checked);
    }));
  }
  watchers.push(ui.onEvent("change", event => {
    if (!switchOwners.has(event.node)) return;
    const row = ui.node(switchOwners.get(event.node)), toggle = row && switchParts(row);
    if (!toggle || (event.node !== row.id && event.node !== toggle.track.id)) return;
    const data = event.payload;
    const checked = typeof data === "boolean" ? data : data &&
      (typeof data.accessibilityChecked === "boolean" ? data.accessibilityChecked : data.value);
    if (typeof checked === "boolean") tintSwitch(row, toggle, checked);
  }));
  watchers.push(ui.onEvent("focus", event => {
    const id = event.accessibilityId;
    if (id !== "composer" && id !== searchId) return;
    const node = ui.node(event.node);
    if (node && node.accessibilityId === id) (id === searchId ? styleSearch : styleComposer)(node);
  }));
  if (appearance && typeof appearance.onChange === "function") {
    watchers.push(appearance.onChange(value => { system = value; apply(selectedScheme); }));
    system = appearance.get();
  }
  apply(settings.scheme || "system");
  phoenix.onUnload(() => {
    // Omitting the optional background clears the host's cached startup
    // color. Discord supplies its current native palette on the next launch.
    if (nativeScheme && phoenix.bridge) phoenix.bridge.invoke(9, 84, { [hostTheme.dark]: activeDark });
    finishDialogWatch();
    removeSkins(true);
    clearEditing();
    for (const remove of watchers) remove();
    for (const remove of rules) remove();
  });
})();
