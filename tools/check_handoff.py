#!/usr/bin/env python3
"""Basic repo portability/document sanity check (not an app test)."""
from __future__ import annotations
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = [
    "README.md", "AGENTS.md", "GEMINI.md", ".env.example", ".gitignore",
    "prompts/CODEX_MASTER_PROMPT.md", "prompts/ANTIGRAVITY_HANDOFF_PROMPT.md",
    "docs/PRD.md", "docs/ARCHITECTURE.md", "docs/STORAGE_RETENTION.md",
    "docs/PHOTO_VERSIONS.md", "docs/GUEST_ACCESS_AUDIT.md", "docs/DATA_MODEL.md",
    "docs/API_CONTRACT.md", "docs/UX_UI.md", "docs/SECURITY.md",
    "docs/TEST_ACCEPTANCE.md", "docs/ROADMAP.md", "docs/TASKS.md",
    "docs/HANDOFF.md", "docs/DECISIONS.md", "docs/CHANGELOG.md",
    "config/storage-policy.example.yaml", ".agents/skills/handoff/SKILL.md"
]
missing = [p for p in REQUIRED if not (ROOT / p).is_file()]
if missing:
    print("ERROR missing:", ", ".join(missing))
    sys.exit(1)

# Only scans example env values and document pointers. It is not comprehensive secret scanning.
env = (ROOT / ".env.example").read_text(encoding="utf-8")
possible_key = re.search(r"(?im)^[ \t]*(?:R2_SECRET_ACCESS_KEY|SUPABASE_SERVICE_ROLE_KEY|EMAIL_PROVIDER_API_KEY|APP_SESSION_ENCRYPTION_KEY)[ \t]*=[ \t]*[^\s#]+", env)
if possible_key:
    print("ERROR: .env.example appears to contain a private secret value")
    sys.exit(1)

required_words = {
    "AGENTS.md": ["HANDOFF.md", "STORAGE_RETENTION.md", "TEST_ACCEPTANCE.md"],
    "GEMINI.md": ["AGENTS.md"],
    "docs/HANDOFF.md": ["Next", "Branch", "Task"],
    "docs/STORAGE_RETENTION.md": ["dry-run", "80%", "30"],
    "docs/PHOTO_VERSIONS.md": ["Before", "After", "auto_filename"],
    "docs/GUEST_ACCESS_AUDIT.md": ["append-only", "guest", "selection.removed"],
}
for file, terms in required_words.items():
    contents = (ROOT / file).read_text(encoding="utf-8")
    for term in terms:
        if term.lower() not in contents.lower():
            print(f"ERROR {file}: missing mandatory reference {term}")
            sys.exit(1)

print(f"OK: verified {len(REQUIRED)} portable project specification files.")
print("NOTE: This validates documentation presence only; application verification must be run separately; see docs/HANDOFF.md.")
