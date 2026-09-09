import { createHash, randomUUID } from "crypto";
import { chmod, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";

import type { PerformanceTraceCapture } from "../adapters/platform-adapter.js";
import { MobileError, ValidationError } from "../errors.js";
import type { PerformanceTraceArtifact } from "./types.js";
import { validatePathContainment } from "../utils/sanitize.js";

const DEFAULT_DIR = join(tmpdir(), "mcp-devices-performance-traces");
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_ARTIFACT_SIZE = 32 * 1024 * 1024;
const MAX_TOTAL_SIZE = 256 * 1024 * 1024;
const MAX_ARTIFACTS = 64;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StoredTraceMetadata extends Omit<PerformanceTraceArtifact, "path"> {
  fileName: string;
}

function extensionFor(capture: PerformanceTraceCapture): string {
  switch (capture.format) {
    case "chrome-json": return "json";
    case "perfetto-proto": return "perfetto-trace";
    case "xctrace-zip": return "trace.zip";
  }
}

export class TraceArtifactStore {
  private readonly rootDir: string;
  private readonly ttlMs: number;

  constructor(rootDir?: string, ttlMs = DEFAULT_TTL_MS) {
    this.rootDir = resolve(rootDir ?? process.env.MCP_DEVICES_TRACE_DIR ?? DEFAULT_DIR);
    this.ttlMs = ttlMs;
  }

  async save(capture: PerformanceTraceCapture): Promise<PerformanceTraceArtifact> {
    const data = Buffer.from(capture.data.buffer, capture.data.byteOffset, capture.data.byteLength);
    if (data.length === 0) {
      throw new ValidationError("Performance trace is empty; no artifact was written.");
    }
    if (data.length > MAX_ARTIFACT_SIZE) {
      throw new ValidationError(
        `Performance trace is ${(data.length / 1024 / 1024).toFixed(1)}MB; maximum is ${MAX_ARTIFACT_SIZE / 1024 / 1024}MB.`,
      );
    }

    await this.ensureRoot();
    await this.purgeExpired();
    const stored = await this.storageUsage();
    if (stored.count >= MAX_ARTIFACTS) {
      throw new MobileError(
        `Performance trace artifact limit reached (${MAX_ARTIFACTS}). Delete an artifact before capturing another trace.`,
        "PERF_TRACE_STORAGE_FULL",
      );
    }
    if (stored.bytes + data.length > MAX_TOTAL_SIZE) {
      throw new MobileError(
        `Performance trace storage would exceed ${MAX_TOTAL_SIZE / 1024 / 1024}MB. Delete older artifacts first.`,
        "PERF_TRACE_STORAGE_FULL",
      );
    }

    const artifactId = randomUUID();
    const fileName = `${artifactId}.${extensionFor(capture)}`;
    const artifactPath = this.childPath(fileName);
    const metadataPath = this.childPath(`${artifactId}.metadata.json`);
    const partialPath = this.childPath(`${artifactId}.${randomUUID()}.partial`);
    const partialMetadataPath = this.childPath(`${artifactId}.${randomUUID()}.metadata.partial`);
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
    const sha256 = createHash("sha256").update(data).digest("hex");

    const artifact: PerformanceTraceArtifact = {
      artifactId,
      traceId: capture.traceId,
      platform: capture.platform,
      preset: capture.preset,
      startedAt: capture.startedAt,
      deadlineAt: capture.deadlineAt,
      endedAt: capture.endedAt,
      durationMs: capture.durationMs,
      format: capture.format,
      mimeType: capture.mimeType,
      producer: capture.producer,
      packageName: capture.packageName,
      session: capture.session,
      summary: capture.summary,
      path: artifactPath,
      sizeBytes: data.length,
      sha256,
      createdAt,
      expiresAt,
      sensitivity: "sensitive",
    };
    const { path: _artifactPath, ...metadataFields } = artifact;
    const metadata: StoredTraceMetadata = { ...metadataFields, fileName };

    try {
      await writeFile(partialPath, data, { flag: "wx", mode: FILE_MODE });
      await writeFile(partialMetadataPath, JSON.stringify(metadata, null, 2), {
        flag: "wx",
        mode: FILE_MODE,
      });
      await rename(partialPath, artifactPath);
      await rename(partialMetadataPath, metadataPath);
    } catch (error) {
      await Promise.allSettled([
        unlink(partialPath),
        unlink(partialMetadataPath),
        unlink(artifactPath),
        unlink(metadataPath),
      ]);
      throw error;
    }

    return artifact;
  }

  async updateSummary(artifact: PerformanceTraceArtifact): Promise<void> {
    this.validateArtifactId(artifact.artifactId);
    const metadataPath = this.childPath(`${artifact.artifactId}.metadata.json`);
    const partialPath = this.childPath(`${artifact.artifactId}.${randomUUID()}.metadata.partial`);
    let existing: StoredTraceMetadata;
    try {
      existing = JSON.parse(await readFile(metadataPath, "utf8")) as StoredTraceMetadata;
    } catch {
      throw new MobileError(
        `Performance trace artifact "${artifact.artifactId}" was not found.`,
        "PERF_TRACE_NOT_FOUND",
      );
    }
    if (existing.artifactId !== artifact.artifactId) {
      throw new MobileError(
        `Performance trace artifact "${artifact.artifactId}" has invalid metadata.`,
        "PERF_TRACE_CORRUPTED",
      );
    }
    const updated: StoredTraceMetadata = {
      ...existing,
      summary: artifact.summary,
    };
    try {
      await writeFile(partialPath, JSON.stringify(updated, null, 2), {
        flag: "wx",
        mode: FILE_MODE,
      });
      await rename(partialPath, metadataPath);
    } catch (error) {
      await unlink(partialPath).catch(() => {});
      throw error;
    }
  }

  async delete(artifactId: string): Promise<void> {
    this.validateArtifactId(artifactId);
    await this.ensureRoot();
    const metadataPath = this.childPath(`${artifactId}.metadata.json`);
    let metadata: StoredTraceMetadata;
    try {
      metadata = JSON.parse(await readFile(metadataPath, "utf8")) as StoredTraceMetadata;
    } catch {
      throw new MobileError(
        `Performance trace artifact "${artifactId}" was not found.`,
        "PERF_TRACE_NOT_FOUND",
      );
    }
    if (metadata.artifactId !== artifactId || !metadata.fileName.startsWith(`${artifactId}.`)) {
      throw new MobileError(
        `Performance trace artifact "${artifactId}" has invalid metadata.`,
        "PERF_TRACE_CORRUPTED",
      );
    }
    await Promise.allSettled([
      unlink(this.childPath(metadata.fileName)),
      unlink(metadataPath),
    ]);
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: DIR_MODE });
    await chmod(this.rootDir, DIR_MODE);
  }

  private childPath(fileName: string): string {
    const path = join(this.rootDir, fileName);
    validatePathContainment(path, this.rootDir);
    return path;
  }

  private validateArtifactId(artifactId: string): void {
    if (!ARTIFACT_ID.test(artifactId)) {
      throw new ValidationError("artifactId must be a UUID generated by performance trace capture.");
    }
  }

  private async purgeExpired(): Promise<void> {
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    const now = Date.now();
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) return;
      const path = this.childPath(entry.name);
      if (entry.name.endsWith(".partial")) {
        const details = await stat(path).catch(() => null);
        if (details && now - details.mtimeMs > this.ttlMs) await unlink(path).catch(() => {});
        return;
      }
      if (!entry.name.endsWith(".metadata.json")) return;
      try {
        const metadata = JSON.parse(await readFile(path, "utf8")) as StoredTraceMetadata;
        if (Date.parse(metadata.expiresAt) > now) return;
        await Promise.allSettled([
          unlink(this.childPath(metadata.fileName)),
          unlink(path),
        ]);
      } catch {
        const details = await stat(path).catch(() => null);
        if (details && now - details.mtimeMs > this.ttlMs) await unlink(path).catch(() => {});
      }
    }));
  }

  private async storageUsage(): Promise<{ count: number; bytes: number }> {
    const entries = await readdir(this.rootDir, { withFileTypes: true });
    let count = 0;
    let bytes = 0;
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.endsWith(".metadata.json") || entry.name.endsWith(".partial")) continue;
      const details = await stat(this.childPath(entry.name)).catch(() => null);
      if (!details) continue;
      count += 1;
      bytes += details.size;
    }
    return { count, bytes };
  }
}
