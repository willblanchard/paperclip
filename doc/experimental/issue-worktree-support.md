# Issue worktree support

Status: experimental, runtime-only, not shipping as a user-facing feature yet.

This branch contains the runtime and seeding work needed for issue-scoped worktrees:

- project execution workspace policy support
- issue-level execution workspace settings
- git worktree realization for isolated issue execution
- optional command-based worktree provisioning
- seeded worktree fixes for secrets key compatibility
- seeded project workspace rebinding to the current git worktree

We are intentionally not shipping the UI for this yet. The runtime code remains in place, but the main UI entrypoints are hard-gated off for now.

## What works today

- projects can carry execution workspace policy in the backend
- issues can carry execution workspace settings in the backend
- heartbeat execution can realize isolated git worktrees
- runtime can run a project-defined provision command inside the derived worktree
- seeded worktree instances can keep local-encrypted secrets working
- seeded worktree instances can rebind same-repo project workspace paths onto the current git worktree

## Large-repo Worktree Lifecycle Policy

Paperclip-owned issue and review worktrees should be execution workspaces, not agent-owned scratch directories. For worktrees created through the execution workspace runtime, the execution workspace record is the source of truth for:

- owner: the Paperclip company/project plus the issue linked through `sourceIssueId` and `issues.executionWorkspaceId`
- linked work: the issue identifier, branch name, base ref, project workspace, and any PR link carried in the issue thread
- creation and use time: `openedAt`, `createdAt`, and `lastUsedAt`
- cleanup eligibility: `closedAt`, `cleanupEligibleAt`, `cleanupReason`, and workspace `status`
- provider ownership: `providerType: "git_worktree"` plus `metadata.createdByRuntime: true` means Paperclip may remove the derived worktree after close-readiness passes

Some existing large-repo worktrees were created by local agent workflows before execution workspace records covered every path. Examples include superpowers or agent-created worktrees under `/tmp` with names derived from issue branches. Those worktrees are still in scope for stale-worktree prevention, but they are not automatically safe to delete. Until they are adopted into execution workspace records or carry explicit Paperclip ownership metadata, they use a report-only lifecycle:

- owner discovery: infer the repository from `git rev-parse --show-toplevel`, the branch or detached commit from `git status --branch --porcelain=v2`, and the creating workflow from path markers such as `/tmp`, `.paperclip/worktrees`, `paperclip/`, `wat-`, or adapter-specific worktree roots
- linked work discovery: parse `WAT-\d+` or project issue keys from the branch name, worktree basename, PR branch, or recent commit subjects, then query matching Paperclip issues and PR links
- active-work guardrail: if any inferred linked issue is non-terminal, the row remains active and report-only regardless of age
- missing-link guardrail: if no issue or PR can be inferred, the row is reported as orphaned but not deleted
- retention: clean, linked, terminal non-execution worktrees are stale after 24 hours; review-shaped worktrees are stale after 7 days; unknown-owner rows stay report-only until an operator records ownership or removes them manually
- dirty-work guardrails: dirty tracked files, untracked files, unpushed commits, detached heads, unresolved merges, inaccessible git status, missing upstream/base refs, or running processes with `cwd` inside the worktree all block deletion
- deletion policy: non-execution worktrees are never deleted by the automatic release/completion cleanup path. A later cleanup implementation may delete them only after adopting them into an execution workspace record or recording equivalent owner, issue, creation time, and Paperclip-created metadata.

Retention defaults for large local worktrees:

- active or linked to open issue: keep; report size and readiness only
- clean, idle, Paperclip-created issue worktree: eligible for cleanup after 24 hours
- in review: keep for 7 days unless a reviewer explicitly archives the workspace earlier
- `cleanup_failed`: keep until an operator resolves the reported reason
- shared/project-primary workspace: never delete the underlying project checkout; archive only the execution workspace record
- non-execution Paperclip/agent worktree: report when stale by the windows above, but do not delete until ownership metadata is explicit

Close and cleanup must use the execution workspace close-readiness report before deleting anything. The report includes linked open issues, runtime services, git dirty state, untracked files, ahead/behind counts, merge status, and planned cleanup actions. Destructive archive is blocked for isolated git worktrees when:

- the workspace is linked to any non-terminal issue
- tracked files are modified
- untracked files are present
- commits are ahead of the base ref and not merged
- git status cannot be inspected

The lower-level cleanup helper also refuses to remove a git worktree when `git status --porcelain --untracked-files=all` is non-empty, so direct callers report dirty worktrees instead of deleting them. If a worktree is clean and Paperclip owns it, cleanup removes the git worktree and then attempts to delete the runtime-created branch with `git branch -d`; unmerged branches are reported and kept.

Safe stale-worktree reporting should list, but not delete, execution-workspace candidate `/tmp` worktrees matching all of:

- provider is `git_worktree`
- workspace path resolves under `/tmp` or the platform temp directory
- status is `idle`, `in_review`, or `cleanup_failed`, or `lastUsedAt` is older than the retention window
- close-readiness is not `ready`

Each row should include workspace id, issue identifier, owner agent if known, path, branch, base ref, opened/last-used time, approximate path size, readiness state, blocking reasons, and planned actions. Deletion is only allowed by the archive/close path after readiness returns `ready` or `ready_with_warnings`; blocked rows remain report-only.

The same stale report should also scan registered large-repo roots and platform temp worktree roots for non-execution git worktrees. These rows should include source `non_execution_git_worktree`, inferred repository, inferred issue or PR, owner agent if known, path, branch or detached commit, upstream/base ref, last filesystem activity, approximate path size, git cleanliness, ahead/unpushed status, active process hints, and why the row is report-only. They are stale signals for operators and future adoption work, not deletion candidates.

Successful release/completion behavior: when a Paperclip-owned isolated worktree is closed, the server archives the execution workspace record, stops attached runtime services, runs configured cleanup/teardown commands, removes the clean git worktree, and records any cleanup warning in `cleanupReason`. If release/completion does not explicitly archive the workspace, the stale-worktree report is the follow-up mechanism that makes the retention breach visible before manual or scheduled archive.

## Hidden UI entrypoints

These are the current user-facing UI surfaces for the feature, now intentionally disabled:

- project settings:
  - `ui/src/components/ProjectProperties.tsx`
  - execution workspace policy controls
  - git worktree base ref / branch template / parent dir
  - provision / teardown command inputs

- issue creation:
  - `ui/src/components/NewIssueDialog.tsx`
  - isolated issue checkout toggle
  - defaulting issue execution workspace settings from project policy

- issue editing:
  - `ui/src/components/IssueProperties.tsx`
  - issue-level workspace mode toggle
  - defaulting issue execution workspace settings when project changes

- agent/runtime settings:
  - `ui/src/adapters/runtime-json-fields.tsx`
  - runtime services JSON field, which is part of the broader workspace-runtime support surface

## Why the UI is hidden

- the runtime behavior is still being validated
- the workflow and operator ergonomics are not final
- we do not want to expose a partially-baked user-facing feature in issues, projects, or settings

## Re-enable plan

When this is ready to ship:

- re-enable the gated UI sections in the files above
- review wording and defaults for project and issue controls
- decide which agent/runtime settings should remain advanced-only
- add end-to-end product-level verification for the full UI workflow
