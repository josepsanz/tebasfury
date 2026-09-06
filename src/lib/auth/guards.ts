import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { decideAccess, type AccessDecision, type Permissions } from "./access-decision";

export { decideAccess, type AccessDecision };

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requirePermission(permissions: Permissions) {
  const session = await getSession();
  const decision = decideAccess(session, permissions);
  if (decision.kind === "redirect") redirect(decision.to);
  return session!;
}
