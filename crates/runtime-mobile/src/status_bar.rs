//! Optional Android status-inset paint, owned by the plugin that requested it.
use std::{
   ptr::{
      self,
      NonNull,
   },
   sync::{
      Mutex,
      OnceLock,
      PoisonError,
   },
};

use jni_sys::{
   JNIEnv,
   jclass,
   jobject,
   jvalue,
};

use crate::jvm::{
   self,
   class,
   jni,
   method,
   signature,
   static_method,
};

const APPLICATION: jvm::Class = class!(android::app::Application);
const LOADER: jvm::Class = class!(java::lang::ClassLoader);
const BUFFER: jvm::Class = class!(java::nio::ByteBuffer);
const DEX: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/classes.dex"));
static OWNERS: Mutex<Vec<(String, u32, bool)>> = Mutex::new(Vec::new());

struct GlobalClass(NonNull<jni_sys::_jobject>);
// SAFETY: this is one process-lifetime global JNI class reference.
unsafe impl Send for GlobalClass {}
// SAFETY: global class references are valid from every attached thread.
unsafe impl Sync for GlobalClass {}

unsafe fn object(env: *mut JNIEnv, value: jobject) -> Option<jobject> {
   // SAFETY: env is current; the value is an object result from that env.
   (!unsafe { jvm::clear_exception(env) } && !value.is_null()).then_some(value)
}

unsafe fn helper(env: *mut JNIEnv, app: jobject) -> Option<jclass> {
   static CLASS: OnceLock<GlobalClass> = OnceLock::new();
   if let Some(class) = CLASS.get() {
      return Some(class.0.as_ptr());
   }
   // SAFETY: all method lookups and object results are checked in this local
   // frame.
   unsafe {
      let dex_class = class!(dalvik::system::InMemoryDexClassLoader)
         .find(env)
         .ok()?;
      let context = class!(android::content::Context).find(env).ok()?;
      let get_loader = method(env, context, c"getClassLoader", signature!(() -> LOADER)).ok()?;
      let parent = object(
         env,
         jni!(env, CallObjectMethodA, app, get_loader, ptr::null()),
      )?;
      let buffer = BUFFER.find(env).ok()?;
      let wrap = static_method(env, buffer, c"wrap", signature!(([byte]) -> BUFFER)).ok()?;
      let bytes = jvm::new_bytes(env, DEX)?.0;
      let bytes_arg = jvalue { l: bytes };
      let buf = object(
         env,
         jni!(
            env,
            CallStaticObjectMethodA,
            buffer,
            wrap,
            &raw const bytes_arg
         ),
      )?;
      let ctor = method(
         env,
         dex_class,
         c"<init>",
         signature!((BUFFER, LOADER) -> void),
      )
      .ok()?;
      let args = [jvalue { l: buf }, jvalue { l: parent }];
      let loader = object(env, jni!(env, NewObjectA, dex_class, ctor, args.as_ptr()))?;
      let class = LOADER.find(env).ok()?;
      let load = method(
         env,
         class,
         c"loadClass",
         c"(Ljava/lang/String;)Ljava/lang/Class;",
      )
      .ok()?;
      let name = object(
         env,
         jni!(
            env,
            NewStringUTF,
            c"dev.sunbird.appearance.StatusBar".as_ptr()
         ),
      )?;
      let name_arg = jvalue { l: name };
      let local = object(
         env,
         jni!(env, CallObjectMethodA, loader, load, &raw const name_arg),
      )?;
      let global = object(env, jni!(env, NewGlobalRef, local))?;
      // Access is serialized by OWNERS.
      Some(
         CLASS
            .get_or_init(|| GlobalClass(NonNull::new(global).unwrap()))
            .0
            .as_ptr(),
      )
   }
}

pub fn set(owner: &str, requested: Option<(u32, bool)>) {
   let mut owners = OWNERS.lock().unwrap_or_else(PoisonError::into_inner);
   let before = owners.last().map(|(_, color, dark)| (*color, *dark));
   owners.retain(|(name, ..)| name != owner);
   if let Some((color, dark)) = requested {
      owners.push((owner.to_owned(), color, dark));
   }
   let next = owners.last().map(|(_, color, dark)| (*color, *dark));
   if before == next {
      return;
   }
   let Some(env) = jvm::env() else { return };
   // SAFETY: env belongs to this thread. The Java entry point posts view work
   // to the main looper. Only the compiled-in helper is loaded.
   unsafe {
      if jni!(env, PushLocalFrame, 24) != 0 {
         jvm::clear_exception(env);
         return;
      }
      let applied = (|| {
         let app = jvm::application(env).ok()?;
         let class = helper(env, app)?;
         let set = static_method(
            env,
            class,
            c"set",
            signature!((APPLICATION, boolean, int, boolean) -> void),
         )
         .ok()?;
         let (color, dark) = next.unwrap_or_default();
         let args = [
            jvalue { l: app },
            jvalue { z: next.is_some() },
            jvalue {
               i: color.cast_signed(),
            },
            jvalue { z: dark },
         ];
         jni!(env, CallStaticVoidMethodA, class, set, args.as_ptr());
         (!jvm::clear_exception(env)).then_some(())
      })();
      jvm::clear_exception(env);
      jni!(env, PopLocalFrame, ptr::null_mut());
      if applied.is_none() {
         log::debug!("Android status inset is unavailable");
      }
   }
   // Preserve the order of updates queued on the Android main thread.
   drop(owners);
}
