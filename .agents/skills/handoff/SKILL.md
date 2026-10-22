---
name: handoff
summary: Verify the repository state and generate a reproducible Codex-Antigravity handoff.
---

# Handoff skill

When asked to hand off KINO Pic between agents:

1. Read root `AGENTS.md`, `docs/HANDOFF.md`, `docs/TASKS.md`, `docs/DECISIONS.md`.
2. Inspect `git status --short`, current branch and last commits; do not assume all work is committed.
3. Run existing lint/typecheck/test/build (if available) and `python tools/check_handoff.py`; record only commands actually executed.
4. Update tasks checked after real validation, then append a dated record using `docs/HANDOFF.md` template, highlighting worktree/branch, modified files, migration risk, actual test output and next smallest task.
5. If destructive R2 maintenance is involved, confirm production policy remains disabled unless user explicitly opted in and dry-run/permissions were reviewed.
6. Include next operator copy-paste command and any needed environment variables by their names, not values.
