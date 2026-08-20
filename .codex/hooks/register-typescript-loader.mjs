import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      const hasExtension = /\.[^/]+$/.test(specifier);

      if (error?.code === "ERR_MODULE_NOT_FOUND" && isRelative && !hasExtension) {
        return nextResolve(`${specifier}.ts`, context);
      }

      throw error;
    }
  },
});
