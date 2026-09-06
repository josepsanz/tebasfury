// Throwaway. Rewrites the captured fixtures so they keep their exact shape and
// types but carry no real manager names or ids. Mappings are stable across files.
import fs from "node:fs";

const names = new Map(), ids = new Map();
let nName = 0, nId = 0;

const fakeName = (v) => {
  if (!names.has(v)) names.set(v, `Manager ${String.fromCharCode(65 + nName++)}`);
  return names.get(v);
};
const fakeId = (v) => {
  const k = String(v);
  if (!ids.has(k)) ids.set(k, String(9000000 + ++nId));
  return ids.get(k);
};

function walk(node) {
  if (Array.isArray(node)) return node.map(walk);
  if (node && typeof node === "object") {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "managerName" && typeof v === "string") out[k] = fakeName(v);
      else if (k === "name" && typeof v === "string" && node.managersNumber !== undefined) out[k] = "Test League 2026";
      else if ((k === "managerId" || k === "id") && (typeof v === "string" || typeof v === "number"))
        out[k] = typeof v === "number" ? Number(fakeId(v)) : fakeId(v);
      else if (k === "token" && typeof v === "string") out[k] = "redacted-league-token";
      else if (k === "avatar") out[k] = "";
      else out[k] = walk(v);
    }
    return out;
  }
  return node;
}

for (const f of fs.readdirSync("spike/fixtures").filter((f) => f.endsWith(".json"))) {
  const p = `spike/fixtures/${f}`;
  fs.writeFileSync(p, JSON.stringify(walk(JSON.parse(fs.readFileSync(p, "utf8"))), null, 2) + "\n");
  console.log("anonimitzat:", f);
}
console.log(`\n${names.size} noms i ${ids.size} identificadors substituïts.`);
