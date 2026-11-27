//! Expand batch-local word references before plugins copy, recolor or reorder
//! canvas and motion properties. Android counts both literals and patches.
use std::borrow::Cow;

use phoenix_wire::Value;

use crate::Op;

#[derive(Default)]
struct Table<'a> {
   words:    Vec<Cow<'a, [i32]>>,
   expanded: usize,
}

impl<'a> Table<'a> {
   fn collect(&mut self, v: &'a Value) -> Option<()> {
      match v {
         Value::Words(w) => self.words.push(Cow::Borrowed(w)),
         Value::WPatch { list, set } => {
            let source = self.words.get(usize::try_from(*list).ok()?)?;
            self.expanded = self.expanded.checked_add(source.len())?;
            // Fall back to the original guest batch if expanding it for edits
            // would exceed 16 MiB.
            if self.expanded > 4 * 1024 * 1024 {
               return None;
            }
            let mut words = source.to_vec();
            for &(i, word) in set {
               *words.get_mut(usize::from(i))? = word;
            }
            self.words.push(Cow::Owned(words));
         },
         Value::Arr(v) => {
            for child in v {
               self.collect(child)?;
            }
         },
         Value::Obj(v) => {
            for (_, child) in v {
               self.collect(child)?;
            }
         },
         Value::Map(v) => {
            for (_, child) in v {
               self.collect(child)?;
            }
         },
         _ => {},
      }
      Some(())
   }
}

fn expand(value: &mut Value, copies: &mut impl Iterator<Item = Vec<i32>>) {
   match value {
      Value::WPatch { .. } => {
         if let Some(w) = copies.next() {
            *value = Value::Words(w);
         }
      },
      Value::Arr(v) => {
         for child in v {
            expand(child, copies);
         }
      },
      Value::Map(v) => {
         for (_, child) in v {
            expand(child, copies);
         }
      },
      Value::Obj(v) => {
         for (_, child) in v {
            expand(child, copies);
         }
      },
      _ => {},
   }
}

/// Invalid references are left untouched so the caller can pass the native
/// batch through. The guest's source word lists are never modified in place.
pub fn expand_word_patches(ops: &mut [Op]) -> bool {
   let mut table = Table::default();
   for op in &*ops {
      let ok = match op {
         Op::Create { props, .. } | Op::Update { props, .. } => {
            props.iter().try_for_each(|(_, v)| table.collect(v))
         },
         Op::ScrollTo { value, .. } => table.collect(value),
         _ => Some(()),
      };
      if ok.is_none() {
         return false;
      }
   }
   let mut copies = table
      .words
      .into_iter()
      .filter_map(|word| {
         match word {
            Cow::Owned(v) => Some(v),
            Cow::Borrowed(_) => None,
         }
      })
      .collect::<Vec<_>>()
      .into_iter();
   if copies.len() != 0 {
      for op in ops {
         match op {
            Op::Create { props, .. } | Op::Update { props, .. } => {
               for (_, v) in props {
                  expand(v, &mut copies);
               }
            },
            Op::ScrollTo { value, .. } => expand(value, &mut copies),
            _ => {},
         }
      }
   }
   true
}

#[cfg(test)]
mod tests {
   use super::*;
   #[test]
   fn chained_patches_see_guest_colors_before_any_theme_changes() {
      let mut ops = [Op::Update {
         id:    7,
         props: vec![(
            crate::prop!("draw"),
            Value::Arr(vec![
               Value::Words(vec![258, 1]),
               Value::WPatch {
                  list: 0,
                  set:  vec![(1, 2)],
               },
               Value::WPatch {
                  list: 1,
                  set:  vec![(0, 3)],
               },
            ]),
         )],
      }];
      assert!(expand_word_patches(&mut ops));
      let Op::Update { props, .. } = &ops[0] else {
         panic!()
      };
      assert_eq!(
         props[0].1,
         Value::Arr(vec![
            Value::Words(vec![258, 1]),
            Value::Words(vec![258, 2]),
            Value::Words(vec![3, 2])
         ])
      );
   }
}
