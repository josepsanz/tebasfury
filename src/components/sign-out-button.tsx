"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.refresh();
  }

  return (
    <button type="button" className="text-sm underline" onClick={handleSignOut}>
      Surt
    </button>
  );
}
