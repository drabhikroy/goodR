//! Integration tests against a real R through the pinned ark binary.
//!
//! Run `node scripts/fetch-ark.mjs` once first. These tests fail rather
//! than skip when R or ark is missing, because a silently skipped test
//! would report a passing build that was never checked.

mod session;
