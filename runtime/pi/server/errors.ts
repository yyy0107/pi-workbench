export class PiServerError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = "PiServerError";
    this.code = code;
    this.status = status;
  }
}
