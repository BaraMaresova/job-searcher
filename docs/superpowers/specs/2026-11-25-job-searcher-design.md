# Job Searcher – návrh aplikace

Datum: 2026-11-25
Stav: ke schválení

## Účel

Webová aplikace pro jednoho uchazeče o práci. Každé ráno mu ukáže nové inzeráty z Cocumy, jobs.cz a StartupJobs seřazené podle toho, jak odpovídají jeho skills a požadavkům. Inzeráty rychle roztřídí a sleduje, kam už poslal žádost. Cílem je rychlá ranní kontrola, ne sofistikovaný nástroj.

Aplikaci postaví a spravuje autorka (dále **správkyně**), používá ji jiný člověk (dále **uživatel**).

## Zásadní rozhodnutí

| Téma | Rozhodnutí |
|---|---|
| Náklady | 0 Kč. Žádný placený hosting, ScrapingBee ani AI API. |
| Uživatelé | Jeden uživatel, bez přihlašování. |
| Stahování | GitHub Actions, denně, inzeráty připravené do 6:00 českého času. |
| Hosting | GitHub Pages (statická stránka). Repozitář je veřejný. |
| Osobní data | Profil, třídění a tracking jsou jen v prohlížeči uživatele (localStorage), se zálohou do souboru. Do repozitáře se nic osobního nedostane. |
| Tipy na pohovor | Bez placeného AI: obecné tipy podle typu pozice a tlačítko „Zkopírovat prompt pro AI“. |

## Architektura

```
GitHub Actions (cron denně)            GitHub Pages
┌──────────────────────────┐          ┌─────────────────────────────┐
│ scraper (Python)          │  commit  │ web/ (HTML + JS, bez buildu) │
│  ├ cocuma                 │ ───────▶ │  načte data/jobs.json        │
│  ├ jobs.cz                │ data/    │  filtruje a řadí v prohlížeči│
│  └ startupjobs            │          │  localStorage: profil,       │
│ → data/jobs.json          │          │  třídění, tracking           │
│ → data/status.json        │          └─────────────────────────────┘
└──────────────────────────┘
```

Server ani databáze nejsou. Scraper vyrobí JSON soubory a frontend je čte jako statické soubory.

### Struktura repozitáře

```
job-searcher/
├── config/searches.json      # hledané pozice pro jobs.cz a StartupJobs (edituje správkyně)
├── scraper/
│   ├── models.py             # datová třída Job, Company
│   ├── sources/
│   │   ├── cocuma.py
│   │   ├── jobscz.py
│   │   └── startupjobs.py
│   └── run.py                # spustí zdroje, sloučí výsledky, zapíše data/
├── data/
│   ├── jobs.json
│   └── status.json
├── web/
│   ├── index.html
│   ├── style.css
│   ├── app.js                # UI
│   ├── matching.js           # čisté funkce: filtry a skóre shody
│   ├── storage.js            # localStorage, export a import zálohy
│   └── tips.json             # obecné tipy na pohovor
├── tests/
│   ├── fixtures/             # uložené HTML/JSON ukázky ze zdrojů
│   ├── test_sources.py
│   └── matching.test.js
└── .github/workflows/
    └── scrape-and-deploy.yml
```

## Stahování inzerátů (scraper)

### Spouštění
- Cron `30 3 * * *` (UTC), tj. 4:30 v zimě a 5:30 v létě. GitHub spouští plánované úlohy s možným zpožděním, takže rezerva zajistí data do 6:00.
- Ruční spuštění (`workflow_dispatch`) z GitHubu, jen pro správkyni.
- Workflow: stáhne data, commitne `data/` (pokud se změnila) a nasadí `web/` + `data/` na GitHub Pages.

### Zdroje
| Zdroj | Co stahuje | Technika |
|---|---|---|
| Cocuma | Všechny aktuální inzeráty (`/jobs/` včetně stránkování). | Server vrací HTML, stačí `httpx` + parser. |
| jobs.cz | Výsledky hledání pro každou pozici z `config/searches.json`. | Výsledky se načítají JavaScriptem. Nejdřív zkusit interní JSON endpoint, který stránka volá. Záloha: Playwright v GitHub Actions (zdarma). |
| StartupJobs | Inzeráty pro pozice z `config/searches.json`. | Nuxt aplikace. Nejdřív data z `window.__NUXT__` nebo interní API. Záloha: Playwright. |

Konkrétní endpointy a selektory se ověří na začátku implementace.

### Hledané pozice
Scraper běží na GitHubu a nemá přístup k profilu v prohlížeči uživatele. Proto:
- Seznam pozic pro stahování z jobs.cz a StartupJobs je v `config/searches.json` (např. `["E-commerce manager", "Marketing manager"]`) a mění ho správkyně.
- Hledané pozice v profilu uživatele inzeráty dál **filtrují** mezi staženými. Rozšířit stahování o novou pozici znamená přidat ji do configu.

