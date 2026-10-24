import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
let handlers: Map<string, (...args: any[]) => any>;
let directory: string, window: any, dialog: any, route: any, net: any;
beforeEach(async () => {
  const base = path.resolve("artifacts/verification/desktop-tests");
  await mkdir(base, { recursive: true });
  directory = await mkdtemp(path.join(base, "run-"));
  handlers = new Map();
  dialog = {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  };
  net = { fetch: vi.fn(async () => new Response("asset")) };
  let ready: Promise<void> | undefined;
  const electron = {
    app: {
      whenReady: () => ({
        then: (callback: () => Promise<void>) => {
          ready = callback();
        },
      }),
      getPath: () => directory,
      on: vi.fn(),
      quit: vi.fn(),
    },
    BrowserWindow: class {
      webContents = {
        setWindowOpenHandler: vi.fn(),
        on: vi.fn(),
        send: vi.fn(),
        print: vi.fn(),
        copy: vi.fn(),
        paste: vi.fn(),
        cut: vi.fn(),
        undo: vi.fn(),
        redo: vi.fn(),
      };
      on = vi.fn();
      once = vi.fn();
      show = vi.fn();
      close = vi.fn();
      loadURL = vi.fn(async () => {});
      constructor() {
        window = this;
      }
    },
    Menu: {
      buildFromTemplate: (template: unknown) => template,
      setApplicationMenu: vi.fn(),
    },
    ipcMain: {
      handle: (name: string, fn: (...args: any[]) => any) =>
        handlers.set(name, fn),
      on: vi.fn(),
    },
    protocol: {
      registerSchemesAsPrivileged: vi.fn(),
      handle: (_name: string, fn: unknown) => {
        route = fn;
      },
    },
    dialog,
    net,
  };
  const main = await readFile("electron/main.cjs", "utf8");
  runInNewContext(main, {
    require: (name: string) => (name === "electron" ? electron : require(name)),
    __dirname: path.resolve("electron"),
    URL,
    Response,
    Buffer,
  });
  await ready;
});
const invoke = (name: string, ...args: any[]) =>
  handlers.get(name)!({ sender: window.webContents }, ...args);

describe("desktop file boundary", () => {
  it("uses the Unicaria name and extension in save dialogs", async () => {
    dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    await invoke("save", { title: "Study", text: "{}", saveAs: true });
    expect(dialog.showSaveDialog.mock.calls[0][1]).toMatchObject({
      defaultPath: "Study.unicaria",
      filters: [{ name: "Unicaria score", extensions: ["unicaria"] }],
    });
    expect(window.loadURL).toHaveBeenCalledWith("app://unicaria/index.html");
  });
  it("reads legacy recovery without moving it, and prefers a newer recovery", async () => {
    const oldDirectory = path.join(directory, "Counterpoint");
    await mkdir(oldDirectory);
    const oldFile = path.join(oldDirectory, "recovery.json");
    await writeFile(oldFile, '{"old":true}');
    expect(await invoke("recovery-read")).toBe('{"old":true}');
    await invoke("recovery-write", '{"new":true}');
    expect(await invoke("recovery-read")).toBe('{"new":true}');
    expect(await readFile(oldFile, "utf8")).toBe('{"old":true}');
  });
  it("keeps the save destination after a canceled Save as", async () => {
    const file = path.join(directory, "original.unicaria");
    dialog.showSaveDialog
      .mockResolvedValueOnce({ canceled: false, filePath: file })
      .mockResolvedValueOnce({ canceled: true });
    await invoke("save", { title: "Study", text: "first", saveAs: false });
    expect(
      await invoke("save", { title: "Study", text: "second", saveAs: true }),
    ).toBeNull();
    await invoke("save", { title: "Study", text: "third", saveAs: false });
    expect(await readFile(file, "utf8")).toBe("third");
    expect(await readFile(file + ".bak", "utf8")).toBe("first");
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(2);
  });
  it("does not reuse an old open token after a canceled Open", async () => {
    const file = path.join(directory, "original.unicaria");
    await writeFile(file, "{}");
    dialog.showOpenDialog
      .mockResolvedValueOnce({ canceled: false, filePaths: [file] })
      .mockResolvedValueOnce({ canceled: true });
    const first = await invoke("open");
    expect(await invoke("open")).toBeNull();
    expect(() => invoke("accept-open", first.token)).toThrow(
      "Invalid file token",
    );
  });
  it("saves and reopens the exact document and retains the previous revision", async () => {
    const file = path.join(directory, "study.unicaria");
    dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: file,
    });
    await invoke("save", {
      title: "Study",
      text: '{"revision":1}',
      saveAs: false,
    });
    await invoke("save", {
      title: "Study",
      text: '{"revision":2}',
      saveAs: false,
    });
    expect(await readFile(file, "utf8")).toBe('{"revision":2}');
    expect(await readFile(file + ".bak", "utf8")).toBe('{"revision":1}');
    dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [file],
    });
    const opened = await invoke("open");
    expect(opened.text).toBe('{"revision":2}');
    expect(invoke("accept-open", opened.token)).toBe(true);
  });
  it("does not let a renderer nominate an arbitrary save path", () => {
    expect(() =>
      invoke("accept-open", path.join(directory, "unselected.txt")),
    ).toThrow("Invalid file token");
  });
  it("accepts an open token only once", async () => {
    const file = path.join(directory, "valid.unicaria");
    await writeFile(file, "{}");
    dialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: [file],
    });
    const opened = await invoke("open");
    invoke("accept-open", opened.token);
    expect(() => invoke("accept-open", opened.token)).toThrow(
      "Invalid file token",
    );
  });
  it("cancels saving without writing a file", async () => {
    dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(
      await invoke("save", { title: "Study", text: "{}", saveAs: false }),
    ).toBeNull();
  });
  it("rejects IPC from a different renderer", async () => {
    await expect(
      handlers.get("save")!({ sender: {} }, { text: "{}" }),
    ).rejects.toThrow("Unknown renderer");
  });
  it("writes MIDI bytes without text conversion", async () => {
    const file = path.join(directory, "study.mid");
    dialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: file,
    });
    const bytes = [77, 84, 104, 100, 0, 255, 128];
    await invoke("midi", { title: "Study", bytes });
    expect([...(await readFile(file))]).toEqual(bytes);
  });
  it("rejects malformed MIDI before opening a save dialog", async () => {
    await expect(invoke("midi", { bytes: [256, -1] })).rejects.toThrow(
      "Invalid MIDI",
    );
    expect(dialog.showSaveDialog).not.toHaveBeenCalled();
  });
  it("round-trips recovery independently of the current document", async () => {
    expect(await invoke("recovery-read")).toBeNull();
    await invoke("recovery-write", '{"recovered":true}');
    expect(await invoke("recovery-read")).toBe('{"recovered":true}');
  });
  it("serves the bundled app and rejects encoded path traversal", async () => {
    expect((await route({ url: "app://unicaria/index.html" })).status).toBe(
      200,
    );
    expect(net.fetch).toHaveBeenCalled();
    net.fetch.mockClear();
    expect(
      (await route({ url: "app://unicaria/..%2F..%2Foutside.txt" })).status,
    ).toBe(404);
    expect(net.fetch).not.toHaveBeenCalled();
  });
});
