/**
 * A surface that exists in the navigation but not yet in the product.
 *
 * Phase 10 §8: "Empty states teach the key that fills them." The same discipline
 * applies during the build week — a key on the bar that leads somewhere blank is
 * worse than one that says plainly what is coming and when. Each of these is
 * replaced wholesale by the session named on it.
 */
export function SurfacePlaceholder({
  title,
  workflow,
  session,
  children,
}: {
  title: string;
  workflow: string;
  session: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="mx-auto flex max-w-xl flex-col gap-3 p-10">
      <h1 className="text-green-900 text-2xl font-semibold">{title}</h1>
      <p className="text-ink/60">{workflow}</p>
      {children}
      <p className="text-ink/40 border-line mt-2 border-t pt-3 text-sm">Arrives in {session}.</p>
    </section>
  );
}
