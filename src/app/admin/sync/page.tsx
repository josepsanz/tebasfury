import { requirePermission } from "@/lib/auth/guards";

export default async function SyncPage() {
  await requirePermission({ sync: ["trigger"] });

  return (
    <section>
      <h1 className="text-xl font-semibold">Sync</h1>
      <p className="mt-2 text-neutral-600">
        Nothing to sync yet. This arrives with the standings slice.
      </p>
    </section>
  );
}
