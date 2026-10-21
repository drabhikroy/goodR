// A Vite plugin that acts on a file only when its content has changed.
// File syncing services, such as iCloud Drive for a project kept in
// Documents, touch files without changing them: they add sync metadata,
// and macOS reports that as a change. Without this check, each touch
// reloaded the page and the app appeared to restart over and over. The
// plugin keeps a hash of each file it has seen and ignores events where
// the hash is the same.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const hashOf = (text: string) => createHash("sha1").update(text).digest("hex");

export function onlyRealChanges(): Plugin {
  const known = new Map<string, string>();
  return {
    name: "only-real-changes",
    apply: "serve",
    // Each file is recorded when Vite first loads it, so the first touch
    // after startup can already be told apart from a real edit.
    load(id) {
      const path = id.split("?")[0];
      try {
        known.set(path, hashOf(readFileSync(path, "utf8")));
      } catch {
        // Virtual modules have no file to read, and need no check.
      }
      return null;
    },
    async handleHotUpdate(context) {
      const next = hashOf(await context.read());
      const previous = known.get(context.file);
      known.set(context.file, next);
      if (previous === next) return [];
      return undefined;
    },
  };
}
