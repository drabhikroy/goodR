//! Models offered in the setup steps, each with what it does well and what
//! it does poorly for help with R, and a fit check against this computer.
//!
//! The list is short on purpose. More choices make a first choice slower
//! and harder (Hick 1952; Iyengar and Lepper 2000), and every model here
//! answers a different need: a small one for any Mac, a larger one for
//! better code, and general models that explain things in plainer words.
//! The suggestion is worked out from fit alone, never from the maker, so
//! the list stays even handed. Any other Ollama model the person installs
//! themselves is found and can be used too.

use crate::specs::Specs;
use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    /// The name Ollama knows the model by, such as "qwen2.5-coder:7b".
    pub id: &'static str,
    pub name: &'static str,
    /// What kind of help it is best at, in a few words.
    pub kind: &'static str,
    /// The download size in gigabytes, rounded. Ollama reports the exact
    /// size once a model is installed.
    pub size_gb: f64,
    /// The least memory it runs well with, for when the person chose not
    /// to let the app read this computer's specs.
    pub memory_floor_gb: u32,
    pub pros: &'static [&'static str],
    pub cons: &'static [&'static str],
    /// Whether the model thinks out loud before answering. Thinking is
    /// switched off for this work, which needs quick, short answers.
    pub thinks: bool,
}

pub const MODELS: &[Model] = &[
    Model {
        id: "qwen2.5-coder:3b",
        name: "Qwen2.5 Coder 3B",
        kind: "Small code model",
        size_gb: 1.9,
        memory_floor_gb: 8,
        pros: &["Quick on any Apple silicon Mac", "Trained mostly on code, so it writes R that runs", "Small download"],
        cons: &["Explanations are brief and can miss the bigger picture", "Less able to reason through why a result looks odd"],
        thinks: false,
    },
    Model {
        id: "qwen2.5-coder:7b",
        name: "Qwen2.5 Coder 7B",
        kind: "Code model",
        size_gb: 4.7,
        memory_floor_gb: 16,
        pros: &["Clearly better code and error fixes than the small model", "Still quick on a Mac with 16 GB of memory"],
        cons: &["Slow on a Mac with 8 GB of memory", "Explanations lean technical unless asked to keep them plain"],
        thinks: false,
    },
    Model {
        id: "gemma3:4b",
        name: "Gemma 3 4B",
        kind: "General model",
        size_gb: 3.3,
        memory_floor_gb: 8,
        pros: &["Explains output and statistics in clear, everyday words", "Fits a Mac with 8 GB of memory"],
        cons: &["Writes less reliable R than the code models, especially longer code"],
        thinks: false,
    },
    Model {
        id: "qwen3:8b",
        name: "Qwen3 8B",
        kind: "General model",
        size_gb: 5.2,
        memory_floor_gb: 16,
        pros: &["Good at walking through why an error happened", "Balances explanation and code well"],
        cons: &["Larger download than the code models of similar skill", "Can be wordy, though the app asks for short answers"],
        thinks: true,
    },
    Model {
        id: "qwen2.5-coder:14b",
        name: "Qwen2.5 Coder 14B",
        kind: "Large code model",
        size_gb: 9.0,
        memory_floor_gb: 24,
        pros: &["The strongest code of the models that fit a 24 to 32 GB Mac", "Handles longer scripts and pipelines"],
        cons: &["A 9 GB download", "Answers arrive noticeably slower"],
        thinks: false,
    },
    Model {
        id: "qwen3-coder:30b",
        name: "Qwen3 Coder 30B",
        kind: "Very large code model",
        size_gb: 19.0,
        memory_floor_gb: 32,
        pros: &["The best code quality in this list", "Quicker than its size suggests, since only part of it works on each word"],
        cons: &["A 19 GB download", "Needs 32 GB of memory or more"],
        thinks: false,
    },
];

/// How well a model suits this computer.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Fit {
    /// Runs comfortably alongside other apps.
    Good,
    /// Runs, but other apps may slow down while it answers.
    Tight,
    /// Not enough memory to run well.
    TooLarge,
    /// Not enough free disk space to download it.
    NoRoom,
}

/// The memory a model needs while answering: its weights plus room for
/// the conversation and the program itself.
pub fn memory_needed(size_gb: f64) -> f64 {
    size_gb * 1.2 + 1.5
}

/// Checks one model against this computer. On Apple silicon the system
/// lets the graphics chip use about two thirds of memory, or three
/// quarters on larger machines, and a model that fits inside that share
/// runs at full speed.
pub fn fit(model_size_gb: f64, specs: &Specs) -> Fit {
    if specs.free_disk_gb > 0.0 && specs.free_disk_gb < model_size_gb + 2.0 {
        return Fit::NoRoom;
    }
    let need = memory_needed(model_size_gb);
    let share = if specs.memory_gb > 36.0 { 0.75 } else { 0.66 };
    if need <= specs.memory_gb * share {
        Fit::Good
    } else if need <= specs.memory_gb * 0.85 {
        Fit::Tight
    } else {
        Fit::TooLarge
    }
}

/// The model to suggest first: the largest code model that fits
/// comfortably, since code is most of what people ask for here. With no
/// specs, the small code model, which runs on any Apple silicon Mac.
pub fn suggested(specs: Option<&Specs>) -> &'static str {
    let Some(specs) = specs else { return MODELS[0].id };
    MODELS
        .iter()
        .filter(|model| model.kind.contains("code") || model.kind.contains("Code"))
        .filter(|model| fit(model.size_gb, specs) == Fit::Good)
        .max_by(|a, b| a.size_gb.total_cmp(&b.size_gb))
        .map(|model| model.id)
        .unwrap_or(MODELS[0].id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mac(memory_gb: f64) -> Specs {
        Specs { memory_gb, free_disk_gb: 200.0, chip: "Apple M2".into(), apple_silicon: true }
    }

    #[test]
    fn small_models_fit_a_small_mac_and_large_ones_do_not() {
        assert_eq!(fit(1.9, &mac(8.0)), Fit::Good);
        assert_eq!(fit(4.7, &mac(8.0)), Fit::TooLarge);
        assert_eq!(fit(4.7, &mac(16.0)), Fit::Good);
        assert_eq!(fit(9.0, &mac(16.0)), Fit::Tight);
        assert_eq!(fit(19.0, &mac(32.0)), Fit::Tight);
        assert_eq!(fit(19.0, &mac(16.0)), Fit::TooLarge);
        assert_eq!(fit(19.0, &mac(48.0)), Fit::Good);
    }

    #[test]
    fn a_full_disk_is_reported_before_memory() {
        let mut specs = mac(64.0);
        specs.free_disk_gb = 5.0;
        assert_eq!(fit(4.7, &specs), Fit::NoRoom);
    }

    #[test]
    fn the_suggestion_grows_with_the_machine() {
        assert_eq!(suggested(None), "qwen2.5-coder:3b");
        assert_eq!(suggested(Some(&mac(8.0))), "qwen2.5-coder:3b");
        assert_eq!(suggested(Some(&mac(16.0))), "qwen2.5-coder:7b");
        assert_eq!(suggested(Some(&mac(24.0))), "qwen2.5-coder:14b");
        assert_eq!(suggested(Some(&mac(32.0))), "qwen2.5-coder:14b");
        assert_eq!(suggested(Some(&mac(64.0))), "qwen3-coder:30b");
    }

    #[test]
    fn every_model_lists_strengths_and_weaknesses() {
        for model in MODELS {
            assert!(!model.pros.is_empty() && !model.cons.is_empty(), "{}", model.id);
        }
    }
}
