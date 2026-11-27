// @description Sends custom and animated emojis as links, and renders fake emojis, stickers, and GIFs as real ones
// @version 0.4.1
// @author mantikafasi
"use strict";
(() => {
  // plugins/fakenitro/src/index.ts
  var { gateway } = phoenix;
  var settings = phoenix.settings.define({
    emojiSize: {
      type: "select",
      title: "Emoji size",
      options: [
        { value: "48" },
        { value: "32" },
        { value: "64" },
        { value: "96" },
        { value: "128" },
        { value: "160" }
      ]
    },
    useHyperLinks: {
      type: "switch",
      title: "Hide links behind the name",
      description: "Send [name](link) instead of the bare link",
      default: true
    },
    hyperLinkText: {
      type: "text",
      title: "Link text",
      description: "{{NAME}} is replaced with the emoji's name",
      default: "{{NAME}}"
    },
    renderFakeEmojis: {
      type: "switch",
      title: "Render fake emojis",
      description: "Display fake Nitro emoji links as real custom emojis",
      default: true
    },
    renderFakeStickers: {
      type: "switch",
      title: "Render fake stickers",
      description: "Display fake Nitro sticker links as real stickers",
      default: true
    },
    renderFakeGifs: {
      type: "switch",
      title: "Render fake GIFs",
      description: "Display hyperlinked GIFs as clean native GIF embeds",
      default: true
    },
    renderOwnMessages: {
      type: "switch",
      title: "Include your own messages",
      description: "Also render fake emojis, stickers, and GIFs in your own messages",
      default: false
    },
    forceFake: {
      type: "switch",
      title: "Always spoof emojis",
      description: "Send external and animated emojis as links even when you have Nitro (useful when external emojis are blocked)",
      default: false
    }
  });
  var emojis = /* @__PURE__ */ new Map();
  var byName = /* @__PURE__ */ new Map();
  var stickers = /* @__PURE__ */ new Map();
  var channelGuild = /* @__PURE__ */ new Map();
  var picked = /* @__PURE__ */ new Map();
  var transformed = /* @__PURE__ */ new Map();
  var TRANSFORMED_LIMIT = 2048;
  var premiumType = null;
  var currentUserId = null;
  var addEmojis = (guild, list) => {
    for (const e of list ?? []) {
      if (!e.id || !e.name || emojis.has(e.id)) continue;
      const emoji = { id: e.id, name: e.name, animated: !!e.animated, available: e.available !== false, guild };
      emojis.set(e.id, emoji);
      byName.set(e.name, [...byName.get(e.name) ?? [], emoji]);
    }
  };
  var addStickers = (list) => {
    for (const s of list ?? []) {
      if (!s.id || !s.name) continue;
      stickers.set(s.id, { id: s.id, name: s.name, format_type: s.format_type });
    }
  };
  var unpad = (id) => id.replace(/^0+/, "");
  var load = async () => {
    const guilds = await phoenix.stores.sql(
      "SELECT k AS g, json_extract(CAST(v AS TEXT), '$.emojis') AS e, json_extract(CAST(v AS TEXT), '$.stickers') AS s FROM guilds"
    );
    for (const { g, e, s } of guilds) {
      if (e) addEmojis(unpad(g), JSON.parse(e));
      if (s) addStickers(JSON.parse(s));
    }
    for (const table of ["channel_stubs", "channels"]) {
      const channels = await phoenix.stores.sql(
        `SELECT substr(k, 1, 20) AS g, group_concat(substr(k, 22)) AS c FROM ${table} WHERE k NOT LIKE '00000000000000000000:%' GROUP BY 1`
      ).catch(() => []);
      for (const { g, c } of channels) for (const id of c.split(",")) channelGuild.set(unpad(id), unpad(g));
    }
    phoenix.log.info(
      `${emojis.size} emojis, ${stickers.size} stickers in ${guilds.length} servers, ${channelGuild.size} channels`
    );
  };
  var reload = () => load().catch((err) => phoenix.log.warn(`reading the cache: ${err}`));
  reload();
  if (gateway.guildCreate) {
    phoenix.on(gateway.guildCreate, (guild) => {
      addEmojis(guild.id, guild.emojis);
      addStickers(guild.stickers);
      for (const channel of guild.channels ?? []) channelGuild.set(channel.id, guild.id);
    });
  }
  if (gateway.guildEmojisUpdate) {
    phoenix.on(gateway.guildEmojisUpdate, (update) => addEmojis(update.guild_id, update.emojis));
  }
  if (gateway.guildStickersUpdate) {
    phoenix.on(gateway.guildStickersUpdate, (update) => {
      const payload = update;
      addStickers(payload.stickers);
    });
  }
  var readTier = () => phoenix.discord.me().then((user) => {
    if (!user) return;
    premiumType = user.premium_type ?? 0;
    if (currentUserId !== null && currentUserId !== user.id) {
      for (const map of [emojis, byName, stickers, channelGuild, picked]) map.clear();
      reload();
    }
    currentUserId = user.id;
  }).catch((err) => phoenix.log.warn(`reading the account: ${err}`));
  readTier();
  if (gateway.readySupplemental) {
    phoenix.on(gateway.readySupplemental, () => {
      readTier();
      reload();
    });
  }
  var usable = (emoji, guild) => emoji.available && (!settings.forceFake && (premiumType ?? 1) > 0 || !emoji.animated && emoji.guild === guild);
  var link = (emoji) => {
    const size = settings.emojiSize;
    const name = encodeURIComponent(emoji.name);
    const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "webp"}?size=${size}&name=${name}&lossless=true`;
    if (!settings.useHyperLinks) return url;
    return `[${settings.hyperLinkText.replaceAll("{{NAME}}", emoji.name)}](${url})`;
  };
  var rewrite = (text, guild) => {
    let linked = -1;
    return text.replace(/(?<!\\)<a?:(\w+):(\d+)>|(?<![\\<]):(\w+):(?!\d)/g, (match, _n, id, name, offset, whole) => {
      let emoji;
      if (id) {
        emoji = emojis.get(id);
        if (!emoji || usable(emoji, guild)) return match;
      } else {
        const found = picked.has(name) ? [picked.get(name)] : byName.get(name) ?? [];
        if (found.some((e) => usable(e, guild))) return match;
        emoji = found.find((e) => e.available);
        if (!emoji) return match;
      }
      const end = offset + match.length;
      const before = offset > 0 && offset !== linked && !/\s/.test(whole[offset - 1]) ? " " : "";
      const after = end < whole.length && !/\s/.test(whole[end]) ? " " : "";
      linked = end;
      return before + link(emoji) + after;
    });
  };
  var guildOf = (ctx) => ctx.channelId ? channelGuild.get(ctx.channelId) : void 0;
  phoenix.messages.onEmojiPick((id, ctx) => {
    const emoji = emojis.get(id);
    if (!emoji || usable(emoji, guildOf(ctx))) return;
    picked.set(emoji.name, emoji);
    return `:${emoji.name}: `;
  });
  phoenix.messages.onSend((text, ctx) => {
    readTier();
    if (!text.includes(":")) return;
    const result = rewrite(text, guildOf(ctx));
    return result === text ? void 0 : result;
  });
  var CODE_SPLIT = /(```[\s\S]*?```|`[^`\n]+`)/g;
  var cdnLinks = (path, exts) => {
    const url = `https?:\\/\\/(?:cdn\\.discordapp\\.com|media\\.discordapp\\.net)\\/${path}\\/\\d{15,22}\\.(?:${exts})(?:[?#][^\\s)<>]*)?`;
    return new RegExp(`\\[([^\\]\\n]*)\\]\\((${url})\\)|(?<![<(\\[])(${url})`, "gi");
  };
  var EMOJI_LINK_RE = cdnLinks("emojis", "png|jpe?g|webp|gif");
  var STICKER_LINK_RE = cdnLinks("stickers", "png|webp|gif|apng|json");
  var ASSET_RE = /\/(emojis|stickers)\/(\d{15,22})\.(\w+)/i;
  var GIF_HYPERLINK_RE = /\[([^\]\n]*)\]\((https?:\/\/[^\s)<>]+)\)/g;
  var GIF_URL_RE = /^https?:\/\/(?:(?:www\.)?(?:tenor\.com\/view\/|giphy\.com\/gifs\/|klipy\.com\/gifs\/)|(?:media\d*|c|i)\.tenor\.com\/|(?:media\d*|i)\.giphy\.com\/|static\.klipy\.com\/|[^\s?#]+\.gif(?:[?#]|$))/i;
  var INVISIBLE_LABEL_RE = /^[\s​-‏⁠⠀﻿._-]*$/;
  var safeDecode = (s) => {
    try {
      return decodeURIComponent(s.replaceAll("+", " "));
    } catch {
      return s;
    }
  };
  var parseQuery = (url) => {
    const out = /* @__PURE__ */ new Map();
    const q = url.indexOf("?");
    if (q === -1) return out;
    const hash = url.indexOf("#", q);
    for (const part of url.slice(q + 1, hash === -1 ? url.length : hash).split("&")) {
      if (!part) continue;
      const eq = part.indexOf("=");
      const key = eq === -1 ? part : part.slice(0, eq);
      out.set(safeDecode(key).toLowerCase(), eq === -1 ? "" : safeDecode(part.slice(eq + 1)));
    }
    return out;
  };
  var emojiName = (raw) => {
    const cleaned = (raw ?? "").replace(/^:+|:+$/g, "").replace(/[^a-zA-Z0-9_]/g, "");
    return cleaned.length >= 2 ? cleaned.slice(0, 32) : "";
  };
  var stickerName = (raw) => (raw ?? "").replace(/[​-‏⁠⠀﻿]/g, "").trim().slice(0, 32);
  var stickerFormat = (id, ext, params) => {
    const cached = stickers.get(id);
    if (cached) return cached.format_type;
    if (ext === "gif") return 4;
    if (ext === "json") return 3;
    if (ext === "apng" || params.get("animated")?.toLowerCase() === "true") return 2;
    return 1;
  };
  var rememberTransformed = (id, ids) => {
    transformed.set(id, ids);
    if (transformed.size > TRANSFORMED_LIMIT) {
      const oldest = transformed.keys().next().value;
      if (oldest !== void 0) transformed.delete(oldest);
    }
  };
  var stripFakeEmbeds = (embeds, ids) => {
    if (!embeds?.length || !ids.size) return false;
    const kept = embeds.filter(
      (embed) => ![embed.url, embed.image?.url, embed.thumbnail?.url].some((url) => {
        const asset = url && ASSET_RE.exec(url);
        return !!asset && ids.has(asset[2]);
      })
    );
    if (kept.length === embeds.length) return false;
    embeds.splice(0, embeds.length, ...kept);
    return true;
  };
  var rendering = () => settings.renderFakeEmojis || settings.renderFakeStickers || settings.renderFakeGifs;
  var renderContent = (content, ids, found) => {
    const parts = content.split(CODE_SPLIT);
    for (let i = 0; i < parts.length; i += 2) {
      if (!parts[i].includes("http")) continue;
      if (settings.renderFakeEmojis) {
        parts[i] = parts[i].replace(EMOJI_LINK_RE, (_m, label, mdUrl, bareUrl) => {
          const url = mdUrl ?? bareUrl;
          const [, , id, ext] = ASSET_RE.exec(url);
          const params = parseQuery(url);
          const flag = params.get("animated")?.toLowerCase();
          const animated = ext.toLowerCase() === "gif" || flag === "true" || flag === "1" || flag !== "false" && !!emojis.get(id)?.animated;
          ids.add(id);
          const name = emojiName(params.get("name")) || emojis.get(id)?.name || emojiName(label) || "emoji";
          return `<${animated ? "a" : ""}:${name}:${id}>`;
        });
      }
      if (settings.renderFakeStickers) {
        parts[i] = parts[i].replace(STICKER_LINK_RE, (_m, label, mdUrl, bareUrl) => {
          const url = mdUrl ?? bareUrl;
          const [, , id, ext] = ASSET_RE.exec(url);
          const params = parseQuery(url);
          ids.add(id);
          if (!found.some((s) => s.id === id)) {
            const name = stickers.get(id)?.name || stickerName(params.get("name")) || stickerName(label) || "Sticker";
            found.push({ id, name, format_type: stickerFormat(id, ext.toLowerCase(), params) });
          }
          return "";
        });
      }
    }
    let text = parts.join("");
    if (found.length) text = text.replace(/[ \t]{2,}/g, " ").trim();
    if (settings.renderFakeGifs && text.includes("](")) {
      const alone = /^\[[^\]\n]*\]\((https?:\/\/[^\s)<>]+)\)$/.exec(text.trim());
      if (alone && GIF_URL_RE.test(alone[1])) return alone[1];
      const gifParts = text.split(CODE_SPLIT);
      for (let i = 0; i < gifParts.length; i += 2) {
        gifParts[i] = gifParts[i].replace(
          GIF_HYPERLINK_RE,
          (match, label, url) => GIF_URL_RE.test(url) && INVISIBLE_LABEL_RE.test(label) ? "" : match
        );
      }
      const unwrapped = gifParts.join("");
      if (unwrapped !== text) text = unwrapped.replace(/[ \t]{2,}/g, " ").trim();
    }
    return text;
  };
  var transformSingle = (message) => {
    if (!rendering()) return false;
    if (!settings.renderOwnMessages && currentUserId && message.author?.id === currentUserId) return false;
    if (typeof message.content !== "string") {
      const prev = message.id && transformed.get(message.id);
      return !!prev && stripFakeEmbeds(message.embeds, prev);
    }
    if (!message.content.includes("http")) return false;
    const ids = /* @__PURE__ */ new Set();
    const found = [];
    const content = renderContent(message.content, ids, found);
    let changed = content !== message.content;
    message.content = content;
    const existing = message.sticker_items ?? [];
    const added = found.filter((s) => !existing.some((e) => e.id === s.id));
    if (added.length) {
      message.sticker_items = [...existing, ...added];
      changed = true;
    }
    if (ids.size) {
      if (message.id) rememberTransformed(message.id, ids);
      if (stripFakeEmbeds(message.embeds, ids)) changed = true;
    }
    return changed;
  };
  var transformMessage = (message) => {
    if (!message || typeof message !== "object") return false;
    let changed = transformSingle(message);
    if (transformMessage(message.referenced_message)) changed = true;
    for (const snap of message.message_snapshots ?? []) {
      if (transformMessage(snap?.message)) changed = true;
    }
    return changed;
  };
  for (const event of [gateway.messageCreate, gateway.messageUpdate]) {
    phoenix.hook(event, {
      before(message) {
        transformMessage(message);
      }
    });
  }
  var worthParsing = (res) => res.status >= 200 && res.status < 300 && rendering() && (res.body.includes("/emojis/") || res.body.includes("/stickers/") || res.body.includes("]("));
  var transformResponse = (res) => {
    if (!worthParsing(res)) return;
    const data = res.json();
    if (!data) return;
    const list = Array.isArray(data) ? data : "items" in data || "messages" in data ? [...(data.items ?? []).map((entry) => entry?.message), ...(data.messages ?? []).flat()] : [data];
    let changed = false;
    for (const message of list) {
      if (transformMessage(message)) changed = true;
    }
    return changed ? { body: data } : void 0;
  };
  for (const [method, pathPrefix, pathSuffix] of [
    ["GET", "/channels/", "/messages"],
    ["POST", "/channels/", "/messages"],
    ["GET", "/channels/", "/pins"],
    ["GET", "/channels/", "/messages/search"],
    ["GET", "/guilds/", "/messages/search"]
  ]) {
    phoenix.discord.onResponse({ method, pathPrefix, pathSuffix }, transformResponse);
  }
  phoenix.discord.onResponse(
    { method: "PATCH", pathPrefix: "/channels/", pathIncludes: "/messages/" },
    transformResponse
  );
})();
