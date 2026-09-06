import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createTestRoot } from "../helpers/copy-fixture.mjs";
import { validateArchivePath, extractEntries, readZipEntries, readTarGzEntries } from "../../tools/lib/archive-read.mjs";
import { writeZipFromDirectory as writeZip, writeTarGzFromDirectory as writeTarGz } from "../../tools/lib/zip-write.mjs";
import { assertWellFormedXml, acceptSvgFile } from "../../tools/lib/svg-accept.mjs";

test("archive entries are all validated before extraction writes", (t) => {
  const root = createTestRoot("archive-unsafe", t);
  for (const name of ["../outside", "/absolute", "a/../../escape", "a\\b", "C:/abs", "a:ads", "a//b", "NUL.txt", "a/COM1", "a."]) {
    assert.throws(() => validateArchivePath(name));
    const dest = path.join(root, "extracted");
    assert.throws(() => extractEntries([
      { name: "paperclip-ru/safe.txt", data: Buffer.from("first") },
      { name, data: Buffer.from("bad") },
    ], dest));
    assert.equal(fs.existsSync(dest), false);
  }
  for (const names of [["a", "A"], ["a", "a/b"]]) {
    assert.throws(() => extractEntries(names.map((name) => ({ name, data: Buffer.alloc(0) })), path.join(root, "duplicate")));
    assert.equal(fs.existsSync(path.join(root, "duplicate")), false);
  }
});

test("ZIP CRC and TAR checksum reject damaged final bytes", (t) => {
  const root = createTestRoot("archive-corrupt", t);
  const payload = path.join(root, "payload");
  fs.mkdirSync(payload);
  fs.writeFileSync(path.join(payload, "sample.txt"), "release bytes");
  const zip = path.join(root, "test.zip");
  const tar = path.join(root, "test.tar.gz");
  writeZip(payload, zip, { rootName: "paperclip-ru" });
  writeTarGz(payload, tar, { rootName: "paperclip-ru" });
  assert.equal(readZipEntries(zip)[0].data.toString(), "release bytes");
  assert.equal(readTarGzEntries(tar)[0].data.toString(), "release bytes");
  const bytes = fs.readFileSync(zip);
  bytes[30 + bytes.readUInt16LE(26)] ^= 255;
  fs.writeFileSync(zip, bytes);
  assert.throws(() => readZipEntries(zip));
  const damaged = fs.readFileSync(tar);
  damaged[damaged.length - 8] ^= 255;
  fs.writeFileSync(tar, damaged);
  assert.throws(() => readTarGzEntries(tar));
});

const svg = (content) => `<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`;
test("SVG acceptance uses XML grammar, namespaces and strict UTF-8", (t) => {
  assert.doesNotThrow(() => assertWellFormedXml(svg('<!-- Проверка > --><text x="0">Русский &amp; &#x41;</text>')));
  for (const text of [svg('<text x="0" x="1"/>'), svg("<text>bare &</text>"), svg('<text x="unterminated/>'),
    svg("<g><text></g></text>"), svg("<x:unknown/>"), svg("<script/>"), svg('<image href="https://example.com/x.png"/>'),
    '<!DOCTYPE svg [<!ENTITY x "test">]>' + svg("<text>&x;</text>"), "<svg/>", svg("<text>\u0001</text>")]) {
    assert.throws(() => assertWellFormedXml(text), text);
  }
  const file = path.join(createTestRoot("svg-utf8", t), "bad.svg");
  fs.writeFileSync(file, Buffer.concat([Buffer.from(svg("")), Buffer.from([0xc0, 0xaf])]));
  assert.throws(() => acceptSvgFile(file));
});
