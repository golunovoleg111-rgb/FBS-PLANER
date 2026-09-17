import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { requestXlsx } from '../src/exporters';
import type { PlanRow } from '../src/types';

const row:PlanRow={id:'1',groupId:'BOX-1',barcode:'2000001',article:'21_К_Вельвет_голубой',name:'Брюки',color:'голубой',size:'42',fbs:1,fbw:2,orders7:7,ordersPrev7:5,bought7:5,boughtPrev7:4,buyoutRate:.75,dailyDemand:1,stockBefore:3,stockAfter:8,supplyDays:3,target:9,maxStock:14,need:6,qty:5,warehouse:'Склад №1',palette:'P-1',placement:'R-2',side:'A',level:'2',storageCells:'H-1',boxType:'MONO',usefulQty:5,oversupplyQty:0,criticality:3,reason:'Готово',selected:true};

describe('request files',()=>{
  it('creates an XLSX with the accepted quantity and calculation limits',async()=>{const blob=requestXlsx([row]);const wb=XLSX.read(await blob.arrayBuffer());const data=XLSX.utils.sheet_to_json<Record<string,unknown>>(wb.Sheets.Заявка);expect(data[0]['Количество']).toBe(5);expect(data[0]['Остаток после заявки']).toBe(8);expect(data[0]['Допустимый максимум']).toBe(14);});
});


