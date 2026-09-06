import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { assertInside } from "./fs-atomic.mjs";

const LIMIT = 256 * 1024 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let n = 0xffffffff;
  for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}

export function validateArchivePath(name) {
  if (typeof name !== "string" || !name || name.includes("\\") || /[\x00-\x1f:]/.test(name)) {
    throw new Error("archive: unsafe path");
  }
  const parts = name.replace(/\/$/, "").split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || /[. ]$/.test(p)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    throw new Error("archive: unsafe path segment");
  }
  return name;
}

function validateEntries(entries) {
  const names = new Map();
  let total = 0;
  for (const entry of entries) {
    validateArchivePath(entry.name);
    const key = entry.name.replace(/\/$/, "").toLowerCase();
    if (names.has(key)) throw new Error("archive: duplicate entry");
    names.set(key, entry);
    total += entry.data.length;
    if (total > LIMIT) throw new Error("archive: expanded size limit");
  }
  for (const key of names.keys()) {
    let parent = key;
    while (parent.includes("/")) {
      parent = parent.slice(0, parent.lastIndexOf("/"));
      if (names.has(parent) && !names.get(parent).directory) throw new Error("archive: file/directory collision");
    }
  }
  if (!entries.length) throw new Error("archive: empty archive");
  return entries;
}

export function readZipEntries(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length > LIMIT) throw new Error("zip: size limit");
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (bytes.readUInt32LE(at) === 0x06054b50 && at + 22 + bytes.readUInt16LE(at + 20) === bytes.length) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error("zip: missing end record");
  const count = bytes.readUInt16LE(end + 10);
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralAt = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)
    || bytes.readUInt16LE(end + 8) !== count || centralAt + centralSize !== end) {
    throw new Error("zip: unsupported or inconsistent directory");
  }
  const entries = [];
  let at = centralAt;
  let localEnd = 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw new Error("zip: truncated central record");
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const packedSize = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameSize = bytes.readUInt16LE(at + 28);
    const extraSize = bytes.readUInt16LE(at + 30);
    const commentSize = bytes.readUInt16LE(at + 32);
    const mode = bytes.readUInt32LE(at + 38) >>> 16;
    const offset = bytes.readUInt32LE(at + 42);
    const next = at + 46 + nameSize + extraSize + commentSize;
    if (next > end || flags & ~0x0800 || ![0, 8].includes(method) || bytes.readUInt16LE(at + 34)) {
      throw new Error("zip: unsupported entry");
    }
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameSize));
    validateArchivePath(name);
    const directory = name.endsWith("/");
    if ((mode & 0xf000) && (mode & 0xf000) !== (directory ? 0x4000 : 0x8000)) {
      throw new Error("zip: symlink or special entry");
    }
    if (offset !== localEnd || offset + 30 > centralAt || bytes.readUInt32LE(offset) !== 0x04034b50) {
      throw new Error("zip: invalid local record");
    }
    const localNameSize = bytes.readUInt16LE(offset + 26);
    const dataAt = offset + 30 + localNameSize + bytes.readUInt16LE(offset + 28);
    const localName = utf8.decode(bytes.subarray(offset + 30, offset + 30 + localNameSize));
    if (localName !== name || bytes.readUInt16LE(offset + 6) !== flags || bytes.readUInt16LE(offset + 8) !== method
      || bytes.readUInt32LE(offset + 14) !== crc || bytes.readUInt32LE(offset + 18) !== packedSize
      || bytes.readUInt32LE(offset + 22) !== size || dataAt + packedSize > centralAt) {
      throw new Error("zip: local/central mismatch");
    }
    total += size;
    if (total > LIMIT) throw new Error("zip: expanded size limit");
    const packed = bytes.subarray(dataAt, dataAt + packedSize);
    const data = method === 0 ? packed : zlib.inflateRawSync(packed, { maxOutputLength: Math.max(1, size) });
    if (data.length !== size || crc32(data) !== crc || (directory && size !== 0)) throw new Error("zip: size/CRC mismatch");
    entries.push({ name, data, directory, mode: mode & 0o777 });
    localEnd = dataAt + packedSize;
    at = next;
  }
  if (at !== end || localEnd !== centralAt) throw new Error("zip: unexplained archive bytes");
  return validateEntries(entries);
}

export function readTarGzEntries(file) {
  if (fs.statSync(file).size > LIMIT) throw new Error('tar: compressed size limit');
  const bytes = zlib.gunzipSync(fs.readFileSync(file), { maxOutputLength: LIMIT });
  const text = (header, start, length) => utf8.decode(header.subarray(start, start + length)).replace(/\0.*$/s, "");
  const oct = (header, start, length) => {
    const str = text(header, start, length).trim();
    if (!/^[0-7]+$/.test(str)) throw new Error("tar: invalid numeric field");
    return Number.parseInt(str, 8);
  };
  const entries = [];
  let at = 0;
  for (; at + 512 <= bytes.length; ) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const expected = oct(header, 148, 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (sum !== expected || text(header, 257, 6) !== "ustar") throw new Error("tar: invalid USTAR header");
    const kind = text(header, 156, 1);
    if (!["0", "", "5"].includes(kind)) throw new Error("tar: link or unsupported entry");
    const prefix = text(header, 345, 155);
    const name = (prefix ? `${prefix}/` : "") + text(header, 0, 100);
    const size = oct(header, 124, 12);
    const dataAt = at + 512;
    if (dataAt + size > bytes.length || (kind === "5" && size)) throw new Error("tar: truncated entry");
    entries.push({ name, data: bytes.subarray(dataAt, dataAt + size), directory: kind === "5", mode: oct(header, 100, 8) });
    at = dataAt + Math.ceil(size / 512) * 512;
  }
  if (bytes.length - at < 1024 || !bytes.subarray(at).every((b) => b === 0)) throw new Error("tar: invalid end records");
  return validateEntries(entries);
}

export function extractEntries(entries, dest) {
  validateEntries(entries);
  // Validate every destination before creating the first entry.
  for (const entry of entries) assertInside(dest, path.join(dest, entry.name));
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of entries) {
    const target = path.join(dest, entry.name);
    if (entry.directory) fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.data, { flag: "wx", mode: entry.mode & 0o111 ? 0o755 : 0o644 });
    }
  }
}

export function extractReleaseArchive(archive, dest) {
  extractEntries(archive.endsWith(".zip") ? readZipEntries(archive) : readTarGzEntries(archive), dest);
}
