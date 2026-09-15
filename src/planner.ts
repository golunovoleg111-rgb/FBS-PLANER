import type { AcceptedRequest, CatalogItem, FbsItem, FbwItem, PhysicalBox, PlanRow, PlannerSettings, SalesItem } from './types';

const sum = (xs: number[]) => xs.reduce((a,b)=>a+b,0);
const rounded = (value: number) => Math.round(value * 10) / 10;

type StockState = {
  item: CatalogItem;
  fbs: number;
  fbw: number;
  sales7: number;
  dailyDemand: number;
  current: number;
  supplyDays: number | null;
  target: number;
  maxStock: number;
  need: number;
  active: boolean;
  demandClass: string;
};

function demandLimit(equivalentOrders14: number) {
  if (equivalentOrders14 < 3) return { limit: 0, label: 'редкий' };
  if (equivalentOrders14 < 7) return { limit: 10, label: 'медленный' };
  if (equivalentOrders14 < 14) return { limit: 20, label: 'средний' };
  if (equivalentOrders14 < 28) return { limit: 30, label: 'хороший' };
  return { limit: 40, label: 'хит' };
}

export function buildPlan(input: {
  fbs: FbsItem[]; sales: SalesItem[]; fbw: FbwItem[]; catalog: CatalogItem[];
  includedWarehouses: string[]; boxes?: PhysicalBox[]; accepted?: AcceptedRequest[]; settings: PlannerSettings;
}): PlanRow[] {
  const { fbs, sales, fbw, catalog, includedWarehouses, boxes = [], settings } = input;
  const fbsMap = new Map(fbs.map(x => [x.barcode, x.quantity]));
  const fbwMap = new Map(fbw.map(x => [x.barcode, sum(includedWarehouses.map(w => x.warehouses[w] || 0))]));
  const salesMap = new Map(sales.map(x => [x.article, x.ordered]));
  const reserved = new Map<string,number>();
  (input.accepted || []).filter(x=>x.status==='Принята').flatMap(x=>x.rows).forEach(x=>reserved.set(x.barcode,(reserved.get(x.barcode)||0)+x.qty));

  const byArticle = new Map<string,CatalogItem[]>();
  catalog.forEach(item => {
    if (!item.barcode || !fbsMap.has(item.barcode)) return;
    const variants=byArticle.get(item.article)||[];
    if(!variants.some(variant=>variant.barcode===item.barcode)) variants.push(item);
    byArticle.set(item.article,variants);
  });

  const states = new Map<string,StockState>();
  const needs = new Map<string,StockState>();
  byArticle.forEach((variants,article) => {
    if(!variants.length) return;
    const sales7=salesMap.get(article)||0;
    const dailyDemand=sales7/7/variants.length;
    const demand=demandLimit(dailyDemand*14);
    const effectiveLimit=Math.min(settings.maxPerSku,demand.limit);
    variants.forEach(item=>{
      const currentFbs=fbsMap.get(item.barcode)||0;
      const currentFbw=fbwMap.get(item.barcode)||0;
      const current=currentFbs+currentFbw+(reserved.get(item.barcode)||0);
      const supplyDays=dailyDemand>0?current/dailyDemand:null;
      const target=Math.min(effectiveLimit,Math.ceil(dailyDemand*(settings.targetDays+settings.safetyDays)));
      const maxByDays=dailyDemand>0?Math.floor(dailyDemand*settings.maxAfterDays):0;
      const maxStock=Math.max(0,Math.min(effectiveLimit,maxByDays));
      const need=Math.max(0,target-current);
      const active=sales7>=settings.minOrders&&effectiveLimit>0&&need>0&&supplyDays!==null&&supplyDays<settings.minSupplyDays;
      const state:StockState={item,fbs:currentFbs,fbw:currentFbw,sales7,dailyDemand,current,supplyDays,target,maxStock,need,active,demandClass:demand.label};
      states.set(item.barcode,state);
      if(active) needs.set(item.barcode,state);
    });
  });

  if (!boxes.length) return [...needs.values()].map(need=>({
    id:`suggestion-${need.item.barcode}`,groupId:`suggestion-${need.item.barcode}`,source:'auto',barcode:need.item.barcode,article:need.item.article,
    name:need.item.name,size:need.item.size,fbs:need.fbs,fbw:need.fbw,sales7:need.sales7,dailyDemand:rounded(need.dailyDemand),stockBefore:need.current,
    stockAfter:need.current+need.need,supplyDays:need.supplyDays===null?null:rounded(need.supplyDays),target:need.target,maxStock:need.maxStock,need:need.need,qty:need.need,
    palette:'',placement:'',storageCells:'',boxType:'',confidence:'warning',
    reason:`Нужно ${need.need} шт.: запас ${rounded(need.supplyDays||0)} дн., цель ${need.target}, максимум ${need.maxStock}. Физическая коробка не найдена.`,selected:true,
  }));

  const remaining=new Map([...needs].map(([barcode,need])=>[barcode,need.need]));
  const projected=new Map([...states].map(([barcode,state])=>[barcode,state.current]));
  const chosen:PhysicalBox[]=[];
  const pool=boxes.filter(box=>box.components.length>0&&box.components.every(component=>fbsMap.has(component.barcode)));

  while(true){
    let best:PhysicalBox|undefined,bestScore=0,bestCovered=0,bestExcess=Infinity;
    for(const box of pool){
      const quantities=new Map<string,number>();
      box.components.forEach(component=>quantities.set(component.barcode,(quantities.get(component.barcode)||0)+component.qty));
      const feasible=[...quantities].every(([barcode,qty])=>{
        const state=states.get(barcode);
        return !!state&&(projected.get(barcode)||0)+qty<=state.maxStock;
      });
      if(!feasible) continue;
      const useful=sum([...quantities].map(([barcode,qty])=>Math.min(remaining.get(barcode)||0,qty)));
      const covered=[...quantities].filter(([barcode])=>(remaining.get(barcode)||0)>0).length;
      const excess=sum([...quantities].map(([barcode,qty])=>Math.max(0,qty-(remaining.get(barcode)||0))));
      if(useful>bestScore||(useful===bestScore&&covered>bestCovered)||(useful===bestScore&&covered===bestCovered&&useful>0&&excess<bestExcess)){
        best=box;bestScore=useful;bestCovered=covered;bestExcess=excess;
      }
    }
    if(!best||bestScore<=0) break;
    chosen.push(best);pool.splice(pool.indexOf(best),1);
    best.components.forEach(component=>{
      remaining.set(component.barcode,Math.max(0,(remaining.get(component.barcode)||0)-component.qty));
      projected.set(component.barcode,(projected.get(component.barcode)||0)+component.qty);
    });
  }

  const meta=new Map(catalog.map(item=>[item.barcode,item]));
  const rows:PlanRow[]=[];
  chosen.forEach(box=>box.components.forEach((component,index)=>{
    const need=needs.get(component.barcode);
    const state=states.get(component.barcode);
    const item=meta.get(component.barcode);
    const after=projected.get(component.barcode)||((state?.current||0)+component.qty);
    rows.push({
      id:`${box.id}-${component.barcode}-${index}`,groupId:box.id,source:'auto',barcode:component.barcode,
      article:component.article||item?.article||'',name:item?.name||'',size:component.size||item?.size||'',
      fbs:fbsMap.get(component.barcode)||0,fbw:fbwMap.get(component.barcode)||0,sales7:salesMap.get(component.article||item?.article||'')||0,
      dailyDemand:rounded(state?.dailyDemand||0),stockBefore:state?.current||0,stockAfter:after,
      supplyDays:state?.supplyDays===null?null:rounded(state?.supplyDays||0),target:state?.target||0,maxStock:state?.maxStock||0,need:need?.need||0,qty:component.qty,
      palette:box.palette,placement:box.placement,storageCells:box.storageCells,boxType:box.type,confidence:need?'ok':'warning',
      reason:need
        ? `${box.type||'Физическая'}-коробка. Запас ${rounded(need.supplyDays||0)} дн.; потребность ${need.need}, цель ${need.target}. После выбранных коробок ${after} из допустимых ${need.maxStock} (${need.demandClass}).`
        : `Обязательная позиция MIX-коробки. После выбранных коробок ${after} из допустимых ${state?.maxStock||0}.`,
      selected:true,
    });
  }));

  remaining.forEach((qty,barcode)=>{
    if(qty<=0) return;
    const need=needs.get(barcode)!;
    rows.push({
      id:`unresolved-${barcode}`,groupId:`unresolved-${barcode}`,source:'auto',barcode,article:need.item.article,name:need.item.name,size:need.item.size,
      fbs:need.fbs,fbw:need.fbw,sales7:need.sales7,dailyDemand:rounded(need.dailyDemand),stockBefore:need.current,stockAfter:need.current+qty,
      supplyDays:need.supplyDays===null?null:rounded(need.supplyDays),target:need.target,maxStock:need.maxStock,need:need.need,qty,
      palette:'',placement:'',storageCells:'',boxType:'',confidence:'warning',
      reason:`Осталось ${qty} шт. дефицита, но ни одна целая коробка не помещается в лимит ${need.maxStock}. Можно исключить или принять вручную.`,selected:true,
    });
  });
  return rows;
}

