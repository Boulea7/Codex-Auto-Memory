import { z } from "zod";
import { DEFAULT_SESSION_CONTINUITY_LINE_LIMIT } from "../constants.js";

export const appConfigSchema = z.object({
  autoMemoryEnabled: z.boolean().default(true),
  autoMemoryDirectory: z.string().optional(),
  extractorMode: z.enum(["codex", "heuristic"]).default("codex"),
  defaultScope: z.enum(["project", "project-local"]).default("project"),
  maxStartupLines: z.number().int().positive().max(400).default(200),
  sessionContinuityAutoLoad: z.boolean().default(false),
  sessionContinuityAutoSave: z.boolean().default(false),
  sessionContinuityLocalPathStyle: z.enum(["codex", "claude"]).default("codex"),
  maxSessionContinuityLines: z
    .number()
    .int()
    .positive()
    .max(200)
    .default(DEFAULT_SESSION_CONTINUITY_LINE_LIMIT),
  dreamSidecarEnabled: z.boolean().default(false),
  dreamSidecarAutoBuild: z.boolean().default(false),
  codexBinary: z.string().min(1).default("codex")
});

export const rawProjectConfigSchema = z.object({
  autoMemoryEnabled: z.boolean().optional(),
  extractorMode: z.enum(["codex", "heuristic"]).optional(),
  defaultScope: z.enum(["project", "project-local"]).optional(),
  maxStartupLines: z.number().int().positive().max(400).optional(),
  sessionContinuityAutoLoad: z.boolean().optional(),
  sessionContinuityAutoSave: z.boolean().optional(),
  sessionContinuityLocalPathStyle: z.enum(["codex", "claude"]).optional(),
  maxSessionContinuityLines: z.number().int().positive().max(200).optional(),
  dreamSidecarEnabled: z.boolean().optional(),
  dreamSidecarAutoBuild: z.boolean().optional(),
  codexBinary: z.string().min(1).optional(),
  autoMemoryDirectory: z.string().optional()
});

export type RawProjectConfig = z.infer<typeof rawProjectConfigSchema>;
