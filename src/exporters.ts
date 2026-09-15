import * as XLSX from 'xlsx';
import type { PlanRow } from './types';

declare global { interface Window { pdfMake?: { createPdf: (doc: unknown) => { getBlob: (cb: (blob: Blob) => void) => void } } } }

let pdfPromise: Promise<void> | null = null;
function script(src: string) {
  return new Promise<void>((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=()=>resolve();el.onerror=()=>reject(new Error('Не удалось загрузить модуль PDF.'));document.head.appendChild(el);});
}
async function loadPdfMake(){
  if(window.pdfMake)return;
  if(!pdfPromise)pdfPromise=(async()=>{await script('https://cdn.jsdelivr.net/npm/pdfmake@0.2.23/build/pdfmake.min.js');await script('https://cdn.jsdelivr.net/npm/pdfmake@0.2.23/build/vfs_fonts.js');})();
  await pdfPromise;
}

const stamp = () => new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());

export function requestXlsx(rows: PlanRow[]) {
  const data = rows.map(row => ({
    'Коробка': row.groupId.startsWith('manual-') || row.groupId.startsWith('unresolved-') || row.groupId.startsWith('suggestion-') ? '' : row.groupId,
    'Паллета': row.palette,
    'Расстановка': row.placement,
    'Ячейки хранения': row.storageCells,
    'Артикул продавца': row.article,
    'Наименование': row.name,
    'Размер': row.size,
    'Баркод': row.barcode,
    'Количество': row.qty,
    'FBS сейчас': row.fbs,
    'FBW выбранных складов': row.fbw,
    'Продажи 7 дней': row.sales7,
    'Средние продажи в день': row.dailyDemand,
    'Остаток до заявки': row.stockBefore,
    'Остаток после заявки': row.stockAfter,
    'Целевой остаток': row.target,
    'Допустимый максимум': row.maxStock,
    'Комментарий': row.reason,
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [14,12,18,20,28,28,10,18,12,12,20,16,20,20,18,22,48].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, 'Заявка');
  return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function requestPdf(rows: PlanRow[]): Promise<Blob> {
  const body: Array<Array<string | number | Record<string, unknown>>> = [[
    { text: 'Коробка / место', style: 'th' }, { text: 'Позиция', style: 'th' },
    { text: 'Размер', style: 'th' }, { text: 'Баркод', style: 'th' }, { text: 'Кол-во', style: 'th' },
  ]];
  let lastGroup = '';
  rows.forEach(row => {
    const group = row.groupId.startsWith('manual-') || row.groupId.startsWith('unresolved-') || row.groupId.startsWith('suggestion-') ? 'Вручную' : row.groupId;
    const first = group !== lastGroup;
    body.push([
      { text: first ? [group, row.palette && `Паллета: ${row.palette}`, row.placement].filter(Boolean).join('\n') : '', bold: first },
      { text: [row.article, row.name].filter(Boolean).join('\n') }, row.size, row.barcode, { text: String(row.qty), alignment: 'center', bold: true },
    ]);
    lastGroup = group;
  });
  const doc: any = {
    pageOrientation: 'landscape' as const,
    pageMargins: [28, 30, 28, 30] as [number, number, number, number],
    content: [
      { text: 'Заявка FBS', style: 'title' },
      { text: `Сформировано: ${stamp()} · ${rows.reduce((n, r) => n + r.qty, 0)} шт. · ${new Set(rows.map(r => r.groupId)).size} групп`, margin: [0, 3, 0, 14] as [number,number,number,number], color: '#52606d' },
      { table: { headerRows: 1, widths: [125, '*', 55, 100, 48], body }, layout: { fillColor: (i: number) => i === 0 ? '#e8eefb' : i % 2 ? '#ffffff' : '#f7f9fc', hLineColor: () => '#cbd5e1', vLineColor: () => '#cbd5e1' } },
    ],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    styles: { title: { fontSize: 18, bold: true, color: '#172033' }, th: { bold: true, color: '#172033' } },
  };
  return loadPdfMake().then(()=>new Promise(resolve => window.pdfMake!.createPdf(doc).getBlob(resolve)));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}


