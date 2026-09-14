import * as XLSX from 'xlsx';
import type { CatalogItem, FbsItem, FbwItem, ParsedFbw, SalesItem } from './types';

type Row = Array<string | number | boolean | Date | null | undefined>;

const text = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => text(v).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '');
const num = (v: unknown) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(text(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

function workbookRows(buffer: ArrayBuffer): Row[][] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  if (!wb.SheetNames.length) throw new Error('В книге нет листов.');
  return wb.SheetNames.map(name => XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], { header: 1, defval: '' }));
}

function findTable(buffer: ArrayBuffer, required: string[]): { headers: string[]; rows: Row[] } {
  for (const rows of workbookRows(buffer)) {
    const at = rows.findIndex(row => required.every(key => row.some(cell => norm(cell).includes(norm(key)))));
    if (at >= 0) return { headers: rows[at].map(text), rows: rows.slice(at + 1) };
  }
  throw new Error(`Не найдены обязательные столбцы: ${required.join(', ')}.`);
}

function col(headers: string[], aliases: string[]) {
  return headers.findIndex(h => aliases.some(a => norm(h) === norm(a) || norm(h).includes(norm(a))));
}

export function parseFbs(buffer: ArrayBuffer): FbsItem[] {
  const { headers, rows } = findTable(buffer, ['Баркод', 'Количество', 'Артикул продавца']);
  const c = {
    barcode: col(headers, ['Баркод', 'Штрихкод']), qty: col(headers, ['Количество', 'Доступно']),
    article: col(headers, ['Артикул продавца']), name: col(headers, ['Наименование', 'Название']),
    size: col(headers, ['Размер']), brand: col(headers, ['Бренд']),
  };
  const items = rows.map(row => ({
    barcode: text(row[c.barcode]).replace(/\.0$/, ''), quantity: num(row[c.qty]), article: text(row[c.article]),
    name: c.name >= 0 ? text(row[c.name]) : '', size: c.size >= 0 ? text(row[c.size]) : '',
    brand: c.brand >= 0 ? text(row[c.brand]) : '',
  })).filter(x => x.barcode && x.article);
  if (!items.length) throw new Error('В отчёте FBS не найдено ни одной позиции.');
  return items;
}

export function parseSales(buffer: ArrayBuffer): SalesItem[] {
  const { headers, rows } = findTable(buffer, ['Артикул продавца', 'Заказано']);
  const c = {
    article: col(headers, ['Артикул продавца']), ordered: col(headers, ['Заказано, шт.', 'Заказано']),
    bought: col(headers, ['Выкупили, шт.', 'Выкупили']), revenue: col(headers, ['К перечислению за товар', 'Сумма заказов']),
  };
  const map = new Map<string, SalesItem>();
  rows.forEach(row => {
    const article = text(row[c.article]); if (!article) return;
    const hit = map.get(article) || { article, ordered: 0, bought: 0, revenue: 0 };
    hit.ordered += num(row[c.ordered]);
    hit.bought += c.bought >= 0 ? num(row[c.bought]) : 0;
    hit.revenue += c.revenue >= 0 ? num(row[c.revenue]) : 0;
    map.set(article, hit);
  });
  const items = [...map.values()];
  if (!items.length) throw new Error('В отчёте продаж не найдено ни одной позиции.');
  return items;
}

export function parseFbw(buffer: ArrayBuffer): ParsedFbw {
  const { headers, rows } = findTable(buffer, ['Артикул продавца', 'Баркод', 'Всего находится на складах']);
  const c = {
    article: col(headers, ['Артикул продавца']), barcode: col(headers, ['Баркод']), size: col(headers, ['Размер вещи', 'Размер']),
    transit: col(headers, ['В пути до получателей']), returns: col(headers, ['В пути возвраты']), total: col(headers, ['Всего находится на складах']),
  };
  const fixed = new Set([c.article, c.barcode, c.size, c.transit, c.returns, c.total]);
  const warehouses = headers.filter((h, i) => i > c.total && !fixed.has(i) && h);
  const warehouseCols = warehouses.map(name => headers.indexOf(name));
  const items: FbwItem[] = rows.map(row => {
    const wh: Record<string, number> = {};
    warehouses.forEach((name, i) => { wh[name] = num(row[warehouseCols[i]]); });
    return {
      barcode: text(row[c.barcode]).replace(/\.0$/, ''), article: text(row[c.article]), size: text(row[c.size]),
      inTransit: num(row[c.transit]), returnsInTransit: num(row[c.returns]), total: num(row[c.total]), warehouses: wh,
    };
  }).filter(x => x.barcode && x.article);
  if (!items.length) throw new Error('В отчёте FBW не найдено ни одной позиции.');
  if (!warehouses.length) throw new Error('В отчёте FBW не найдены склады.');
  return { items, warehouses };
}

function colorFromArticle(article: string) {
  const parts = article.split('_').filter(Boolean);
  return parts.length > 2 ? parts[parts.length - 1] : '';
}

export function parseCatalog(buffer: ArrayBuffer): CatalogItem[] {
  const { headers, rows } = findTable(buffer, ['Артикул продавца']);
  const c = {
    article: col(headers, ['Артикул продавца', 'Артикул']), barcode: col(headers, ['Баркод', 'Штрихкод']),
    size: col(headers, ['Размер вещи', 'Размер']), name: col(headers, ['Наименование', 'Название']), color: col(headers, ['Цвет']),
  };
  const items = rows.map(row => {
    const article = text(row[c.article]);
    return { article, barcode: c.barcode >= 0 ? text(row[c.barcode]).replace(/\.0$/, '') : '',
      size: c.size >= 0 ? text(row[c.size]) : '', name: c.name >= 0 ? text(row[c.name]) : '',
      color: c.color >= 0 ? text(row[c.color]) : colorFromArticle(article) };
  }).filter(x => x.article && x.size);
  if (!items.length) throw new Error('В номенклатуре не найдены позиции с артикулом и размером.');
  return items;
}

export function catalogFromReports(fbs: FbsItem[], fbw: FbwItem[]): CatalogItem[] {
  const map = new Map<string, CatalogItem>();
  fbs.forEach(x => map.set(x.barcode, { barcode:x.barcode, article:x.article, name:x.name, size:x.size, color:colorFromArticle(x.article) }));
  fbw.forEach(x => {
    const old = map.get(x.barcode);
    map.set(x.barcode, { barcode:x.barcode, article:x.article, name:old?.name || '', size:x.size || old?.size || '', color:old?.color || colorFromArticle(x.article) });
  });
  return [...map.values()];
}

