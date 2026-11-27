// @description Shows which devices people are online from: desktop, mobile, web or console
// @version 1.0.0
// @author yuax
"use strict";
(() => {
  // plugins/platform-indicators/src/index.ts
  var PLATFORMS = {
    desktop: {
      label: "Desktop",
      emoji: "\u{1F5A5}\uFE0F",
      icon: "M4 2.5c-1.103 0-2 .897-2 2v11c0 1.104.897 2 2 2h7v2H7v2h10v-2h-4v-2h7c1.103 0 2-.896 2-2v-11c0-1.103-.897-2-2-2H4Zm16 2v9H4v-9h16Z"
    },
    mobile: {
      label: "Mobile",
      emoji: "\u{1F4F1}",
      icon: "M 187 0 L 813 0 C 916.277 0 1000 83.723 1000 187 L 1000 1313 C 1000 1416.277 916.277 1500 813 1500 L 187 1500 C 83.723 1500 0 1416.277 0 1313 L 0 187 C 0 83.723 83.723 0 187 0 Z M 125 1000 L 875 1000 L 875 250 L 125 250 Z M 500 1125 C 430.964 1125 375 1180.964 375 1250 C 375 1319.036 430.964 1375 500 1375 C 569.036 1375 625 1319.036 625 1250 C 625 1180.964 569.036 1125 500 1125 Z",
      box: "-250 0 1500 1500"
    },
    web: {
      label: "Web",
      emoji: "\u{1F310}",
      icon: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93Zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39Z"
    },
    embedded: {
      label: "Console",
      emoji: "\u{1F3AE}",
      icon: "M3.06 20.4q-1.53 0-2.37-1.065T.06 16.74l1.26-9q.27-1.8 1.605-2.97T6.06 3.6h11.88q1.8 0 3.135 1.17t1.605 2.97l1.26 9q.21 1.53-.63 2.595T20.94 20.4q-.63 0-1.17-.225T18.78 19.5l-2.7-2.7H7.92l-2.7 2.7q-.45.45-.99.675t-1.17.225Zm14.94-7.2q.51 0 .855-.345T19.2 12q0-.51-.345-.855T18 10.8q-.51 0-.855.345T16.8 12q0 .51.345 .855T18 13.2Zm-2.4-3.6q.51 0 .855-.345T16.8 8.4q0-.51-.345-.855T15.6 7.2q-.51 0-.855.345T14.4 8.4q0 .51.345 .855T15.6 9.6ZM6.9 13.2h1.8v-2.1h2.1v-1.8h-2.1v-2.1h-1.8v2.1h-2.1v1.8h2.1v2.1Z"
    },
    vr: {
      label: "VR",
      emoji: "\u{1F97D}",
      icon: "M8.46 8.64a1 1 0 0 1 1 1c0 .44-.3.8-.72.92l-.11.07c-.08.06-.2.19-.2.41a.99.99 0 0 1-.98.86h-.06a1 1 0 0 1-.94-1.05l.02-.32c.05-1.06.92-1.9 1.99-1.9ZM15.55 5a5.5 5.5 0 0 1 5.15 3.67h.3a2 2 0 0 1 2 2v3.18a2 2 0 0 1-2 1.99h-.2A4.54 4.54 0 0 1 16.55 19a4.45 4.45 0 0 1-3.6-1.83 1.2 1.2 0 0 0-1.9 0 4.44 4.44 0 0 1-3.9 1.82 4.54 4.54 0 0 1-3.94-3.15H3a2 2 0 0 1-2-2v-3.18c0-1.1.9-1.99 2-1.99h.3A5.5 5.5 0 0 1 8.46 5h7.09Zm-7.1 2C6.6 7 5.06 8.5 4.97 10.41l-.02.66v3.18c0 1.43 1.05 2.66 2.34 2.74.85.06 1.63-.32 2.14-1.01a3.2 3.2 0 0 1 2.57-1.3c1 0 1.97.48 2.57 1.3.5.69 1.3 1.08 2.14 1.01 1.3-.08 2.34-1.31 2.34-2.74l-.02-3.84a3.54 3.54 0 0 0-3.49-3.43H8.45Z"
    }
  };
  var STATUS = {
    online: { label: "Online", color: 4280526170 },
    idle: { label: "Idle", color: 4293964338 },
    dnd: { label: "Do Not Disturb", color: 4294065987 }
  };
  var settings = phoenix.settings.define({
    memberList: {
      type: "switch",
      title: "Show in the member list",
      description: "Next to each member's name, and in the DM list",
      default: true,
      onChange: (on2) => sync("members", on2)
    },
    messageHeaders: {
      type: "switch",
      title: "Show in message headers",
      description: "Next to each author's name",
      default: true,
      onChange: (on2) => sync("headers", on2)
    },
    profileBadges: { type: "switch", title: "Profile badges", default: true },
    ignoreBots: { type: "switch", title: "Ignore bots", default: true, onChange: () => update() },
    showSelf: { type: "switch", title: "Show my own", default: true, onChange: () => update() }
  });
  var presences = /* @__PURE__ */ new Map();
  var drawn = /* @__PURE__ */ new Set();
  var bots = /* @__PURE__ */ new Set();
  var selfId;
  var isRecord = (v) => typeof v === "object" && v !== null;
  var isStatus = (v) => v === "online" || v === "idle" || v === "dnd";
  var svg = (d, place = { size: 1, top: 0 }) => {
    const [x, y, w, h] = (PLATFORMS[d].box ?? "0 0 24 24").split(" ").map(Number);
    const view = h / place.size;
    const box = `${x - (view - w) / 2} ${y - place.top * view} ${view} ${view}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}"><path d="${PLATFORMS[d].icon}"/></svg>`;
  };
  var HEADER = { size: 20 / 24, top: 0.04 };
  var mobile = "bridge" in phoenix;
  var asset = (d, status) => `https://assets.sunbird.tools/plugins/platform-indicators/${d}-${status}.${mobile ? "png" : "svg"}`;
  var devices = (p) => Object.keys(PLATFORMS).filter((d) => p.platforms[d]);
  var key = (p) => p ? devices(p).map((d) => d + p.platforms[d]).join() : "";
  function setPresence(userId, presence) {
    const before = key(presences.get(userId));
    if (presence && devices(presence).length) {
      presences.delete(userId);
      presences.set(userId, presence);
      if (presences.size > 2e4) presences.delete(presences.keys().next().value);
    } else {
      presences.delete(userId);
    }
    if (key(presence) !== before && drawn.has(userId)) update(userId);
  }
  function readPresence(raw, userId) {
    if (!isRecord(raw)) return;
    const user = isRecord(raw.user) ? raw.user : {};
    const id = typeof user.id === "string" ? user.id : typeof raw.user_id === "string" ? raw.user_id : userId;
    if (!id) return;
    const platforms = {};
    for (const [device, status] of Object.entries(isRecord(raw.client_status) ? raw.client_status : {})) {
      if (device in PLATFORMS && isStatus(status)) platforms[device] = status;
    }
    setPresence(id, isStatus(raw.status) ? { status: raw.status, platforms } : void 0);
  }
  var readAll = (list) => Array.isArray(list) && list.forEach((raw) => readPresence(raw));
  var on = (sig, fn) => sig && phoenix.on(sig, fn);
  var { gateway } = phoenix;
  on(gateway.presenceUpdate, readPresence);
  on(gateway.presencesReplace, readAll);
  on(gateway.guildMembersChunk, (p) => readAll(p?.presences));
  on(gateway.readySupplemental, (p) => {
    readAll(p?.merged_presences?.friends);
    (p?.merged_presences?.guilds ?? []).forEach(readAll);
  });
  on(gateway.guildMemberListUpdate, (p) => {
    for (const op of p?.ops ?? []) {
      for (const item of op.items ?? [op.item]) {
        const user = item?.member?.user;
        if (!user?.id) continue;
        if (user.bot) bots.add(user.id);
        readPresence(item.member.presence, user.id);
      }
    }
  });
  on(gateway.sessionsReplace, (sessions) => {
    if (!selfId || !Array.isArray(sessions)) return;
    const platforms = {};
    let status;
    for (const s of sessions) {
      if (!isStatus(s?.status)) continue;
      if (s.session_id === "all") status = s.status;
      else if (s.client_info?.client in PLATFORMS) platforms[s.client_info.client] ??= s.status;
    }
    setPresence(selfId, status && { status, platforms });
  });
  phoenix.on(gateway.messageCreate, (m) => m.author?.bot && bots.add(m.author.id));
  phoenix.discord.me().then((me) => selfId = me?.id).catch(() => {
  });
  function shown(userId, bot) {
    if (bot && settings.ignoreBots || userId === selfId && !settings.showSelf) return;
    return presences.get(userId);
  }
  var removers = {};
  var update = (userId) => Object.values(removers).forEach((r) => r.update?.(userId));
  var render = (place) => ({ userId }) => {
    if (drawn.size > 2e3) drawn.clear();
    drawn.add(userId);
    const p = shown(userId, bots.has(userId));
    if (!p) return null;
    return {
      text: devices(p).map((d) => PLATFORMS[d].emoji).join(" "),
      color: STATUS[p.status].color,
      icons: devices(p).map((d) => ({
        svg: svg(d, place),
        color: STATUS[p.platforms[d]].color,
        uri: asset(d, p.platforms[d])
      }))
    };
  };
  function sync(where, enabled) {
    const current = removers[where];
    if (enabled && !current) {
      const add = where === "members" ? phoenix.ui.addMemberDecoration : phoenix.ui.addMessageHeaderDecoration;
      removers[where] = add?.({ render: render(where === "headers" ? HEADER : void 0) });
    } else if (!enabled && current) {
      current();
      delete removers[where];
    }
  }
  sync("members", settings.memberList);
  sync("headers", settings.messageHeaders);
  var toHex = (s) => [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
  function badgeId(text) {
    let hash = 2166136261;
    for (const c of text) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    return String(11e8 + (hash >>> 0) % 9e8);
  }
  phoenix.discord.onResponse({ method: "GET", pathPrefix: "/users/", pathSuffix: "/profile" }, async (res) => {
    if (!settings.profileBadges || res.status < 200 || res.status >= 300) return;
    const match = res.path.match(/^\/users\/(@me|\d+)\/profile/);
    const userId = match?.[1] === "@me" ? (await phoenix.discord.me())?.id : match?.[1];
    const data = res.json();
    if (!userId || !data) return;
    const p = shown(userId, data.user?.bot === true);
    if (!p) return;
    const badges = devices(p).map((d) => {
      const status = p.platforms[d];
      const uri = asset(d, status);
      return {
        id: badgeId(`platform-indicators:${d}:${status}`),
        description: `${PLATFORMS[d].label} \xB7 ${STATUS[status].label}`,
        icon: `phx_u_${toHex(uri)}`,
        simple_icon_url: uri
      };
    });
    data.badges = [...badges, ...Array.isArray(data.badges) ? data.badges : []];
    return { body: data };
  });
})();
