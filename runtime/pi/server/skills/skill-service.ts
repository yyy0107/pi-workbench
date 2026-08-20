import type { SkillListPayload, SkillListValue } from "../../rpc-contracts";
import { getOrStartSession } from "../sessions/session-registry";

interface LoadedSkill {
  name: string;
  description: string;
  disableModelInvocation: boolean;
}

export interface SkillSessionHost {
  session: {
    resourceLoader: {
      getSkills(): { skills: readonly LoadedSkill[] };
    };
  };
}

export interface SkillServiceDependencies {
  getSession(sessionId: string): Promise<SkillSessionHost>;
}

export interface SkillServiceErrorDetails {
  "session-not-found": { sessionId: string };
  internal: Record<string, never>;
}

export type SkillServiceErrorCode = keyof SkillServiceErrorDetails;

export class SkillServiceError<
  Code extends SkillServiceErrorCode = SkillServiceErrorCode,
> extends Error {
  readonly code: Code;
  readonly details: SkillServiceErrorDetails[Code];

  constructor(
    code: Code,
    message: string,
    details: SkillServiceErrorDetails[Code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SkillServiceError";
    this.code = code;
    this.details = details;
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

export class SkillService {
  private readonly dependencies: SkillServiceDependencies;

  constructor(dependencies: Partial<SkillServiceDependencies> = {}) {
    this.dependencies = {
      getSession: getOrStartSession,
      ...dependencies,
    };
  }

  async list({ sessionId }: SkillListPayload): Promise<SkillListValue> {
    let host: SkillSessionHost;
    try {
      host = await this.dependencies.getSession(sessionId);
    } catch (error) {
      if (errorCode(error) === "pi_session_not_found") {
        throw new SkillServiceError(
          "session-not-found",
          "The session does not exist.",
          { sessionId },
          { cause: error },
        );
      }
      throw new SkillServiceError(
        "internal",
        "The session skills could not be loaded.",
        {},
        { cause: error },
      );
    }

    try {
      return {
        skills: host.session.resourceLoader.getSkills().skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          modelInvocable: !skill.disableModelInvocation,
        })),
      };
    } catch (error) {
      throw new SkillServiceError(
        "internal",
        "The session skills could not be loaded.",
        {},
        { cause: error },
      );
    }
  }
}
