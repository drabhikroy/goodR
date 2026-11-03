//! Every name, path, and line of code the app passes to R travels inside an
//! R string literal made by `r_string`. If any string could end that literal
//! early, text in a file name or a script could become a different R call.
//!
//! This test asks R's own parser rather than trusting the escaping rules:
//! thousands of generated strings, heavy with quotes, backslashes, control
//! characters, and characters outside ASCII, are quoted, parsed by R, and
//! compared byte for byte with what went in. The seed is fixed, so a failure
//! names a string that reproduces.

use rsession::helpers::r_string;
use std::process::Command;

/// A small fixed-seed generator, so the strings are the same on every run.
struct Seeded(u64);

impl Seeded {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    fn below(&mut self, limit: u64) -> u64 {
        self.next() % limit
    }
}

// Characters that matter to a string literal or to the code around one,
// with ordinary text mixed in so they appear in every position.
const AWKWARD: &[char] = &[
    '"', '\'', '`', '\\', '\n', '\r', '\t', '\0', '\u{1}', '\u{7}', '\u{1b}', '\u{7f}', ')', '(', ';', ',', '#', '$', '%', '{', '}', 'x', 'u', 'U', '0', '7', ' ', 'é', '中', '😀',
    '\u{2028}', '\u{feff}', '\u{200b}', '\u{fffd}',
];

fn generated(seed: u64, count: usize) -> Vec<String> {
    let mut random = Seeded(seed);
    (0..count)
        .map(|_| {
            let length = random.below(24) as usize;
            (0..length)
                .map(|_| {
                    if random.below(4) == 0 {
                        // Any character at all, from the whole of Unicode.
                        loop {
                            if let Some(c) = char::from_u32(random.below(0x11_0000) as u32) {
                                break c;
                            }
                        }
                    } else {
                        AWKWARD[random.below(AWKWARD.len() as u64) as usize]
                    }
                })
                .collect()
        })
        .collect()
}

#[test]
fn every_quoted_string_reads_back_exactly_in_r() {
    let mut strings = generated(0x5EED_600D_F00D, 4000);
    // Shapes that have broken quoting in other programs.
    strings.extend(["", "\\", "\\\"", "\"", "\\\\\"", "a\\", "\\u0041", "\\x41", "\\n", "\"); system(\"echo hi\"); (\"", "\r\n", "\0\0"].map(String::from));

    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("literals.R");
    let literals: Vec<String> = strings.iter().map(|text| r_string(text)).collect();
    std::fs::write(&source, format!("list(\n{}\n)\n", literals.join(",\n"))).unwrap();

    // R reads the file with its parser and prints the bytes of each string,
    // one string per line, so nothing depends on how R prints text.
    let script = "values <- eval(parse(file = commandArgs(TRUE)[1], encoding = 'UTF-8'))\n\
                  for (value in values) cat(paste(as.integer(charToRaw(enc2utf8(value))), collapse = ' '), '\\n', sep = '')";
    let output = Command::new("Rscript").args(["--vanilla", "-e", script]).arg(&source).env("LC_ALL", "C.UTF-8").output().expect("Rscript must be on the PATH for this test");
    assert!(output.status.success(), "R could not read the quoted strings: {}", String::from_utf8_lossy(&output.stderr));

    let lines: Vec<String> = String::from_utf8(output.stdout).unwrap().lines().map(str::to_string).collect();
    assert_eq!(lines.len(), strings.len(), "R read a different number of strings than were written");
    for (text, line) in strings.iter().zip(&lines) {
        // R strings cannot hold NUL, so r_string drops it.
        let expected: Vec<u8> = text.bytes().filter(|byte| *byte != 0).collect();
        let actual: Vec<u8> = line.split_whitespace().map(|byte| byte.parse().unwrap()).collect();
        assert_eq!(actual, expected, "the string {text:?} came back from R as {:?}", String::from_utf8_lossy(&actual));
    }
}
