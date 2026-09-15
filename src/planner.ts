import type { AcceptedRequest, CatalogItem, FbsItem, FbwItem, PhysicalBox, PlanRow, PlannerSettings, SalesItem } from './types';

const sum = (xs: number[]) => xs.reduce((a,b)=>a+b,0);

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
  catalog.forEach(x => {
    if (!x.barcode || !fbsMap.has(x.barcode)) return;
    const a=byArticle.get(x.article)||[];
    if(!a.some(v=>v.barcode===x.barcode))a.push(x);
    byArticle.set(x.article,a);
  });
  const needs = new Map<string,{item:CatalogItem; fbs:number; fbw:number; sales7:number; target:number; need:number}>();
  byArticle.forEach((variants,article) => {
    const sales7=salesMap.get(article)||0;
    if(sales7<settings.minOrders || !variants.length) return;
    const articleTarget=Math.min(settings.maxPerSku*variants.length,Math.ceil((sales7/7)*settings.targetDays*settings.safetyFactor));
    const perVariant=Math.min(settings.maxPerSku,Math.ceil(articleTarget/variants.length));
    variants.forEach(item=>{
      const currentFbs=fbsMap.get(item.barcode)||0, currentFbw=fbwMap.get(item.barcode)||0, inReserve=reserved.get(item.barcode)||0;
      const need=Math.max(0,perVariant-currentFbs-currentFbw-inReserve);
      if(need>0) needs.set(item.barcode,{item,fbs:currentFbs,fbw:currentFbw,sales7,target:perVariant,need});
    });
  });
  if (!boxes.length) return [...needs.values()].map((n,i)=>({
    id:`suggestion-${n.item.barcode}`,groupId:`suggestion-${n.item.barcode}`,source:'auto',barcode:n.item.barcode,article:n.item.article,
    name:n.item.name,size:n.item.size,fbs:n.fbs,fbw:n.fbw,sales7:n.sales7,target:n.target,qty:n.need,palette:'',placement:'',storageCells:'',boxType:'',
    confidence:'warning',reason:'Потребность рассчитана; складская модель не подключена, количество можно изменить перед принятием.',selected:true,
  }));

  const remaining=new Map([...needs].map(([bc,n])=>[bc,n.need]));
  const chosen:PhysicalBox[]=[];
  const pool=boxes.filter(box=>box.components.length>0&&box.components.every(component=>fbsMap.has(component.barcode)));
  while(true){
    let best:PhysicalBox|undefined,bestScore=0,bestExcess=Infinity;
    for(const box of pool){
      const useful=sum(box.components.map(c=>Math.min(remaining.get(c.barcode)||0,c.qty)));
      const excess=sum(box.components.map(c=>Math.max(0,c.qty-(remaining.get(c.barcode)||0))));
      if(useful>bestScore || (useful===bestScore&&useful>0&&excess<bestExcess)){best=box;bestScore=useful;bestExcess=excess;}
    }
    if(!best||bestScore<=0)break;
    chosen.push(best);pool.splice(pool.indexOf(best),1);
    best.components.forEach(c=>remaining.set(c.barcode,Math.max(0,(remaining.get(c.barcode)||0)-c.qty)));
  }
  const meta=new Map(catalog.map(x=>[x.barcode,x]));
  const rows:PlanRow[]=[];
  chosen.forEach(box=>box.components.forEach((c,i)=>{
    const n=needs.get(c.barcode), item=meta.get(c.barcode);
    rows.push({id:`${box.id}-${c.barcode}-${i}`,groupId:box.id,source:'auto',barcode:c.barcode,article:c.article||item?.article||'',name:item?.name||'',size:c.size||item?.size||'',
      fbs:fbsMap.get(c.barcode)||0,fbw:fbwMap.get(c.barcode)||0,sales7:salesMap.get(c.article||item?.article||'')||0,target:n?.target||0,qty:c.qty,
      palette:box.palette,placement:box.placement,storageCells:box.storageCells,boxType:box.type,confidence:n?'ok':'warning',
      reason:n?'Закрывает рассчитанную потребность целой физической коробкой.':'Обязательная позиция внутри выбранной MIX-коробки.',selected:true});
  }));
  remaining.forEach((qty,bc)=>{if(qty<=0)return;const n=needs.get(bc)!;rows.push({id:`unresolved-${bc}`,groupId:`unresolved-${bc}`,source:'auto',barcode:bc,article:n.item.article,name:n.item.name,size:n.item.size,fbs:n.fbs,fbw:n.fbw,sales7:n.sales7,target:n.target,qty,
    palette:'',placement:'',storageCells:'',boxType:'',confidence:'warning',reason:'Подходящая подтверждённая физическая коробка не найдена. Можно исключить или принять вручную.',selected:true});});
  return rows;
}

export function addManualRows(plan:PlanRow[],items:CatalogItem[],fbs:FbsItem[],fbw:FbwItem[],warehouses:string[]){
  const fm=new Map(fbs.map(x=>[x.barcode,x.quantity])), wm=new Map(fbw.map(x=>[x.barcode,sum(warehouses.map(w=>x.warehouses[w]||0))]));
  const next=plan.map(x=>({...x}));
  items.forEach(item=>{
    const hit=next.find(x=>x.barcode===item.barcode&&x.source==='manual');
    if(hit){hit.qty+=1;hit.selected=true;return;}
    next.push({id:`manual-${item.barcode}`,groupId:`manual-${item.barcode}`,source:'manual',barcode:item.barcode,article:item.article,name:item.name,size:item.size,
      fbs:fm.get(item.barcode)||0,fbw:wm.get(item.barcode)||0,sales7:0,target:0,qty:1,palette:'',placement:'',storageCells:'',boxType:'',confidence:'warning',
      reason:'Добавлено пользователем в продажу. Проверьте количество перед принятием.',selected:true});
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


