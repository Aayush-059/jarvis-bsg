# Android JARVIS: permission-based phone actions

## What you will get
Extend the existing Android companion so JARVIS can request opening installed apps and propose supported actions inside them using the phone owner's permissions. Each person uses their own signed-in accounts; the developer's connections must never be used as a fallback.

“Full access” cannot be promised: Android app isolation, account authorization, protected screens and service rules still apply. No root access, unrestricted shell, credential extraction or bypass of game protections.

## Implementation stages
1. **Open installed apps.** Add a native app picker and user-approved launch targets. Connect Android launch requests to JARVIS's shared permission checks, visible approval and audit trail. Report unavailable apps honestly.
2. **Opt-in screen actions.** Add an Android accessibility service with clear consent, an app allowlist, visible active status and emergency stop. Read only the approved foreground app's accessible elements; propose bounded click/type actions. Pause on app changes, sensitive screens or unavailable elements. Do not collect passwords, payment details or private notifications.
3. **Confirm consequential actions.** Show the exact destination and proposed text before comments, messages or other submissions. Bind approval to that action, target and current screen; changed content requires new approval. Purchases, deletion and physical-device actions also require confirmation. Do not automate account security, permission grants or payment authorization.
4. **YouTube pilot.** Support opening YouTube and finding a channel/video where accessible. For “comment hello on MrBeast's latest video,” verify the channel and latest upload before proposing the exact comment. Submit only after approval when the screen permits it, then verify the result; otherwise hand off to the user without claiming success. Do not post a real public comment during automated tests.
5. **Test and package.** Add tests for rejected targets, expired approvals, screen changes, emergency stop and isolation from owner-only services. Run existing regression tests and package an updated APK after validation. Publishing is separate and is not included.

## Technical approach
- Keep the existing TanStack JARVIS interface and Android companion; do not replace the web framework.
- Native phone actions execute on the device, never directly from AI output. Use an origin-restricted, narrowly defined bridge with schema validation and an additional native approval gate.
- Extend the shared browser/server tool policy and account filters together; preserve existing Windows restrictions.
- Accessibility observations are untrusted data, not instructions. Bound each task and require readback before marking success.
- Use scoped installed-app discovery rather than requesting blanket access to all device data.

## Validation and limitations
Browser and unit tests do not prove real Android automation works. An emulator can validate basic native controls; YouTube navigation, microphone commands and verified comment submission require testing on an actual phone with the user's own account. If that device is unavailable, the release must be labelled unverified for those flows.

Other apps are added and tested individually. Games may be opened, but gameplay automation, anti-cheat bypass and universal support are not part of this release. Screen control does not automatically grant service API access.