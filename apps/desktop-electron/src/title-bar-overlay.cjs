const OPAQUE_HEX_COLOR_PATTERN = /^#[\da-f]{6}$/i;

function isTitleBarOverlayOptions(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 2 &&
    Object.prototype.hasOwnProperty.call(value, "color") &&
    Object.prototype.hasOwnProperty.call(value, "symbolColor") &&
    typeof value.color === "string" &&
    OPAQUE_HEX_COLOR_PATTERN.test(value.color) &&
    typeof value.symbolColor === "string" &&
    OPAQUE_HEX_COLOR_PATTERN.test(value.symbolColor)
  );
}

function copyTitleBarOverlayOptions(value) {
  if (!isTitleBarOverlayOptions(value)) return undefined;
  return Object.freeze({ color: value.color, symbolColor: value.symbolColor });
}

module.exports = { copyTitleBarOverlayOptions, isTitleBarOverlayOptions };
