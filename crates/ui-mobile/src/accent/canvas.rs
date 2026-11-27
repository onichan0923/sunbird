//! Phoenix canvas drawings contain variable-length instructions. The low byte
//! of the header is the opcode and the high bits count the following words.
use phoenix_wire::Value;

use super::{
   Palette,
   argb,
   brand_fill,
   protected,
};
use crate::{
   Prop,
   mirror::Mirror,
};

pub(super) const DRAW: Prop = crate::prop!("draw");
pub(super) const EDITS: Prop = crate::prop!("drawEdits");

fn word(list: &Value, index: usize) -> Option<u32> {
   match list {
      Value::Words(words) => words.get(index).map(|v| v.cast_unsigned()),
      Value::Arr(items) => items.get(index).and_then(argb),
      _ => None,
   }
}

const fn len(list: &Value) -> usize {
   match list {
      Value::Words(v) => v.len(),
      Value::Arr(v) => v.len(),
      _ => 0,
   }
}

fn put(list: &mut Value, index: usize, value: u32) {
   match list {
      Value::Words(v) => v[index] = value.cast_signed(),
      Value::Arr(v) => v[index] = Value::I64(i64::from(value)),
      _ => {},
   }
}

// drawEdits contains (word offset, replacement) pairs against the last draw.
// Keep the guest's version so palette changes can replay the current geometry.
pub(super) fn merge(source: &mut Value, edits: &Value) -> Option<()> {
   if !matches!(edits, Value::Words(_) | Value::Arr(_)) {
      return None;
   }
   for offset in (0..len(edits).saturating_sub(1)).step_by(2) {
      let i = usize::try_from(word(edits, offset)?).ok()?;
      if i < len(source) {
         put(source, i, word(edits, offset + 1)?);
      }
   }
   Some(())
}

fn control(mirror: &Mirror, mut id: i32) -> bool {
   for _ in 0..12 {
      if mirror
         .surface(id)
         .is_some_and(|s| s.role == Some("button") || s.pressable)
         || mirror
            .accessibility_id(id)
            .is_some_and(|n| n == "create-thread" || n.starts_with("request-actions-"))
      {
         return true;
      }
      let Some(parent) = mirror.parent(id) else {
         break;
      };
      id = parent;
   }
   false
}

pub(super) fn repaint(source: &Value, mirror: &Mirror, id: i32, palette: Palette) -> Option<Value> {
   if !control(mirror, id) || protected(mirror, id) {
      return None;
   }
   let mut result = None;
   let mut i = 0;
   while i < len(source) {
      let header = word(source, i)?;
      let count = usize::try_from(header >> 8).ok()?;
      let end = (i + 1).checked_add(count)?;
      if end > len(source) {
         return None;
      }
      // SetFill (2) consumes ARGB; geometry and image data may contain the same
      // bits.
      if header & 255 == 2 && count >= 1 {
         let arg = word(source, i + 1)?;
         if brand_fill(arg) {
            let target = if matches!(super::tone(arg), Some(super::Tone::Pale)) {
               palette.container
            } else {
               palette.primary
            };
            let mapped = (arg & 0xFF00_0000) | (target & 0x00FF_FFFF);
            put(result.get_or_insert_with(|| source.clone()), i + 1, mapped);
         }
      }
      i = end;
   }
   result
}
