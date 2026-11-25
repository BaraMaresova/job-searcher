"""Cocuma: server vrací HTML. Seznam se stránkuje po 21 inzerátech, detail obsahuje popis a firmu."""
from __future__ import annotations

import re
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from scraper.models import Company, Job, clean_text, guess_remote, normalize_employment, parse_salary

BASE = "https://www.cocuma.cz"
MAX_PAGES = 20


def parse_list(html: str) -> list:
    """Vrátí seznam karet {url, title, company, location, schedule}."""
    soup = BeautifulSoup(html, "lxml")
    cards = []
    for a in soup.select("a.job-thumbnail[href]"):
        def text(cls):
            el = a.select_one(cls)
            return clean_text(el.get_text()) if el else None
        cards.append({
            "url": urljoin(BASE, a["href"]),
            "title": text(".job-thumbnail-title") or clean_text(a.get("title")),
            "company": text(".job-thumbnail-company"),
            "location": text(".job-thumbnail-city"),
            "schedule": text(".job-thumbnail-work-shedule"),
        })
    return cards


def has_next_page(html: str, page: int) -> bool:
    return f"/jobs/page/{page + 1}/" in html


def parse_detail(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    main = soup.select_one("h1.job-title")
    col = main.parent if main else soup.body
    # Popis: hlavní sloupec bez tlačítek a sdílení
    for el in col.select("a.btn, form, script, style"):
        el.decompose()
    description = clean_text(col.get_text(" "))

    website = None
    footer = soup.select_one(".company-profile-footer-box")
    if footer:
        for a in footer.select("a[href]"):
            href = a["href"]
            if href.startswith("http") and "cocuma." not in href:
                website = href
                break

    company_desc = None
    texts = soup.select(".company-profile-text")
    if texts:
        company_desc = clean_text(texts[0].get_text(" "))[:1500]

    profile = None
    for a in soup.select('a[href*="/company/"]'):
        if "cocuma." in a["href"] or a["href"].startswith("/company/"):
            profile = urljoin(BASE, a["href"])
            break

    lead = soup.select_one("p.job-lead")
    company_name = None
    if lead:
        m = re.search(r"ve společnosti (.+)$", clean_text(lead.get_text()))
        company_name = m.group(1) if m else None

    return {
        "description": description,
        "website": website,
        "company_description": company_desc,
        "profile_url": profile,
        "company_name": company_name,
    }


def job_id(url: str) -> str:
    m = re.search(r"/job/[^/]+/(\d+)/", url)
    if m:
        return f"cocuma:{m.group(1)}"
    slug = url.rstrip("/").rsplit("/", 1)[-1]
    return f"cocuma:{slug}"


def build_job(card: dict, detail: dict) -> Job:
    text = " ".join(filter(None, [card["title"], detail.get("description")]))
    lo, hi = parse_salary(detail.get("description") or "")
    return Job(
        id=job_id(card["url"]),
        source="cocuma",
        url=card["url"],
        title=card["title"],
        company=Company(
            name=card["company"] or detail.get("company_name") or "",
            description=detail.get("company_description"),
            website=detail.get("website"),
            profile_url=detail.get("profile_url"),
        ),
        location=card["location"],
        remote=guess_remote(text),
        employment=normalize_employment([card["schedule"]]),
        salary_min=lo,
        salary_max=hi,
        description=detail.get("description") or "",
    )


def fetch(client, searches: list, known: dict) -> list:
    """Stáhne všechny inzeráty Cocumy. Detail se stahuje jen u inzerátů, které ještě neznáme."""
    cards = []
    page = 1
    while page <= MAX_PAGES:
        url = f"{BASE}/jobs/" if page == 1 else f"{BASE}/jobs/page/{page}/"
        html = client.get(url).text
        cards.extend(parse_list(html))
        if not has_next_page(html, page):
            break
        page += 1

    jobs = {}
    for card in cards:
        jid = job_id(card["url"])
        if jid in jobs:
            continue
        if jid in known:
            prev = known[jid]
            detail = {
                "description": prev.get("description"),
                "website": prev["company"].get("website"),
                "company_description": prev["company"].get("description"),
                "profile_url": prev["company"].get("profile_url"),
            }
        else:
            try:
                detail = parse_detail(client.get(card["url"]).text)
            except Exception:
                detail = {}
        jobs[jid] = build_job(card, detail)
    return list(jobs.values())
