// Uložení dat v prohlížeči (localStorage) a záloha do souboru.

const PREFIX = "jobsearcher:v1:";
const KEYS = ["profileDefault", "profileWorking", "triage", "applications", "lastDay", "prevDay"];

export const DEFAULT_PROFILE = {
  positions: ["e-commerce", "ecommerce", "e-shop", "online marketing"],
  locations: ["Praha"],
  modes: ["onsite", "hybrid", "remote"],
  minSalary: 0,
  employment: ["plny"],
  banned: [],
  skills: [
    { name: "Shoptet", aliases: [], level: 2 },
    { name: "Google Ads", aliases: ["PPC", "AdWords"], level: 2 },
    { name: "Meta Ads", aliases: ["Facebook Ads", "Facebook reklama"], level: 2 },
    { name: "Google Analytics", aliases: ["GA4"], level: 2 },
    { name: "E-mail marketing", aliases: ["Klaviyo", "Ecomail", "Mailchimp"], level: 2 },
    { name: "SEO", aliases: [], level: 1 },
    { name: "Excel", aliases: ["Google Sheets"], level: 1 },
    { name: "Angličtina", aliases: ["English", "AJ"], level: 1 },
  ],
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value));
}

const clone = (x) => JSON.parse(JSON.stringify(x));

export const store = {
  defaultProfile: () => read("profileDefault", clone(DEFAULT_PROFILE)),
  workingProfile() {
    return read("profileWorking", null) || this.defaultProfile();
  },
  setWorking: (p) => write("profileWorking", p),
  saveAsDefault(p) {
    write("profileDefault", p);
    write("profileWorking", p);
  },
  resetToDefault() {
    const d = this.defaultProfile();
    write("profileWorking", d);
    return clone(d);
  },

  triage: () => read("triage", {}),
  setTriage(id, state) {
    const t = this.triage();
    if (state) t[id] = { state, at: new Date().toISOString() };
    else delete t[id];
    write("triage", t);
  },

  applications: () => read("applications", {}),
  saveApplication(id, app) {
    const a = this.applications();
    a[id] = app;
    write("applications", a);
  },
  removeApplication(id) {
    const a = this.applications();
    delete a[id];
    write("applications", a);
  },

  /** Zaznamená dnešní návštěvu. Vrátí den předchozí návštěvy (pro „nové od minula“). */
  registerVisit(today) {
    const last = read("lastDay", null);
    if (last !== today) {
      write("prevDay", last);
      write("lastDay", today);
    }
    return read("prevDay", null);
  },

  exportAll() {
    const out = { app: "job-searcher", version: 1, exported_at: new Date().toISOString() };
    for (const k of KEYS) out[k] = read(k, null);
    return out;
  },
  importAll(data) {
    if (!data || data.app !== "job-searcher") throw new Error("Tohle není záloha z Job Searcheru.");
    for (const k of KEYS) {
      if (data[k] === null || data[k] === undefined) localStorage.removeItem(PREFIX + k);
      else write(k, data[k]);
    }
  },
};
