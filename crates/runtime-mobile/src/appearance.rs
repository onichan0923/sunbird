//! Android configuration and the overlay-resolved framework accent and neutral
//! palettes.
use std::{
   ffi::CString,
   ptr,
   sync::{
      Mutex,
      OnceLock,
      PoisonError,
      atomic::{
         AtomicBool,
         AtomicU64,
         Ordering,
      },
      mpsc::{
         SyncSender,
         sync_channel,
      },
   },
};

use jni_sys::{
   JNIEnv,
   jvalue,
};
use phoenix_wire::{
   HostCall,
   Key,
   Value as WireValue,
};
use rquickjs::{
   CatchResultExt,
   Ctx,
   Exception,
   Function,
   Object,
};

use crate::{
   host::{
      self,
      Event,
      Field,
      Method,
   },
   js::{
      Mobile,
      ui::remover,
   },
   jvm::{
      self,
      Class,
      class,
      jni,
      method,
      signature,
   },
};

const RESOURCES: Class = class!(android::content::res::Resources);
const CONFIGURATION: Class = class!(android::content::res::Configuration);
const FAMILIES: [&str; 5] = ["accent1", "accent2", "accent3", "neutral1", "neutral2"];
const TONES: [u16; 13] = [0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
type Palette = [[u32; TONES.len()]; FAMILIES.len()];

#[derive(Clone, PartialEq, Eq)]
pub struct Appearance {
   dark:  Option<bool>,
   monet: Option<Palette>,
}

// Only the framework resource identifiers are process constants. Resolved
// colors can change.
unsafe fn resource_ids(env: *mut JNIEnv) -> Option<&'static [[i32; 13]; 5]> {
   static IDS: OnceLock<Option<[[i32; 13]; 5]>> = OnceLock::new();
   // SAFETY: the caller owns the local frame. Missing framework fields are
   // normal before API 31.
   unsafe {
      let ids = IDS.get_or_init(|| {
         let colors = class!(android::R.color).find(env).ok()?;
         let mut ids = [[0; 13]; 5];
         for (row, family) in ids.iter_mut().zip(FAMILIES) {
            for (slot, tone) in row.iter_mut().zip(TONES) {
               let name = CString::new(format!("system_{family}_{tone}")).ok()?;
               let field = jni!(env, GetStaticFieldID, colors, name.as_ptr(), c"I".as_ptr());
               if jvm::clear_exception(env) || field.is_null() {
                  return None;
               }
               *slot = jni!(env, GetStaticIntField, colors, field);
               if jvm::clear_exception(env) {
                  return None;
               }
            }
         }
         Some(ids)
      });
      ids.as_ref()
   }
}

unsafe fn read(env: *mut JNIEnv) -> Option<Appearance> {
   // SAFETY: every lookup and call is checked before using the result. All refs
   // are frame-local.
   unsafe {
      let app = jvm::application(env).ok()?;
      let context = class!(android::content::Context).find(env).ok()?;
      let resources = RESOURCES.find(env).ok()?;
      let get_resources =
         method(env, context, c"getResources", signature!(() -> RESOURCES)).ok()?;
      let app_res = jni!(env, CallObjectMethodA, app, get_resources, ptr::null());
      if jvm::clear_exception(env) || app_res.is_null() {
         return None;
      }
      let system =
         jvm::static_method(env, resources, c"getSystem", signature!(() -> RESOURCES)).ok()?;
      let system_res = jni!(env, CallStaticObjectMethodA, resources, system, ptr::null());
      if jvm::clear_exception(env) || system_res.is_null() {
         return None;
      }
      let config = method(
         env,
         resources,
         c"getConfiguration",
         signature!(() -> CONFIGURATION),
      )
      .ok()?;
      let cfg = jni!(env, CallObjectMethodA, system_res, config, ptr::null());
      if jvm::clear_exception(env) || cfg.is_null() {
         return None;
      }
      let cfg_class = CONFIGURATION.find(env).ok()?;
      let ui_mode = jni!(
         env,
         GetFieldID,
         cfg_class,
         c"uiMode".as_ptr(),
         c"I".as_ptr()
      );
      if jvm::clear_exception(env) || ui_mode.is_null() {
         return None;
      }
      let mode = jni!(env, GetIntField, cfg, ui_mode);
      if jvm::clear_exception(env) {
         return None;
      }
      let dark = match mode & 0x30 {
         0x10 => Some(false),
         0x20 => Some(true),
         _ => None,
      };
      let monet = resource_ids(env).and_then(|ids| {
         let color = method(env, resources, c"getColor", signature!((int) -> int)).ok()?;
         let mut palette = [[0; 13]; 5];
         for (row, id_row) in palette.iter_mut().zip(ids) {
            for (slot, id) in row.iter_mut().zip(id_row) {
               let arg = jvalue { i: *id };
               let value = jni!(env, CallIntMethodA, app_res, color, &raw const arg);
               if jvm::clear_exception(env) {
                  return None;
               }
               *slot = value.cast_unsigned();
            }
         }
         Some(palette)
      });
      Some(Appearance { dark, monet })
   }
}

