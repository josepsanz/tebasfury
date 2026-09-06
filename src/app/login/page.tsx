import { SignInButton } from "@/components/sign-in-button";

export default function LoginPage() {
  return (
    <section className="mx-auto max-w-sm text-center">
      <h1 className="text-xl font-semibold">Entra a TebasFury</h1>
      <p className="mt-2 mb-6 text-sm text-neutral-600">
        Només per als managers de la lliga.
      </p>
      <SignInButton />
    </section>
  );
}
