import { readFileSync, readdirSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const distDir = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(distDir, "package.json"), "utf-8"));
const version = pkg.version;

const platforms = [];
const files = readdirSync(distDir).filter(f => f !== "latest-release.json");
console.log(`Files in dist: ${JSON.stringify(files)}`);

for (const file of files) {
  // macOS: .app.tar.gz is the updater archive, .app.tar.gz.sig is its signature
  // After flatten: OhCanvas_0.1.0_{arch}.app.tar.gz
  if (file.endsWith(".app.tar.gz") && !file.endsWith(".sig")) {
    const sigFile = `${file}.sig`;
    if (!existsSync(resolve(distDir, sigFile))) {
      console.log(`WARN: missing signature file ${sigFile}, skipping ${file}`);
      continue;
    }
    const sig = readFileSync(resolve(distDir, sigFile), "utf-8").trim();
    const arch = file.includes("aarch64") ? "darwin-aarch64" : "darwin-x86_64";
    platforms.push({
      url: `https://github.com/AJSubrizi/OhCanvas/releases/latest/download/${file}`,
      signature: sig,
      platform: arch,
    });
    console.log(`Added macOS platform: ${arch}`);
  }
  // Windows: .msi is the installer, .msi.sig is its signature
  // After flatten: OhCanvas_0.1.0_x64_en-US.msi
  if (file.match(/\.msi$/i) && !file.endsWith(".sig")) {
    const sigFile = file.replace(/\.msi$/i, ".msi.sig");
    if (!existsSync(resolve(distDir, sigFile))) {
      console.log(`WARN: missing signature file ${sigFile}, skipping ${file}`);
      continue;
    }
    const sig = readFileSync(resolve(distDir, sigFile), "utf-8").trim();
    platforms.push({
      url: `https://github.com/AJSubrizi/OhCanvas/releases/latest/download/${file}`,
      signature: sig,
      platform: "windows-x86_64",
    });
    console.log(`Added Windows platform: windows-x86_64`);
  }
}

if (platforms.length === 0) {
  console.log("WARN: no updater platforms found, generating empty latest-release.json");
}

const update = {
  version,
  pub_date: new Date().toISOString(),
  platforms: Object.fromEntries(platforms.map((p) => [p.platform, { url: p.url, signature: p.signature }])),
};

writeFileSync(resolve(distDir, "latest-release.json"), JSON.stringify(update, null, 2));
console.log(`Generated latest-release.json for v${version}:`, JSON.stringify(update, null, 2));
