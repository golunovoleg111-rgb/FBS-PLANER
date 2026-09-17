import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parsePickingWorkbook } from '../src/converter';

function workbook(items: string[][], declared = items.length) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`Количество товаров: ${declared}`], ['', '', '', 'Наименование', 'Размер', 'Цвет', 'Артикул продавца'], ...items.map((row, i) => [i, '', '', ...row])]), 'Лист подбора');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('manual Excel to picking PDF input', () => {
  it('merges only exact D:G duplicates and keeps first-seen order', () => {
    const result = parsePickingWorkbook(workbook([['Товар','42','серый','A'],['Товар','44','серый','A'],['Товар','42','серый','A'],['Товар','42','чёрный','A']]));
    expect(result.total).toBe(4); expect(result.items.map(x => x.count)).toEqual([2,1,1]);
  });
  it('rejects a declared total mismatch', () => expect(() => parsePickingWorkbook(workbook([['Товар','42','','A']], 2))).toThrow(/не совпадает/));
});
