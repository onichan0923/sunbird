//! Remap resolved Discord UI colors while retaining host values for live theme
//! changes.
use std::collections::{
   HashMap,
   HashSet,
};

use phoenix_wire::Value;

use crate::{
   Op,
   Prop,
   mirror::Mirror,
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Palette {
   pub primary:    u32,
   pub on_primary: u32,
   pub container:  u32,
}

struct Paint {
   key:     Prop,
   source:  Value,
   applied: bool,
}

#[derive(Default)]
pub struct Accents {
   owners:    Vec<(String, Palette)>,
   originals: HashMap<i32, Vec<Paint>>,
}

fn argb(v: &Value) -> Option<u32> {
   match v {
      Value::I32(n) => Some(n.cast_unsigned()),
      Value::I64(n) => {
         u32::try_from(*n)
            .ok()
            .or_else(|| i32::try_from(*n).ok().map(i32::cast_unsigned))
      },
      _ => None,
   }
}

enum Tone {
   Brand,
   Pale,
   Link,
}

// Named blurple, brand and text-link stops in the mobile resource palette.
#[expect(
   clippy::unreadable_literal,
   reason = "match named RGB hex swatches as written in the palette"
)]
const fn tone(rgb: u32) -> Option<Tone> {
   match rgb & 0x00FF_FFFF {
      0xDFE4FF | 0xE7E9FD | 0xDEE0FC | 0xC9CDFB | 0xBCCAFF | 0xB9C8FF => Some(Tone::Pale),
      0x5865F2 | 0x9DB0FF | 0x9AADFF | 0x94A8FF | 0x8195FB | 0x798DF9 | 0x6374F4 | 0x525FE0
      | 0x404EB1 | 0x3A48A3 | 0x273478 | 0x7984F5 | 0x707BF4 | 0x6571F3 | 0x505CDC | 0x4752C4
      | 0x3C45A5 | 0x404EED | 0x7289DA => Some(Tone::Brand),
      0x8EBEFA | 0x7AB2F7 | 0x76AFF6 | 0x66A5F3 | 0x4D96EE | 0x4591EC | 0x2781E7 | 0x006DD4
      | 0x0361BC | 0x003064 | 0x00A8FC | 0x00AFF4 | 0x006CE7 | 0x0068E0 => Some(Tone::Link),
      _ => None,
   }
}

/// Whether a surface uses an original Discord brand fill (including translucent
/// fills).
#[must_use]
pub const fn brand_fill(color: u32) -> bool {
   color >> 24 != 0 && matches!(tone(color), Some(Tone::Brand | Tone::Pale))
}

fn scalar(prop: Prop) -> bool {
   matches!(
      prop.name(),
      Some(
         "color"
            | "tint"
            | "background"
            | "bg"
            | "activeBackground"
            | "borderColor"
            | "bgBorder"
            | "activeBorderColor"
            | "focusBorderColor"
            | "selectionColor"
            | "minTrackTint"
            | "maxTrackTint"
            | "thumbTint"
            | "handleColor"
            | "ripple"
            | "placeholderColor"
      )
   )
}

fn protected(mirror: &Mirror, id: i32) -> bool {
   let mut node = Some(id);
   for _ in 0..8 {
      let Some(id) = node else { break };
      if mirror.accessibility_id(id).is_some_and(|a| {
         a.starts_with("message.author:")
            || a.starts_with("message.avatar:")
            || a.starts_with("embed:author")
      }) {
         return true;
      }
      node = mirror.parent(id);
   }
   false
}

fn on_brand(mirror: &Mirror, id: i32) -> bool {
   let mut node = Some(id);
   for _ in 0..6 {
      let Some(id) = node else { break };
      if let Some(fill) = mirror.surface(id).and_then(crate::mirror::Surface::fill) {
         return matches!(tone(fill), Some(Tone::Brand));
      }
      node = mirror.parent(id);
   }
   false
}

