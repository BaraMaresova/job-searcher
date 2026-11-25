import { evaluate, isNewSince, sortJobs, profilesEqual, MODES, EMPLOYMENT } from "./matching.js";
import { store } from "./storage.js";

const SOURCE_LABEL = { cocuma: "Cocuma", jobscz: "jobs.cz", startupjobs: "StartupJobs" };
const MODE_LABEL = { onsite: "Na místě", hybrid: "Hybrid", remote: "Remote" };
const EMP_LABEL = { plny: "Plný úvazek", castecny: "Částečný", kontrakt: "Kontrakt / IČO" };
const APP_STATUS = {
  pripravuji: "Připravuji",
  odeslano: "Odesláno",
  pohovor: "Pohovor",
  nabidka: "Nabídka",
  zamitnuto: "Zamítnuto",
  bez_odpovedi: "Bez odpovědi",
};
const TRIAGE_LABEL = { mozna: "Možná", beru: "v žádostech" };
const PAGE_SIZE = 40;

const state = {
  jobs: [],
  status: {},
  tips: { categories: [] },
  profile: store.workingProfile(),
  prevDay: null,
  filter: "all",
  appsFilter: "all",
  search: "",
  showAll: false,
  limit: PAGE_SIZE,
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" }) : "");
const fmtMoney = (n) => n.toLocaleString("cs-CZ");

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

async function loadJson(name, bases = ["data/", "../data/"]) {
  for (const base of bases) {
    try {
      const r = await fetch(base + name, { cache: "no-cache" });
      if (r.ok) return await r.json();
    } catch { /* zkusit další cestu */ }
  }
  return null;
}

// ---------- Inzeráty ----------

function salaryText(job) {
  if (job.salary_min == null) return null;
  if (job.salary_max && job.salary_max !== job.salary_min) return `${fmtMoney(job.salary_min)}–${fmtMoney(job.salary_max)} Kč`;
  return `${fmtMoney(job.salary_min)} Kč`;
}

function evaluated() {
  const triage = store.triage();
  const q = state.search.trim().toLowerCase();
  return state.jobs
    .filter((job) => triage[job.id]?.state !== "pryc")
    .map((job) => ({
      job,
      result: evaluate(job, state.profile),
      isNew: isNewSince(job, state.prevDay),
      triage: triage[job.id]?.state || null,
    }))
    .filter((x) => !q || `${x.job.title} ${x.job.company?.name} ${x.job.description}`.toLowerCase().includes(q));
}

function renderJobs() {
  const all = evaluated();
  const passing = all.filter((x) => x.result.pass);
  const newCount = passing.filter((x) => x.isNew && !x.triage).length;
  const maybeCount = passing.filter((x) => x.triage === "mozna").length;
  const hidden = all.length - passing.length;

  $("#summary").innerHTML = state.prevDay
    ? `<strong>${newCount}</strong> nových od minula · ${passing.length} odpovídá požadavkům · ${maybeCount} možná`
    : `<strong>${passing.length}</strong> inzerátů odpovídá požadavkům`;

  let items = state.showAll ? all : passing;
  if (state.filter === "new") items = items.filter((x) => x.isNew && !x.triage);
  if (state.filter === "mozna") items = items.filter((x) => x.triage === "mozna");
  items = sortJobs(items);

  const list = $("#job-list");
  if (!state.jobs.length) {
    list.innerHTML = `<div class="empty">Zatím nejsou stažené žádné inzeráty.</div>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = `<div class="empty">Nic tu není.${hidden && !state.showAll ? ` ${hidden} inzerátů nesplňuje požadavky, zobrazíte je přepínačem „i mimo požadavky“.` : ""}</div>`;
    return;
  }
  const shown = items.slice(0, state.limit);
  list.innerHTML = shown.map(jobCard).join("") +
    (items.length > shown.length ? `<div class="empty"><button id="more">Zobrazit dalších ${Math.min(PAGE_SIZE, items.length - shown.length)} (zbývá ${items.length - shown.length})</button></div>` : "") +
    (!state.showAll && hidden ? `<p class="muted" style="text-align:center">${hidden} inzerátů je skrytých, protože nesplňují požadavky.</p>` : "");
}

function jobCard({ job, result, isNew, triage }) {
  const meta = [
    job.company?.name,
    job.location,
    job.remote ? MODE_LABEL[job.remote] : null,
    salaryText(job),
    SOURCE_LABEL[job.source] || job.source,
    fmtDate(job.first_seen),
  ].filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join("");

  const badges = [
    isNew && !triage ? `<span class="badge new">Nové</span>` : "",
    triage ? `<span class="badge state">${esc(TRIAGE_LABEL[triage])}</span>` : "",
    ...result.reasons.map((r) => `<span class="badge warn">nesplňuje: ${esc(r)}</span>`),
    ...result.matched.map((s) => `<span class="badge ok">${esc(s)}</span>`),
    ...result.missing.slice(0, 6).map((s) => `<span class="badge miss">${esc(s)}</span>`),
  ].join("");

  const btn = (st, label, cls = "") =>
    `<button class="small ${cls} ${triage === st ? "on" : ""}" data-act="triage" data-state="${st}" data-id="${esc(job.id)}">${label}</button>`;

  return `
  <article class="job ${result.pass ? "" : "failed"}">
    <div class="job-head">
      <div class="job-main">
        <a class="job-title" href="${esc(job.url)}" target="_blank" rel="noopener">${esc(job.title)}</a>
        <div class="job-meta">${meta}</div>
      </div>
      <div class="score ${result.score < 40 ? "low" : ""}" title="Shoda se skills">${result.score}%<small>shoda</small></div>
    </div>
    <div class="badges">${badges}</div>
    <div class="job-actions">
      ${btn("pryc", "Pryč")}
      ${btn("mozna", "Možná")}
      ${btn("beru", "Beru", "beru")}
      <span class="spacer"></span>
      <a href="${esc(job.url)}" target="_blank" rel="noopener">Otevřít inzerát ↗</a>
    </div>
    <details data-id="${esc(job.id)}"><summary>Detail, firma a tipy na pohovor</summary><div class="detail-body"></div></details>
  </article>`;
}

function companyBlock(c) {
  if (!c) return "";
  const search = `https://www.google.com/search?q=${encodeURIComponent(c.name || "")}`;
  const links = [
    c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">Web firmy ↗</a>` : `<a href="${search}" target="_blank" rel="noopener">Vyhledat firmu ↗</a>`,
    c.profile_url ? `<a href="${esc(c.profile_url)}" target="_blank" rel="noopener">Profil firmy ↗</a>` : "",
  ].filter(Boolean).join(" · ");
  return `<h3>${esc(c.name || "Firma")}</h3>${c.description ? `<p>${esc(c.description)}</p>` : ""}<p>${links}</p>`;
}

function tipsFor(job) {
  const title = `${job.title} ${job.description}`.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/-/g, "");
  return state.tips.categories.filter((c) =>
    !c.keywords.length && !c.sources ||
    (c.sources || []).includes(job.source) ||
    c.keywords.some((k) => title.includes(k)));
}

function aiPrompt(job, result) {
  const p = state.profile;
  return [
    "Pomoz mi připravit se na pohovor na tuto pozici.",
    "",
    `Pozice: ${job.title}`,
    `Firma: ${job.company?.name || "neuvedeno"}${job.company?.website ? ` (${job.company.website})` : ""}`,
    `Odkaz: ${job.url}`,
    job.company?.description ? `O firmě: ${job.company.description}` : "",
    "",
    "Text inzerátu:",
    (job.description || "").slice(0, 4000),
    "",
    `Moje skills: ${(p.skills || []).map((s) => s.name).join(", ")}`,
    result.missing.length ? `Skills z mého profilu, které inzerát nezmiňuje: ${result.missing.join(", ")}` : "",
    "",
    "Připrav prosím: 1) 8–10 pravděpodobných otázek a jak na ně odpovědět s ohledem na moje skills, 2) co si o firmě zjistit předem, 3) co z požadavků mi může chybět a jak to na pohovoru pokrýt, 4) 3 chytré otázky, které můžu položit já.",
  ].filter((l) => l !== "").join("\n");
}

function fillDetail(details) {
  const body = details.querySelector(".detail-body");
  if (body.dataset.filled) return;
  const job = state.jobs.find((j) => j.id === details.dataset.id) || store.applications()[details.dataset.id]?.job;
  if (!job) return;
  const result = evaluate(job, state.profile);
  const tips = tipsFor(job);
  body.innerHTML = `
    ${job.description ? `<h3>Popis</h3><div class="desc">${esc(job.description)}</div>` : ""}
    ${companyBlock(job.company)}
    <details class="tips"><summary>Tipy na pohovor</summary>
      ${tips.map((c) => `<h3>${esc(c.label)}</h3><ul>${c.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`).join("")}
      ${result.missing.length ? `<h3>Na co se připravit</h3><ul><li>Inzerát nezmiňuje tyto vaše skills: ${esc(result.missing.join(", "))}. Pokud jsou pro roli užitečné, zmiňte je sami a ukažte konkrétní příklad.</li><li>Projděte požadavky v inzerátu, které nemáte v profilu, a připravte si, jak je doplníte nebo čím je nahradíte.</li></ul>` : ""}
      <p><button class="small" data-act="copy-prompt" data-id="${esc(job.id)}">Zkopírovat prompt pro AI</button>
      <span class="muted">Vložte ho do Claude.ai nebo ChatGPT a dostanete přípravu na míru.</span></p>
    </details>`;
  body.dataset.filled = "1";
}

// ---------- Třídění a žádosti ----------

function setTriage(id, st) {
  const current = store.triage()[id]?.state;
  const next = current === st ? null : st;
  store.setTriage(id, next);
  const apps = store.applications();
  if (next === "beru" && !apps[id]) {
    const job = state.jobs.find((j) => j.id === id);
    store.saveApplication(id, { status: "pripravuji", sentAt: null, note: "", createdAt: today(), job });
    toast("Přidáno do Mých žádostí");
  } else if (current === "beru" && next !== "beru" && apps[id] && apps[id].status === "pripravuji") {
    store.removeApplication(id);
  }
  if (next === "pryc") toast("Inzerát je pryč. Vrátit ho jde v záložce Pryč.");
  renderAll();
}

function renderApps() {
  const apps = Object.entries(store.applications())
    .map(([id, a]) => ({ id, ...a }))
    .filter((a) => state.appsFilter === "all" ||
      (state.appsFilter === "sent" ? a.status !== "pripravuji" : a.status === "pripravuji"))
    .sort((a, b) => String(b.sentAt || b.createdAt).localeCompare(String(a.sentAt || a.createdAt)));

  $("#app-list").innerHTML = apps.length ? apps.map((a) => `
    <article class="job">
      <div class="job-head"><div class="job-main">
        <a class="job-title" href="${esc(a.job?.url)}" target="_blank" rel="noopener">${esc(a.job?.title)}</a>
        <div class="job-meta"><span>${esc(a.job?.company?.name)}</span><span>${esc(SOURCE_LABEL[a.job?.source] || "")}</span>${state.jobs.some((j) => j.id === a.id) ? "" : "<span>inzerát už není aktivní</span>"}</div>
      </div></div>
      <div class="app-grid">
        <label>Stav<select data-app="status" data-id="${esc(a.id)}">
          ${Object.entries(APP_STATUS).map(([k, v]) => `<option value="${k}" ${a.status === k ? "selected" : ""}>${v}</option>`).join("")}
        </select></label>
        <label>Odesláno dne<input type="date" data-app="sentAt" data-id="${esc(a.id)}" value="${esc(a.sentAt || "")}"></label>
        <label class="full">Poznámka<textarea rows="2" data-app="note" data-id="${esc(a.id)}">${esc(a.note)}</textarea></label>
      </div>
      <div class="job-actions"><button class="small ghost" data-act="remove-app" data-id="${esc(a.id)}">Odebrat ze žádostí</button>
        <span class="spacer"></span><a href="${esc(a.job?.url)}" target="_blank" rel="noopener">Otevřít inzerát ↗</a></div>
      <details data-id="${esc(a.id)}"><summary>Detail, firma a tipy na pohovor</summary><div class="detail-body"></div></details>
    </article>`).join("") : `<div class="empty">Zatím žádné žádosti. U inzerátu klikněte na „Beru“.</div>`;
}

function updateApp(id, field, value) {
  const apps = store.applications();
  const a = apps[id];
  if (!a) return;
  a[field] = value;
  if (field === "status" && value !== "pripravuji" && !a.sentAt) a.sentAt = today();
  store.saveApplication(id, a);
  if (field === "status") renderAll();
}

function renderGone() {
  const triage = store.triage();
  const gone = state.jobs.filter((j) => triage[j.id]?.state === "pryc");
  $("#gone-list").innerHTML = gone.length ? gone.map((j) => `
    <article class="job"><div class="job-head"><div class="job-main">
      <a class="job-title" href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
      <div class="job-meta"><span>${esc(j.company?.name)}</span><span>${esc(j.location || "")}</span></div>
    </div><button class="small" data-act="restore" data-id="${esc(j.id)}">Vrátit</button></div></article>`).join("")
    : `<div class="empty">Nic tu není.</div>`;
}

// ---------- Profil ----------

function renderProfile() {
  const p = state.profile;
  $("#skills").innerHTML = (p.skills || []).map((s, i) => `
    <div class="skill-row">
      <input placeholder="Skill" value="${esc(s.name)}" data-skill="name" data-i="${i}">
      <input placeholder="Synonyma, oddělená čárkou" value="${esc((s.aliases || []).join(", "))}" data-skill="aliases" data-i="${i}">
      <select data-skill="level" data-i="${i}">
        ${[[1, "Váha 1"], [2, "Váha 2"], [3, "Váha 3"]].map(([v, l]) => `<option value="${v}" ${Number(s.level) === v ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      <button class="ghost" title="Odebrat" data-act="del-skill" data-i="${i}">✕</button>
    </div>`).join("");
  document.querySelectorAll("[data-list]").forEach((el) => (el.value = (p[el.dataset.list] || []).join(", ")));
  $("#min-salary").value = p.minSalary || "";
  $("#modes").innerHTML = MODES.map((m) => `<label><input type="checkbox" data-mode="${m}" ${p.modes?.includes(m) ? "checked" : ""}> ${MODE_LABEL[m]}</label>`).join("");
  $("#employment").innerHTML = EMPLOYMENT.map((e) => `<label><input type="checkbox" data-emp="${e}" ${p.employment?.includes(e) ? "checked" : ""}> ${EMP_LABEL[e]}</label>`).join("") +
    `<span class="muted">(nic nezaškrtnuto = jakýkoliv)</span>`;
  renderProfileState();
}

function renderProfileState() {
  const dirty = !profilesEqual(state.profile, store.defaultProfile());
  $("#profile-state").innerHTML = dirty
    ? `<span class="dirty">Upraveno oproti výchozímu.</span> Výsledky už se řídí úpravami.`
    : "Odpovídá výchozímu nastavení.";
  $("#profile-dirty").hidden = !dirty;
  $("#btn-reset").disabled = !dirty;
  $("#btn-save-default").disabled = !dirty;
}

const splitList = (v) => v.split(",").map((s) => s.trim()).filter(Boolean);

function profileChanged({ rerenderProfile = false } = {}) {
  store.setWorking(state.profile);
  state.limit = PAGE_SIZE;
  if (rerenderProfile) renderProfile();
  else renderProfileState();
  renderJobs();
}

// ---------- Stav zdrojů ----------

function renderStatus() {
  const warn = Object.entries(state.status)
    .filter(([, s]) => !s.ok)
    .map(([name, s]) => `${SOURCE_LABEL[name] || name}: poslední stažení selhalo (${fmtDate(s.at)})${s.last_ok ? `, data jsou z ${fmtDate(s.last_ok)}` : ""}`);
  $("#source-status").innerHTML = warn.map((w) => `<div class="status-warn">${esc(w)}</div>`).join("");
}

function renderCounts() {
  const n = Object.keys(store.applications()).length;
  const triage = store.triage();
  const g = state.jobs.filter((j) => triage[j.id]?.state === "pryc").length;
  $("#count-apps").textContent = n ? `(${n})` : "";
  $("#count-gone").textContent = g ? `(${g})` : "";
}

function renderAll() {
  renderJobs();
  renderApps();
  renderGone();
  renderCounts();
}

// ---------- Události ----------

function bindEvents() {
  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== `tab-${b.dataset.tab}`));
    window.scrollTo(0, 0);
  }));

  const seg = (id, key, render) => $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-filter]");
    if (!b) return;
    state[key] = b.dataset.filter;
    state.limit = PAGE_SIZE;
    $(id).querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    render();
  });
  seg("#filter-seg", "filter", renderJobs);
  seg("#apps-seg", "appsFilter", renderApps);

  $("#search").addEventListener("input", (e) => { state.search = e.target.value; state.limit = PAGE_SIZE; renderJobs(); });
  $("#show-all").addEventListener("change", (e) => { state.showAll = e.target.checked; renderJobs(); });

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-act]");
    if (e.target.id === "more") { state.limit += PAGE_SIZE; renderJobs(); return; }
    if (!el) return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case "triage": setTriage(id, el.dataset.state); break;
      case "restore": store.setTriage(id, null); renderAll(); toast("Inzerát je zpátky ve výsledcích"); break;
      case "remove-app": store.removeApplication(id); if (store.triage()[id]?.state === "beru") store.setTriage(id, null); renderAll(); break;
      case "copy-prompt": {
        const job = state.jobs.find((j) => j.id === id) || store.applications()[id]?.job;
        try { await navigator.clipboard.writeText(aiPrompt(job, evaluate(job, state.profile))); toast("Prompt je ve schránce"); }
        catch { toast("Kopírování se nepovedlo"); }
        break;
      }
      case "del-skill": state.profile.skills.splice(Number(el.dataset.i), 1); profileChanged({ rerenderProfile: true }); break;
    }
  });

  document.addEventListener("toggle", (e) => {
    if (e.target.matches("details[data-id]") && e.target.open) fillDetail(e.target);
  }, true);

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.app) updateApp(t.dataset.id, t.dataset.app, t.value);
  });

  // Profil
  $("#tab-profile").addEventListener("input", (e) => {
    const t = e.target;
    const p = state.profile;
    if (t.dataset.skill) {
      const s = p.skills[Number(t.dataset.i)];
      if (t.dataset.skill === "aliases") s.aliases = splitList(t.value);
      else if (t.dataset.skill === "level") s.level = Number(t.value);
      else s.name = t.value.trim();
    } else if (t.dataset.list) {
      p[t.dataset.list] = splitList(t.value);
    } else if (t.id === "min-salary") {
      p.minSalary = Number(t.value) || 0;
    } else if (t.dataset.mode) {
      p.modes = MODES.filter((m) => $(`[data-mode="${m}"]`).checked);
    } else if (t.dataset.emp) {
      p.employment = EMPLOYMENT.filter((x) => $(`[data-emp="${x}"]`).checked);
    } else return;
    profileChanged();
  });
  $("#btn-add-skill").addEventListener("click", () => {
    state.profile.skills.push({ name: "", aliases: [], level: 2 });
    profileChanged({ rerenderProfile: true });
    const inputs = document.querySelectorAll('[data-skill="name"]');
    inputs[inputs.length - 1]?.focus();
  });
  $("#btn-save-default").addEventListener("click", () => {
    state.profile.skills = state.profile.skills.filter((s) => s.name);
    store.saveAsDefault(state.profile);
    renderProfile();
    toast("Uloženo jako výchozí nastavení");
  });
  $("#btn-reset").addEventListener("click", () => {
    state.profile = store.resetToDefault();
    profileChanged({ rerenderProfile: true });
    toast("Vráceno na výchozí nastavení");
  });

  // Záloha
  $("#btn-export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(store.exportAll(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `job-searcher-zaloha-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $("#file-import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!confirm("Načtením zálohy se přepíše současný profil, třídění i žádosti v tomto prohlížeči. Pokračovat?")) return;
      store.importAll(data);
      state.profile = store.workingProfile();
      renderProfile();
      renderAll();
      toast("Záloha načtena");
    } catch (err) {
      alert("Zálohu se nepodařilo načíst: " + err.message);
    } finally {
      e.target.value = "";
    }
  });
}

async function init() {
  bindEvents();
  state.prevDay = store.registerVisit(today());
  const [jobs, status, tips] = await Promise.all([loadJson("jobs.json"), loadJson("status.json"), loadJson("tips.json", [""])]);
  state.jobs = jobs?.jobs || [];
  state.status = status || {};
  state.tips = tips || { categories: [] };
  renderStatus();
  renderProfile();
  renderAll();
}

init();
