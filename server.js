import express from "express";
import mysql from "mysql2";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import fetch from "node-fetch";
import puppeteer from "puppeteer";
import multer from "multer";
import { createRequire } from "module";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

dotenv.config();
const require = createRequire(import.meta.url);
const pdfParseLib = require("pdf-parse");
const pdfParse = pdfParseLib.default || pdfParseLib;

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://resume-frontend-three.vercel.app"
  ],
  credentials: true,
  exposedHeaders: ["Content-Disposition", "Content-Type"]
}));
app.use(express.json());

const db = mysql.createConnection({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT
});

async function callAI(prompt) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();

  console.log("Status:", response.status);
  console.log("Response:", data);

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  if (!data.choices || !data.choices.length) {
    throw new Error("Invalid AI response: " + JSON.stringify(data));
  }

  return data.choices[0].message.content;
}

/* ═══════════════════════════════════════════════════════
   AUTH ROUTES
═══════════════════════════════════════════════════════ */
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    db.query("INSERT INTO users (username,password) VALUES (?,?)", [username, hashed], (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "User registered successfully" });
    });
  } catch (e) { res.status(500).json(e); }
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  db.query("SELECT * FROM users WHERE username=?", [username], async (err, data) => {
    if (err) return res.status(500).json(err);
    if (!data.length) return res.status(404).json("User not found");
    const valid = await bcrypt.compare(password, data[0].password);
    if (!valid) return res.status(401).json("Invalid password");
    const token = jwt.sign({ id: data[0].id }, process.env.JWT_SECRET || "secret", { expiresIn: "1d" });
    res.json({ message: "Login successful", token, user: data[0] });
  });
});

