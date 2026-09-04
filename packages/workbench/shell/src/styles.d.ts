declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module "*.css";

declare module "*.svg" {
  /** Vite emits a URL string; Next's static-image loader emits an object with src. */
  const source: string | Readonly<{ src: string; [metadata: string]: unknown }>;
  export default source;
}
