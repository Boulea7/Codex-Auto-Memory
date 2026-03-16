import fs from "node:fs/promises";
import path from "node:path";
import { APP_ID } from "../constants.js";
import type {
  AppConfig,
  ProjectContext,
  SessionContinuityAuditEntry,
  SessionContinuityLocation,
  SessionContinuityPaths,
  SessionContinuityScope,
  SessionContinuityState,
  SessionContinuitySummary
} from "../types.js";
import { appendJsonl, fileExists, readTextFile, writeTextFile } from "../util/fs.js";
import { getDefaultMemoryDirectory } from "./project-context.js";
import {
  applySessionContinuityLayerSummary,
  createEmptySessionContinuityState,
  mergeSessionContinuityStates,
  parseSessionContinuity,
  renderSessionContinuity
} from "./session-continuity.js";

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export class SessionContinuityStore {
  public readonly paths: SessionContinuityPaths;

  public constructor(
    private readonly project: ProjectContext,
    private readonly config: AppConfig
  ) {
    const baseDir = config.autoMemoryDirectory ?? getDefaultMemoryDirectory();
    const auditDir = path.join(baseDir, "projects", project.projectId, "audit");
    const codexSessionDir = path.join(project.projectRoot, `.${APP_ID}`, "sessions");
    const claudeSessionDir = path.join(project.projectRoot, ".claude", "sessions");
    const localDir =
      config.sessionContinuityLocalPathStyle === "claude" ? claudeSessionDir : codexSessionDir;
    const localFile =
      config.sessionContinuityLocalPathStyle === "claude"
        ? path.join(localDir, `${todayStamp()}-${project.worktreeId.slice(-8)}-session.tmp`)
        : path.join(localDir, "active.md");

    this.paths = {
      sharedDir: path.join(baseDir, "projects", project.projectId, "continuity", "project"),
      sharedFile: path.join(baseDir, "projects", project.projectId, "continuity", "project", "active.md"),
      localDir,
      localFile,
      claudeSessionDir,
      codexSessionDir,
      auditDir,
      auditFile: path.join(auditDir, "session-continuity-log.jsonl")
    };
  }

  public async ensureSharedLayout(): Promise<void> {
    await fs.mkdir(this.paths.sharedDir, { recursive: true });
  }

  public async ensureLocalLayout(): Promise<void> {
    await fs.mkdir(this.paths.localDir, { recursive: true });
  }

  public async ensureAuditLayout(): Promise<void> {
    await fs.mkdir(this.paths.auditDir, { recursive: true });
  }

  public async ensureLocalIgnore(): Promise<string | null> {
    if (!this.project.gitDir) {
      return null;
    }

    const excludePath = path.join(this.project.gitDir, "info", "exclude");
    const line =
      this.config.sessionContinuityLocalPathStyle === "claude"
        ? ".claude/sessions/"
        : `.${APP_ID}/`;
    const current = (await fileExists(excludePath)) ? await readTextFile(excludePath) : "";
    const lines = new Set(current.split("\n").filter(Boolean));
    if (lines.has(line)) {
      return excludePath;
    }

    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    const next = `${current.trimEnd()}${current.trimEnd() ? "\n" : ""}${line}\n`;
    await fs.writeFile(excludePath, next, "utf8");
    return excludePath;
  }

  public async getLocation(scope: SessionContinuityScope): Promise<SessionContinuityLocation> {
    if (scope === "project") {
      return {
        scope,
        path: this.paths.sharedFile,
        exists: await fileExists(this.paths.sharedFile)
      };
    }

    const localPath = await this.resolveLocalReadPath();
    return {
      scope,
      path: localPath ?? this.paths.localFile,
      exists: localPath ? await fileExists(localPath) : false
    };
  }

  public async readState(scope: SessionContinuityScope): Promise<SessionContinuityState | null> {
    const location = await this.getLocation(scope);
    if (!location.exists) {
      return null;
    }

    const raw = await readTextFile(location.path);
    return parseSessionContinuity(raw, {
      scope,
      projectId: this.project.projectId,
      worktreeId: this.project.worktreeId
    });
  }

  public async readMergedState(): Promise<SessionContinuityState | null> {
    const shared = await this.readState("project");
    const local = await this.readState("project-local");
    if (!shared && !local) {
      return null;
    }
    if (local && shared) {
      return mergeSessionContinuityStates(local, shared);
    }

    return local ?? shared;
  }

  public async saveSummary(
    summary: SessionContinuitySummary,
    scope: SessionContinuityScope | "both"
  ): Promise<string[]> {
    const written: string[] = [];
    const targets =
      scope === "both" ? (["project", "project-local"] satisfies SessionContinuityScope[]) : [scope];

    for (const target of targets) {
      if (target === "project") {
        await this.ensureSharedLayout();
      } else {
        await this.ensureLocalLayout();
        await this.ensureLocalIgnore();
      }

      const existing = await this.readState(target);
      const base =
        existing ?? createEmptySessionContinuityState(target, this.project.projectId, this.project.worktreeId);
      const nextLayerSummary =
        target === "project" ? summary.project : summary.projectLocal;
      const nextState = applySessionContinuityLayerSummary(
        base,
        nextLayerSummary,
        summary.sourceSessionId
      );
      const filePath =
        target === "project" ? this.paths.sharedFile : await this.resolveLocalWritePath();
      await writeTextFile(filePath, renderSessionContinuity(nextState));
      written.push(filePath);
    }

    return written;
  }

  public async clear(scope: SessionContinuityScope | "both"): Promise<string[]> {
    const cleared: string[] = [];
    const targets =
      scope === "both" ? (["project", "project-local"] satisfies SessionContinuityScope[]) : [scope];

    for (const target of targets) {
      if (target === "project") {
        if (await fileExists(this.paths.sharedFile)) {
          await fs.rm(this.paths.sharedFile, { force: true });
          cleared.push(this.paths.sharedFile);
        }
        continue;
      }

      if (this.config.sessionContinuityLocalPathStyle === "claude") {
        if (!(await fileExists(this.paths.localDir))) {
          continue;
        }
        const files = await fs.readdir(this.paths.localDir);
        for (const fileName of files.filter((name) => name.endsWith("-session.tmp"))) {
          const filePath = path.join(this.paths.localDir, fileName);
          await fs.rm(filePath, { force: true });
          cleared.push(filePath);
        }
        continue;
      }

      if (await fileExists(this.paths.localFile)) {
        await fs.rm(this.paths.localFile, { force: true });
        cleared.push(this.paths.localFile);
      }
    }

    return cleared;
  }

  public async appendAuditLog(payload: SessionContinuityAuditEntry): Promise<void> {
    await this.ensureAuditLayout();
    await appendJsonl(this.paths.auditFile, payload);
  }

  public async readRecentAuditEntries(limit = 5): Promise<SessionContinuityAuditEntry[]> {
    if (!(await fileExists(this.paths.auditFile))) {
      return [];
    }

    const raw = await readTextFile(this.paths.auditFile);
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as SessionContinuityAuditEntry];
        } catch {
          return [];
        }
      })
      .slice(-limit)
      .reverse();
  }

  public async readLatestAuditEntry(): Promise<SessionContinuityAuditEntry | null> {
    return (await this.readRecentAuditEntries(1))[0] ?? null;
  }

  private async resolveLocalReadPath(): Promise<string | null> {
    if (this.config.sessionContinuityLocalPathStyle !== "claude") {
      return (await fileExists(this.paths.localFile)) ? this.paths.localFile : null;
    }
    if (!(await fileExists(this.paths.localDir))) {
      return null;
    }

    const candidates = (await fs.readdir(this.paths.localDir))
      .filter((fileName) => fileName.endsWith("-session.tmp"))
      .map((fileName) => path.join(this.paths.localDir, fileName));
    if (candidates.length === 0) {
      return null;
    }

    const entries = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        stat: await fs.stat(candidate)
      }))
    );
    entries.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
    return entries[0]?.candidate ?? null;
  }

  private async resolveLocalWritePath(): Promise<string> {
    if (this.config.sessionContinuityLocalPathStyle !== "claude") {
      return this.paths.localFile;
    }

    await this.ensureLocalLayout();
    return this.paths.localFile;
  }
}
