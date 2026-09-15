import { describe, expect, it } from 'vitest';
import { assessPhysicalBox, boxConfirmationKey } from '../src/google';
import type { PhysicalBox } from '../src/types';

const validBox: PhysicalBox = {
  id: 'BOX-10',
  type: 'MONO',
  totalQty: 10,
  placement: 'R-1',
  palette: 'P-1',
  side: 'A',
  level: '2',
  storageCells: 'H1',
  status: 'CONFIRMED',
  components: [{ barcode: '100', article: 'A', color: 'чёрный', size: '42', qty: 10 }],
};

describe('warehouse box review', () => {
  it('accepts a consistent confirmed box automatically', () => {
    expect(assessPhysicalBox(validBox)).toBeNull();
  });

  it('requires explicit review for mismatched or oversized boxes', () => {
    const issue = assessPhysicalBox({ ...validBox, totalQty: 60 });
    expect(issue?.confirmable).toBe(true);
    expect(issue?.reasons.join(' ')).toContain('Состав содержит 10 шт.');
    expect(issue?.reasons.join(' ')).toContain('превышает защитный лимит 50');
  });

  it('changes the confirmation key when the box composition changes', () => {
    const changed = { ...validBox, components: [{ ...validBox.components[0], qty: 9 }], totalQty: 9 };
    expect(boxConfirmationKey(changed)).not.toBe(boxConfirmationKey(validBox));
  });

  it('does not allow manual confirmation without BOX_ID', () => {
    expect(assessPhysicalBox({ ...validBox, id: '' })?.confirmable).toBe(false);
  });
});

