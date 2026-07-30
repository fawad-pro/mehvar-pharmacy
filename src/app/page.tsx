/**
 * Bootstrap placeholder.
 *
 * The real root of this application is the Sale screen (Phase 10 §1: "the sale
 * screen is home"), built in Session 1 / Day 1 along with the app shell, the
 * top bar and the key bar. Nothing here is product surface — it exists so the
 * scaffold is verifiably runnable and the tokens are verifiably wired.
 */
export default function BootstrapPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <p className="text-xs font-medium tracking-[0.18em] text-green-600 uppercase">
        Mehvar Pharmacy
      </p>
      <h1 className="text-3xl font-semibold text-green-900">Session 0 — bootstrap complete</h1>
      <p className="text-ink/70 leading-relaxed">
        The scaffold, tooling and design tokens are in place. The counter surface arrives in Session
        1 (Phase 13, Day 1): schema, tenant chokepoint, app shell, and device login with PIN
        switching.
      </p>
      <p className="text-ink/50 text-sm">
        The authoritative specification is <code>docs/MASTER_PLAN.md</code>.
      </p>
    </main>
  );
}
