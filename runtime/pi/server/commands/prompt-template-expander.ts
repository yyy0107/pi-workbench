/** Parse the documented Pi prompt-template argument syntax without starting an Agent turn. */
export function parsePromptTemplateArguments(input: string): string[] {
  const arguments_: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;

  for (const character of input) {
    if (quote) {
      if (character === quote) quote = undefined;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/u.test(character)) {
      if (current) {
        arguments_.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (current) arguments_.push(current);
  return arguments_;
}

/** Applies the placeholder forms documented by Pi's public PromptTemplate contract. */
export function expandPromptTemplateContent(content: string, argumentText: string): string {
  const arguments_ = parsePromptTemplateArguments(argumentText);
  const allArguments = arguments_.join(" ");
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/gu,
    (_match, defaultTarget, defaultValue, sliceStart, sliceLength, simpleTarget) => {
      if (defaultTarget) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS"
            ? allArguments
            : arguments_[Number.parseInt(defaultTarget, 10) - 1];
        return value || defaultValue;
      }
      if (sliceStart) {
        const start = Math.max(0, Number.parseInt(sliceStart, 10) - 1);
        return sliceLength
          ? arguments_.slice(start, start + Number.parseInt(sliceLength, 10)).join(" ")
          : arguments_.slice(start).join(" ");
      }
      if (simpleTarget === "ARGUMENTS" || simpleTarget === "@") return allArguments;
      return arguments_[Number.parseInt(simpleTarget, 10) - 1] ?? "";
    },
  );
}
