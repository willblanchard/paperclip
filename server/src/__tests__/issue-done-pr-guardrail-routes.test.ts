import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const issueId = "11111111-1111-4111-8111-111111111111";
const companyId = "company-1";

const mockIssueService = vi.hoisted(() => ({
  addComment: vi.fn(),
  findMentionedAgents: vi.fn(),
  getById: vi.fn(),
  listComments: vi.fn(),
  update: vi.fn(),
  getWakeableParentAfterChildCompletion: vi.fn(),
  listWakeableBlockedDependents: vi.fn(),
}));

function registerModuleMocks() {
  vi.doMock("@paperclipai/shared/telemetry", () => ({
    trackAgentTaskCompleted: vi.fn(),
    trackErrorHandlerCrash: vi.fn(),
  }));

  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: vi.fn(() => ({ track: vi.fn() })),
  }));

  vi.doMock("../services/index.js", () => ({
    accessService: () => ({
      canUser: vi.fn(),
      hasPermission: vi.fn(),
    }),
    agentService: () => ({
      getById: vi.fn(),
    }),
    documentService: () => ({}),
    executionWorkspaceService: () => ({}),
    feedbackService: () => ({}),
    goalService: () => ({}),
    heartbeatService: () => ({
      wakeup: vi.fn(async () => undefined),
      reportRunActivity: vi.fn(async () => undefined),
    }),
    instanceSettingsService: () => ({}),
    issueApprovalService: () => ({}),
    issueReferenceService: () => ({
      deleteDocumentSource: async () => undefined,
      diffIssueReferenceSummary: () => ({
        addedReferencedIssues: [],
        removedReferencedIssues: [],
        currentReferencedIssues: [],
      }),
      emptySummary: () => ({ outbound: [], inbound: [] }),
      listIssueReferenceSummary: async () => ({ outbound: [], inbound: [] }),
      syncComment: async () => undefined,
      syncDocument: async () => undefined,
      syncIssue: async () => undefined,
    }),
    issueService: () => mockIssueService,
    issueThreadInteractionService: () => ({
      expireRequestConfirmationsSupersededByComment: vi.fn(async () => []),
      expireStaleRequestConfirmationsForIssueDocument: vi.fn(async () => []),
    }),
    logActivity: vi.fn(async () => undefined),
    projectService: () => ({}),
    routineService: () => ({
      syncRunStatusForIssue: vi.fn(async () => undefined),
    }),
    workProductService: () => ({}),
  }));
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: issueId,
    companyId,
    status: "in_review",
    priority: "high",
    projectId: null,
    projectWorkspaceId: "workspace-1",
    executionWorkspaceId: null,
    assigneeAgentId: "22222222-2222-4222-8222-222222222222",
    assigneeUserId: null,
    createdByUserId: "local-board",
    identifier: "WAT-1953",
    title: "Publish repo change",
    description: null,
    executionPolicy: null,
    executionState: null,
    hiddenAt: null,
    ...overrides,
  };
}

async function createApp() {
  const [{ issueRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: [companyId],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue done paperclip/main PR guardrail", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@paperclipai/shared/telemetry");
    vi.doUnmock("../telemetry.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.resetAllMocks();
    mockIssueService.getById.mockResolvedValue(makeIssue());
    mockIssueService.addComment.mockResolvedValue({
      id: "comment-new",
      companyId,
      issueId,
      body: "closeout",
      authorAgentId: null,
      authorUserId: "local-board",
      createdAt: new Date("2026-04-25T08:00:00.000Z"),
      updatedAt: new Date("2026-04-25T08:00:00.000Z"),
    });
    mockIssueService.findMentionedAgents.mockResolvedValue([]);
    mockIssueService.listComments.mockResolvedValue([]);
    mockIssueService.getWakeableParentAfterChildCompletion.mockResolvedValue(null);
    mockIssueService.listWakeableBlockedDependents.mockResolvedValue([]);
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...makeIssue(),
      ...patch,
    }));
  });

  it("rejects done when paperclip/main PR evidence says the PR is still unmerged", async () => {
    mockIssueService.listComments.mockResolvedValue([
      {
        id: "comment-1",
        body:
          "Implementation approved. Merge lane and PR: paperclip/main https://github.com/paperclipai/paperclip/pull/4437. paperclip/main merge: not merged; review required.",
      },
    ]);

    const res = await request(await createApp()).patch(`/api/issues/${issueId}`).send({
      status: "done",
      comment: "Closing after QE review.",
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("paperclip/main PR must be merged");
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });

  it("allows done when the latest paperclip/main evidence says the PR merged", async () => {
    mockIssueService.listComments.mockResolvedValue([
      {
        id: "comment-1",
        body:
          "Implementation approved. Merge lane and PR: paperclip/main https://github.com/paperclipai/paperclip/pull/4437. paperclip/main merge: not merged; review required.",
      },
    ]);

    const res = await request(await createApp()).patch(`/api/issues/${issueId}`).send({
      status: "done",
      comment:
        "Implementation status: approved. Merge lane and PR: paperclip/main https://github.com/paperclipai/paperclip/pull/4437. paperclip/main merge: merged and pushed as merge commit abc123.",
    });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      issueId,
      expect.objectContaining({ status: "done" }),
    );
  });

  it("allows done without PR evidence when the closeout gives an explicit non-repo reason", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      projectWorkspaceId: null,
      title: "Clarify process policy",
    }));

    const res = await request(await createApp()).patch(`/api/issues/${issueId}`).send({
      status: "done",
      comment: "No publishable repo changes: this was an issue-thread policy clarification only.",
    });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      issueId,
      expect.objectContaining({ status: "done" }),
    );
  });

  it("rejects in_review for repo work without a pushed commit and primary PR link", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      status: "in_progress",
    }));

    const res = await request(await createApp()).patch(`/api/issues/${issueId}`).send({
      status: "in_review",
      comment: "Ready for review. Verified locally.",
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("in_review requires pushed work");
    expect(mockIssueService.update).not.toHaveBeenCalled();
  });

  it("allows in_review for repo work when pushed commit and primary PR link are recorded", async () => {
    mockIssueService.getById.mockResolvedValue(makeIssue({
      status: "in_progress",
    }));

    const res = await request(await createApp()).patch(`/api/issues/${issueId}`).send({
      status: "in_review",
      comment:
        "Ready for review. Primary paperclip/main PR: https://github.com/paperclipai/paperclip/pull/4461. Pushed commit SHA: 35a3cc5c41628039cfa2a6cb0df0ad5a5b807a6a.",
    });

    expect(res.status).toBe(200);
    expect(mockIssueService.update).toHaveBeenCalledWith(
      issueId,
      expect.objectContaining({ status: "in_review" }),
    );
  });
});
