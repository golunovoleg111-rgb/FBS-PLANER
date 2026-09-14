import * as XLSX from 'xlsx';
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
import type { PlanRow } from './types';

const bundledFonts = pdfFonts as unknown as { pdfMake?: { vfs: Record<string, string> }; vfs?: Record<string, string> };
(pdfMake as unknown as { vfs: Record<string, string> }).vfs = bundledFonts.pdfMake?.vfs || bundledFonts.vfs || {};

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
    'Комментарий': row.reason,
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  ws['!cols'] = [14,12,18,20,28,28,10,18,12,12,20,16,48].map(wch => ({ wch }));
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
  return new Promise(resolve => pdfMake.createPdf(doc).getBlob(resolve));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

