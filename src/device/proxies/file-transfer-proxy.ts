import { hasFileTransfer } from "../../adapters/platform-adapter.js";
import type { Platform } from "../../platform-types.js";
import type { AdapterResolver } from "./input-proxy.js";

export class FileTransferProxy {
  constructor(private readonly resolve: AdapterResolver) {}

  async pushFile(
    localPath: string,
    remotePath: string,
    platform?: Platform,
    deviceId?: string,
  ): Promise<string> {
    const adapter = this.resolve(platform, deviceId);
    if (!hasFileTransfer(adapter)) {
      throw new Error(`File transfer is not supported for ${adapter.platform}.`);
    }
    return adapter.pushFile(localPath, remotePath, deviceId);
  }

  async pullFile(
    remotePath: string,
    localPath?: string,
    platform?: Platform,
    deviceId?: string,
  ): Promise<string> {
    const adapter = this.resolve(platform, deviceId);
    if (!hasFileTransfer(adapter)) {
      throw new Error(`File transfer is not supported for ${adapter.platform}.`);
    }
    return adapter.pullFile(remotePath, localPath, deviceId);
  }
}
