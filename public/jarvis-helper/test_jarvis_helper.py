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
