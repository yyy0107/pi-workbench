# Screenshots, viewport, and coordinate input

- Use `action: "screenshot"` for visual inspection or when a snapshot cannot represent the target. For unavailable frames, truncated snapshots, or other reported limitations, use screenshots and the documented `input` actions when image input is supported by the current model.

- Ordinary screenshot interaction uses viewport CSS coordinates. Use the reported viewport and capture dimensions when mapping an image to coordinates. A full-page image includes content outside the viewport; scroll to a target before clicking it.

- Ordinary pages lay out within the available viewport at the selected zoom. Responsive sites can reflow in a narrow panel; sites with fixed-width content may require horizontal scrolling. Device previews use their chosen device dimensions, and screenshot pixel density does not change the page's CSS layout width.

- Screenshot results include an image content block and CSS dimensions. If the current model does not support image input, use text snapshots; do not claim to have inspected an image or guess coordinates from an image you cannot see. They do not automatically save a file or open an external image viewer. In standalone Pi, inline image display also depends on the terminal's image support and Pi's terminal image settings.

For coordinate input, `params.event` accepts text, mouse, or key events described by the tool. Send a press and release for a click. Prefer semantic `click` and `fill` when the current snapshot exposes the intended element. Ordinary navigation, snapshots, clicks, filling, and screenshots do not require full CDP access.
