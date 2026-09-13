export interface FileNameParts {
  stem: string;
  extension: string;
}

export function splitFileName(name: string): FileNameParts {
  const extensionStart = name.lastIndexOf(".");
  if (extensionStart <= 0 || extensionStart === name.length - 1) {
    return { stem: name, extension: "" };
  }

  return {
    stem: name.slice(0, extensionStart),
    extension: name.slice(extensionStart),
  };
}
