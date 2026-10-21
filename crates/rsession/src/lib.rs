//! Talks to R for the app.
//!
//! R runs inside ark, Posit's R kernel, as a separate process. This crate
//! finds R installations, starts ark, and speaks the Jupyter protocol to it.
//! It has no interface code, so its tests run against a real R without a
//! window.

pub mod connection;
pub mod discover;
pub mod helpers;
pub mod session;
pub mod wire;

pub use discover::{find_installations, RInstall};
pub use session::{parse_helper_json, Event, Session, SessionConfig};

/// Decodes a plot as ark sends it. ark wraps the base64 text across lines
/// and leaves off the trailing padding, so a strict decoder rejects it.
pub fn decode_plot(data: &str) -> anyhow::Result<Vec<u8>> {
    use base64::engine::{general_purpose::GeneralPurpose, DecodePaddingMode, Engine, GeneralPurposeConfig};
    let lenient = GeneralPurpose::new(&base64::alphabet::STANDARD, GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent));
    let compact: String = data.chars().filter(|c| !c.is_whitespace()).collect();
    Ok(lenient.decode(compact)?)
}