fn colored(source: u32, target: u32) -> Value {
   Value::I64(i64::from((source & 0xFF00_0000) | (target & 0x00FF_FFFF)))
}

fn link_color(span: &Value) -> Option<u32> {
   let Value::Obj(fields) = span else {
      return None;
   };
   let url = fields.iter().any(|(k, v)| {
      (*k == crate::prop!("url").key() || *k == crate::prop!("link").key())
         && (v
            .as_str()
            .is_some_and(|s| s.starts_with("https://") || s.starts_with("http://"))
            || v
               .field(crate::prop!("url").key())
               .and_then(Value::as_str)
               .is_some_and(|s| s.starts_with("https://") || s.starts_with("http://")))
   });
   let color = span.field(Prop::COLOR.key()).and_then(argb);
   (url || color.is_some_and(|c| matches!(tone(c), Some(Tone::Link))))
      .then_some(color.unwrap_or(0xFF00_0000))
}

fn replacement(mirror: &Mirror, id: i32, prop: Prop, v: &Value, palette: Palette) -> Option<Value> {
   if prop == crate::prop!("spans") {
      let Value::Arr(spans) = v else { return None };
      let mut result = None;
      for (i, span) in spans.iter().enumerate() {
         let Some(color) = link_color(span) else {
            continue;
         };
         if protected(mirror, id) {
            return None;
         }
         let out = result.get_or_insert_with(|| spans.clone());
         if let Value::Obj(fields) = &mut out[i] {
            let value = colored(color, palette.primary);
            if let Some((_, old)) = fields.iter_mut().find(|(k, _)| *k == Prop::COLOR.key()) {
               *old = value;
            } else {
               fields.push((Prop::COLOR.key(), value));
            }
         }
      }
      return result.map(Value::Arr);
   }
   if !scalar(prop) {
      return None;
   }
   let color = argb(v)?;
   if color >> 24 == 0 {
      return None;
   }
   let foreground = prop == Prop::COLOR || prop == Prop::TINT;
   let rgb = color & 0x00FF_FFFF;
   let target = match tone(rgb) {
      Some(Tone::Pale) if !foreground => palette.container,
      Some(Tone::Brand | Tone::Pale) => palette.primary,
      Some(Tone::Link) if foreground => palette.primary,
      None if foreground && rgb == 0x00FF_FFFF && on_brand(mirror, id) => palette.on_primary,
      _ => return None,
   };
   if protected(mirror, id) {
      return None;
   }
   Some(colored(color, target))
}

impl Accents {
   pub fn set(&mut self, owner: &str, palette: Option<Palette>) -> bool {
      let before = self.owners.last().map(|o| o.1);
      self.owners.retain(|o| o.0 != owner);
      if let Some(p) = palette {
         self.owners.push((owner.to_owned(), p));
      }
      before != self.owners.last().map(|o| o.1)
   }