fn snapshot() -> Option<Appearance> {
   let env = jvm::env()?;
   // SAFETY: env belongs to this thread; exactly one frame is popped for every
   // successful push.
   unsafe {
      if jni!(env, PushLocalFrame, 16) != 0 {
         jvm::clear_exception(env);
         return None;
      }
      let value = read(env);
      jvm::clear_exception(env);
      jni!(env, PopLocalFrame, ptr::null_mut());
      value
   }
}

pub struct Listener<'js> {
   owner:    String,
   id:       u64,
   callback: Function<'js>,
   last:     Option<Appearance>,
}

// Discord can publish a fresh host theme when switching panels. Keep only the
// requested semantic roles in that update; other colors belong to the client.
static CHROME: Mutex<Vec<(String, [u32; 3])>> = Mutex::new(Vec::new());

fn set_chrome(owner: &str, colors: Option<[u32; 3]>) {
   let mut entries = CHROME.lock().unwrap_or_else(PoisonError::into_inner);
   entries.retain(|(plugin, _)| plugin != owner);
   if let Some(colors) = colors {
      entries.push((owner.to_owned(), colors));
   }
}

pub fn theme_roles(head: &[u8]) -> Option<[(Key, u32); 3]> {
   let table = host::table()?;
   if HostCall::target(head)? != table.call(Method::AppStateSetTheme)? {
      return None;
   }
   let colors = CHROME
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
      .last()?
      .1;
   Some([
      (table.key(Field::Brand)?, colors[0]),
      (table.key(Field::BrandText)?, colors[1]),
      (table.key(Field::Background)?, colors[2]),
   ])
}

pub fn apply_theme_roles(frame: &[u8], roles: [(Key, u32); 3]) -> Option<Vec<u8>> {
   let mut call = HostCall::decode(frame).ok()?;
   let WireValue::Obj(fields) = &mut call.args else {
      return None;
   };
   for (key, color) in roles {
      let color = WireValue::I64(i64::from(color));
      if let Some((_, old)) = fields.iter_mut().find(|(k, _)| *k == key) {
         *old = color;
      } else {
         fields.push((key, color));
      }
   }
   Some(call.encode())
}

static ACTIVE: AtomicBool = AtomicBool::new(false);
static WORK: OnceLock<SyncSender<()>> = OnceLock::new();

pub fn active() -> bool {
   ACTIVE.load(Ordering::Acquire)
}

pub fn host_event(event: u16) {
   if active()
      && let Some(table) = host::table()
      && [Event::Appearance, Event::App]
         .into_iter()
         .any(|e| table.event(e) == Some(event))
      && let Some(work) = WORK.get()
   {
      let _ = work.try_send(());
   }
}

fn notify() {
   let Some(value) = snapshot() else { return };
   let Some(engine) = phoenix_runtime::engine() else {
      return;
   };
   engine.with(|ctx| {
      let Some(registry) = ctx.userdata::<Mobile<'_>>() else {
         return;
      };
      let mut calls = Vec::new();
      for listener in registry.appearance.borrow_mut().iter_mut() {
         if listener.last.as_ref() != Some(&value) {
            listener.last = Some(value.clone());
            calls.push((listener.owner.clone(), listener.callback.clone()));
         }
      }
      drop(registry);
      for (plugin, callback) in calls {
         if let Ok(state) = js_value(&ctx, Some(&value))
            && let Err(err) = callback.call::<_, ()>((state,)).catch(&ctx)
         {
            log::error!("[{plugin}] appearance.onChange: {err}");
         }
      }
   });
}

