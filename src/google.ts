import type { PhysicalBox, PhysicalBoxesResult, WarehouseIssue, WarehouseIssueCode } from './types';

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

export function boxConfirmationKey(box: PhysicalBox) {
  const source = [box.id, box.totalQty, box.placement, box.storageCells, ...box.components
    .map(component => `${component.barcode}:${component.qty}`)
    .sort()].join('|');
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) hash = ((hash << 5) + hash) ^ source.charCodeAt(index);
  return `${box.id || 'NO-ID'}:${(hash >>> 0).toString(36)}`;
}

export function assessPhysicalBox(box: PhysicalBox): WarehouseIssue | null {
  const reasons: string[] = [];
  const codes: WarehouseIssueCode[] = [];
  const componentsTotal = box.components.reduce((total, component) => total + component.qty, 0);
  const status = box.status.replace(/^[^A-ZА-ЯЁ]+/iu, '').trim().toUpperCase();
  const statusAllowed = status === 'CONFIRMED' || status === 'HEURISTIC_CONFIRMED';
  const volumeAllowed = norm(box.volumeAuto) === 'да';
  const compactLargeBox = box.totalQty > 50 && /КРУПНАЯ КОРОБКА ДОПУСТИМА/i.test(box.volumeStatus);
  const hardVolumeBlock = box.totalQty > 50 && !compactLargeBox;

  if (!box.id) {
    codes.push('identity');
    reasons.push('Не указан BOX_ID. Система не может определить границы физической коробки.');
  }
  if (!box.components.length) {
    codes.push('composition');
    reasons.push('На листе 21_Состав_коробок нет состава из Хранения. Нельзя проверить, какие баркоды находятся внутри.');
  }
  if (!statusAllowed) {
    codes.push('status');
    reasons.push(`Статус сверки «${box.status || 'пусто'}». Автоматически разрешены только «✅ CONFIRMED» и «🟡 HEURISTIC_CONFIRMED».`);
  }
  if (box.totalQty <= 0) {
    codes.push('quantity');
    reasons.push('В колонке «Всего шт.» нет положительного количества.');
  }
  if (box.components.length && box.totalQty !== componentsTotal) {
    codes.push('quantity');
    reasons.push(`Количество расходится: в «Всего шт.» указано ${box.totalQty}, а сумма состава Хранения — ${componentsTotal}.`);
  }
  if (!box.placement) {
    codes.push('placement');
    reasons.push('Нет подтверждённой ячейки Расстановки. Склад не сможет однозначно найти коробку для перемещения.');
  }
  if (!volumeAllowed) {
    codes.push('volume');
    reasons.push(`Физический объём не получил автодопуск: «${box.volumeStatus || 'проверка не заполнена'}», флаг «Автодопуск по объёму» — «${box.volumeAuto || 'пусто'}».`);
  }
  if (hardVolumeBlock) {
    codes.push('volume');
    reasons.push(`В коробке ${box.totalQty} шт. Защитный лимит 50 можно превысить только для малогабаритной группы со статусом «✅ КРУПНАЯ КОРОБКА ДОПУСТИМА».`);
  }
  if (!reasons.length) return null;
  const uniqueCodes = [...new Set(codes)];
  const blocking: string[] = [];
  if (!box.id) blocking.push('указать BOX_ID');
  if (!box.components.length) blocking.push('восстановить состав Хранения');
  if (!box.placement) blocking.push('указать ячейку Расстановки');
  if (hardVolumeBlock) blocking.push('исправить или подтвердить малогабаритную группу в таблице');
  return {
    key: boxConfirmationKey(box), box, reasons, codes: uniqueCodes,
    confirmable: blocking.length === 0,
    blockingReason: blocking.length ? `Сначала нужно: ${blocking.join(', ')}.` : undefined,
  };
}

