import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildMemoryTimelineResponse,
  toMemoryDetailsResultShape,
  toMemorySearchRequest,
} from "../domain/memory-retrieval-contract.js";
import { assertValidMemoryRef } from "../domain/memory-lifecycle.js";
import {
  buildRecommendedMcpSearchInstruction,
  RETRIEVAL_MCP_DETAILS_TOOL,
  RETRIEVAL_MCP_SEARCH_TOOL,
  RETRIEVAL_MCP_TIMELINE_TOOL
} from "../integration/retrieval-contract.js";
import { MemoryRetrievalService } from "../domain/memory-retrieval.js";
import { buildReadOnlyMemoryRetrievalService } from "../runtime/runtime-context.js";

const require = createRequire(import.meta.url);
const { version } = require("../../../package.json") as { version: string };

const retrievalScopeSchema = z.enum(["global", "project", "project-local", "all"]);
const retrievalStateSchema = z.enum(["active", "archived", "all", "auto"]);
const resolvedRetrievalStateSchema = z.enum(["active", "archived", "all"]);
const memoryRecordStateSchema = z.enum(["active", "archived"]);
const memoryHistoryRecordStateSchema = z.enum(["active", "archived", "deleted"]);
const memoryLifecycleActionSchema = z.enum(["add", "update", "delete", "archive"]);

const memorySearchResultSchema = z.object({
  ref: z.string(),
  scope: z.enum(["global", "project", "project-local"]),
  state: memoryRecordStateSchema,
  topic: z.string(),
  id: z.string(),
  summary: z.string(),
  updatedAt: z.string(),
  matchedFields: z.array(z.string()),
  approxReadCost: z.number().int().nonnegative()
});

const memorySearchDiagnosticSchema = z.object({
  scope: z.enum(["global", "project", "project-local"]),
  state: memoryRecordStateSchema,
  retrievalMode: z.enum(["index", "markdown-fallback"]),
  retrievalFallbackReason: z.enum(["missing", "invalid", "stale"]).optional(),
  matchedCount: z.number().int().nonnegative(),
  indexPath: z.string(),
  generatedAt: z.string().nullable()
});

const memorySearchResponseSchema = z.object({
  query: z.string(),
  scope: retrievalScopeSchema,
  state: retrievalStateSchema,
  resolvedState: resolvedRetrievalStateSchema,
  fallbackUsed: z.boolean(),
  retrievalMode: z.enum(["index", "markdown-fallback"]),
  retrievalFallbackReason: z.enum(["missing", "invalid", "stale"]).optional(),
  diagnostics: z.object({
    checkedPaths: z.array(memorySearchDiagnosticSchema)
  }),
  results: z.array(memorySearchResultSchema)
});

const memoryTimelineEventSchema = z.object({
  at: z.string(),
  action: memoryLifecycleActionSchema,
  scope: z.enum(["global", "project", "project-local"]),
  state: memoryHistoryRecordStateSchema,
  topic: z.string(),
  id: z.string(),
  ref: z.string().optional(),
  summary: z.string(),
  reason: z.string().optional(),
  source: z.string().optional(),
  sessionId: z.string().optional(),
  rolloutPath: z.string().optional()
});

const memoryLineageSummarySchema = z.object({
  eventCount: z.number().int().nonnegative(),
  firstSeenAt: z.string().nullable(),
  latestAt: z.string().nullable(),
  latestAction: memoryLifecycleActionSchema.nullable(),
  latestState: memoryHistoryRecordStateSchema.nullable(),
  archivedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  latestAuditStatus: z.enum(["applied", "no-op", "skipped"]).nullable(),
  noopOperationCount: z.number().int().nonnegative(),
  suppressedOperationCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative()
});

const memoryTimelineResponseSchema = z.object({
  ref: z.string(),
  events: z.array(memoryTimelineEventSchema),
  warnings: z.array(z.string()),
  lineageSummary: memoryLineageSummarySchema
});

