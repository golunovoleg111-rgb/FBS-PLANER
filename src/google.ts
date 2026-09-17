import type { PhysicalBox, PhysicalBoxesResult, WarehouseIssue, WarehouseName } from './types';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(options: Record<string, unknown>): { requestAccessToken(options?: Record<string, unknown>): void };
        };
      };
    };
  }
}

export const SOURCE_SHEETS = {
  storage: { id: '1oaf7MiFLdMpOI-syYOaJEeXpIyGRLzkGkUXvlMbJroU', sheets: ['BELTANEE STORE - Склад', 'BELTANEE STORE - Склад (второй)', 'кимры'] },
  warehouse1: { id: '1Y7vu3v1OoXwNm2dC2qxQMwgENS467L0tv9fWiLxvFVE', sheets: ['Лист1'] },
  warehouse2: { id: '1ChCILYJikTbjHAmirDThdT6Bn27s06DXIHq6NiQ-FTU', sheets: ['Расстановка'] },
} as const;

let gisPromise: Promise<void> | null = null;
function loadGis() {
  if (window.google?.accounts) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => resolve(); script.onerror = () => reject(new Error('Не удалось загрузить вход Google.'));
    document.head.appendChild(script);
  });
  return gisPromise;
}

export async function authorizeGoogle(clientId: string): Promise<string> {
  if (!clientId.trim()) throw new Error('Укажите OAuth Client ID.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({ client_id: clientId.trim(),
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.file',
      callback: (response: { access_token?: string; error?: string }) => response.access_token ? resolve(response.access_token) : reject(new Error(response.error || 'Вход Google отменён.')),
      error_callback: () => reject(new Error('Вход Google отменён.')) });
    client.requestAccessToken({ prompt: '' });
  });
}

type Cell = { formattedValue?: string; note?: string };
export type SheetGrid = { title: string; rows: string[][]; notes: Record<string, string> };
const colName = (index: number) => { let n = index + 1, out = ''; while (n) { n -= 1; out = String.fromCharCode(65 + n % 26) + out; n = Math.floor(n / 26); } return out; };
const clean = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => clean(v).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
const number = (v: unknown) => Number(clean(v).replace(/\s/g, '').replace(',', '.')) || 0;

