# Accessibility Statement — NairaSense

NairaSense is an accessibility-focused financial information prototype designed for blind and low-vision users in Nigeria.

## Validation Status

- **Current status:** Accessibility features (semantic landmarks, visible keyboard focus, high-contrast and text-size preferences, MoneyVoice speech synthesis, manual denomination controls, and photo upload fallback) are implemented in the prototype.
- **Not yet completed:** A formal WCAG 2.2 AA audit and supervised task-completion testing with blind and low-vision Nigerian participants have **not** yet been completed. NairaSense does not claim WCAG 2.2 AA compliance until those evaluations are documented.

## Target Assistive Technology Matrix

| Platform | Browser | Screen Reader | Status |
| --- | --- | --- | --- |
| Android | Chrome | TalkBack | Planned for Sprint 2 testing |
| Windows | Chrome / Edge | NVDA | Planned for Sprint 2 testing |
| iOS | Safari | VoiceOver | Planned for Sprint 2 testing |

## Known Limitations

- Banknote recognition (`local-naira-cv`) is experimental; users should rely on confirmation, correction, or direct manual denomination entry.
- Transaction extraction is heuristic and does not verify bank settlement.
- Browser IndexedDB storage is account-partitioned but not encrypted application storage; users sharing a device should sign out after use.

## Reporting Accessibility Barriers

Please open an issue in the [NairaSense GitHub repository](https://github.com/gsimeon/nairasense/issues) describing the assistive technology, browser, and step where a barrier occurred.
