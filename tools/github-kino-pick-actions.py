"""Fixed-repository Actions coordination; existing Git credentials stay in memory."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
REPO = "kinostudio/kino-pick"
parser = argparse.ArgumentParser()
parser.add_argument("action", choices=["ci", "deployment", "jobs", "dispatch"])
parser.add_argument("value")
args = parser.parse_args()
if args.action == "jobs":
    assert re.fullmatch(r"[1-9][0-9]{0,15}", args.value)
else:
    assert re.fullmatch(r"[a-f0-9]{40}", args.value)

env = os.environ.copy()
env.update(GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="Never")
credential = subprocess.run(
    ["git", "credential", "fill"], cwd=ROOT,
    input="protocol=https\nhost=github.com\npath=kinostudio/kino-pick.git\n\n",
    encoding="utf-8", stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
    check=False,
)
if credential.returncode:
    raise SystemExit("Existing Git credential unavailable; no values printed.")
values = dict(line.split("=", 1) for line in credential.stdout.splitlines() if "=" in line)
if not values.get("password"):
    raise SystemExit("Existing Git credential unavailable; no values printed.")
env["GH_TOKEN"] = values["password"]
env.pop("XDG_CONFIG_HOME", None)

def api(path, payload=None):
    assert path.startswith("repos/" + REPO + "/")
    command = ["gh", "api", path]
    if payload is not None:
        command += ["--method", "POST", "--input", "-"]
    result = subprocess.run(
        command, cwd=ROOT, env=env, encoding="utf-8",
        input=None if payload is None else json.dumps(payload),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode:
        raise SystemExit("GitHub request failed; credential and response details withheld.")
    return json.loads(result.stdout) if result.stdout.strip() else None

if args.action == "dispatch":
    api("repos/" + REPO + "/actions/workflows/deploy-collaboration-validation.yml/dispatches",
        {"ref": "main", "inputs": {"source_sha": args.value}})
    print(json.dumps({"status": "dispatched", "sourceSha": args.value, "repository": REPO}))
elif args.action == "jobs":
    data = api("repos/" + REPO + "/actions/runs/" + args.value + "/jobs")
    print(json.dumps({"jobs": [{"name": job["name"], "status": job["status"],
        "conclusion": job["conclusion"], "steps": [{k: step.get(k) for k in
        ["name", "status", "conclusion"]} for step in job.get("steps", [])
        if step.get("status") != "completed" or step.get("conclusion") != "success"]}
        for job in data.get("jobs", [])]}))
else:
    workflow = "ci.yml" if args.action == "ci" else "deploy-collaboration-validation.yml"
    data = api("repos/" + REPO + "/actions/workflows/" + workflow +
               "/runs?head_sha=" + args.value + "&per_page=5")
    runs = [{k: run.get(k) for k in ["id", "head_sha", "event", "status", "conclusion", "html_url"]}
            for run in data.get("workflow_runs", []) if run.get("head_sha") == args.value]
    print(json.dumps({"repository": REPO, "workflow": workflow, "runs": runs}))
    if args.action == "ci":
        passed = next((run for run in runs if run["status"] == "completed" and
                       run["conclusion"] == "success" and run["event"] == "push"), None)
        if passed:
            proof = {"status": "completed", "conclusion": "success", "headSha": args.value,
                     "runId": passed["id"], "url": passed["html_url"], "repository": REPO}
            target = ROOT / "apps/worker/.local/collaboration-release-ci-proof.json"
            target.write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
