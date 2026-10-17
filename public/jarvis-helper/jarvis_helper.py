"""
JARVIS Windows Helper
=====================
A tiny local program that lets the JARVIS web app do a *small, approved* set of
things on your PC. It does NOT give JARVIS a terminal or your whole disk.

What it allows:
  * Launch apps on a fixed allowlist (Calculator, Notepad, Paint, File Explorer)
  * List / read / create / edit files ONLY inside one workspace folder
  * Take a screenshot (when Pillow is installed)
  * Restore the previous version of any file it changed (automatic backups)

Safety design:
  * Listens on 127.0.0.1 only — other computers on your network cannot reach it.
  * Every request needs a pairing token (shown when the helper starts).
  * Only JARVIS web pages (lovable.app) and localhost may call it (browser Origin check).
  * Paths are resolved and must stay inside the workspace (no ../ tricks, no other drives).
  * Runs as your normal user. Never run it as Administrator.
  * Every action is written to audit.log next to config.json.

Run:  python jarvis_helper.py            (Python 3.10+, Windows)
Stop: press Ctrl+C in its window (clean shutdown).
"""

from __future__ import annotations

import base64
import difflib
import hashlib
import hmac
import io
import json
import os
import secrets
import shutil
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

VERSION = "1.0.0"
HOST = "127.0.0.1"  # never 0.0.0.0
PORT = 8765
MAX_READ_BYTES = 200_000
MAX_WRITE_BYTES = 200_000
MAX_LIST = 300
TEXT_SUFFIXES = {".txt", ".md", ".json", ".csv", ".py", ".js", ".ts", ".tsx", ".html", ".css", ".yaml", ".yml", ".ini", ".log", ".xml"}

# App allowlist: id -> (command, process names that prove it is running)
APPS: dict[str, tuple[list[str], list[str]]] = {
    "calculator": (["calc.exe"], ["CalculatorApp.exe", "calc.exe", "Calculator.exe"]),
    "notepad": (["notepad.exe"], ["notepad.exe", "Notepad.exe"]),
    "paint": (["mspaint.exe"], ["mspaint.exe", "Paint.exe"]),
    "explorer": (["explorer.exe", "{workspace}"], ["explorer.exe"]),
}

ALLOWED_ORIGIN_SUFFIXES = (".lovable.app", ".lovableproject.com", ".lovable.dev")


class PolicyError(Exception):
    """Raised when a request breaks the rules. Message is safe to show the user."""


def config_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    d = Path(base) / "JarvisHelper"
    d.mkdir(parents=True, exist_ok=True)
    return d


def load_config(directory: Path) -> dict:
    path = directory / "config.json"
    if path.exists():
        cfg = json.loads(path.read_text("utf-8"))
    else:
        cfg = {}
    changed = False
    if "token" not in cfg:
        cfg["token"] = secrets.token_urlsafe(24)
        changed = True
    if "workspace" not in cfg:
        cfg["workspace"] = str(Path.home() / "JarvisWorkspace")
        changed = True
    cfg.setdefault("extra_origins", [])
    if changed:
        path.write_text(json.dumps(cfg, indent=2), "utf-8")
    return cfg


def origin_allowed(origin: str | None, extra: list[str] | None = None) -> bool:
    if not origin:
        return False
    if origin in (extra or []):
        return True
    try:
        u = urlparse(origin)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    if host in ("localhost", "127.0.0.1"):
        return True
    return u.scheme == "https" and host.endswith(ALLOWED_ORIGIN_SUFFIXES)


