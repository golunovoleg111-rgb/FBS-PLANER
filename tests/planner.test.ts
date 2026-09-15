import { describe, expect, it } from 'vitest';
import { buildPlan, removePlanRow } from '../src/planner';
import type { PhysicalBox } from '../src/types';

const catalog=[{barcode:'100',article:'A',name:'Брюки',color:'голубой',size:'42'}];
const sales=[{article:'A',ordered:7,bought:5,revenue:0}];
const settings={targetDays:14,safetyFactor:1,minOrders:1,maxPerSku:50};
const base={fbs:[{barcode:'100',article:'A',name:'Брюки',size:'42',quantity:2}],sales,catalog,settings};

describe('planning rules',()=>{
  it('subtracts only selected FBW warehouses',()=>{
    const fbw=[{barcode:'100',article:'A',size:'42',inTransit:0,returnsInTransit:0,total:15,warehouses:{Коледино:12,Тула:3}}];
    const withOne=buildPlan({...base,fbw,includedWarehouses:['Коледино']});
    const without=buildPlan({...base,fbw,includedWarehouses:[]});
    expect(withOne).toHaveLength(0);
    expect(without[0].qty).toBe(12);
  });
  it('keeps all components of a chosen physical BOX_ID',()=>{
    const box:PhysicalBox={id:'BOX-7',type:'MIX',totalQty:8,placement:'R-1',palette:'P-1',side:'A',level:'2',storageCells:'H1',status:'CONFIRMED',volumeStatus:'✅ ОБЪЕМ НОРМА',volumeAuto:'ДА',volumeDetail:'',components:[{barcode:'100',article:'A',color:'',size:'42',qty:5},{barcode:'200',article:'B',color:'',size:'44',qty:3}]};
    const rows=buildPlan({...base,fbs:[...base.fbs,{barcode:'200',article:'B',name:'Рубашка',size:'44',quantity:1}],fbw:[],includedWarehouses:[],boxes:[box]});
    expect(rows.filter(x=>x.groupId==='BOX-7')).toHaveLength(2);
    expect(rows.find(x=>x.barcode==='200')?.reason).toContain('MIX');
    expect(removePlanRow(rows,rows[0].id).filter(x=>x.groupId==='BOX-7')).toHaveLength(0);
  });
  it('does not add catalog or MIX-box barcodes that are absent from current FBS sales stock',()=>{
    const catalogWithNew=[...catalog,{barcode:'200',article:'A',name:'Брюки',color:'голубой',size:'44'}];
    const box:PhysicalBox={id:'BOX-NEW',type:'MIX',totalQty:8,placement:'R-2',palette:'P-1',side:'A',level:'2',storageCells:'H2',status:'CONFIRMED',volumeStatus:'✅ ОБЪЕМ НОРМА',volumeAuto:'ДА',volumeDetail:'',components:[{barcode:'100',article:'A',color:'',size:'42',qty:5},{barcode:'200',article:'A',color:'',size:'44',qty:3}]};
    const rows=buildPlan({...base,catalog:catalogWithNew,fbw:[],includedWarehouses:[],boxes:[box]});
    expect(rows.some(row=>row.barcode==='200')).toBe(false);
    expect(rows.some(row=>row.groupId==='BOX-NEW')).toBe(false);
    expect(rows.find(row=>row.barcode==='100')?.groupId).toBe('unresolved-100');
  });
});


