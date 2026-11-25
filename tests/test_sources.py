import json
from pathlib import Path

from scraper.models import guess_remote, normalize_employment, parse_salary
from scraper.run import merge
from scraper.sources import cocuma, jobscz, startupjobs

FIX = Path(__file__).parent / "fixtures"


def read(name):
    return (FIX / name).read_text(encoding="utf-8")


# --- Cocuma ---

def test_cocuma_list():
    cards = cocuma.parse_list(read("cocuma_list.html"))
    assert len(cards) >= 21
    first = cards[0]
    assert first["url"].startswith("https://www.cocuma.cz/")
    assert first["title"] and first["company"] and first["location"]
    assert cocuma.has_next_page(read("cocuma_list.html"), 1)


def test_cocuma_detail():
    d = cocuma.parse_detail(read("cocuma_detail.html"))
    assert "Klaviyu" in d["description"]
    assert d["website"] == "https://www.vafo.com/cs/"
    assert d["company_name"] == "VAFO"
    assert d["profile_url"].endswith("/company/vafo/")


def test_cocuma_build_job():
    card = {"url": "https://www.cocuma.cz/job/crm-automation-partner/10567/", "title": "CRM Automation Partner",
            "company": "VAFO", "location": "Chrášťany", "schedule": "Full-time"}
    job = cocuma.build_job(card, cocuma.parse_detail(read("cocuma_detail.html")))
    assert job.id == "cocuma:10567"
    assert job.employment == ["plny"]
    assert job.company.website == "https://www.vafo.com/cs/"


# --- StartupJobs ---

def test_startupjobs_build_job():
    item = startupjobs.parse_search(json.loads(read("startupjobs_search.json")))[0]
    job = startupjobs.build_job(item, json.loads(read("startupjobs_offer.json")),
                                json.loads(read("startupjobs_company.json")))
    assert job.id == "startupjobs:109215"
    assert job.url == "https://www.startupjobs.cz/nabidka/109215/product-manager-ai-first-e-commerce-marketplace"
    assert job.company.name == "Carvago s.r.o."
    assert job.company.website == "http://www.carvago.com"
    assert job.remote == "onsite"
    assert "Carvago" in job.description
    assert "<p>" not in job.description


def test_startupjobs_salary_in_hellers():
    items = startupjobs.parse_search(json.loads(read("startupjobs_search.json")))
    with_salary = [i for i in items if i.get("salary")][0]
    job = startupjobs.build_job(with_salary, None, None)
    assert job.salary_min == with_salary["salary"]["min"] // 100
    assert 10000 < job.salary_min < 1000000


# --- jobs.cz ---

def test_jobscz_list():
    jobs = jobscz.parse_list(read("jobscz_list.html"))
    assert len(jobs) == 30
    j = jobs[0]
    assert j.id.startswith("jobscz:")
    assert j.url.startswith("https://www.jobs.cz/rpd/")
    assert j.company.name and j.location
    assert any(x.salary_min for x in jobs)
    assert jobscz.has_next_page(read("jobscz_list.html"), 1)


# --- pomocné funkce ---

def test_parse_salary():
    assert parse_salary("65 000 ‍–‍ 75 000 Kč") == (65000, 75000)
    assert parse_salary("od 50000 Kč") == (50000, 50000)
    assert parse_salary("bez platu") == (None, None)


def test_guess_remote_and_employment():
    assert guess_remote("Možnost občasné práce z domova") == "hybrid"
    assert guess_remote("Práce převážně z domova") == "remote"
    assert guess_remote("Kancelář v Praze") is None
    assert normalize_employment(["full-time", "contract", "Full-time"]) == ["plny", "kontrakt"]


# --- slučování ---

def _job(jid, source="cocuma", first="2026-11-01", last="2026-11-01"):
    return {"id": jid, "source": source, "first_seen": first, "last_seen": last}


def test_merge_keeps_first_seen_and_updates_last_seen():
    out = merge([_job("a")], {"cocuma": [{"id": "a", "source": "cocuma"}]}, set(), "2026-11-25")
    assert out[0]["first_seen"] == "2026-11-01" and out[0]["last_seen"] == "2026-11-25"


def test_merge_new_job_gets_today():
    out = merge([], {"cocuma": [{"id": "b", "source": "cocuma"}]}, set(), "2026-11-25")
    assert out[0]["first_seen"] == "2026-11-25"


def test_merge_expires_old_and_keeps_recent():
    existing = [_job("old", last="2026-11-01"), _job("recent", last="2026-11-20")]
    out = merge(existing, {"cocuma": [{"id": "x", "source": "cocuma"}]}, set(), "2026-11-25")
    ids = {j["id"] for j in out}
    assert "old" not in ids and "recent" in ids


def test_merge_keeps_failed_source_untouched():
    existing = [_job("j1", source="jobscz", last="2026-10-01")]
    out = merge(existing, {}, {"jobscz"}, "2026-11-25")
    assert out == existing
