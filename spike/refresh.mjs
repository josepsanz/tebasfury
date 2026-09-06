// Throwaway. Exchanges the stored refresh token for an access token and
// persists the rotated refresh token straight back into .env.local.
import fs from "node:fs";
process.loadEnvFile(".env.local");

const TOKEN_URL =
  "https://login.laliga.es/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token" +
  "?p=B2C_1A_5ULAIP_PARAMETRIZED_SIGNIN";
const CLIENT_ID = "6457fa17-1224-416a-b21a-ee6ce76e9bc0";

const res = await fetch(TOKEN_URL, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    scope: `openid ${CLIENT_ID} offline_access`,
    refresh_token: process.env.LALIGA_REFRESH_TOKEN,
  }),
});

const body = await res.text();
if (!res.ok) {
  console.error("HTTP", res.status);
  console.error(body.slice(0, 600));
  process.exit(1);
}

const t = JSON.parse(body);
console.log("HTTP", res.status);
console.log("camps retornats :", Object.keys(t).join(", "));
console.log("token_type      :", t.token_type);
console.log("expires_in      :", t.expires_in, "s ≈", Math.round(t.expires_in / 3600), "h");
console.log("access_token    :", t.access_token ? `${t.access_token.length} car.` : "(cap)");
console.log("refresh rotat   :", t.refresh_token && t.refresh_token !== process.env.LALIGA_REFRESH_TOKEN ? "SÍ" : "no");

if (t.refresh_token) {
  const env = fs.readFileSync(".env.local", "utf8");
  fs.writeFileSync(
    ".env.local",
    env.replace(/^LALIGA_REFRESH_TOKEN=.*$/m, `LALIGA_REFRESH_TOKEN="${t.refresh_token}"`),
  );
  console.log("nou refresh token desat a .env.local");
}
fs.writeFileSync("spike/.access_token", t.access_token ?? t.id_token ?? "", "utf8");
