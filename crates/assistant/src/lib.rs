//! The optional assistant: a language model that runs on this computer
//! through Ollama and helps with R. Nothing here sends code, data, or
//! questions anywhere else.
//!
//! The pieces follow the setup steps the interface walks through:
//! `runtime` finds Ollama or installs a private copy, `specs` reads this
//! computer's memory and disk only when the user agrees, `catalog` lists
//! models with their strengths and weaknesses for this work, and `ollama`
//! talks to the running server. `prompts` builds the requests.

pub mod catalog;
pub mod ollama;
pub mod prompts;
pub mod runtime;
pub mod specs;
