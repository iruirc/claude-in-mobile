import type { IosDevice } from "../types.js";

/**
 * Booted first: building against an already-running simulator skips a boot, and
 * a particular simulator model is not guaranteed to exist on newer Xcodes.
 */
export function pickBuildSimulator(devices: IosDevice[]): IosDevice | undefined {
  const usable = devices.filter((device) => /^(iPhone|iPad)/.test(device.name));
  return usable.find((device) => device.state === "booted") ?? usable[0];
}
