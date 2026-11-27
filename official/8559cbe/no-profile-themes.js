// @description Strips profile themes, effects, avatar decorations, and name styles
// @version 0.1.1
// @author amaanq
"use strict";
(() => {
  // plugins/no-profile-themes/src/index.ts
  var { gateway } = phoenix;
  var settings = phoenix.settings.define({
    keepOwn: {
      type: "switch",
      title: "Keep my own",
      description: "Leave your own profile theming in place",
      default: true
    }
  });
  var THEMING = [
    "avatar_decoration_data",
    "collectibles",
    "display_name_styles",
    "theme_colors",
    "profile_effect"
  ];
  var self;
  var strip = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) strip(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const node = value;
    const owner = node.user?.id ?? node.id;
    const keep = settings.keepOwn && self !== void 0 && owner === self;
    for (const key of Object.keys(node)) {
      if (!keep && THEMING.includes(key)) delete node[key];
      else strip(node[key]);
    }
  };
  var readSelf = () => phoenix.discord.me().then((user) => self = user?.id).catch((err) => phoenix.log.warn(`reading the account: ${err}`));
  readSelf();
  if (gateway.readySupplemental) phoenix.on(gateway.readySupplemental, readSelf);
  var events = [
    gateway.readySupplemental,
    gateway.initialGuild,
    gateway.guildCreate,
    gateway.messageCreate,
    gateway.messageUpdate,
    gateway.guildMemberAdd,
    gateway.guildMemberUpdate,
    gateway.guildMembersChunk,
    gateway.guildMemberListUpdate,
    gateway.presenceUpdate,
    gateway.presencesReplace,
    gateway.threadMembersUpdate,
    gateway.channelCreate,
    gateway.relationshipAdd,
    gateway.relationshipUpdate
  ];
  for (const sig of events) {
    if (sig) phoenix.hook(sig, { before: strip });
  }
})();
