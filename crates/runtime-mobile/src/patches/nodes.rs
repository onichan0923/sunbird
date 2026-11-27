//! Raw node access for `phoenix.ui`: node snapshots and `onNode` watchers.

use std::sync::atomic::Ordering;

use phoenix_ui_mobile::{
   Op,
   Prop,
   Props,
   get_prop,
};

use crate::patches::{
   ACTIVE,
   NodeWatcher,
   Patches,
   patches,
   worker::{
      Job,
      queue,
   },
};

/// Matches a Phoenix node's `accessibilityId`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NodeMatch {
   Exact(String),
   Prefix(String),
   Checked,
}

impl NodeMatch {
   pub fn matches(&self, aid: &str) -> bool {
      match self {
         Self::Checked => false,
         Self::Exact(expected) => aid == expected,
         Self::Prefix(prefix) => aid.starts_with(prefix.as_str()),
      }
   }
}

/// Snapshot of a live Phoenix node from [`Mirror`], exposed to plugins.
#[derive(Clone, Debug)]
pub struct NodeInfo {
   pub id:               i32,
   pub kind:             Option<String>,
   pub checked:          Option<bool>,
   pub accessibility_id: Option<String>,
   pub parent:           Option<i32>,
   pub children:         Vec<i32>,
   pub sheet:            Option<i32>,
   pub list:             Option<i32>,
   pub on:               Vec<String>,
}

/// Registers a raw node creation watcher (`phoenix.ui.onNode`).
pub fn add_node_watcher(id: u64, plugin: String, matcher: NodeMatch) {
   ACTIVE.store(true, Ordering::Release);
   patches().node_watchers.push(NodeWatcher {
      id,
      plugin,
      matcher,
   });
}

pub fn remove_node_watcher(id: u64) {
   patches().node_watchers.retain(|watcher| watcher.id != id);
}

/// Sends a raw `Op::Update` (`phoenix.ui.update`) on the patches worker thread.
pub fn update_node(node: i32, props: Props) {
   ACTIVE.store(true, Ordering::Release);
   queue(Job::UpdateNode { node, props });
}

/// Finds all live nodes matching `matcher` (`phoenix.ui.find`).
pub fn find_nodes(matcher: &NodeMatch) -> Vec<i32> {
   patches().mirror.nodes_where(&|aid| matcher.matches(aid))
}

/// Finds the first node at or under `root` matching `matcher`
/// (`phoenix.ui.findDown`).
pub fn find_down(root: i32, matcher: &NodeMatch, max_depth: usize) -> Option<i32> {
   patches()
      .mirror
      .find_down(root, &|aid| matcher.matches(aid), max_depth)
}

/// Snapshot of a live node (`phoenix.ui.node`).
pub fn node_info(id: i32) -> Option<NodeInfo> {
   let state = patches();
   state.mirror.exists(id).then(|| state.build_node_info(id))
}

impl Patches {
   pub fn notify_checked(&self, ops: &[Op]) {
      if !self
         .node_watchers
         .iter()
         .any(|w| w.matcher == NodeMatch::Checked)
      {
         return;
      }
      let mut seen = std::collections::BTreeSet::new();
      for op in ops {
         if let Op::Create { id, props, .. } | Op::Update { id, props } = op
            && get_prop(props, Prop::ACCESSIBILITY_CHECKED).is_some()
            && self.mirror.exists(*id)
         {
            seen.insert(*id);
         }
      }
      for id in seen {
         queue(Job::NodeCreated {
            watchers: self
               .node_watchers
               .iter()
               .filter(|w| w.matcher == NodeMatch::Checked)
               .map(|w| w.id)
               .collect(),
            info:     self.build_node_info(id),
         });
      }
   }

