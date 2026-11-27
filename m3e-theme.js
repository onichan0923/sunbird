// @description Material 3 Expressive theme with Android system appearance and dynamic color.
// @version 0.11.6
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
  const channelPanel = "channel-list-panel";
  const guildHeads = ["guild.menu", "guild-header-row", "guild-title", "guild-search"];
  const contextCancel = "composer.context.cancel";
  const detailMatches = ["account-username","account-email","account-phone","account-mfa","account-age-group", "notif-in-app", "notif-behavior", "notif-other", "notif-system",
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
      const surface = original(n);
      const flags = surface ? [(surface.opaque || surface.backplate) && "fill", surface.gradient && "gradient",
        surface.horizontal && "row", surface.pressable && "press",
        surface.height > 0 && surface.height <= 80 && Math.ceil(surface.height)].filter(Boolean).join("+") : "";
      const label = [n.kind || surface?.kind || "?", known, flags, n.children.length].filter(x => x !== "").join("/");
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

  function original(node) {
    return node && typeof ui.surface === "function" ? ui.surface(node.id) : null;
  }

  function kindOf(n) { return n && (n.kind || original(n)?.kind); }
  function interactive(n) { return !!n && (pressable(n) || original(n)?.pressable); }

  function descendants(root, depth, limit) {
    const found = [], queue = root ? [[root, 0]] : [];
    for (let i = 0; i < queue.length && found.length < limit; i++) {
      const [node, level] = queue[i];
      found.push(node);
      if (level < depth) for (const n of children(node)) queue.push([n, level + 1]);
    }
    return found;
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

  function aboveChatList(host, branch) {
    return shellNode(host) && kindOf(host) === "view" && !original(host)?.horizontal && host.children.length <= 16 &&
      children(host).some(n => n.id !== branch.id && contains(n, c =>
        ["list", "scroll"].includes(kindOf(c)) && (c.id === lastList || c.accessibilityId === "chat-list" ||
          c.children.slice(0, 5).some(id => contains(ui.node(id), x => x.accessibilityId?.startsWith("message."), 3))), 4));
  }

  function paintDock(bar, notice = false) {
    let branch = bar;
    for (let depth = 0; depth < 6; depth++) {
      const host = parent(branch);
      if (notice && aboveChatList(host, branch)) {
        ui.update(host.id, { background: conversation.body, ...(original(host)?.backplate ? { bg: conversation.body } : {}) });
        break;
      }
      if (!shellNode(host) || host.list != null || host.sheet != null ||
          (host.accessibilityId && !/^composer(?:[.:-]|$)/.test(host.accessibilityId) &&
           !(notice && /^(?:thread-footer|chat-footer|chat-bottom|channel-footer)(?:$|[.:-])/.test(host.accessibilityId)))) break;
      const others = children(host).filter(n => n.id !== branch.id);
      const backing = n => !n.accessibilityId && shellNode(n) && !interactive(n) &&
        (!n.children.length || (n.children.length === 1 && children(n).every(c => shellNode(c) && !c.accessibilityId && !c.children.length)));
      // On release builds anonymous backdrop nodes have no kind. Clear their
      // paint, never their visibility or size, so an untagged child stays usable.
      if (others.length > 3 || !others.every(n => n.accessibilityId === "guard-gradient" || backing(n) ||
          contains(n, c => c.accessibilityId === contextCancel))) break;
      for (const n of others) {
        if (contains(n, c => c.accessibilityId === contextCancel)) continue;
        for (const layer of [n, ...children(n)]) ui.update(layer.id, { ...plainSurface, blur: null });
      }
      // An unmeasured stack may be a full-screen overlay above the messages.
      const dock = (notice && (original(host)?.height > 0 || aboveChatList(parent(host), host))) || host.accessibilityId === "composer-floating" ||
        (!notice && (others.some(n => n.accessibilityId === "guard-gradient") || (others.length === 2 && others.every(backing))));
      ui.update(host.id, { ...plainSurface, blur: null, background: dock ? conversation.body : 0, radius: 0 });
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
    ui.update(bar.id, { ...plainSurface, blur: null, background: conversation.control, clip: true, ...barRadii(cancel ? 0 : 20, 20) });
    if (cancel) joinedBar = { bar: bar.id, cancel: cancel.id };
    paintDock(bar);
    const cleared = new Set();
    for (const control of [input, ...buttons]) {
      for (let n = parent(control); n && n.id !== bar.id && !cleared.has(n.id); n = parent(n)) {
        cleared.add(n.id);
        ui.update(n.id, { ...plainSurface, blur: null });
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
    ui.update(frame.id, { ...clearFill, background: conversation.control, radius: 20 });
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
    if (!node || node.accessibilityId === searchId || isSocialTab(node)) return false;
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
        background: isRow === menuRow ? conversation.control : palette.row, activeBackground: palette.pressed, borderWidth: 0, borderColor: 0,
        radiusTopLeft: before ? corners.inner : corners.outer, radiusTopRight: before ? corners.inner : corners.outer,
        radiusBottomLeft: after ? corners.inner : corners.outer, radiusBottomRight: after ? corners.inner : corners.outer,
        margin: [0, 0, 0, after ? corners.gap : 0],
      });
      if (isRow === settingsRow) { clearRowFace(node); tintSettingsRow(node); }
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

  function isSocialTab(node) {
    for (let i = 0; node && i < 6; i++, node = parent(node)) {
      if (node.accessibilityId === "social-tabs" || original(node)?.role === "tablist" || original(node)?.role === "tab") return true;
    }
    return false;
  }

  function switchParts(row) {
    if (!row || isSocialTab(row) || ["radio","radiogroup"].includes(original(row)?.role)) return null;
    // A row may expose the checked state on itself, its accessory, or a nested switch.
    const semantic = descendants(row, 4, 18).find(n => original(n)?.role === "switch");
    if (semantic && (semantic.id === row.id || (original(row)?.horizontal || interactive(row))) &&
        !descendants(row, 4, 18).some(n => n.id !== semantic.id && original(n)?.role === "switch")) {
      const track = descendants(semantic, 5, 20).find(n => {
        const knob = n.children.length === 1 && ui.node(n.children[0]);
        const h = original(n)?.height, kh = original(knob)?.height;
        return knob && shellNode(n) && shellNode(knob) && !knob.children.length && h >= 22 && h <= 36 && kh >= 12 && kh <= 30;
      });
      if (track && parent(track)) return {track, knob: ui.node(track.children[0]), control: semantic};
    }
    const inner = row.children.length === 1 ? ui.node(row.children[0]) : row;
    const parts = children(inner);
    if (parts.length < 2 || parts.length > 3) return null;
    const label = parts[parts.length - 2], wrap = parts[parts.length - 1];
    if (wrap.children.length !== 1 || label.children.length > 2 || (label.kind === "image")) return null;
    const track = ui.node(wrap.children[0]);
    if (!shellNode(track) || track.children.length !== 1) return null;
    const knob = ui.node(track.children[0]);
    if (!shellNode(knob) || knob.children.length || ["text","image","markup"].includes(kindOf(knob))) return null;
    const controlRole = original(row)?.role || original(inner)?.role;
    if (controlRole && controlRole !== "switch" && controlRole !== "checkbox") return null;
    if (controlRole || [row.checked,inner.checked,track.checked].some(v => typeof v === "boolean")) return { track, knob };
    const rail = original(track), cap = original(knob);
    return rail?.height >= 24 && rail.height <= 36 && cap?.height >= 14 && cap.height <= 26 ? { track, knob } : null;
  }

  function switchFace(props, kids = []) {
    return { kind: "view", props: { absolute: true, gravity: "center", pointerEvents: "none",
      accessibilityHidden: true, ...props }, children: kids };
  }

  // The Android renderer reads these tags from zero-size decorative children.
  // Discord keeps ownership of the real control's nativeID and accessibility.
  const surfaceTags = new Map();
  function markSurface(node, tag, child) {
    if (!ui.androidControlSurfaces || !ui.mount) return;
    const old = surfaceTags.get(node.id);
    if (old?.tag === tag && old.child === child &&
        (Date.now() - old.created < 200 || !old.remove.isMounted || old.remove.isMounted())) return;
    old?.remove();
    const remove = ui.mount(node.id, switchFace({ width: 0, height: 0, nativeID: "sunbird.m3e/" + tag }));
    surfaceTags.set(node.id, { tag, child, remove, created: Date.now() });
  }

  function clearSurfaceTags(all = false) {
    for (const [id, tag] of surfaceTags) {
      if (!all && ui.node(id)?.children.includes(tag.child)) continue;
      tag.remove();
      surfaceTags.delete(id);
    }
  }

  function primaryAction(button, label, radius) {
    if (label) markSurface(button, "action/" + palette.accent.toString(16) + "/" + radius,
      childOf(label, button.id)?.id);
  }

  function removeSkins(all) {
    for (const [id, skin] of switchSkins) {
      const track = !all && ui.node(id);
      if (track && track.children.includes(skin.knob)) continue;
      for (const remove of skin.remove) remove();
      switchSkins.delete(id);
    }
  }

  function handleMark(checked) {
    const stroke = (width, x, y, rotation) => switchFace({ width, height: 1.8, radius: 0.9,
      background: checked ? palette.accent : palette.track, translateX: x, translateY: y, rotation });
    return checked ? [stroke(5.7, -3.4, 1.2, 45), stroke(11.3, 1.9, -0.8, -45)] :
      [stroke(11, 0, 0, 45), stroke(11, 0, 0, -45)];
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
    const checkedThumb = switchFace({ width: 24, height: 24, radius: 12,
      translateX: -2, background: palette.onAccent }, handleMark(true));
    // x = 24 splits the 52dp rail between the 16dp off and 24dp on thumbs.
    const base = ui.mount(track.id, switchFace({ width: 52, height: 32, radius: 16, clip: true }, [
      offRail(),
      switchFace({ width: 24, height: 24, radius: 12, translateX: -10, background: palette.handle }, handleMark(false)),
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
    const thumb = switchFace({ width: 24, height: 24, radius: 12, scaleX: 1 / scale,
      background: checked ? palette.onAccent : palette.handle }, handleMark(checked));
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
    if (toggle.control) switchOwners.set(toggle.control.id, row.id);
    switchOwners.set(toggle.track.id, row.id);
    const last = switchSkins.get(toggle.track.id);
    const checked = [reported, toggle.control?.checked, row.checked, toggle.track.checked,
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

  function themeRadio(row) {
    const all = descendants(row, 5, 26);
    let ring = all.find(n => n.id !== row.id && !["text","markup"].includes(kindOf(n)) &&
      original(n)?.height >= 14 && original(n).height <= 30 && (original(n).topLeft >= 6 || kindOf(n) === "image"));
    if (!ring) {
      let body = row;
      while (body && body.children.length === 1) body = ui.node(body.children[0]);
      if (body && original(body)?.horizontal) ring = children(body).at(-1);
    }
    if (!ring) return;
    const checked = row.checked ?? original(row)?.selected ?? ring.checked;
    if (typeof checked !== "boolean") return;
    if (kindOf(ring) === "image" || kindOf(ring) === "ring") {
      const color = checked ? palette.accent : palette.handle;
      ui.update(ring.id, {tint: color, color, borderColor: color});
    }
    else {
      ui.update(ring.id, {background: checked ? palette.accent : 0, borderColor: checked ? palette.accent : palette.handle});
      for (const dot of descendants(ring, 2, 5).slice(1)) {
        if (kindOf(dot) === "image") ui.update(dot.id, {tint: palette.onAccent});
        else if (!dot.children.length) ui.update(dot.id, {background: checked ? palette.onAccent : 0});
      }
    }
  }

  function radioGroup(group) {
    const items = children(group).filter(n => !divider(n));
    if (items.length < 2 || items.length > 12) return false;
    const semantic = items.map(n => descendants(n, 3, 12).find(c => original(c)?.role === "radio"));
    if (semantic.every(n => n && typeof (n.checked ?? original(n)?.selected) === "boolean")) {
      const ids = new Set(items.map(n => n.id));
      styleGroup(group, n => n && ids.has(n.id));
      for (let i = 0; i < items.length; i++) {
        clearRowFace(items[i]);
        themeRadio(semantic[i]);
      }
      return true;
    }
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

  function clearRowFace(row) {
    ui.update(row.id, {bg: 0, background: palette.row, activeBackground: palette.pressed});
    let n = row;
    while (n.children.length === 1) {
      n = ui.node(n.children[0]);
      if (!n || !["view","stack"].includes(kindOf(n))) break;
      ui.update(n.id, {bg: 0, background: 0, backgroundGradient: null});
    }
  }

  function privacyRows(group) {
    // The privacy page mixes solitary navigation preferences and grouped
    // radio options. Their labels and accessory can be wrapped separately.
    const rows = children(group).filter(n => !divider(n));
    if (!rows.length || rows.length > 12) return false;
    const matches = [];
    const kind = n => n?.kind || original(n)?.kind;
    for (const row of rows) {
      let body = row, actionable = false;
      for (let d = 0; body && d < 5; d++) {
        actionable ||= !!(pressable(body) || original(body)?.pressable || body.checked != null);
        if (body.children.length !== 1) break;
        body = ui.node(body.children[0]);
      }
      if (!body || !actionable || !original(body)?.horizontal || ![2,3].includes(body.children.length)) return false;
      const pieces = children(body);
      const [label, accessory] = pieces.slice(-2);
      if (pieces.length === 3 && !descendants(pieces[0],2,5).some(n => kind(n) === "image")) return false;
      let text = label;
      while (text && text.children.length === 1) text = ui.node(text.children[0]);
      const labels = text?.children.length ? children(text) : [text];
      if (!labels.length || !labels.every(n => kind(n) === "text") || !accessory ||
          accessory.children.length > 1 || switchParts(row)) return false;
      matches.push({row,body,labels,icon: pieces.length === 3 ? pieces[0] : null});
    }
    const ids = new Set(rows.map(r => r.id));
    styleGroup(group, n => n && ids.has(n.id));
    for (const {row,body,labels,icon} of matches) {
      if (icon) for (const n of descendants(icon,2,5)) if (kind(n) === "image") ui.update(n.id,{tint:palette.accent});
      for (let n = body; n && n.id !== row.id; n = parent(n)) {
        if (original(n)?.opaque || original(n)?.backplate) ui.update(n.id, { background: 0, bg: 0 });
      }
      ui.update(row.id, { bg: 0, background: palette.row });
      labels.forEach((label,i) => ui.update(label.id, {color: i ? palette.muted : palette.ink}));
    }
    return true;
  }

  function preferenceGroup(group) {
    // Account value rows can contain a title, a value and chevron in separate
    // wrappers. Verify each row has one action and a label before styling the group.
    const rows = children(group).filter(n => !divider(n));
    if (!rows.length || rows.length > 16) return false;
    const actions = rows.map(row => {
      let n = row;
      for (let d = 0; n && d < 5; d++) {
        if (isSocialTab(n) || ["radio","radiogroup"].includes(original(n)?.role)) return null;
        if ((interactive(n) || ["button","switch"].includes(original(n)?.role)) &&
            descendants(n,4,20).some(c => kindOf(c) === "text")) return n;
        n = n.children.length === 1 ? ui.node(n.children[0]) : null;
      }
      return null;
    });
    if (!actions.every(Boolean)) return false;
    const ids = new Set(rows.map(n => n.id));
    styleGroup(group, n => !!n && ids.has(n.id));
    rows.forEach((row,i) => {
      const action = actions[i];
      clearRowFace(row);
      const toggle = switchParts(action) || switchParts(row);
      if (toggle) tintSwitch(action,toggle);
      for (const n of descendants(action, 4, 28)) {
        if (n.id === row.id || (toggle && (n.id === toggle.track.id || n.id === toggle.knob.id || childOf(n,toggle.track.id)))) continue;
        if (["view","stack"].includes(kindOf(n)) && n.children.length &&
            (n.id === action.id || original(n)?.horizontal) && (original(n)?.opaque || original(n)?.backplate)) {
          ui.update(n.id,{background:0,bg:0,backgroundGradient:null});
        }
      }
    });
    return true;
  }

  function paintTabs(root) {
    if (!root) return;
    const all = descendants(root,5,42);
    const tabs = all.filter(n => n.id !== root.id && original(n)?.role === "tab");
    if (!tabs.length) {
      const rail = all.find(n => children(n).filter(c => interactive(c) && buttonLabel(c)).length === 2);
      if (rail) tabs.push(...children(rail).filter(c => interactive(c) && buttonLabel(c)));
    }
    if (tabs.length !== 2) return;
    let rail = parent(tabs[0]);
    while (rail && rail.id !== root.id && !childOf(tabs[1],rail.id)) rail = parent(rail);
    if (!rail) return;
    const states = tabs.map(n => original(n)?.selected ?? n.checked);
    // In 357200 the animated indicator is in a parallel lane behind the two
    // actual buttons. Keep its native position when selection is not exposed.
    const lane = parent(rail);
    const backdrop = lane && children(lane).find(c => c.id !== rail.id && original(c)?.horizontal && c.children.length === 2);
    if (!backdrop && states.every(v => typeof v !== "boolean")) return;
    const track = backdrop && lane.children.length === 2 ? lane : rail;
    if (track === lane) {
      const indicator = children(backdrop)[0];
      for (const n of descendants(backdrop,3,18)) {
        if (!["view","stack"].includes(kindOf(n))) continue;
        const movingPill = n.id === indicator.id && states.every(v => typeof v !== "boolean");
        ui.update(n.id,{...plainSurface,blur:null,background:movingPill ? palette.pressed : 0,radius:18});
      }
    }
    for (let n = backdrop ? parent(lane) : parent(rail); shellNode(n) && n.children.length === 1; n = parent(n)) {
      ui.update(n.id,{ ...plainSurface, blur: null });
      if (n.id === root.id) break;
    }
    if (track !== rail) ui.update(rail.id, { ...plainSurface, blur: null });
    ui.update(track.id, { ...plainSurface, blur: null, background: conversation.control, radius: 999, clip: true });
    for (const n of descendants(rail,4,32)) {
      if (n.id === rail.id || tabs.some(t => t.id === n.id) || !["view","stack"].includes(kindOf(n))) continue;
      ui.update(n.id,{ ...plainSurface, blur: null });
    }
    tabs.forEach((tab,i) => {
      const checked = states[i] ?? (typeof states[1-i] === "boolean" && !states[1-i]);
      ui.update(tab.id,{...plainSurface,blur:null,background:checked ? palette.accent : 0,radius:18});
      for (const n of descendants(tab,4,14)) if (kindOf(n) === "text")
        ui.update(n.id,{background:0,bg:0,color:checked ? palette.onAccent : palette.ink});
    });
  }

  function refreshTabs(tab) {
    for (let n = parent(tab), d = 0; n && d < 4 && n.id !== ui.root(); n = parent(n), d++) {
      if (n.accessibilityId === "social-tabs" || original(n)?.role === "tablist" ||
          children(n).filter(c => original(c)?.role === "tab").length === 2) { paintTabs(n); return; }
    }
    forLive("social-tabs",paintTabs);
  }

  function detailWidgets(list, route) {
    if (!route.startsWith("settings-phoenix")) rememberLayout(/connect|linked/.test(route) ? "connections" :
      /content|social/.test(route) ? "content" : /privacy|data/.test(route) ? "privacy" : "settings", list);
    const work = [[list, 0]], connection = /connect|linked|authorized/.test(route);
    if (/content|social/.test(route)) {
      forLive("social-tabs", paintTabs);
      const first = ui.node(list.children[0]);
      if (first && (list.accessibilityId === "social-pages" || children(list).some(n => n.accessibilityId === "social-pager" || kindOf(n) === "other"))) paintTabs(first);
    }
    const painted = new Set();
    for (let budget = 700; work.length && budget > 0; budget--) {
      const [node, depth] = work.pop();
      if (depth > 17 || !node.children.length || node.accessibilityId === searchId) continue;
      if (isSocialTab(node)) continue;
      if (radioGroup(node) || preferenceGroup(node) || privacyRows(node)) continue;
      const toggle = switchParts(node);
      if (toggle && !painted.has(toggle.track.id)) {
        painted.add(toggle.track.id);
        ui.update(node.id, { background: palette.row });
        tintSettingsRow(node);
        tintSwitch(node,toggle);
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
      for (const n of children(node)) if (n.children.length &&
          !["image","text","markup","input","sheet","modal","navigator"].includes(kindOf(n))) work.push([n, depth + 1]);
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
      const scroll = siblings.find(n => ["scroll","list"].includes(kindOf(n))) ||
        siblings.flatMap(n => descendants(n,3,18)).find(n => ["scroll","list"].includes(kindOf(n))) ||
        (body.children.length === 4 && body.children[3] === header.id ? ui.node(body.children[2]) : null);
      if (!scroll || !scroll.children.length || (scroll.kind && !["scroll","list"].includes(scroll.kind))) continue;
      const list = scroll.children.length === 1 ? ui.node(scroll.children[0]) : scroll;
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

  function preferenceSection(anchor) {
    let list=anchor;
    for(let i=0; list && i<10; list=parent(list),i++) {
      if (!["scroll","list"].includes(kindOf(list))) continue;
      const content=list.children.length===1 ? ui.node(list.children[0]) : list;
      if (content) detailWidgets(content, anchor.accessibilityId.startsWith("privacy-") ? "privacy" : "content-social");
      return;
    }
  }

  function detailRow(node) {
    if (node.children.length === 1 && settingsRow(node)) styleSettings(node);
    if ((node.accessibilityId || "").startsWith("account-")) {
      for (let n=node,d=0; n && d<7; n=parent(n),d++) if (preferenceGroup(n)) break;
    }
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
      ui.update(node.id, { background: conversation.control, activeBackground: palette.pressed, radius: 999,
        radiusTopLeft: 999, radiusTopRight: 999, radiusBottomLeft: 999, radiusBottomRight: 999 });
    } else if (node.accessibilityId === menuRoot) {
      const id = node.kind === "sheet" ? node.id : node.sheet;
      if (id != null) ui.update(id, {
        background: conversation.menu, radiusTopLeft: 24, radiusTopRight: 24,
        handleColor: palette.handle, scrimColor: 0x99000000,
      });
      // The sheet and the scrollable action content are separate surfaces on 357200.
      ui.update(node.id, { background: conversation.menu, borderWidth: 0 });
      const actions = ui.node(node.children[node.children.length - 1]);
      if (actions && children(actions).some(group => children(group).some(action))) {
        ui.update(actions.id, { background: conversation.menu });
      }
      // On 357200 the hint follows the quick reactions inside the first section.
      let top = ui.node(node.children[0]);
      while (top && top.children.length === 1) top = ui.node(top.children[0]);
      if (top?.children.length === 2) {
        const [strip, hint] = children(top);
        const parts = children(hint), edit = parts.at(-1);
        if (parts.length === 3 && contains(strip, n => reaction(n.accessibilityId || ""), 3) &&
            edit && !edit.children.length && (edit.kind || original(edit)?.kind) === "text") {
          ui.update(edit.id, { color: palette.accent });
        }
      }
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

  const dmHeaders = new Map();
  function styleSidebar(node) {
    if (node.accessibilityId?.startsWith("dm.row:") && node.list != null &&
        Date.now() - (dmHeaders.get(node.list) || 0) > 500) {
      if (dmHeaders.size > 30) dmHeaders.clear();
      dmHeaders.set(node.list,Date.now()); dmActions(node);
    }
    const content = /^(?:navigation\.(?:channel|category):|dm\.row:)/.test(node.accessibilityId || "");
    const viewport = viewportFor(node);
    if (viewport && viewport.id !== ui.root()) {
      if (!content || !seenPanels.has(viewport.id)) {
        ui.update(viewport.id, content ? channelSurface(viewport) : { background: conversation.header });
      }
      if (content) paintChannelPane(viewport);
      return;
    }
    let group = parent(node);
    for (let depth = 0; depth < 4 && shellNode(group); depth++, group = parent(group)) {
      if (group.accessibilityId && !/^navigation\./.test(group.accessibilityId)) break;
      const lanes = children(group);
      if (lanes.filter(n => sidebarRow(n) || (n.children.length === 1 && children(n).some(sidebarRow))).length >= 2) {
        ui.update(group.id, content ? channelSurface(group) : { background: conversation.header });
        if (content) paintChannelPane(group);
        return;
      }
    }
  }

  const dockSlots = ["panels-dock-slot", "main-tabs-screen-dock-slot", "main-tabs-over-stack-dock-slot", "over-stack-dock-slot"];
  const gradients = { gradient: null, backgroundGradient: null, activeBackgroundGradient: null, gradientMask: null, maskGradient: null };
  const plainSurface = { ...flat, ...gradients, backdropBlur: 0 };

  // Preserve overlay transparency. Full-frame hosts may cover both navigation stacks.
  function tintBacking(node, color) {
    const surface = original(node);
    if (node && node.id !== ui.root() && (surface?.opaque || surface?.backplate) && ["view", "stack"].includes(surface.kind)) {
      ui.update(node.id, { ...(surface.opaque ? { background: color } : {}), ...(surface.backplate ? { bg: color } : {}),
        borderWidth: 0, borderColor: 0, bgBorderWidth: 0 });
    }
  }

  const headerEdge = {
    borderWidth: 0, borderColor: 0, bgBorder: 0, bgBorderWidth: 0, hairline: false,
    shadow: null, bgShadow: null, activeShadow: null, shadowOutset: null, elevation: 0, elevationColor: 0,
  };

  const drawerEdge = { ...headerEdge, borderLeft: null, borderSides: null, activeBorderLeft: null,
    activeBorderSides: null, activeBorderWidth: 0, activeBorderColor: 0, focusBorderColor: 0 };
  const squareDrawerTop = { ...drawerEdge, radiusTopLeft: 0, radiusTopRight: 0, bgRadius: 0 };
  const railMarkers = ["navigation.messages", "navigation.add_server", { prefix: "navigation.server:" }];

  function railBranch(n) {
    return serverRail(n) || railMarkers.some(match => ui.findDown?.(n.id, match, 7) != null);
  }

  // A separator may be an extra painted view between the two columns or a
  // clipped outline above them in a stack. Leave named content, controls,
  // thumbnails and the sidebar's own list separators alone.
  function clearDrawerRule(node, between, overPanel) {
    const layers = [];
    for (let n = node; n && layers.length < 5;) {
      const info = original(n);
      if (!info || !["view", "stack"].includes(info.kind) || info.pressable || pressable(n) ||
          (n.accessibilityId && !dividerName.test(n.accessibilityId)) || n.children.length > 1) return;
      layers.push(n);
      if (!n.children.length) {
        const named = layers.some(c => dividerName.test(c.accessibilityId || ""));
        const hairline = layers.some(c => { const h = original(c).height; return h > 0 && h <= 1; });
        const outline = overPanel && layers.some(c => {
          const f = original(c); return !f.opaque && !f.backplate && (f.topLeft > 0 || f.topRight > 0);
        });
        if (between || named || hairline || outline) {
          for (const c of layers) ui.update(c.id, { ...plainSurface, ...drawerEdge });
        } else if (overPanel) {
          for (const c of layers) ui.update(c.id, drawerEdge);
        }
        return;
      }
      n = ui.node(n.children[0]);
    }
  }

  function clearRailEdge(rail) {
    let n = rail;
    // Follow the outer rail shell to the server viewport. The small rule
    // under the DM shortcut lives inside that viewport and stays untouched.
    for (let depth = 0; n && depth < 5; depth++) {
      const f = original(n);
      if (serverRail(n) || !f || f.pressable || !["view", "stack", "list", "scroll"].includes(f.kind)) return;
      ui.update(n.id, drawerEdge);
      if (f.kind === "list" || f.kind === "scroll") return;
      const parts = children(n), inner = parts.find(railBranch);
      if (!inner) return;
      for (const c of parts) if (c.id !== inner.id && (f.horizontal || f.kind === "stack")) {
        clearDrawerRule(c, f.horizontal, f.kind === "stack");
      }
      n = inner;
    }
  }

  function clearDrawerEdges(start) {
    let branch = start, split = false;
    for (let depth = 0; branch && depth < 12; depth++) {
      const frame = parent(branch), f = original(frame);
      if (!frame || frame.id === ui.root() || frame.sheet != null || f?.pressable ||
          !["view", "stack"].includes(f?.kind) || frame.children.length > 10) break;
      const parts = children(frame), at = frame.children.indexOf(branch.id);
      const rail = !split && (f.horizontal || f.kind === "stack")
        ? parts.findIndex((n, i) => i !== at && railBranch(n)) : -1;
      if (rail >= 0) {
        split = true;
        clearRailEdge(parts[rail]);
        ui.update(branch.id, squareDrawerTop);
        tintBacking(frame, conversation.header);
      }
      if (!split) {
        const margin = original(branch)?.margin;
        // A one-pixel gutter can expose the frame's original gray fill even
        // after its border is cleared. Keep the native layout and color the gutter.
        if ([f.padding, margin].some(edges => edges && [edges[0], edges[1]].some(v => v > 0 && v <= 1))) {
          tintBacking(frame, conversation.header);
        }
        ui.update(frame.id, squareDrawerTop);
      } else ui.update(frame.id, drawerEdge);
      for (let i = 0; i < parts.length; i++) {
        if (i === at || i === rail) continue;
        clearDrawerRule(parts[i], rail >= 0 && i > Math.min(rail, at) && i < Math.max(rail, at), f.kind === "stack" && i > at);
      }
      if (frame.accessibilityId === "home-shell" || frame.accessibilityId === "main-tabs") break;
      branch = frame;
    }
  }

  function stripHeaderEdge(node) {
    const info = original(node);
    if (node && node.id !== ui.root() && ["view", "stack"].includes(info?.kind)) ui.update(node.id, headerEdge);
  }

  function clearGradient(node) {
    if (!node || node.id === ui.root()) return;
    if (original(node)?.gradient || node.accessibilityId === "main-frame-gradient") ui.update(node.id, gradients);
  }

  // Both the pinned header and the first scrolling row end in a one-dp
  // rule. The list itself starts above the scrolling copy of the toolbar.
  function guildSeam(node) {
    if (!node || node.children.length || node.accessibilityId) return false;
    const shape = original(node);
    if (shape?.kind !== "view" || shape.pressable || !(shape.height > 0 && shape.height <= 1)) return false;
    const header = parent(node);
    if (!header || header.children.length !== 3 || header.children[2] !== node.id) return false;
    const [title, actions] = children(header);
    return title?.accessibilityId === "guild.menu" && original(actions)?.horizontal && actions.children.length >= 2;
  }

  function guildHeaderEdge(title) {
    const id = title?.accessibilityId === "guild.menu" ? parent(title)?.children[2] : null;
    const edge = id == null ? null : ui.node(id);
    return guildSeam(edge) ? edge : null;
  }

  const categoryInsets = new Map();
  function restoreCategory(listId) {
    const previous = categoryInsets.get(listId);
    if (!previous) return;
    for (const [id, keys] of previous) {
      const node = ui.node(id);
      if (!node) continue;
      const source = original(node);
      ui.update(id, Object.fromEntries(keys.map(key => [key, source?.[key] || 0])));
    }
    categoryInsets.delete(listId);
  }

  function compactFirstCategory(list) {
    const [header, row] = list.children.slice(0, 2).map(id => ui.node(id));
    // The first visible row of a recycled list need not be the first category.
    const afterToolbar = header && ui.findDown?.(header.id, "guild.menu", 4) != null;
    const path = [];
    if (afterToolbar) {
      let n = row;
      while (n && path.length < 5 && shellNode(n)) {
        path.push(n);
        const name = n.accessibilityId || "";
        if (name.startsWith("navigation.category:") ||
            (name.startsWith("navigation.channel:") && original(n)?.pressable && original(n)?.horizontal &&
             children(n).some(c => children(c)[0] && kindOf(children(c)[0]) === "text"))) break;
        if (name || n.children.length !== 1) { path.length = 0; break; }
        n = ui.node(n.children[0]);
      }
    }
    const target = path[path.length - 1];
    if (!/^navigation\.(?:category|channel):/.test(target?.accessibilityId || "")) path.length = 0;
    const edits = new Map();
    let budget = 16;
    for (const n of path) {
      const info = original(n), props = {};
      for (const key of ["margin", "padding"]) {
        const edges = info?.[key];
        if (!edges || edges[1] <= 2 || budget <= 0) continue;
        const trim = Math.min(edges[1] - 2, budget);
        props[key] = [edges[0], edges[1] - trim, edges[2], edges[3]];
        budget -= trim;
      }
      if (Object.keys(props).length) edits.set(n.id, props);
    }
    const previous = categoryInsets.get(list.id);
    if (previous) {
      for (const [id, keys] of previous) {
        const missing = keys.filter(key => !edits.get(id)?.[key]);
        const node = missing.length && ui.node(id);
        if (node) ui.update(id, Object.fromEntries(missing.map(key => [key, original(node)?.[key] || 0])));
      }
    }
    if (!edits.size) { categoryInsets.delete(list.id); return; }
    categoryInsets.set(list.id, [...edits].map(([id, props]) => [id, Object.keys(props)]));
    for (const [id, props] of edits) ui.update(id, props);
  }

  function paintGuildSeam(title) {
    const edge = guildHeaderEdge(title);
    if (!edge) return;
    const header = parent(title);
    const insets = original(header)?.padding || [0, 0, 0, 0];
    const actions = ui.node(header.children[1]);
    ui.update(header.id, { ...plainSurface, ...squareDrawerTop, blur: null,
      padding: [0, insets[1], 0, 0], background: conversation.header });
    for (const control of [title, actions]) {
      const m = original(control)?.margin || [0, 0, 0, 0];
      const bottom = control.id === title.id ? m[3] : Math.min(4, m[3] + insets[3]);
      ui.update(control.id, { margin: [m[0] + insets[0], m[1], m[2] + insets[2], bottom] });
    }
    markSurface(header, "seam", title.id);
    markSurface(actions, "seam-actions", actions.children[0]);
    if (ui.androidControlSurfaces) {
      ui.update(edge.id, { ...plainSurface, ...drawerEdge, blur: null, gone: true,
        minHeight: 0, height: 0, margin: 0, padding: 0, opacity: 0, pointerEvents: "none" });
    } else {
      ui.update(edge.id, { ...plainSurface, ...barRadii(26, 0), width: "fill", height: 26,
        margin: 0, background: conversation.body, pointerEvents: "none" });
    }
  }

  function clearEdge(node, atSeam = false, depth = 0) {
    if (!node || node.id === ui.root() || depth > 3 || guildSeam(node)) return;
    const info = original(node);
    if (info?.pressable || pressable(node) || (info && !["view", "stack"].includes(info.kind))) return;
    // A device-pixel hairline need not have a numeric height in the mirror.
    // At the header/list seam a passive, empty view can drop its paint while
    // keeping the space the host reserved for it.
    const isLine = dividerName.test(node.accessibilityId || "") || (!node.accessibilityId &&
      (info?.height > 0 && info.height <= 2 || atSeam && info?.kind === "view" && info.height == null && !node.children.length));
    if (node.children.length > 1) return;
    if (isLine) ui.update(node.id, { ...plainSurface, ...headerEdge });
    if (node.children.length === 1 && (isLine || !node.accessibilityId)) {
      clearEdge(ui.node(node.children[0]), atSeam, depth + 1);
    }
  }

  // Device insets can be padding on the right drawer, or a separate, wrapped
  // spacer above it. Only bounded, passive spacer branches get a new fill.
  function tintTopSpacer(node, depth = 0) {
    if (!node || depth > 3 || node.accessibilityId || node.children.length > 1) return;
    const info = original(node);
    if (!info || !["view", "stack"].includes(info.kind) || info.pressable) return;
    if (node.children.length) {
      const child = ui.node(node.children[0]);
      if (!child || child.accessibilityId || !["view", "stack"].includes(original(child)?.kind)) return;
      tintTopSpacer(child, depth + 1);
    }
    if (info.height > 2 && info.height <= 80) {
      ui.update(node.id, { ...headerEdge, background: conversation.header, ...(info.backplate ? { bg: conversation.header } : {}) });
    } else if (info.height == null) tintBacking(node, conversation.header);
  }

  function serverRail(node) {
    return /^(?:navigation\.(?:server:|messages$|add_server$))/.test(node.accessibilityId || "");
  }

  function drawerBacking(pane) {
    let branch = pane;
    for (let i = 0; branch && branch.id !== ui.root() && i < 10; i++) {
      const info = original(branch);
      if (!info || !["view", "stack"].includes(info.kind) || info.pressable || branch.sheet != null) break;
      tintBacking(branch, conversation.header);
      stripHeaderEdge(branch);
      const namedColumn = branch.accessibilityId === channelPanel;
      if (namedColumn) ui.update(branch.id, { ...headerEdge, background: conversation.header, ...(info.backplate ? { bg: conversation.header } : {}) });
      const frame = parent(branch);
      if (!frame || frame.id === ui.root() || frame.children.length > 8) break;
      const at = frame.children.indexOf(branch.id);
      const leading = children(frame).slice(0, at);
      if (original(frame)?.horizontal && leading.some(railBranch)) {
        // This is the right-hand column whose top padding shows through the OS bar.
        ui.update(branch.id, { ...headerEdge, background: conversation.header, ...(info.backplate ? { bg: conversation.header } : {}) });
        break;
      }
      if (original(frame)?.horizontal || /^(?:main-tabs|home-shell)$/.test(frame.accessibilityId || "")) break;
      for (const n of leading) tintTopSpacer(n);
      branch = frame;
    }
  }

  function toolbarRow(node, info = original(node)) {
    if (!info?.horizontal || info.pressable || node.children.length < 2 || node.children.length > 7) return false;
    return children(node).filter(n => contains(n, x => original(x)?.pressable ||
      ["search.entry", "guild.menu", "guild-search"].includes(x.accessibilityId), 3)).length >= 2;
  }

  // Some headers expose only localized control labels. Look among siblings
  // of the viewport for a compact strip of controls, never in the list rows.
  function adjacentToolbar(list, guild = false) {
    let lane = list;
    for (let depth = 0; depth < 5; depth++) {
      const frame = parent(lane);
      if (!frame || frame.id === ui.root() || !["view", "stack"].includes(original(frame)?.kind) ||
          frame.children.length > 8) break;
      for (const sibling of children(frame)) {
        if (sibling.id === lane.id || sibling.sheet != null || /dock|composer|bottom|over-stack/i.test(sibling.accessibilityId || "")) continue;
        const queue = [[sibling, 0]];
        for (let i = 0; queue.length && i < 18; i++) {
          const [n, d] = queue.shift(), info = original(n);
          if (!info || !["view", "stack"].includes(info.kind) || n.children.length > 7 || n.list != null ||
              /dock|composer|message\.|navigation\.|settings/i.test(n.accessibilityId || "")) continue;
          if (toolbarRow(n, info) && joinHeaderAndList(n, list, guild)) {
            ui.update(n.id, { ...plainSurface, background: conversation.header });
            return;
          }
          if (d < 2 && !info.pressable) for (const child of children(n)) queue.push([child, d + 1]);
        }
      }
      lane = frame;
    }
  }

  function paintToolbar(anchor) {
    if (!anchor || anchor.sheet != null) return;
    let branch = anchor;
    for (let i = 0; branch && branch.id !== ui.root() && i < 7; i++, branch = parent(branch)) {
      const info = original(branch);
      if (!info || !["view", "stack"].includes(info.kind)) break;
      // A horizontal container with independent control branches owns the full app bar.
      if (!info.pressable) {
        stripHeaderEdge(branch);
        for (const child of children(branch)) clearEdge(child, branch.children[branch.children.length - 1] === child.id);
      }
      if (toolbarRow(branch, info)) {
        ui.update(branch.id, { ...plainSurface, ...headerEdge, background: conversation.header });
        rememberLayout("toolbar", parent(branch) || branch);
        break;
      }
      tintBacking(branch, conversation.header);
    }
  }
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
      if (parts.length >= 2 && (namedEnd(end) || (original(n)?.horizontal && original(end)?.pressable)) &&
          parts.slice(0, -1).some(hasIdentity)) {
        ui.update(n.id, { ...plainSurface, background: conversation.userBar });
        if (shellNode(end)) ui.update(end.id, { background: conversation.control });
        let branch = n;
        for (let i = 0; i < 4 && branch; i++, branch = parent(branch)) {
          clearGradient(branch);
          for (const sibling of children(branch)) if (!sibling.children.length && !original(sibling)?.pressable) clearGradient(sibling);
          if (branch.id === dock.id) break;
        }
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

  function paneSurface(top = 26) {
    return { ...headerEdge, bg: 0, background: conversation.body, ...barRadii(top, 0), clip: true };
  }

  function channelSurface(list, head) {
    // In 357200 row zero is another copy of the guild toolbar. The list's
    // top is above the title. The cap below search owns the visible corners.
    let title = head;
    if (list && title?.accessibilityId !== "guild.menu" && ui.findDown) {
      const id = ui.findDown(list.id, "guild.menu", 4);
      if (id != null) title = ui.node(id);
    }
    if (guildHeaderEdge(title)) return { ...paneSurface(0), ...drawerEdge };
    return paneSurface();
  }

  function childOf(node, ancestorId) {
    for (let depth = 0; node && depth < 12; depth++, node = parent(node)) {
      if (!parent(node)?.children.includes(node.id)) return null;
      if (node.parent === ancestorId) return node;
    }
    return null;
  }

  function joinHeaderAndList(head, list, guild = false) {
    const pane = commonFrame(head, list);
    if (!shellNode(pane) || pane.id === head.id || pane.id === list.id) return false;
    const upper = childOf(head, pane.id), lower = childOf(list, pane.id);
    if (!upper || !lower || upper.id === lower.id) return false;
    const hi = pane.children.indexOf(upper.id), lo = pane.children.indexOf(lower.id);
    if (hi < 0 || lo < 0 || pane.children.length > 10 ||
        (ui.surface && !["view", "stack"].includes(original(pane)?.kind))) return false;
    // Sticky toolbars can follow the list in paint order. Ignore a toolbar on
    // another navigation page that merely shares the outer transition stack.
    if (upper.id !== head.id && contains(upper, n => ["scroll", "list"].includes(original(n)?.kind), 3)) return false;

    if (guild) drawerBacking(pane);
    const frame = original(pane);
    const otherParts = children(pane).filter(n => n.id !== upper.id && n.id !== lower.id);
    const edgeOnly = n => {
      const info = original(n);
      return !n.children.length && !n.accessibilityId && info?.kind === "view" && !info.pressable &&
        info.height > 0 && info.height <= 64;
    };
    // This column owns just the toolbar and its scrolling content. Providing its
    // backing makes the top list corners visible even when the column was transparent.
    const dockOrInset = n => edgeOnly(n) || dockSlots.includes(n.accessibilityId) ||
      contains(n, c => /^(?:current-user-profile|notifications)$/.test(c.accessibilityId || ""), 3);
    const guildColumn = guild && guildHeads.includes(head.accessibilityId) &&
      (!pane.accessibilityId || pane.accessibilityId === channelPanel) && otherParts.every(dockOrInset);
    const toolbarColumn = !pane.accessibilityId && hi < lo && otherParts.every(edgeOnly) &&
      (toolbarRow(upper) || toolbarRow(head));
    if (frame?.kind === "view" && !frame.horizontal && !frame.pressable &&
        (guildColumn || toolbarColumn) && ["list", "scroll"].includes(original(list)?.kind)) {
      ui.update(pane.id, { ...headerEdge, bg: 0, background: conversation.header });
    } else tintBacking(pane, conversation.header);
    for (let n = upper, depth = 0; n && n.id !== head.id && depth < 12; depth++) {
      tintBacking(n, conversation.header);
      stripHeaderEdge(n);
      const next = childOf(head, n.id);
      for (const child of children(n)) if (child.id !== next?.id) {
        clearEdge(child, n.children[n.children.length - 1] === child.id);
        if (!child.children.length && original(child)?.height > 2 && original(child)?.height <= 64) tintBacking(child, conversation.header);
      }
      n = next;
    }
    for (const between of children(pane)) {
      if (between.id === upper.id || between.id === lower.id) continue;
      const index = pane.children.indexOf(between.id);
      clearEdge(between, index > Math.min(hi, lo) && index < Math.max(hi, lo));
      const info = original(between);
      if (!between.children.length && !info?.pressable && ((info?.height > 2 && info.height <= 64) ||
          (info?.height == null && pane.children.indexOf(between.id) < Math.min(hi, lo)))) tintBacking(between, conversation.header);
    }
    // Place the rounded list against the toned panel. Only a single-child
    // wrapper leading to this viewport can receive its clip and corner radii.
    let viewport = list;
    for (let i = 0; i < 4 && viewport.id !== lower.id; i++) {
      const shell = parent(viewport);
      if (!shell || shell.children.length !== 1 || !["view", "stack"].includes(original(shell)?.kind)) break;
      viewport = shell;
    }
    for (let n = viewport, i = 0; n && n.id !== pane.id && i < 12; i++, n = parent(n)) tintBacking(n, conversation.header);
    if (guild && guildHeaderEdge(head)) {
      markSurface(pane, "pane/" + conversation.header.toString(16), lower.id);
    }
    const surface = guild ? channelSurface(list, head) : paneSurface();
    ui.update(viewport.id, surface);
    // A native scroll view can draw its own rectangular background over a
    // rounded wrapper. Keep both surfaces on the same outline.
    for (let n = list, d = 0; n && n.id !== viewport.id && d < 8; n = parent(n), d++) {
      ui.update(n.id, surface);
    }
    rememberLayout("header-and-list", pane);
    return true;
  }

  function viewportFor(anchor) {
    // The owner of row gestures can sit outside both the guild header and
    // the actual scroll view. Only the nearest viewport should clip the list.
    if (typeof ui.surface === "function") {
      for (let n = parent(anchor), i = 0; n && n.id !== ui.root() && i < 12; n = parent(n), i++) {
        if (["list", "scroll"].includes(original(n)?.kind)) return n;
      }
    }
    return anchor.list == null ? null : ui.node(anchor.list);
  }

  function panelViewport(header, panel) {
    // Prefer the viewport in the same column as the guild header. The rail
    // to the left and an open chat to the right have independent scroll views.
    const queue = [[panel, 0]], candidates = [];
    for (let i = 0; queue.length && i < 60; i++) {
      const [n, depth] = queue.shift(), info = original(n);
      if (!info || n.sheet != null || n.id === header.id || /dock|composer/.test(n.accessibilityId || "")) continue;
      if (["list", "scroll"].includes(info.kind)) {
        if (childOf(header, n.id)) continue;
        if (children(n).slice(0, 8).some(row => contains(row, c => serverRail(c) ||
            (c.accessibilityId || "").startsWith(messageMatch.prefix), 3))) continue;
        candidates.push(n);
        continue;
      }
      if (depth < 5 && ["view", "stack"].includes(info.kind) && !info.pressable)
        for (const child of children(n).slice(0, 12)) queue.push([child, depth + 1]);
    }
    return candidates.length === 1 ? candidates[0] : null;
  }

  function styleChannelPanel(panel) {
    if (panel.id === ui.root() || panel.sheet != null) return;
    let header;
    if (typeof ui.findDown === "function") for (const name of guildHeads) {
      const id = ui.findDown(panel.id, name, 8);
      if (id != null) { header = ui.node(id); break; }
    }
    if (!header) return;
    drawerBacking(panel);
    const view = panelViewport(header, panel);
    if (view && joinHeaderAndList(header, view, true)) {
      paintChannelPane(view);
    }
    rememberLayout("drawer", panel);
  }

  function paintChannelPane(list) {
    if (!list || Date.now() - (seenPanels.get(list.id) || 0) < 180) return;
    let head;
    for (const name of guildHeads) {
      head = ui.find(name).map(id => ui.node(id)).find(n => n && joinHeaderAndList(n, list, true));
      if (head) break;
    }
    rememberLayout("channel-viewport", parent(list) || list);
    if (seenPanels.size >= 64) seenPanels.clear();
    seenPanels.set(list.id, Date.now());
    compactFirstCategory(list);
    if (!head) adjacentToolbar(list, true);
    if (head) {
      rememberLayout("channel-pane", commonFrame(head, list));
      paintToolbar(head);
    }
    forLive("guild.menu", paintGuildSeam);
    if (head) clearDrawerEdges(commonFrame(head, list));
    for (const key of dockSlots) forLive(key, paintUserDock);
    let lane = list;
    for (let i = 0; i < 7; i++) {
      const frame = parent(lane);
      if (!frame || frame.id === ui.root() || frame.sheet != null || frame.kind === "navigator") break;
      const parts = children(frame), at = frame.children.indexOf(lane.id);
      if (parts.length <= 7) for (const sibling of parts.slice(at + 1)) {
        clearGradient(sibling);
        if (paintUserDock(sibling)) return;
      }
      lane = frame;
    }
  }

  function paintTopInset(header) {
    if (!header || header.sheet != null || header.list != null) return;
    applyNativePalette();
    paintToolbar(header);
    if (lastList != null) joinHeaderAndList(header, ui.node(lastList));
  }

  function styleHeader(search) {
    applyNativePalette();
    paintTopInset(search);
    tintIcon(search, palette.accent);
  }

  function cardSurface(n) {
    ui.update(n.id, { background: palette.row, shrink: 1, minWidth: 0 });
  }

  function styleNamedEmbed(node) {
    if (!shellNode(node) || !node.children.length || /thumbnail|preview-image|media|footer|author|description|title/i.test(node.accessibilityId)) return;
    cardSurface(node);
    return true;
  }

  function paintEmbeds(content) {
    // A rich embed has a decorative side stripe beside a column of content.
    // Photo-only attachments and inline text runs have neither this stripe nor
    // this layout. Never recolor the stripe or descend into a recognized card.
    const cards = [];
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
      if (name.startsWith("embed:")) {
        if (styleNamedEmbed(node)) cards.push(node);
        continue;
      }
      if (name || !node.children.length) continue;
      const parts = children(node);
      if (parts.length === 2) {
        const [stripe, body] = parts;
        if (shellNode(stripe) && !stripe.accessibilityId && !stripe.children.length && !pressable(stripe) &&
            shellNode(body) && !body.accessibilityId && body.children.length >= 2 &&
            children(body).some(n => n.kind === "text" || (shellNode(n) && n.children.length)) &&
            !parts.some(n => n.kind === "image")) {
          cardSurface(node);
          cards.push(node);
          continue;
        }
      }
      if (depth < 3 && !pressable(node)) for (const child of parts) work.push([child, depth + 1]);
    }
    return cards;
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
    ui.update(lane.id, { ...flat, background: conversation.control, ...barRadii(20, 0) });
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
        ui.update(frame.id, { ...flat, background: conversation.control, ...barRadii(20, 0) });
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
      paintButton(n, i ? palette.row : palette.accent, i ? palette.ink : palette.onAccent, buttonLabel(n));
      ui.update(n.id, barRadii(18, 18));
      if (!i) primaryAction(n, buttonLabel(n), 18);
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

  // A photo in 357200 can be an anonymous child after the text marker.
  // Exclude the author line, inline emoji and the row of reaction buttons.
  function messageMedia(node) {
    const name = node.accessibilityId || "";
    if (/^(?:embed:|attachment[.:]|message\.attachments?:)/.test(name)) return true;
    if (name || original(node)?.horizontal) return false;
    let part = node;
    for (let depth = 0; part && depth < 8; depth++) {
      const info = original(part), kind = part.kind || info?.kind;
      if (part.accessibilityId && !/^(?:attachment|media|image)/i.test(part.accessibilityId)) return false;
      if (kind === "image") return info?.height == null || info.height > 40;
      if (!["view", "stack"].includes(kind) || info?.horizontal || (info?.height != null && info.height <= 32)) return false;
      if (part.children.length !== 1) {
        // A video/photo tile can also have an overlay button or spoiler mask.
        return children(part).some(n => original(n)?.kind === "image" && original(n).height > 40);
      }
      part = ui.node(part.children[0]);
    }
    return false;
  }

  const bubbles = new Map();

  // On 357200 each message line pairs a 40dp avatar or empty spacer
  // with its content column, including below a reply preview.
  function messageColumn(marker) {
    let branch = marker;
    for (let i = 0; branch && i < 10; i++, branch = parent(branch)) {
      const up = parent(branch);
      if (!up || up.id === marker.list) break;
      if (up.children.length !== 2 || !original(up)?.horizontal) continue;
      const [gutter, content] = children(up);
      if (!gutter || !content) continue;
      const shape = original(gutter);
      if (!/^message\.avatar:/.test(gutter.accessibilityId || "") &&
          (gutter.accessibilityId || (gutter.children.length && shape?.height !== 40 && !shape?.pressable))) continue;
      if (content.id === branch.id) return content;
      if (gutter.id === branch.id) return null;
    }
    return undefined;
  }

  function releaseBubble(boxId) {
    bubbles.delete(boxId);
    const node = ui.node(boxId);
    if (!node) return;
    const shape = original(node);
    ui.update(boxId, { background: shape?.fill || 0, padding: shape?.padding || 0, clip: false,
      radius: 0, radiusTopLeft: shape?.topLeft || 0, radiusTopRight: shape?.topRight || 0,
      radiusBottomLeft: 0, radiusBottomRight: 0 });
  }

  function sweepBubbles(all = false) {
    for (const [id, marker] of reactionRows) if (all || !ui.node(id) || !ui.node(marker)) reactionRows.delete(id);
    for (const [box, owner] of bubbles) {
      const marker = ui.node(owner.marker);
      const lane = marker && messageColumn(marker);
      if (all || lane === null || (lane && lane.id !== box && !childOf(ui.node(box), lane.id)) || !marker || marker.accessibilityId !== owner.name || marker.list !== owner.list ||
          !ui.node(box) || (marker.id !== box && !childOf(marker, box))) releaseBubble(box);
    }
  }

  function paintBubble(anchor, embeds, marker = anchor) {
    if (anchor.list == null || anchor.sheet != null) return;
    const id = anchor.accessibilityId.split(":")[1];
    if (!/^\d+$/.test(id)) return;
    const lane = messageColumn(marker);
    if (lane === null) return;
    const cardIds = new Set(embeds.map(card => card.id));
    let photo = false;
    let box = anchor;
    // Walk only up this message's column. An avatar, reply preview, another
    // message, a date separator or the list itself marks the outer boundary.
    for (let depth = 0; depth < 5; depth++) {
      if (box.id === lane?.id) break;
      const up = parent(box);
      if (!shellNode(up) || up.id === anchor.list || up.sheet != null || up.children.length > 8 ||
          (up.accessibilityId && up.accessibilityId !== "message.body:" + id)) break;
      // A horizontal parent contains the avatar (or its anonymous continuation
      // spacer) beside the content. Its siblings never belong inside a bubble.
      if (original(up)?.horizontal && up.children.length > 1) break;
      const others = children(up).filter(n => n.id !== box.id);
      if (!others.length) { if (up.parent === anchor.list) break; box = up; continue; }
      const following = children(up).slice(up.children.indexOf(box.id) + 1);
      const hasMedia = !original(up)?.horizontal && following.some(messageMedia);
      let companion = hasMedia, unsafe = false, budget = 48;
      const scan = [...others];
      while (scan.length && budget-- > 0) {
        const n = scan.pop(), aid = n.accessibilityId || "";
        if (/^message\.(?:avatar|content|reply)/.test(aid) || /divider|separator|^navigation\./.test(aid) ||
            (/^message\.(?:author|timestamp):/.test(aid) && !aid.endsWith(":" + id))) { unsafe = true; break; }
        if (cardIds.has(n.id) || aid === "message.author:" + id || aid === "message.timestamp:" + id ||
            /^(?:embed:|attachment[.:]|message\.attachments?:)/.test(aid)) companion = true;
        scan.push(...children(n));
      }
      if (unsafe || scan.length || !companion) break;
      photo ||= hasMedia;
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
    // Reject an avatar lane even if it carries a named descendant on a recycled row.
    for (let n = box, i = 0; n && n.id !== anchor.list && i < 8; n = parent(n), i++) {
      const host = parent(n);
      if (!host || host.id === anchor.list) break;
      if (original(host)?.horizontal && host.children.length >= 2 && host.children[0] === n.id &&
          (original(n)?.height === 40 || !n.children.length || /avatar|reply-preview/.test(n.accessibilityId || ""))) return;
    }
    const list = ui.node(anchor.list);
    const row = childOf(box, anchor.list);
    if (!row || !list) return;
    paintReactions(lane || box, marker);
    const pos = row && list ? list.children.indexOf(row.id) : -1;
    const startsGroup = n => contains(n, c => /^message\.(?:author|avatar|reply):|^reply-preview/.test(c.accessibilityId || ""), 5);
    const messageRow = n => contains(n, c => /^message\.content:\d+$/.test(c.accessibilityId || ""), 5);
    const prev = pos > 0 ? ui.node(list.children[pos - 1]) : null;
    const next = pos >= 0 && pos + 1 < list.children.length ? ui.node(list.children[pos + 1]) : null;
    const joinedAbove = messageRow(prev) && !startsGroup(row);
    const joinedBelow = messageRow(next) && !startsGroup(next);
    // Keep the native leading/trailing inset equal to the bottom inset.
    // A fixed-width preview or its single-child shell may have been measured
    // before the bubble had padding. Resolve its width against the padded column.
    let hasCard = false;
    for (const card of embeds) {
      if (card.id === box.id || !childOf(card, box.id)) continue;
      hasCard = true;
      ui.update(card.id, { width: "fill", minWidth: 0, shrink: 1 });
      for (let n = parent(card), i = 0; n && n.id !== box.id && i < 8; n = parent(n), i++) {
        const info = original(n);
        if (info?.horizontal || !shellNode(n) || n.children.length !== 1) break;
        ui.update(n.id, { width: "fill", minWidth: 0, shrink: 1 });
      }
    }
    const media = hasCard || photo || children(anchor).some(messageMedia) || contains(box, n => /^(?:attachment[.:]|message\.attachments?:)/.test(n.accessibilityId || ""), 4);
    for (const [oldBox, owner] of bubbles) {
      if (oldBox !== box.id && owner.marker === marker.id) releaseBubble(oldBox);
    }
    bubbles.set(box.id, { marker: marker.id, name: marker.accessibilityId, list: anchor.list });
    ui.update(box.id, { background: conversation.bubble, radius: 16, clip: media,
      radiusTopLeft: joinedAbove ? 4 : 16, radiusTopRight: joinedAbove ? 4 : 16,
      radiusBottomLeft: joinedBelow ? 4 : 16, radiusBottomRight: joinedBelow ? 4 : 16,
      padding: [10, 5, 10, media ? 10 : 5] });
  }

  const reactionRows = new Map();
  function paintReactions(column, marker) {
    if (!column || marker.list == null) return;
    // Recognize the emoji/count chips as a group in this message's content
    // column. Emoji glyphs and images keep their original colors.
    const work = children(column).map(n => [n, 0]);
    for (let budget = 36; work.length && budget > 0; budget--) {
      const [row, depth] = work.shift();
      if (messageMedia(row) || /^(embed|attachment|message\.(?:author|avatar|timestamp|content))[:.]/.test(row.accessibilityId || "")) continue;
      const shape = original(row), items = children(row);
      if (shape?.horizontal && items.length && items.length <= 24) {
        const chips = items.map(button => {
          if (!original(button)?.pressable && !pressable(button)) return null;
          let body = button;
          for (let d = 0; body.children.length === 1 && d < 3; d++) body = ui.node(body.children[0]);
          const pieces = children(body);
          if ((body.kind || original(body)?.kind) === "image") return {button, plus: body};
          if (pieces.length !== 2 || !original(body)?.horizontal) return null;
          const [glyph, count] = pieces;
          const glyphKind = glyph.kind || original(glyph)?.kind;
          if (!["text", "image"].includes(glyphKind) || (count.kind || original(count)?.kind) !== "text") return null;
          return {button, count};
        });
        if (chips.every(Boolean) && chips.some(chip => chip.count) &&
            chips.every((chip,i) => chip.count || i === chips.length - 1)) {
          for (const {button, count, plus} of chips) {
            reactionRows.set(button.id, marker.id);
            const selected = button.checked === true || original(button)?.brandFill;
            ui.update(button.id, { background: selected ? palette.pressed : conversation.control,
              activeBackground: palette.pressed, borderColor: selected ? palette.accent : 0 });
            if (count) ui.update(count.id, { color: selected ? palette.accent : palette.ink });
            if (plus) ui.update(plus.id, { tint: palette.muted });
          }
          return;
        }
      }
      if (depth < 2 && items.length <= 5) for (const n of items) work.push([n, depth + 1]);
    }
  }

  function photoOnly(author) {
    if (author.list == null || author.sheet != null) return;
    let branch = author;
    for (let depth = 0; depth < 5; depth++) {
      const up = parent(branch);
      if (!shellNode(up) || up.id === author.list || up.children.length > 7) return;
      const parts = children(up);
      // Only the author header itself may be horizontal on this path.
      if (original(up)?.horizontal && parts.length > 1 && branch.id !== author.id) return;
      if (parts.some(n => contains(n, c => (c.accessibilityId || "").startsWith(messageMatch.prefix), 3))) return;
      if (!original(up)?.horizontal && parts.slice(parts.findIndex(n => n.id === branch.id) + 1).some(messageMedia)) {
        // Start at the whole author line so its inline badges are outside the media scan.
        paintBubble({ ...branch, accessibilityId: author.accessibilityId, list: author.list }, [], author);
        return;
      }
      branch = up;
    }
  }

  // Phoenix 357200 checks blur.fallback before the ordinary background. Set
  // both on the hit target so a later ordinary fill cannot uncover brand blue.
  function buttonPaint(fill) {
    return { background: fill, bg: 0, blur: { fallback: fill }, backgroundGradient: null,
      activeBackgroundGradient: null, activeBackground: mix(fill, palette.ink, 0.08) };
  }

  function paintButton(button, fill, ink, label = null) {
    ui.update(button.id, buttonPaint(fill));
    for (const n of descendants(button, 5, 24)) {
      if (n.id === button.id) continue;
      const kind = kindOf(n);
      if (kind === "text" || kind === "markup" || n.id === label?.id) ui.update(n.id, { background: 0, color: ink });
      else if (kind === "image") ui.update(n.id, { tint: ink });
      else if (shellNode(n)) ui.update(n.id, { background: 0, bg: 0, blur: null, backgroundGradient: null });
    }
  }

  function actionIn(n) {
    if (!n) return null;
    return descendants(n, 5, 22).find(c => interactive(c) || original(c)?.role === "button") || null;
  }

  function threadNotice(card, namedButton = null) {
    if (!card || card.sheet != null || (card.list != null && !namedButton) ||
        !["view","stack"].includes(kindOf(card)) || !shellNode(card)) return false;
    const parts = children(card).filter(n => ["text","markup"].includes(kindOf(n)) ||
      (n.children.length && descendants(n,5,24).some(c => ["text","markup"].includes(kindOf(c)))));
    if (parts.length !== 2) return false;
    const [noteBranch, buttonBranch] = parts;
    const notes = descendants(noteBranch,5,20);
    const note = notes.find(n => ["text","markup"].includes(kindOf(n)));
    const button = actionIn(buttonBranch) || (namedButton && (buttonBranch.id === namedButton.id || childOf(namedButton,buttonBranch.id)) ? buttonBranch : null);
    if (!note || !button || notes.some(interactive) || !descendants(button,5,20).some(n => ["text","markup"].includes(kindOf(n)))) return false;
    if (!namedButton && (original(card)?.horizontal || notes.some(n => kindOf(n) === "image") ||
        descendants(card,5,45).some(n => kindOf(n) === "input" || ["search.entry","guild.menu",...headerNames].includes(n.accessibilityId)))) return false;
    if (namedButton && namedButton !== card && namedButton.id !== buttonBranch.id && namedButton.id !== button.id &&
        !childOf(namedButton,buttonBranch.id) && !childOf(button,namedButton.id)) return false;
    rememberLayout("thread-footer",card);
    paintDock(card, true);
    ui.update(card.id, { ...plainSurface, blur: null, background: conversation.control, ...barRadii(18,18), clip: true });
    for (const branch of parts) if (branch.id !== button.id && shellNode(branch)) ui.update(branch.id, { ...plainSurface, blur: null });
    ui.update(note.id, {color: palette.ink});
    paintButton(button, palette.accent, palette.onAccent);
    primaryAction(button, actionLabel(button), original(button)?.topLeft || 8);
    return true;
  }

  function actionLabel(button) {
    return button && descendants(button,6,48).find(n => kindOf(n) === "text");
  }

  function namedThreadButton(anchor) {
    if (anchor.accessibilityId === "empty-chat") {
      for (const n of descendants(anchor,7,52)) if (threadNotice(n)) return;
    } else {
      for (let n = anchor, d = 0; n && d < 8; n = parent(n), d++) {
        if (n.id === ui.root() || n.sheet != null) break;
        if (threadNotice(n,anchor)) return;
      }
      const action=actionIn(anchor) || (interactive(parent(anchor)) ? parent(anchor) : null);
      if (action && anchor.sheet == null) {
        paintButton(action, palette.accent, palette.onAccent);
        primaryAction(action, actionLabel(action), original(action)?.topLeft || 8);
      }
    }
  }
  function chatFooter(list) {
    if (!list) return;
    for (let branch = list, depth = 0; branch && depth < 8; branch = parent(branch), depth++) {
      const host = parent(branch);
      if (!shellNode(host) || original(host)?.horizontal || host.children.length > 16) break;
      const work = children(host).filter(n => n.id !== branch.id);
      for (let i = 0; i < work.length && i < 80; i++) {
        const n = work[i];
        if (n.sheet != null || n.list != null || n.accessibilityId === "composer" ||
            [...headerNames,"search.entry"].includes(n.accessibilityId) || !shellNode(n) ||
            ["list","scroll"].includes(kindOf(n))) continue;
        if (threadNotice(n)) return;
        if (!interactive(n) && n.children.length <= 8) work.push(...children(n));
      }
    }
  }

  function readableRow(n) {
    if (!n || isSocialTab(n)) return false;
    const button = actionIn(n);
    if (!button || (n.id !== button.id && n.children.length !== 1)) return false;
    return descendants(button,4,18).some(c => kindOf(c) === "text");
  }

  const guildSheets = new Map();
  function guildOptions(anchor) {
    let sheet = anchor.sheet != null ? ui.node(anchor.sheet) : anchor;
    if (!sheet || (anchor.sheet == null && anchor.accessibilityId !== "guild-sheet")) return;
    const previous=guildSheets.get(sheet.id), now=Date.now();
    if (previous && previous.anchor===sheet.children[0] && previous.time+80>now) return;
    const nodes = descendants(sheet, 13, 450);
    if (!nodes.some(n => n.accessibilityId === "guild-sheet" || n.accessibilityId === "guild-sheet-name" || n.accessibilityId === "tab-invite") &&
        !nodes.some(n => children(n).length >= 3 && children(n).length <= 5 &&
          children(n).every(tile => readableRow(tile) && descendants(tile,4,12).some(c => kindOf(c) === "image")))) return;
    if (guildSheets.size>32) guildSheets.clear();
    guildSheets.set(sheet.id,{anchor:sheet.children[0],time:now});
    ui.update(sheet.id, {background: conversation.menu, handleColor: palette.handle});
    for (const n of nodes) {
      if (n.accessibilityId === "guild-sheet" || ["scroll","list"].includes(kindOf(n)) ||
          (n.id !== sheet.id && !interactive(n) && original(n)?.opaque && !original(n)?.horizontal &&
           n.children.length && ["view","stack"].includes(kindOf(n)) && descendants(n,3,18).some(interactive))) {
        ui.update(n.id,{background:conversation.menu,bg:0});
      }
      const pieces = children(n);
      if (!pieces.length) continue;
      const quick = original(n)?.horizontal && pieces.length >= 3 && pieces.length <= 5 && pieces.every(tile => actionIn(tile));
      if (quick) {
        for (const tile of pieces) {
          const button = actionIn(tile);
          const image = descendants(button,4,12).find(c => kindOf(c) === "image");
          if (!image) continue;
          let face = image;
          for (let p=parent(face); p && p.id !== tile.id && p.id !== n.id; p=parent(p)) {
            if (descendants(p,3,12).some(c => kindOf(c) === "text")) break;
            face=p;
          }
          if (face.id !== image.id) {
            ui.update(face.id,{...clearFill,bg:0,background:conversation.control,radius:14});
            for (let child=parent(image); child && child.id!==face.id; child=parent(child))
              ui.update(child.id,{...clearFill,bg:0});
          }
          ui.update(image.id,{...clearFill,bg:0,tint:palette.accent});
          for (const label of descendants(tile,4,16)) if (kindOf(label) === "text") ui.update(label.id,{color:palette.ink});
        }
      } else if (pieces.every(c => divider(c) || readableRow(c)) && pieces.some(readableRow)) {
        styleGroup(n, readableRow);
        for (const row of pieces.filter(readableRow)) {
          clearRowFace(row);
          ui.update(row.id,{background:conversation.control});
          const control = actionIn(row);
          const toggle = switchParts(control) || switchParts(row);
          if (toggle) tintSwitch(original(control)?.role === "switch" ? control : row,toggle);
        }
      }
    }
    rememberLayout("guild-options",sheet);
    return true;
  }

  let guildWatch;
  function stopGuildWatch() {
    if (guildWatch) {guildWatch(); guildWatch=null;}
  }
  function openingGuild() {
    stopGuildWatch();
    const until=Date.now()+1800;
    guildWatch=ui.onNode({prefix:""}, stamp => {
      if (Date.now()>until) {stopGuildWatch(); return;}
      const n=ui.node(stamp.id);
      if (n?.sheet!=null && guildOptions(n)) stopGuildWatch();
    });
  }

  const dmControls = ["dm-new-message","dm-add-friends","dm-search"];
  function dmActions(anchor) {
    if (anchor.accessibilityId === "dm-new-message") {
      paintButton(actionIn(anchor) || anchor,palette.accent,palette.onAccent);
      return;
    }
    const roots = [];
    if (dmControls.includes(anchor.accessibilityId)) {
      let branch = anchor;
      for (let i=0; branch && i<4; i++,branch=parent(branch)) roots.push(branch);
    } else {
      let branch = ui.node(anchor.list);
      if (!branch) return;
      roots.push(...children(branch).slice(0,1));
      for(let i=0; branch && i<3; i++,branch=parent(branch)) {
        const host=parent(branch);
        if (!shellNode(host)) break;
        roots.push(...children(host).slice(0,host.children.indexOf(branch.id)));
      }
    }
    for (const root of roots) for (const n of descendants(root,5,42)) {
      if (!original(n)?.horizontal || n.children.length !== 3) continue;
      const buttons = children(n).map(actionIn);
      if (buttons.some(b => !b)) continue;
      const parts = buttons.map(b => descendants(b,4,12));
      if (!parts.every(kids=>kids.some(c=>kindOf(c)==="image")) ||
          parts[0].some(c=>kindOf(c)==="text") || !parts[1].some(c=>kindOf(c)==="text") || parts[2].some(c=>kindOf(c)==="text")) continue;
      paintButton(buttons[2],palette.accent,palette.onAccent);
      return;
    }
  }

  const inboxPages = ["inbox-screen","inbox-feed","inbox-page"];
  const inboxRows = ["inbox-row","inbox-section","inbox-title","inbox.title","recent-activity-text"];

  const requestActions = {prefix:"request-actions-"};
  function paintRequestButton(slot, button, fill, ink, primaryLabel) {
    paintButton(button, fill, ink);
    // Some notification rows round and paint an enclosing slot.
    let face = button;
    for (let n = button; n && n.id !== slot.id;) {
      n = parent(n);
      if (!n) break;
      const surface = original(n);
      if (surface?.brandFill || (surface?.topLeft && (surface.opaque || surface.backplate))) {
        face = n;
        ui.update(n.id, buttonPaint(fill));
      }
    }
    if (primaryLabel) primaryAction(face, primaryLabel, original(face)?.topLeft || 8);
  }

  function requestPair(n, group, feed) {
    const slots = children(n);
    if (slots.length !== 2) return false;
    const buttons = slots.map(actionIn);
    if (!buttons.every(Boolean)) return false;
    const named = group || slots[1].accessibilityId === "ignore" || buttons[1].accessibilityId === "ignore";
    if (!named && !(feed && buttons.every(b => shellNode(b) && buttonLabel(b)))) return false;
    const labels = buttons.map(actionLabel);
    if (!labels.every(Boolean)) return false;
    paintRequestButton(slots[0],buttons[0],palette.accent,palette.onAccent,labels[0]);
    paintRequestButton(slots[1],buttons[1],palette.pressed,palette.ink);
    return true;
  }

  function inbox(anchor) {
    let root = anchor;
    for (let n = anchor, depth = 0; n && n.id !== ui.root() && depth < 18; n = parent(n), depth++) {
      if (inboxPages.includes(n.accessibilityId)) root = n;
    }
    const isRoot = inboxPages.includes(root.accessibilityId);
    if (isRoot) ui.update(root.id,{...flat,background:conversation.body});
    const queue = [[anchor, null, 0, false]];
    for (let i = 0; i < queue.length && i < 640; i++) {
      const [n, inActions, depth, inFeed] = queue[i];
      const id = n.accessibilityId || "", kind = kindOf(n);
      const named = id.startsWith(requestActions.prefix);
      const group = named ? n : inActions;
      const feed = inFeed || (isRoot && ["list","scroll"].includes(kind));
      if ((named || original(n)?.horizontal) && requestPair(n,group,feed)) continue;
      if (inboxPages.includes(id) || (isRoot && ["list","scroll"].includes(kind))) {
        ui.update(n.id,{...flat,background:conversation.body});
      } else if (isRoot && !named && !inActions && !interactive(n) && ["view","stack"].includes(kind) &&
          (original(n)?.opaque || original(n)?.backplate) && !original(n)?.topLeft) {
        ui.update(n.id,{background:0,backgroundGradient:null});
      }
      if (id === "inbox-title" || id === "inbox.title") {
        for (const title of descendants(n,3,12)) if (kindOf(title) === "text") ui.update(title.id,{color:palette.ink});
      }
      if (depth < 14) for (const child of children(n)) queue.push([child,group,depth+1,feed]);
    }
    if (isRoot) rememberLayout("inbox",root);
  }

  const pickerAnchors = ["expression.search", "xp.grid", "xp-handle", "expression-rail", "media-grid",
    "mk-photos", "media-camera", "mk-handle", "mk-bar", "media-empty-action", { prefix: "expression.category:" }];
  const pickerCorners = new Map();
  function clearPickerCorners(all) {
    for (const [id, record] of pickerCorners) {
      const n = ui.node(id);
      if (!all && n && n.children[0] === record.child) continue;
      for (const remove of record.removers) remove();
      if (n && n.children[0] === record.child) ui.update(id, { radiusTopLeft: record.left, radiusTopRight: record.right });
      pickerCorners.delete(id);
    }
  }

  function cornerFace(side, radius, inside, outside) {
    const gravity = "top|" + side;
    return switchFace({ gravity, width: radius, height: radius, background: outside, clip: true }, [
      switchFace({ gravity, width: radius * 2, height: radius * 2, radius, background: inside }),
    ]);
  }

  function pickerGrid(face) {
    const queue = [[face, 0]];
    for (let count = 0; queue.length && count < 48; count++) {
      const [n, depth] = queue.shift(), shape = original(n);
      if (shape?.kind === "scroll" || shape?.kind === "list" || n.children.length >= 6) return true;
      if (depth < 5) for (const child of children(n)) queue.push([child, depth + 1]);
    }
    return false;
  }

  function paintPicker(anchor, discovered = false) {
    if ((discovered && anchor.sheet != null) || menuAncestor(anchor)) return;
    let branch = anchor;
    for (let depth = 0; branch && depth < 12; depth++, branch = parent(branch)) {
      const face = original(branch), host = parent(branch);
      if (!host || host.id === ui.root() || branch.accessibilityId === "composer") return;
      if (!(face?.topLeft >= 8 && face.topRight >= 8 && Math.max(face.topLeft, face.topRight) <= 48) || face.horizontal || face.pressable ||
          (face.height != null && face.height < 100) || !["view", "stack"].includes(face.kind)) continue;
      if (!branch.children.length || !ui.mount) return;
      if (!pickerGrid(branch)) continue;
      if (discovered && ["composer", "guild.menu", menuRoot, messageMatch].some(match =>
          ui.findDown?.(branch.id, match, 7) != null)) continue;
      clearPickerCorners(false);
      if (pickerCorners.has(branch.id)) return true;
      const inside = face.fill ??
        children(branch).map(n => original(n)?.fill).find(color => color != null) ?? palette.row;
      // A single panel may be placed over a full-screen chat stack. Paint two
      // radius-sized squares on the panel itself, leaving the rest of that stack visible.
      const child = branch.children[0];
      const removers = ["start", "end"].map(side => ui.mount(branch.id,
        cornerFace(side, side === "start" ? face.topLeft : face.topRight, inside, conversation.body)));
      ui.update(branch.id, { radiusTopLeft: 0, radiusTopRight: 0 });
      pickerCorners.set(branch.id, { child, left: face.topLeft, right: face.topRight, removers });
      rememberLayout("picker", host);
      return true;
    }
  }

  let pendingPicker;
  function stopPickerWatch() {
    if (pendingPicker) { pendingPicker(); pendingPicker = null; }
  }

  function openingPicker() {
    stopPickerWatch();
    const until = Date.now() + 1500;
    // Labels on the photo grid may be localized. Only inspect newly mounted
    // rows during the user's explicit open action, then release the watcher.
    pendingPicker = ui.onNode({ prefix: "" }, stamp => {
      if (Date.now() > until) { stopPickerWatch(); return; }
      const n = ui.node(stamp.id);
      if (n && paintPicker(n, true)) stopPickerWatch();
    });
  }

  let bubbleSweepAt = 0;
  function styleChat(node) {
    if (node.list != null && (lastList !== node.list || Date.now() - bubbleSweepAt >= 120)) {
      sweepBubbles();
      bubbleSweepAt = Date.now();
    }
    if (node.list != null && node.list !== lastList) {
      const list = ui.node(node.list);
      if (list) {
        rememberLayout("chat-viewport", parent(list) || list);
        chatFooter(list);
        ui.update(list.id, { ...paneSurface(), scrollFade: [] });
        let joined = false;
        for (const name of [...headerNames, "search.entry"]) forLive(name, h => { if (joinHeaderAndList(h, list)) joined = true; });
        if (!joined) adjacentToolbar(list);
      }
      lastList = node.list;
      paintCallRows(ui.node(node.list));
    }
    paintBubble(node, paintEmbeds(node));
    if (editingMessage && node.accessibilityId === "message.content:" + editingMessage) forLive(contextCancel, paintEditedMessage);
  }

  function apply(choice) {
    selectedScheme = choice;
    const dark = choice === "light" ? false : choice === "dark" ? true : !(system && system.dark === false);
    const next = colorsFor(dark);
    if (palette && activeDark === dark && Object.keys(next).every(k => next[k] === palette[k])) return;
    activeDark = dark;
    clearPickerCorners(true);
    removeSkins(true);
    if (editLayer) { editLayer.remove(); editLayer = null; }
    palette = next;
    ui.setAccentPalette?.(palette.accent, palette.onAccent, palette.pressed);
    conversation = {
      header: palette.canvas,
      menu: dark ? palette.canvas : mix(palette.row, palette.canvas, 0.38),
      control: dark ? mix(palette.row, palette.accent, 0.055) : mix(palette.canvas, palette.accent, 0.065),
      userBar: dark ? palette.row : palette.canvas,
      body: dark ? mix(palette.canvas, palette.row, 0.48) : palette.row,
      bubble: dark ? mix(palette.row, palette.accent, 0.055) : mix(palette.canvas, palette.accent, 0.045),
    };
    appearance?.setStatusBarColor?.(conversation.header, !dark);
    applyNativePalette(true);
    for (const remove of rules) remove();
    rules = [];
    lastList = lastSettings = null;
    recentGroups.clear();
    switchOwners.clear();
    seenPanels.clear();
    dmHeaders.clear(); guildSheets.clear();
    const textField = { ...flat, radius: 0, color: palette.ink, selectionColor: palette.accent, placeholderColor: palette.muted };
    for (const page of inboxPages) patch(page,{...flat,background:conversation.body});
    rules.push(ui.patchProps(requestActions,{addOn:["appeared"]}));
    patch("composer", textField);
    patch(searchId, textField);
    patch("search.entry", { background: 0, activeBackground: palette.ripple, radius: 20, activeRadius: 20.5 });
    patch({ prefix: "message.author:" }, { fontWeight: 700 });
    patch({ prefix: "message.timestamp:" }, { color: palette.muted });
    // A named chat-header may be only the middle title button. Its own fill
    // stays transparent while the toolbar and page backing supply the color.
    for (const name of headerNames) patch(name, { background: 0, borderWidth: 0 });
    patch("main-frame-gradient", gradients);
    forLive("main-frame-gradient", clearNamedFade);
    patch("main-tabs-frame-border", drawerEdge);
    patch("main-tabs-frame-border-clip", squareDrawerTop);
    forLive("main-tabs-frame-border", clearFrameBorder);
    patch("composer-floating", { ...plainSurface, blur: null, background: conversation.body });
    for (const name of headerNames) forLive(name, paintTopInset);
    forLive(channelPanel, styleChannelPanel);
    for (const name of guildHeads) forLive(name, styleGuildHeader);
    for (const name of chromeFrames) forLive(name, paintFrame);
    patch("guard-gradient", { ...plainSurface, blur: null, opacity: 0 });
    forLive("search.entry", styleHeader);
    forLive("composer", styleComposer);
    forLive(contextCancel, styleContext);
    forLive(searchId, settingsFromSearch);
    for (const [match,visit] of extraSurfaces) forLive(match,visit);
    forLive(messageMatch, styleChat);
    forLive({ prefix: "message.author:" }, photoOnly);
    for (const name of pickerAnchors) forLive(name, paintPicker);
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
      onChange: value => {
        recordLayouts = value;
        if (!value) { layouts.clear(); return; }
        for (const name of [...headerNames, ...guildHeads]) forLive(name, h => rememberLayout(name, parent(parent(h)) || h));
        forLive(menuRoot, h => rememberLayout("message-menu", h));
        if (lastList != null) rememberLayout("chat-viewport", parent(ui.node(lastList)));
        for (const id of seenPanels.keys()) rememberLayout("channel-pane", parent(ui.node(id)));
      },
    },
    copyLayout: {
      type: "button", title: "複製介面結構",
      onPress: () => phoenix.ui.copy(JSON.stringify({ version: "0.11.6", layouts: Object.fromEntries(layouts) })),
    },
  });
  recordLayouts = settings.inspect === true;
  const chromeFrames = ["main-tabs-frame-content", "main-tabs-frame-panels", "main-tabs-frame-border-clip",
    "main-tabs-dock-frame", "main-tabs-dock-frame-content", ...dockSlots];

  function clearFrameBorder(node) {
    if (node.id === ui.root()) return;
    // Some builds place the stroke and real content under the same named
    // clip. Strip the clip's own stroke even when it has interactive children.
    ui.update(node.id, { ...plainSurface, ...drawerEdge, ...(original(node)?.kind === "image" ? { tint: 0 } : {}) });
    const parts = children(node);
    for (const part of parts) {
      if (original(part)?.kind === "image" && !part.accessibilityId && !part.children.length &&
          !original(part)?.pressable && !pressable(part)) ui.update(part.id, { tint: 0 });
      else clearDrawerRule(part, true, true);
    }
  }

  function clearNamedFade(node) {
    const info = original(node);
    if (info && !info.pressable && !node.children.length && ["view", "image"].includes(info.kind)) {
      ui.update(node.id, { ...gradients, opacity: 0 });
    }
  }

  function paintFrame(frame) {
    const dock = /dock/.test(frame.accessibilityId || "");
    const tone = dock ? conversation.body : conversation.header;
    tintBacking(frame, tone);
    clearGradient(frame);
    // Under edge-to-edge Android the exposed inset is often an opaque child
    // of the frame. Restrict this pass to plain backings, never text or controls.
    for (const n of children(frame)) {
      const info = original(n);
      if (!info || info.pressable || !["view", "stack"].includes(info.kind)) continue;
      if (dock || n.accessibilityId === "main-frame-gradient") clearGradient(n);
      if (!n.children.length && info.height > 2 && info.height <= 64) tintBacking(n, tone);
    }
    if (dock) paintUserDock(frame);
  }

  function styleGuildHeader(node) {
    applyNativePalette();
    paintToolbar(node);
    for (let n = parent(node), i = 0; n && i < 12 && n.id !== ui.root(); i++, n = parent(n)) {
      if (n.accessibilityId === channelPanel) { styleChannelPanel(n); break; }
    }
    // A guild header can mount before any named channel row. Find the
    // adjacent viewport within this column while the two are on screen.
    let branch = node;
    for (let i = 0; i < 6; i++) {
      const frame = parent(branch);
      if (!frame || frame.id === ui.root() || !["view", "stack"].includes(original(frame)?.kind) ||
          frame.children.length > 8) break;
      for (const sibling of children(frame)) {
        if (sibling.id === branch.id) continue;
        let view = sibling;
        for (let d = 0; d < 4 && view?.children.length === 1 && ["view","stack"].includes(original(view)?.kind); d++) {
          view = ui.node(view.children[0]);
        }
        if (!view || !["list","scroll"].includes(original(view)?.kind)) continue;
        if (!children(view).slice(0, 8).some(n => contains(n, c => /^(?:navigation\.(?:channel|category):|dm\.row:)/.test(c.accessibilityId || ""), 3))) continue;
        paintChannelPane(view);
      }
      branch = frame;
    }
    for (const id of seenPanels.keys()) {
      const list = ui.node(id);
      if (list) joinHeaderAndList(node, list, true);
    }
    paintGuildSeam(node);
    if (node.accessibilityId === "guild.menu") clearDrawerEdges(parent(node));
    if (recordLayouts) rememberLayout("guild-header", parent(parent(node)) || parent(node) || node);
  }
  watch("main-tabs-frame-border", clearFrameBorder);
  watch("main-frame-gradient", clearNamedFade);
  for (const name of chromeFrames) watch(name, paintFrame);
  watch(channelPanel, styleChannelPanel);
  for (const name of guildHeads) watch(name, styleGuildHeader);
  for (const name of headerNames) watch(name, paintTopInset);
  watch(contextCancel, styleContext);
  watch("delete-message", maybeDialog);
  watch({ prefix: "alert-title:" }, maybeDialog);
  watch({ prefix: "phoenix." }, n => { if (menuAncestor(n)) styleMenu(n); });
  watch("search.entry", styleHeader);
  watch("composer", styleComposer);
  const extraSurfaces = [
    ...["create-thread","empty-chat"].map(n => [n,namedThreadButton]),
    ...dmControls.map(n => [n,dmActions]),
    ...["guild-sheet","guild-sheet-name","tab-invite","tab-settings"].map(n => [n,guildOptions]),
    ...[...inboxPages,...inboxRows,requestActions].map(n => [n,inbox]),
    ["social-tabs",paintTabs],
    ...["social-sensitive","social-spam","social-sharing","social-servers","social-pages","social-pager","privacy-request","privacy-profile"].map(n => [n,preferenceSection]),
  ];
  for (const [match,visit] of extraSurfaces) watch(match, visit);
  watch("ignore", n => {
    for (let p = parent(n), d = 0; p && d < 8; p = parent(p), d++) {
      if (p.accessibilityId?.startsWith(requestActions.prefix)) { inbox(p); break; }
    }
  });
  for (const name of pickerAnchors) watch(name, paintPicker);
  watch({ prefix: "message.author:" }, photoOnly);
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
    if (target==="guild.menu" || target==="guild-title") openingGuild(); else stopGuildWatch();
    if (target === "composer.attachments" || target === "composer.expressions") openingPicker();
    else stopPickerWatch();
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
  watchers.push(ui.onEvent("pageSettle", () => {
    clearSurfaceTags();
    for (const id of categoryInsets.keys()) {
      const list = ui.node(id);
      if (list) compactFirstCategory(list); else categoryInsets.delete(id);
    }
    forLive("composer",styleComposer);
    forLive(requestActions,inbox);
    forLive("social-tabs",paintTabs);
    const chat = lastList == null ? null : ui.node(lastList);
    if (chat) {
      ui.update(chat.id, { scrollFade: [] });
      chatFooter(chat);
    }
    const list = lastSettings == null ? null : ui.node(lastSettings);
    if (list && detailLists.has(list.id)) detailWidgets(list,detailLists.get(list.id));
  }));
  watchers.push(ui.onEvent("submit", e => { if (e.accessibilityId === "composer") clearEditing(); }));
  watchers.push(ui.onEvent("scrollSettle", event => {
    if (event.node === lastList) chatFooter(ui.node(lastList));
    if (editingMessage) forLive(contextCancel, paintEditedMessage);
    if (joinedBar && !ui.node(joinedBar.cancel)) clearEditing();
    const scrolled = ui.node(event.node);
    if (scrolled && ["scroll","list"].includes(kindOf(scrolled))) {
      for (let n=scrolled,d=0; n && d<10; n=parent(n),d++) {
        if (inboxPages.includes(n.accessibilityId)) { inbox(scrolled); break; }
        const route=detailLists.get(n.id);
        if (route) {detailWidgets(scrolled,route);break;}
      }
    }
    if (scrolled && seenPanels.has(scrolled.id)) paintChannelPane(scrolled);
    const list = lastSettings == null ? null : ui.node(lastSettings);
    if (list && (event.node === list.id || event.node === list.parent)) {
      paintSettingsList(list);
    } else if (lastList == null || event.node === lastList) {
      sweepBubbles();
      forLive(messageMatch, styleChat);
      forLive({ prefix: "message.author:" }, photoOnly);
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
    if (name && (name === "social-tabs" || name === "create-thread" || name === "empty-chat" || name === "guild-sheet" ||
        dmControls.includes(name) || inboxPages.includes(name) || inboxRows.includes(name) || name.startsWith("request-actions-"))) {
      const item=ui.node(event.node);
      if (item?.accessibilityId===name) for (const [match,visit] of extraSurfaces) {
        if (match===name || (match.prefix && name.startsWith(match.prefix))) visit(item);
      }
    }
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
  if (ui.onSelected) watchers.push(ui.onSelected(snapshot => {
    const n = ui.node(snapshot.id);
    if (original(n)?.role === "radio") themeRadio(n);
    else if (isSocialTab(n)) refreshTabs(n);
  }));
  if (typeof ui.onChecked === "function") {
    watchers.push(ui.onChecked(snapshot => {
      const node = ui.node(snapshot.id);
      if (!node || typeof node.checked !== "boolean") return;
      if (node.sheet != null && original(node)?.role === "switch" && !switchOwners.has(node.id)) guildOptions(node);
      const reactionAnchor = reactionRows.has(node.id) && ui.node(reactionRows.get(node.id));
      if (reactionAnchor) paintReactions(messageColumn(reactionAnchor) || parent(reactionAnchor), reactionAnchor);
      if (original(node)?.role === "radio") themeRadio(node);
      if (isSocialTab(node)) refreshTabs(node);
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
    stopPickerWatch();
    clearPickerCorners(true);
    clearSurfaceTags(true);
    for (const id of categoryInsets.keys()) restoreCategory(id);
    stopGuildWatch();
    removeSkins(true);
    clearEditing();
    sweepBubbles(true);
    for (const remove of watchers) remove();
    for (const remove of rules) remove();
  });
})();
