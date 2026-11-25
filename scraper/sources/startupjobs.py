"""StartupJobs: veřejné JSON API, které používá jejich web."""
from __future__ import annotations

from bs4 import BeautifulSoup

from scraper.models import Company, Job, clean_text, normalize_employment

API = "https://back.startupjobs.cz/api"
WEB = "https://www.startupjobs.cz"
PAGES_PER_SEARCH = 3  # 20 inzerátů na stránku, dál už jsou výsledky málo relevantní
HEADERS = {"Accept": "application/ld+json", "Content-Type": "application/json"}

_REMOTE = {"remote": "remote", "hybrid": "hybrid", "onsite": "onsite"}


def _cs(value):
    if isinstance(value, dict):
        return value.get("cs") or value.get("en")
    return value


def html_to_text(html) -> str:
    if not html:
        return ""
    return clean_text(BeautifulSoup(html, "lxml").get_text(" "))


def parse_search(data: dict) -> list:
    return data.get("member", [])


def remote_mode(prefs) -> str:
    modes = [_REMOTE[p] for p in prefs or [] if p in _REMOTE]
    for m in ("remote", "hybrid", "onsite"):
        if m in modes:
            return m
    return None


def build_job(item: dict, offer: dict, company: dict) -> Job:
    salary = item.get("salary") or {}
    lo = hi = None
    if salary and salary.get("currency") == "CZK" and salary.get("period") == "month":
        lo = salary.get("min") // 100 if salary.get("min") else None  # API vrací haléře
        hi = salary.get("max") // 100 if salary.get("max") else lo
    profile = (company or {}).get("profile") or {}
    co = item.get("company") or {}
    locations = [_cs(l.get("place")) or _cs(l.get("name")) for l in item.get("locations") or []]
    slug = _cs(item.get("slug")) or ""
    skills = [_cs(s.get("name")) for s in (offer or {}).get("requiredSkills") or [] if isinstance(s, dict)]
    return Job(
        id=f"startupjobs:{item['id']}",
        source="startupjobs",
        url=f"{WEB}/nabidka/{item['id']}/{slug}",
        title=clean_text(_cs(item.get("name"))),
        company=Company(
            name=co.get("name") or profile.get("name") or "",
            description=html_to_text(_cs(profile.get("shortDescription")))[:1500] or None,
            website=profile.get("web") or None,
            profile_url=f"{WEB}/startup/{co['slug']}" if co.get("slug") else None,
        ),
        location=", ".join(filter(None, locations)) or None,
        remote=remote_mode(item.get("locationPreferences")),
        employment=normalize_employment((item.get("hours") or []) + (item.get("contracts") or [])),
        salary_min=lo,
        salary_max=hi,
        description=html_to_text(_cs((offer or {}).get("description"))),
        tags=[s for s in skills if s],
    )


def fetch(client, searches: list, known: dict) -> list:
    items = {}
    for query in searches:
        for page in range(1, PAGES_PER_SEARCH + 1):
            data = client.post(f"{API}/search-offers", params={"page": page},
                               json={"query": query}, headers=HEADERS).json()
            for item in parse_search(data):
                items.setdefault(item["id"], item)
            if not (data.get("view") or {}).get("next"):
                break

    companies = {}
    jobs = []
    for oid, item in items.items():
        jid = f"startupjobs:{oid}"
        if jid in known:
            prev = known[jid]
            job = build_job(item, None, None)
            job.description = prev.get("description") or ""
            job.tags = prev.get("tags") or []
            job.company = Company(**prev["company"])
            jobs.append(job)
            continue
        try:
            offer = client.get(f"{API}/offers/{oid}", headers=HEADERS).json()
        except Exception:
            offer = None
        company = None
        cid = (offer or {}).get("company")
        if cid:
            if cid not in companies:
                try:
                    companies[cid] = client.get(f"{API}/companies/{cid}", headers=HEADERS).json()
                except Exception:
                    companies[cid] = None
            company = companies[cid]
        jobs.append(build_job(item, offer, company))
    return jobs
