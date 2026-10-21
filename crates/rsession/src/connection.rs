//! The connection file tells ark which ports to listen on and which key to
//! sign with. We pick the ports and the key, write the file, and hand ark its
//! path.

use anyhow::Result;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::net::TcpListener;
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectionInfo {
    pub transport: String,
    pub ip: String,
    pub shell_port: u16,
    pub iopub_port: u16,
    pub stdin_port: u16,
    pub control_port: u16,
    pub hb_port: u16,
    pub key: String,
    pub signature_scheme: String,
}

impl ConnectionInfo {
    /// Chooses five free loopback ports and a random 32 byte key. Binding to
    /// loopback only keeps the session unreachable from other machines.
    pub fn generate() -> Result<Self> {
        let mut key = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut key);
        // Hold every listener until all five are chosen, so the operating
        // system cannot hand the same port out twice.
        let listeners: Vec<TcpListener> = (0..5)
            .map(|_| TcpListener::bind("127.0.0.1:0"))
            .collect::<std::io::Result<_>>()?;
        let ports: Vec<u16> = listeners
            .iter()
            .map(|listener| listener.local_addr().map(|addr| addr.port()))
            .collect::<std::io::Result<_>>()?;
        Ok(ConnectionInfo {
            transport: "tcp".into(),
            ip: "127.0.0.1".into(),
            shell_port: ports[0],
            iopub_port: ports[1],
            stdin_port: ports[2],
            control_port: ports[3],
            hb_port: ports[4],
            key: hex::encode(key),
            signature_scheme: "hmac-sha256".into(),
        })
    }

    /// The address ZeroMQ connects to for one of the five channels.
    pub fn endpoint(&self, port: u16) -> String {
        format!("{}://{}:{}", self.transport, self.ip, port)
    }

    /// Writes the file ark reads at startup. It holds the signing key, so it
    /// lives in a private per session folder and is readable only by its
    /// owner.
    pub fn write(&self, path: &Path) -> Result<()> {
        use std::io::Write;
        // Anything already at the path, such as a link to another file, is
        // removed and a new file made, so the key never lands somewhere else.
        let _ = std::fs::remove_file(path);
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        // Created private from the first byte, rather than written and then
        // restricted, so there is no moment when another user could read it.
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(path)?.write_all(&serde_json::to_vec_pretty(self)?)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ports_are_distinct_and_the_key_is_long() {
        let info = ConnectionInfo::generate().unwrap();
        let mut ports = vec![info.shell_port, info.iopub_port, info.stdin_port, info.control_port, info.hb_port];
        ports.sort();
        ports.dedup();
        assert_eq!(ports.len(), 5);
        assert_eq!(info.key.len(), 64);
    }
}
