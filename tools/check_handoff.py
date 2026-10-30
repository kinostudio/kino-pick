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
    "docs/API_CONTRACT.md", "docs/GUEST_SELECTION.md", "docs/INVITATION_FLOW.md", "docs/GUEST_FEEDBACK.md", "docs/GUEST_TAGS.md", "docs/GUEST_HISTORY.md", "docs/PHOTO_VERSION_HEADS.md", "docs/GUEST_VERSION_COMPARISON.md", "docs/GUEST_COMMENTS.md", "docs/GUEST_ANNOTATIONS.md", "docs/OWNER_COMMENTS.md", "docs/OWNER_ANNOTATIONS.md", "docs/ANNOTATION_PROCESSING.md", "docs/OWNER_HISTORY.md", "docs/MATCHING_FILENAME_INDEX.md", "docs/INDEXED_VERSION_MATCHING.md", "docs/ASSISTED_CANDIDATE_CATALOG.md", "docs/MATCHING_RULES.md", "docs/RESOLVED_BATCH_UPLOADS.md", "docs/COMMENT_PROCESSING.md", "docs/VERSION_UPLOADS.md", "docs/PROJECT_VERSIONING.md", "docs/RESOLVED_UPLOADS.md", "docs/OWNER_INTENT_CLAIMS.md", "docs/SELECTION_POLICY.md", "docs/SHARED_SELECTION.md", "docs/UX_UI.md", "docs/SECURITY.md",
    "docs/TEST_ACCEPTANCE.md", "docs/ROADMAP.md", "docs/TASKS.md",
    "docs/HANDOFF.md", "docs/DECISIONS.md", "docs/CHANGELOG.md",
    "docs/CODEX_ARCHITECTURE_ADDENDUM.md", "docs/ADR-Cloudflare-Free-First.md",
    "docs/AUTH_SPEC.md", "docs/STORAGE_SPEC.md", "docs/DEPLOYMENT.md",
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
    "docs/MATCHING_RULES.md": ["MATCHING_RULES_ENABLED", "matchingProfile", "0051", "rollback"],
    "docs/ASSISTED_CANDIDATE_CATALOG.md": ["ASSISTED_CANDIDATE_CATALOG_ENABLED", "catalogCursor", "24", "recovery", "0050"],
    "docs/INDEXED_VERSION_MATCHING.md": ["INDEXED_VERSION_MATCHING_ENABLED", "auto_filename", "filename_index_not_ready", "Recovery", "0049"],
    "docs/MATCHING_FILENAME_INDEX.md": ["MATCHING_FILENAME_INDEX_ENABLED", "default-v1", "24", "Recovery", "0049"],
    "docs/ANNOTATION_PROCESSING.md": ["OWNER_ANNOTATION_PROCESSING_ENABLED", "expectedAnnotationRevision", "expectedProcessingRevision", "owner.annotation_processing_changed", "Recovery", "0047"],
    "docs/OWNER_ANNOTATIONS.md": ["OWNER_ANNOTATION_AUTHORING_ENABLED", "expectedOwnerId", "guestWatermark", "Recovery", "0046"],
    "docs/GUEST_ANNOTATIONS.md": ["can_annotate", "normalized_1e6", "annotations/own", "Recovery", "0045"],
    "docs/COMMENT_PROCESSING.md": ["OWNER_COMMENT_PROCESSING_ENABLED", "expectedProcessingRevision", "content revision", "Recovery", "0044"],
    "docs/OWNER_COMMENTS.md": ["authorType", "expectedParentRevision", "actor/request", "Recovery", "OWNER_COMMENTS_ENABLED"],
    "docs/GUEST_COMMENTS.md": ["GUEST_COMMENTS_ENABLED", "can_comment", "expectedRevision", "Recovery", "invitation"],
    "docs/GUEST_VERSION_COMPARISON.md": ["GUEST_VERSION_COMPARISON_ENABLED", "can_view", "can_compare_versions", "currentVersion", "Recovery"],
    "docs/RESOLVED_UPLOADS.md": ["PHOTO_VERSION_MATCHING_ENABLED", "RESOLUTION", "Forward recovery", "choice", "0041"],
    "docs/OWNER_INTENT_CLAIMS.md": ["actor/request", "R2", "preflight", "Recovery"],
    "docs/PROJECT_VERSIONING.md": ["PROJECT_VERSIONING_CONFIGURATION_ENABLED", "PROJECT_VERSIONING_REVISION_CONFLICT", "off/manual", "Recovery"],
    "docs/VERSION_UPLOADS.md": ["PHOTO_VERSION_UPLOADS_ENABLED", "versionTarget", "recovery", "forward"],
    "docs/PHOTO_VERSION_HEADS.md": ["PHOTO_VERSIONS_ENABLED", "expectedRevision", "immutable", "forward", "can_compare_versions"],
    "docs/GUEST_HISTORY.md": ["can_view_own_history", "HMAC", "watermark", "forward", "local-only"],
    "docs/GUEST_TAGS.md": ["can_tag", "expectedGuestId", "tag.added", "Forward-only"],
    "docs/SHARED_SELECTION.md": ["0030", "expectedGuestId", "can_select", "download.requested", "forward"],
    "docs/SELECTION_POLICY.md": ["0028", "shared", "private", "forward-only", "SELECTION_LIMIT_REACHED"],
    "docs/GUEST_FEEDBACK.md": ["can_rate", "can_favorite", "0027", "append", "forward-only"],
    "docs/INVITATION_FLOW.md": ["fragment", "secretAvailable", "maxUses", "no-store", "local"],
    "AGENTS.md": ["HANDOFF.md", "STORAGE_RETENTION.md", "TEST_ACCEPTANCE.md"],
    "GEMINI.md": ["AGENTS.md"],
    "docs/HANDOFF.md": ["Next", "Branch", "Task", "can_submit", "0024", "0025", "0026", "selection.submitted", "selection.reopened"],
    "docs/STORAGE_RETENTION.md": ["dry-run", "80%", "30"],
    "docs/PHOTO_VERSIONS.md": ["Before", "After", "auto_filename"],
    "docs/GUEST_ACCESS_AUDIT.md": ["append-only", "guest", "selection.removed"],
    "docs/GUEST_SELECTION.md": ["can_select", "can_submit", "0023", "0024", "0025", "0026", "selection.submitted", "append-only"],
}
for file, terms in required_words.items():
    contents = (ROOT / file).read_text(encoding="utf-8")
    for term in terms:
        if term.lower() not in contents.lower():
            print(f"ERROR {file}: missing mandatory reference {term}")
            sys.exit(1)

print(f"OK: verified {len(REQUIRED)} portable project specification files.")
print("NOTE: This validates documentation presence only; application verification must be run separately; see docs/HANDOFF.md.")