   /// Keep only potentially themed properties so partial updates, row reuse and
   /// plugin unload all have the original value available.
   pub fn rewrite(&mut self, ops: &mut Vec<Op>, mirror: &Mirror) -> bool {
      let palette = self.owners.last().map(|o| o.1);
      let mut changed = false;
      let mut roots = Vec::new();
      for op in &mut *ops {
         match op {
            Op::Children { ids, .. } => roots.extend_from_slice(ids),
            Op::ChildEdits { id, .. } => roots.push(*id),
            Op::Delete { ids } => {
               for id in ids {
                  self.originals.remove(id);
               }
            },
            Op::Create { id, .. } => {
               self.originals.remove(id);
            },
            _ => {},
         }
         let (Op::Create { id, props, .. } | Op::Update { id, props }) = op else {
            continue;
         };
         for (prop, value) in props {
            if *prop == Prop::ACCESSIBILITY_ID || matches!(prop.name(), Some("background" | "bg")) {
               roots.push(*id);
            }
            let candidate = if *prop == crate::prop!("spans") {
               let Value::Arr(spans) = value else {
                  self.remove(*id, *prop);
                  continue;
               };
               spans.iter().any(|span| link_color(span).is_some())
            } else {
               scalar(*prop)
                  && argb(value).is_some_and(|c| {
                     c >> 24 != 0
                        && (tone(c).is_some()
                           || ((*prop == Prop::COLOR || *prop == Prop::TINT)
                              && c & 0x00FF_FFFF == 0x00FF_FFFF))
                  })
            };
            if !candidate {
               self.remove(*id, *prop);
               continue;
            }
            let mapped = palette.and_then(|p| replacement(mirror, *id, *prop, value, p));
            let item = Paint {
               key:     *prop,
               source:  value.clone(),
               applied: mapped.is_some(),
            };
            let stored = self.originals.entry(*id).or_default();
            if let Some(old) = stored.iter_mut().find(|old| old.key == *prop) {
               *old = item;
            } else {
               stored.push(item);
            }
            if let Some(mapped) = mapped {
               *value = mapped;
               changed = true;
            }
         }
      }
      if let Some(palette) = palette {
         let mut seen = HashSet::new();
         while let Some(id) = roots.pop() {
            if !seen.insert(id) {
               continue;
            }
            roots.extend_from_slice(mirror.kids(id));
            if let Some(paints) = self.originals.get_mut(&id)
               && let Some(op) = repaint(paints, mirror, id, Some(palette), false)
            {
               ops.push(op);
               changed = true;
            }
         }
      }
      changed
   }

   fn remove(&mut self, id: i32, key: Prop) {
      if let Some(props) = self.originals.get_mut(&id) {
         props.retain(|p| p.key != key);
         if props.is_empty() {
            self.originals.remove(&id);
         }
      }
   }

   pub fn refresh(&mut self, mirror: &Mirror) -> Vec<Op> {
      let palette = self.owners.last().map(|o| o.1);
      self
         .originals
         .iter_mut()
         .filter_map(|(&id, props)| repaint(props, mirror, id, palette, true))
         .collect()
   }
}

fn repaint(
   paints: &mut [Paint],
   mirror: &Mirror,
   id: i32,
   palette: Option<Palette>,
   force: bool,
) -> Option<Op> {
   let mut props = Vec::new();
   for paint in paints {
      let mapped = palette.and_then(|p| replacement(mirror, id, paint.key, &paint.source, p));
      if (force && mapped.is_some()) || paint.applied != mapped.is_some() {
         paint.applied = mapped.is_some();
         props.push((paint.key, mapped.unwrap_or_else(|| paint.source.clone())));
      }
   }
   (!props.is_empty()).then_some(Op::Update { id, props })
}

#[cfg(test)]
mod tests {
   use super::*;
   use crate::{
      Props,
      ViewKind,
   };

   const PINK: Palette = Palette {
      primary:    0xFF81_4D5F,
      on_primary: 0xFFFF_FFFF,
      container:  0xFFED_DDE1,
   };
   const DARK: Palette = Palette {
      primary:    0xFFEF_B3C5,
      on_primary: 0xFF4B_2733,
      container:  0xFF49_373E,
   };
   fn color(value: u32) -> Value {
      Value::I64(i64::from(value))
   }
   fn create(id: i32, kind: ViewKind, props: Props) -> Op {
      Op::Create { id, kind, props }
   }
   fn send(m: &mut Mirror, a: &mut Accents, mut ops: Vec<Op>) -> Vec<Op> {
      m.apply(&ops, false);
      a.rewrite(&mut ops, m);
      ops
   }
   fn get(ops: &[Op], id: i32, prop: Prop) -> Option<&Value> {
      ops.iter().rev().find_map(|op| {
         match op {
            Op::Create { id: n, props, .. } | Op::Update { id: n, props } if *n == id => {
               crate::get_prop(props, prop)
            },
            _ => None,
         }
      })
   }

