import { parseScore } from "../core/validation";
import type { Score } from "../core/model";
import { exportMidi } from "./midi";
import {
  decodeMusicXml,
  importMusicXml,
  type MusicXmlResult,
} from "./musicxml";
declare global {
  interface Window {
    desktop?: {
      open(): Promise<{ text: string; name: string; token: string } | null>;
      importXml?(): Promise<{ bytes: number[]; name: string } | null>;
      acceptOpen(token: string): Promise<void>;
      save(payload: {
        text: string;
        title: string;
        saveAs: boolean;
      }): Promise<string | null>;
      midi(payload: { title: string; bytes: number[] }): Promise<string | null>;
      recoveryRead(): Promise<string | null>;
      recoveryWrite(text: string): Promise<void>;
      newFile(): Promise<void>;
      dirty(value: boolean): void;
      print(): Promise<void>;
      editText(command: string): Promise<void>;
      onCommand(callback: (name: string) => void): () => void;
    };
  }
}
export async function importXmlDocument(): Promise<MusicXmlResult | undefined> {
  if (window.desktop?.importXml) {
    const file = await window.desktop.importXml();
    return file
      ? importMusicXml(decodeMusicXml(new Uint8Array(file.bytes)))
      : undefined;
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".musicxml,.xml,.mxl";
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) {
          resolve(undefined);
          return;
        }
        if (file.size > 20_000_000) throw new Error("MusicXML exceeds 20 MB.");
        resolve(
          importMusicXml(
            decodeMusicXml(new Uint8Array(await file.arrayBuffer())),
          ),
        );
      } catch (error) {
        reject(error);
      }
    };
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}
function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function openDocument(): Promise<Score | undefined> {
  if (window.desktop) {
    const file = await window.desktop.open();
    if (!file) return;
    const score = parseScore(file.text);
    await window.desktop.acceptOpen(file.token);
    return score;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".unicaria,.counterpoint,.json";
    input.onchange = async () => {
      try {
        if (input.files?.[0]) resolve(parseScore(await input.files[0].text()));
        else resolve(undefined);
      } catch (error) {
        alert(String(error));
        resolve(undefined);
      }
    };
    input.oncancel = () => resolve(undefined);
    input.click();
  });
}
export async function saveDocument(score: Score, saveAs = false) {
  const text = JSON.stringify(score, null, 2);
  if (window.desktop)
    return window.desktop.save({ text, title: score.title, saveAs });
  download(text, `${score.title || "Untitled"}.unicaria`, "application/json");
  return score.title;
}
export async function saveMidi(score: Score) {
  const result = exportMidi(score);
  const name = window.desktop
    ? await window.desktop.midi({
        title: score.title,
        bytes: Array.from(result.bytes),
      })
    : (download(
        result.bytes.buffer as ArrayBuffer,
        `${score.title || "Untitled"}.mid`,
        "audio/midi",
      ),
      score.title);
  return { name, ...result };
}
export async function recoveryRead() {
  const text = window.desktop
    ? await window.desktop.recoveryRead()
    : (localStorage.getItem("unicaria-recovery") ??
      localStorage.getItem("counterpoint-recovery"));
  if (!text) return;
  try {
    return parseScore(text);
  } catch {
    return;
  }
}
export async function recoveryWrite(score: Score) {
  const text = JSON.stringify(score);
  if (window.desktop) await window.desktop.recoveryWrite(text);
  else localStorage.setItem("unicaria-recovery", text);
}