export async function fetchPhysicalBoxes(token: string, spreadsheetId: string): Promise<PhysicalBoxesResult> {
  const [boxRows, componentRows] = await Promise.all([
    sheetValues(token, spreadsheetId, '20_Физические_коробки!A:AG'),
    sheetValues(token, spreadsheetId, '21_Состав_коробок!A:L'),
  ]);
  if (!boxRows.length || !componentRows.length) throw new Error('В листах 20/21 нет данных физического хранения.');
  const bh = boxRows[0], ch = componentRows[0];
  const bc = {
    id: findCol(bh,['box_id']), type: findCol(bh,['тип']), total: findCol(bh,['всего шт.','итого','количество','qty']),
    placement: findCol(bh,['расстанов']), palette: findCol(bh,['паллет']), side: findCol(bh,['сторон']), level: findCol(bh,['уров']),
    cells: findCol(bh,['ячейки хранения']), status: findCol(bh,['статус сверки']), volume: findCol(bh,['проверка физ. объема']),
    volumeAuto: findCol(bh,['автодопуск по объему']), volumeDetail: findCol(bh,['детали объема']),
  };
  const cc = {
    id: findCol(ch,['box_id','короб']), barcode: findCol(ch,['баркод','штрихкод']), article: findCol(ch,['артикул']),
    color: findCol(ch,['цвет']), size: findCol(ch,['размер']), qty: findCol(ch,['кол-во','количество','qty']), source: findCol(ch,['источник']),
    cell: findCol(ch,['ячейка']),
  };
  if (bc.id < 0 || cc.id < 0 || cc.barcode < 0) throw new Error('Не удалось распознать BOX_ID или баркоды в листах 20/21.');
  const components = new Map<string, PhysicalBox['components']>();
  const seenComponents = new Set<string>();
  componentRows.slice(1).forEach(row => {
    const id = clean(row[cc.id]), barcode = clean(row[cc.barcode]).replace(/\.0$/, '');
    if (!id || !barcode || (cc.source >= 0 && !norm(row[cc.source]).includes('хран'))) return;
    const qty = n(row[cc.qty]);
    if (qty <= 0) return;
    const signature = [id, barcode, qty, cc.cell >= 0 ? clean(row[cc.cell]) : '', cc.size >= 0 ? clean(row[cc.size]) : ''].join('|');
    if (seenComponents.has(signature)) return;
    seenComponents.add(signature);
    const list = components.get(id) || [];
    list.push({ barcode, article: cc.article >= 0 ? clean(row[cc.article]) : '', color: cc.color >= 0 ? clean(row[cc.color]) : '', size: cc.size >= 0 ? clean(row[cc.size]) : '', qty });
    components.set(id, list);
  });
  const parsedById = new Map<string, PhysicalBox>();
  boxRows.slice(1).forEach(row => {
    const id = clean(row[bc.id]);
    if (!id || parsedById.has(id)) return;
    parsedById.set(id, { id, type: bc.type >= 0 ? clean(row[bc.type]) : '', totalQty: bc.total >= 0 ? n(row[bc.total]) : 0,
      placement: bc.placement >= 0 ? clean(row[bc.placement]) : '', palette: bc.palette >= 0 ? clean(row[bc.palette]) : '',
      side: bc.side >= 0 ? clean(row[bc.side]) : '', level: bc.level >= 0 ? clean(row[bc.level]) : '',
      storageCells: bc.cells >= 0 ? clean(row[bc.cells]) : '', status: bc.status >= 0 ? clean(row[bc.status]) : '',
      volumeStatus: bc.volume >= 0 ? clean(row[bc.volume]) : '', volumeAuto: bc.volumeAuto >= 0 ? clean(row[bc.volumeAuto]) : '',
      volumeDetail: bc.volumeDetail >= 0 ? clean(row[bc.volumeDetail]) : '', components: components.get(id) || [],
    });
  });
  const parsed = [...parsedById.values()];
  const boxes: PhysicalBox[] = [];
  const issues: WarehouseIssue[] = [];
  parsed.forEach(box => {
    const issue = assessPhysicalBox(box);
    if (issue) issues.push(issue); else boxes.push(box);
  });
  return { boxes, issues };
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


