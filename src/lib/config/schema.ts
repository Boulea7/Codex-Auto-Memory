import { z } from "zod";

export const appConfigSchema = z.object({
  autoMemoryEnabled: z.boolean().default(true),
  autoMemoryDirectory: z.string().optional(),
  extractorMode: z.enum(["codex", "heuristic"]).default("codex"),
  defaultScope: z.enum(["project", "project-local"]).default("project"),
  maxStartupLines: z.number().int().positive().max(400).default(200),
  codexBinary: z.string().min(1).default("codex")
});

export const rawProjectConfigSchema = z.object({
  autoMemoryEnabled: z.boolean().optional(),
  extractorMode: z.enum(["codex", "heuristic"]).optional(),
  defaultScope: z.enum(["project", "project-local"]).optional(),
  maxStartupLines: z.number().int().positive().max(400).optional(),
  codexBinary: z.string().min(1).optional(),
  autoMemoryDirectory: z.string().optional()
});

export type RawProjectConfig = z.infer<typeof rawProjectConfigSchema>;

