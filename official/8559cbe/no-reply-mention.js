// @description Stops your replies from pinging the person you reply to
// @version 0.1.0
// @author amaanq
"use strict";
(() => {
  // plugins/no-reply-mention/src/index.ts
  phoenix.discord.onRequest(
    { method: "POST", pathPrefix: "/channels/", pathSuffix: "/messages" },
    (req) => {
      const payload = req.json();
      if (!payload?.message_reference) return;
      const mentions = payload.allowed_mentions ?? {};
      if (mentions.replied_user === false) return;
      payload.allowed_mentions = { ...mentions, replied_user: false };
      return { body: payload };
    }
  );
})();
