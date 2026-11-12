// Hides the console window that would otherwise open beside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // On Linux the web view often draws nothing but a blank window in a
    // virtual machine, and with some graphics drivers, when it composites on
    // the graphics card. Turning that off draws correctly everywhere, at a
    // small cost in smoothness. GOODR_GPU=1 keeps the card's compositing for
    // a computer where it works, and a value set by hand is never replaced.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() && std::env::var_os("GOODR_GPU").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
    goodr_lib::run()
}
