// JARVIS desktop shell: opens the published JARVIS app in its own window (no browser needed).
const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");

const APP_URL = "https://trusty-desktop-companion.lovable.app";
const APP_ORIGIN = new URL(APP_URL).origin;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "JARVIS",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: "#0b1220",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Links to other sites open in the normal browser, never inside JARVIS.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== APP_ORIGIN) { e.preventDefault(); shell.openExternal(url); }
  });
  // Allow microphone for voice; deny everything else.
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === "media"));
  win.loadURL(APP_URL).catch(() =>
    win.loadURL("data:text/html,<body style='background:%230b1220;color:%23cfe;font-family:sans-serif;padding:40px'><h2>JARVIS is offline</h2><p>Check your internet connection and reopen the app.</p></body>")
  );
}

Menu.setApplicationMenu(null);
app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit()); // clean shutdown
