import { SignInButton } from "@/components/sign-in-button";

export default function LoginPage() {
  return (
    <section className="mx-auto max-w-sm text-center">
      <h1 className="text-xl font-semibold">Sign in to TebasFury</h1>
      <p className="mt-2 mb-6 text-sm" style={{ color: "var(--board-ink-dim)" }}>
        League managers only.
      </p>
      <SignInButton />
    </section>
  );
}
