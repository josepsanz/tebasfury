import { requirePermission } from "@/lib/auth/guards";

export default async function SyncPage() {
  await requirePermission({ sync: ["trigger"] });

  return (
    <section>
      <h1 className="text-xl font-semibold">Sincronització</h1>
      <p className="mt-2 text-neutral-600">
        Encara no hi ha res a sincronitzar. Arribarà amb el slice de classificació.
      </p>
    </section>
  );
}
