/** Shared initialization; each capability keeps its public error class and code union in src. */
export class AgentServerError<Code extends string> extends Error {
  readonly code: Code;
  constructor(name: string, code: Code, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = name;
    this.code = code;
  }
}
