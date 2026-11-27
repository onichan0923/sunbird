// @description Flags messages with high send latency
// @version 0.1.0
// @author amaanq
"use strict";
(() => {
  // plugins/message-latency/src/index.ts
  var { gateway } = phoenix;
  var settings = phoenix.settings.define({
    threshold: {
      type: "number",
      title: "Threshold",
      description: "Seconds a message must take to get marked",
      default: 2
    },
    showBots: {
      type: "switch",
      title: "Mark bots",
      description: "Also mark messages sent by bots",
      default: false
    }
  });
  var DISCORD_EPOCH = 1420070400000n;
  var DAY = 864e5;
  var sentAt = (snowflake) => Number((BigInt(snowflake) >> 22n) + DISCORD_EPOCH);
  phoenix.hook(gateway.messageCreate, {
    before(message) {
      if (!settings.showBots && message.author?.bot) return;
      const nonce = typeof message.nonce === "number" ? String(message.nonce) : message.nonce;
      if (!nonce || !/^\d{17,20}$/.test(nonce) || !/^\d{17,20}$/.test(message.id)) return;
      const delay = sentAt(message.id) - sentAt(nonce);
      if (delay < settings.threshold * 1e3 || delay > DAY) return;
      message.content += `
-# took ${(delay / 1e3).toFixed(1)}s to send`;
    }
  });
})();
