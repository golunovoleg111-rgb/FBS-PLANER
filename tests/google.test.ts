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
  volumeStatus: '✅ ОБЪЕМ НОРМА',
  volumeAuto: 'ДА',
  volumeDetail: '10 шт. в пределах нормы.',
  components: [{ barcode: '100', article: 'A', color: 'чёрный', size: '42', qty: 10 }],
};

describe('warehouse box review', () => {
  it('accepts a consistent confirmed box automatically', () => {
    expect(assessPhysicalBox(validBox)).toBeNull();
  });

  it('requires explicit review for mismatched or oversized boxes', () => {
    const issue = assessPhysicalBox({ ...validBox, totalQty: 60, volumeStatus: '🔴 ПОДОЗРИТЕЛЬНЫЙ ОБЪЕМ', volumeAuto: 'НЕТ' });
    expect(issue?.reasons.join(' ')).toContain('сумма состава Хранения — 10');
    expect(issue?.reasons.join(' ')).toContain('Защитный лимит 50');
    expect(issue?.confirmable).toBe(false);
  });

  it('allows a compact large box when the spreadsheet volume check permits it', () => {
    const compact = { ...validBox, totalQty: 60, volumeStatus: '✅ КРУПНАЯ КОРОБКА ДОПУСТИМА', volumeAuto: 'ДА', components: [{ ...validBox.components[0], qty: 60 }] };
    expect(assessPhysicalBox(compact)).toBeNull();
  });

  it('changes the confirmation key when the box composition changes', () => {
    const changed = { ...validBox, components: [{ ...validBox.components[0], qty: 9 }], totalQty: 9 };
    expect(boxConfirmationKey(changed)).not.toBe(boxConfirmationKey(validBox));
  });

  it('does not allow manual confirmation without BOX_ID', () => {
    expect(assessPhysicalBox({ ...validBox, id: '' })?.confirmable).toBe(false);
  });
});

