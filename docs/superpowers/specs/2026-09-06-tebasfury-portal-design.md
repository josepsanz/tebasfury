# TebasFury — Portal de gestió de lliga privada LaLiga Fantasy

## Context

Repositori buit (`main`, cap commit). Projecte personal nou.

Un grup d'amics juga una lliga privada de LaLiga Fantasy. L'app oficial cobreix el joc
però no cobreix res del que fa que la lliga sigui *seva*: no guarda històric per
analitzar l'evolució, no coneix les normes internes del grup, i no té enquestes.

El portal ha de cobrir aquest buit:

- **Històric i evolució** — punts globals i per equip al llarg de la temporada, i
  evolució de valor dels jugadors, que l'app oficial no reté.
- **Norma interna de fair play** — al grup no es venen jugadors abans de 5 dies. Ningú
  la pot fer complir tècnicament, però tenir-ho registrat i visible canvia el
  comportament.
- **Operacions programades** — poder deixar programada una puja o una venda a hora
  exacta, sense haver d'estar amb el mòbil a la matinada.
- **Necroporra** — enquesta setmanal on cada manager vota dos equips rivals candidats a
  fer l'últim de la jornada. Avui es fa a mà i els resultats es perden.

El portal es diu **TebasFury**. S'escriu així, amb F majúscula, i és el nom que ha
d'aparèixer a la UI, al `package.json`, al títol de les pàgines i als metadades.

Resultat esperat: un portal desplegat a Vercel on tot el grup entra amb el seu compte,
veu la lliga amb profunditat històrica, i on la Necroporra es publica, es vota i es
resol sola.

## Decisions preses (sessió de brainstorming)

| Decisió | Valor escollit |
|---|---|
| Font de dades | API no oficial de LaLiga Fantasy |
| Model de comptes | Token central de lectura + opt-in individual per escriure |
| Operacions programades | Execució real contra l'API |
| Fair play | Detecció automàtica + registre públic. Sense expedient ni justificacions |
| Necroporra | Auto-resolució + rànquing d'encerts acumulat de temporada |
| Rol Colaborator | Enquestes, registre fair play, forçar sync, corregir dades. No gestiona usuaris |
| Abast | Una sola lliga (sense multi-tenant) |
| Primer slice | Classificació i evolució |
| Scheduler | Upstash QStash + Vercel Hobby |

## Riscos acceptats — escrits explícitament

1. **L'API no és oficial.** Pot canviar o desaparèixer sense avís, i el seu ús pot anar
   contra els termes de servei de LaLiga Fantasy. Tot el projecte hi depèn.
   *Mitigació:* tot el coneixement de l'API viu en una sola capa aïllada
   (`lib/fantasy-client/`); la resta del sistema no en sap res. Si canvia, es toca un
   directori.
2. **Custòdia de credencials de tercers.** L'execució real obliga a desar tokens de
   LaLiga d'altres persones. És el punt de més risc del sistema.
   *Mitigació:* xifratge AES-256-GCM en repòs amb clau fora de la BD, mai la contrasenya
   en clar, opt-in explícit, i pantalla per revocar la connexió en qualsevol moment.
3. **Latència de dades.** Les vistes llegeixen instantànies, no l'API en viu. Sempre s'ha
   de veure a la UI quan va ser l'últim sync correcte.

## Arquitectura

### Principi rector: magatzem d'instantànies

El portal **no truca mai a LaLiga durant una petició web**. Un worker sincronitza
periòdicament i escriu instantànies a Postgres. Totes les vistes llegeixen només de la
BD pròpia.

Això dóna tres coses que aquí no són negociables: pàgines ràpides, un portal que segueix
viu quan l'API cau, i **l'acumulació d'històric que és tota la raó de ser del projecte**.

A més es desa el **payload cru** de cada sync (retenció curta, ~30 dies). Costa poc i
permet reconstruir dades quan es descobreixi un bug de parsing.

### Stack

Versions verificades el 2026-09-06.

- **Next.js 16.3** (App Router, RSC) + **React 19.2** + TypeScript — natiu a Vercel
- **Postgres a Neon** (`@neondatabase/serverless` 1.1) via la integració de Vercel
- **Drizzle ORM 0.45** + drizzle-kit 0.31 per a migracions
- **better-auth 1.7** amb proveïdor Google i adapter de Drizzle
- **Tailwind 4** + shadcn/ui
- **Zod 4** — validació de *tota* resposta de l'API no oficial abans d'entrar al sistema
- **Upstash QStash 2.11** — sync periòdic i operacions a hora exacta
- **Vitest 5** + **PGlite** (Postgres en procés, sense Docker) i **Playwright 1.63** (E2E)

