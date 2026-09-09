import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { BrowserProfile, BrowserSettings } from "@workbench/browser-contracts";
import { childProcessEnvironment } from "@workbench/server-core/child-process-environment";
import { connectBrowser, findBrowserExecutable, type BrowserCdp } from "./cdp";
import { BrowserError } from "./errors";

type ProfileLocation = { name: string; directory: string; executables?: string[] };
function locations(custom?: string): ProfileLocation[] {
  if (custom) {
    if (!path.isAbsolute(custom))
      throw new BrowserError("browser-invalid", "The Chrome user data directory must be absolute.");
    return [{ name: "Chrome", directory: custom }];
  }
  if (process.platform === "darwin")
    return [
      {
        name: "Chrome",
        directory: path.join(homedir(), "Library/Application Support/Google/Chrome"),
        executables: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
      },
      {
        name: "Chromium",
        directory: path.join(homedir(), "Library/Application Support/Chromium"),
        executables: ["/Applications/Chromium.app/Contents/MacOS/Chromium"],
      },
      {
        name: "Edge",
        directory: path.join(homedir(), "Library/Application Support/Microsoft Edge"),
        executables: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
      },
      {
        name: "Brave",
        directory: path.join(homedir(), "Library/Application Support/BraveSoftware/Brave-Browser"),
        executables: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
      },
    ];
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData/Local");
    return [
      ["Chrome", "Google/Chrome", "chrome.exe"],
      ["Edge", "Microsoft/Edge", "msedge.exe"],
      ["Brave", "BraveSoftware/Brave-Browser", "brave.exe"],
    ].map(([name, folder, binary]) => ({
      name: name!,
      directory: path.join(local, folder!, "User Data"),
      executables: [local, process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"]]
        .filter((root): root is string => !!root)
        .map((root) => path.join(root, folder!, "Application", binary!)),
    }));
  }
  const config = process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
  return [
    {
      name: "Chrome",
      directory: path.join(config, "google-chrome"),
      executables: ["google-chrome", "google-chrome-stable", "/opt/google/chrome/chrome"],
    },
    {
      name: "Chromium",
      directory: path.join(config, "chromium"),
      executables: ["chromium", "chromium-browser"],
    },
    {
      name: "Edge",
      directory: path.join(config, "microsoft-edge"),
      executables: ["microsoft-edge", "microsoft-edge-stable"],
    },
    {
      name: "Brave",
      directory: path.join(config, "BraveSoftware/Brave-Browser"),
      executables: ["brave-browser", "brave-browser-stable"],
    },
  ];
}

function profileDirectory(value: string): boolean {
  return (
    !!value &&
    value !== "." &&
    value !== ".." &&
    !/[\\/\0]/.test(value) &&
    !["System Profile", "Guest Profile"].includes(value)
  );
}

