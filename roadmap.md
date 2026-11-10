# JARVIS additions
- [ ] Android commands inside installed apps: start with opening YouTube and preparing a confirmed comment on a specified channel's latest video. Blocked on choosing account-authorized service actions versus phone screen control; universal app/game support cannot be guaranteed and needs real-device verification.
- [x] Expand popular website/service/game destinations: 55 official destinations, searchable Services tab, permission checks and confirmation.
- [x] Expand installed Windows launch support: Edge, Chrome, Firefox, Spotify, Discord and Steam via fixed installation paths; screen control remains Calculator/Notepad/Paint only. Real Windows execution untested.
- [ ] Set up individual-user service connections (blocked: no workspace OAuth clients configured for Gmail, Calendar or Slack; broader services require their own supported authorization).
- [x] Validate before publication: 52 app tests and 25 helper tests passed; signed-in browser opening, approval, log readback and level-1 rejection checked; latest build OK. Non-owner Google exclusion tested in policy, not through a second real account.
- [ ] Universal mobile app/game control (blocked: current Android wrapper has no device-control capability; real phone/Windows tests require those devices). No anti-cheat or platform restriction bypass.
- [x] Publish current JARVIS at the user's explicit request: deployment requested for https://jarvis-bsg.lovable.app; subsequent browser visit returned 200 and displayed current sign-in and developer credit. Individual-account connections and real-device checks remain limitations.
- [x] Walk through available live flows: requesting owner's restored session accepted, sign-out returned to sign-in, microphone recognition and mute controls available, confirmed Wikipedia opening reached its real main page and log readback worked. Password/Google sign-in and actual phone audio remain unverified.
- [ ] Complete conversational/voice-command walkthrough (blocked: live chat request returned HTTP 200 but no assistant reply; preview logs show AI Payment Required/402; real microphone requires a phone). No model response or voice-driven action claimed successful.
- [x] Rebuild and deliver the Windows ZIP pointing to https://jarvis-bsg.lovable.app; ZIP integrity and packaged address verified (real Windows execution untested).
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
