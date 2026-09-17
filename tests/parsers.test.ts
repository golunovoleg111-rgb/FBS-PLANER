import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFbs, parseFbw, parseSales } from '../src/parsers';

function book(rows: unknown[][]) {
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Лист1');
  return XLSX.write(wb,{type:'array',bookType:'xlsx'}) as ArrayBuffer;
}

describe('WB report parsers',()=>{
  it('reads FBS stock',()=>{const items=parseFbs(book([['Баркод','Количество','Наименование','Размер','Артикул продавца'],['2001',4,'Брюки','42','21_К_голубой']]));expect(items[0]).toMatchObject({barcode:'2001',quantity:4,size:'42'});});
  it('aggregates the real WB supplier report by barcode and size',()=>{const items=parseSales(book([
    ['Отчёт по данным поставщика','','','','','','','','','','','Заказано','','Выкупленные товары'],
    ['Бренд','Предмет','Сезон','Коллекция','Наименование','Артикул продавца','Артикул WB','Баркод','Размер','Контракт','Склад','шт.','Сумма заказов минус комиссия WB, руб.','Выкупили, шт.','К перечислению за товар, руб.','Текущий остаток, шт.'],
    ['Beltanee','Костюмы','','','Костюм','A','1','2001','42','','Склад WB РФ',3,100,2,80,0],
    ['Beltanee','Костюмы','','','Костюм','A','1','2001','42','','Остальные',4,120,3,90,0],
  ]));expect(items).toEqual([{barcode:'2001',article:'A',name:'Костюм',size:'42',ordered:7,bought:5,revenue:170}]);});
  it('detects every FBW warehouse',()=>{const parsed=parseFbw(book([['Артикул продавца','Баркод','Размер вещи','В пути до получателей','В пути возвраты на склад WB','Всего находится на складах','Коледино','Тула'],['A','2001','42',0,1,7,5,2]]));expect(parsed.warehouses).toEqual(['Коледино','Тула']);expect(parsed.items[0].warehouses.Тула).toBe(2);});
});