async function jsonFile(filename: string): Promise<Record<string, any> | undefined> {
  try {
    if ((await stat(filename)).size > 4 * 1024 * 1024) return;
    const value = JSON.parse(await readFile(filename, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return;
  }
}

export async function listBrowserProfiles(custom?: string): Promise<BrowserProfile[]> {
  const profiles: BrowserProfile[] = [];
  for (const location of locations(custom)) {
    const state = await jsonFile(path.join(location.directory, "Local State"));
    let entries = state?.profile?.info_cache;
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      entries = {};
      const children = await readdir(location.directory, { withFileTypes: true }).catch(() => []);
      for (const child of children.slice(0, 100)) {
        if (!child.isDirectory() || !profileDirectory(child.name)) continue;
        const preferences = await jsonFile(
          path.join(location.directory, child.name, "Preferences"),
        );
        if (preferences?.profile) entries[child.name] = preferences.profile;
      }
    }
    for (const [directory, info] of Object.entries(entries).slice(0, 100)) {
      if (
        !profileDirectory(directory) ||
        !info ||
        typeof info !== "object" ||
        ("is_ephemeral" in info && info.is_ephemeral)
      )
        continue;
      const name = "name" in info && typeof info.name === "string" ? info.name : directory;
      profiles.push({
        id: `${location.directory}#${directory}`,
        name: name.slice(0, 256),
        browser: location.name,
        userDataDirectory: location.directory,
        profileDirectory: directory,
        lastUsed: state?.profile?.last_used === directory,
      });
    }
  }
  return profiles.sort(
    (a, b) => Number(b.lastUsed) - Number(a.lastUsed) || a.name.localeCompare(b.name),
  );
}

async function discoverEndpoint(directory: string): Promise<string | undefined> {
  try {
    const [port, endpoint] = (await readFile(path.join(directory, "DevToolsActivePort"), "utf8"))
      .trim()
      .split(/\r?\n/);
    if (
      port &&
      /^\d+$/.test(port) &&
      Number(port) > 0 &&
      Number(port) <= 65535 &&
      endpoint?.startsWith("/devtools/browser/")
    )
      return `ws://127.0.0.1:${port}${endpoint}`;
  } catch {
    /* A browser using a fixed debugging port may not write this file. */
  }
  return;
}

/** A CLI marker proves which profile a new window belongs to; CDP cannot select a foreign profile context. */
async function seedProfile(
  cdp: BrowserCdp,
  profile: BrowserProfile,
  custom?: string,
): Promise<string> {
  const location = locations(custom).find((item) => item.directory === profile.userDataDirectory);
  if (!location) throw new BrowserError("browser-invalid");
  const executable = await findBrowserExecutable(location.executables);
  const directory = await mkdtemp(path.join(tmpdir(), "workbench-chrome-profile-"));
  const marker = path.join(directory, "profile.html");
  await writeFile(marker, "<!doctype html><meta charset=utf-8><title>Workbench</title>", {
    mode: 0o600,
  });
  const url = pathToFileURL(marker).href;
  try {
    const child = spawn(
      executable,
      [
        `--user-data-dir=${profile.userDataDirectory}`,
        `--profile-directory=${profile.profileDirectory}`,
        "--new-window",
        url,
      ],
      { stdio: "ignore", detached: true, env: childProcessEnvironment(process.env) },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.on("error", () => {});
    child.unref();
    const deadline = Date.now() + 15000;
    do {
      const { targetInfos } = await cdp.send("Target.getTargets");
      const target = targetInfos.find(
        (item: Record<string, any>) => item.type === "page" && item.url === url,
      );
      if (target) return target.targetId;
      await delay(100);
    } while (Date.now() < deadline);
    throw new BrowserError(
      "browser-unavailable",
      "The selected profile did not appear in the connected Chrome. Check the endpoint and profile, then retry.",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function connectExternalBrowser(
  settings: BrowserSettings,
  onClose: () => void,
  previousAnchor?: string,
) {
  const profiles = await listBrowserProfiles(settings.chromeUserDataDirectory || undefined);
  const profile = settings.chromeProfile
    ? profiles.find((item) => item.id === settings.chromeProfile)
    : undefined;
  if (settings.chromeProfile && !profile)
    throw new BrowserError(
      "browser-invalid",
      "The selected Chrome profile is no longer available.",
    );
  const candidates = settings.chromeEndpoint
    ? [settings.chromeEndpoint]
    : [
        ...(
          await Promise.all(
            (profile
              ? [profile.userDataDirectory]
              : locations(settings.chromeUserDataDirectory || undefined).map(
                  (item) => item.directory,
                )
            ).map(discoverEndpoint),
          )
        ).filter((endpoint): endpoint is string => !!endpoint),
        "http://127.0.0.1:9222",
      ];
  let cdp: BrowserCdp | undefined;
  for (const endpoint of new Set(candidates)) {
    try {
      cdp = await connectBrowser(endpoint, onClose);
      break;
    } catch {
      /* Try the next local endpoint. */
    }
  }
  if (!cdp)
    throw new BrowserError(
      "browser-unavailable",
      "Enable remote debugging in the existing Chrome and allow its connection prompt, or provide its loopback debugger URL.",
    );
  const connection = cdp;
  let anchor: { targetId: string; sessionId: string } | undefined;
  let opening: Promise<void> | undefined;
  const ensureAnchor = async () => {
    if (anchor) {
      try {
        await connection.send("Target.getTargetInfo", { targetId: anchor.targetId });
        return;
      } catch {
        anchor = undefined;
      }
    }
    opening ??= (async () => {
      const restored =
        previousAnchor &&
        (await connection
          .send("Target.getTargetInfo", { targetId: previousAnchor })
          .catch(() => undefined));
      const targetId = restored
        ? previousAnchor!
        : profile
          ? await seedProfile(connection, profile, settings.chromeUserDataDirectory || undefined)
          : (await connection.send("Target.createTarget", { url: "about:blank", newWindow: true }))
              .targetId;
      previousAnchor = undefined;
      try {
        const { sessionId } = await connection.send("Target.attachToTarget", {
          targetId,
          flatten: true,
        });
        anchor = { targetId, sessionId };
        await connection.send("Page.navigate", { url: "about:blank" }, sessionId);
      } catch (error) {
        await connection.send("Target.closeTarget", { targetId }).catch(() => undefined);
        anchor = undefined;
        throw error;
      }
    })().finally(() => {
      opening = undefined;
    });
    await opening;
  };
  return {
    cdp: connection,
    get anchorTargetId() {
      return anchor?.targetId ?? previousAnchor;
    },
    async profileSession(): Promise<string> {
      await ensureAnchor();
      return anchor!.sessionId;
    },
    async createTarget(): Promise<{ targetId: string }> {
      await ensureAnchor();
      const url = `about:blank#workbench-${randomUUID()}`;
      const result = await connection.send(
        "Runtime.evaluate",
        {
          expression: `!!window.open(${JSON.stringify(url)}, '_blank')`,
          returnByValue: true,
          userGesture: true,
        },
        anchor!.sessionId,
      );
      if (result.result?.value !== true)
        throw new BrowserError(
          "browser-operation-failed",
          "Chrome blocked the new tab in the selected profile.",
        );
      const deadline = Date.now() + 8000;
      do {
        const { targetInfos } = await connection.send("Target.getTargets");
        const target = targetInfos.find(
          (item: Record<string, any>) => item.type === "page" && item.url === url,
        );
        if (target) return { targetId: target.targetId };
        await delay(50);
      } while (Date.now() < deadline);
      throw new BrowserError(
        "browser-operation-failed",
        "The new Chrome tab did not become available.",
      );
    },
    async close() {
      if (opening) await opening.catch(() => undefined);
      const targetId = anchor?.targetId ?? previousAnchor;
      if (targetId)
        await connection.send("Target.closeTarget", { targetId }).catch(() => undefined);
      anchor = undefined;
      connection.dispose();
    },
  };
}
