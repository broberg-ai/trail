"""F286.12 — rent an EU GPU on Runpod, run remote_train.py there, bring the result
home, and DELETE the pod in every outcome.

  runpod_train.py --dry-run     key check + EU GPU types and prices, rents nothing
  runpod_train.py               the real run

The pattern is voice-engine's (measured there, 23/9), because the expensive part
of renting a GPU is not the training — it is the pod nobody deleted:
  · EU only: dataCenterIds is set on every create, and the data centre the pod
    ACTUALLY landed in is read back; a pod outside the list is deleted unused.
  · Deletion lives in `finally`, and every run first deletes our own pods left
    over from an earlier run. After deletion the pod list is read back: the run
    only reports success when Trail has 0 pods.
  · A hard ceiling on wall-clock time (MAX_MINUTES); past it, the pod is deleted
    whatever it is doing.
Trail's OWN key from the cardmem vault — never voice-engine's.
"""

import json
import signal
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import certifi

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SECRET_ID = "01a0cfe7-8fd3-7283-945c-53def8c32e2b"  # «Runpod-trail-scout-training» in the cardmem vault
NAME_PREFIX = "trail-scout-"
# EU only. Voice-engine's list also has EU-DK-1 and EU-SE-2 — measured 23/9, those
# ARE in the GraphQL data-centre list but the REST create schema rejects them (400,
# enum). Only centres the create call accepts are listed; each run also keeps only
# those that are live right now. EEA-but-not-EU (EUR-IS, EUR-NO) are left out.
EU = ["EU-CZ-1", "EU-FR-1", "EU-NL-1", "EU-RO-1", "EU-SE-1"]
GPUS = ["NVIDIA RTX A6000", "NVIDIA A40", "NVIDIA L40S", "NVIDIA RTX 6000 Ada Generation", "NVIDIA A100 80GB PCIe",
        "NVIDIA A100-SXM4-80GB", "NVIDIA H100 80GB HBM3", "NVIDIA H100 PCIe"]
IMAGE = "runpod/pytorch:1.0.3-cu1281-torch280-ubuntu2404"
MAX_MINUTES = 180
STALE_MINUTES = 420  # longer than any ceiling we pass with --max-minutes
SSH_KEY = Path.home() / ".ssh" / "trail_runpod_ed25519"
# The python.org build in the venv ships without the system's root certificates;
# certifi's bundle is the standard list, so verification stays ON.
TLS = ssl.create_default_context(cafile=certifi.where())
UA = {"User-Agent": "trail-scout/1.0"}  # without it Cloudflare answers 403 «error code: 1010»


