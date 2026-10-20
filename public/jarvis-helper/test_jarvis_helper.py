"""Run with:  python -m pytest test_jarvis_helper.py"""
from pathlib import Path

import pytest

from jarvis_helper import Helper, PolicyError, origin_allowed


@pytest.fixture
def helper(tmp_path: Path) -> Helper:
    return Helper(tmp_path / "ws", tmp_path / "state")


@pytest.mark.parametrize("bad", ["../secret.txt", "a/../../x.txt", "/etc/passwd", "C:/Windows/win.ini", "~/x.txt", "..\\..\\x.txt"])
def test_rejects_paths_outside_workspace(helper, bad):
    with pytest.raises(PolicyError):
        helper.safe_path(bad)


def test_rejected_write_creates_nothing(helper, tmp_path):
    with pytest.raises(PolicyError):
        helper.write_file("../escape.txt", "x")
    assert not (tmp_path / "escape.txt").exists()


def test_write_is_verified_and_backed_up(helper):
    r1 = helper.write_file("notes/a.txt", "one")
    assert r1["ok"] and r1["verified"] and r1["backup"] is None
    r2 = helper.write_file("notes/a.txt", "two")
    assert r2["backup"]
    assert (helper.workspace / "notes/a.txt").read_text() == "two"


def test_restore_rolls_back(helper):
    helper.write_file("a.txt", "one")
    helper.write_file("a.txt", "two")
    helper.restore_file("a.txt")
    assert (helper.workspace / "a.txt").read_text() == "one"


def test_preview_shows_diff_without_writing(helper):
    helper.write_file("a.txt", "hello\n")
    d = helper.preview_write("a.txt", "goodbye\n")
    assert "-hello" in d["diff"] and "+goodbye" in d["diff"]
    assert (helper.workspace / "a.txt").read_text() == "hello\n"


def test_binary_files_refused(helper):
    with pytest.raises(PolicyError):
        helper.write_file("run.exe", "x")


def test_unapproved_app_refused(helper):
    with pytest.raises(PolicyError):
        helper.launch_app("cmd")


def test_origins():
    assert origin_allowed("https://myapp.lovable.app")
    assert origin_allowed("http://localhost:8080")
    assert not origin_allowed("https://evil.com")
    assert not origin_allowed("https://lovable.app.evil.com")
    assert not origin_allowed(None)


class FakeImg:
    size = (2560, 1440)
    width, height = 2560, 1440
    def thumbnail(self, s):
        self.width, self.height = 1280, 720
    def save(self, buf, fmt):
        buf.write(b"png")


@pytest.fixture
def screen(helper, monkeypatch):
    state = {"fg": "notepad.exe", "clicks": [], "typed": []}
    monkeypatch.setattr(helper, "_grab", lambda: FakeImg())
    monkeypatch.setattr(helper, "_foreground_image", lambda: state["fg"])
    monkeypatch.setattr(helper, "_inject_click", lambda x, y: state["clicks"].append((x, y)))
    monkeypatch.setattr(helper, "_inject_text", lambda t: state["typed"].append(t))
    return helper, state


def test_click_scales_and_executes(screen):
    h, st = screen
    tok = h.screenshot()["screen_token"]
    assert h.screen_click(tok, 100, 50)["ok"]
    assert st["clicks"] == [(200, 100)]


def test_token_is_single_use(screen):
    h, st = screen
    tok = h.screenshot()["screen_token"]
    h.screen_click(tok, 1, 1)
    with pytest.raises(PolicyError):
        h.screen_click(tok, 1, 1)
    assert len(st["clicks"]) == 1


def test_unapproved_foreground_refused(screen):
    h, st = screen
    st["fg"] = "cmd.exe"
    tok = h.screenshot()["screen_token"]
    with pytest.raises(PolicyError):
        h.screen_type(tok, "dir")
    assert st["typed"] == []


def test_foreground_change_refused(screen):
    h, st = screen
    tok = h.screenshot()["screen_token"]
    st["fg"] = "chrome.exe"
    with pytest.raises(PolicyError):
        h.screen_click(tok, 1, 1)
    assert st["clicks"] == []


def test_out_of_bounds_and_bad_coords(screen):
    h, st = screen
    for x, y in [(1280, 1), (-1, 0), (1.5, 2), ("3", 4), (True, 1)]:
        tok = h.screenshot()["screen_token"]
        with pytest.raises(PolicyError):
            h.screen_click(tok, x, y)
    assert st["clicks"] == []


def test_expired_token(screen, monkeypatch):
    h, st = screen
    tok = h.screenshot()["screen_token"]
    h._screen_token["at"] -= 1000
    with pytest.raises(PolicyError):
        h.screen_click(tok, 1, 1)


def test_typing_rejects_control_and_long(screen):
    h, st = screen
    for bad in ["\x1b[A", "a" * 501, ""]:
        tok = h.screenshot()["screen_token"]
        with pytest.raises(PolicyError):
            h.screen_type(tok, bad)
    tok = h.screenshot()["screen_token"]
    assert h.screen_type(tok, "hello\nworld")["typed_chars"] == 11