**Sobre l'autenticació:** l'esborrany inicial deia Auth.js v5, però continua en beta
(`5.0.0-beta.32`) mentre que better-auth és estable a la 1.7.2 i ja té més ús. A més
porta els plugins `admin` i `access`, que donen control de rols d'origen — els tres rols
del portal es declaren com a polítiques i no com a codi propi.

### Mòduls i fronteres

Cada mòdul té un propòsit, una interfície i unes dependències explícites.

| Mòdul | Fa | Depèn de |
|---|---|---|
| `lib/fantasy-client/` | **Capa anticorrupció.** L'únic lloc que coneix l'HTTP de LaLiga. Exposa funcions de domini (`getStandings`, `getTeamRoster`, `getMarket`, `placeBid`, `sellPlayer`) i valida cada resposta amb Zod. No filtra mai tipus crus cap enfora. | res |
| `lib/sync/` | Orquestra els pulls, escriu instantànies idempotents per `(jornada, entitat)`, desa payloads crus, registra cada execució | fantasy-client, db |
| `lib/domain/` | **Lògica pura, zero I/O.** Càlcul de classificació, sèries d'evolució, avaluació de la regla dels 5 dies, resolució i puntuació de la Necroporra | res |
| `lib/db/` | Esquema Drizzle i queries | res |
| `lib/auth/` | Config de better-auth, polítiques de rol i guards de servidor | db |
| `lib/scheduler/` | Publicació a QStash i verificació de signatura a la recepció | res |
| `app/(portal)/` | Rutes i vistes | tots els anteriors |

`lib/domain/` sense I/O és deliberat: és on viu tota la lògica que us és pròpia, i és
testejable sense xarxa ni base de dades.

## Model de dades

Nucli:

- `user`, `session`, `account`, `verification` — taules generades per better-auth
- Camp addicional `role` a `user` (`user` | `colaborator` | `admin`) i `fantasy_team_id`
- `league_credentials` — **token central de lectura**. Fila única, token xifrat,
  refresh, expiració, `updated_by`. És el que alimenta tots els syncs i, per tant,
  totes les vistes del portal per a tothom
- `fantasy_credentials` — token individual d'un manager, xifrat, refresh, expiració.
  *Opt-in, només necessari per a l'execució d'operacions programades*
- `teams` — id de l'API, nom, manager, `user_id` nullable
- `gameweeks` — número, inici, fi, estat
- `sync_runs` — inici, fi, estat, error, entitats tocades
- `raw_sync_payloads` — endpoint, timestamp, payload `jsonb`

Classificació i evolució *(slice 1)*:

- `team_gameweek_stats` — `(team_id, gameweek)`, punts jornada, punts acumulats, posició,
  valor d'equip

Jugadors i mercat:

- `players` — id, nom, posició, equip real
- `player_value_history` — `(player_id, date)`, valor de mercat, punts
- `roster_entries` — `team_id`, `player_id`, `acquired_at`, `acquired_via`, `released_at`
  → **és la taula que fa computable la norma dels 5 dies**
- `market_operations` — tipus, equip, jugador, import, `occurred_at`, origen
- `fairplay_violations` — equip, jugador, `acquired_at`, `sold_at`, dies retingut,
  `detected_at`, nota. Clau única per fer la detecció idempotent
- `scheduled_operations` — usuari, tipus, jugador, import màxim, `execute_at`, estat,
  `qstash_message_id`, resultat

Enquestes:

- `poll_templates` — nom, `kind`, `config jsonb`
- `polls` — template, jornada, títol, obertura, tancament, estat, `vote_rules jsonb`
- `poll_options` — poll, etiqueta, `ref_type`, `ref_id`
- `poll_votes` — poll, usuari, opció. Únic per `(poll_id, user_id, option_id)`, que
  impedeix votar dos cops la mateixa opció. El límit de vots per persona i la
  prohibició de votar-se un mateix són regles de `vote_rules`, validades a
  `lib/domain/` abans d'escriure
- `poll_results` — poll, `resolved_at`, opcions correctes
- `poll_scores` — usuari, poll, punts

La **Necroporra és una instància de template**, no una taula especial:
`kind = 'necroporra'`, opcions autogenerades a partir dels equips, regla de vot
"2 vots, no pots votar el teu equip", i resolució "l'opció amb menys punts de la
jornada". Afegir una altra mena d'enquesta serà afegir un template, no codi nou.

## Pla d'execució

### Pas 0 — Spike de viabilitat *(bloquejant)*

Abans de qualsevol línia de producte, verificar contra l'API real: com s'obté i es
refresca el token, quins endpoints donen classificació, plantilles, valors i mercat, si
la lliga privada és accessible, i si hi ha rate limits.