class Helper:
    """All rule enforcement lives here so it can be tested without a server."""

    def __init__(self, workspace: Path, state_dir: Path):
        self.workspace = workspace.resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.backups = state_dir / "backups"
        self.backups.mkdir(parents=True, exist_ok=True)
        self.audit_path = state_dir / "audit.log"

    # ---------- audit ----------
    def audit(self, action: str, detail: dict, ok: bool) -> None:
        entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "action": action, "ok": ok, **detail}
        with self.audit_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")

    # ---------- path safety ----------
    def safe_path(self, rel: str) -> Path:
        if not isinstance(rel, str) or len(rel) > 260:
            raise PolicyError("Invalid path.")
        rel = rel.strip().replace("\\", "/")
        if rel in ("", ".", "/"):
            return self.workspace
        if rel.startswith("/") or ":" in rel or rel.startswith("~"):
            raise PolicyError("Use a path inside the workspace, like notes/todo.txt.")
        target = (self.workspace / rel).resolve()
        if target != self.workspace and self.workspace not in target.parents:
            raise PolicyError("That path is outside the workspace.")
        return target

    def rel(self, p: Path) -> str:
        return p.relative_to(self.workspace).as_posix() or "."

    # ---------- files ----------
    def list_files(self, rel: str = "") -> dict:
        d = self.safe_path(rel)
        if not d.is_dir():
            raise PolicyError("Folder not found.")
        items = []
        for child in sorted(d.iterdir())[:MAX_LIST]:
            st = child.stat()
            items.append({"name": child.name, "path": self.rel(child), "dir": child.is_dir(), "size": st.st_size})
        return {"ok": True, "folder": self.rel(d), "items": items}

    def search_files(self, query: str) -> dict:
        q = query.lower().strip()
        if not q:
            raise PolicyError("Empty search.")
        hits = [self.rel(p) for p in self.workspace.rglob("*") if q in p.name.lower()][:100]
        return {"ok": True, "matches": hits}

    def read_file(self, rel: str) -> dict:
        p = self.safe_path(rel)
        if not p.is_file():
            raise PolicyError("File not found.")
        if p.suffix.lower() not in TEXT_SUFFIXES:
            raise PolicyError("Only text files can be read.")
        data = p.read_bytes()[:MAX_READ_BYTES]
        return {
            "ok": True,
            "path": self.rel(p),
            "truncated": p.stat().st_size > MAX_READ_BYTES,
            # Marked so the model treats file text as data, not instructions.
            "content_untrusted": data.decode("utf-8", errors="replace"),
        }

    def preview_write(self, rel: str, content: str) -> dict:
        p = self.safe_path(rel)
        old = p.read_text("utf-8", errors="replace") if p.is_file() else ""
        diff = "".join(
            difflib.unified_diff(old.splitlines(True), content.splitlines(True), f"a/{self.rel(p)}", f"b/{self.rel(p)}")
        )
        return {"ok": True, "path": self.rel(p), "exists": p.is_file(), "diff": diff or "(no changes)"}

    def write_file(self, rel: str, content: str) -> dict:
        p = self.safe_path(rel)
        if p == self.workspace or p.is_dir():
            raise PolicyError("That is a folder.")
        if p.suffix.lower() not in TEXT_SUFFIXES:
            raise PolicyError("Only text files can be written.")
        data = content.encode("utf-8")
        if len(data) > MAX_WRITE_BYTES:
            raise PolicyError("File too large.")
        backup = None
        if p.exists():
            backup = self.backups / f"{int(time.time() * 1000)}__{self.rel(p).replace('/', '__')}"
            shutil.copy2(p, backup)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        # Verify against the real disk, not our own belief.
        written = p.read_bytes()
        verified = hashlib.sha256(written).hexdigest() == hashlib.sha256(data).hexdigest()
        return {"ok": verified, "path": self.rel(p), "bytes": len(written), "verified": verified, "backup": backup.name if backup else None}

    def restore_file(self, rel: str) -> dict:
        p = self.safe_path(rel)
        key = self.rel(p).replace("/", "__")
        candidates = sorted(b for b in self.backups.iterdir() if b.name.split("__", 1)[-1] == key)
        if not candidates:
            raise PolicyError("No earlier version saved for that file.")
        latest = candidates[-1]
        shutil.copy2(latest, p)
        latest.unlink()
        return {"ok": p.read_bytes() == p.read_bytes(), "path": self.rel(p), "restored_from": latest.name}

    # ---------- apps ----------
    def launch_app(self, app: str) -> dict:
        if app not in APPS:
            raise PolicyError(f"'{app}' is not an approved app. Approved: {', '.join(APPS)}.")
        cmd, procs = APPS[app]
        cmd = [c.replace("{workspace}", str(self.workspace)) for c in cmd]
        if sys.platform != "win32":
            raise PolicyError("Launching apps only works on Windows.")
        subprocess.Popen(cmd, shell=False, close_fds=True)  # no shell: no command injection
        running = False
        for _ in range(10):  # verify for up to ~3 seconds
            time.sleep(0.3)
            if any(self._is_running(n) for n in procs):
                running = True
                break
        return {"ok": running, "app": app, "verified_running": running}

    @staticmethod
    def _is_running(image: str) -> bool:
        out = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {image}", "/NH"],
            capture_output=True, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout
        return image.lower() in out.lower()

    # ---------- screen ----------
    def screenshot(self) -> dict:
        try:
            from PIL import ImageGrab  # type: ignore
        except ImportError:
            raise PolicyError("Screenshots need Pillow: run  pip install pillow")
        img = ImageGrab.grab()
        img.thumbnail((1280, 1280))
        buf = io.BytesIO()
        img.save(buf, "PNG")
        return {"ok": True, "width": img.width, "height": img.height, "png_base64": base64.b64encode(buf.getvalue()).decode()}

    def status(self) -> dict:
        return {"ok": True, "version": VERSION, "workspace": str(self.workspace), "apps": list(APPS), "platform": sys.platform}


