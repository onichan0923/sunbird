// @description Translates messages from the message menu, or every message in selected channels, using Kagi or Google
// @version 0.2.2
// @author amaanq
"use strict";
(() => {
  // plugins/translate/src/index.ts
  var { gateway } = phoenix;
  var settings = phoenix.settings.define({
    channels: {
      type: "text",
      title: "Channels",
      description: "Channel IDs to translate, separated by commas",
      default: ""
    },
    target: {
      type: "text",
      title: "Target language",
      description: "Language code to translate into, like en or de",
      default: "en"
    },
    service: {
      type: "select",
      title: "Service",
      options: [
        { value: "google", label: "Google Translate" },
        { value: "kagi", label: "Kagi, standard quality" },
        { value: "kagi-best", label: "Kagi, best quality (about 10x the usage)" }
      ]
    },
    kagiToken: {
      type: "secret",
      title: "Kagi session token",
      description: "The token from the Session Link in kagi.com/settings/user_details",
      default: ""
    }
  });
  var GOOGLE_KEY = "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA";
  var languageNames;
  var languageName = async (code) => {
    languageNames ??= phoenix.fetch(`https://translate-pa.googleapis.com/v1/supportedLanguages?client=gtx&display_language=en&key=${GOOGLE_KEY}`).then((response) => {
      const { sourceLanguages = [] } = response.json() ?? {};
      return new Map(sourceLanguages.map(({ language, name }) => [language, name]));
    }).catch(() => {
      languageNames = void 0;
      return /* @__PURE__ */ new Map();
    });
    return (await languageNames).get(code) ?? code;
  };
  var google = async (text, target) => {
    const query = Object.entries({
      "params.client": "gtx",
      dataTypes: "TRANSLATION",
      key: GOOGLE_KEY,
      "query.sourceLanguage": "auto",
      "query.targetLanguage": target,
      "query.text": text
    }).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join("&");
    const response = await phoenix.fetch(`https://translate-pa.googleapis.com/v1/translate?${query}`);
    if (!response.ok) throw new Error(`Google answered ${response.status}`);
    const { translation, sourceLanguage } = response.json();
    return { text: translation, from: sourceLanguage, label: await languageName(sourceLanguage) };
  };
  var kagi = (token, best) => async (text, target) => {
    const response = await phoenix.fetch(
      `https://translate.kagi.com/api/translate?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        body: {
          text,
          source_lang: "auto",
          target_lang: target,
          skip_definition: true,
          model: best ? "best" : "standard"
        }
      }
    );
    switch (response.status) {
      case 200:
        break;
      case 429:
        phoenix.log.warn("Kagi quota exceeded, using Google");
        return google(text, target);
      case 401:
      case 403:
        throw new Error("Kagi rejected the session token");
      default:
        throw new Error(`Kagi answered ${response.status}: ${response.text()}`);
    }
    const { translation, detected_language: detected } = response.json();
    return { text: translation, from: detected?.iso ?? "", label: detected?.label ?? "" };
  };
  var withToken = (best) => (text, target) => {
    const token = settings.kagiToken.trim();
    if (token) return kagi(token, best)(text, target);
    phoenix.log.warn("Kagi is selected without a session token, using Google");
    return google(text, target);
  };
  var translators = {
    google,
    kagi: withToken(false),
    "kagi-best": withToken(true)
  };
  var baseLanguage = (code) => code.split("-")[0].toLowerCase();
  var subtext = (text) => text.split("\n").map((line) => `-# ${line}`).join("\n");
  var originals = /* @__PURE__ */ new Map();
  var showUnder = (message, original, note) => {
    originals.delete(message.id);
    originals.set(message.id, original);
    if (originals.size > 512) originals.delete(originals.keys().next().value);
    phoenix.enqueue(gateway.messageUpdate, {
      id: message.id,
      channel_id: message.channel_id,
      ...message.guild_id ? { guild_id: message.guild_id } : {},
      content: `${original}
${subtext(note)}`
    });
  };
  var translateMessage = async (message, quiet) => {
    const original = originals.get(message.id) ?? message.content ?? "";
    if (!original.trim()) return;
    const target = settings.target.trim() || "en";
    const translation = await translators[settings.service](original.trim(), target);
    if (baseLanguage(translation.from) === baseLanguage(target) || translation.text.trim() === original.trim()) {
      if (!quiet) showUnder(message, original, `Already in ${await languageName(baseLanguage(target))}`);
      return;
    }
    showUnder(message, original, `${translation.text} (${translation.label})`);
  };
  phoenix.on(gateway.messageCreate, async (message) => {
    const channels = settings.channels.split(",").map((id) => id.trim());
    if (!channels.includes(message.channel_id)) return;
    try {
      await translateMessage(message, true);
    } catch (err) {
      phoenix.log.warn(`translating ${message.id}: ${err}`);
    }
  });
  phoenix.ui.addMessageAction({
    label: "Translate",
    visible: (ctx) => !!ctx.message?.content?.trim(),
    onPress(ctx) {
      const message = ctx.message;
      if (!message) return;
      translateMessage(message, false).catch((err) => {
        const original = originals.get(message.id) ?? message.content ?? "";
        showUnder(message, original, `Translation failed: ${err instanceof Error ? err.message : err}`);
      });
    }
  });
})();
