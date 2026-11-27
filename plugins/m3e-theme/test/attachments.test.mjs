import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const theme = readFileSync(new URL("../src/theme.js", import.meta.url), "utf8");

function createChat() {
  const nodes = new Map(), originals = new Map(), styles = new Map();
  const watches = [], events = new Map();
  let unload;
  function add(parent, kind, accessibilityId = null, props = {}) {
    const id = nodes.size + 1;
    const node = { id, accessibilityId, parent: parent?.id ?? null, kind: null, children: [],
      sheet: null, list: parent?.list ?? null, on: props.pressable ? ["press"] : [] };
    nodes.set(id, node);
    originals.set(id, { kind, ...props });
    if (parent) parent.children.push(id);
    return node;
  }
  const matches = (node, match) => typeof match === "string" ? node.accessibilityId === match :
    node.accessibilityId != null && node.accessibilityId.startsWith(match.prefix);
  const root = add(null, "stack"), list = add(root, "list");
  const ui = {
    root: () => root.id,
    node: id => nodes.get(id),
    surface: id => originals.get(id),
    find: match => [...nodes.values()].filter(n => matches(n, match)).map(n => n.id),
    findDown(id, match, depth = 8) {
      const node = nodes.get(id);
      if (matches(node, match)) return id;
      if (depth) for (const child of node.children) {
        const found = ui.findDown(child, match, depth - 1);
        if (found != null) return found;
      }
      return null;
    },
    update(id, props) { styles.set(id, { ...styles.get(id), ...structuredClone(props) }); },
    patchProps: () => () => {},
    onNode(match, fn) { watches.push([match, fn]); return () => {}; },
    onEvent(name, fn) { events.set(name, fn); return () => {}; },
  };
  runInNewContext(theme, { phoenix: { ui, appearance: {}, settings: { define: () => ({}) },
    onUnload(fn) { unload = fn; } } });
  const row = add(list, "view");
  row.list = list.id;
  const line = add(row, "view", null, { horizontal: true });
  add(line, "image", "message.avatar:1", { height: 40 });
  const box = add(line, "view", null, { padding: [2, 0, 3, 0] });
  const header = add(box, "view", null, { horizontal: true });
  const author = add(header, "text", "message.author:1");
  function notify(n) {
    for (const [match, fn] of watches) if (matches(n, match)) fn(n);
  }
  return { box, header, author, add, notify, events, styles, unload, nodes };
}

for (const count of [1, 2, 4, 10]) {
  for (const captioned of [true, false]) {
    test(`preserve the native viewport and all ${count} upload targets, caption=${captioned}`, () => {
      const { box, header, author, add, notify, events, styles, unload } = createChat();
      const caption = captioned && add(box, "view", "message.content:1", { padding: [1, 2, 3, 4] });
      if (caption) add(caption, "text");
      const anchor = caption || author;
      const wrap = add(box, "view");
      notify(anchor); // Guest mounts an empty wrapper before the thumbnail has decoded.
      const grid = add(wrap, "stack");
      const media = [wrap, grid];
      for (let i = 0; i < count; i++) {
        const cell = add(grid, "stack");
        const hit = add(cell, "stack", null, { pressable: true });
        media.push(cell, hit, add(hit, "image"));
      }
      notify(anchor);
      events.get("layout")({ node: anchor.id, accessibilityId: anchor.accessibilityId, payload: { width: 280 } });
      notify(anchor);
      for (const n of media) assert.equal(styles.has(n.id), false, "theme wrote to an upload node");
      assert.deepEqual(styles.get(box.id).padding, [2, 5, 3, 10]);
      assert.equal(styles.get(box.id).clip, false);
      assert.deepEqual(styles.get(header.id).padding, [10, 0, 10, 0]);
      if (caption) assert.deepEqual(styles.get(caption.id).padding, [11, 2, 13, 4]);
      unload();
      assert.deepEqual(styles.get(box.id).padding, [2, 0, 3, 0]);
      assert.equal(styles.get(header.id).padding, 0);
      if (caption) assert.deepEqual(styles.get(caption.id).padding, [1, 2, 3, 4]);
    });
  }
}

test("a link card can share a message with an upload that arrives later", () => {
  const { box, add, notify, styles } = createChat();
  const caption = add(box, "view", "message.content:1");
  add(caption, "text");
  const card = add(box, "view", "embed:1:0");
  add(card, "text");
  notify(caption);
  assert.deepEqual(styles.get(card.id).margin, [10, 0, 10, 0]);
  assert.equal(styles.get(box.id).padding[0], 2);
  assert.equal(styles.get(box.id).padding[2], 3);

  const upload = add(box, "view", "message.attachments:1");
  const hit = add(upload, "stack", null, { pressable: true });
  const picture = add(hit, "image");
  notify(upload);
  for (const n of [upload, hit, picture]) assert.equal(styles.has(n.id), false);
  assert.deepEqual(styles.get(box.id).padding, [2, 5, 3, 10]);
  assert.deepEqual(styles.get(card.id).margin, [10, 0, 10, 0]);
});