### Data
`data/jobs.json` je seznam inzerátů:

```json
{
  "id": "cocuma:10567",
  "source": "cocuma",
  "url": "https://www.cocuma.cz/job/crm-automation-partner/10567/",
  "title": "CRM Automation Partner",
  "company": {
    "name": "…",
    "description": "…",
    "website": "https://…",
    "profile_url": "https://www.cocuma.cz/company/…"
  },
  "location": "Praha",
  "remote": "hybrid",
  "employment": "plny",
  "salary_min": 50000,
  "salary_max": 70000,
  "description": "plný text inzerátu",
  "first_seen": "2026-11-25",
  "last_seen": "2026-11-25"
}
```

- Chybějící údaje jsou `null` (plat, web firmy, remote).
- Identita inzerátu: `id` odvozené z URL nebo ID zdroje. Stejný inzerát se při dalším běhu jen aktualizuje (`last_seen`), `first_seen` zůstává.
- Inzerát, který zdroj 14 dní nevrátil, se z `jobs.json` odstraní.
- Popis se ukládá jako prostý text, zkrácený na rozumnou délku (cca 8 000 znaků), aby soubor zůstal malý.

`data/status.json` je stav posledního běhu každého zdroje: čas, `ok` / `error`, počet inzerátů a chybová zpráva.

### Chyby
- Každý zdroj běží samostatně. Když jeden selže, ostatní se uloží a u selhaného zůstanou inzeráty z minula (`last_seen` se neposouvá).
- Zdroj, který vrátí 0 inzerátů, se bere jako chyba (pravděpodobně se změnila struktura webu), aby se omylem nesmazala data.
- Frontend ukáže upozornění, např. „jobs.cz: poslední stažení selhalo (25. 11.)“.
- Scraper posílá běžný User-Agent, mezi požadavky dělá krátké pauzy a stahuje jen to, co potřebuje.

## Frontend

Čisté HTML, CSS a JavaScript bez build kroku. Funguje na počítači i v mobilu.

### Záložky
1. **Inzeráty** – ranní kontrola.
2. **Moje žádosti** – tracking.
3. **Profil** – skills a požadavky.
4. **Pryč** – vyřazené inzeráty s možností vrátit.

### Profil: skills a požadavky
- **Skills:** seznam položek. Každá má název a volitelně synonyma (např. „Google Ads“ + „AdWords“, „PPC“). Volitelná úroveň 1–3 slouží jako váha ve skóre.
- **Požadavky:**
  - hledané pozice (seznam klíčových slov v názvu pozice),
  - lokalita (seznam měst) a režim: na místě / hybrid / remote,
  - minimální plat (Kč měsíčně),
  - úvazek: plný / částečný / kontrakt (IČO),
  - zakázaná slova (inzerát s nimi se nezobrazí).
- **Výchozí nastavení vs. aktuální úpravy:** profil má uloženou výchozí verzi a pracovní verzi. Každá změna se okamžitě projeví ve výsledcích. Tlačítka:
  - **Uložit jako výchozí** – pracovní verze přepíše výchozí,
  - **Vrátit na výchozí** – zahodí úpravy.
  - Když se pracovní verze liší od výchozí, ukáže se štítek „upraveno oproti výchozímu“.

### Vyhodnocení inzerátu (`matching.js`)
Čisté funkce bez závislosti na DOM, testovatelné samostatně.

**Tvrdé filtry** (inzerát, který je nesplní, se skryje):
- název neobsahuje žádnou hledanou pozici (pokud je seznam neprázdný),
- lokalita nesedí a inzerát není remote, pokud uživatel remote přijímá,
- `salary_max` (nebo `salary_min`) je pod minimálním platem. **Inzerát bez uvedeného platu projde.**
- úvazek nesedí (pokud je v inzerátu uvedený),
- obsahuje zakázané slovo.

Přepínač **„Zobrazit i mimo požadavky“** ukáže skryté inzeráty s poznámkou, který požadavek nesplňují.

**Skóre shody** 0–100 %: součet vah skills, jejichž název nebo synonymum se objeví v názvu či popisu inzerátu (bez ohledu na velikost písmen a diakritiku), dělený součtem vah všech skills. U inzerátu se zobrazí, které skills sedí a které chybí.

