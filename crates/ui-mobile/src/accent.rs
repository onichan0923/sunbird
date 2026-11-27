//! Remap resolved Discord UI colors while retaining host values for live theme
//! changes.
mod animated;

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
   pub primary:      u32,
   pub on_primary:   u32,
   pub container:    u32,
   pub system_links: bool,
}

struct Paint {
   key:         Prop,
   source:      Value,
   applied:     bool,
   scoped_font: bool,
}

#[derive(Default)]
pub struct Accents {
   animated:    animated::Animated,
   owners:      Vec<(String, Palette)>,
   font_owners: HashSet<String>,
   font_roots:  HashMap<i32, HashSet<String>>,
   originals:   HashMap<i32, Vec<Paint>>,
}

pub(crate) fn argb(v: &Value) -> Option<u32> {
   match v {
      Value::I32(n) => Some(n.cast_unsigned()),
      Value::I64(n) => {
         u32::try_from(*n)
            .ok()
            .or_else(|| i32::try_from(*n).ok().map(i32::cast_unsigned))
      },
      Value::F64(number)
         if number.fract() == 0.0
            && (f64::from(i32::MIN)..=f64::from(u32::MAX)).contains(number) =>
      {
         #[expect(
            clippy::cast_possible_truncation,
            reason = "validated exact 32-bit integer color"
         )]
         let integer = *number as i64;
         u32::try_from(integer)
            .ok()
            .or_else(|| i32::try_from(integer).ok().map(i32::cast_unsigned))
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

pub(crate) fn link_ink(value: &Value) -> bool {
   argb(value).is_some_and(|c| matches!(tone(c), Some(Tone::Link)))
}

fn uses_system_font(mirror: &Mirror, mut id: i32, roots: &HashMap<i32, HashSet<String>>) -> bool {
   if roots.is_empty() {
      return false;
   }
   for _ in 0..32 {
      if roots.contains_key(&id) {
         return true;
      }
      let Some(parent) = mirror.parent(id) else {
         break;
      };
      id = parent;
   }
   false
}

fn plain_family(v: &Value) -> bool {
   let name = v.as_str().unwrap_or_default().to_ascii_lowercase();
   !(name.contains("mono") || name.contains("emoji") || name.contains("icon"))
}

fn scalar(prop: Prop) -> bool {
   matches!(
      prop.name(),
      Some(
         "color"
            | "tint"
            | "fill"
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

fn gradient(prop: Prop) -> bool {
   matches!(
      prop.name(),
      Some("backgroundGradient" | "activeBackgroundGradient" | "gradient")
   )
}

fn stop_colors(value: &Value) -> Option<&Vec<Value>> {
   match value {
      Value::Arr(colors) => Some(colors),
      Value::Obj(_) => {
         match value.field(crate::prop!("colors").key())? {
            Value::Arr(colors) => Some(colors),
            _ => None,
         }
      },
      _ => None,
   }
}

fn text_runs(prop: Prop) -> bool {
   prop == crate::prop!("spans") || prop == crate::prop!("valueSpans")
}

fn candidate(prop: Prop, value: &Value) -> bool {
   if text_runs(prop) {
      return matches!(value, Value::Arr(spans) if spans.iter().any(|s| link_color(s).is_some() || s.field(Prop::FONT_FAMILY.key()).is_some()));
   }
   if gradient(prop) {
      return stop_colors(value).is_some_and(|v| v.iter().any(|s| argb(s).is_some_and(brand_fill)));
   }
   prop == Prop::FONT_FAMILY
      || (scalar(prop)
         && argb(value).is_some_and(|c| {
            c >> 24 != 0
               && (tone(c).is_some()
                  || ((prop == Prop::COLOR || prop == Prop::TINT)
                     && c & 0x00FF_FFFF == 0x00FF_FFFF))
         }))
}

fn replacement(
   mirror: &Mirror,
   id: i32,
   prop: Prop,
   v: &Value,
   palette: Option<Palette>,
   system_font: bool,
) -> Option<Value> {
   if gradient(prop) {
      let palette = palette?;
      let stops = stop_colors(v)?;
      if protected(mirror, id) || !stops.iter().any(|s| argb(s).is_some_and(brand_fill)) {
         return None;
      }
      let mut out = v.clone();
      let colors = match &mut out {
         Value::Arr(colors) => colors,
         Value::Obj(fields) => {
            let (_, Value::Arr(colors)) = fields
               .iter_mut()
               .find(|(k, _)| *k == crate::prop!("colors").key())?
            else {
               return None;
            };
            colors
         },
         _ => return None,
      };
      for stop in colors {
         if let Some(c) = argb(stop).filter(|c| brand_fill(*c)) {
            *stop = colored(
               c,
               if matches!(tone(c), Some(Tone::Pale)) {
                  palette.container
               } else {
                  palette.primary
               },
            );
         }
      }
      return Some(out);
   }
   if prop == Prop::FONT_FAMILY {
      let link = palette.is_some_and(|p| p.system_links)
         && mirror
            .surface(id)
            .is_some_and(|s| s.link_ink || s.role == Some("link"))
         && !protected(mirror, id);
      return (plain_family(v) && (link || system_font)).then(|| Value::Str("sans-serif".into()));
   }
   if text_runs(prop) {
      let Value::Arr(spans) = v else { return None };
      let mut result = None;
      let pal = palette.filter(|_| prop == crate::prop!("spans"));
      for (i, span) in spans.iter().enumerate() {
         let Value::Obj(_) = span else { continue };
         let link = link_color(span).filter(|_| !protected(mirror, id));
         let family = span.field(Prop::FONT_FAMILY.key());
         let font = ((system_font && (family.is_some() || link.is_some()))
            || (pal.is_some_and(|p| p.system_links) && link.is_some()))
            && family.is_none_or(plain_family);
         let color = link.zip(pal);
         if color.is_none() && !font {
            continue;
         }
         let out = result.get_or_insert_with(|| spans.clone());
         if let Value::Obj(fields) = &mut out[i] {
            let mut set = |key: Prop, value| {
               if let Some((_, old)) = fields.iter_mut().find(|(k, _)| *k == key.key()) {
                  *old = value;
               } else {
                  fields.push((key.key(), value));
               }
            };
            if let Some((color, palette)) = color {
               set(Prop::COLOR, colored(color, palette.primary));
            }
            if font {
               set(Prop::FONT_FAMILY, Value::Str("sans-serif".into()));
            }
         }
      }
      return result.map(Value::Arr);
   }
   if !scalar(prop) {
      return None;
   }
   let palette = palette?;
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
   pub fn enable_system_font(&mut self, owner: &str) -> bool {
      let first = self.font_owners.is_empty();
      self.font_owners.insert(owner.to_owned()) && first
   }

   pub fn font_root(&mut self, owner: &str, id: i32) -> bool {
      self
         .font_roots
         .entry(id)
         .or_default()
         .insert(owner.to_owned())
   }

   pub fn set(&mut self, owner: &str, palette: Option<Palette>) -> bool {
      let before = self.owners.last().map(|o| o.1);
      let mut removed = false;
      if palette.is_none() {
         removed = self.font_owners.remove(owner) && self.font_owners.is_empty();
         self.font_roots.retain(|_, owners| {
            removed |= owners.remove(owner);
            !owners.is_empty()
         });
      }
      self.owners.retain(|o| o.0 != owner);
      if let Some(p) = palette {
         self.owners.push((owner.to_owned(), p));
      }
      removed || before != self.owners.last().map(|o| o.1)
   }

   /// Keep only potentially themed properties so partial updates, row reuse and
   /// plugin unload all have the original value available.
   pub fn rewrite(&mut self, ops: &mut Vec<Op>, mirror: &Mirror) -> bool {
      let palette = self.owners.last().map(|o| o.1);
      let global_font = !self.font_owners.is_empty();
      let mut changed = false;
      let mut roots = Vec::new();
      for op in &mut *ops {
         match op {
            Op::Motion { words } => {
               changed |= self.animated.rewrite(words, mirror, palette);
               continue;
            },
            Op::Children { ids, .. } => roots.extend_from_slice(ids),
            Op::ChildEdits { id, .. } => roots.push(*id),
            Op::Delete { ids } => {
               for id in ids {
                  self.originals.remove(id);
                  self.font_roots.remove(id);
                  self.animated.forget(*id);
               }
            },
            Op::Create { id, .. } => {
               self.animated.forget(*id);
               self.font_roots.remove(id);
               self.originals.remove(id);
            },
            _ => {},
         }
         let default_family = matches!(op, Op::Create {kind:crate::ViewKind::Text | crate::ViewKind::Input | crate::ViewKind::Markup,props,..} if !props.iter().any(|(k,_)| *k==Prop::FONT_FAMILY));
         let (Op::Create { id, props, .. } | Op::Update { id, props }) = op else {
            continue;
         };
         if default_family {
            props.push((Prop::FONT_FAMILY, Value::Null));
         }
         for (prop, value) in &mut *props {
            if *prop == crate::prop!("worklet") {
               self.animated.bind(*id, value);
               continue;
            }
            if matches!(*prop, Prop::ACCESSIBILITY_ID | Prop::ROLE | Prop::COLOR)
               || matches!(prop.name(), Some("background" | "bg"))
            {
               roots.push(*id);
            }
            let candidate = candidate(*prop, value);
            if !candidate {
               self.remove(*id, *prop);
               continue;
            }
            let font = global_font || uses_system_font(mirror, *id, &self.font_roots);
            let mapped = replacement(mirror, *id, *prop, value, palette, font);
            let item = Paint {
               key:         *prop,
               source:      value.clone(),
               applied:     mapped.is_some(),
               scoped_font: text_runs(*prop) && font,
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
         if default_family && props.last().is_some_and(|(_, v)| *v == Value::Null) {
            props.pop();
         }
      }
      if palette.is_some() || !self.font_roots.is_empty() {
         let mut seen = HashSet::new();
         while let Some(id) = roots.pop() {
            if !seen.insert(id) {
               continue;
            }
            roots.extend_from_slice(mirror.kids(id));
            if let Some(paints) = self.originals.get_mut(&id)
               && let Some(op) = repaint(
                  paints,
                  mirror,
                  id,
                  palette,
                  false,
                  global_font || uses_system_font(mirror, id, &self.font_roots),
               )
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
      let mut ops: Vec<_> = self
         .originals
         .iter_mut()
         .filter_map(|(&id, props)| {
            repaint(
               props,
               mirror,
               id,
               palette,
               true,
               !self.font_owners.is_empty() || uses_system_font(mirror, id, &self.font_roots),
            )
         })
         .collect();
      ops.extend(self.animated.refresh(mirror, palette));
      ops
   }
}

fn repaint(
   paints: &mut [Paint],
   mirror: &Mirror,
   id: i32,
   palette: Option<Palette>,
   force: bool,
   system_font: bool,
) -> Option<Op> {
   let mut props = Vec::new();
   for paint in paints {
      let mapped = replacement(mirror, id, paint.key, &paint.source, palette, system_font);
      let scoped = text_runs(paint.key) && system_font;
      if ((force || scoped != paint.scoped_font) && mapped.is_some())
         || paint.applied != mapped.is_some()
      {
         paint.scoped_font = scoped;
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
      system_links: false,
      primary:      0xFF81_4D5F,
      on_primary:   0xFFFF_FFFF,
      container:    0xFFED_DDE1,
   };
   const DARK: Palette = Palette {
      system_links: false,
      primary:      0xFFEF_B3C5,
      on_primary:   0xFF4B_2733,
      container:    0xFF49_373E,
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
   fn system_font_survives_new_runs_and_reverts_when_a_row_moves() {
      let (mut m, mut a) = (Mirror::default(), Accents::default());
      a.set(
         "m3e",
         Some(Palette {
            system_links: true,
            ..DARK
         }),
      );
      let key = Prop::FONT_FAMILY;
      let runs = crate::prop!("spans");
      let make = |family: &str| {
         Value::Obj(vec![
            (key.key(), Value::Str(family.into())),
            (crate::prop!("fontWeight").key(), Value::I32(700)),
         ])
      };
      let url = Value::Obj(vec![(
         crate::prop!("url").key(),
         Value::Str("https://example.org".into()),
      )]);
      let raw = Value::Arr(vec![make("gg sans"), make("monospace"), url]);
      send(&mut m, &mut a, vec![
         create(1, ViewKind::View, vec![]),
         create(2, ViewKind::Text, vec![(runs, raw.clone())]),
         Op::Children {
            id:  1,
            ids: vec![2],
         },
      ]);
      assert!(a.font_root("m3e", 1));
      let painted = a.refresh(&m);
      assert_eq!(
         get(&painted, 2, key).and_then(Value::as_str),
         Some("sans-serif")
      );
      let Some(Value::Arr(v)) = get(&painted, 2, runs) else {
         panic!()
      };
      assert_eq!(v[0], make("sans-serif"));
      assert_eq!(v[1], make("monospace"));
      assert_eq!(
         v[2].field(key.key()).and_then(Value::as_str),
         Some("sans-serif")
      );
      let moved = send(&mut m, &mut a, vec![Op::Children {
         id:  3,
         ids: vec![2],
      }]);
      assert_eq!(get(&moved, 2, key), Some(&Value::Null));
      let Some(Value::Arr(v)) = get(&moved, 2, runs) else {
         panic!()
      };
      assert_eq!(v[0], make("gg sans"));
      a.set("m3e", None);
      assert_eq!(get(&a.refresh(&m), 2, runs), Some(&raw));
   }

   #[test]
   fn standalone_font_and_theme_can_be_enabled_and_unloaded_in_either_order() {
      let family = Prop::FONT_FAMILY;
      let runs = crate::prop!("spans");
      let url = crate::prop!("url");
      let bold = crate::prop!("fontWeight");
      let native = Value::Str("gg sans".into());
      let system = Value::Str("sans-serif".into());
      let link = Value::Obj(vec![
         (url.key(), Value::Str("https://example.org".into())),
         (Prop::COLOR.key(), color(0xFF00_6DD4)),
         (bold.key(), Value::I32(700)),
      ]);
      let code = Value::Obj(vec![(family.key(), Value::Str("monospace".into()))]);
      let raw = Value::Arr(vec![link.clone(), code.clone()]);
      for font_first in [true, false] {
         let (mut m, mut a) = (Mirror::default(), Accents::default());
         send(&mut m, &mut a, vec![create(7, ViewKind::Text, vec![
            (family, native.clone()),
            (runs, raw.clone()),
         ])]);
         if font_first {
            a.enable_system_font("font");
         } else {
            a.set("theme", Some(PINK));
         }
         let first = a.refresh(&m);
         assert_eq!(get(&first, 7, family), font_first.then_some(&system));
         let Some(Value::Arr(v)) = get(&first, 7, runs) else {
            panic!()
         };
         assert_eq!(v[0].field(family.key()), font_first.then_some(&system));
         assert_eq!(
            v[0].field(Prop::COLOR.key()),
            Some(&color(if font_first {
               0xFF00_6DD4
            } else {
               PINK.primary
            }))
         );
         if font_first {
            a.set("theme", Some(PINK));
         } else {
            a.enable_system_font("font");
         }
         let mounted = send(&mut m, &mut a, vec![create(8, ViewKind::Input, vec![(
            crate::prop!("valueSpans"),
            raw.clone(),
         )])]);
         assert_eq!(get(&mounted, 8, family), Some(&system));
         let Some(Value::Arr(input)) = get(&mounted, 8, crate::prop!("valueSpans")) else {
            panic!()
         };
         assert_eq!(
            input[0].field(Prop::COLOR.key()),
            link.field(Prop::COLOR.key())
         );
         let both = a.refresh(&m);
         let Some(Value::Arr(v)) = get(&both, 7, runs) else {
            panic!()
         };
         assert_eq!(v[0].field(family.key()), Some(&system));
         assert_eq!(v[0].field(Prop::COLOR.key()), Some(&color(PINK.primary)));
         assert_eq!(v[0].field(url.key()), link.field(url.key()));
         assert_eq!(v[0].field(bold.key()), Some(&Value::I32(700)));
         assert_eq!(v[1], code);
         a.set(if font_first { "font" } else { "theme" }, None);
         let left = a.refresh(&m);
         assert_eq!(
            get(&left, 7, family),
            Some(if font_first { &native } else { &system })
         );
         let Some(Value::Arr(v)) = get(&left, 7, runs) else {
            panic!()
         };
         assert_eq!(v[0].field(family.key()), (!font_first).then_some(&system));
         assert_eq!(
            v[0].field(Prop::COLOR.key()),
            Some(&color(if font_first {
               PINK.primary
            } else {
               0xFF00_6DD4
            }))
         );
         a.set(if font_first { "theme" } else { "font" }, None);
         assert_eq!(get(&a.refresh(&m), 7, runs), Some(&raw));
      }
   }

   #[test]
   fn native_color_motion_uses_monet_targets_and_keeps_the_spring() {
      let (mut m, mut a) = (Mirror::default(), Accents::default());
      a.set("m3e", Some(PINK));
      let program = Value::Words(vec![-1_792_780_819, 1, 8, 1, 14, 15, 16, 17]);
      send(&mut m, &mut a, vec![create(1, ViewKind::View, vec![(
         crate::prop!("worklet"),
         program,
      )])]);
      let spring = |c: u32| {
         crate::motion::words(
            &[14, 15, 16, 17]
               .into_iter()
               .zip(c.to_be_bytes())
               .map(|(slot, b)| {
                  crate::motion::Command::Spring {
                     slot,
                     target: f32::from(b),
                     spring: crate::motion::Spring::SWITCH,
                  }
               })
               .collect::<Vec<_>>(),
         )
      };
      let ops = send(&mut m, &mut a, vec![Op::Motion {
         words: spring(0x9958_65F2),
      }]);
      assert!(matches!(&ops[0],Op::Motion{words} if *words==spring(0x9981_4d5f)));
      a.set("m3e", Some(DARK));
      assert!(
         a.refresh(&m)
            .iter()
            .any(|op| matches!(op, Op::Motion { .. }))
      );
      let neutral = spring(0xFF83_8383);
      let ops = send(&mut m, &mut a, vec![Op::Motion {
         words: neutral.clone(),
      }]);
      assert!(matches!(&ops[0],Op::Motion{words} if *words==neutral));
      send(&mut m, &mut a, vec![Op::Delete { ids: vec![1] }]);
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
