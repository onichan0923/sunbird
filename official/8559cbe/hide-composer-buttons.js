// @description Hides extra buttons in the message bar (Gift, Voice Message, etc.)
// @version 1.0.0
// @author mantikafasi
"use strict";
(() => {
  // plugins/hide-composer-buttons/src/index.ts
  var GIFT_ID = "composer.gift";
  var VOICE_ID = "Record Voice Message";
  var hideGift = null;
  var hideVoice = null;
  var syncGift = (on) => {
    if (on && !hideGift) hideGift = phoenix.ui.hide(GIFT_ID);
    else if (!on && hideGift) {
      hideGift();
      hideGift = null;
    }
  };
  var syncVoice = (on) => {
    if (on && !hideVoice) hideVoice = phoenix.ui.hide(VOICE_ID);
    else if (!on && hideVoice) {
      hideVoice();
      hideVoice = null;
    }
  };
  var settings = phoenix.settings.define({
    gift: {
      type: "switch",
      title: "Hide Gift button",
      description: "Remove the Nitro Gift button from the chat composer",
      default: true,
      onChange: syncGift
    },
    voice: {
      type: "switch",
      title: "Hide Voice Message button",
      description: "Remove the Record Voice Message button from the chat composer",
      default: false,
      onChange: syncVoice
    }
  });
  syncGift(settings.gift);
  syncVoice(settings.voice);
})();
