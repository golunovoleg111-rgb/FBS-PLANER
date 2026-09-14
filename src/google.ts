import type { PhysicalBox } from './types';

declare global {
  interface Window { google?: { accounts: { oauth2: { initTokenClient: (options: Record<string, unknown>) => { requestAccessToken: (o?: Record<string, unknown>) => void } } } } }
}

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
  if (!clientId.trim()) throw new Error('Сначала укажите OAuth Client ID в настройках.');
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(), scope: 'https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.file',
      callback: (response: { access_token?: string; error?: string }) => response.access_token ? resolve(response.access_token) : reject(new Error(response.error || 'Вход Google отменён.')),
      error_callback: () => reject(new Error('Вход Google отменён.')),
    });
    client.requestAccessToken({ prompt: 'consent' });
  });
}

const clean = (v: unknown) => String(v ?? '').trim();
const norm = (v: unknown) => clean(v).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, '');
const n = (v: unknown) => Number(String(v ?? '0').replace(',', '.')) || 0;
const findCol = (headers: unknown[], words: string[]) => headers.findIndex(h => words.some(w => norm(h).includes(norm(w))));

async function sheetValues(token: string, spreadsheetId: string, range: string) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Google Sheets: ${r.status}. Проверьте доступ к таблице.`);
  return ((await r.json()) as { values?: unknown[][] }).values || [];
}

export async function fetchPhysicalBoxes(token: string, spreadsheetId: string): Promise<PhysicalBox[]> {
  const [boxRows, componentRows] = await Promise.all([
    sheetValues(token, spreadsheetId, '20_Физические_коробки!A:AG'),
    sheetValues(token, spreadsheetId, '21_Состав_коробок!A:L'),
  ]);
  if (!boxRows.length || !componentRows.length) throw new Error('В листах 20/21 нет данных физического хранения.');
  const bh = boxRows[0], ch = componentRows[0];
  const bc = {
    id: findCol(bh,['box_id','короб']), type: findCol(bh,['тип']), total: findCol(bh,['итого','количество','qty']),
    placement: findCol(bh,['расстанов']), palette: findCol(bh,['паллет']), side: findCol(bh,['сторон']), level: findCol(bh,['уров']),
    cells: findCol(bh,['ячейк','хранен']), status: findCol(bh,['статус']), allow: findCol(bh,['автодопуск']),
  };
  const cc = {
    id: findCol(ch,['box_id','короб']), barcode: findCol(ch,['баркод','штрихкод']), article: findCol(ch,['артикул']),
    color: findCol(ch,['цвет']), size: findCol(ch,['размер']), qty: findCol(ch,['количество','qty']), source: findCol(ch,['источник']),
  };
  if (bc.id < 0 || cc.id < 0 || cc.barcode < 0) throw new Error('Не удалось распознать BOX_ID или баркоды в листах 20/21.');
  const components = new Map<string, PhysicalBox['components']>();
  componentRows.slice(1).forEach(row => {
    const id = clean(row[cc.id]), barcode = clean(row[cc.barcode]).replace(/\.0$/, '');
    if (!id || !barcode || (cc.source >= 0 && !norm(row[cc.source]).includes('хран'))) return;
    const list = components.get(id) || [];
    list.push({ barcode, article: cc.article >= 0 ? clean(row[cc.article]) : '', color: cc.color >= 0 ? clean(row[cc.color]) : '', size: cc.size >= 0 ? clean(row[cc.size]) : '', qty: Math.max(1, n(row[cc.qty])) });
    components.set(id, list);
  });
  return boxRows.slice(1).map(row => {
    const id = clean(row[bc.id]);
    return { id, type: bc.type >= 0 ? clean(row[bc.type]) : '', totalQty: bc.total >= 0 ? n(row[bc.total]) : 0,
      placement: bc.placement >= 0 ? clean(row[bc.placement]) : '', palette: bc.palette >= 0 ? clean(row[bc.palette]) : '',
      side: bc.side >= 0 ? clean(row[bc.side]) : '', level: bc.level >= 0 ? clean(row[bc.level]) : '',
      storageCells: bc.cells >= 0 ? clean(row[bc.cells]) : '', status: bc.status >= 0 ? clean(row[bc.status]) : '', components: components.get(id) || [],
      _allow: bc.allow >= 0 ? clean(row[bc.allow]) : '',
    } as PhysicalBox & { _allow: string };
  }).filter(box => {
    if (!box.id || !box.components.length || !/confirmed|подтверж/i.test(box.status)) return false;
    if (box.totalQty <= 50) return true;
    return /да|yes|true/i.test(box._allow);
  });
}

export async function uploadDriveFile(token: string, folderId: string, filename: string, mimeType: string, blob: Blob) {
  if (!folderId.trim()) throw new Error('Укажите ID папки Google Drive в настройках.');
  const boundary = `fbs_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId.trim()] });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  });
  if (!r.ok) throw new Error(`Google Drive: ${r.status}. Проверьте ID папки и права OAuth.`);
  return r.json() as Promise<{ id: string; name: string; webViewLink?: string }>;
}

