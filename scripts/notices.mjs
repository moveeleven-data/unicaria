import { readFile, writeFile } from "node:fs/promises";

const dependencies = [
  ["React", "node_modules/react/LICENSE"],
  ["React DOM", "node_modules/react-dom/LICENSE"],
  ["React Scheduler", "node_modules/scheduler/LICENSE"],
  ["VexFlow", "node_modules/vexflow/LICENSE"],
  ["fflate", "node_modules/fflate/LICENSE"],
  ["SpessaSynth Core", "node_modules/spessasynth_core/LICENSE"],
  ["stb-vorbis", "node_modules/stb-vorbis/LICENSE"],
  ["Bravura music font", "node_modules/@vexflow-fonts/bravura/LICENSE.txt"],
  ["Academico text fonts", "node_modules/@vexflow-fonts/academico/LICENSE.txt"],
  ["GeneralUser GS soundbank", "public/GeneralUser-LICENSE.txt"],
];
let notices =
  "Unicaria — third-party notices\n\nThe standalone application also contains Electron and Chromium. Their license files are distributed beside Unicaria.exe. The soundbank and font packages are unmodified.\n\n";
for (const [name, file] of dependencies)
  notices += `${"=".repeat(72)}\n${name}\n${"=".repeat(72)}\n\n${await readFile(file, "utf8")}\n\n`;
await writeFile("public/THIRD-PARTY-NOTICES.txt", notices);