fn js_value<'js>(
   ctx: &Ctx<'js>,
   value: Option<&Appearance>,
) -> rquickjs::Result<rquickjs::Value<'js>> {
   let Some(value) = value else {
      return Ok(rquickjs::Value::new_null(ctx.clone()));
   };
   let obj = Object::new(ctx.clone())?;
   obj.set(
      "dark",
      value.dark.map_or_else(
         || rquickjs::Value::new_null(ctx.clone()),
         |dark| rquickjs::Value::new_bool(ctx.clone(), dark),
      ),
   )?;
   let palette = value
      .monet
      .as_ref()
      .map(|rows| {
         let palette = Object::new(ctx.clone())?;
         for (name, row) in FAMILIES.into_iter().zip(rows) {
            let scale = Object::new(ctx.clone())?;
            for (tone, color) in TONES.iter().zip(row) {
               scale.set(tone.to_string(), f64::from(*color))?;
            }
            palette.set(name, scale)?;
         }
         Ok::<_, rquickjs::Error>(palette)
      })
      .transpose()?;
   obj.set(
      "monet",
      palette.map_or_else(
         || rquickjs::Value::new_null(ctx.clone()),
         Object::into_value,
      ),
   )?;
   Ok(obj.into_value())
}

pub fn object<'js>(ctx: &Ctx<'js>, plugin: &str) -> rquickjs::Result<Object<'js>> {
   let obj = Object::new(ctx.clone())?;
   obj.set(
      "get",
      Function::new(ctx.clone(), |ctx: Ctx<'js>| {
         js_value(&ctx, snapshot().as_ref())
      })?,
   )?;
   let bar_owner = plugin.to_owned();
   obj.set(
      "setStatusBarColor",
      Function::new(ctx.clone(), move |color: u32, dark_icons: bool| {
         crate::status_bar::set(&bar_owner, Some((color, dark_icons)));
      })?,
   )?;
   let theme_owner = plugin.to_owned();
   obj.set(
      "setChromeColors",
      Function::new(
         ctx.clone(),
         move |ctx: Ctx<'js>, brand: u32, on_brand: u32, canvas: u32| {
            set_chrome(&theme_owner, Some([brand, on_brand, canvas]));
            let owner = theme_owner.clone();
            remover(&ctx, move |_| set_chrome(&owner, None), None)
         },
      )?,
   )?;
   let owner = plugin.to_owned();
   obj.set(
      "onChange",
      Function::new(
         ctx.clone(),
         move |ctx: Ctx<'js>, callback: Function<'js>| {
            static NEXT: AtomicU64 = AtomicU64::new(1);
            let id = NEXT.fetch_add(1, Ordering::Relaxed);
            let registry = ctx
               .userdata::<Mobile<'js>>()
               .ok_or_else(|| Exception::throw_internal(&ctx, "no registry"))?;
            WORK.get_or_init(|| {
               let (tx, rx) = sync_channel(1);
               std::thread::spawn(move || {
                  while rx.recv().is_ok() {
                     if active() {
                        notify();
                     }
                  }
               });
               tx
            });
            registry.appearance.borrow_mut().push(Listener {
               owner: owner.clone(),
               id,
               callback,
               last: snapshot(),
            });
            ACTIVE.store(true, Ordering::Release);
            drop(registry);
            remover(
               &ctx,
               move |ctx| retain(ctx, |listener| listener.id != id),
               None,
            )
         },
      )?,
   )?;
   Ok(obj)
}

fn retain(ctx: &Ctx<'_>, keep: impl FnMut(&Listener<'_>) -> bool) {
   if let Some(registry) = ctx.userdata::<Mobile<'_>>() {
      let mut listeners = registry.appearance.borrow_mut();
      listeners.retain(keep);
      ACTIVE.store(!listeners.is_empty(), Ordering::Release);
   }
}

#[cfg(test)]
mod theme_tests {
   use super::*;

   #[test]
   fn theme_update_changes_brand_and_canvas_and_preserves_other_roles() {
      let keys = [596, 597, 587].map(Key::new);
      let danger = (Key::new(590), WireValue::I64(0xFFED4245));
      let call = HostCall {
         module: 9,
         method: 84,
         args:   WireValue::Obj(vec![(keys[0], WireValue::I64(0xFF5865F2)), danger.clone()]),
         body:   vec![9],
      };
      let roles = [
         (keys[0], 0xFFEFB3C5),
         (keys[1], 0xFF4B2733),
         (keys[2], 0xFF22171A),
      ];
      let bytes = apply_theme_roles(&call.encode(), roles).unwrap();
      let result = HostCall::decode(&bytes).unwrap();
      assert_eq!(result.body, call.body);
      assert_eq!(result.args.field(danger.0), Some(&danger.1));
      for (key, color) in roles {
         assert_eq!(
            result.args.field(key),
            Some(&WireValue::I64(i64::from(color)))
         );
      }
   }
}

pub fn unload(ctx: &Ctx<'_>, plugin: &str) {
   crate::status_bar::set(plugin, None);
   set_chrome(plugin, None);
   retain(ctx, |listener| listener.owner != plugin);
}