def vault_key():
    auth = json.loads((REPO / ".mcp.json").read_text())["mcpServers"]["cardmem"]["headers"]["Authorization"]
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                       "params": {"name": "cardmem_get_secret", "arguments": {"secret_id": SECRET_ID}}}).encode()
    req = urllib.request.Request("https://services.cardmem.com/mcp", data=body, headers={
        "Authorization": auth, "Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
    raw = urllib.request.urlopen(req, timeout=30, context=TLS).read().decode()
    data = json.loads(next(l[6:] for l in raw.splitlines() if l.startswith("data: ")))
    secret = json.loads(data["result"]["content"][0]["text"])
    return secret.get("value") or secret["plaintext"]


class Runpod:
    def __init__(self, key):
        self.h = {**UA, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def rest(self, method, path, body=None):
        req = urllib.request.Request(f"https://rest.runpod.io/v1{path}", method=method, headers=self.h,
                                     data=json.dumps(body).encode() if body is not None else None)
        try:
            raw = urllib.request.urlopen(req, timeout=60, context=TLS).read()
            return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} → {e.code}: {e.read()[:3000].decode(errors="replace")}") from None

    def gql(self, query):
        req = urllib.request.Request("https://api.runpod.io/graphql", headers=self.h,
                                     data=json.dumps({"query": query}).encode())
        out = json.loads(urllib.request.urlopen(req, timeout=60, context=TLS).read())
        if out.get("errors"):
            # A failed query must never read as «nothing available» (voice-engine, 23/9).
            raise RuntimeError(f"graphql error: {out['errors']}")
        return out["data"]

    def our_pods(self):
        return [p for p in self.rest("GET", "/pods") if (p.get("name") or "").startswith(NAME_PREFIX)]


def say(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def where(rp, pod_id, created):
    """Data centre + GPU the pod actually landed on. The REST GET answers `machine: {}`
    (voice-engine measured it 14/9, and our run 2 hit it on 23/9), so read the create
    response first and fall back to GraphQL. None means UNKNOWN, and the caller treats
    unknown as outside the EU."""
    m = created.get("machine") or {}
    dc, gpu = m.get("dataCenterId") or created.get("dataCenterId"), m.get("gpuTypeId")
    if not dc or not gpu:
        pods = rp.gql("{ myself { pods { id machine { dataCenterId gpuTypeId } } } }")["myself"]["pods"]
        m = next((p.get("machine") or {} for p in pods if p["id"] == pod_id), {})
        dc, gpu = dc or m.get("dataCenterId"), gpu or m.get("gpuTypeId")
    return dc, gpu


def ssh(host, port, *cmd, timeout=None):
    base = ["-i", str(SSH_KEY), "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
            "-o", "ServerAliveInterval=30", "-o", "LogLevel=ERROR"]
    return subprocess.run(["ssh", *base, "-p", str(port), f"root@{host}", *cmd], timeout=timeout, check=True)


def scp(host, port, sources, dest, timeout=600):
    base = ["-i", str(SSH_KEY), "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
            "-o", "LogLevel=ERROR", "-P", str(port), "-r"]
    subprocess.run(["scp", *base, *sources, dest], timeout=timeout, check=True)


def main():
    dry = "--dry-run" in sys.argv
    # --base=Qwen/Qwen3.5-9B --min-gb=80 --max-minutes=300: a bigger model needs a bigger card and more time.
    flag = lambda name, default: next((a.split("=", 1)[1] for a in sys.argv if a.startswith(f"--{name}=")), default)
    base, min_gb = flag("base", "Qwen/Qwen3.5-4B"), int(flag("min-gb", "40"))
    # --anywhere: Christian 23/9 — "træning af scout må gøres i hele verden, det er ikke kundedata".
    # Allowed for any dataset WITHOUT personal data (incl. Sanne's zone-therapy facts, Christian 24/9). Personal data never passes it.
    anywhere = "--anywhere" in sys.argv
    global MAX_MINUTES
    MAX_MINUTES = int(flag("max-minutes", str(MAX_MINUTES)))
    if MAX_MINUTES >= STALE_MINUTES:
        raise SystemExit(f"--max-minutes must stay below {STALE_MINUTES}, or a parallel run could delete this pod")
    say(f"base {base} · min {min_gb} GB VRAM · ceiling {MAX_MINUTES} min · region {'ANYWHERE (not customer data)' if anywhere else 'EU only'}")
    rp = Runpod(vault_key())
    types = rp.gql("{ gpuTypes { id displayName memoryInGb securePrice } }")["gpuTypes"]
    offer = sorted((t for t in types if t["id"] in GPUS and (t["memoryInGb"] or 0) >= min_gb),
                   key=lambda t: t["securePrice"] or 99)
    if not offer:
        raise SystemExit(f"no card in GPUS has {min_gb} GB VRAM")
    for t in offer:
        say(f"gpu {t['id']:34} {t['memoryInGb']:>3} GB  ${t['securePrice']}/h secure")
    live = {d["id"] for d in rp.gql("{ dataCenters { id } }")["dataCenters"]}
    eu = [d for d in EU if d in live]
    say(f"EU data centres live now: {eu}")
    if not eu:
        raise SystemExit("no EU data centre is live — not renting outside the EU")
    # Only pods older than any run's ceiling are leftovers. A younger one may be a run in
    # progress next to this one — deleting "all Trail pods" killed nothing yet, but would have.
    ours = rp.our_pods()
    age = lambda p: (time.time() - int((p.get("name") or "")[len(NAME_PREFIX):] or 0)) / 60
    leftover = [p for p in ours if age(p) > STALE_MINUTES]
    say(f"Trail pods on the account before the run: {len(ours)} ({len(leftover)} older than {STALE_MINUTES} min)")
    if dry:
        return
    for p in leftover:
        say(f"deleting leftover pod {p['id']} ({p.get('name')})")
        rp.rest("DELETE", f"/pods/{p['id']}")
    if not SSH_KEY.exists():
        subprocess.run(["ssh-keygen", "-t", "ed25519", "-N", "", "-C", "trail-scout-runpod", "-f", str(SSH_KEY)],
                       check=True, capture_output=True)
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError(f"ceiling {MAX_MINUTES} min")))
    signal.alarm(MAX_MINUTES * 60)
    report = {"startedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    pod_id, t0 = None, time.time()
    try:
        pod = rp.rest("POST", "/pods", {
            "name": f"{NAME_PREFIX}{int(t0)}", "imageName": IMAGE, "cloudType": "SECURE", "interruptible": False,
            "gpuTypeIds": [t["id"] for t in offer], "gpuTypePriority": "custom", "gpuCount": 1,
            **({} if anywhere else {"dataCenterIds": eu}), "containerDiskInGb": 80, "volumeInGb": 0, "ports": ["22/tcp"],
            "env": {"PUBLIC_KEY": SSH_KEY.with_suffix(".pub").read_text().strip()}})
        pod_id, created = pod["id"], pod
        say(f"pod {pod_id} created")
        while True:
            pod = rp.rest("GET", f"/pods/{pod_id}")
            port = (pod.get("portMappings") or {}).get("22")
            if pod.get("publicIp") and port:
                break
            time.sleep(10)
        dc, gpu = where(rp, pod_id, created)
        report.update({"podId": pod_id, "dataCenter": dc, "gpu": gpu,
                       "costPerHr": pod.get("costPerHr"), "readySeconds": round(time.time() - t0)})
        say(f"ready after {report['readySeconds']}s in {dc} on {report['gpu']} at ${report['costPerHr']}/h")
        if not anywhere and dc not in eu:
            raise RuntimeError(f"pod landed in {dc}, outside the EU list — deleted unused")
        host = pod["publicIp"]
        for _ in range(30):  # sshd can lag the port mapping by a few seconds
            try:
                ssh(host, port, "true", timeout=20)
                break
            except subprocess.SubprocessError:
                time.sleep(10)
        ssh(host, port, "mkdir -p /root/data /root/out")
        scp(host, port, [str(ROOT / "compile-data" / "train.jsonl"), str(REPO / "apps/scout/data/compile-golden.jsonl"),
                         str(ROOT / "remote_train.py"), str(ROOT / "compile_metrics.py")], f"root@{host}:/root/")
        ssh(host, port, "mv /root/train.jsonl /root/data/ && mv /root/compile-golden.jsonl /root/data/golden.jsonl")
        t_setup = time.time()
        # flash-linear-attention: runs 5/6 logged that Qwen3.5's gated-delta layers fell back to a
        # slow reference implementation without it. causal_conv1d (the other fallback) needs a CUDA
        # build and is left out until its install time is measured.
        # Ubuntu 24.04 images refuse a system-wide pip (PEP 668) — run 3 died on it in 4 s
        # with the reason gone along with the pod, so print the tail on failure.
        ssh(host, port, "PIP_BREAK_SYSTEM_PACKAGES=1 python -m pip install -q 'transformers>=5.17' peft accelerate flash-linear-attention"
                        " > /root/out/pip.txt 2>&1 || { tail -40 /root/out/pip.txt; exit 1; }")
        report["installSeconds"] = round(time.time() - t_setup)
        t_job = time.time()
        try:
            ssh(host, port, f"cd /root && SCOUT_BASE={base} python remote_train.py")
        finally:
            report["jobSeconds"] = round(time.time() - t_job)
            dest = ROOT / "runpod-out" / str(int(t0))
            dest.mkdir(parents=True, exist_ok=True)
            scp(host, port, [f"root@{host}:/root/out/."], str(dest))
            report["fetchedTo"] = str(dest)
    finally:
        signal.alarm(0)
        if pod_id:
            rp.rest("DELETE", f"/pods/{pod_id}")
            say(f"pod {pod_id} deleted")
        report["wallSeconds"] = round(time.time() - t0)
        if report.get("costPerHr"):
            report["costUsd"] = round(report["costPerHr"] * report["wallSeconds"] / 3600, 3)
        others = rp.our_pods()
        left = [p for p in others if p["id"] == pod_id]  # a parallel run's pod is not ours to report
        report["trailPodsAfter"] = len(others)
        say(f"Trail pods on the account after the run: {len(others)} (this run's pod still there: {bool(left)})")
        out = ROOT / "runpod-out"
        out.mkdir(exist_ok=True)
        (out / f"run-{int(t0)}.json").write_text(json.dumps(report, indent=2))
        say(json.dumps(report))
        if left:
            raise SystemExit(f"this run's pod {pod_id} still exists — delete by hand")


if __name__ == "__main__":
    main()
