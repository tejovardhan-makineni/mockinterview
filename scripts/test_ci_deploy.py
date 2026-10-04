#!/usr/bin/env python3
"""Exercise the real promotion/rollback shell with isolated, offline cloud CLIs."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PREVIOUS_TRAFFIC = "previous-a=60,previous-b=40"

# Every network-capable command used by ci-deploy is replaced. Unknown commands
# fail closed, and no user credentials or cloud configuration enter this env.
FAKE_CLI = r'''
import json, os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
base = pathlib.Path(os.environ["FAKE_ROOT"])
state_path = base / "state.json"
state = json.loads(state_path.read_text())
failures = set(json.loads(os.environ["FAKE_FAILURES"]))
sha = os.environ["RELEASE_SHA"]

def save():
    state_path.write_text(json.dumps(state))

def event(label):
    with (base / "events.jsonl").open("a") as out:
        out.write(json.dumps({"event": label, "command": name, "args": args}) + "\n")

def finish(label, output=None):
    event(label)
    save()
    if label in failures:
        print("Simulated command failure: " + label, file=sys.stderr)
        sys.exit(9)
    if output is not None:
        print(json.dumps(output) if not isinstance(output, str) else output)
    sys.exit(0)

def option(flag):
    return args[args.index(flag) + 1]

if name == "node":
    if args and args[0] == "scripts/github-release.mjs":
        assert args[1:] == ["gate", "--required"], "Serving changes require a strict security recheck"
        state["gates"] += 1
        finish("gate" if state["gates"] == 1 else "regate")
    # Only execute this repository's inline JSON receipt writers with real Node.
    assert args[:2] == ["--input-type=module", "-e"]
    os.execv(os.environ["REAL_NODE"], [os.environ["REAL_NODE"], *args])
elif name == "docker":
    assert args[0] in ("tag", "push")
    finish("image-" + args[0])
elif name == "gcloud":
    if args[:2] == ["auth", "configure-docker"]:
        finish("registry-auth")
    if args[:4] == ["artifacts", "docker", "images", "describe"]:
        finish("image-digest", "sha256:" + "b" * 64)
    if args[:3] == ["run", "services", "describe"]:
        finish("service-read", {"status": {"traffic": [
            {"revisionName": "previous-a", "percent": 60},
            {"revisionName": "previous-b", "percent": 40},
            {"revisionName": "candidate", "percent": 0, "tag": "candidate", "url": "https://candidate.example.test"},
        ]}})
    if args[:3] == ["run", "services", "update"]:
        assert "--no-traffic" in args
        assert option("--image").endswith("@sha256:" + "b" * 64), "Candidate must use an immutable digest"
        finish("api-candidate")
    if args[:3] == ["run", "services", "update-traffic"]:
        traffic = option("--to-revisions")
        label = "api-rollback" if traffic == "previous-a=60,previous-b=40" else "api-promote"
        # A promotion command can mutate the server and then report a failure.
        # Rollback must still execute even when that command returns nonzero.
        if label not in failures or label == "api-promote":
            state["traffic"] = traffic
        finish(label)
elif name == "firebase":
    if args[0] == "hosting:channel:deploy":
        finish("web-candidate", {"result": {"mockinterview-web": {"url": "https://preview.example.test"}}})
    if args[0] == "hosting:clone":
        source, target = args[1:3]
        if source.endswith(":live"):
            state["backup"] = state["web"]
            finish("web-backup")
        label = "web-rollback" if ":rollback-" in source else "web-promote"
        assert target == "mockinterview-web:live"
        if label not in failures or label == "web-promote":
            state["web"] = state["backup"] if label == "web-rollback" else sha
        finish(label)
elif name == "curl":
    url = args[-1]
    if url.startswith("https://candidate.example.test/"):
        finish("candidate-health", {"ready": True, "llm_stub": False, "release": sha})
    if url.startswith("https://preview.example.test/"):
        finish("preview-health", {"commit": sha, "version": os.environ["RELEASE_VERSION"]})
    if url.startswith("https://mockinterview.live/"):
        finish("public-web-health", {"commit": sha})
    if url.startswith("https://api.example.test/"):
        event("public-api-health")
        print(json.dumps({"ready": "public-api-health" not in failures, "release": sha}))
        sys.exit(0)
raise AssertionError("Unexpected command: " + repr((name, args)))
'''


class CIDeployTest(unittest.TestCase):
    def run_deployment(self, *failures):
        with tempfile.TemporaryDirectory(prefix="mockinterview-ci-deploy-") as tmp:
            folder = Path(tmp)
            fake_bin = folder / "bin"
            fake_bin.mkdir()
            (folder / "web/out").mkdir(parents=True)
            fake = fake_bin / "fake_cli.py"
            fake.write_text("#!" + sys.executable + "\n" + FAKE_CLI)
            fake.chmod(0o755)
            for name in ["node", "gcloud", "docker", "npm", "firebase", "curl"]:
                (fake_bin / name).symlink_to(fake)
            (folder / "state.json").write_text(json.dumps({
                "traffic": PREVIOUS_TRAFFIC, "web": "previous-web", "gates": 0,
            }))
            node = shutil.which("node")
            self.assertIsNotNone(node, "Node must be installed to write release receipts")
            environment = {
                "PATH": str(fake_bin) + os.pathsep + os.environ["PATH"],
                "FAKE_ROOT": str(folder), "FAKE_FAILURES": json.dumps(failures), "REAL_NODE": node,
                "FIREBASE_CLI": str(fake_bin / "firebase"),
                "GCP_PROJECT": "storybytes-495010", "GCP_REGION": "us-west1",
                "GCP_API_SERVICE": "mockinterview-api", "GCP_IMAGE_REPOSITORY": "test-images",
                "FIREBASE_PROJECT": "storybytes-495010", "FIREBASE_SITE": "mockinterview-web",
                "WEB_API_BASE": "https://api.example.test", "WEB_PUBLIC_URL": "https://mockinterview.live",
                "RELEASE_SHA": "a" * 40, "RELEASE_VERSION": "1.2.3",
                "GITHUB_RUN_ID": "12345", "GITHUB_RUN_ATTEMPT": "2",
            }
            result = subprocess.run(
                ["bash", str(ROOT / "deploy/ci-deploy.sh")], cwd=folder,
                env=environment, capture_output=True, text=True, timeout=20,
            )
            events = [json.loads(line)["event"] for line in (folder / "events.jsonl").read_text().splitlines()]
            state = json.loads((folder / "state.json").read_text())
            receipt_path = folder / "deployment-receipt.json"
            receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else None
            return result, events, state, receipt

    def test_success_checks_candidates_and_rechecks_security_before_promotion(self):
        result, events, state, receipt = self.run_deployment()
        self.assertEqual(result.returncode, 0, result.stderr)
        ordered = ["gate", "api-candidate", "candidate-health", "web-candidate", "preview-health",
                   "regate", "web-backup", "api-promote", "web-promote", "public-web-health", "public-api-health"]
        self.assertEqual([event for event in events if event in ordered], ordered)
        self.assertFalse(any(event.endswith("rollback") for event in events))
        self.assertEqual(state["traffic"], "mockinterview-api-gh12345-a2=100")
        self.assertEqual(state["web"], "a" * 40)
        self.assertEqual(receipt["previousTraffic"], PREVIOUS_TRAFFIC)
        self.assertEqual(receipt["imageDigest"], "sha256:" + "b" * 64)

    def test_unready_candidate_stale_checks_or_missing_backup_never_promote(self):
        for failure in ["candidate-health", "preview-health", "regate", "web-backup"]:
            with self.subTest(failure=failure):
                result, events, state, receipt = self.run_deployment(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(event.endswith(("promote", "rollback")) for event in events))
                self.assertEqual(state["traffic"], PREVIOUS_TRAFFIC)
                self.assertEqual(state["web"], "previous-web")
                self.assertIsNone(receipt)

    def test_partial_api_promotion_failure_restores_original_traffic_split(self):
        result, events, state, receipt = self.run_deployment("api-promote")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(events[-2:], ["api-promote", "api-rollback"])
        self.assertNotIn("web-promote", events)
        self.assertEqual(state["traffic"], PREVIOUS_TRAFFIC)
        self.assertEqual(state["web"], "previous-web")
        self.assertIsNone(receipt)

    def test_partial_web_promotion_or_public_readiness_failure_restores_both(self):
        for failure in ["web-promote", "public-web-health", "public-api-health"]:
            with self.subTest(failure=failure):
                result, events, state, receipt = self.run_deployment(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(events[-2:], ["web-rollback", "api-rollback"])
                self.assertEqual(state["traffic"], PREVIOUS_TRAFFIC)
                self.assertEqual(state["web"], "previous-web")
                self.assertIsNone(receipt)

    def test_failed_hosting_rollback_still_restores_api_and_reports_manual_action(self):
        result, events, state, _ = self.run_deployment("public-api-health", "web-rollback")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(events[-2:], ["web-rollback", "api-rollback"])
        self.assertEqual(state["traffic"], PREVIOUS_TRAFFIC)
        self.assertEqual(state["web"], "a" * 40)
        self.assertIn("Hosting rollback failed: operator action required", result.stderr)


class FirebaseInstallerTest(unittest.TestCase):
    def test_corrupt_download_is_never_installed_or_executed(self):
        with tempfile.TemporaryDirectory(prefix="mockinterview-firebase-test-") as tmp:
            folder = Path(tmp)
            fake_bin = folder / "bin"
            fake_bin.mkdir()
            curl = fake_bin / "curl"
            curl.write_text("#!" + sys.executable + "\n" + r'''
import pathlib, sys
args = sys.argv[1:]
assert args[-1] == "https://github.com/firebase/firebase-tools/releases/download/v15.24.0/firebase-tools-linux"
assert args[args.index("--proto") + 1] == "=https"
assert args[args.index("--proto-redir") + 1] == "=https"
pathlib.Path(args[args.index("--output") + 1]).write_text("#!/bin/sh\ntouch executed-unverified-binary\n")
''')
            curl.chmod(0o755)
            destination = folder / "firebase"
            result = subprocess.run(
                ["bash", str(ROOT / "deploy/install-firebase-cli.sh"), str(destination)],
                cwd=folder, env={"PATH": str(fake_bin) + os.pathsep + os.environ["PATH"]},
                capture_output=True, text=True, timeout=10,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("verification failed", result.stderr)
            self.assertFalse(destination.exists())
            self.assertFalse((folder / "executed-unverified-binary").exists())
            self.assertFalse(list(folder.glob(".firebase-cli.*")))

    def test_verifier_checks_digest_even_at_expected_size_and_rejects_symlinks(self):
        with tempfile.TemporaryDirectory(prefix="mockinterview-firebase-test-") as tmp:
            binary = Path(tmp) / "firebase"
            with binary.open("wb") as target:
                target.truncate(247631498)
            result = subprocess.run(
                ["bash", str(ROOT / "deploy/install-firebase-cli.sh"), "--verify", str(binary)],
                capture_output=True, text=True, timeout=10,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("SHA-256 mismatch", result.stderr)
            self.assertFalse(os.access(binary, os.X_OK))
            link = Path(tmp) / "linked-firebase"
            link.symlink_to(binary)
            result = subprocess.run(
                ["bash", str(ROOT / "deploy/install-firebase-cli.sh"), "--verify", str(link)],
                capture_output=True, text=True, timeout=10,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("verification failed", result.stderr)


if __name__ == "__main__":
    unittest.main()
