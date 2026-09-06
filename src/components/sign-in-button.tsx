"use client";

import { signIn } from "@/lib/auth/client";

export function SignInButton() {
  return (
    <button
      type="button"
      className="board-button board-button-primary"
      onClick={() => signIn.social({ provider: "google", callbackURL: "/" })}
    >
      Sign in with Google
    </button>
  );
}
