import { redirect } from 'next/navigation';

import { currentSession } from '@/auth/session';

import { ProductForm } from '../product-form';

export default async function NewProductPage() {
  const session = await currentSession();
  if (!session) {
    redirect('/login');
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-navy text-2xl font-semibold">Add product</h1>
      <ProductForm
        initial={{
          id: null,
          globalProductId: null,
          name: '',
          manufacturer: '',
          form: '',
          strength: '',
          formulaText: '',
          baseUnitName: 'tab',
          packLevels: 'strip:10',
          unitPriceRupees: {},
          mrpRupees: '',
          mrpUnitName: null,
          minStock: '',
          needsCompletion: false,
        }}
      />
    </section>
  );
}
