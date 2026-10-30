const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  open: () => ipcRenderer.invoke("open"),
  importXml: () => ipcRenderer.invoke("import-xml"),
  acceptOpen: (token) => ipcRenderer.invoke("accept-open", token),
  save: (payload) => ipcRenderer.invoke("save", payload),
  midi: (payload) => ipcRenderer.invoke("midi", payload),
  recoveryRead: () => ipcRenderer.invoke("recovery-read"),
  recoveryWrite: (text) => ipcRenderer.invoke("recovery-write", text),
  newFile: () => ipcRenderer.invoke("new-file"),
  dirty: (value) => ipcRenderer.send("dirty", value),
  print: () => ipcRenderer.invoke("print"),
  editText: (command) => ipcRenderer.invoke("edit-text", command),
  onCommand: (callback) => {
    const listener = (_event, name) => callback(name);
    ipcRenderer.on("command", listener);
    return () => ipcRenderer.removeListener("command", listener);
  },
});
