"use client";

import { useId, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type Mode = "sign-in" | "sign-up";
type Values = { name: string; email: string; password: string; organisation: string; terms: boolean };
type Errors = Partial<Record<keyof Values, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Auth is not wired up yet: this accepts the form and the caller opens the demo workspace.
 * Swap this for the real sign-in / sign-up call (and surface its errors) when auth lands.
 */
async function submitAuth(mode: Mode, values: Values): Promise<void> {
  void mode;
  void values;
  await new Promise((resolve) => setTimeout(resolve, 600));
}

function validate(mode: Mode, v: Values): Errors {
  const e: Errors = {};
  if (mode === "sign-up" && !v.name.trim()) e.name = "Enter your name.";
  if (!v.email.trim()) e.email = "Enter your work email.";
  else if (!EMAIL.test(v.email.trim())) e.email = "Enter an email like name@company.com.";
  if (!v.password) e.password = "Enter a password.";
  else if (mode === "sign-up" && v.password.length < 8) e.password = "Use at least 8 characters.";
  if (mode === "sign-up" && !v.terms) e.terms = "Accept the terms to continue.";
  return e;
}

/** 0–4: length, mixed case, a digit, a symbol. Only a hint; the server should own the policy. */
function strength(pw: string) {
  if (!pw) return 0;
  return [pw.length >= 8, /[a-z]/.test(pw) && /[A-Z]/.test(pw), /\d/.test(pw), /[^A-Za-z0-9]/.test(pw)].filter(Boolean).length;
}

const STRENGTH_LABEL = ["", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLOR = ["", "bg-mk-red", "bg-mk-amber", "bg-mk-blue", "bg-mk-green"];

/** Email + password form for both sign in and sign up, with inline validation. */
export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const uid = useId();
  const [values, setValues] = useState<Values>({ name: "", email: "", password: "", organisation: "", terms: false });
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState<"form" | "sso" | null>(null);

  const signUp = mode === "sign-up";
  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    const next = { ...values, [key]: value };
    setValues(next);
    // After the first submit, re-check as the visitor types so errors clear as soon as they are fixed.
    if (touched) setErrors(validate(mode, next));
  };

  const finish = async (via: "form" | "sso") => {
    setPending(via);
    await submitAuth(mode, values);
    router.push("/workspace");
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setTouched(true);
    const found = validate(mode, values);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    void finish("form");
  };

  const score = strength(values.password);

  return (
    <div>
      <button
        type="button"
        onClick={() => void finish("sso")}
        disabled={pending !== null}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-mk-line-strong text-[15px] font-medium text-mk-fg transition-colors hover:bg-mk-fg/[0.05] disabled:opacity-60"
      >
        {pending === "sso" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
        Continue with company SSO
      </button>

      <div className="my-6 flex items-center gap-3 text-xs text-mk-faint" aria-hidden="true">
        <span className="h-px flex-1 bg-mk-line" />
        or with email
        <span className="h-px flex-1 bg-mk-line" />
      </div>

      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {signUp && (
          <Field id={`${uid}-name`} label="Full name" error={errors.name}>
            <input
              id={`${uid}-name`}
              name="name"
              autoComplete="name"
              value={values.name}
              onChange={(e) => set("name", e.target.value)}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? `${uid}-name-error` : undefined}
              className={inputClass(!!errors.name)}
            />
          </Field>
        )}

        <Field id={`${uid}-email`} label="Work email" error={errors.email}>
          <input
            id={`${uid}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete={signUp ? "email" : "username"}
            placeholder="name@company.com"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? `${uid}-email-error` : undefined}
            className={inputClass(!!errors.email)}
          />
        </Field>

        <Field id={`${uid}-password`} label="Password" error={errors.password}>
          <div className="relative">
            <input
              id={`${uid}-password`}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={signUp ? "new-password" : "current-password"}
              value={values.password}
              onChange={(e) => set("password", e.target.value)}
              aria-invalid={!!errors.password}
              aria-describedby={[errors.password && `${uid}-password-error`, signUp && `${uid}-password-hint`].filter(Boolean).join(" ") || undefined}
              className={cn(inputClass(!!errors.password), "pr-12")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute top-1/2 right-2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-mk-muted hover:bg-mk-fg/[0.05] hover:text-mk-fg"
            >
              {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            </button>
          </div>
          {signUp && (
            <div id={`${uid}-password-hint`} className="mt-2 flex items-center gap-3">
              <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden="true">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={cn("h-1 rounded-full transition-colors", i <= score ? STRENGTH_COLOR[score] : "bg-mk-fg/10")} />
                ))}
              </div>
              <span className="shrink-0 text-right text-xs whitespace-nowrap text-mk-muted">{score ? `${STRENGTH_LABEL[score]} password` : "8+ characters"}</span>
            </div>
          )}
        </Field>

        {signUp && (
          <Field id={`${uid}-organisation`} label="Organisation" optional>
            <input
              id={`${uid}-organisation`}
              name="organisation"
              autoComplete="organization"
              value={values.organisation}
              onChange={(e) => set("organisation", e.target.value)}
              className={inputClass(false)}
            />
          </Field>
        )}

        {signUp && (
          <div>
            <label htmlFor={`${uid}-terms`} className="flex cursor-pointer items-start gap-3 text-sm text-mk-muted">
              <input
                id={`${uid}-terms`}
                type="checkbox"
                checked={values.terms}
                onChange={(e) => set("terms", e.target.checked)}
                aria-invalid={!!errors.terms}
                aria-describedby={errors.terms ? `${uid}-terms-error` : undefined}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[#1f1b2d]"
              />
              I agree to the terms of use and understand that demo data is synthetic.
            </label>
            {errors.terms && <ErrorText id={`${uid}-terms-error`}>{errors.terms}</ErrorText>}
          </div>
        )}

        <button
          type="submit"
          disabled={pending !== null}
          className="mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-mk-brand text-[15px] font-medium text-mk-brand-fg transition-colors hover:bg-[#cdb6ff] disabled:opacity-60"
        >
          {pending === "form" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <>
              {signUp ? "Create account" : "Sign in"}
              <ArrowRight className="size-4" aria-hidden="true" />
            </>
          )}
          {pending === "form" && <span>{signUp ? "Creating your account…" : "Signing in…"}</span>}
        </button>
      </form>

      <p className="mt-4 rounded-xl bg-mk-surface px-4 py-3 text-xs leading-relaxed text-mk-muted">
        Demo build: accounts are not checked yet. Any valid email opens the workspace with synthetic data.
      </p>

      <p className="mt-8 text-center text-sm text-mk-muted">
        {signUp ? "Already have an account? " : "New to Elevate? "}
        <Link href={signUp ? "/sign-in" : "/sign-up"} className="font-medium text-mk-fg underline-offset-4 hover:underline">
          {signUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}

function inputClass(invalid: boolean) {
  return cn(
    "h-12 w-full rounded-xl border bg-mk-raised px-4 text-[15px] text-mk-fg placeholder:text-mk-faint transition-colors focus-visible:border-mk-fg/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
    invalid ? "border-mk-red" : "border-mk-line-strong",
  );
}

function Field({ id, label, optional, error, children }: { id: string; label: string; optional?: boolean; error?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 flex items-baseline justify-between text-sm font-medium text-mk-fg">
        {label}
        {optional && <span className="text-xs font-normal text-mk-faint">Optional</span>}
      </label>
      {children}
      {error && <ErrorText id={`${id}-error`}>{error}</ErrorText>}
    </div>
  );
}

function ErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-xs text-mk-red">
      {children}
    </p>
  );
}
