// @description Prevents Discord from sending typing indicators
// @version 1.0.0
// @author mantikafasi
"use strict";
(() => {
  // plugins/silent-typing/src/index.ts
  phoenix.discord.onRequest(
    { method: "POST", pathPrefix: "/channels/", pathSuffix: "/typing" },
    () => false
  );
})();
