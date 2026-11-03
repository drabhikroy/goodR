//! Every web address the interface asks the system to open must be on the
//! window's allowlist in capabilities/default.json, or the button that
//! opens it does nothing but show an error. The two lists live in different
//! languages and drift apart easily, so this test reads both: each address
//! the interface opens, from its source, is checked against the allowlist
//! with the same glob matching the opener plugin applies.

use std::path::Path;

fn read(relative: &str) -> String {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    std::fs::read_to_string(root.join(relative)).unwrap_or_else(|error| panic!("could not read {relative}: {error}"))
}

/// The address patterns the window may open.
fn allowed() -> Vec<glob::Pattern> {
    let capability: serde_json::Value = serde_json::from_str(&read("src-tauri/capabilities/default.json")).unwrap();
    capability["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|permission| permission["identifier"] == "opener:allow-open-url")
        .flat_map(|permission| permission["allow"].as_array().cloned().unwrap_or_default())
        .map(|entry| glob::Pattern::new(entry["url"].as_str().unwrap()).unwrap())
        .collect()
}

/// Each double quoted https address in a source file. Addresses inside R
/// code, which the app never opens, are written in backticks and so are
/// not picked up.
fn addresses(source: &str) -> Vec<String> {
    source
        .split('"')
        .skip(1)
        .step_by(2)
        .filter(|text| text.starts_with("https://") && !text.contains(char::is_whitespace))
        .map(str::to_string)
        .collect()
}

#[test]
fn every_link_the_interface_opens_is_allowed() {
    let patterns = allowed();
    let mut links: Vec<String> = Vec::new();
    // The fixed links behind the app's buttons, the release and download
    // pages, and Quarto's page. The release page also comes from the core.
    for file in ["src/lib/app.ts", "src/lib/updates.ts", "src/lib/report.ts", "src-tauri/src/updates.rs"] {
        links.extend(addresses(&read(file)));
    }
    // The update check reads the first two with curl in the core, and the
    // third is the CRAN mirror set inside R code. None is ever opened in a
    // browser, so none needs a place on the list.
    let read_only = ["https://api.github.com/", "https://cran.r-project.org/src/base/VERSION-INFO.dcf", "https://cloud.r-project.org"];
    links.retain(|link| !read_only.iter().any(|prefix| link.starts_with(prefix)));
    links.sort();
    links.dedup();
    // A guard against this test quietly checking nothing if the sources
    // change shape.
    assert!(links.len() >= 8, "only found {links:?}");
    let blocked: Vec<&String> = links.iter().filter(|link| !patterns.iter().any(|pattern| pattern.matches(link))).collect();
    assert!(blocked.is_empty(), "these links are opened by the interface but not allowed in capabilities/default.json: {blocked:?}");
}

#[test]
fn the_allowlist_does_not_open_more_than_its_links() {
    let patterns = allowed();
    // A question mark in a glob matches any character, and a star any text,
    // so each entry is checked against near misses that must stay closed.
    for address in [
        "https://github.com/someone-else/goodR/issues",
        "https://ollama.com/download/../evil",
        "https://stackoverflow.com/questions/askXtags=r",
        "https://forum.posit.co/new-topic.evil.example",
        "http://cran.r-project.org/",
        "file:///etc/passwd",
    ] {
        assert!(!patterns.iter().any(|pattern| pattern.matches(address)), "{address} is allowed but should not be");
    }
}