/* ═══════════════════════════════════════════════════════
   AI BASE PROFILE
═══════════════════════════════════════════════════════ */
app.post("/generate-resume-base", async (req, res) => {
  try {
    const { role, experienceLevel } = req.body;
    const prompt = `Generate a resume professional summary and categorized skills for a ${experienceLevel} ${role}.
Rules:
- Write in FIRST PERSON, 7-8 well-written sentences, natural and professional, ATS-friendly
- Cover: technical expertise, academic background, problem-solving ability, interest in software/AI, and career objective
- Avoid empty buzzwords like "synergy", "leverage", "dynamic"
- Categorize skills using ONLY these category names (omit any that don't apply): "Programming Languages", "Web Development", "Frameworks & Libraries", "Databases", "AI / Machine Learning", "Data Structures & Algorithms", "Tools & Platforms", "Others"
- Put skills like Vibe Coding, Prompt Engineering, C/C++, Error Handling under "Others"
Respond ONLY in JSON, no extra text:
{"summary":"7-8 sentence first-person summary","skillCategories":{"Programming Languages":["Java","Python"],"Web Development":["HTML","CSS","JavaScript"],"Frameworks & Libraries":["React","Node.js","Flask"],"Databases":["MySQL","MongoDB","SQLite"],"AI / Machine Learning":["Machine Learning","Generative AI","LLMs"],"Tools & Platforms":["Git","Postman"],"Others":["Prompt Engineering","C/C++"]},"skills":["Java","Python","HTML","CSS","JavaScript","React","Node.js","Flask","MySQL","MongoDB","SQLite","Machine Learning","Generative AI","Git","Postman","Prompt Engineering","C/C++"]}`;
    const text = await callAI(prompt);
    const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(clean.substring(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
    res.json({ summary: parsed.summary, skills: parsed.skills, skillCategories: parsed.skillCategories });
  } catch (e) {
    res.status(500).json({ error: "AI generation failed", details: e.message });
  }
});

/* ═══════════════════════════════════════════════════════
   SHARED RENDERING HELPERS
   All font sizes set at professional resume standard:
   • Body text / bullets  : 11.5 px
   • Entry titles          : 13 px bold
   • Dates / secondary     : 10.5 px
   • Skill category labels : 12 px bold
   • Cert / participation  : 11.5 px
═══════════════════════════════════════════════════════ */

// Skills that must always go into "Others" regardless of technical keyword matches
const OTHERS_SKILLS = [
  "vibe coding", "prompt engineering", "c/c++", "ui/ux design", "ui/ux",
  "design thinking", "agile", "scrum", "problem solving",
  "communication", "teamwork", "leadership", "presentation", "error handling",
];

const SKILL_CATS = [
  { name: "Programming Languages", kws: [
      "python", "java", "javascript", "typescript", "kotlin", "swift",
      "php", "ruby", "scala", "matlab", "dart", "golang", "go", "rust",
      "c#", "perl", "bash", "shell", "r language", "c language",
  ]},
  { name: "Web Development", kws: [
      "html", "css", "rest api", "web development", "full stack",
      "fullstack", "full-stack", "frontend", "front-end", "backend",
      "back-end", "responsive design", "web design", "sass", "less",
      "webpack", "vite",
  ]},
  { name: "Frameworks & Libraries", kws: [
      "react", "angular", "vue", "next.js", "nuxt", "node.js", "node",
      "express", "django", "flask", "spring", ".net", "tailwind",
      "bootstrap", "jquery", "redux", "graphql", "fastapi", "laravel",
      "rails", "svelte",
  ]},
  { name: "Databases", kws: [
      "mysql", "postgresql", "postgres", "mongodb", "sqlite", "oracle",
      "redis", "firebase", "dynamodb", "cassandra", "supabase", "mariadb",
      "sql", "nosql", "elasticsearch", "prisma",
  ]},
  { name: "AI / Machine Learning", kws: [
      "machine learning", "deep learning", "tensorflow", "pytorch",
      "scikit-learn", "nlp", "computer vision", "generative ai",
      "llm", "large language model", "opencv", "pandas", "numpy",
      "keras", "data science", "ai", "ml", "hugging face",
      "langchain", "rag",
  ]},
  { name: "Data Structures & Algorithms", kws: [
      "data structures", "algorithm", "array", "linked list",
      "stack", "queue", "tree", "graph", "dsa", "sorting",
      "searching", "recursion", "dynamic programming",
  ]},
  { name: "Tools & Platforms", kws: [
      "git", "github", "docker", "kubernetes", "aws", "azure", "gcp",
      "jenkins", "linux", "jira", "postman", "figma", "vs code",
      "ci/cd", "terraform", "nginx", "heroku", "vercel", "netlify",
      "android studio", "xcode",
  ]},
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function keywordMatches(skillLower, kw) {
  if (/[^a-z0-9 ]/i.test(kw)) return skillLower.includes(kw.toLowerCase());
  return new RegExp("\\b" + escapeRegex(kw.trim()) + "\\b", "i").test(skillLower);
}
function isOthersSkill(raw) {
  const lower = raw.toLowerCase().trim();
  return OTHERS_SKILLS.some(k => lower === k || lower.includes(k));
}
function fallbackCategorize(skills) {
  const buckets = SKILL_CATS.map(c => ({ name: c.name, items: [] }));
  const others = { name: "Others", items: [] };
  (Array.isArray(skills) ? skills : []).forEach(raw => {
    const s = String(raw).trim();
    if (!s) return;
    if (isOthersSkill(s)) { others.items.push(s); return; }
    const lower = ` ${s.toLowerCase()} `;
    let matched = false;
    for (let i = 0; i < SKILL_CATS.length; i++) {
      if (SKILL_CATS[i].kws.some(k => keywordMatches(lower, k))) {
        buckets[i].items.push(s); matched = true; break;
      }
    }
    if (!matched) others.items.push(s);
  });
  const result = {};
  buckets.forEach(b => { if (b.items.length) result[b.name] = b.items; });
  if (others.items.length) result["Others"] = others.items;
  return result;
}

function renderSkills(skillCategories, skills, mode = "rows") {
  const allSkills = Array.isArray(skills) ? skills : [];
  const norm = s => String(s).trim().toLowerCase();
  let cats;
  if (skillCategories && typeof skillCategories === "object" && Object.keys(skillCategories).length) {
    cats = {};
    const claimed = new Set();
    Object.entries(skillCategories).forEach(([cat, items]) => {
      if (!Array.isArray(items)) return;
      const kept = items.filter(item => {
        const ok = allSkills.some(s => norm(s) === norm(item));
        if (ok) claimed.add(norm(item));
        return ok;
      });
      if (kept.length) cats[cat] = kept;
    });
    const orphaned = allSkills.filter(s => !claimed.has(norm(s)));
    if (orphaned.length) {
      const orphanCats = fallbackCategorize(orphaned);
      Object.entries(orphanCats).forEach(([cat, items]) => {
        cats[cat] = cats[cat] ? [...cats[cat], ...items] : items;
      });
    }
  } else {
    cats = fallbackCategorize(allSkills);
  }
  const entries = Object.entries(cats).filter(([, items]) => Array.isArray(items) && items.length);
  if (!entries.length) return `<span style="font-size:11.5px;color:#777;">—</span>`;

  if (mode === "grid4") {
    // 4-column grid used by Banner Sections template
    return `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px 18px;margin-top:4px;">
      ${entries.map(([cat, items]) => `<div style="margin-bottom:9px;">
        <div style="font-size:11px;font-weight:700;color:#222;margin-bottom:3px;border-bottom:1px solid #ddd;padding-bottom:2px;">${cat}</div>
        <div style="font-size:10.5px;color:#444;line-height:1.7;">${items.join("<br>")}</div>
      </div>`).join("")}
    </div>`;
  }

  // rows mode — bold category, colon, comma-separated list on same line
  return `<div style="margin-top:3px;">` + entries.map(([cat, items]) =>
    `<div style="display:flex;margin-bottom:5px;align-items:baseline;">
      <span style="font-size:12px;font-weight:700;color:#111;min-width:158px;flex-shrink:0;">${cat}:</span>
      <span style="font-size:12px;color:#333;line-height:1.6;">${items.join(", ")}</span>
    </div>`
  ).join("") + `</div>`;
}

// Certifications — clean bullet list, no boxes, no color
function certList(certifications) {
  const list = (typeof certifications === "string"
    ? certifications.split(",")
    : Array.isArray(certifications) ? certifications : []
  ).map(s => s.trim()).filter(Boolean);
  if (!list.length) return `<span style="font-size:11.5px;color:#777;">—</span>`;
  return `<ul style="list-style:none;padding:0;margin:0;">${list.map(c =>
    `<li style="font-size:11.5px;color:#222;padding-left:14px;position:relative;margin-bottom:4px;line-height:1.55;">
      <span style="position:absolute;left:0;top:0;">•</span>${c}
    </li>`
  ).join("")}</ul>`;
}

// Combined Participations & Certifications section
function renderParticipationsAndCerts(participations, certifications, headColor = "#1a1a1a") {
  const hasPart = participations && String(participations).trim();
  const hasCert = certifications && (Array.isArray(certifications)
    ? certifications.length : String(certifications).trim());
  if (!hasPart && !hasCert) return `<span style="font-size:11.5px;color:#777;">—</span>`;
  return `
    ${hasPart ? `<div style="font-size:10px;font-weight:700;color:${headColor};margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px;">Participations</div>
    <p style="font-size:11.5px;line-height:1.65;color:#333;margin-bottom:${hasCert ? "9px" : "0"};">${participations}</p>` : ""}
    ${hasCert ? `<div style="font-size:10px;font-weight:700;color:${headColor};margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px;">Certifications</div>
    ${certList(certifications)}` : ""}
  `;
}

// Experience — blocks separated by blank lines
function renderExperience(text, o = {}) {
  const tc = o.titleColor || "#1a1a1a", dc = o.dateColor || "#555", bc = o.bulletColor || "#333";
  const timeline = o.timeline === true;
  if (!text || !text.trim()) return `<div style="font-size:11.5px;color:#777;">—</div>`;
  return text.split("\n\n").filter(b => b.trim()).map(block => {
    const lines = block.split("\n").filter(l => l.trim());
    if (!lines.length) return "";
    const h = lines[0], rest = lines.slice(1);
    const dateM = h.match(/\(([^)]+)\)/);
    const dateStr = dateM ? dateM[1] : "";
    const clean = h.replace(/\([^)]+\)/, "").replace(/\s+/g, " ").trim();
    const inner = `<div style="${timeline ? "flex:1;" : "margin-bottom:10px;"}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:13px;font-weight:700;color:${tc};">${clean}</span>
        ${dateStr ? `<span style="font-size:10.5px;color:${dc};font-weight:600;flex-shrink:0;margin-left:8px;">${dateStr}</span>` : ""}
      </div>
      ${rest.length ? `<ul style="list-style:none;padding:0;margin-top:3px;">${rest.map(l =>
        `<li style="font-size:11.5px;color:${bc};padding-left:14px;position:relative;margin-bottom:3px;line-height:1.55;">
          <span style="position:absolute;left:0;">•</span>${l.replace(/^[•\-▸›◆>]\s*/, "")}
        </li>`
      ).join("")}</ul>` : ""}
    </div>`;
    if (!timeline) return inner;
    return `<div style="display:flex;gap:8px;margin-bottom:10px;">
      <div style="display:flex;flex-direction:column;align-items:center;width:10px;flex-shrink:0;margin-top:4px;">
        <div style="width:9px;height:9px;border-radius:50%;background:${tc};flex-shrink:0;"></div>
        <div style="flex:1;width:1.5px;background:#ccc;margin-top:2px;"></div>
      </div>${inner}
    </div>`;
  }).join("");
}

// Projects — numbered entries with plain-text tech stack line
function renderProjects(text, o = {}) {
  const nc = o.nameColor || "#1a1a1a", sc = o.stackColor || "#555", bc = o.bulletColor || "#333";
  const numbered = o.numbered !== false;
  if (!text || !text.trim()) return `<div style="font-size:11.5px;color:#777;">—</div>`;
  return text.split("\n\n").filter(b => b.trim()).map((block, idx) => {
    const lines = block.split("\n").filter(l => l.trim());
    if (!lines.length) return "";
    const [h, ...rest] = lines;
    const pipeIdx = h.indexOf("|"), dashIdx = h.indexOf(" — ");
    const splitIdx = pipeIdx > -1 ? pipeIdx : dashIdx > -1 ? dashIdx : -1;
    const pName = splitIdx > -1 ? h.substring(0, splitIdx).trim() : h;
    const stack = splitIdx > -1 ? h.substring(splitIdx + 1).replace(/^\|?\s*—?\s*/, "").trim() : "";
    return `<div style="margin-bottom:10px;">
      <span style="font-size:13px;font-weight:700;color:${nc};">${numbered ? (idx + 1) + ". " : ""}${pName}</span>
      ${stack ? `<div style="font-size:10.5px;color:${sc};margin-top:2px;"><strong>Tech Stack:</strong> ${stack}</div>` : ""}
      ${rest.length ? `<ul style="list-style:none;padding:0;margin-top:3px;">${rest.map(l =>
        `<li style="font-size:11.5px;color:${bc};padding-left:14px;position:relative;margin-bottom:3px;line-height:1.55;">
          <span style="position:absolute;left:0;">•</span>${l.replace(/^[•\-▸›◆>]\s*/, "")}
        </li>`
      ).join("")}</ul>` : ""}
    </div>`;
  }).join("");
}

// Education — blocks separated by blank lines
function renderEducation(text, o = {}) {
  const ic = o.instColor || "#1a1a1a", dc = o.dateColor || "#555", infoC = o.infoColor || "#444";
  if (!text || !text.trim()) return `<div style="font-size:11.5px;color:#777;">—</div>`;
  return text.split("\n\n").filter(b => b.trim()).map(block => {
    const lines = block.split("\n").filter(l => l.trim());
    if (!lines.length) return "";
    const h = lines[0], rest = lines.slice(1);
    const dateM = h.match(/\(([^)]+)\)/);
    const dateStr = dateM ? dateM[1] : "";
    const clean = h.replace(/\([^)]+\)/, "").replace(/\s+/g, " ").trim();
    return `<div style="margin-bottom:9px;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-size:13px;font-weight:700;color:${ic};">${clean}</span>
        ${dateStr ? `<span style="font-size:10.5px;color:${dc};font-weight:600;flex-shrink:0;margin-left:8px;">${dateStr}</span>` : ""}
      </div>
      ${rest.map(l => `<div style="font-size:11.5px;color:${infoC};margin-top:2px;line-height:1.55;">${l}</div>`).join("")}
    </div>`;
  }).join("");
}