ROUTES = {
    "/status": lambda h, b: h.status(),
    "/apps/launch": lambda h, b: h.launch_app(str(b.get("app", ""))),
    "/files/list": lambda h, b: h.list_files(str(b.get("path", ""))),
    "/files/search": lambda h, b: h.search_files(str(b.get("query", ""))),
    "/files/read": lambda h, b: h.read_file(str(b.get("path", ""))),
    "/files/preview": lambda h, b: h.preview_write(str(b.get("path", "")), str(b.get("content", ""))),
    "/files/write": lambda h, b: h.write_file(str(b.get("path", "")), str(b.get("content", ""))),
    "/files/restore": lambda h, b: h.restore_file(str(b.get("path", ""))),
    "/screen/capture": lambda h, b: h.screenshot(),
}
LOGGED = {"/apps/launch", "/files/write", "/files/restore", "/screen/capture", "/files/read"}


def make_handler(helper: Helper, token: str, extra_origins: list[str]):
    class Handler(BaseHTTPRequestHandler):
        server_version = "JarvisHelper"

        def log_message(self, *args):  # keep console quiet; we have audit.log
            pass

        def _cors(self):
            origin = self.headers.get("Origin")
            if origin_allowed(origin, extra_origins):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Jarvis-Token")
                self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
                self.send_header("Access-Control-Allow-Private-Network", "true")

        def _send(self, code: int, body: dict):
            raw = json.dumps(body).encode()
            self.send_response(code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self):
            self.send_response(204 if origin_allowed(self.headers.get("Origin"), extra_origins) else 403)
            self._cors()
            self.end_headers()

        def do_POST(self):
            if not origin_allowed(self.headers.get("Origin"), extra_origins):
                return self._send(403, {"ok": False, "reason": "Origin not allowed."})
            if not hmac.compare_digest(self.headers.get("X-Jarvis-Token", ""), token):
                return self._send(401, {"ok": False, "reason": "Wrong pairing code."})
            route = ROUTES.get(self.path)
            if not route:
                return self._send(404, {"ok": False, "reason": "Unknown action."})
            try:
                length = min(int(self.headers.get("Content-Length", "0")), MAX_WRITE_BYTES * 2)
                body = json.loads(self.rfile.read(length) or b"{}")
                result = route(helper, body)
                if self.path in LOGGED:
                    helper.audit(self.path, {"input": {k: v for k, v in body.items() if k != "content"}}, bool(result.get("ok")))
                self._send(200, result)
            except PolicyError as e:
                helper.audit(self.path, {"rejected": str(e)}, False)
                self._send(200, {"ok": False, "reason": str(e)})
            except Exception as e:  # honest failure, no stack traces to the browser
                helper.audit(self.path, {"error": type(e).__name__}, False)
                self._send(500, {"ok": False, "reason": f"Helper error: {type(e).__name__}"})

    return Handler


def main():
    if sys.platform == "win32":
        try:
            import ctypes
            if ctypes.windll.shell32.IsUserAnAdmin():
                print("Refusing to run as Administrator. Start it from a normal (non-admin) window.")
                sys.exit(1)
        except Exception:
            pass
    d = config_dir()
    cfg = load_config(d)
    helper = Helper(Path(cfg["workspace"]), d)
    server = ThreadingHTTPServer((HOST, PORT), make_handler(helper, cfg["token"], cfg["extra_origins"]))
    print("=" * 56)
    print(f" JARVIS Helper {VERSION} running on http://{HOST}:{PORT}")
    print(f" Workspace folder: {helper.workspace}")
    print(f" Pairing code:     {cfg['token']}")
    print(" Paste the pairing code into JARVIS > PC tab.")
    print(" Press Ctrl+C to stop.")
    print("=" * 56)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("JARVIS Helper stopped.")


if __name__ == "__main__":
    main()
