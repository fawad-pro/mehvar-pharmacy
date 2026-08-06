'use client';

/**
 * "You may already have this" — said while the product is being typed.
 *
 * WHAT THIS PREVENTS
 *
 * The same medicine entered twice is the quiet catastrophe of a pharmacy
 * catalogue. Nothing errors. Both entries work. Stock splits across them, so
 * both on-hand figures are wrong, the low-stock list nags about a product
 * sitting on the shelf under its other name, and the margin report divides one
 * product's sales between two rows. By the time anyone notices, months of
 * history are attached to both and merging them is a data-repair job.
 *
 * It is also entirely preventable, because at the moment somebody types
 * "Panadol 500mg tab" the software already knows there is a "PANADOL 500 MG
 * Tablet". It just never said so.
 *
 * THREE THINGS TO SAY, AND ONLY ONE OF THEM IS A PROBLEM
 *
 *   duplicate         — you already have this exact medicine. Offered as a
 *                       link, because what the operator wants is that product,
 *                       not a second copy of it.
 *   strength-differs  — same brand and form, different milligrams. The one
 *                       worth interrupting for: either a real second line or a
 *                       mistyped dose, and those have very different costs.
 *   alternative       — same molecule, different brand. NOT a problem. Said
 *                       quietly, as information, because stocking Panadol and
 *                       Paracip together is normal pharmacy and software that
 *                       tuts at it is software that gets ignored.
 *
 * Nothing here blocks. The operator can always save — they are standing in
 * front of the shelf and the software is not (P2, D4).
 */

import Link from 'next/link';

import { useCatalog } from '@/client/search/provider';
import { findCatalogMatches, type MatchKind } from '@/domain/catalog/identity';
import { formatForm } from '@/domain/catalog/form';

interface Candidate {
  id: string | null;
  name: string;
  strength: string;
  form: string;
  manufacturer: string;
  formulaText: string;
}

export function DuplicateNotice({ candidate }: { candidate: Candidate }) {
  const { index } = useCatalog();

  // Below three characters everything looks like everything; warning then would
  // train the operator to ignore the row before it has ever been right.
  if (!index || candidate.name.trim().length < 3) {
    return null;
  }

  const matches = findCatalogMatches(
    {
      name: candidate.name,
      strength: candidate.strength || null,
      form: candidate.form || null,
      manufacturer: candidate.manufacturer || null,
      formulaText: candidate.formulaText || null,
    },
    index.products,
    {
      identify: (product) => ({
        name: product.name,
        strength: product.strength,
        form: product.form,
        manufacturer: product.manufacturer,
        formulaText: product.formulaText,
      }),
      idOf: (product) => product.id,
      // Editing a product must not report it as its own duplicate.
      ...(candidate.id ? { ignoreId: candidate.id } : {}),
    },
  );

  if (matches.length === 0) return null;

  const first = matches[0]!;
  const sameKind = matches.filter((match) => match.kind === first.kind);

  return <Notice kind={first.kind} products={sameKind.map((match) => match.product)} />;
}

function Notice({
  kind,
  products,
}: {
  kind: MatchKind;
  products: readonly {
    id: string;
    name: string;
    strength: string | null;
    form: string | null;
    manufacturer: string | null;
  }[];
}) {
  const describe = (product: (typeof products)[number]) =>
    [product.name, product.strength, formatForm(product.form), product.manufacturer]
      .filter(Boolean)
      .join(' · ');

  if (kind === 'duplicate') {
    const existing = products[0]!;
    return (
      <div className="border-amber/50 bg-amber/5 rounded border p-3 text-sm" role="status">
        <p className="text-amber font-medium">You already have this medicine.</p>
        <p className="text-ink/70 mt-1">
          Saving it again would split its stock across two entries.{' '}
          <Link href={`/products/${existing.id}`} className="text-green-700 underline">
            Open {describe(existing)}
          </Link>{' '}
          instead.
        </p>
      </div>
    );
  }

  if (kind === 'strength-differs') {
    return (
      <div className="border-amber/50 bg-amber/5 rounded border p-3 text-sm" role="status">
        <p className="text-amber font-medium">Check the strength.</p>
        <p className="text-ink/70 mt-1">
          You already stock {products.map(describe).join(', ')}. If this really is a different
          strength, carry on — if it is a typing slip, fix it before saving.
        </p>
      </div>
    );
  }

  return (
    <p className="text-ink/60 text-sm" role="status">
      {/* Deliberately plain text, no border, no colour. Stocking several brands
          of one molecule is normal, and dressing it up as a warning would teach
          the operator to skip past this whole area of the screen (I7). */}
      Same medicine as {products.map(describe).join(', ')} — a different brand of the same
      formula. That is fine; both can be stocked.
    </p>
  );
}
