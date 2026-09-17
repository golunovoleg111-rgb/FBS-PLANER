import * as XLSX from 'xlsx';
import type { PlanRow } from './types';

export type PickingItem = { name: string; size: string; color: string; article: string; count: number };
export type PickingResult = { items: PickingItem[]; total: number };

export function parsePickingWorkbook(data: ArrayBuffer): PickingResult {
  const book = XLSX.read(data, { type: 'array', cellText: true });
  const candidates: { rows: unknown[][]; header: number }[] = [];
  for (const name of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false });
    const header = rows.findIndex(row => String(row[3]).trim() === 'Наименование' && String(row[4]).trim() === 'Размер' && String(row[5]).trim() === 'Цвет' && String(row[6]).trim() === 'Артикул продавца');
    if (header >= 0) candidates.push({ rows, header });
  }
  if (candidates.length !== 1) throw new Error(candidates.length ? 'В файле найдено несколько сборочных заданий.' : 'Не найдены столбцы D:G: Наименование, Размер, Цвет, Артикул продавца.');
  const { rows, header } = candidates[0], groups = new Map<string, PickingItem>(); let total = 0;
  for (const row of rows.slice(header + 1)) {
    const values = [3, 4, 5, 6].map(i => String(row[i] ?? ''));
    if (values.every(value => !value.trim())) continue;
    if (!values[0].trim() || !values[3].trim()) throw new Error('Есть строка без наименования или артикула.');
    const key = JSON.stringify(values), item = groups.get(key) || { name: values[0], size: values[1], color: values[2], article: values[3], count: 0 };
    item.count += 1; groups.set(key, item); total += 1;
  }
  const declared = rows.slice(0, header).flat().map(String).join(' ').match(/Количество товаров:\s*(\d+)/i);
  if (declared && Number(declared[1]) !== total) throw new Error(`Количество строк (${total}) не совпадает с итогом (${declared[1]}).`);
  if (!total) throw new Error('В таблице нет товаров.');
  return { items: [...groups.values()], total };
}

export function pickingFromPlan(rows: PlanRow[]): PickingResult {
  const groups = new Map<string, PickingItem>();
  rows.filter(x => x.selected).forEach(row => {
    const key = JSON.stringify([row.name, row.size, row.color, row.article]);
    const item = groups.get(key) || { name: row.name, size: row.size, color: row.color, article: row.article, count: 0 };
    item.count += row.qty; groups.set(key, item);
  });
  return { items: [...groups.values()], total: rows.filter(x => x.selected).reduce((n, x) => n + x.qty, 0) };
}
