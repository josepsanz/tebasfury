"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { saveRuling, type RulingResult } from "@/lib/fair-play/rulings";

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * Setting a breach's status and note. Checks the permission itself: hiding the form from a
 * manager is a courtesy, not a control.
 */
export async function ruleOnBreach(formData: FormData): Promise<RulingResult> {
  const session = await requirePermission({ fairplay: ["annotate"] });
  const result = await saveRuling(db, {
    input: {
      saleId: field(formData, "saleId"),
      status: field(formData, "status"),
      note: field(formData, "note"),
    },
    now: new Date(),
    recordedBy: session.user.id,
  });
  if (result.ok) revalidatePath("/fair-play");
  return result;
}
