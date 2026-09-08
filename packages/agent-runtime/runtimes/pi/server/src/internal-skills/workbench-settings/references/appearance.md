# Workbench Appearance

Read the current `preferences.appearance` and preserve its other fields before submitting a replacement. To reset one field, remove it from that object; use `appearance: null` only to reset all appearance settings.

Set these fields within the merged `appearance` object:

| Request                            | Field and supported values                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Light/dark/system theme            | `colorMode`: `light`, `dark`, `system`                                                                                                         |
| Interface font size                | `uiFontSize`: number, 12–20                                                                                                                    |
| Code font size                     | `codeFontSize`: number, 10–18                                                                                                                  |
| Interface/content/code font weight | `uiFontWeight`, `contentFontWeight`, `codeFontWeight`: 300, 400, 500, 600, 700                                                                 |
| Corner shape                       | `cornerRadius`: `square`, `subtle`, `compact`, `default`, `soft`, `rounded`, `extra-rounded`                                                   |
| Borders                            | `borderStyle`: `default`, `solid`, `dashed`, `dotted`, `none`                                                                                  |
| Surface transparency               | `surfaceOpacity`: number, 0–100                                                                                                                |
| Background/glass blur              | `backgroundBlur`, `glassBlur`: `none`, `soft`, `medium`, `strong`                                                                              |
| Per-mode colors                    | `lightAccentColor`, `lightBackgroundColor`, `lightForegroundColor`, `darkAccentColor`, `darkBackgroundColor`, `darkForegroundColor`: hex color |
| Per-mode contrast                  | `lightContrast`, `darkContrast`: number, 75–300                                                                                                |
| Running indicator                  | `runningIndicatorId`: `orb`, `spinner`, `pulse`, `none`; `runningIndicatorSize`: number, 12–32                                                 |
| Composer animation                 | `composerAnimationEnabled`: boolean                                                                                                            |

For example, if the current appearance is `{"colorMode":"light","uiFontSize":14}`, switching to dark mode uses:

```json
{ "action": "update", "patch": { "appearance": { "colorMode": "dark", "uiFontSize": 14 } } }
```

The example's existing fields are illustrative: merge the actual current appearance.

The settings service validates JSON and top-level fields; the UI owns appearance-specific normalization. Do not interpret a successful write of an invented appearance field or value as proof that the UI supports it. For options not listed here, inspect matching Workbench documentation/source when available, or use the relevant settings control.
