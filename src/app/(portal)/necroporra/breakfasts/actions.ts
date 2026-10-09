"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/guards";
import { removeBreakfast, saveBreakfast, type BreakfastResult } from "@/lib/necroporra/breakfasts";

const PATH = "/necroporra/breakfasts";

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const inputOf = (formData: FormData) => ({
  teamId: field(formData, "teamId"),
  broughtOn: field(formData, "broughtOn"),
  what: field(formData, "what"),
});

const idOf = (formData: FormData) => {
  const id = Number(field(formData, "id"));
  return Number.isInteger(id) && id > 0 ? id : null;
};

const NO_ID: BreakfastResult = { ok: false, message: "No breakfast was named." };

/**
 * The three ways to write in the Calendar of Shame. Each one checks the permission itself:
 * hiding the form from a manager is a courtesy, not a control.
 */
export async function recordBreakfast(formData: FormData): Promise<BreakfastResult> {
  const session = await requirePermission({ breakfast: ["record"] });
  const result = await saveBreakfast(db, {
    input: inputOf(formData),
    now: new Date(),
    recordedBy: session.user.id,
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function updateBreakfast(formData: FormData): Promise<BreakfastResult> {
  const session = await requirePermission({ breakfast: ["record"] });
  const id = idOf(formData);
  if (id === null) return NO_ID;
  const result = await saveBreakfast(db, {
    id,
    input: inputOf(formData),
    now: new Date(),
    recordedBy: session.user.id,
  });
  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function deleteBreakfast(formData: FormData): Promise<BreakfastResult> {
  await requirePermission({ breakfast: ["record"] });
  const id = idOf(formData);
  if (id === null) return NO_ID;
  const result = await removeBreakfast(db, id);
  if (result.ok) revalidatePath(PATH);
  return result;
}
