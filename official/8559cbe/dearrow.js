// @description Replaces YouTube titles and thumbnails in embeds using DeArrow
// @version 0.1.1
// @author amaanq
"use strict";
(() => {
  // plugins/dearrow/src/index.ts
  var { gateway } = phoenix;
  var settings = phoenix.settings.define({
    titles: {
      type: "switch",
      title: "Replace titles",
      description: "Use crowdsourced titles from DeArrow",
      default: true
    },
    thumbnails: {
      type: "switch",
      title: "Replace thumbnails",
      description: "Use crowdsourced thumbnails from DeArrow",
      default: true
    }
  });
  var cache = /* @__PURE__ */ new Map();
  var videoId = (url) => url?.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([\w-]{11})/)?.[1];
  var trusted = (entry) => !entry.original && (entry.votes >= 0 || entry.locked);
  var lookup = (id) => {
    let pending = cache.get(id);
    if (!pending) {
      pending = phoenix.fetch(`https://sponsor.ajay.app/api/branding?videoID=${id}`).then((response) => {
        if (!response.ok) return {};
        const branding = response.json();
        const title = branding.titles.find(trusted)?.title.replace(/(^|\s)>(\S)/g, "$1$2");
        const thumbnail = branding.thumbnails.find(trusted);
        return {
          title,
          thumbnail: thumbnail?.timestamp == null ? void 0 : `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${id}&time=${thumbnail.timestamp}`
        };
      }).catch((err) => {
        cache.delete(id);
        phoenix.log.warn(`dearrow ${id}: ${err}`);
        return {};
      });
      if (cache.size >= 512) cache.delete(cache.keys().next().value);
      cache.set(id, pending);
    }
    return pending;
  };
  var rebrand = async (message) => {
    const embeds = message.embeds;
    if (!embeds?.length) return;
    let changed = false;
    for (const embed of embeds) {
      const id = videoId(embed.url);
      if (!id) continue;
      const { title, thumbnail } = await lookup(id);
      if (title && settings.titles && embed.title !== title) {
        embed.title = title;
        changed = true;
      }
      if (thumbnail && settings.thumbnails && embed.thumbnail && embed.thumbnail.url !== thumbnail) {
        embed.thumbnail = { ...embed.thumbnail, url: thumbnail, proxy_url: thumbnail };
        changed = true;
      }
    }
    if (!changed) return;
    phoenix.enqueue(gateway.messageUpdate, {
      id: message.id,
      channel_id: message.channel_id,
      ...message.guild_id ? { guild_id: message.guild_id } : {},
      embeds
    });
  };
  phoenix.on(gateway.messageCreate, rebrand);
  phoenix.on(gateway.messageUpdate, rebrand);
})();
