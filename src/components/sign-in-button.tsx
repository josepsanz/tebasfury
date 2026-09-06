"use client";

import { signIn } from "@/lib/auth/client";

export function SignInButton() {
  return (
    <button
      type="button"
      className="rounded-md bg-black px-4 py-2 text-white"
      onClick={() => signIn.social({ provider: "google", callbackURL: "/" })}
    >
      Sign in with Google
    </button>
  );
}
