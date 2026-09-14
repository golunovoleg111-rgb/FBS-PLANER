import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { requestPdf, requestXlsx } from '../src/exporters';
import type { PlanRow } from '../src/types';

const row:PlanRow={id:'1',groupId:'BOX-1',source:'auto',barcode:'2000001',article:'21_К_Вельвет_голубой',name:'Брюки',size:'42',fbs:1,fbw:2,sales7:7,target:14,qty:5,palette:'P-1',placement:'R-2',storageCells:'H-1',boxType:'MONO',confidence:'ok',reason:'Готово',selected:true};

describe('request files',()=>{
  it('creates an XLSX with the accepted quantity',async()=>{const blob=requestXlsx([row]);const wb=XLSX.read(await blob.arrayBuffer());const data=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets.Заявка);expect(data[0]['Количество']).toBe(5);});
  it('creates a non-empty PDF with Cyrillic text support',async()=>{const blob=await requestPdf([row]);expect(blob.type).toBe('application/pdf');expect(blob.size).toBeGreaterThan(1000);});
});