const memoryDetailsResponseSchema = z.object({
  ref: z.string(),
  scope: z.enum(["global", "project", "project-local"]),
  state: memoryRecordStateSchema,
  topic: z.string(),
  id: z.string(),
  path: z.string(),
  approxReadCost: z.number().int().nonnegative(),
  latestLifecycleAction: memoryLifecycleActionSchema.nullable(),
  latestState: memoryHistoryRecordStateSchema,
  latestSessionId: z.string().nullable(),
  latestRolloutPath: z.string().nullable(),
  historyPath: z.string(),
  timelineWarningCount: z.number().int().nonnegative(),
  lineageSummary: memoryLineageSummarySchema,
  warnings: z.array(z.string()),
  latestAudit: z
    .object({
      auditPath: z.string(),
      appliedAt: z.string(),
      rolloutPath: z.string(),
      sessionId: z.string().optional(),
      status: z.enum(["applied", "no-op", "skipped"]),
      resultSummary: z.string(),
      noopOperationCount: z.number().int().nonnegative(),
      suppressedOperationCount: z.number().int().nonnegative(),
      conflicts: z.array(
        z.object({
          scope: z.enum(["global", "project", "project-local"]),
          topic: z.string(),
          candidateSummary: z.string(),
          conflictsWith: z.array(z.string()),
          source: z.enum(["within-rollout", "existing-memory"]),
          resolution: z.literal("suppressed")
        })
      )
    })
    .nullable(),
  entry: z.object({
    id: z.string(),
    scope: z.enum(["global", "project", "project-local"]),
    topic: z.string(),
    summary: z.string(),
    details: z.array(z.string()),
    updatedAt: z.string(),
    sources: z.array(z.string()),
    reason: z.string().optional()
  })
});

async function withRetrievalService<T>(
  cwd: string,
  handler: (retrieval: MemoryRetrievalService) => Promise<T>
): Promise<T> {
  const retrieval = await buildReadOnlyMemoryRetrievalService(cwd);
  return handler(retrieval);
}

function createJsonResult<T extends Record<string, unknown>>(payload: T): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: T;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

export function createRetrievalMcpServer(cwd = process.cwd()): McpServer {
  const server = new McpServer({
    name: "codex-auto-memory-retrieval",
    version
  });

  server.registerTool(
    RETRIEVAL_MCP_SEARCH_TOOL,
    {
      title: "Search durable memories",
      description:
        `Search compact durable-memory candidates without loading full Markdown details. ${buildRecommendedMcpSearchInstruction()}`,
      inputSchema: z.object({
        query: z.string().min(1),
        scope: retrievalScopeSchema.optional(),
        state: retrievalStateSchema.optional(),
        limit: z.number().int().positive().max(100).optional()
      }),
      outputSchema: memorySearchResponseSchema
    },
    async ({ query, scope, state, limit }) => {
      const request = toMemorySearchRequest({
        query,
        scope,
        state,
        limit
      });

      const payload = await withRetrievalService(cwd, async (retrieval) => {
        const response = await retrieval.searchMemories(request.query, {
          scope: request.scope,
          state: request.state,
          limit: request.limit
        });

        return memorySearchResponseSchema.parse(response);
      });

      return createJsonResult(payload);
    }
  );

  server.registerTool(
    RETRIEVAL_MCP_TIMELINE_TOOL,
    {
      title: "Inspect memory timeline",
      description:
        "Read lifecycle history for a specific durable-memory ref, including archive or delete transitions.",
      inputSchema: z.object({
        ref: z.string().min(1)
      }),
      outputSchema: memoryTimelineResponseSchema
    },
    async ({ ref }) => {
      assertValidMemoryRef(ref);
      const payload = await withRetrievalService(cwd, async (retrieval) => {
        const events = await retrieval.timelineMemories(ref);
        return memoryTimelineResponseSchema.parse(buildMemoryTimelineResponse(ref, events));
      });

      return createJsonResult(payload);
    }
  );

  server.registerTool(
    RETRIEVAL_MCP_DETAILS_TOOL,
    {
      title: "Get memory details",
      description:
        "Fetch the full Markdown-backed durable-memory details for a specific ref.",
      inputSchema: z.object({
        ref: z.string().min(1)
      }),
      outputSchema: memoryDetailsResponseSchema
    },
    async ({ ref }) => {
      assertValidMemoryRef(ref);
      const payload = await withRetrievalService(cwd, async (retrieval) => {
        const details = await retrieval.getMemoryDetails(ref);
        if (!details) {
          throw new Error(`No memory details were found for ref "${ref}".`);
        }

        return memoryDetailsResponseSchema.parse(toMemoryDetailsResultShape(details));
      });

      return createJsonResult(payload);
    }
  );

  return server;
}

export async function startRetrievalMcpServer(cwd = process.cwd()): Promise<void> {
  const server = createRetrievalMcpServer(cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