**Sortida:** un informe i un joc de payloads crus reals que serviran de fixtures per als
tests. Codi llençable, etiquetat com a tal. Si aquest pas falla, tornem a la decisió de
font de dades abans de construir res.

### Pas 1 — Esquelet

Projecte Next.js, Drizzle + Neon, Auth.js amb Google, taula d'usuaris amb rols i guards
de servidor, layout base, desplegament a Vercel funcionant. Sense funcionalitat de
producte.

### Pas 2 — Slice vertical: classificació i evolució

`fantasy-client` amb autenticació + `getStandings` + punts per jornada, job de sync a
QStash, taules `teams` / `gameweeks` / `team_gameweek_stats`, i dues vistes:
classificació actual i evolució de punts (gràfic global + detall per equip). Indicador
visible d'"últim sync".

Aquest slice valida la canonada sencera — token → sync → BD → vista — amb la mínima
inversió.

### Passos posteriors *(spec pròpia cadascun, després)*

3. Jugadors: `player_value_history`, `roster_entries`, vistes d'evolució i oportunitats
4. Fair play: detecció per diff de plantilles + registre públic
5. Operacions programades: connexió opt-in de compte, xifratge, execució via QStash
6. Enquestes i Necroporra: motor de templates, restriccions de vot, auto-resolució,
   rànquing d'encerts

## Estratègia de test

- `lib/domain/` → unitaris purs. És on viu la lògica de negoci; ha d'estar cobert de debò.
- `lib/fantasy-client/` → tests contra els payloads reals capturats al Pas 0. Detecten
  quan l'API canvia de forma.
- `lib/sync/` → integració amb un client fals injectat, contra una BD de test.
- Vistes principals → Playwright.

## Verificació d'extrem a extrem

En acabar el Pas 2 s'ha de poder comprovar, en aquest ordre:

1. `pnpm test` i `pnpm test:e2e` en verd
2. `pnpm drizzle-kit migrate` sobre una BD neta aixeca tot l'esquema sense error
3. Disparar el sync manualment i veure una fila nova a `sync_runs` amb estat correcte i
   files a `team_gameweek_stats`
4. Entrar al portal amb Google i veure la classificació amb les dades reals de la lliga
5. Comprovar que un usuari amb rol `user` no accedeix a l'acció de forçar sync
6. Aturar la BD o falsejar un error de l'API i confirmar que el portal segueix servint
   l'última instantània amb l'avís d'antiguitat, sense petar

## Prerequisits per al Pas 2, descoberts construint l'esquelet

Aquestes quatre coses es van trobar revisant la branca de l'esquelet. No la bloquejaven,
però totes afecten el slice de classificació i evolució i **s'han de decidir abans
d'escriure el codi de sync**, no després.

1. **`neon-http` no suporta transaccions; PGlite sí.** El driver de producció
   (`drizzle-orm/neon-http`) llança `No transactions support in neon-http driver`, mentre
   que el banc de proves amb PGlite implementa `transaction()` correctament. Un sync que
   embolcalli `sync_runs` + `team_gameweek_stats` + `raw_sync_payloads` en un
   `db.transaction()` — que és la manera natural d'escriure'l i el que implica
   "instantànies idempotents" — **passaria tots els tests i petaria en producció**.
   Cal escollir: `db.batch()` (que `neon-http` sí suporta, atòmic en un sol viatge) o
   canviar a `neon-serverless` per WebSocket.

2. **Cal una allowlist d'emails abans que hi hagi dades reals.** Avui qualsevol compte de
   Google pot entrar i rep el rol `user`. Ara només arriba a una portada buida, però el
   Pas 2 posa la classificació real de la lliga darrere d'aquest mateix rol. La
   restricció va a un hook `user.create.before`.

3. **La relació equip–usuari té dues direccions i cap restricció.** L'esquema té
   `user.fantasy_team_id` sense clau forana, i l'spec preveia `teams.user_id`. El Pas 2
   escriu `teams`: cal triar una direcció abans.

4. **Hi ha dos motors d'autorització.** Les pàgines fan servir `decideAccess`; els
   endpoints `/api/auth/admin/*` fan servir el `hasPermission` de better-auth, que accepta
   rols múltiples separats per comes. Si algú assigna `"colaborator,user"`, better-auth
   autoritza i totes les pàgines desvien: l'usuari queda tancat fora del portal sense cap
   error. Falla tancat, o sigui que no és un forat, però convé unificar-ho.

## Estat d'aquest document

Spec validada en sessió de brainstorming el 2026-09-06. El següent artefacte és el pla
d'implementació detallat del Pas 0 i el Pas 1.
