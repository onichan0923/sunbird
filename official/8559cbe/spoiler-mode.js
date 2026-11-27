// @description Adds a toggle to automatically spoiler everything you send
// @version 1.2.1
// @author cmdr-chara
"use strict";
(() => {
  // plugins/spoiler-mode/src/index.ts
  var KEY = "enabled";
  var LIMIT = 2e3;
  var ICON = "res://ic_mana_image_spoiler";
  var TINT_ON = 4283983346;
  var on = phoenix.storage.get(KEY) ?? false;
  var syncButton = () => {
    button.update({
      icon: ICON,
      label: on ? "Spoiler mode (on)" : "Spoiler mode (off)",
      tint: on ? TINT_ON : null
    });
  };
  var settings = phoenix.settings.define({
    enabled: {
      type: "switch",
      title: "Spoiler mode",
      description: "Wrap outgoing messages and attachments in spoilers automatically",
      default: on,
      onChange(value) {
        on = value;
        phoenix.storage.set(KEY, on);
        syncButton();
      }
    }
  });
  on = settings.enabled;
  var wrapText = (text) => {
    if (!text.trim() || text.includes("||")) return;
    if (text.length + 4 > LIMIT) {
      phoenix.ui.toast("Message too long to wrap in spoilers");
      return;
    }
    return `||${text}||`;
  };
  var button = phoenix.ui.addComposerButton({
    icon: ICON,
    label: on ? "Spoiler mode (on)" : "Spoiler mode (off)",
    tint: on ? TINT_ON : void 0,
    onPress() {
      on = !on;
      phoenix.storage.set(KEY, on);
      syncButton();
      phoenix.ui.toast(on ? "Spoiler mode on" : "Spoiler mode off");
    }
  });
  phoenix.messages.onSend((text) => {
    if (!on) return;
    return wrapText(text);
  });
  phoenix.discord.onRequest(
    { method: "POST", pathPrefix: "/channels/", pathSuffix: "/messages" },
    (req) => {
      if (!on) return;
      const payload = req.json();
      if (!payload) return;
      let changed = false;
      if (typeof payload.content === "string") {
        const wrapped = wrapText(payload.content);
        if (wrapped !== void 0) {
          payload.content = wrapped;
          changed = true;
        }
      }
      if (Array.isArray(payload.attachments)) {
        for (const attachment of payload.attachments) {
          if (typeof attachment.filename === "string" && !attachment.filename.startsWith("SPOILER_")) {
            attachment.filename = `SPOILER_${attachment.filename}`;
            changed = true;
          }
        }
      }
      return changed ? { body: payload } : void 0;
    }
  );
})();
