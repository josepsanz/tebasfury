# Desplegament a Vercel

Checklist per desplegar TebasFury a Vercel per primer cop. Es fa una sola vegada; els
desplegaments posteriors només calen un `git push origin main`.

## 1. Crear la base de dades a Neon

Des del panell del projecte a Vercel, pestanya **Storage**, crear una base de dades
**Neon Postgres** i connectar-la al projecte. Vercel hi injecta la variable
`DATABASE_URL` automàticament: no cal enganxar-la a mà a les variables d'entorn.

## 2. Configurar les credencials de Google

A la [Google Cloud Console](https://console.cloud.google.com/apis/credentials), crear
un client **OAuth 2.0 de tipus aplicació web**.

Als **URI de redirecció autoritzats**, afegir-hi els dos, literalment:

```
http://localhost:3000/api/auth/callback/google
https://<domini-de-vercel>/api/auth/callback/google
```

on `<domini-de-vercel>` és el domini públic que Vercel assigna al desplegament (per
exemple, `tebasfury.vercel.app` o el domini personalitzat, si n'hi ha). Cal afegir-hi
totes dues, no només la de producció: la primera és la que fa servir `pnpm dev` en
local.

Un cop creat el client, es desen el **Client ID** i el **Client Secret**: calen al pas
següent.

## 3. Variables d'entorn a Vercel

A la configuració del projecte a Vercel (**Settings → Environment Variables**), definir:

| Variable | Valor |
|---|---|
| `BETTER_AUTH_SECRET` | Generat amb `openssl rand -base64 32`. **Ha de ser diferent del secret de `.env.local`** |
| `BETTER_AUTH_URL` | La URL pública de producció (p. ex. `https://<domini-de-vercel>`) |
| `GOOGLE_CLIENT_ID` | El Client ID creat al pas 2 |
| `GOOGLE_CLIENT_SECRET` | El Client Secret creat al pas 2 |

`DATABASE_URL` **no** s'hi posa a mà: ja la va injectar Vercel al pas 1.

## 4. Aplicar les migracions a la base de dades de producció

Des de local, amb la connexió de Neon del pas 1 (es troba a la pestanya Storage del
projecte, o a les variables d'entorn que Vercel n'ha generat):

```bash
DATABASE_URL="<url-de-neon>" pnpm drizzle-kit migrate
```

## 5. Desplegar i verificar

```bash
git push origin main
```

Un cop desplegat, comprovar a la URL pública:

- La portada mostra **TebasFury**.
- `/login` ofereix l'opció d'entrar amb Google.
- Entrar-hi amb Google funciona.
- En una finestra privada (sense sessió), `/admin/sincronitzacio` desvia a `/login`.

## 6. Promoure el primer administrador

El `defaultRole` configurat a `src/lib/auth/auth.ts` és `"user"`, així que **tothom qui
entra per primer cop —inclòs el propietari del projecte— rep el rol `user`**. No hi ha
cap usuari `admin` fins que algú el promogui a mà directament a la base de dades: és un
pas manual que només cal fer una vegada, per al primer administrador.

Amb el client `psql` (o l'equivalent al panell de Neon), contra la base de dades de
producció:

```bash
psql "<url-de-neon>" \
  -c "update \"user\" set role = 'admin' where email = '<email-del-primer-admin>';"
```

Nota: `user` és una paraula reservada de Postgres, per això va entre cometes dobles a
la sentència SQL.

Després de promoure'l, cal que aquest usuari torni a entrar (o recarregui la sessió)
perquè el canvi de rol es reflecteixi. Comprovar tot seguit que l'entrada
"Sincronització" apareix a la navegació i que `/admin/sincronitzacio` s'obre
correctament.
