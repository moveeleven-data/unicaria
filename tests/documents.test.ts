// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blankScore } from "../src/core/model";
import { parseScore } from "../src/core/validation";
import {
  openDocument,
  recoveryRead,
  recoveryWrite,
  saveDocument,
} from "../src/files/documents";
beforeEach(() => {
  localStorage.clear();
  delete window.desktop;
});
afterEach(() => {
  delete window.desktop;
});
describe("Unicaria document compatibility", () => {
  it("normalizes the original format without changing any music", () => {
    const score = blankScore();
    const old = { ...score, format: "counterpoint" };
    expect(parseScore(JSON.stringify(old))).toEqual(score);
  });
  it("rejects unsupported future versions even with the old format name", () => {
    expect(() =>
      parseScore(
        JSON.stringify({ ...blankScore(), format: "counterpoint", version: 2 }),
      ),
    ).toThrow("unsupported");
  });
  it("uses the new format for a save and reopen round trip", async () => {
    const score = blankScore(),
      save = vi.fn(async (_payload: { text: string }) => "Study.unicaria");
    window.desktop = { save } as any;
    await saveDocument(score);
    expect(parseScore(save.mock.calls[0][0].text)).toEqual(score);
    expect(JSON.parse(save.mock.calls[0][0].text).format).toBe("unicaria");
  });
  it("recovers an older browser score and saves new recovery separately", async () => {
    const score = blankScore();
    const old = JSON.stringify({ ...score, format: "counterpoint" });
    localStorage.setItem("counterpoint-recovery", old);
    expect(await recoveryRead()).toEqual(score);
    score.title = "New work";
    await recoveryWrite(score);
    expect(await recoveryRead()).toEqual(score);
    expect(localStorage.getItem("counterpoint-recovery")).toBe(old);
  });
  it("does not accept the file token until the complete score is validated", async () => {
    const acceptOpen = vi.fn();
    window.desktop = {
      open: async () => ({
        text: '{"format":"unicaria"}',
        token: "not-accepted",
      }),
      acceptOpen,
    } as any;
    await expect(openDocument()).rejects.toThrow();
    expect(acceptOpen).not.toHaveBeenCalled();
  });
  it("ignores a corrupt recovery copy", async () => {
    localStorage.setItem("unicaria-recovery", "{broken");
    expect(await recoveryRead()).toBeUndefined();
  });
});
