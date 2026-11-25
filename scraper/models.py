"""Společný formát inzerátu pro všechny zdroje."""
from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from typing import Optional

MAX_DESCRIPTION = 8000


@dataclass
class Company:
    name: str
    description: Optional[str] = None
    website: Optional[str] = None
    profile_url: Optional[str] = None


@dataclass
class Job:
    id: str
    source: str
    url: str
    title: str
    company: Company
    location: Optional[str] = None
    remote: Optional[str] = None  # "onsite" | "hybrid" | "remote" | None
    employment: list = field(default_factory=list)  # "plny" | "castecny" | "kontrakt"
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    description: str = ""
    tags: list = field(default_factory=list)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["description"] = (d["description"] or "")[:MAX_DESCRIPTION]
        return d


def clean_text(text: Optional[str]) -> str:
    if not text:
        return ""
    text = text.replace("‍", "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in text if not unicodedata.combining(c))


def guess_remote(text: str) -> Optional[str]:
    """Odhad režimu práce z volného textu."""
    t = _fold(text)
    if re.search(r"\b(full[- ]?remote|plne remote|100 ?% remote|prace prevazne z domova)", t):
        return "remote"
    if re.search(r"\b(hybrid|home ?office|obcasne prace z domova|prace z domova)", t):
        return "hybrid"
    if re.search(r"\bremote\b", t):
        return "remote"
    return None


_EMPLOYMENT = {
    "full-time": "plny", "full time": "plny", "plny": "plny", "hpp": "plny", "full_time": "plny",
    "part-time": "castecny", "part time": "castecny", "castecny": "castecny", "part_time": "castecny",
    "contract": "kontrakt", "ico": "kontrakt", "freelance": "kontrakt", "kontrakt": "kontrakt",
}


def normalize_employment(values) -> list:
    out = []
    for v in values or []:
        key = _fold(str(v)).strip()
        norm = _EMPLOYMENT.get(key)
        if norm and norm not in out:
            out.append(norm)
    return out


_SALARY_RE = re.compile(r"(\d{1,3}(?:[ .]\d{3})+|\d{4,6})\s*(?:[–-]\s*(\d{1,3}(?:[ .]\d{3})+|\d{4,6}))?\s*(?:Kč|CZK)")


def parse_salary(text: str):
    """Vrátí (min, max) měsíční mzdy v Kč z textu typu '65 000 – 75 000 Kč'."""
    m = _SALARY_RE.search(clean_text(text))
    if not m:
        return None, None
    lo = int(re.sub(r"\D", "", m.group(1)))
    hi = int(re.sub(r"\D", "", m.group(2))) if m.group(2) else lo
    if lo < 5000:  # pravděpodobně hodinová sazba nebo nesmysl
        return None, None
    return lo, hi
