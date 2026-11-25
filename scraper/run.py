"""Spustí všechny zdroje, sloučí výsledky s minulým během a zapíše data/jobs.json a data/status.json.

Použití: python -m scraper.run [--only cocuma,startupjobs,jobscz]
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from scraper.http import PoliteClient
from scraper.sources import cocuma, jobscz, startupjobs

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CONFIG = ROOT / "config" / "searches.json"
EXPIRE_DAYS = 14

SOURCES = {"cocuma": cocuma, "startupjobs": startupjobs, "jobscz": jobscz}


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def merge(existing: list, fresh_by_source: dict, failed: set, today: str) -> list:
    """Sloučí nové výsledky s minulými.

    - známý inzerát si drží first_seen, last_seen se posune na dnešek,
    - inzeráty zdroje, který selhal, zůstanou beze změny,
    - inzerát, který zdroj nevrátil víc než EXPIRE_DAYS dní, se odstraní.
    """
    old = {j["id"]: j for j in existing}
    result = {}
    for source, jobs in fresh_by_source.items():
        for job in jobs:
            d = job if isinstance(job, dict) else job.to_dict()
            prev = old.get(d["id"])
            d["first_seen"] = prev["first_seen"] if prev else today
            d["last_seen"] = today
            result[d["id"]] = d
    cutoff = (date.fromisoformat(today) - timedelta(days=EXPIRE_DAYS)).isoformat()
    for jid, job in old.items():
        if jid in result:
            continue
        if job["source"] in failed or job["last_seen"] >= cutoff:
            result[jid] = job
    return sorted(result.values(), key=lambda j: (j["first_seen"], j["id"]), reverse=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="čárkami oddělené zdroje")
    args = parser.parse_args(argv)
    names = args.only.split(",") if args.only else list(SOURCES)

    config = load_json(CONFIG, {})
    searches = config.get("searches", [])
    existing = load_json(DATA / "jobs.json", {}).get("jobs", [])
    known = {j["id"]: j for j in existing}
    status = load_json(DATA / "status.json", {})
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    today = date.today().isoformat()

    fresh, failed = {}, set()
    client = PoliteClient()
    try:
        for name in SOURCES:
            if name not in names:
                failed.add(name)  # nestahovaný zdroj = ponechat beze změny
                continue
            try:
                jobs = SOURCES[name].fetch(client, searches, known)
                if not jobs:
                    raise RuntimeError("zdroj nevrátil žádné inzeráty (změnila se struktura webu?)")
                fresh[name] = jobs
                status[name] = {"at": now, "ok": True, "count": len(jobs), "error": None}
                print(f"{name}: {len(jobs)} inzerátů")
            except Exception as e:
                failed.add(name)
                prev = status.get(name, {})
                status[name] = {"at": now, "ok": False, "count": prev.get("count", 0), "error": str(e)[:300],
                                "last_ok": prev.get("at") if prev.get("ok") else prev.get("last_ok")}
                print(f"{name}: CHYBA {e}", file=sys.stderr)
                traceback.print_exc()
    finally:
        client.close()

    jobs = merge(existing, fresh, failed, today)
    DATA.mkdir(exist_ok=True)
    (DATA / "jobs.json").write_text(
        json.dumps({"generated_at": now, "jobs": jobs}, ensure_ascii=False, indent=0), encoding="utf-8")
    (DATA / "status.json").write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"celkem {len(jobs)} inzerátů")
    return 0 if fresh else 1


if __name__ == "__main__":
    sys.exit(main())
