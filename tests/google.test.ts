import { describe, expect, it } from 'vitest';
import { normalizeSourceWarehouses, parseStorageGrid } from '../src/google';

const storage = { title: 'BELTANEE STORE - Склад', rows: [
  ['', 'Предмет', 'Цвет', 'Размер', 'Общее упак', '', 'Моно короба', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Микс размеров'],
  ['', '', '', '', '', '', '1'],
  ['2040000000001', '21_К_Вельвет', 'Синий', '42', '10', '', '10', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '5'],
  ['2040000000002', '', 'Синий', '44', '5', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '5'],
], notes: { AD3: 'Большой MIX: проверено кладовщиком' } };

describe('source-of-truth warehouse parser', () => {
  it('uses a source column as stable physical BOX_ID', () => {
    const boxes = parseStorageGrid(storage);
    expect(boxes.map(x => [x.id, x.type, x.totalQty])).toEqual([['ST1-M-2040000000001-G','MONO',10],['ST1-X-AD','MIX',10]]);
    expect(boxes[1].components).toHaveLength(2); expect(boxes[1].note).toContain('проверено');
  });
  it('matches a physical source box to a placement cell without changing quantities', () => {
    const placement = { title: 'Лист1', rows: [['21_К_Вельвет\nСиний\n42р - 10 шт']], notes: {} };
    const result = normalizeSourceWarehouses([storage], placement);
    expect(result.boxes.find(x => x.id === 'ST1-M-2040000000001-G')?.placement).toBe('A1');
    expect(result.boxes.reduce((n,x)=>n+x.totalQty,0)).toBe(20);
  });
});
