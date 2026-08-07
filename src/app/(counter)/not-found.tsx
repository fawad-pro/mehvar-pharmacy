import Link from 'next/link';

/**
 * Styled 404 for the counter app.
 *
 * `notFound()` in the detail pages (a product, customer, receipt or purchase
 * that is not there) previously rendered Next's bare default. That is where an
 * operator following a stale link, or a mistyped id, lands — and a dead-end
 * with no chrome reads as a broken app rather than "that record isn't here".
 * This gives them the sentence and a way back (I5, P2).
 */
export default function CounterNotFound() {
  return (
    <section className="mx-auto flex max-w-lg flex-col items-start gap-4 p-8">
      <h1 className="text-green-900 text-2xl font-semibold">That page isn’t here</h1>
      <p className="text-ink/70 leading-relaxed">
        The record you were looking for could not be found. It may have been removed, or the link
        may be out of date.
      </p>
      <Link
        href="/sale"
        className="bg-green-600 text-paper min-h-touch flex items-center rounded px-6 font-medium"
      >
        Back to the counter
      </Link>
    </section>
  );
}
