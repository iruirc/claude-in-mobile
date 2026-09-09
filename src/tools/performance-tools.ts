/**
 * Performance & Crash Monitor tools.
 *
 * Provides Performance Lab handlers for metrics, baselines, monitoring,
 * crashes, Android framestats, native traces, heap snapshots, and heap diffs.
 */

import type { ToolDefinition } from "./registry.js";
import { performanceSnapshot } from "./performance/snapshot.js";
import { performanceBaseline } from "./performance/baseline.js";
import { performanceCompare } from "./performance/compare.js";
import { performanceMonitor } from "./performance/monitor.js";
import { performanceCrashes } from "./performance/crashes.js";
import { performanceFramestats } from "./performance/framestats.js";
import {
  performanceTraceDelete,
  performanceTraceStart,
  performanceTraceStatus,
  performanceTraceStop,
} from "./performance/trace.js";
import {
  performanceHeapCapture,
  performanceHeapDelete,
  performanceHeapDiff,
} from "./performance/heap.js";

export const performanceTools: ToolDefinition[] = [
  performanceSnapshot,
  performanceBaseline,
  performanceCompare,
  performanceMonitor,
  performanceCrashes,
  performanceFramestats,
  performanceTraceStart,
  performanceTraceStop,
  performanceTraceStatus,
  performanceTraceDelete,
  performanceHeapCapture,
  performanceHeapDiff,
  performanceHeapDelete,
];
