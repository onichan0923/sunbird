// @description Shows user badges from other Discord client mods on profiles
// @version 0.5.7
// @author iFlex0x, wolfieeeeeeee
// @warning Fetches badges from Equibadges (badges.equicord.org)
"use strict";
(() => {
  // plugins/global-badges/src/index.ts
  var API = "https://badges.equicord.org/users";
  var TTL = 6 * 60 * 60 * 1e3;
  var RETRY_DELAY = 30 * 1e3;
  var BADGE_ID_BASE = 9e5;
  var CACHE_KEY = "equibadges";
  var ART_OVERRIDES = {
    "vencord:vencord contributor": "https://cdn.discordapp.com/emojis/1562267648857997356.webp?size=128"
  };
  var settings = phoenix.settings.define({
    showCustom: {
      type: "switch",
      title: "Badge source",
      description: "Show where community badges came from in Badge Directory",
      default: true
    },
    badgeVault: {
      type: "switch",
      title: "BadgeVault badges",
      description: "Show BadgeVault badges, which any user can make",
      default: false
    }
  });
  var users = {};
  var refreshAt = 0;
  var refreshing;
  var providerNames = new Map(Object.entries({
    aliucord: "Aliucord",
    equicord: "Equicord",
    nekocord: "Nekocord",
    raincord: "Raincord",
    replugged: "Replugged",
    reviewdb: "ReviewDB",
    vencord: "Vencord",
    enmity: "Enmity",
    velocity: "Velocity",
    aero: "Aero",
    goosemod: "GooseMod",
    vendroidenhanced: "Vendroid Enhanced",
    paicord: "Paicord",
    revenge: "Revenge",
    betterdiscord: "BetterDiscord",
    record: "ReCord",
    bunny: "Bunny"
  }));
  function toHex(text) {
    let out = "";
    for (let i = 0; i < text.length; i++) {
      out += text.charCodeAt(i).toString(16).padStart(2, "0");
    }
    return out;
  }
  function badgeId(uri) {
    let hash = 2166136261;
    for (let i = 0; i < uri.length; i++) {
      hash ^= uri.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return BADGE_ID_BASE + (hash >>> 0) % 1e9;
  }
  function badgeUrl(uri, animated = false) {
    return `https://cdn.discordapp.com/badge-icons/phx_u_${toHex(uri)}${animated ? ".gif" : ".png"}`;
  }
  async function userIdFromPath(path) {
    const m = path.match(/^\/users\/(@me|\d+)\/(?:profile|badges)(?:[?#]|$)/);
    if (!m) return null;
    return m[1] === "@me" ? (await phoenix.discord.me())?.id ?? null : m[1];
  }
  function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function parseBadges(entries) {
    if (!Array.isArray(entries)) return [];
    const badges = [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.mod !== "string" || typeof entry.badge !== "string" || typeof entry.tooltip !== "string") continue;
      const mod = entry.mod.trim().toLowerCase();
      if (!mod || mod === "discord" || mod === "badgevault" && !settings.badgeVault) continue;
      const source = providerNames.get(mod) ?? entry.mod.trim();
      const name = entry.tooltip.trim();
      const uri = ART_OVERRIDES[`${mod}:${name.toLowerCase()}`] ?? entry.badge.trim();
      if (!name || !/^https?:\/\/[^/\s]+/i.test(uri) || seen.has(uri)) continue;
      seen.add(uri);
      badges.push({ uri, name, source });
    }
    return badges;
  }
  async function refreshUsers() {
    if (!refreshing) {
      refreshing = (async () => {
        const res = await phoenix.fetch(API);
        if (!res.ok) throw new Error(`Equibadges HTTP ${res.status}`);
        const body = res.json();
        if (!isRecord(body) || !isRecord(body.users)) throw new Error("Invalid Equibadges response");
        if (!Object.keys(body.users).length) throw new Error("Empty Equibadges response");
        users = body.users;
        refreshAt = Date.now() + TTL;
        try {
          phoenix.storage.set(CACHE_KEY, { at: Date.now(), users });
        } catch {
        }
      })().catch(() => {
        refreshAt = Date.now() + RETRY_DELAY;
      }).finally(() => {
        refreshing = void 0;
      });
    }
    return refreshing;
  }
  function readCache() {
    try {
      const cached = phoenix.storage.get(CACHE_KEY);
      if (!cached || typeof cached.at !== "number" || !isRecord(cached.users)) return;
      if (!Object.keys(cached.users).length) return;
      users = cached.users;
      refreshAt = cached.at + TTL;
    } catch {
    }
  }
  async function badgesFor(userId) {
    if (Date.now() >= refreshAt) void refreshUsers();
    return parseBadges(users[userId]);
  }
  var ROLE_BADGE = /\b(contributor|early user|developer|dev|donor|donator|staff|team)\b/i;
  function displayName({ name, source }) {
    return ROLE_BADGE.test(name) && !name.toLowerCase().startsWith(source.toLowerCase()) ? `${source} ${name}` : name;
  }
  readCache();
  if (Date.now() >= refreshAt) void refreshUsers();
  phoenix.discord.onResponse(
    { method: "GET", pathPrefix: "/users/", pathSuffix: "/profile" },
    async (res) => {
      if (res.status < 200 || res.status >= 300) return;
      const userId = await userIdFromPath(res.path);
      if (!userId) return;
      const data = res.json();
      if (!isRecord(data)) return;
      const extra = await badgesFor(userId);
      if (!extra.length) return;
      const existing = Array.isArray(data.badges) ? data.badges : [];
      const injected = extra.map((b) => ({
        id: String(badgeId(b.uri)),
        description: displayName(b),
        icon: `phx_u_${toHex(b.uri)}`,
        simple_icon_url: b.uri
      }));
      data.badges = [...injected, ...existing];
      return { body: data };
    }
  );
  phoenix.discord.onResponse(
    { method: "GET", pathPrefix: "/users/", pathSuffix: "/badges" },
    async (res) => {
      if (res.path.startsWith("/users/@me/")) return;
      const noBadges = res.status === 404;
      if (!noBadges && (res.status < 200 || res.status >= 300)) return;
      const userId = await userIdFromPath(res.path);
      if (!userId) return;
      const extra = await badgesFor(userId);
      if (!extra.length) return;
      const data = noBadges ? {} : res.json();
      if (!isRecord(data)) return;
      const existing = Array.isArray(data.badges) ? data.badges : [];
      const injected = extra.map((b) => ({
        badge_id: badgeId(b.uri),
        name: displayName(b),
        description: settings.showCustom ? `Badge from ${b.source}.` : "",
        ...settings.showCustom ? { info_label: b.source } : {},
        rarity: 5,
        simple_icon_url: badgeUrl(b.uri),
        simple_icon_raster_url: badgeUrl(b.uri),
        complex_icon_static_url: badgeUrl(b.uri),
        .../(\.gif|\.webp)(?:[?#]|$)/i.test(b.uri) ? { complex_icon_animated_url: badgeUrl(b.uri, true) } : {},
        is_earnable: true,
        owned: true,
        hidden: false
      }));
      data.badges = [...injected, ...existing];
      return noBadges ? { status: 200, body: data } : { body: data };
    }
  );
})();