// Monochrome LinkedIn / GitHub inline SVG icons
const LI_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" style="vertical-align:-1px;margin-right:3px;" fill="#333"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.03-1.85-3.03-1.85 0-2.13 1.44-2.13 2.94v5.66H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.8 0 0 .78 0 1.75v20.5C0 23.22.8 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.75V1.75C24 .78 23.2 0 22.22 0z"/></svg>`;
const GH_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" style="vertical-align:-1px;margin-right:3px;" fill="#333"><path d="M12 .5C5.73.5.98 5.24.98 11.5c0 4.86 3.15 8.98 7.52 10.43.55.1.75-.24.75-.53 0-.26-.01-1.13-.02-2.04-3.06.66-3.71-1.3-3.71-1.3-.5-1.28-1.22-1.62-1.22-1.62-1-.68.08-.67.08-.67 1.1.08 1.68 1.14 1.68 1.14.98 1.67 2.57 1.19 3.2.91.1-.71.38-1.19.69-1.46-2.44-.28-5-1.22-5-5.42 0-1.2.43-2.18 1.13-2.95-.11-.28-.49-1.41.11-2.94 0 0 .92-.3 3.02 1.13a10.4 10.4 0 0 1 5.5 0c2.1-1.43 3.02-1.13 3.02-1.13.6 1.53.22 2.66.11 2.94.7.77 1.13 1.75 1.13 2.95 0 4.21-2.57 5.13-5.02 5.4.39.34.74 1.02.74 2.06 0 1.49-.01 2.69-.01 3.06 0 .29.2.64.76.53A11.5 11.5 0 0 0 23.02 11.5C23.02 5.24 18.27.5 12 .5z"/></svg>`;

