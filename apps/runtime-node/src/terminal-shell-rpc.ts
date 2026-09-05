import {
  createRpcPostHandler,
  rpcObject,
  rpcEnum,
  rpcBusinessError,
} from "@workbench/host-server/rpc";
import {
  SET_DEFAULT_TERMINAL_SHELL_METHOD,
  TERMINAL_SHELLS,
  type SetDefaultTerminalShellPayload,
  type SetDefaultTerminalShellResult,
} from "@workbench/terminal-contracts";

/** Installed only behind the desktop sidecar's authenticated HTTP ingress. */
export function createTerminalShellRpcHandler(
  setShell: (shell: SetDefaultTerminalShellPayload["shell"]) => SetDefaultTerminalShellResult,
) {
  return createRpcPostHandler<
    typeof SET_DEFAULT_TERMINAL_SHELL_METHOD,
    SetDefaultTerminalShellPayload,
    SetDefaultTerminalShellResult
  >({
    method: SET_DEFAULT_TERMINAL_SHELL_METHOD,
    payload: rpcObject({ shell: rpcEnum(TERMINAL_SHELLS) }),
    loopbackOnly: true,
    handler({ shell }) {
      try {
        return setShell(shell);
      } catch {
        throw rpcBusinessError(
          "terminal-shell-unavailable",
          "The terminal shell could not be applied.",
          {},
        );
      }
    },
  });
}
