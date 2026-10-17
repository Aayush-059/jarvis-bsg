JARVIS Windows Helper
=====================

1. Install Python 3.10+ from https://www.python.org (tick "Add Python to PATH").
2. Optional, for screenshots:   pip install pillow
3. Open a normal (NOT administrator) Command Prompt in this folder and run:
       python jarvis_helper.py
4. Copy the pairing code it prints, open JARVIS, go to the "PC" tab, paste it, press Connect.
5. Keep the window open while you use JARVIS. Press Ctrl+C to stop it.

JARVIS can only touch files inside your workspace folder (default: C:\Users\<you>\JarvisWorkspace).
Change it by editing %APPDATA%\JarvisHelper\config.json, then restart the helper.
Every action is recorded in %APPDATA%\JarvisHelper\audit.log.
Earlier versions of changed files are kept in %APPDATA%\JarvisHelper\backups.

Tests:  pip install pytest   then   python -m pytest test_jarvis_helper.py
