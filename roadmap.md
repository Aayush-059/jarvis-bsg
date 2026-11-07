# JARVIS additions
- [ ] Rebuild and deliver the Windows ZIP pointing to https://jarvis-bsg.lovable.app; inspect the packaged address before sharing.
- [ ] Connect Slack (blocked: user declined the Slack connection card).
- [x] Add live web search with sources.
- [x] Add screenshot understanding and confirmed Windows click/type actions.
- [x] Run safety tests and verify available end-to-end flows.
- [x] Publish JARVIS to https://aayush-jarvis.lovable.app.
- [x] Verify live site: passcode unlock, Gmail and Calendar connections respond.
- [ ] AI replies on live site blocked: AI gateway returns "credits used up" (402) despite 3.10 daily credits remaining. Blocked on credit top-up or daily reset (00:00 UTC).
- [ ] Voice walkthrough on a real phone/mic (cannot test headless).

## Multi-user JARVIS
- [x] Enable Lovable Cloud (retry after https://status.lovable.dev clears)
- [x] Sign-in: Google + email/password, with password reset
- [x] Profiles (name) per user; preferred voice later
- [x] Roles table: Aayush = owner/admin (keeps own Gmail/Calendar), everyone else = user
- [x] Per-person data (memory, audit log) isolated by account
- [ ] Later: each user connects their own Google (needs Google developer app setup)
