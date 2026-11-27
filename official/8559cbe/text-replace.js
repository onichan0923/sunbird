// @description Rewrites your outgoing messages by find and replace rules
// @version 0.1.1
// @author amaanq
"use strict";
(() => {
  // plugins/text-replace/src/index.ts
  var KEY = "rules";
  var REGEX_FORM = /^\/(.+)\/([a-z]*)$/;
  var escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function compile(find, replace) {
    const form = REGEX_FORM.exec(find);
    const source = form ? form[1] : escape(find);
    const flags = form ? form[2] : "g";
    try {
      return { find, replace, regex: new RegExp(source, flags), error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { find, replace, regex: null, error: message };
    }
  }
  function parse(text) {
    const rules2 = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const at = line.lastIndexOf("=>");
      if (at === -1) continue;
      rules2.push(compile(line.slice(0, at).trim(), line.slice(at + 2)));
    }
    return rules2;
  }
  var rules = parse(phoenix.storage.get(KEY) ?? "");
  var apply = (text) => {
    let out = text;
    for (const rule of rules) {
      if (rule.regex) out = out.replace(rule.regex, rule.replace);
    }
    return out;
  };
  phoenix.settings.define({
    rules: {
      type: "text",
      title: "Rules",
      description: "One per line, find=>replace. A find of /pattern/flags is a regex.",
      multiline: true,
      default: phoenix.storage.get(KEY) ?? "",
      onChange(value) {
        phoenix.storage.set(KEY, value);
        rules = parse(value);
        const broken = rules.filter((rule) => rule.error);
        if (broken.length > 0) {
          phoenix.ui.toast(`${broken.length} rule(s) have an invalid regex`);
        }
      }
    }
  });
  phoenix.messages.onSend((text) => {
    if (rules.length === 0) return;
    const out = apply(text);
    return out === text ? void 0 : out;
  });
})();
