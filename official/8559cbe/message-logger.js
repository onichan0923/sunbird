// @description Keeps deleted messages and edit history
// @version 0.2.2
// @author amaanq
"use strict";
(() => {
  // plugins/message-logger/src/index.ts
  var { gateway } = phoenix;
  var settings = phoenix.settings.define({
    keepDeleted: {
      type: "switch",
      title: "Keep deleted messages",
      description: "Keep deleted messages, in red",
      default: true
    },
    keepEdits: {
      type: "switch",
      title: "Keep edit history",
      description: "Show earlier versions under edited messages",
      default: true
    },
    keepAttachments: {
      type: "switch",
      title: "Keep removed attachments",
      description: "Leave attachments an edit took off the message in place",
      default: true
    },
    ignoreBots: {
      type: "switch",
      title: "Ignore bots",
      description: "Skip messages sent by bots",
      default: true
    },
    ignoreUsers: {
      type: "text",
      title: "Ignored users",
      description: "User IDs separated by commas or spaces",
      default: ""
    },
    ignoreChannels: {
      type: "text",
      title: "Ignored channels",
      description: "Channel IDs separated by commas or spaces",
      default: ""
    },
    ignoreGuilds: {
      type: "text",
      title: "Ignored servers",
      description: "Server IDs separated by commas or spaces",
      default: ""
    }
  });
  var EPHEMERAL = 64;
  var RED = 4294065987;
  var limit = 8192;
  var seen = /* @__PURE__ */ new Map();
  var ids = (list) => list.split(/[\s,]+/).filter(Boolean);
  var ignored = (message) => (message.flags & EPHEMERAL) !== 0 || settings.ignoreBots && message.author?.bot === true || ids(settings.ignoreUsers).includes(message.author?.id) || ids(settings.ignoreChannels).includes(message.channel_id) || message.guild_id !== void 0 && ids(settings.ignoreGuilds).includes(message.guild_id);
  var remember = (message) => {
    let entry = seen.get(message.id);
    if (!entry) {
      entry = { content: message.content, attachments: [], changes: [] };
      seen.set(message.id, entry);
      if (seen.size > limit) seen.delete(seen.keys().next().value);
    }
    entry.content = message.content;
    entry.attachments = message.attachments ?? entry.attachments;
    return entry;
  };
  var pad = (n) => String(n).padStart(2, "0");
  var clock = (at) => {
    const date = new Date(at);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  var history = phoenix.ui.addMessageAccessory({
    priority: 1,
    render({ messageId }) {
      const entry = seen.get(messageId);
      if (!settings.keepEdits || !entry?.changes.length) return null;
      const text = entry.changes.map(
        (change) => change.removed ? `Removed ${change.text} \xB7 ${clock(change.at)}` : `${change.text || "(empty)"} \xB7 edited ${clock(change.at)}`
      ).join("\n");
      return entry.deletedAt === void 0 ? text : { text, color: RED };
    }
  });
  var deleted = phoenix.ui.addMessageAccessory({
    render({ messageId }) {
      const at = seen.get(messageId)?.deletedAt;
      return at === void 0 ? null : { text: `Deleted \xB7 ${clock(at)}`, color: RED, tint: RED };
    }
  });
  var isDesktop = typeof phoenix.bridge === "undefined";
  if (isDesktop) {
    phoenix.discord.onResponse(
      { method: "GET", pathPrefix: "/channels/", pathSuffix: "/messages" },
      (res) => {
        if (res.status < 200 || res.status >= 300) return;
        const list = res.json();
        if (!Array.isArray(list)) return;
        for (const item of list) {
          const msg = item;
          if (!msg?.id || typeof msg.content !== "string" || ignored(msg)) continue;
          if (!seen.has(msg.id)) remember(msg);
        }
      }
    );
  }
  phoenix.hook(gateway.messageCreate, {
    before(message) {
      if (!message.id || typeof message.content !== "string" || ignored(message)) return;
      const nonce = message.nonce === void 0 ? void 0 : String(message.nonce);
      if (nonce && nonce !== message.id && seen.has(nonce)) delete message.nonce;
      remember(message);
    }
  });
  phoenix.hook(gateway.messageUpdate, {
    before(message) {
      if (!message.id || !message.channel_id || typeof message.content !== "string") return;
      if (ignored(message)) return;
      const old = seen.get(message.id);
      const at = message.edited_timestamp ? Date.parse(message.edited_timestamp) : Date.now();
      const removed = old?.attachments.filter(
        (attachment) => !message.attachments?.some((kept) => kept.id === attachment.id)
      ) ?? [];
      const changes = old?.changes ?? [];
      if (old && old.content !== message.content) changes.push({ text: old.content, removed: false, at });
      if (removed.length && settings.keepAttachments) {
        message.attachments = [...message.attachments ?? [], ...removed];
        changes.push({ text: removed.map((attachment) => attachment.filename).join(", "), removed: true, at });
      }
      remember(message).changes = changes;
      if (old) history.update?.(message.id);
    }
  });
  var markDeleted = (id, channelId, guildId) => {
    let entry = seen.get(id);
    if (!entry) {
      if (!isDesktop) return false;
      if (channelId && ids(settings.ignoreChannels).includes(channelId) || guildId && ids(settings.ignoreGuilds).includes(guildId)) {
        return false;
      }
      entry = { content: "", attachments: [], changes: [] };
      seen.set(id, entry);
      if (seen.size > limit) seen.delete(seen.keys().next().value);
    }
    if (entry.deletedAt === void 0) {
      entry.deletedAt = Date.now();
      deleted.update?.(id);
      if (entry.changes.length) history.update?.(id);
    }
    if (isDesktop && channelId && !entry.repainted) {
      try {
        phoenix.dispatch(gateway.messageUpdate, {
          id,
          channel_id: channelId,
          ...guildId ? { guild_id: guildId } : {}
        });
        entry.repainted = true;
      } catch {
      }
    }
    return true;
  };
  phoenix.hook(gateway.messageDelete, {
    before(message) {
      if (settings.keepDeleted && markDeleted(message.id, message.channel_id, message.guild_id)) {
        return false;
      }
    }
  });
  phoenix.hook(gateway.messageDeleteBulk, {
    before(bulk) {
      if (!settings.keepDeleted) return;
      bulk.ids = bulk.ids.filter((id) => !markDeleted(id, bulk.channel_id, bulk.guild_id));
      if (!bulk.ids.length) return false;
    }
  });
})();
