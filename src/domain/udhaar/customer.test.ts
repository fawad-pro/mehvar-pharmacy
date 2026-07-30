import { describe, expect, it } from 'vitest';

import { validateCustomerDraft } from './customer';

describe('customer draft — the D-boundary (Phase 5 §2)', () => {
  it('accepts a name alone', () => {
    const result = validateCustomerDraft({ name: 'Rashid Sahib', phone: null });
    expect(result).toEqual({ ok: true, value: { name: 'Rashid Sahib', phone: null } });
  });

  it('accepts a name and a phone', () => {
    const result = validateCustomerDraft({ name: 'Rashid', phone: '0301-2345678' });
    expect(result).toEqual({
      ok: true,
      value: { name: 'Rashid', phone: '0301-2345678' },
    });
  });

  it('trims both fields', () => {
    const result = validateCustomerDraft({ name: '  Rashid  ', phone: '  0301-234567  ' });
    expect(result).toEqual({ ok: true, value: { name: 'Rashid', phone: '0301-234567' } });
  });

  it('requires a name', () => {
    expect(validateCustomerDraft({ name: '', phone: null })).toEqual({
      ok: false,
      rejections: [{ reason: 'name_required' }],
    });
    expect(validateCustomerDraft({ name: '   ', phone: null }).ok).toBe(false);
  });

  it('rejects a phone that is not phone-shaped', () => {
    const result = validateCustomerDraft({ name: 'Rashid', phone: 'not a number at all!!' });
    expect(result).toEqual({ ok: false, rejections: [{ reason: 'phone_invalid' }] });
  });

  it('is forgiving of the punctuation a salesman actually types', () => {
    for (const phone of ['03001234567', '0300-1234567', '+92 300 1234567', '(0300) 1234567']) {
      expect(validateCustomerDraft({ name: 'Rashid', phone }).ok, phone).toBe(true);
    }
  });

  it('treats an empty phone string as none', () => {
    const result = validateCustomerDraft({ name: 'Rashid', phone: '' });
    expect(result).toEqual({ ok: true, value: { name: 'Rashid', phone: null } });
  });
});
