#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const index = path.join(dist, "client", "index.html");
const worker = path.join(root, "worker", "index.js");
const workerStorage = path.join(root, "worker", "storage.js");
const databaseSchema = path.join(root, "db", "schema.js");
const hosting = path.join(root, ".openai", "hosting.json");

for (const file of [index, worker, workerStorage, databaseSchema, hosting]) {
  if (!existsSync(file)) throw new Error("Missing Sites build input: " + file);
}

mkdirSync(path.join(dist, "server"), { recursive: true });
mkdirSync(path.join(dist, "db"), { recursive: true });
mkdirSync(path.join(dist, ".openai"), { recursive: true });
copyFileSync(worker, path.join(dist, "server", "index.js"));
copyFileSync(workerStorage, path.join(dist, "server", "storage.js"));
copyFileSync(databaseSchema, path.join(dist, "db", "schema.js"));
copyFileSync(hosting, path.join(dist, ".openai", "hosting.json"));

console.log("Prepared Sites build: Worker modules, dist/server/index.js, and dist/.openai/hosting.json");
