import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const appDirectory = resolve(import.meta.dirname, "..");
const conventionalSdk = resolve(homedir(), "Android", "Sdk");
const androidSdk =
  process.env.ANDROID_SDK_ROOT ??
  process.env.ANDROID_HOME ??
  (existsSync(conventionalSdk) ? conventionalSdk : undefined);

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: appDirectory,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.platform === "win32" ? "expo.cmd" : "expo", [
  "prebuild",
  "--platform",
  "android",
  "--no-install",
]);

const wrapper = resolve(
  appDirectory,
  "android",
  process.platform === "win32" ? "gradlew.bat" : "gradlew",
);
if (!existsSync(wrapper)) {
  throw new Error("Expo prebuild did not create the Android Gradle wrapper");
}
run(wrapper, ["-p", resolve(appDirectory, "android"), ":app:assembleRelease", "--no-daemon"], {
  ...process.env,
  ...(androidSdk ? { ANDROID_HOME: androidSdk, ANDROID_SDK_ROOT: androidSdk } : {}),
  NODE_ENV: "production",
});
