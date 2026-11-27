use std::{
   env,
   fs,
   path::{
      Path,
      PathBuf,
   },
   process::Command,
};

// SDK packages do not have to use the canonical directory names. Read
// source.properties so android-9 never wins over android-35 lexicographically.
fn sdk_tool(root: &Path, group: &str, file: &str, property: &str) -> PathBuf {
   fs::read_dir(root.join(group))
      .expect("installed Android SDK packages")
      .flatten()
      .filter_map(|entry| {
         let path = entry.path();
         let props = fs::read_to_string(path.join("source.properties")).ok()?;
         let version = props.lines().find_map(|line| line.strip_prefix(property))?;
         let rank: Vec<u32> = version
            .trim()
            .split('.')
            .map_while(|s| s.parse().ok())
            .collect();
         let tool = path.join(file);
         tool.is_file().then_some((rank, tool))
      })
      .max()
      .expect("required Android SDK package is missing")
      .1
}
fn run(command: &mut Command) {
   assert!(
      command
         .status()
         .expect("could not start Android build tool")
         .success(),
      "{command:?} failed"
   );
}
fn main() {
   println!("cargo:rerun-if-changed=android/StatusBar.java");
   for key in ["ANDROID_HOME", "ANDROID_SDK_ROOT", "JAVA_HOME"] {
      println!("cargo:rerun-if-env-changed={key}");
   }
   if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("android") {
      return;
   }
   let sdk: PathBuf = env::var_os("ANDROID_HOME")
      .or_else(|| env::var_os("ANDROID_SDK_ROOT"))
      .expect("Android SDK required")
      .into();
   let platform = sdk_tool(&sdk, "platforms", "android.jar", "AndroidVersion.ApiLevel=");
   let d8 = sdk_tool(
      &sdk,
      "build-tools",
      if cfg!(windows) { "d8.bat" } else { "d8" },
      "Pkg.Revision=",
   );
   let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
   let classes = out.join("status-classes");
   fs::create_dir_all(&classes).unwrap();
   let compiler = if cfg!(windows) { "javac.exe" } else { "javac" };
   let javac = env::var_os("JAVA_HOME").map_or_else(
      || compiler.into(),
      |home| PathBuf::from(home).join("bin").join(compiler),
   );
   run(
      Command::new(javac)
         .args(["-source", "8", "-target", "8", "-classpath"])
         .arg(&platform)
         .arg("-d")
         .arg(&classes)
         .arg("android/StatusBar.java"),
   );
   let mut class_files: Vec<_> = fs::read_dir(classes.join("dev/sunbird/appearance"))
      .unwrap()
      .flatten()
      .map(|entry| entry.path())
      .collect();
   class_files.sort();
   run(
      Command::new(d8)
         .args(["--min-api", "26", "--lib"])
         .arg(platform)
         .arg("--output")
         .arg(out)
         .args(class_files),
   );
}
