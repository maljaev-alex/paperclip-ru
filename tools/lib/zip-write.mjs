import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { readZipEntries, extractEntries } from "./archive-read.mjs";

function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (~crc) >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function walkFiles(root) {
  const out = [];
  const walk = (dir, relBase) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, rel);
      else out.push({ abs: p, rel });
    }
  };
  walk(root, "");
  return out.sort((a, b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
}

/**
 * Write a ZIP (DEFLATE) of the directory contents. `rootName` becomes the
 * top-level folder inside the archive when provided.
 * @param {string} sourceDir
 * @param {string} zipPath
 * @param {{ rootName?: string | null }} [options]
 */
export function writeZipFromDirectory(sourceDir, zipPath, { rootName = null } = {}) {
  const files = walkFiles(sourceDir);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const data = fs.readFileSync(file.abs);
    const name = rootName ? `${rootName}/${file.rel}` : file.rel;
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const gp = 0x0800; // UTF-8
    const method = 8;
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(gp),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(deflated.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      deflated,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(0x0314),
      u16(20),
      u16(gp),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(deflated.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32((file.rel.endsWith(".sh") ? 0o100755 : 0o100644) * 65536),
      u32(offset),
      nameBuf,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  fs.writeFileSync(zipPath, Buffer.concat([...locals, centralDir, eocd]));
}

export function listZipEntries(zipPath) {
  return readZipEntries(zipPath).map((entry) => entry.name);
}

export function extractZipToDirectory(zipPath, dest) {
  extractEntries(readZipEntries(zipPath), dest);
}

function octField(value, width) {
  const s = Number(value).toString(8);
  return Buffer.from(`${s.padStart(width - 1, "0")}\0`);
}

function tarChecksum(header) {
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += header[i];
  return sum;
}

function tarHeader(name, size, mode) {
  const header = Buffer.alloc(512, 0);
  let fileName = name;
  let prefix = "";
  if (Buffer.byteLength(name, "utf8") > 100) {
    const idx = name.lastIndexOf("/");
    prefix = name.slice(0, idx);
    fileName = name.slice(idx + 1);
  }
  Buffer.from(fileName, "utf8").copy(header, 0);
  octField(mode, 8).copy(header, 100);
  octField(0, 8).copy(header, 108);
  octField(0, 8).copy(header, 116);
  const sizeField = Buffer.from(`${Number(size).toString(8).padStart(11, "0")} `);
  sizeField.copy(header, 124);
  const epoch = Number(process.env.SOURCE_DATE_EPOCH) || 1_746_403_200;
  const mtime = Buffer.from(`${Math.floor(epoch).toString(8).padStart(11, "0")} `);
  mtime.copy(header, 136);
  header.write("        ", 148);
  header.write("0", 156);
  header.write("ustar\0", 257);
  header.write("00", 263);
  if (prefix) Buffer.from(prefix, "utf8").copy(header, 345);
  header.write(`${tarChecksum(header).toString(8).padStart(6, "0")}\0 `, 148);
  return header;
}

/**
 * @param {string} sourceDir
 * @param {string} tarPath
 * @param {{ rootName?: string | null }} [options]
 */
export function writeTarGzFromDirectory(sourceDir, tarPath, { rootName = null } = {}) {
  const files = walkFiles(sourceDir);
  const chunks = [];
  for (const file of files) {
    const data = fs.readFileSync(file.abs);
    const name = rootName ? `${rootName}/${file.rel}` : file.rel;
    const mode = file.rel.replace(/\\/g, "/").endsWith(".sh") ? 0o755 : 0o644;
    chunks.push(tarHeader(name, data.length, mode));
    chunks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) chunks.push(Buffer.alloc(pad, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  const gzip = zlib.gzipSync(Buffer.concat(chunks), { level: 9 });
  // zlib writes the host OS into byte 9. Use the portable "unknown" value so
  // identical tar contents produce identical release bytes on Windows/Linux.
  gzip[9] = 255;
  fs.writeFileSync(tarPath, gzip);
}
