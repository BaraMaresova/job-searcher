// Vyhodnocení inzerátu proti profilu. Čisté funkce bez DOM, testované v tests/matching.test.js.

export const MODES = ["onsite", "hybrid", "remote"];
export const EMPLOYMENT = ["plny", "castecny", "kontrakt"];

/** Malá písmena, bez diakritiky, bez pomlček („E-shop“ → „eshop“). */
export function fold(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/-/g, "");
}

/** Text připravený na hledání celých slov: „ google ads ga4 “. */
function words(text) {
  return " " + fold(text).replace(/[^a-z0-9+#.]+/g, " ").replace(/\.(\s|$)/g, " ").trim() + " ";
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Celé slovo; u slov od 4 znaků toleruje české koncovky („Shoptet“ najde i „Shoptetu“). */
function containsWord(haystackWords, needle) {
  const n = words(needle).trim();
  if (!n) return false;
  const last = n.split(" ").pop();
  const suffix = last.length >= 4 ? "[a-z]{0,4}" : "";
  return new RegExp(" " + escapeRe(n) + suffix + " ").test(haystackWords);
}

export function jobText(job) {
  return [job.title, job.description, (job.tags || []).join(" ")].join(" ");
}

/**
 * Vrátí { pass, reasons, score, matched, missing }.
 * reasons: proč inzerát nesplňuje tvrdé požadavky (prázdné = splňuje).
 */
export function evaluate(job, profile) {
  const reasons = [];
  const title = fold(job.title);
  const text = jobText(job);
  const foldedText = fold(text);

  const positions = (profile.positions || []).filter(Boolean);
  if (positions.length && !positions.some((p) => title.includes(fold(p).trim()))) {
    reasons.push("pozice");
  }

  const modes = profile.modes || MODES;
  if (job.remote && !modes.includes(job.remote)) {
    reasons.push("režim práce");
  }

  const locations = (profile.locations || []).filter(Boolean);
  const remoteOk = job.remote === "remote" && modes.includes("remote");
  if (locations.length && job.location && !remoteOk) {
    const loc = fold(job.location);
    if (!locations.some((l) => loc.includes(fold(l).trim()))) reasons.push("lokalita");
  }

  const min = Number(profile.minSalary) || 0;
  const top = job.salary_max ?? job.salary_min;
  if (min && top != null && top < min) {
    reasons.push("plat");
  }

  const emp = profile.employment || [];
  const jobEmp = job.employment || [];
  if (emp.length && jobEmp.length && !jobEmp.some((e) => emp.includes(e))) {
    reasons.push("úvazek");
  }

  const banned = (profile.banned || []).filter(Boolean);
  if (banned.some((b) => foldedText.includes(fold(b).trim()))) {
    reasons.push("zakázané slovo");
  }

  const { score, matched, missing } = skillScore(text, profile.skills || []);
  return { pass: reasons.length === 0, reasons, score, matched, missing };
}

export function skillScore(text, skills) {
  const w = words(text);
  let total = 0;
  let got = 0;
  const matched = [];
  const missing = [];
  for (const s of skills) {
    if (!s || !s.name) continue;
    const weight = Number(s.level) || 2;
    total += weight;
    const names = [s.name, ...(s.aliases || [])].filter(Boolean);
    if (names.some((n) => containsWord(w, n))) {
      got += weight;
      matched.push(s.name);
    } else {
      missing.push(s.name);
    }
  }
  return { score: total ? Math.round((got / total) * 100) : 0, matched, missing };
}

/** Pořadí: nové od minula nahoře, pak podle skóre, pak podle data. */
export function sortJobs(items) {
  return items.slice().sort((a, b) =>
    (b.isNew - a.isNew) ||
    (b.result.score - a.result.score) ||
    String(b.job.first_seen).localeCompare(String(a.job.first_seen)));
}

/** Je inzerát nový od poslední návštěvy? prevDay = den předchozí návštěvy (YYYY-MM-DD) nebo null. */
export function isNewSince(job, prevDay) {
  if (!prevDay) return true;
  return String(job.first_seen) > prevDay;
}

export function profilesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
