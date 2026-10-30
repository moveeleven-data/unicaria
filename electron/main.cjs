const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  protocol,
  net,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
let window,
  currentFile,
  pendingOpenFile,
  dirty = false,
  closing = false;
const safeName = (name) =>
  String(name || "Untitled")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .slice(0, 100);
async function atomicWrite(destination, data) {
  const temporary = destination + ".unicaria-tmp";
  try {
    await fs.copyFile(destination, destination + ".bak");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await fs.writeFile(temporary, data);
  await fs.rename(temporary, destination);
}
function verifySender(event) {
  if (!window || event.sender !== window.webContents)
    throw new Error("Unknown renderer.");
}
function command(name) {
  window?.webContents.send("command", name);
}
app.whenReady().then(async () => {
  const root = path.resolve(__dirname, "../dist");
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    const target = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (
      url.hostname !== "unicaria" ||
      !(target === root || target.startsWith(root + path.sep))
    )
      return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(target).href);
  });
  window = new BrowserWindow({
    width: 1540,
    height: 1000,
    minWidth: 1050,
    minHeight: 720,
    backgroundColor: "#eef1ec",
    title: "Unicaria",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://unicaria/")) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  window.on("close", async (event) => {
    if (closing || !dirty) return;
    event.preventDefault();
    const { response } = await dialog.showMessageBox(window, {
      type: "question",
      buttons: ["Keep editing", "Discard changes"],
      defaultId: 0,
      cancelId: 0,
      message: "Close without saving?",
      detail:
        "Your recovery copy is retained. Save the score to keep an ordinary document file.",
    });
    if (response === 1) {
      closing = true;
      window.close();
    }
  });
  ipcMain.handle("open", async (event) => {
    verifySender(event);
    pendingOpenFile = undefined;
    const result = await dialog.showOpenDialog(window, {
      title: "Open Unicaria score",
      filters: [
        {
          name: "Unicaria score",
          extensions: ["unicaria", "counterpoint", "json"],
        },
      ],
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 20_000_000)
      throw new Error("Score exceeds the 20 MB limit.");
    const text = await fs.readFile(file, "utf8");
    pendingOpenFile = file;
    return { text, name: path.basename(file), token: file };
  });
  ipcMain.handle("accept-open", (event, token) => {
    verifySender(event);
    if (typeof token !== "string" || token !== pendingOpenFile)
      throw new Error("Invalid file token.");
    currentFile = token;
    pendingOpenFile = undefined;
    dirty = false;
    return true;
  });
  ipcMain.handle("import-xml", async (event) => {
    verifySender(event);
    const result = await dialog.showOpenDialog(window, {
      title: "Import MusicXML",
      filters: [
        { name: "MusicXML score", extensions: ["musicxml", "xml", "mxl"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await fs.stat(file)).size > 20_000_000)
      throw new Error("MusicXML exceeds 20 MB.");
    return {
      bytes: Array.from(await fs.readFile(file)),
      name: path.basename(file),
    };
  });
  ipcMain.handle("save", async (event, payload) => {
    verifySender(event);
    if (typeof payload.text !== "string" || payload.text.length > 20_000_000)
      throw new Error("Invalid score.");
    let file = payload.saveAs ? undefined : currentFile;
    if (!file) {
      const result = await dialog.showSaveDialog(window, {
        defaultPath: safeName(payload.title) + ".unicaria",
        filters: [{ name: "Unicaria score", extensions: ["unicaria"] }],
      });
      if (result.canceled) return null;
      file = result.filePath;
    }
    await atomicWrite(file, payload.text);
    currentFile = file;
    dirty = false;
    return path.basename(file);
  });
  ipcMain.handle("midi", async (event, payload) => {
    verifySender(event);
    if (
      !Array.isArray(payload.bytes) ||
      payload.bytes.length > 40_000_000 ||
      payload.bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)
    )
      throw new Error("Invalid MIDI data.");
    const result = await dialog.showSaveDialog(window, {
      defaultPath: safeName(payload.title) + ".mid",
      filters: [{ name: "MIDI file", extensions: ["mid"] }],
    });
    if (result.canceled) return null;
    await atomicWrite(result.filePath, Buffer.from(payload.bytes));
    return path.basename(result.filePath);
  });
  ipcMain.handle("recovery-read", async (event) => {
    verifySender(event);
    try {
      return await fs.readFile(
        path.join(app.getPath("userData"), "recovery.json"),
        "utf8",
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // Read the earlier app's recovery in place; never overwrite or remove it.
      try {
        return await fs.readFile(
          path.join(app.getPath("appData"), "Counterpoint", "recovery.json"),
          "utf8",
        );
      } catch (legacyError) {
        if (legacyError.code !== "ENOENT") throw legacyError;
      }
      return null;
    }
  });
  ipcMain.handle("recovery-write", async (event, text) => {
    verifySender(event);
    if (typeof text !== "string" || text.length > 20_000_000)
      throw new Error("Invalid recovery data.");
    await fs.mkdir(app.getPath("userData"), { recursive: true });
    await atomicWrite(
      path.join(app.getPath("userData"), "recovery.json"),
      text,
    );
    return true;
  });
  ipcMain.handle("new-file", (event) => {
    verifySender(event);
    currentFile = undefined;
    dirty = false;
  });
  ipcMain.on("dirty", (event, value) => {
    verifySender(event);
    dirty = !!value;
  });
  ipcMain.handle("print", async (event) => {
    verifySender(event);
    window.webContents.print({ printBackground: true });
  });
  ipcMain.handle("edit-text", (event, action) => {
    verifySender(event);
    if (!["copy", "cut", "paste", "undo", "redo", "selectAll"].includes(action))
      throw new Error("Unknown edit command.");
    window.webContents[action]();
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "File",
        submenu: [
          {
            label: "New score",
            accelerator: "CmdOrCtrl+N",
            click: () => command("new"),
          },
          {
            label: "Open…",
            accelerator: "CmdOrCtrl+O",
            click: () => command("open"),
          },
          {
            label: "Save",
            accelerator: "CmdOrCtrl+S",
            click: () => command("save"),
          },
          {
            label: "Save as…",
            accelerator: "CmdOrCtrl+Shift+S",
            click: () => command("saveAs"),
          },
          {
            label: "Export MIDI…",
            click: () => command("midi"),
          },
          { label: "Import MusicXML…", click: () => command("importXml") },
          { type: "separator" },
          {
            label: "Print / PDF…",
            accelerator: "CmdOrCtrl+P",
            click: () => command("print"),
          },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          {
            label: "Undo",
            accelerator: "CmdOrCtrl+Z",
            click: () => command("undo"),
          },
          {
            label: "Redo",
            accelerator: "CmdOrCtrl+Y",
            click: () => command("redo"),
          },
          { type: "separator" },
          {
            label: "Cut",
            accelerator: "CmdOrCtrl+X",
            click: () => command("cut"),
          },
          {
            label: "Copy",
            accelerator: "CmdOrCtrl+C",
            click: () => command("copy"),
          },
          {
            label: "Paste",
            accelerator: "CmdOrCtrl+V",
            click: () => command("paste"),
          },
          {
            label: "Insert copied music",
            accelerator: "CmdOrCtrl+I",
            click: () => command("pasteInsert"),
          },
          {
            label: "Select all",
            accelerator: "CmdOrCtrl+A",
            click: () => command("selectAll"),
          },
          { label: "Add measures…", click: () => command("addMeasures") },
          { label: "Insert measures…", click: () => command("insertMeasures") },
          { label: "Delete measures", click: () => command("deleteMeasures") },
        ],
      },
      {
        label: "Utilities",
        submenu: [
          { label: "Transpose…", click: () => command("transpose") },
          {
            label: "Fit measures…",
            accelerator: "CmdOrCtrl+M",
            click: () => command("fitMeasures"),
          },
          { label: "Repeat selected music…", click: () => command("repeat") },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            label: "Page / Scroll view",
            accelerator: "CmdOrCtrl+E",
            click: () => command("toggleView"),
          },
          {
            label: "Zoom in",
            accelerator: "CmdOrCtrl+Plus",
            click: () => command("zoomIn"),
          },
          {
            label: "Zoom out",
            accelerator: "CmdOrCtrl+-",
            click: () => command("zoomOut"),
          },
          {
            label: "Go to measure…",
            accelerator: "CmdOrCtrl+G",
            click: () => command("goTo"),
          },
          { role: "togglefullscreen" },
          {
            label: "Keyboard guide",
            accelerator: "F1",
            click: () => command("help"),
          },
        ],
      },
      {
        label: "Document",
        submenu: [
          { label: "Title and composer…", click: () => command("document") },
          {
            label: "Time and key signature…",
            click: () => command("measureSettings"),
          },
          { label: "Page layout…", click: () => command("pageLayout") },
        ],
      },
      {
        label: "MIDI/Audio",
        submenu: [
          { label: "Play / stop", click: () => command("play") },
          { label: "Pause", click: () => command("pause") },
          { label: "All notes off", click: () => command("stop") },
          {
            label: "ScoreManager / mixer…",
            click: () => command("instruments"),
          },
        ],
      },
      {
        label: "Tools",
        submenu: [
          ["Selection", "select"],
          ["Staff", "staff"],
          ["Key Signature", "key"],
          ["Time Signature", "time"],
          ["Clef", "clef"],
          ["Measure", "measure"],
          ["Simple Entry", "write"],
          ["Speedy Entry", "speedy"],
          ["Articulation", "articulation"],
          ["Expression", "expression"],
          ["Slur", "slur"],
          ["Hand", "hand"],
          ["Zoom", "zoom"],
        ].map(([label, action]) => ({ label, click: () => command(action) })),
      },
      {
        label: "Window",
        submenu: [
          ["Main Tool Palette", "mainPalette"],
          ["Playback Controls", "playbackControls"],
          ["Simple Entry Palette", "notePalette"],
          ["Simple Entry Rests Palette", "restPalette"],
          ["Notation inspector", "inspector"],
        ].map(([label, action]) => ({ label, click: () => command(action) })),
      },
    ]),
  );
  await window.loadURL("app://unicaria/index.html");
});
app.on("window-all-closed", () => app.quit());