export function addManualRows(plan:PlanRow[],items:CatalogItem[],fbs:FbsItem[],fbw:FbwItem[],warehouses:string[]){
  const fm=new Map(fbs.map(item=>[item.barcode,item.quantity]));
  const wm=new Map(fbw.map(item=>[item.barcode,sum(warehouses.map(warehouse=>item.warehouses[warehouse]||0))]));
  const next=plan.map(item=>({...item}));
  items.forEach(item=>{
    const hit=next.find(row=>row.barcode===item.barcode&&row.source==='manual');
    if(hit){hit.qty+=1;hit.stockAfter+=1;hit.selected=true;return;}
    const current=(fm.get(item.barcode)||0)+(wm.get(item.barcode)||0);
    next.push({id:`manual-${item.barcode}`,groupId:`manual-${item.barcode}`,source:'manual',barcode:item.barcode,article:item.article,name:item.name,size:item.size,
      fbs:fm.get(item.barcode)||0,fbw:wm.get(item.barcode)||0,sales7:0,dailyDemand:0,stockBefore:current,stockAfter:current+1,supplyDays:null,target:0,maxStock:0,need:0,qty:1,
      palette:'',placement:'',storageCells:'',boxType:'',confidence:'warning',reason:'Добавлено пользователем в продажу. Проверьте количество перед принятием.',selected:true});
  });
  return next;
}

export function removePlanRow(plan: PlanRow[], id: string) {
  const row = plan.find(item => item.id === id);
  if (!row) return plan;
  const wholeBox = row.source === 'auto'
    && !row.groupId.startsWith('unresolved-')
    && !row.groupId.startsWith('suggestion-');
  return plan.filter(item => wholeBox ? item.groupId !== row.groupId : item.id !== id);
}
