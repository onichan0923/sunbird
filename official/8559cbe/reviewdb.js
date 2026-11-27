// @description Adds a ReviewDB tab to user profiles
// @version 0.2.1
// @author mantikafasi
"use strict";
(() => {
  // plugins/reviewdb/src/index.ts
  var API = "https://manti.vendicated.dev/api/reviewdb";
  var CLIENT_ID = "915703782174752809";
  var CLIENT_MOD = "fairecord";
  var PAGE_SIZE = 50;
  var MAX_LENGTH = 500;
  var UPVOTED = 4282099036;
  var DOWNVOTED = 4293739077;
  var FLAG_NO_ADS = 1;
  var FLAG_NO_WARNINGS = 2;
  var settings = phoenix.settings.define({
    disableAds: { type: "switch", title: "Hide ReviewDB ads", default: false },
    disableWarnings: { type: "switch", title: "Hide ReviewDB warnings", default: false },
    notify: {
      type: "switch",
      title: "New review notices",
      description: "Say when someone reviewed you, at start",
      default: true
    },
    token: {
      type: "secret",
      title: "ReviewDB token",
      description: "Only if logging in with Discord doesn't work: paste a token here",
      default: ""
    },
    login: { type: "button", title: "Log in to ReviewDB", onPress: () => void loginAndTell() },
    logout: { type: "button", title: "Log out of ReviewDB", onPress: () => logout("Logged out of ReviewDB") },
    blocks: { type: "button", title: "Blocked ReviewDB users", onPress: () => void showBlocks() }
  });
  var profiles = /* @__PURE__ */ new Map();
  var token = () => settings.token.trim() || phoenix.storage.get("token") || "";
  function profile(userId) {
    let known = profiles.get(userId);
    if (!known) {
      known = { votes: /* @__PURE__ */ new Map(), offset: 0 };
      if (profiles.size > 32) profiles.clear();
      profiles.set(userId, known);
    }
    return known;
  }
  function redraw(userId) {
    tab.update?.(userId);
  }
  function logout(why) {
    phoenix.storage.delete("token");
    phoenix.storage.delete("me");
    if (why) phoenix.ui.toast(settings.token.trim() ? `${why}, but a pasted token is still set` : why);
    for (const known of profiles.values()) known.votes.clear();
    redraw();
  }
  async function call(path, method = "GET", body) {
    const auth = token();
    const res = await phoenix.fetch(API + path, {
      method,
      headers: { Accept: "application/json", ...auth ? { Authorization: auth } : {} },
      body: body && { ...body, token: auth }
    });
    let reply;
    try {
      reply = res.json();
    } catch {
      throw new Error(`ReviewDB answered ${res.status}`);
    }
    if (reply.success === false && reply.message === "Invalid Token") {
      logout("Your ReviewDB login expired, log in again");
      throw new Error("Your ReviewDB login expired, log in again");
    }
    if (reply.success === false || !res.ok) throw new Error(reply.message || `ReviewDB answered ${res.status}`);
    return reply;
  }
  async function me() {
    const user = await phoenix.discord.me();
    if (!user) throw new Error("Discord has not finished signing in");
    return user.id;
  }
  async function login() {
    const location = await phoenix.discord.authorize({
      clientId: CLIENT_ID,
      redirectUri: `${API}/auth`,
      scopes: ["identify"]
    });
    const res = await phoenix.fetch(`${location}&returnType=json&clientMod=${CLIENT_MOD}`, {
      headers: { Accept: "application/json" }
    });
    const reply = res.json();
    if (!reply.success || !reply.token) throw new Error(reply.message || "ReviewDB login failed");
    phoenix.storage.set("token", reply.token);
    phoenix.storage.delete("me");
    await me();
    phoenix.ui.toast("Logged in to ReviewDB");
    for (const known of profiles.values()) known.page = void 0;
    redraw();
  }
  async function loginAndTell() {
    try {
      await login();
    } catch (err) {
      phoenix.ui.toast(String(err.message ?? err));
    }
  }
  function act(userId, work, reload = true) {
    const known = profile(userId);
    work().then(
      () => {
        known.notice = void 0;
        if (reload) known.page = void 0;
      },
      (err) => known.notice = { text: String(err?.message ?? err), error: true }
    ).finally(() => redraw(userId));
  }
  async function load(userId) {
    const known = profile(userId);
    let flags = 0;
    if (settings.disableAds) flags |= FLAG_NO_ADS;
    if (settings.disableWarnings) flags |= FLAG_NO_WARNINGS;
    const [page2, rating, votes] = await Promise.all([
      call(`/users/${userId}/reviews?flags=${flags}&offset=${known.offset}`),
      call(`/users/${userId}/rating`).catch(() => void 0),
      token() ? call(
        `/users/${userId}/reviews/votes`
      ).catch(() => void 0) : void 0
    ]);
    known.page = page2;
    known.rating = rating?.rating;
    known.votes = new Map((votes?.votes ?? []).map((vote2) => [vote2.reviewID ?? vote2.reviewId ?? 0, vote2.isUpvote]));
  }
  function date(timestamp) {
    if (!timestamp) return "";
    const ms = timestamp > 1e11 ? timestamp : timestamp * 1e3;
    return new Date(ms).toISOString().slice(0, 10);
  }
  var canVote = (review) => review.id !== 0 && review.type === 0;
  function vote(userId, review, up) {
    if (!token()) return void loginAndTell();
    const current = profile(userId).votes.get(review.id);
    act(
      userId,
      () => current === up ? call(`/reviews/${review.id}/vote`, "DELETE", {}) : call(`/reviews/${review.id}/vote`, "POST", { isUpvote: up })
    );
  }
  async function confirm(title, message, yes) {
    return await phoenix.ui.choose({ title, message, options: [yes, "Cancel"] }) === 0;
  }
  async function hold(userId, review) {
    if (!canVote(review)) return;
    if (!token()) return loginAndTell();
    const mine = review.sender.discordID === await me().catch(() => "");
    const options = mine ? [{ label: "Delete review", icon: "message.actions.delete", danger: true }] : [
      { label: "Report review", icon: "message.actions.report", danger: true },
      { label: `Block ${review.sender.username} on ReviewDB`, danger: true }
    ];
    const picked = await phoenix.ui.choose({ title: `Review by ${review.sender.username}`, options });
    if (mine && picked === 0) {
      if (await confirm("Delete review?", "This cannot be undone.", "Delete")) {
        act(userId, async () => {
          const reply = await call(`/users/0/reviews`, "DELETE", { reviewid: review.id });
          phoenix.ui.toast(reply.message || "Review deleted");
        });
      }
    } else if (!mine && picked === 0) {
      if (await confirm("Report review?", "Report this review to ReviewDB's moderators?", "Report")) {
        act(userId, async () => {
          const reply = await call(`/reports`, "POST", { reviewid: review.id });
          phoenix.ui.toast(reply.message || "Review reported");
        }, false);
      }
    } else if (!mine && picked === 1) {
      if (await confirm(`Block ${review.sender.username}?`, "You won't see their reviews anymore.", "Block")) {
        act(userId, async () => {
          const reply = await call(`/blocks`, "PATCH", { action: "block", discordId: review.sender.discordID });
          phoenix.ui.toast(reply.message || "Blocked");
        });
      }
    }
  }
  async function showBlocks() {
    if (!token()) return phoenix.ui.toast("Log in to ReviewDB first");
    try {
      const reply = await call(`/blocks`);
      const users = reply.users ?? [];
      if (!users.length) return phoenix.ui.toast("You haven't blocked anyone on ReviewDB");
      const picked = await phoenix.ui.choose({ title: "Tap someone to unblock", options: users.map((user2) => user2.username) });
      const user = users[picked];
      if (!user || !await confirm(`Unblock ${user.username}?`, "Their reviews show again.", "Unblock")) return;
      const done = await call(`/blocks`, "PATCH", { action: "unblock", discordId: user.discordID });
      phoenix.ui.toast(done.message || "Unblocked");
      for (const known of profiles.values()) known.page = void 0;
      redraw();
    } catch (err) {
      phoenix.ui.toast(String(err.message ?? err));
    }
  }
  function submit(userId, comment) {
    const text = comment.trim();
    if (!token()) return void loginAndTell();
    if (!text || text.length > MAX_LENGTH) {
      phoenix.ui.toast(`Reviews are 1 to ${MAX_LENGTH} characters`);
      return;
    }
    act(userId, async () => {
      const reply = await call(`/users/${userId}/reviews`, "PUT", { comment: text });
      phoenix.ui.toast(reply.message || "Review saved");
      profile(userId).offset = 0;
    });
  }
  function page(userId, offset) {
    profile(userId).offset = Math.max(0, offset);
    act(userId, async () => {
    });
  }
  async function username(userId) {
    const known = profile(userId);
    if (known.name) return known.name;
    try {
      const user = (await phoenix.discord.get(`/users/${userId}`)).json();
      known.name = user.global_name || user.username;
    } catch {
    }
    return known.name;
  }
  function media(comment) {
    const images = (comment.match(/https?:\/\/\S+/g) ?? []).filter(
      (url) => /\.(gif|png|jpe?g|webp)(\?\S*)?$/i.test(url) || url.includes("media.tenor.com/")
    );
    const text = images.length === 1 && comment.trim() === images[0] ? "" : comment;
    return { text, images };
  }
  var tab = phoenix.ui.addProfileTab({
    title: "Reviews",
    async render(ctx) {
      const userId = ctx.userId;
      if (!userId) return [{ type: "text", text: "ReviewDB needs a user id, and this profile has none." }];
      const known = profile(userId);
      const blocks = [];
      if (!known.page) {
        try {
          await load(userId);
        } catch (err) {
          known.notice = { text: `Couldn't load reviews: ${err.message}`, error: true };
        }
      }
      const reviews = known.page?.reviews ?? [];
      const count = known.page?.reviewCount ?? reviews.length;
      blocks.push({
        type: "text",
        title: "USER REVIEWS",
        text: `${count} review${count === 1 ? "" : "s"}${known.rating !== void 0 ? ` \xB7 rating ${known.rating}` : ""}`
      });
      if (known.notice) {
        blocks.push({ type: "text", text: known.notice.text, color: known.notice.error ? 4294065986 : void 0 });
      }
      if (token()) {
        const name = await username(userId);
        blocks.push({
          type: "input",
          placeholder: name ? `Review @${name}` : "Write a review",
          onSubmit: (text) => submit(userId, text),
          sendButton: true
        });
      } else {
        blocks.push({
          type: "button",
          label: "Log in to ReviewDB with Discord",
          onPress: () => {
            known.notice = { text: "Authorize ReviewDB on Discord's screen to log in." };
            redraw(userId);
            act(userId, login);
          }
        });
      }
      if (known.page && !reviews.length) blocks.push({ type: "text", text: "No reviews yet." });
      for (const review of reviews) {
        const voted = known.votes.get(review.id);
        const votable = canVote(review);
        const { text, images } = media(review.comment);
        blocks.push({
          type: "entry",
          avatar: review.sender.profilePhoto,
          title: review.sender.username,
          subtitle: date(review.timestamp),
          text,
          images,
          badges: (review.sender.badges ?? []).flatMap((badge) => badge.icon ? [badge.icon] : []),
          side: votable ? [
            { label: "\u25B2", color: voted === true ? UPVOTED : void 0, onPress: () => vote(userId, review, true) },
            { label: String(review.score ?? 0) },
            { label: "\u25BC", color: voted === false ? DOWNVOTED : void 0, onPress: () => vote(userId, review, false) }
          ] : void 0,
          onLongPress: votable ? () => void hold(userId, review) : void 0
        });
      }
      const pager = [];
      if (known.offset > 0) pager.push({ label: "Previous", onPress: () => page(userId, known.offset - PAGE_SIZE) });
      if (known.page?.hasNextPage) pager.push({ label: "Next", onPress: () => page(userId, known.offset + PAGE_SIZE) });
      if (pager.length) {
        blocks.push({ type: "buttons", buttons: pager });
        blocks.push({ type: "text", text: `Page ${known.offset / PAGE_SIZE + 1}`, color: void 0 });
      }
      if (reviews.length) blocks.push({ type: "text", text: "Hold a review to report, block or delete it." });
      return blocks;
    }
  });
  async function checkInbox() {
    if (!token() || !settings.notify) return;
    const user = await call(
      `/users`,
      "POST",
      {}
    );
    const last = phoenix.storage.get("lastReviewId") ?? 0;
    if (user.lastReviewID && user.lastReviewID > last) {
      phoenix.storage.set("lastReviewId", user.lastReviewID);
      if (last) phoenix.ui.toast("You have new reviews on your profile");
    }
    if (user.notification) {
      await phoenix.ui.choose({ title: user.notification.title, message: user.notification.content, options: ["OK"] });
      await call(`/notifications?id=${user.notification.id}`, "PATCH", {}).catch(() => void 0);
    }
  }
  checkInbox().catch((err) => phoenix.log.warn("ReviewDB notices:", String(err?.message ?? err)));
  phoenix.onUnload(() => profiles.clear());
})();