   #[test]
   fn reaction_reuse_and_theme_changes_keep_host_alpha_and_current_state() {
      let (mut m, mut a) = (Mirror::default(), Accents::default());
      let bg = crate::prop!("background");
      let stroke = crate::prop!("borderColor");
      let original = color(0x3058_65F2);
      let ops = send(&mut m, &mut a, vec![create(1, ViewKind::View, vec![
         (bg, original.clone()),
         (stroke, color(0xFF58_65F2)),
      ])]);
      assert_eq!(get(&ops, 1, bg), Some(&original));
      a.set("theme", Some(PINK));
      let ops = a.refresh(&m);
      assert_eq!(get(&ops, 1, bg), Some(&color(0x3081_4D5F)));
      assert_eq!(get(&ops, 1, stroke), Some(&color(PINK.primary)));
      a.set("theme", Some(DARK));
      assert_eq!(get(&a.refresh(&m), 1, bg), Some(&color(0x30EF_B3C5)));
      let neutral = color(0xFF34_3335);
      send(&mut m, &mut a, vec![Op::Update {
         id:    1,
         props: vec![(bg, neutral), (stroke, Value::Null)],
      }]);
      a.set("theme", None);
      assert!(a.refresh(&m).is_empty());
      a.set("theme", Some(PINK));
      send(&mut m, &mut a, vec![Op::Update {
         id:    1,
         props: vec![(bg, original.clone())],
      }]);
      a.set("theme", None);
      assert_eq!(get(&a.refresh(&m), 1, bg), Some(&original));
      send(&mut m, &mut a, vec![
         Op::Delete { ids: vec![1] },
         create(1, ViewKind::Image, vec![(
            Prop::URI,
            Value::Str("icon".into()),
         )]),
      ]);
      a.set("theme", Some(DARK));
      assert!(a.refresh(&m).is_empty());
   }

   #[test]
   fn links_only_change_text_paint_and_brand_buttons_pair_their_foreground() {
      let (mut m, mut a) = (Mirror::default(), Accents::default());
      a.set("theme", Some(DARK));
      let text = (Prop::TEXT.key(), Value::Str("link".into()));
      let action = (
         crate::prop!("url").key(),
         Value::Str("https://example.org/".into()),
      );
      let link = Value::Obj(vec![text.clone(), action.clone()]);
      let normal = Value::Obj(vec![text.clone(), (Prop::COLOR.key(), color(0xFF80_2291))]);
      let spans = crate::prop!("spans");
      let bg = crate::prop!("background");
      let original = Value::Arr(vec![normal.clone(), link]);
      let ops = send(&mut m, &mut a, vec![
         create(1, ViewKind::View, vec![(bg, color(0xFF58_65F2))]),
         create(2, ViewKind::Text, vec![(Prop::COLOR, color(0xFFFF_FFFF))]),
         create(3, ViewKind::Text, vec![(spans, original.clone())]),
         create(4, ViewKind::Text, vec![
            (
               Prop::ACCESSIBILITY_ID,
               Value::Str("message.author:1".into()),
            ),
            (Prop::COLOR, color(0xFF58_65F2)),
         ]),
         Op::Children {
            id:  1,
            ids: vec![2, 3, 4],
         },
      ]);
      assert_eq!(get(&ops, 1, bg), Some(&color(DARK.primary)));
      assert_eq!(get(&ops, 2, Prop::COLOR), Some(&color(DARK.on_primary)));
      assert_eq!(get(&ops, 4, Prop::COLOR), Some(&color(0xFF58_65F2)));
      let themed = Value::Arr(vec![
         normal,
         Value::Obj(vec![text, action, (Prop::COLOR.key(), color(DARK.primary))]),
      ]);
      assert_eq!(get(&ops, 3, spans), Some(&themed));
      let ops = send(&mut m, &mut a, vec![Op::Update {
         id:    1,
         props: vec![(bg, color(0xFF44_4444))],
      }]);
      assert_eq!(get(&ops, 2, Prop::COLOR), Some(&color(0xFFFF_FFFF)));
      a.set("theme", None);
      assert_eq!(get(&a.refresh(&m), 3, spans), Some(&original));
   }
}
