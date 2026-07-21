fn main() {
    // tauri_build only emits rerun-if-changed for tauri.conf.json and
    // capabilities/, so a changed icon never invalidates this build script and
    // the previous one stays baked into the Windows resource — the taskbar and
    // title-bar icon then survive any number of rebuilds.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
