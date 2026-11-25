# Job Searcher

Ranní přehled pracovních nabídek z [Cocumy](https://www.cocuma.cz/jobs/), [jobs.cz](https://www.jobs.cz/) a [StartupJobs](https://www.startupjobs.cz/), seřazený podle shody se skills a požadavky uživatele. Inzeráty se třídí na **Pryč / Možná / Beru** a žádosti se sledují v záložce „Moje žádosti“.

Běží zdarma: inzeráty stahuje GitHub Actions každé ráno, stránku hostuje GitHub Pages. Profil, třídění a žádosti jsou uložené jen v prohlížeči uživatele (se zálohou do souboru).

Návrh: [docs/superpowers/specs/2026-11-25-job-searcher-design.md](docs/superpowers/specs/2026-11-25-job-searcher-design.md)

## Jak to funguje

```
GitHub Actions (denně 3:30 UTC) → scraper/ → data/jobs.json, data/status.json → GitHub Pages (web/)
```

- `scraper/sources/cocuma.py`: HTML seznam + detail (popis, web firmy).
- `scraper/sources/startupjobs.py`: jejich veřejné JSON API (vyhledávání, detail, profil firmy).
- `scraper/sources/jobscz.py`: přes Playwright (headless Chromium), protože plný web je za AWS WAF. Stahuje jen seznam výsledků, popis tvoří název a štítky.
- `web/matching.js`: filtry a skóre shody (čisté funkce, testované).
- `web/storage.js`: localStorage, export a import zálohy.
- `web/tips.json`: obecné tipy na pohovor.

## Hledané pozice

Které pozice se stahují z jobs.cz a StartupJobs, určuje `config/searches.json`. Cocuma se stahuje celá. Hledané pozice v profilu uživatele pak jen filtrují mezi staženými inzeráty. Pro novou oblast hledání je potřeba ji přidat do configu.

## Lokální vývoj

```bash
python3.12 -m venv .venv
```

```bash
.venv/bin/pip install -r requirements.txt && .venv/bin/python -m playwright install chromium
```

Stažení dat (jen některé zdroje: `--only cocuma,startupjobs`):

```bash
.venv/bin/python -m scraper.run
```

Testy:

```bash
.venv/bin/python -m pytest -q && node --test tests/
```

Náhled: `python3 -m http.server 8090` v kořeni repozitáře a otevřít <http://localhost:8090/web/>.

## Nasazení na GitHub

1. Vytvořit **veřejný** repozitář `job-searcher` na GitHubu (GitHub Pages zdarma vyžaduje veřejný repozitář) a pushnout.
2. V nastavení repozitáře: **Settings → Pages → Source: GitHub Actions**.
3. **Actions → Stažení inzerátů a nasazení → Run workflow** spustí první stažení. Dál běží samo každé ráno.
4. Adresa stránky bude `https://<uživatel>.github.io/job-searcher/`.

Když některý web změní strukturu, workflow pořád nasadí stránku se staršími daty daného zdroje a v aplikaci se ukáže upozornění, že stažení selhalo. Opravit pak stačí parser v `scraper/sources/` a uložit novou ukázku do `tests/fixtures/`.
