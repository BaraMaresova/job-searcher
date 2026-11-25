"""jobs.cz: plná verze webu je za AWS WAF, proto se stahuje přes headless prohlížeč (Playwright).

Stahuje se jen seznam výsledků. Detaily inzerátů mají na jobs.cz různé šablony podle firmy,
takže popis tvoří název a štítky z karty.
"""
from __future__ import annotations

import re
from urllib.parse import quote

from bs4 import BeautifulSoup

from scraper.models import Company, Job, clean_text, guess_remote, parse_salary

BASE = "https://www.jobs.cz"
PAGES_PER_SEARCH = 3  # 30 inzerátů na stránku


def search_url(query: str, page: int) -> str:
    url = f"{BASE}/prace/?q%5B%5D={quote(query)}"
    return url if page == 1 else f"{url}&page={page}"


def parse_list(html: str) -> list:
    soup = BeautifulSoup(html, "lxml")
    jobs = []
    for card in soup.select("article.SearchResultCard"):
        link = card.select_one("a[data-jobad-id]")
        if not link:
            continue
        jid = link["data-jobad-id"]
        title = clean_text(link.get_text())
        tags = [clean_text(t.get_text()) for t in card.select(".SearchResultCard__body .Tag")]
        salary_tags = [t for t in tags if "Kč" in t]
        other_tags = [t for t in tags if "Kč" not in t]
        lo, hi = parse_salary(salary_tags[0]) if salary_tags else (None, None)

        company = location = None
        for li in card.select("li.SearchResultCard__footerItem"):
            if li.get("data-test") == "serp-locality":
                location = clean_text(li.get_text())
            elif company is None:
                company = clean_text(li.get_text())

        href = link.get("href", "")
        url = f"{BASE}/rpd/{jid}/" if "/rpd/" in href else href.split("?")[0]
        jobs.append(Job(
            id=f"jobscz:{jid}",
            source="jobscz",
            url=url,
            title=title,
            company=Company(name=company or ""),
            location=location,
            remote=guess_remote(" ".join(other_tags)),
            salary_min=lo,
            salary_max=hi,
            description=" · ".join([title] + other_tags),
            tags=other_tags,
        ))
    return jobs


def has_next_page(html: str, page: int) -> bool:
    return re.search(rf"[?&;]page={page + 1}\b", html) is not None


def fetch(client, searches: list, known: dict) -> list:
    from playwright.sync_api import sync_playwright

    jobs = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page_obj = browser.new_page(locale="cs-CZ")
        try:
            for query in searches:
                for page in range(1, PAGES_PER_SEARCH + 1):
                    page_obj.goto(search_url(query, page), wait_until="domcontentloaded", timeout=60000)
                    try:
                        page_obj.wait_for_selector("article.SearchResultCard", timeout=20000)
                    except Exception:
                        break  # žádné výsledky
                    html = page_obj.content()
                    for job in parse_list(html):
                        jobs.setdefault(job.id, job)
                    if not has_next_page(html, page):
                        break
                    page_obj.wait_for_timeout(1000)
        finally:
            browser.close()
    return list(jobs.values())
