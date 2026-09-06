import fs from "node:fs";
process.loadEnvFile(".env.local");
const TOKEN = fs.readFileSync("spike/.access_token", "utf8").trim();
const BASE = "https://fantasy-api.llt-services.com/api";
const LEAGUE = process.env.LALIGA_LEAGUE_ID; // set in .env.local

async function get(path, name) {
  const res = await fetch(BASE + path, {
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/json" },
  });
  const text = await res.text();
  console.log(`\n### ${path}\nHTTP ${res.status}  ${text.length} bytes`);
  if (!res.ok) { console.log("  →", text.slice(0, 160)); return null; }
  const data = JSON.parse(text);
  if (name) fs.writeFileSync(`spike/fixtures/${name}.json`, JSON.stringify(data, null, 2));
  return data;
}

const week = await get("/v1/competition/1/week/current", "week-current");
console.log("  jornada actual:", JSON.stringify(week));

const st = await get(`/v1/competition/1/leagues/${LEAGUE}/standing`, "standing");
if (Array.isArray(st)) {
  console.log(`  ${st.length} equips; claus:`, Object.keys(st[0] ?? {}).join(", "));
  const t0 = st[0];
  if (t0?.team) console.log("  claus de team:", Object.keys(t0.team).join(", "));
}

const w3 = await get(`/v1/competition/1/leagues/${LEAGUE}/standing/3`, "standing-week-3");
if (Array.isArray(w3)) console.log(`  ${w3.length} equips a la jornada 3 → HISTÒRIC PER JORNADA: SÍ`);
