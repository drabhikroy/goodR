//! Keeps the programs the app starts out of sight on Windows.
//!
//! Windows gives a console program its own console window when a desktop
//! app starts it, unless asked not to. ark, R, and the tools around them are
//! all console programs, so without this every run, render, and check would
//! flash a black window over the app. Macs and Linux never do this, so the
//! call changes nothing there.
//!
//! The rsession, render, and assistant crates each keep the same copy of
//! this file, since none of the three depends on another.

/// The process creation flag that tells Windows not to make a console.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Starts a program with no console window of its own on Windows.
pub trait Windowless {
    fn windowless(&mut self) -> &mut Self;
}

impl Windowless for std::process::Command {
    fn windowless(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

impl Windowless for tokio::process::Command {
    fn windowless(&mut self) -> &mut Self {
        #[cfg(windows)]
        self.creation_flags(CREATE_NO_WINDOW);
        self
    }
}
