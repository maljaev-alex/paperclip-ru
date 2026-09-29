import fs from "node:fs";
import path from "node:path";
import { extractReleaseArchive } from "../../tools/lib/archive-read.mjs";
import { writeZipFromDirectory, writeTarGzFromDirectory } from "../../tools/lib/zip-write.mjs";
import { treeInventory } from "../../tools/lib/tree-snapshot.mjs";
import { hashFile } from "../../tools/lib/fs-atomic.mjs";
import { TOOL_VERSION } from "../../tools/lib/constants.mjs";

export const NEXT_TOOL_VERSION = TOOL_VERSION.replace(/\d+$/, patch => String(Number(patch) + 1));

// Synthetic next tool version. The real old/new CLIs and payloads have different
// bytes, so restoration cannot pass by accidentally leaving the new root active.
export function makeReleaseVariant(baseDist, destination, version = NEXT_TOOL_VERSION) {
  fs.mkdirSync(destination, { recursive: true });
  const old = JSON.parse(fs.readFileSync(path.join(baseDist, "release-manifest.json"), "utf8"));
  if (version === old.toolVersion) throw new Error("Cross-version fixture must change the tool version");
  const scratch = path.join(destination, "source");
  extractReleaseArchive(path.join(baseDist, `paperclip-ru-${old.toolVersion}.zip`), scratch);
  const root = path.join(scratch, "paperclip-ru");
  const writeJson = (file, value) => fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  pkg.version = version;
  writeJson("package.json", pkg);
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  lock.version = version;
  lock.packages[""].version = version;
  writeJson("package-lock.json", lock);
  const compatibility = JSON.parse(fs.readFileSync(path.join(root, 'data/compatibility.json'), 'utf8'));
  compatibility.toolVersion = version;
  writeJson('data/compatibility.json', compatibility);
  const constant = path.join(root, "tools/lib/constants.mjs");
  fs.writeFileSync(constant, fs.readFileSync(constant, "utf8").replace(/export const TOOL_VERSION = "[^"]+";/, `export const TOOL_VERSION = "${version}";`));
  const dictionary = JSON.parse(fs.readFileSync(path.join(root, "locales/ru.json"), "utf8"));
  dictionary["Dashboard"] = "Обзор тестовой версии";
  writeJson("locales/ru.json", dictionary);
  const artifact = JSON.parse(fs.readFileSync(path.join(root, "artifact-manifest.json"), "utf8"));
  artifact.toolVersion = version;
  artifact.tag = `v${version}`;
  delete artifact.payload;
  fs.unlinkSync(path.join(root, "artifact-manifest.json"));
  artifact.payload = Object.fromEntries(Object.entries(treeInventory(root).files).map(([key, rec]) => [key, { sha256: rec.hash, size: rec.size }]));
  writeJson("artifact-manifest.json", artifact);
  const assets = [];
  for (const [suffix, write] of [["zip", writeZipFromDirectory], ["tar.gz", writeTarGzFromDirectory]]) {
    const name = `paperclip-ru-${version}.${suffix}`;
    const file = path.join(destination, name);
    write(root, file, { rootName: "paperclip-ru" });
    assets.push({ name, role: "archive", sha256: hashFile(file), size: fs.statSync(file).size });
  }
  const manifest = { ...artifact, schema: old.schema, artifactManifest: "artifact-manifest.json", artifactManifestSha256: hashFile(path.join(root, "artifact-manifest.json")), assets };
  fs.writeFileSync(path.join(destination, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(destination, "SHA256SUMS"), [...assets.map((a) => `${a.sha256}  ${a.name}`), `${hashFile(path.join(destination, "release-manifest.json"))}  release-manifest.json`].join("\n") + "\n");
  return destination;
}
