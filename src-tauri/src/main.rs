// Hides the console window that would otherwise open beside the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    goodr_lib::run()
}
