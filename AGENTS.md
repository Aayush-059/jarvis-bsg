<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- Safety rules (permission levels, allowlists, safe calculator) live in `src/lib/jarvis/policy.ts` and are enforced on both server and browser — never relax one side only; covered by `src/test/policy.test.ts`.
- The AI only *requests* actions: action tools have no server execute and run in the browser after policy check + user approval, then are logged to the audit log.
- PC control goes through the local helper `public/jarvis-helper/jarvis_helper.py` (127.0.0.1, pairing token, origin check, workspace-only paths); its app allowlist must match `APPROVED_APPS` in policy.ts, and its own pytest file must keep passing.
- Every server endpoint (/api/chat, /api/summarize, /api/google) must call checkPasscode (JARVIS_PASSCODE secret) — the app has no login, so this is what keeps Gmail/Calendar private. Consequential Google actions go only through /api/google after browser approval and are verified by reading back.