   pub fn notify_watchers(&self, named: &[i32]) {
      // Notify raw node watchers (`phoenix.ui.onNode`) for matching newly
      // created nodes.
      if !self.node_watchers.is_empty() {
         for id in named {
            let Some(aid) = self.mirror.accessibility_id(*id) else {
               continue;
            };
            let watchers = self
               .node_watchers
               .iter()
               .filter(|watcher| watcher.matcher.matches(aid))
               .map(|watcher| watcher.id)
               .collect::<Vec<_>>();
            if !watchers.is_empty() {
               queue(Job::NodeCreated {
                  watchers,
                  info: self.build_node_info(*id),
               });
            }
         }
      }
   }

   pub fn build_node_info(&self, id: i32) -> NodeInfo {
      let on = self
         .mirror
         .list_on(id)
         .iter()
         .filter_map(|v| v.as_str().map(str::to_owned))
         .collect();
      NodeInfo {
         id,
         checked: self.mirror.checked(id),
         kind: self.mirror.kind(id).map(|k| k.as_str().to_owned()),
         accessibility_id: self.mirror.accessibility_id(id).map(str::to_owned),
         parent: self.mirror.parent(id),
         children: self.mirror.kids(id).to_vec(),
         sheet: self.mirror.sheet_of(id),
         list: self.mirror.enclosing_list(id),
         on,
      }
   }
}

#[cfg(test)]
mod tests {
   use std::sync::mpsc;

   use phoenix_ui_mobile::ViewKind;
   use phoenix_wire::Value;
   use rquickjs::{
      Context,
      Object,
      Runtime,
   };

   use super::*;
   use crate::{
      js::{
         Mobile,
         view,
      },
      patches::worker::WORKER,
   };

   #[test]
   fn checked_writes_reach_subscribers_with_debug_off() {
      let (tx, rx) = mpsc::channel();
      assert!(WORKER.set(tx).is_ok());
      let runtime = Runtime::new().unwrap();
      let js = Context::full(&runtime).unwrap();
      js.with(|ctx| {
         assert!(ctx.store_userdata(Mobile::default()).is_ok());
         let ui = Object::new(ctx.clone()).unwrap();
         view::add_view_hooks(&ctx, "theme", &ui).unwrap();
         view::add_view_queries(&ctx, &ui).unwrap();
         ctx.globals().set("ui", ui).unwrap();
         ctx.eval::<(), _>(
            "globalThis.last = null; globalThis.stop = ui.onChecked(n => last = n.checked)",
         )
         .unwrap();
         let id = 801;
         let write = |op| {
            let mut state = patches();
            let ops = [op];
            state.mirror.apply(&ops, false);
            state.notify_checked(&ops);
         };
         for checked in [true, false] {
            let props = vec![(Prop::ACCESSIBILITY_CHECKED, Value::Bool(checked))];
            write(if checked {
               Op::Create {
                  id,
                  kind: ViewKind::View,
                  props: [props, vec![(
                     Prop::ACCESSIBILITY_ID,
                     Value::Str("switch-test".into()),
                  )]]
                  .concat(),
               }
            } else {
               Op::Update { id, props }
            });
            let Job::NodeCreated { watchers, info } = rx.try_recv().unwrap() else {
               panic!("expected checked write")
            };
            assert_eq!(info.checked, Some(checked));
            let registry = ctx.userdata::<Mobile<'_>>().unwrap();
            let f = registry.node_watchers.borrow()[&watchers[0]].1.clone();
            drop(registry);
            f.call::<_, ()>((view::node_info_object(&ctx, &info).unwrap(),))
               .unwrap();
            assert!(
               ctx.eval::<bool, _>("last === ui.node(801).checked && ui.node(801).kind == null")
                  .unwrap()
            );
            assert_eq!(ctx.eval::<bool, _>("last").unwrap(), checked);
         }
         ctx.eval::<(), _>("stop()").unwrap();
         write(Op::Update {
            id,
            props: vec![(Prop::ACCESSIBILITY_CHECKED, Value::Null)],
         });
         assert!(rx.try_recv().is_err());
         assert!(
            ctx.eval::<bool, _>("ui.node(801).checked === null")
               .unwrap()
         );
      });
   }
}
