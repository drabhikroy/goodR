//! The references file beside a document. Insert citation adds one entry
//! to references.bib in the document's folder, making the file the first
//! time, and says which key to cite it by. An entry already there, found
//! by its DOI, is reused rather than added twice, and a key already taken
//! by a different work gets a letter after it, as in Smith_2020a.

/// The key of a BibTeX entry, the text between `@type{` and the first
/// comma.
pub fn entry_key(entry: &str) -> Option<String> {
    let start = entry.find('{')? + 1;
    let end = start + entry[start..].find(',')?;
    let key = entry[start..end].trim();
    (!key.is_empty()).then(|| key.to_string())
}

/// The DOI an entry names, lowercased, since DOIs ignore case.
fn entry_doi(entry: &str) -> Option<String> {
    let lower = entry.to_lowercase();
    let at = lower.find("doi")?;
    let rest = &lower[at..];
    let open = rest.find(['{', '"'])? + 1;
    let close = open + rest[open..].find(['}', '"'])?;
    Some(rest[open..close].trim().to_string())
}

/// Each entry in a references file, split at the @ that starts a line.
fn entries(text: &str) -> Vec<&str> {
    let mut found = Vec::new();
    let mut start = None;
    for (at, _) in text.match_indices('@') {
        if at == 0 || text[..at].ends_with('\n') {
            if let Some(begin) = start {
                found.push(&text[begin..at]);
            }
            start = Some(at);
        }
    }
    if let Some(begin) = start {
        found.push(&text[begin..]);
    }
    found
}

/// Adds `entry` to the text of a references file, returning the new text
/// and the key to cite. The text is unchanged when the work is already
/// there.
pub fn add_entry(existing: &str, entry: &str) -> Result<(String, String), String> {
    let entry = entry.trim();
    let key = entry_key(entry).ok_or_else(|| "The reference that came back has no key.".to_string())?;
    let doi = entry_doi(entry);
    let current = entries(existing);
    if let Some(doi) = &doi {
        if let Some(same) = current.iter().find(|item| entry_doi(item).as_ref() == Some(doi)) {
            return Ok((existing.to_string(), entry_key(same).unwrap_or(key)));
        }
    }
    let taken: Vec<String> = current.iter().filter_map(|item| entry_key(item)).collect();
    let mut chosen = key.clone();
    for letter in 'a'..='z' {
        if !taken.contains(&chosen) {
            break;
        }
        chosen = format!("{key}{letter}");
    }
    let entry = entry.replacen(&key, &chosen, 1);
    let mut text = existing.trim_end().to_string();
    if !text.is_empty() {
        text.push_str("\n\n");
    }
    text.push_str(&entry);
    text.push('\n');
    Ok((text, chosen))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENTRY: &str = "@article{Smith_2020, title={Rivers}, DOI={10.1000/XYZ}, year={2020}}";

    #[test]
    fn a_first_entry_makes_the_file() {
        let (text, key) = add_entry("", ENTRY).unwrap();
        assert_eq!(key, "Smith_2020");
        assert!(text.starts_with("@article{Smith_2020,"));
    }

    #[test]
    fn the_same_work_is_not_added_twice() {
        let (text, _) = add_entry("", ENTRY).unwrap();
        let again = "@article{Smith_2020, title={Rivers}, DOI={10.1000/xyz}}";
        let (after, key) = add_entry(&text, again).unwrap();
        assert_eq!(after, text);
        assert_eq!(key, "Smith_2020");
    }

    #[test]
    fn a_taken_key_gets_a_letter() {
        let (text, _) = add_entry("", ENTRY).unwrap();
        let other = "@article{Smith_2020, title={Lakes}, DOI={10.1000/other}}";
        let (after, key) = add_entry(&text, other).unwrap();
        assert_eq!(key, "Smith_2020a");
        assert!(after.contains("@article{Smith_2020a,"));
        assert_eq!(entries(&after).len(), 2);
    }
}
