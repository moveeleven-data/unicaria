import { packager } from "@electron/packager";
import {
  mkdir,
  copyFile,
  writeFile,
  readdir,
  readFile,
  mkdtemp,
  rm,
} from "node:fs/promises";
import path from "node:path";
const artifacts = path.resolve("artifacts");
await mkdir(artifacts, { recursive: true });
// A fresh stage prevents obsolete bundles from entering the renamed package.
const stage = await mkdtemp(path.join(artifacts, "package-"));
const manifest = JSON.parse(await readFile("package.json", "utf8"));
await mkdir(path.join(stage, "electron"), { recursive: true });
async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const item of await readdir(from, { withFileTypes: true })) {
    const source = path.join(from, item.name),
      dest = path.join(to, item.name);
    if (item.isDirectory()) await copyTree(source, dest);
    else await copyFile(source, dest);
  }
}
await copyTree("dist", path.join(stage, "dist"));
await copyTree("electron", path.join(stage, "electron"));
await writeFile(
  path.join(stage, "package.json"),
  JSON.stringify({
    name: "unicaria",
    productName: "Unicaria",
    version: manifest.version,
    main: "electron/main.cjs",
    description: "Local music notation and harmonic audition",
    author: "Unicaria",
  }),
);
const output = await packager({
  dir: stage,
  name: "Unicaria",
  platform: "win32",
  arch: "x64",
  out: path.resolve("../Unicaria-Windows"),
  overwrite: true,
  asar: true,
  prune: true,
  electronVersion: "45.0.0",
  win32metadata: {
    CompanyName: "Unicaria",
    FileDescription: "Unicaria music notation",
    ProductName: "Unicaria",
  },
});
console.log(output.join("\n"));
for (const directory of output) {
  await copyFile("README.md", path.join(directory, "README.md"));
  await copyFile(
    "public/THIRD-PARTY-NOTICES.txt",
    path.join(directory, "THIRD-PARTY-NOTICES.txt"),
  );
  await copyFile(
    "public/GeneralUser-LICENSE.txt",
    path.join(directory, "GeneralUser-LICENSE.txt"),
  );
}
if (!stage.startsWith(artifacts + path.sep))
  throw new Error("Unexpected staging path");
await rm(stage, { recursive: true, force: true });