### Ranní kontrola (záložka Inzeráty)
- Nahoře souhrn: „12 nových od minula · 3 odložené“ a stav zdrojů.
- Pořadí: nejdřív **nové od minula** (`first_seen` po poslední návštěvě, uložené v localStorage), pak ostatní. V obou skupinách řazení podle skóre.
- Karta inzerátu: pozice, firma, lokalita a remote, plat (pokud je), zdroj, datum, skóre a odpovídající skills. Rozbalením se zobrazí popis, informace o firmě a tipy na pohovor.
- Odkaz „Otevřít inzerát“ vede na původní web.

### Třídění
Každý inzerát má stav třídění, uložený v localStorage podle `id`:

| Stav | Tlačítko | Chování |
|---|---|---|
| Nový | – | Výchozí stav. |
| Pryč | **Pryč** | Inzerát se přestane zobrazovat, i když ho stahování najde znovu. Je v záložce „Pryč“, odkud jde vrátit. |
| Možná | **Možná** | Zůstává ve výsledcích s označením „možná“. Jde filtrovat jen „Možná“. |
| Beru | **Beru** | Přesune se do „Moje žádosti“ se stavem *Připravuji*. Ve výsledcích má štítek „v žádostech“. |

### Moje žádosti (tracking)
- Stavy: **Připravuji → Odesláno → Pohovor → Nabídka**, nebo **Zamítnuto** / **Bez odpovědi**.
- U každé žádosti: datum odeslání (vyplní se automaticky při přepnutí na *Odesláno*, jde upravit), poznámka a odkaz na inzerát.
- Filtr: vše / odesláno / neodesláno (*Připravuji*).
- Údaje o inzerátu se při přesunu do žádostí zkopírují do localStorage, takže žádost zůstane čitelná, i když inzerát z webu zmizí.

### Informace o firmě
V rozbaleném inzerátu: název, popis a odkaz na web firmy, pokud je zdroj uvádí (Cocuma má firemní profily, StartupJobs a jobs.cz často také). Když web chybí, zobrazí se odkaz „Vyhledat firmu“ (vyhledávání názvu firmy na Googlu).

### Tipy na pohovor
Sekce **„Tipy na pohovor“** v rozbaleném inzerátu, ve výchozím stavu sbalená.
- **Obecné tipy** z `web/tips.json`, vybrané podle klíčových slov v názvu pozice (např. e-commerce, marketing, obchod, obecné). Zdroj startup přidá tipy pro startupy.
- **Tipy na míru** podle profilu: seznam chybějících skills s doporučením, jak je na pohovoru pokrýt.
- Tlačítko **„Zkopírovat prompt pro AI“** zkopíruje do schránky připravený text (inzerát, firma, skills uživatele a prosba o přípravu na pohovor) k vložení do bezplatného Claude.ai nebo ChatGPT.

### Uložení dat a záloha (`storage.js`)
- localStorage obsahuje profil (výchozí a pracovní), třídění, žádosti a čas poslední návštěvy. Klíče jsou verzované (`jobsearcher:v1:*`) kvůli budoucím změnám formátu.
- **Exportovat zálohu** stáhne JSON soubor se vším. **Načíst zálohu** ho nahraje, třeba na jiném zařízení. Před přepsáním se zobrazí potvrzení.
- V záložce Profil je upozornění, že data jsou jen v tomto prohlížeči a doporučení zálohovat.

## Testování
- **Scraper:** `pytest` testuje parsery každého zdroje na uložených ukázkách v `tests/fixtures/`. Výsledek musí obsahovat název, firmu a URL a očekávaný počet inzerátů. Test `run.py` ověří slučování (`first_seen` / `last_seen`), odstranění po 14 dnech a ochranu při 0 výsledcích.
- **Matching:** `node --test` nad `matching.js`: filtry (včetně inzerátu bez platu), skóre, synonyma, diakritika.
- **Workflow:** testy běží v GitHub Actions před stahováním. Když selžou, data ani stránka se nemění.
- Ruční ověření UI v prohlížeči před nasazením.

## Mimo první verzi
- E-mailová nebo push upozornění na nové inzeráty.
- Import skills z CV.
- Synchronizace dat mezi zařízeními (nahrazuje ji export a import zálohy).
- Úprava hledaných pozic pro scraper přímo z aplikace.
- Spuštění stahování tlačítkem v aplikaci (na statické stránce by vyžadovalo veřejný přístupový token).

## Rizika
- **Blokování nebo změna struktury webů.** Weby můžou zablokovat požadavky z GitHubu nebo změnit HTML a API. Zmírnění: testy na ukázkách, kontrola 0 výsledků, zobrazení stavu zdrojů, záloha přes Playwright.
- **Podmínky použití webů.** Stahování je v malém rozsahu pro osobní potřebu jednoho uživatele, jednou denně a s pauzami.
- **Ztráta dat v prohlížeči.** Vymazání dat prohlížeče smaže profil i tracking. Zmírnění: export zálohy a upozornění v aplikaci.