async function fetchGrids(token: string, spreadsheetId: string, titles: readonly string[]) {
  const metaResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, { headers: { Authorization: `Bearer ${token}` } });
  if (!metaResponse.ok) throw new Error(`Google Sheets ${metaResponse.status}: нет доступа к источнику склада.`);
  const meta = await metaResponse.json() as { sheets?: Array<{ properties?: { title?: string } }> };
  const actualTitles = (meta.sheets || []).map(x => x.properties?.title || '');
  const resolved = titles.map(wanted => actualTitles.find(actual => norm(actual) === norm(wanted))).filter((title): title is string => Boolean(title));
  if (!resolved.length) throw new Error(`В таблице не найдены листы: ${titles.join(', ')}.`);
  const ranges = resolved.map(title => `&ranges=${encodeURIComponent(`'${title.replace(/'/g, "''")}'!A:ZZ`)}`).join('');
  const fields = 'sheets(properties(title),data(rowData(values(formattedValue,note))))';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=true${ranges}&fields=${encodeURIComponent(fields)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Sheets ${response.status}: нет доступа к одному из источников склада.`);
  const json = await response.json() as { sheets?: Array<{ properties?: { title?: string }; data?: Array<{ rowData?: Array<{ values?: Cell[] }> }> }> };
  return (json.sheets || []).map(sheet => {
    const rows: string[][] = [], notes: Record<string, string> = {};
    (sheet.data?.[0]?.rowData || []).forEach((row, r) => {
      rows[r] = (row.values || []).map((cell, c) => { if (cell.note) notes[`${colName(c)}${r + 1}`] = cell.note; return cell.formattedValue || ''; });
    });
    return { title: sheet.properties?.title || '', rows, notes } satisfies SheetGrid;
  });
}

function warehouseForSheet(title: string): WarehouseName {
  if (/второй/i.test(title)) return 'Склад №2';
  if (/кимр/i.test(title)) return 'Кимры';
  return 'Склад №1';
}

export function parseStorageGrid(grid: SheetGrid): PhysicalBox[] {
  if (!grid.rows.length) return [];
  const boxes = new Map<string, PhysicalBox>();
  const prefix = grid.title === 'BELTANEE STORE - Склад' ? 'ST1' : /второй/i.test(grid.title) ? 'ST2' : 'KIM';
  let article = '';
  for (let r = 2; r < grid.rows.length; r += 1) {
    const row = grid.rows[r] || [];
    const barcode = clean(row[0]).replace(/\.0$/, '');
    if (clean(row[1])) article = clean(row[1]);
    const color = clean(row[2]), size = clean(row[3]);
    if (!/^\d{8,}$/.test(barcode) || !article) continue;
    for (let c = 6; c < row.length; c += 1) {
      const qty = number(row[c]); if (qty <= 0) continue;
      const type: 'MONO' | 'MIX' = c < 29 ? 'MONO' : 'MIX';
      const key = type === 'MONO' ? `${c}:${barcode}` : String(c);
      const id = type === 'MONO' ? `${prefix}-M-${barcode}-${colName(c)}` : `${prefix}-X-${colName(c)}`;
      const sourceCell = `${colName(c)}${r + 1}`;
      const box = boxes.get(key) || { id, type, totalQty: 0, placement: '', palette: colName(c), side: '', level: '', storageCells: `${grid.title}!${type === 'MONO' ? sourceCell : colName(c)}`,
        status: 'SOURCE', warehouse: warehouseForSheet(grid.title), sourceSheet: grid.title, sourceColumn: colName(c), note: '', components: [] };
      box.components.push({ barcode, article, color, size, qty }); box.totalQty += qty;
      const note = grid.notes[sourceCell]; if (note) box.note = [box.note, note].filter(Boolean).join('\n');
      boxes.set(key, box);
    }
  }
  return [...boxes.values()].filter(box => box.totalQty > 0);
}

type Position = { cell: string; text: string; total: number; sizes: Map<string, number>; palette: string; level: string; note: string };
function positionCells(grid: SheetGrid): Position[] {
  const positions: Position[] = [];
  grid.rows.forEach((row, r) => row.forEach((raw, c) => {
    const text = clean(raw); if (!text || text.length < 8 || /мусорка|раздевалк/i.test(text)) return;
    const sizes = new Map<string, number>();
    for (const match of text.matchAll(/(\d{2,3})\s*р?\.?\s*[-–]\s*(\d+)/giu)) sizes.set(match[1], (sizes.get(match[1]) || 0) + Number(match[2]));
    const total = sum(sizes.values()); if (!total) return;
    positions.push({ cell: `${colName(c)}${r + 1}`, text, total, sizes, palette: colName(c), level: String(r + 1), note: grid.notes[`${colName(c)}${r + 1}`] || '' });
  }));
  return positions;
}
const sum = (values: Iterable<number>) => [...values].reduce((a, b) => a + b, 0);

function attachPositions(boxes: PhysicalBox[], grid: SheetGrid, warehouse: WarehouseName) {
  const positions = positionCells(grid), used = new Set<string>();
  for (const box of boxes.filter(x => x.warehouse === warehouse)) {
    const sizes = new Map<string, number>(); box.components.forEach(x => sizes.set(x.size, (sizes.get(x.size) || 0) + x.qty));
    let best: Position | undefined, bestScore = -1;
    for (const position of positions) {
      if (used.has(position.cell) || position.total !== box.totalQty) continue;
      let score = 0;
      sizes.forEach((qty, size) => { if (position.sizes.get(size) === qty) score += 5; else if (position.sizes.has(size)) score += 1; });
      for (const component of box.components) {
        if (norm(position.text).includes(norm(component.color))) score += 2;
        const words = component.article.split('_').filter(x => x.length > 1); if (words.some(word => norm(position.text).includes(norm(word)))) score += 1;
      }
      if (score > bestScore) { best = position; bestScore = score; }
    }
    if (best && bestScore >= 5) {
      used.add(best.cell); box.placement = best.cell; box.palette = best.palette; box.level = best.level; box.storageCells = `${grid.title}!${best.cell}`;
      if (best.note) box.note = [box.note, best.note].filter(Boolean).join('\n');
    }
  }
}

export function normalizeSourceWarehouses(storage: SheetGrid[], warehouse1?: SheetGrid, warehouse2?: SheetGrid): PhysicalBoxesResult {
  const boxes = storage.flatMap(parseStorageGrid);
  if (warehouse1) attachPositions(boxes, warehouse1, 'Склад №1');
  if (warehouse2) attachPositions(boxes, warehouse2, 'Склад №2');
  const issues: WarehouseIssue[] = [];
  for (const box of boxes) {
    const reasons: string[] = [];
    if (!box.components.length) reasons.push('Нет состава физического короба.');
    if (box.components.reduce((n, x) => n + x.qty, 0) !== box.totalQty) reasons.push('Количество не равно сумме состава.');
    if (!box.placement) reasons.push('Короб не сопоставлен с ячейкой расстановки; используется исходная колонка хранения.');
    if (reasons.length) issues.push({ key: box.id, box, reasons, confirmable: reasons.length === 1 && !box.placement });
  }
  return { boxes, issues };
}

export async function fetchSourceWarehouses(token: string): Promise<PhysicalBoxesResult> {
  const [storage, first, second] = await Promise.all([
    fetchGrids(token, SOURCE_SHEETS.storage.id, SOURCE_SHEETS.storage.sheets),
    fetchGrids(token, SOURCE_SHEETS.warehouse1.id, SOURCE_SHEETS.warehouse1.sheets),
    fetchGrids(token, SOURCE_SHEETS.warehouse2.id, SOURCE_SHEETS.warehouse2.sheets),
  ]);
  return normalizeSourceWarehouses(storage, first[0], second[0]);
}

export async function uploadDriveFile(token: string, folderId: string, filename: string, mimeType: string, blob: Blob) {
  if (!folderId.trim()) throw new Error('Укажите ID папки Google Drive.');
  const boundary = `fbs_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId.trim()] });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  if (!response.ok) throw new Error(`Google Drive ${response.status}: проверьте папку и права.`);
  return response.json() as Promise<{ id: string; name: string; webViewLink?: string }>;
}
