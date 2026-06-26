import { readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve } from "path";

const distDir = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(distDir, "package.json"), "utf-8"));
const version = pkg.version;

const platforms = [];

for (const file of readdirSync(distDir)) {
  if (file.endsWith(".dmg")) {
    const sig = readFileSync(file.replace(/\.dmg$/, ".app.tar.gz.sig"), "utf-8").trim();
    platforms.push({
      url: `https://github.com/AJSubrizi/OhCanvas/releases/latest/download/${file}`,
      signature: sig,
      platform: file.includes("aarch64") ? "darwin-aarch64" : "darwin-x86_64",
    });
  }
  if (file.endsWith(".msi") || file.endsWith(".exe")) {
    const sigPath = file.endsWith(".msi")
      ? file.replace(/\.msi$/, ".msi.sig")
      : file.replace(/\.exe$/, ".exe.sig");
    const sig = readFileSync(resolve(distDir, sigPath), "utf-8").trim();
    platforms.push({
      url: `https://github.com/AJSubrizi/OhCanvas/releases/latest/download/${file}`,
      signature: sig,
      platform: "windows-x86_64",
    });
  }
}

const update = {
  version,
  pub_date: new Date().toISOString(),
  platforms: Object.fromEntries(platforms.map((p) => [p.platform, { url: p.url, signature: p.signature }])),
};

writeFileSync(resolve(distDir, "latest-release.json"), JSON.stringify(update, null, 2));
console.log(`Generated latest-release.json for v${version}:`, JSON.stringify(update, null, 2));
