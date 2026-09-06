import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SaxesParser } from "saxes";

function decodeUtf8(buf) {
  return new TextDecoder("utf-8", { fatal: true }).decode(buf);
}

export function assertWellFormedXml(text, file = "svg") {
  const parser = new SaxesParser({ xmlns: true, fileName: file });
  let rootSeen = false;
  parser.on("doctype", () => { throw new Error(`SVG: DTD is not allowed (${file})`); });
  parser.on("opentag", (node) => {
    if (!rootSeen) {
      rootSeen = true;
      if (node.local !== "svg" || node.uri !== "http://www.w3.org/2000/svg") {
        throw new Error(`SVG: expected SVG namespace and root (${file})`);
      }
    }
    if (node.local === "script" || node.local === "foreignObject") {
      throw new Error(`SVG: active content is not allowed (${file})`);
    }
    for (const attr of Object.values(node.attributes)) {
      if (/^on/i.test(attr.local) || (attr.local === "href" && !attr.value.startsWith("#"))) {
        throw new Error(`SVG: active or external attribute (${file})`);
      }
    }
  });
  parser.write(text).close();
}

export function acceptSvgFile(file) {
  const buf = fs.readFileSync(file);
  const text = decodeUtf8(buf);
  assertWellFormedXml(text, file);
  return text;
}

export function acceptSvgTree(root) {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dist") continue;
        walk(p);
      } else if (ent.name.toLowerCase().endsWith(".svg")) {
        files.push(p);
        acceptSvgFile(p);
      }
    }
  };
  walk(root);
  return files;
}

export async function renderSvgs(files) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (err) {
    throw new Error(`SVG headless render требует playwright: ${err.message}`);
  }
  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true, channel: "chromium" });
  } catch (err) {
    throw new Error(`SVG headless render: Chromium недоступен: ${err.message}`);
  }
  try {
    const page = await browser.newPage();
    for (const file of files) {
      acceptSvgFile(file);
      const errors = [];
      page.removeAllListeners("pageerror");
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
      const rendered = await page.evaluate(() => {
        const root = document.documentElement;
        const box = root.getBoundingClientRect();
        return document.contentType === "image/svg+xml" && root.localName === "svg"
          && !document.querySelector("parsererror") && box.width > 0 && box.height > 0;
      });
      if (!rendered || errors.length) throw new Error(`SVG: XML render failed (${file})`);
      await page.screenshot();

    }
  } finally {
    await browser.close();
  }
}

export async function assertSvgAccepted(root) {
  const files = acceptSvgTree(root);
  if (files.length) await renderSvgs(files);
  return files;
}
