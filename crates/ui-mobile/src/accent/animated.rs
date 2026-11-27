//! Remap color targets in the same native set/spring stream that paints Discord
//! buttons.
use std::collections::HashMap;

use phoenix_wire::Value;

use super::{
   Palette,
   replacement,
};
use crate::{
   Op,
   Prop,
   mirror::Mirror,
   motion::{
      Channel,
      Command,
      words,
   },
};

#[derive(Default)]
pub(super) struct Animated {
   bindings:    HashMap<i32, Vec<Binding>>,
   first_slots: HashMap<i32, i32>,
}
struct Binding {
   prop:    Prop,
   slots:   [i32; 4],
   source:  Option<u32>,
   applied: bool,
}

impl Animated {
   pub(super) fn forget(&mut self, id: i32) {
      if let Some(groups) = self.bindings.remove(&id) {
         for b in groups {
            if self.first_slots.get(&b.slots[0]) == Some(&id) {
               self.first_slots.remove(&b.slots[0]);
            }
         }
      }
   }
   pub(super) fn bind(&mut self, id: i32, program: &Value) {
      self.forget(id);
      let Value::Words(w) = program else { return };
      let Some(entries) = crate::motion::channel_table(w) else {
         return;
      };
      let mut groups = Vec::new();
      for e in entries {
         let prop = match Channel::try_from(e[0]) {
            Ok(Channel::Background) => crate::prop!("background"),
            Ok(Channel::BorderColor) => crate::prop!("borderColor"),
            _ => continue,
         };
         let slots = [e[2], e[3], e[4], e[5]];
         if e[1] == 0
            || slots
               .iter()
               .enumerate()
               .any(|(i, n)| *n < 0 || slots[..i].contains(n))
         {
            continue;
         }
         self.first_slots.insert(slots[0], id);
         groups.push(Binding {
            prop,
            slots,
            source: None,
            applied: false,
         });
      }
      if !groups.is_empty() {
         self.bindings.insert(id, groups);
      }
   }
   pub(super) fn rewrite(
      &mut self,
      stream: &mut [i32],
      mirror: &Mirror,
      palette: Option<Palette>,
   ) -> bool {
      if self.first_slots.is_empty() {
         return false;
      }
      let mut at = 0;
      let mut changed = false;
      while let Some(&op) = stream.get(at) {
         let (length, target) = match op {
            8 => (3, 2),
            2 => (13, 5),
            _ => break,
         };
         let Some(command) = stream.get(at..at + length) else {
            break;
         };
         let slot = command[1];
         let Some(id) = self.first_slots.get(&slot).copied() else {
            at += length;
            continue;
         };
         let Some(b) = self
            .bindings
            .get_mut(&id)
            .and_then(|v| v.iter_mut().find(|b| b.slots[0] == slot))
         else {
            at += length;
            continue;
         };
         let Some(group) = stream.get_mut(at..at + 4 * length) else {
            break;
         };
         let mut bytes = [0; 4];
         let complete =
            group
               .chunks_exact(length)
               .zip(b.slots)
               .zip(&mut bytes)
               .all(|((cmd, slot), byte)| {
                  let value = f32::from_bits(cmd[target].cast_unsigned());
                  if cmd[0] != op
                     || cmd[1] != slot
                     || !(0.0..=255.0).contains(&value)
                     || value.fract() != 0.0
                  {
                     return false;
                  }
                  #[expect(
                     clippy::cast_possible_truncation,
                     clippy::cast_sign_loss,
                     reason = "validated integral color component"
                  )]
                  {
                     *byte = value as u8;
                  }
                  true
               });
         if !complete {
            at += length;
            continue;
         }
         let source = u32::from_be_bytes(bytes);
         b.source = Some(source);
         let mapped = palette.and_then(|p| paint(mirror, id, b.prop, source, p));
         b.applied = mapped.is_some();
         if let Some(mapped) = mapped {
            for (cmd, byte) in group.chunks_exact_mut(length).zip(mapped.to_be_bytes()) {
               cmd[target] = f32::from(byte).to_bits().cast_signed();
            }
            changed = true;
         }
         at += 4 * length;
      }
      changed
   }
   pub(super) fn refresh(&mut self, mirror: &Mirror, palette: Option<Palette>) -> Option<Op> {
      let mut commands = Vec::new();
      for (&id, groups) in &mut self.bindings {
         for b in groups {
            let Some(source) = b.source else { continue };
            let mapped = palette.and_then(|p| paint(mirror, id, b.prop, source, p));
            if (mapped.is_some() || b.applied) && self.first_slots.get(&b.slots[0]) == Some(&id) {
               commands.extend(
                  b.slots
                     .into_iter()
                     .zip(mapped.unwrap_or(source).to_be_bytes())
                     .map(|(slot, byte)| {
                        Command::Set {
                           slot,
                           value: f32::from(byte),
                        }
                     }),
               );
            }
            b.applied = mapped.is_some();
         }
      }
      (!commands.is_empty()).then(|| {
         Op::Motion {
            words: words(&commands),
         }
      })
   }
}
fn paint(m: &Mirror, id: i32, prop: Prop, source: u32, p: Palette) -> Option<u32> {
   let mapped = replacement(m, id, prop, &Value::I64(i64::from(source)), Some(p), false)?;
   super::argb(&mapped)
}