function contactLineWithIcons(p, sep = " &nbsp;|&nbsp; ") {
  const basics = [p.email, p.phone, p.location].filter(Boolean);
  const socials = [];
  if (p.linkedin) socials.push(`${LI_ICON}${p.linkedin}`);
  if (p.github)   socials.push(`${GH_ICON}${p.github}`);
  return [...basics, ...socials].join(sep);
}

const v = x => x || "";

// Inline fit-to-page script (fallback safety; Puppeteer-side also runs)
const fitScript = `<script>
window.onload = function() {
  var root = document.querySelector('.rp') || document.querySelector('.rr');
  if (!root) return;
  var H = 1122;
  var h = root.scrollHeight;
  if (h > H) {
    var sc = H / h;
    root.style.transform = 'scale('+sc+')';
    root.style.transformOrigin = 'top left';
    root.style.width = Math.round(100/sc)+'%';
  }
};
</script>`;

/* ═══════════════════════════════════════════════════════
   GENERATE RESUME — 6 TEMPLATES
═══════════════════════════════════════════════════════ */
app.post("/generate-resume", async (req, res) => {
  try {
    const {
      role, fullName, email, phone, location, linkedin, github, summary,
      skills, skillCategories, projects, experience, education,
      certifications, participations, leadership, languages, additionalInfo,
      templateId
    } = req.body;

    const contact = {
      email: v(email), phone: v(phone), location: v(location),
      linkedin: v(linkedin), github: v(github)
    };

    /* ════════════════════════════════════════════════════
       TEMPLATE 1 — CLASSIC CORPORATE
       Bold name, 2.5 px rule, label | bar | content rows.
       Body: 11.5 px · Name: 28 px · Role: 13 px
    ════════════════════════════════════════════════════ */
    const T_CLASSIC = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:210mm;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;font-size:11.5px;}
.rr{width:210mm;padding:9mm 11mm 7mm;}
.hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #111;padding-bottom:8px;margin-bottom:6px;}
.hdr-name{font-size:28px;font-weight:900;color:#111;line-height:1.1;letter-spacing:0.3px;}
.hdr-sub{font-size:13px;color:#444;margin-top:3px;font-style:italic;}
.hdr-right{text-align:right;font-size:10px;color:#444;line-height:1.8;}
.rule{border:none;border-top:1px solid #bbb;margin:4px 0 8px;}
.sec{display:flex;gap:0;margin-top:10px;align-items:stretch;}
.lbl{width:96px;flex-shrink:0;padding-top:2px;}
.lbl span{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:1.6px;color:#444;}
.vbar{width:1.5px;background:#222;flex-shrink:0;margin-right:11px;}
.body{flex:1;}
.body p{font-size:11.5px;line-height:1.65;color:#222;text-align:justify;}
</style></head><body>
<div class="rr">
  <div class="hdr">
    <div>
      <div class="hdr-name">${v(fullName)}</div>
      <div class="hdr-sub">${v(role)}</div>
    </div>
    <div class="hdr-right">${contactLineWithIcons(contact, "<br>")}</div>
  </div>
  <hr class="rule">
  ${v(summary) ? `<div class="sec"><div class="lbl"><span>Summary</span></div><div class="vbar"></div><div class="body"><p>${summary}</p></div></div>` : ""}
  <div class="sec"><div class="lbl"><span>Skills</span></div><div class="vbar"></div><div class="body">${renderSkills(skillCategories, skills, "rows")}</div></div>
  ${v(experience) ? `<div class="sec"><div class="lbl"><span>Experience</span></div><div class="vbar"></div><div class="body">${renderExperience(experience)}</div></div>` : ""}
  ${v(projects) ? `<div class="sec"><div class="lbl"><span>Projects</span></div><div class="vbar"></div><div class="body">${renderProjects(projects)}</div></div>` : ""}
  ${v(education) ? `<div class="sec"><div class="lbl"><span>Education</span></div><div class="vbar"></div><div class="body">${renderEducation(education)}</div></div>` : ""}
  <div class="sec"><div class="lbl"><span>Participations &amp; Certs</span></div><div class="vbar"></div><div class="body">${renderParticipationsAndCerts(participations, certifications)}</div></div>
  ${v(leadership) ? `<div class="sec"><div class="lbl"><span>Leadership</span></div><div class="vbar"></div><div class="body"><p style="font-size:11.5px;line-height:1.65;color:#222;">${leadership}</p></div></div>` : ""}
  ${v(languages) || v(additionalInfo) ? `<div class="sec"><div class="lbl"><span>Additional</span></div><div class="vbar"></div><div class="body"><p style="font-size:11.5px;line-height:1.65;color:#222;">${v(additionalInfo) ? `<strong>Course Work:</strong> ${additionalInfo}<br>` : ""}${v(languages) ? `<strong>Languages Known:</strong> ${languages}` : ""}</p></div></div>` : ""}
</div>
${fitScript}</body></html>`;

    /* ════════════════════════════════════════════════════
       TEMPLATE 2 — EXECUTIVE
       Dark charcoal header, Georgia serif.
       Body: 11.5 px · Name: 25 px · Section headers: 10 px
    ════════════════════════════════════════════════════ */
    const T_EXECUTIVE = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:210mm;font-family:Georgia,'Times New Roman',serif;font-size:11.5px;color:#1a1a1a;}
.rr{width:210mm;padding:0 0 7mm;}
.hdr{background:#1a1a1a;color:#fff;padding:17px 26px;}
.hdr h1{font-size:25px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;line-height:1.1;}
.hdr-role{font-size:11px;color:#bbb;margin-top:3px;letter-spacing:1px;}
.hdr-c{font-size:10px;color:#ccc;margin-top:5px;}
.hdr-c svg{filter:invert(1) brightness(2);}
.bd{padding:11px 26px;}
.st{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.8px;color:#1a1a1a;border-bottom:1.5px solid #1a1a1a;padding-bottom:2px;margin:10px 0 6px;}
.bd p{font-size:11.5px;line-height:1.65;color:#333;text-align:justify;}
</style></head><body>
<div class="rr">
  <div class="hdr">
    <h1>${v(fullName)}</h1>
    <div class="hdr-role">${v(role)}</div>
    <div class="hdr-c">${contactLineWithIcons(contact)}</div>
  </div>
  <div class="bd">
    ${v(summary) ? `<div class="st">Professional Summary</div><p>${summary}</p>` : ""}
    <div class="st">Technical Skills</div>${renderSkills(skillCategories, skills, "rows")}
    ${v(experience) ? `<div class="st">Internship &amp; Work Experience</div>${renderExperience(experience, { titleColor: "#1a1a1a" })}` : ""}
    ${v(projects) ? `<div class="st">Projects</div>${renderProjects(projects, { nameColor: "#1a1a1a" })}` : ""}
    ${v(education) ? `<div class="st">Education</div>${renderEducation(education, { instColor: "#1a1a1a" })}` : ""}
    <div class="st">Participations &amp; Certifications</div>${renderParticipationsAndCerts(participations, certifications)}
    ${v(leadership) ? `<div class="st">Leadership &amp; Event Conductions</div><p>${leadership}</p>` : ""}
    ${v(languages) || v(additionalInfo) ? `<div class="st">Additional Information</div><p>${v(additionalInfo) ? `<strong>Course Work:</strong> ${additionalInfo}<br>` : ""}${v(languages) ? `<strong>Languages Known:</strong> ${languages}` : ""}</p>` : ""}
  </div>
</div>
${fitScript}</body></html>`;

    /* ════════════════════════════════════════════════════
       TEMPLATE 3 — MINIMAL ELEGANT
       Centred uppercase name, ruled sections.
       Body: 11.5 px · Name: 24 px · Section headers: 12 px
    ════════════════════════════════════════════════════ */
    const T_MINIMAL = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:210mm;font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;font-size:11.5px;}
.rr{width:210mm;padding:9mm 11mm 7mm;}
.hdr{text-align:center;margin-bottom:8px;padding-bottom:7px;border-bottom:1.5px solid #111;}
.hdr h1{font-size:24px;font-weight:900;text-transform:uppercase;letter-spacing:2.5px;color:#111;line-height:1.1;}
.hdr-sub{font-size:10px;color:#555;margin-top:5px;line-height:1.8;}
.st{font-size:12px;font-weight:700;color:#111;border-bottom:1.2px solid #555;padding-bottom:2px;margin:10px 0 6px;text-transform:capitalize;letter-spacing:0.3px;}
p{font-size:11.5px;line-height:1.65;color:#222;text-align:justify;}
</style></head><body>
<div class="rr">
  <div class="hdr">
    <h1>${v(fullName)}</h1>
    <div class="hdr-sub">${contactLineWithIcons(contact, " &nbsp;|&nbsp; ")}</div>
  </div>
  ${v(summary) ? `<div class="st">Professional Summary</div><p>${summary}</p>` : ""}
  <div class="st">Technical Skills</div>${renderSkills(skillCategories, skills, "rows")}
  ${v(experience) ? `<div class="st">Internship Experience</div>${renderExperience(experience)}` : ""}
  ${v(projects) ? `<div class="st">Projects</div>${renderProjects(projects)}` : ""}
  ${v(education) ? `<div class="st">Education</div>${renderEducation(education)}` : ""}
  <div class="st">Participations &amp; Certifications</div>${renderParticipationsAndCerts(participations, certifications)}
  ${v(leadership) ? `<div class="st">Leadership &amp; Event Conductions</div><p>${leadership}</p>` : ""}
  ${v(languages) || v(additionalInfo) ? `<div class="st">Additional Information</div><p>${v(additionalInfo) ? `<strong>Course Work:</strong> ${additionalInfo}<br>` : ""}${v(languages) ? `<strong>Languages Known:</strong> ${languages}` : ""}</p>` : ""}
</div>
${fitScript}</body></html>`;

    /* ════════════════════════════════════════════════════
       TEMPLATE 4 — CLEAN TIMELINE
       Gray gradient left strip, dot timeline, overflow visible.
       Body: 11 px · Name: 22 px · Section headers: 9.5 px
    ════════════════════════════════════════════════════ */
    const T_TIMELINE = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:210mm;height:297mm;overflow:hidden;font-family:Arial,sans-serif;font-size:11px;}
.rp{display:flex;width:210mm;min-height:297mm;}
.accent{width:5px;background:linear-gradient(180deg,#222,#777);flex-shrink:0;}
.cn{flex:1;padding:16px 19px;overflow:visible;}
.hdr{border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:9px;}
.hdr h1{font-size:22px;font-weight:900;color:#1a1a1a;text-transform:uppercase;letter-spacing:0.8px;line-height:1.1;}
.hdr-r{font-size:11px;color:#555;margin-top:2px;font-style:italic;}
.hdr-c{font-size:9.5px;color:#666;margin-top:4px;}
.sec{display:flex;gap:8px;margin-top:10px;}
.tl{display:flex;flex-direction:column;align-items:center;width:13px;flex-shrink:0;}
.dot{width:9px;height:9px;border-radius:50%;background:#333;flex-shrink:0;margin-top:3px;border:1.5px solid #666;}
.line{flex:1;width:1.5px;background:#ddd;margin-top:2px;}
.sb{flex:1;}
.st{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:1.4px;color:#1a1a1a;margin-bottom:5px;border-bottom:1px solid #eee;padding-bottom:2px;}
p{font-size:11px;line-height:1.65;color:#333;}
</style></head><body>
<div class="rp">
  <div class="accent"></div>
  <div class="cn">
    <div class="hdr">
      <h1>${v(fullName)}</h1>
      <div class="hdr-r">${v(role)}</div>
      <div class="hdr-c">${contactLineWithIcons(contact, " &nbsp;|&nbsp; ")}</div>
    </div>
    ${v(summary) ? `<div class="sec"><div class="tl"><div class="dot"></div><div class="line"></div></div><div class="sb"><div class="st">Summary</div><p>${summary}</p></div></div>` : ""}
    <div class="sec"><div class="tl"><div class="dot"></div><div class="line"></div></div><div class="sb"><div class="st">Technical Skills</div>${renderSkills(skillCategories, skills, "rows")}</div></div>
    ${v(experience) ? `<div class="sec"><div class="tl"><div class="dot"></div><div class="line"></div></div><div class="sb"><div class="st">Internship &amp; Experience</div>${renderExperience(experience, { titleColor: "#1a1a1a", dateColor: "#666" })}</div></div>` : ""}
    ${v(projects) ? `<div class="sec"><div class="tl"><div class="dot"></div><div class="line"></div></div><div class="sb"><div class="st">Projects</div>${renderProjects(projects, { nameColor: "#1a1a1a" })}</div></div>` : ""}
    ${v(education) ? `<div class="sec"><div class="tl"><div class="dot"></div><div class="line"></div></div><div class="sb"><div class="st">Education</div>${renderEducation(education, { instColor: "#1a1a1a" })}</div></div>` : ""}
    <div class="sec"><div class="tl"><div class="dot"></div><div class="line"></div></div><div class="sb"><div class="st">Participations &amp; Certifications</div>${renderParticipationsAndCerts(participations, certifications)}</div></div>
    ${v(leadership) ? `<div class="sec"><div class="tl"><div class="dot"></div><div class="line"></div></div><div class="sb"><div class="st">Leadership</div><p>${leadership}</p></div></div>` : ""}
    ${v(languages) || v(additionalInfo) ? `<div class="sec"><div class="tl"><div class="dot"></div></div><div class="sb"><div class="st">Additional Information</div><p>${v(additionalInfo) ? additionalInfo + `<br>` : ""}${v(languages) ? `Languages: ${languages}` : ""}</p></div></div>` : ""}
  </div>
</div>
${fitScript}</body></html>`;

    /* ════════════════════════════════════════════════════
       TEMPLATE 5 — ACADEMIC DETAILED
       Dense single-col, 2-col grid for edu/certs.
       Body: 11.5 px · Name: 25 px · Section headers: 10 px
    ════════════════════════════════════════════════════ */
    const T_ACADEMIC = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:210mm;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;font-size:11.5px;}
.rr{width:210mm;padding:10mm 12mm 7mm;}
.hdr h1{font-size:25px;font-weight:900;letter-spacing:0.5px;color:#1a1a1a;line-height:1.1;}
.hdr-role{font-size:12px;color:#444;font-weight:600;margin-top:2px;}
.hdr-c{font-size:10px;color:#555;margin-top:4px;}
.rule{height:2.5px;background:#1a1a1a;margin:8px 0 1px;border-radius:2px;}
.st{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#1a1a1a;border-bottom:1px solid #ddd;padding-bottom:2px;margin:10px 0 6px;}
p{font-size:11.5px;line-height:1.65;color:#333;text-align:justify;}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 18px;}
</style></head><body>
<div class="rr">
  <div class="hdr">
    <h1>${v(fullName)}</h1>
    <div class="hdr-role">${v(role)}</div>
    <div class="hdr-c">${contactLineWithIcons(contact)}</div>
    <div class="rule"></div>
  </div>
  ${v(summary) ? `<div class="st">Professional Summary</div><p>${summary}</p>` : ""}
  <div class="st">Technical Skills</div>${renderSkills(skillCategories, skills, "rows")}
  ${v(experience) ? `<div class="st">Internship &amp; Work Experience</div>${renderExperience(experience)}` : ""}
  ${v(projects) ? `<div class="st">Projects</div>${renderProjects(projects)}` : ""}
  <div class="grid2">
    ${v(education) ? `<div><div class="st">Education</div>${renderEducation(education)}</div>` : "<div></div>"}
    <div><div class="st">Participations &amp; Certifications</div>${renderParticipationsAndCerts(participations, certifications)}</div>
  </div>
  ${v(leadership) ? `<div class="st">Leadership &amp; Event Conductions</div><p>${leadership}</p>` : ""}
  ${v(languages) || v(additionalInfo) ? `<div class="st">Additional Information</div><p>${v(additionalInfo) ? `<strong>Course Work:</strong> ${additionalInfo}<br>` : ""}${v(languages) ? `<strong>Languages Known:</strong> ${languages}` : ""}</p>` : ""}
</div>
${fitScript}</body></html>`;

    /* ════════════════════════════════════════════════════
       TEMPLATE 6 — BANNER SECTIONS
       Full-width gray banners, 4-col skill grid.
       Body: 11.5 px · Name: 26 px · Banner text: 11.5 px
    ════════════════════════════════════════════════════ */
    const banner = (text) =>
      `<div style="background:#e0e0e0;padding:6px 11px;margin-top:11px;margin-bottom:7px;">
        <span style="font-size:11.5px;font-weight:700;font-style:italic;letter-spacing:0.5px;color:#111;text-transform:uppercase;">${text}</span>
      </div>`;

    const T_BANNER = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box;}
html,body{width:210mm;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;background:#fff;font-size:11.5px;}
.rr{width:210mm;padding:10mm 12mm 7mm;}
.hdr h1{font-size:26px;font-weight:900;color:#111;line-height:1.1;}
.hdr-sub{font-size:12.5px;color:#444;margin-top:2px;}
.hdr-c{font-size:10px;color:#555;margin-top:5px;}
p{font-size:11.5px;line-height:1.65;color:#222;text-align:justify;}
</style></head><body>
<div class="rr">
  <div class="hdr">
    <h1>${v(fullName)}</h1>
    <div class="hdr-sub">${v(role)}</div>
    <div class="hdr-c">${contactLineWithIcons(contact, " &nbsp;|&nbsp; ")}</div>
  </div>
  ${v(summary) ? `${banner("Summary")}<p>${summary}</p>` : ""}
  ${banner("Technical Skills")}${renderSkills(skillCategories, skills, "grid4")}
  ${v(experience) ? `${banner("Internship &amp; Work Experience")}${renderExperience(experience)}` : ""}
  ${v(projects) ? `${banner("Projects")}${renderProjects(projects)}` : ""}
  ${v(education) ? `${banner("Education")}${renderEducation(education)}` : ""}
  ${banner("Participations &amp; Certifications")}${renderParticipationsAndCerts(participations, certifications)}
  ${v(leadership) ? `${banner("Leadership &amp; Event Conductions")}<p>${leadership}</p>` : ""}
  ${v(languages) || v(additionalInfo) ? `${banner("Additional Information")}<p>${v(additionalInfo) ? `<strong>Course Work:</strong> ${additionalInfo}<br>` : ""}${v(languages) ? `<strong>Languages Known:</strong> ${languages}` : ""}</p>` : ""}
</div>
${fitScript}</body></html>`;

    /* ════════════════════════════════════════════════════
       TEMPLATE MAP & PUPPETEER
    ════════════════════════════════════════════════════ */
    const htmlMap = {
      "classic-corporate": T_CLASSIC,
      "executive":         T_EXECUTIVE,
      "minimal-elegant":   T_MINIMAL,
      "clean-timeline":    T_TIMELINE,
      "academic-detailed": T_ACADEMIC,
      "banner-sections":   T_BANNER,
      "classic":           T_CLASSIC,
    };
    const html = htmlMap[templateId] || T_CLASSIC;

    const fitConfig = {
      "classic-corporate": { shell: ".rr", content: ".rr" },
      "executive":         { shell: ".rr", content: ".bd" },
      "minimal-elegant":   { shell: ".rr", content: ".rr" },
      "clean-timeline":    { shell: ".rp", content: ".cn" },
      "academic-detailed": { shell: ".rr", content: ".rr" },
      "banner-sections":   { shell: ".rr", content: ".rr" },
      "classic":           { shell: ".rr", content: ".rr" },
    };
    const { shell, content } = fitConfig[templateId] || { shell: ".rr", content: ".rr" };

    const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    const PH = 1123, PW = 794;
    await page.setViewport({ width: PW, height: PH, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Scale down if overflow; distribute whitespace if underflow
    await page.evaluate(({ shellSel, contentSel, maxH }) => {
      const shellEl   = document.querySelector(shellSel);
      const contentEl = document.querySelector(contentSel);
      if (!shellEl || !contentEl) return;
      const h = contentEl.scrollHeight;
      if (h > maxH) {
        const sc = maxH / h;
        shellEl.style.transform = `scale(${sc})`;
        shellEl.style.transformOrigin = "top left";
        shellEl.style.width = `${Math.round(100 / sc)}%`;
        return;
      }
      const secs    = Array.from(contentEl.querySelectorAll(".st, .sec, .hdr, [class^='st']"));
      const leftover = maxH - h;
      if (leftover > 24 && secs.length > 2) {
        const add = Math.min(Math.floor(leftover / secs.length), 22);
        if (add > 1) {
          secs.forEach((s, i) => {
            if (i > 0) {
              const cur = parseFloat(window.getComputedStyle(s).marginTop) || 0;
              s.style.marginTop = `${cur + add}px`;
            }
          });
        }
        const h2 = contentEl.scrollHeight;
        if (h2 > maxH) {
          const sc2 = maxH / h2;
          shellEl.style.transform = `scale(${sc2})`;
          shellEl.style.transformOrigin = "top left";
          shellEl.style.width = `${Math.round(100 / sc2)}%`;
        }
      }
    }, { shellSel: shell, contentSel: content, maxH: PH });

    const pdf = await page.pdf({
      width: "210mm", height: "297mm", printBackground: true,
      margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" },
      pageRanges: "1",
    });
    await browser.close();
    res.set({ "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=resume.pdf" });
    res.send(Buffer.from(pdf));

  } catch (error) {
    console.error("RESUME ERROR:", error);
    res.status(500).send("Resume generation failed: " + error.message);
  }
});

/* ═══════════════ ANALYSE RESUME ═══════════════ */
app.post("/analyse-resume", upload.single("resume"), async (req, res) => {
  try {
    const { role } = req.body;
    const pdfDoc = await getDocument({ data: new Uint8Array(req.file.buffer) }).promise;
    let resumeText = "";
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const pg = await pdfDoc.getPage(i);
      resumeText += (await pg.getTextContent()).items.map(x => x.str).join(" ") + "\n";
    }

    const prompt = `You are an expert professional resume analyst. A candidate has uploaded their resume and wants it evaluated for the role: "${role}".

Your tasks:
1. Calculate a realistic match score (0–100) based on how well the resume's skills, experience, and content align with the requirements of the role "${role}".
2. Identify specific skills or qualifications that are MISSING from this resume but are commonly required for a "${role}" position. List real, specific missing skills — not generic advice.
3. Provide exactly 5 specific, actionable, and practical improvement suggestions tailored to this resume and this role. Each suggestion should reference something concrete from the resume or the role requirements.

Be honest, critical, and specific. Do not give generic advice. Base your analysis entirely on the resume content provided below.

Resume Content:
"""
${resumeText.trim()}
"""

Respond ONLY with a valid JSON object in this exact format — no explanation, no markdown, no extra text:
{
  "matchScore": <integer 0-100>,
  "missingSkills": ["<specific skill 1>", "<specific skill 2>", "<specific skill 3>"],
  "suggestions": [
    "<specific actionable suggestion 1>",
    "<specific actionable suggestion 2>",
    "<specific actionable suggestion 3>",
    "<specific actionable suggestion 4>",
    "<specific actionable suggestion 5>"
  ]
}`;

    const ai = await callAI(prompt);
    const clean = ai.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(clean.substring(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
    res.json({
      matchScore:    typeof parsed.matchScore === "number" ? parsed.matchScore : 0,
      missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [],
      suggestions:   Array.isArray(parsed.suggestions)   ? parsed.suggestions  : [],
    });
  } catch (e) {
    console.error("ANALYSE ERROR:", e);
    res.status(500).json({ error: "Analysis failed", details: e.message });
  }
});

/* ═══════════════ ATS CHECK ═══════════════ */
app.post("/ats-check", upload.single("resume"), async (req, res) => {
  try {
    const { role, jobDescription } = req.body;
    const pdfDoc = await getDocument({ data: new Uint8Array(req.file.buffer) }).promise;
    let resumeText = "";
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const pg = await pdfDoc.getPage(i);
      resumeText += (await pg.getTextContent()).items.map(x => x.str).join(" ") + "\n";
    }

    const prompt = `You are an expert ATS (Applicant Tracking System) specialist. Analyse the resume below for the role "${role}"${jobDescription ? ` using the provided job description` : ""}.

Your analysis tasks:
1. ATS Score (0–100): Overall likelihood the resume passes ATS filters for this role. Be realistic.
2. Keyword Match: List keywords/skills PRESENT in the resume that are relevant to the role. Then list important keywords/skills that are MISSING from the resume for this role.
3. Formatting Issues: Identify specific formatting problems that could cause ATS parsing failures (e.g. tables, columns, images, missing sections, special characters, header/footer placement). If none, return an empty array.
4. Section Completeness: For each standard resume section — Summary, Skills, Experience, Education, Certifications — state whether it is "Present", "Missing", or "Incomplete".
5. Readability Score (0–100): How readable and clear the resume is for a human recruiter.
6. Readability Feedback: One or two sentences of specific, actionable feedback on readability and writing quality.
${jobDescription ? `\nJob Description:\n"""\n${jobDescription}\n"""` : ""}

Resume Content:
"""
${resumeText.trim()}
"""

Respond ONLY with a valid JSON object in this exact format — no explanation, no markdown, no extra text:
{
  "atsScore": <integer 0-100>,
  "keywordMatch": {
    "matched": ["<keyword present in resume 1>", "<keyword present in resume 2>"],
    "missing": ["<important missing keyword 1>", "<important missing keyword 2>"]
  },
  "formattingIssues": ["<specific formatting issue 1>", "<specific formatting issue 2>"],
  "sectionCompleteness": [
    { "section": "Summary",        "status": "Present" },
    { "section": "Skills",         "status": "Present" },
    { "section": "Experience",     "status": "Present" },
    { "section": "Education",      "status": "Present" },
    { "section": "Certifications", "status": "Incomplete" }
  ],
  "readabilityScore": <integer 0-100>,
  "readabilityFeedback": "<one to two sentences of specific feedback>"
}`;

    const ai = await callAI(prompt);
    const clean = ai.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(clean.substring(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
    res.json({
      atsScore:            typeof parsed.atsScore === "number" ? parsed.atsScore : 0,
      keywordMatch: {
        matched: Array.isArray(parsed.keywordMatch?.matched) ? parsed.keywordMatch.matched : [],
        missing: Array.isArray(parsed.keywordMatch?.missing) ? parsed.keywordMatch.missing : [],
      },
      formattingIssues:    Array.isArray(parsed.formattingIssues)    ? parsed.formattingIssues    : [],
      sectionCompleteness: Array.isArray(parsed.sectionCompleteness) ? parsed.sectionCompleteness : [],
      readabilityScore:    typeof parsed.readabilityScore === "number" ? parsed.readabilityScore : 0,
      readabilityFeedback: typeof parsed.readabilityFeedback === "string" ? parsed.readabilityFeedback : "",
    });
  } catch (e) {
    console.error("ATS CHECK ERROR:", e);
    res.status(500).json({ error: "ATS check failed", details: e.message });
  }
});

app.get("/", (req, res) => res.send("ResumeBuilder Backend Running ✅"));
app.listen(5000, () => console.log("Server running on port 5000"));