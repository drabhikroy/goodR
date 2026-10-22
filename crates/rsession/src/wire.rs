//! The Jupyter wire format: how one message becomes a list of ZeroMQ frames
//! and back again.
//!
//! Every message carries an HMAC signature over its four JSON parts. The kernel
//! rejects anything unsigned or signed with the wrong key, and this side rejects
//! the same from the kernel, so a stray process on the machine cannot inject output
//! into the editor.

use anyhow::{anyhow, Result};
use bytes::Bytes;
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;

/// Separates routing identities from the signed body of a message.
pub const DELIMITER: &[u8] = b"<IDS|MSG>";

/// The protocol version spoken here. ark accepts 5.3 and later.
const PROTOCOL_VERSION: &str = "5.3";

#[derive(Clone, Debug)]
pub struct Message {
    pub header: Value,
    pub parent_header: Value,
    pub metadata: Value,
    pub content: Value,
}

impl Message {
    /// Builds a fresh request. Each request gets its own id so replies and
    /// output can be matched back to the run that caused them.
    pub fn new(msg_type: &str, session: &str, content: Value) -> Self {
        Message::with_id(&uuid::Uuid::new_v4().to_string(), msg_type, session, content)
    }

    /// Builds a request with an id chosen by the caller. The interface picks
    /// run ids itself so it knows the id before any output can arrive.
    pub fn with_id(id: &str, msg_type: &str, session: &str, content: Value) -> Self {
        Message {
            header: json!({
                "msg_id": id,
                "session": session,
                "username": "goodfor",
                "date": chrono::Utc::now().to_rfc3339(),
                "msg_type": msg_type,
                "version": PROTOCOL_VERSION,
            }),
            parent_header: json!({}),
            metadata: json!({}),
            content,
        }
    }

    /// Builds a reply to `parent`, which the kernel needs for stdin answers.
    pub fn reply_to(parent: &Message, msg_type: &str, session: &str, content: Value) -> Self {
        let mut msg = Message::new(msg_type, session, content);
        msg.parent_header = parent.header.clone();
        msg
    }

    pub fn msg_type(&self) -> &str {
        self.header["msg_type"].as_str().unwrap_or("")
    }

    pub fn msg_id(&self) -> &str {
        self.header["msg_id"].as_str().unwrap_or("")
    }

    /// The id of the request this message answers, if it answers one.
    pub fn parent_id(&self) -> Option<&str> {
        self.parent_header["msg_id"].as_str()
    }
}

/// Signs and checks messages with the key from the connection file.
#[derive(Clone)]
pub struct Signer {
    key: Vec<u8>,
}

impl Signer {
    pub fn new(key: &str) -> Self {
        Signer { key: key.as_bytes().to_vec() }
    }

    fn sign(&self, parts: &[&[u8]]) -> String {
        // The key length is never a problem for HMAC, so this cannot fail.
        let mut mac = Hmac::<Sha256>::new_from_slice(&self.key).expect("HMAC accepts any key length");
        for part in parts {
            mac.update(part);
        }
        hex::encode(mac.finalize().into_bytes())
    }

    /// Turns a message into the frames a dealer socket sends.
    pub fn encode(&self, msg: &Message) -> Vec<Bytes> {
        let header = serde_json::to_vec(&msg.header).unwrap_or_default();
        let parent = serde_json::to_vec(&msg.parent_header).unwrap_or_default();
        let metadata = serde_json::to_vec(&msg.metadata).unwrap_or_default();
        let content = serde_json::to_vec(&msg.content).unwrap_or_default();
        let signature = self.sign(&[&header, &parent, &metadata, &content]);
        vec![
            Bytes::from_static(DELIMITER),
            Bytes::from(signature),
            Bytes::from(header),
            Bytes::from(parent),
            Bytes::from(metadata),
            Bytes::from(content),
        ]
    }

    /// Reads frames from any channel. Routing identities and the iopub topic
    /// come before the delimiter, so everything up to it is skipped.
    pub fn decode(&self, frames: &[Bytes]) -> Result<Message> {
        let start = frames
            .iter()
            .position(|frame| frame.as_ref() == DELIMITER)
            .ok_or_else(|| anyhow!("message has no delimiter frame"))?;
        let body = &frames[start + 1..];
        if body.len() < 5 {
            return Err(anyhow!("message has {} body frames, expected at least 5", body.len()));
        }
        let expected = self.sign(&[&body[1], &body[2], &body[3], &body[4]]);
        if body[0].as_ref() != expected.as_bytes() {
            return Err(anyhow!("message signature does not match the session key"));
        }
        Ok(Message {
            header: serde_json::from_slice(&body[1])?,
            parent_header: serde_json::from_slice(&body[2])?,
            metadata: serde_json::from_slice(&body[3])?,
            content: serde_json::from_slice(&body[4])?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_keeps_every_part() {
        let signer = Signer::new("secret");
        let msg = Message::new("execute_request", "s1", json!({"code": "1 + 1"}));
        let decoded = signer.decode(&signer.encode(&msg)).unwrap();
        assert_eq!(decoded.msg_type(), "execute_request");
        assert_eq!(decoded.content["code"], "1 + 1");
        assert_eq!(decoded.msg_id(), msg.msg_id());
    }

    #[test]
    fn identities_before_the_delimiter_are_skipped() {
        let signer = Signer::new("secret");
        let mut frames = vec![Bytes::from_static(b"topic")];
        frames.extend(signer.encode(&Message::new("status", "s1", json!({}))));
        assert_eq!(signer.decode(&frames).unwrap().msg_type(), "status");
    }

    #[test]
    fn a_wrong_key_is_rejected() {
        let frames = Signer::new("secret").encode(&Message::new("status", "s1", json!({})));
        assert!(Signer::new("other").decode(&frames).is_err());
    }
}
