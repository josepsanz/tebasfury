import fs from "node:fs";
const TOKEN = fs.readFileSync("spike/.access_token", "utf8").trim();
const BASE = "https://fantasy-api.llt-services.com/api";

async function get(path, name) {
  const res = await fetch(BASE + path, {
    headers: { authorization: `Bearer ${TOKEN}`, accept: "application/json" },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  console.log(`\n### ${path}\nHTTP ${res.status}  ${res.headers.get("content-type")}  ${text.length} bytes`);
  if (!res.ok) { console.log("  →", text.slice(0, 200)); return null; }
  if (name) fs.writeFileSync(`spike/fixtures/${name}.json`, JSON.stringify(data, null, 2));
  if (Array.isArray(data)) {
    console.log(`  array de ${data.length}; claus del primer:`, Object.keys(data[0] ?? {}).join(", "));
  } else if (data && typeof data === "object") {
    console.log("  claus:", Object.keys(data).join(", "));
  }
  return data;
}

await get("/v4/user/me", "user-me");
const leagues = await get("/v1/competition/1/leagues?x-lang=es", "leagues");
const list = Array.isArray(leagues) ? leagues : (leagues?.data ?? leagues?.elements ?? []);
console.log("\nLligues trobades:", list.length);
for (const l of list) console.log("  id=", l.id, " nom=", JSON.stringify(l.name));
