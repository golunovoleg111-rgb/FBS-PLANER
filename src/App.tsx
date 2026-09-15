import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, Boxes, Check, ChevronRight, CircleHelp, Cloud, Download, FileSpreadsheet, LayoutDashboard, PackagePlus, Play, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Upload, Warehouse, X } from 'lucide-react';
import { addManualRows, buildPlan, removePlanRow } from './planner';
import { catalogFromReports, parseCatalog, parseFbs, parseFbw, parseSales } from './parsers';
import { authorizeGoogle, fetchPhysicalBoxes, uploadDriveFile } from './google';
import type { AcceptedRequest, CatalogItem, FbsItem, FbwItem, PhysicalBox, PlanRow, PlannerSettings, SalesItem, WarehouseIssue, WarehouseIssueCode } from './types';
import './styles.css';
import './errors.css';

type Tab = 'reports' | 'planning' | 'new' | 'errors' | 'requests' | 'settings';
type ReportCardProps = { title: string; hint: string; icon: React.ReactNode; fileName?: string; count?: number; accept?: string; onFile: (file: File) => void };
const DEFAULT_SHEET = '1xzmsRY0EJ8xUCMO925pe2lJJOYjqAQdjcTYx-Sl2Yus';
const LEGACY_FOLDER = '12NUdzjgOj8lyyV98h1wmcIm44UTQRDNQ';
const DEFAULT_FOLDER = '1kiIXuxeSrRXikELKB9i5D1tJdPy6UrAq';
const DEFAULT_GOOGLE_CLIENT_ID = '215049650209-ekrrdop4ecn8qkhr31fad0020b3nng57.apps.googleusercontent.com';
const ISSUE_FILTERS: Array<{ id: 'all' | WarehouseIssueCode; label: string; hint: string }> = [
  { id: 'all', label: 'Все', hint: 'Все коробки с замечаниями' },
  { id: 'status', label: 'Статус сверки', hint: 'Хранение и расстановка не подтверждены автоматически' },
  { id: 'volume', label: 'Физический объём', hint: 'Нет автодопуска или превышен защищённый лимит' },
  { id: 'placement', label: 'Расстановка', hint: 'Не найдена подтверждённая ячейка' },
  { id: 'composition', label: 'Состав', hint: 'Нет строк состава из Хранения' },
  { id: 'quantity', label: 'Количество', hint: 'Итог коробки расходится с суммой состава' },
  { id: 'identity', label: 'BOX_ID', hint: 'Не определена граница физической коробки' },
];

function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial; } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* local mode still works */ } }, [key, value]);
  return [value, setValue] as const;
}

function ReportCard({ title, hint, icon, fileName, count, accept='.xlsx,.xls', onFile }: ReportCardProps) {
  const ref = useRef<HTMLInputElement>(null);
  return <button className={`report-card ${fileName ? 'loaded' : ''}`} onClick={() => ref.current?.click()}>
    <input ref={ref} hidden type="file" accept={accept} onChange={e => { const f=e.target.files?.[0]; if(f) onFile(f); e.currentTarget.value=''; }} />
    <span className="report-icon">{fileName ? <Check size={21}/> : icon}</span>
    <span className="report-copy"><strong>{title}</strong><small>{fileName ? `${fileName}${count !== undefined ? ` · ${count.toLocaleString('ru-RU')} строк` : ''}` : hint}</small></span>
    <span className="report-action">{fileName ? 'Заменить' : 'Выбрать файл'} <ChevronRight size={15}/></span>
  </button>;
}

function Metric({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function App() {
  const [tab,setTab]=useState<Tab>('reports');
  const [fbs,setFbs]=useStored<FbsItem[]>('fbs:data',[]); const [sales,setSales]=useStored<SalesItem[]>('sales:data',[]); const [fbw,setFbw]=useStored<FbwItem[]>('fbw:data',[]);
  const [catalog,setCatalog]=useStored<CatalogItem[]>('catalog:data',[]); const [warehouses,setWarehouses]=useStored<string[]>('fbw:warehouses',[]); const [included,setIncluded]=useStored<string[]>('fbw:included',[]);
  const [names,setNames]=useStored<Record<string,string>>('reports:names',{}); const [requests,setRequests]=useStored<AcceptedRequest[]>('requests:data',[]);
  const [settings,setSettings]=useStored('app:settings',{ clientId:DEFAULT_GOOGLE_CLIENT_ID, spreadsheetId:DEFAULT_SHEET, folderId:DEFAULT_FOLDER, targetDays:14, safetyFactor:1.15, minOrders:1, maxPerSku:50 });
  const [boxes,setBoxes]=useState<PhysicalBox[]>([]); const [boxIssues,setBoxIssues]=useState<WarehouseIssue[]>([]); const [confirmedBoxKeys,setConfirmedBoxKeys]=useStored<string[]>('warehouse:confirmed-boxes',[]);
  const [token,setToken]=useState(''); const [plan,setPlan]=useState<PlanRow[]>([]);
  const [busy,setBusy]=useState(''); const [notice,setNotice]=useState<{kind:'ok'|'error';text:string}|null>(null); const [tutorial,setTutorial]=useState(false);
  const [query,setQuery]=useState(''); const [pickedArticle,setPickedArticle]=useState(''); const [pickedSizes,setPickedSizes]=useState<string[]>([]); const [allSizes,setAllSizes]=useState(true);
  const [issueFilter,setIssueFilter]=useState<'all' | WarehouseIssueCode>('all');

  useEffect(() => {
    if (!settings.clientId || settings.folderId === LEGACY_FOLDER) {
      setSettings(current => ({
        ...current,
        clientId: current.clientId || DEFAULT_GOOGLE_CLIENT_ID,
        folderId: current.folderId === LEGACY_FOLDER ? DEFAULT_FOLDER : current.folderId,
      }));
    }
  }, [settings.clientId, settings.folderId, setSettings]);

  const mergedCatalog=useMemo(()=>{
    const source=catalog.length?catalog:catalogFromReports(fbs,fbw); const map=new Map<string,CatalogItem>();
    source.forEach(x=>map.set(`${x.article}|${x.size}|${x.barcode}`,x)); return [...map.values()];
  },[catalog,fbs,fbw]);
  const reportReady=!!fbs.length&&!!sales.length&&!!fbw.length;
  const approvedIssueBoxes=useMemo(()=>boxIssues.filter(issue=>issue.confirmable&&confirmedBoxKeys.includes(issue.key)).map(issue=>issue.box),[boxIssues,confirmedBoxKeys]);
  const availableBoxes=useMemo(()=>[...boxes,...approvedIssueBoxes],[boxes,approvedIssueBoxes]);
  const unresolvedIssues=boxIssues.filter(issue=>!confirmedBoxKeys.includes(issue.key));
  const issueCounts=useMemo(()=>Object.fromEntries(ISSUE_FILTERS.map(filter=>[
    filter.id,
    filter.id==='all' ? boxIssues.length : boxIssues.filter(issue=>issue.codes.includes(filter.id as WarehouseIssueCode)).length,
  ])) as Record<'all' | WarehouseIssueCode,number>,[boxIssues]);
  const visibleIssues=issueFilter==='all'?boxIssues:boxIssues.filter(issue=>issue.codes.includes(issueFilter));
  const selectedRows=plan.filter(x=>x.selected&&x.qty>0); const units=selectedRows.reduce((n,x)=>n+x.qty,0);
  const groups=new Set(selectedRows.map(x=>x.groupId)).size; const warnings=selectedRows.filter(x=>x.confidence==='warning').length;
  const articleResults=useMemo(()=>{
    const q=query.trim().toLowerCase(); if(q.length<2)return [];
    const by=new Map<string,CatalogItem[]>(); mergedCatalog.filter(x=>`${x.article} ${x.name} ${x.color}`.toLowerCase().includes(q)).forEach(x=>by.set(x.article,[...(by.get(x.article)||[]),x]));
    return [...by.entries()].slice(0,12);
  },[query,mergedCatalog]);
  const currentVariants=useMemo(()=>mergedCatalog.filter(x=>x.article===pickedArticle).sort((a,b)=>a.size.localeCompare(b.size,'ru',{numeric:true})),[mergedCatalog,pickedArticle]);

  function alert(kind:'ok'|'error',text:string){setNotice({kind,text});window.setTimeout(()=>setNotice(null),6000);}
  async function upload(kind:'fbs'|'sales'|'fbw'|'catalog',file:File){
    setBusy(kind); try { const buf=await file.arrayBuffer();
      if(kind==='fbs'){const data=parseFbs(buf);setFbs(data);setNames(n=>({...n,fbs:file.name}));}
      if(kind==='sales'){const data=parseSales(buf);setSales(data);setNames(n=>({...n,sales:file.name}));}
      if(kind==='fbw'){const data=parseFbw(buf);setFbw(data.items);setWarehouses(data.warehouses);setIncluded(data.warehouses);setNames(n=>({...n,fbw:file.name}));}
      if(kind==='catalog'){const data=parseCatalog(buf);setCatalog(data);setNames(n=>({...n,catalog:file.name}));}
      alert('ok',`Файл «${file.name}» прочитан.`);
    } catch(e){alert('error',e instanceof Error?e.message:'Не удалось прочитать файл.');} finally{setBusy('');}
  }
  async function connect(loadBoxes=true){
    setBusy('google'); try { const t=await authorizeGoogle(settings.clientId); setToken(t);
      if(loadBoxes){const data=await fetchPhysicalBoxes(t,settings.spreadsheetId);setBoxes(data.boxes);setBoxIssues(data.issues);alert('ok',`Google подключён: готово ${data.boxes.length} коробок, требуют внимания ${data.issues.length}.`);}else alert('ok','Google Drive подключён.');
      return t;
    } catch(e){alert('error',e instanceof Error?e.message:'Не удалось подключить Google.'); throw e;} finally{setBusy('');}
  }
  async function calculate(){
    if(!reportReady){alert('error','Сначала загрузите три отчёта WB.');setTab('reports');return;}
    let currentBoxes=availableBoxes;
    if(!boxes.length&&!boxIssues.length){
      if(!settings.clientId){alert('error','Для планирования по коробкам укажите OAuth Client ID и подключите Google.');setTab('settings');return;}
      setBusy('planning');
      try {
        const t=token||await authorizeGoogle(settings.clientId); setToken(t);
        const data=await fetchPhysicalBoxes(t,settings.spreadsheetId); setBoxes(data.boxes); setBoxIssues(data.issues);
        currentBoxes=[...data.boxes,...data.issues.filter(issue=>issue.confirmable&&confirmedBoxKeys.includes(issue.key)).map(issue=>issue.box)];
      } catch(e) {
        alert('error',e instanceof Error?e.message:'Не удалось загрузить физические коробки.');
        return;
      } finally { setBusy(''); }
    }
    const plannerSettings:PlannerSettings={targetDays:settings.targetDays,safetyFactor:settings.safetyFactor,minOrders:settings.minOrders,maxPerSku:settings.maxPerSku};
    const nextPlan=buildPlan({fbs,sales,fbw,catalog:mergedCatalog,includedWarehouses:included,boxes:currentBoxes,accepted:requests,settings:plannerSettings});
    const physicalBoxes=new Set(nextPlan.filter(row=>!row.groupId.startsWith('unresolved-')&&!row.groupId.startsWith('suggestion-')).map(row=>row.groupId)).size;
    const plannedUnits=nextPlan.reduce((total,row)=>total+row.qty,0);
    setPlan(nextPlan);setTab('planning');
    alert('ok',nextPlan.length
      ? `Черновик: ${plannedUnits} шт. из ${physicalBoxes} коробок. Автоплан использует только позиции актуального FBS.`
      : 'По позициям актуального FBS пополнение сейчас не требуется.');
  }
  function toggleRow(id:string){setPlan(rows=>{const row=rows.find(x=>x.id===id);if(!row)return rows;const selected=!row.selected;return rows.map(x=>x.groupId===row.groupId?{...x,selected}:x);});}
  function changeQty(id:string,value:number){setPlan(rows=>rows.map(x=>x.id===id?{...x,qty:Math.max(0,Math.round(value)||0)}:x));}
  function removeRow(id:string){setPlan(rows=>removePlanRow(rows,id));}
  function resetPlan(){setPlan([]);setTab('reports');alert('ok','Черновик сброшен. Загруженные отчёты сохранены.');}
  function toggleBoxConfirmation(key:string){setConfirmedBoxKeys(keys=>keys.includes(key)?keys.filter(item=>item!==key):[...keys,key]);}
  async function acceptPlan(){
    if(!selectedRows.length){alert('error','Выберите хотя бы одну строку.');return;} setBusy('accept');
    try{
      const { downloadBlob, requestPdf, requestXlsx } = await import('./exporters');
      const now=new Date(); const dateLabel=`${String(now.getDate()).padStart(2,'0')}.${String(now.getMonth()+1).padStart(2,'0')}`; const xlsx=requestXlsx(selectedRows); const pdf=await requestPdf(selectedRows);
      const xlsxName=`Заявка от ${dateLabel}.xlsx`,pdfName=`Заявка от ${dateLabel}.pdf`; let files:AcceptedRequest['files'];
      if(settings.clientId&&settings.folderId){const t=token||await connect(false);const [x,p]=await Promise.all([uploadDriveFile(t,settings.folderId,xlsxName,xlsx.type,xlsx),uploadDriveFile(t,settings.folderId,pdfName,'application/pdf',pdf)]);files={xlsx:x.webViewLink,pdf:p.webViewLink};}
      else {downloadBlob(xlsx,xlsxName);downloadBlob(pdf,pdfName);files={};}
      const request:AcceptedRequest={id:`REQ-${now.getTime()}`,acceptedAt:now.toISOString(),status:'Принята',rows:selectedRows,includedWarehouses:included,files};
      setRequests(old=>[request,...old]);setPlan([]);setTab('requests');alert('ok',settings.clientId?'Заявка принята, XLSX и PDF сохранены на Google Drive.':'Заявка принята, XLSX и PDF скачаны на компьютер.');
    }catch(e){alert('error',e instanceof Error?e.message:'Не удалось сформировать заявку.');}finally{setBusy('');}
  }
  function chooseArticle(article:string){setPickedArticle(article);setQuery(article);setAllSizes(true);setPickedSizes([]);}
  function addNovelty(standalone=false){
    const items=currentVariants.filter(x=>allSizes||pickedSizes.includes(x.size)); if(!items.length){alert('error','Выберите все размеры или хотя бы один размер.');return;}
    const next=addManualRows(standalone?[]:plan,items,fbs,fbw,included);setPlan(next);setTab('planning');alert('ok',`${items.length} позиций добавлено в черновик. Количество можно изменить.`);
  }
  function updateRequest(id:string,status:AcceptedRequest['status']){setRequests(xs=>xs.map(x=>x.id===id?{...x,status}:x));}

  const nav=[['reports','Отчёты',FileSpreadsheet],['planning','Планирование',LayoutDashboard],['new','Добавить в продажу',PackagePlus],['errors','Ошибки склада',AlertTriangle],['requests','Заявки',Archive],['settings','Настройки',Settings]] as const;
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span>BF</span><div><b>FBS Planner</b><small>Планирование поставок</small></div></div>
      <nav>{nav.map(([id,label,Icon])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon size={19}/><span>{label}</span>{id==='errors'&&unresolvedIssues.length>0&&<em className="error-badge">{unresolvedIssues.length}</em>}{id==='requests'&&requests.filter(x=>x.status==='Принята').length>0&&<em>{requests.filter(x=>x.status==='Принята').length}</em>}</button>)}</nav>
      <div className="side-bottom"><button onClick={()=>setTutorial(true)}><CircleHelp size={19}/> Как работать</button><div className="privacy"><ShieldCheck size={18}/><span>Отчёты обрабатываются<br/>в этом браузере</span></div></div>
    </aside>
    <main>
      <header><div><span className="eyebrow">BELTANEE · FBS</span><h1>{nav.find(x=>x[0]===tab)?.[1]}</h1></div><div className="header-actions"><span className={`connection ${token?'on':''}`}><i/>{token?'Google подключён':'Локальный режим'}</span><button className="ghost" onClick={()=>setTutorial(true)}><CircleHelp size={17}/> Инструкция</button></div></header>
      {tab==='reports'&&<section className="page reports-page">
        <div className="section-title"><div><h2>Загрузите три свежих отчёта WB</h2><p>Файлы читаются в исходном формате. Предыдущие данные на этом компьютере заменятся.</p></div><span className="step">Шаг 1 из 2</span></div>
        <div className="report-list">
          <ReportCard title="Актуальный остаток FBS" hint="Отчёт «Остатки» с баркодами и количеством" icon={<Boxes size={21}/>} fileName={names.fbs} count={fbs.length} onFile={f=>upload('fbs',f)}/>
          <ReportCard title="Продажи за 7 дней" hint="Отчёт с заказанными и выкупленными товарами" icon={<FileSpreadsheet size={21}/>} fileName={names.sales} count={sales.length} onFile={f=>upload('sales',f)}/>
          <ReportCard title="Остатки на складах WB (FBW)" hint="Отчёт «Склады WB» — список складов появится ниже" icon={<Warehouse size={21}/>} fileName={names.fbw} count={fbw.length} onFile={f=>upload('fbw',f)}/>
        </div>
        {!!warehouses.length&&<div className="warehouse-card"><div className="warehouse-head"><div><h3>Какие склады WB учитывать</h3><p>Снимите галочку со склада, который не должен уменьшать потребность FBS.</p></div><div><button className="link" onClick={()=>setIncluded(warehouses)}>Выбрать все</button><button className="link" onClick={()=>setIncluded([])}>Снять все</button></div></div><div className="warehouse-grid">{warehouses.map(w=><label key={w} className={included.includes(w)?'checked':''}><input type="checkbox" checked={included.includes(w)} onChange={()=>setIncluded(x=>x.includes(w)?x.filter(v=>v!==w):[...x,w])}/><span className="boxcheck"><Check size={13}/></span><span>{w}</span><b>{fbw.reduce((n,x)=>n+(x.warehouses[w]||0),0).toLocaleString('ru-RU')}</b></label>)}</div><div className="warehouse-total"><span>Учитываем {included.length} из {warehouses.length} складов</span><strong>{fbw.reduce((n,x)=>n+included.reduce((m,w)=>m+(x.warehouses[w]||0),0),0).toLocaleString('ru-RU')} шт. на FBW</strong></div></div>}
        <div className="next-panel"><div><b>{reportReady?'Отчёты готовы к расчёту':'Загрузите недостающие отчёты'}</b><span>{reportReady?'При запуске система загрузит актуальные физические коробки из Google Sheets.':'Для точного расчёта нужны все три файла.'}</span></div><button className="primary" disabled={!reportReady||!!busy} onClick={calculate}><Play size={18}/>{busy==='planning'?'Загружаем коробки…':'Запустить планирование'}</button></div>
      </section>}
      {tab==='planning'&&<section className="page planning-page">
        <div className="section-title"><div><h2>Предпросмотр заявки</h2><p>Отключите ненужные строки и исправьте количество. Предупреждения не блокируют принятие.</p></div><div className="row-actions"><button className="secondary reset-button" disabled={!plan.length||!!busy} onClick={resetPlan}><RotateCcw size={17}/> Сбросить</button><button className="secondary" disabled={!!busy} onClick={calculate}><RefreshCw size={17}/> Пересчитать</button><button className="primary" disabled={!selectedRows.length||!!busy} onClick={acceptPlan}><Check size={18}/>{busy==='accept'?'Формируем…':'Принять и создать файлы'}</button></div></div>
        <div className="plan-scope-note"><ShieldCheck size={18}/><span><b>Автопополнение — только текущий ассортимент FBS.</b> Позиции, которых нет в загруженном остатке FBS, добавляются через раздел «Добавить в продажу».</span></div>
        <div className="metrics"><Metric label="Выбрано" value={`${units} шт.`} note={`${selectedRows.length} строк`}/><Metric label="Коробки и группы" value={groups} note="границы BOX_ID сохранены"/><Metric label="Требуют внимания" value={warnings} note="можно принять своим решением"/><Metric label="Склады FBW" value={included.length} note="учтены в потребности"/></div>
        {!plan.length?<div className="empty"><LayoutDashboard size={34}/><h3>Черновик пока пуст</h3><p>Загрузите отчёты и запустите расчёт или добавьте новые позиции в продажу.</p><button className="primary" onClick={()=>setTab('reports')}>Перейти к отчётам</button></div>:<div className="table-card"><div className="table-note"><ShieldCheck size={18}/><span><b>«Принять» — ваше окончательное решение.</b> Дополнительная проверка 15 коробок и повторный пересчёт не требуются.</span></div><div className="table-scroll"><table><thead><tr><th className="checkcol"></th><th>Коробка / место</th><th>Позиция</th><th>Размер</th><th>FBS</th><th>FBW</th><th>Продажи</th><th>В заявку</th><th>Статус</th><th className="removecol"></th></tr></thead><tbody>{plan.map((row,i)=>{const first=i===0||plan[i-1].groupId!==row.groupId;const removesBox=row.source==='auto'&&!row.groupId.startsWith('unresolved-')&&!row.groupId.startsWith('suggestion-');return <tr key={row.id} className={`${row.selected?'':'off'} ${first?'group-start':''}`}><td><label className="tiny-check"><input type="checkbox" checked={row.selected} onChange={()=>toggleRow(row.id)}/><span><Check size={12}/></span></label></td><td>{first&&<div className="box-id"><b>{row.groupId.startsWith('manual-')?'Новинка':row.groupId.startsWith('unresolved-')||row.groupId.startsWith('suggestion-')?'Без коробки':row.groupId}</b><small>{[row.palette,row.placement,row.storageCells].filter(Boolean).join(' · ')||'Количество задаётся вручную'}</small></div>}</td><td><b>{row.article}</b><small>{row.name||row.barcode}</small></td><td>{row.size||'—'}</td><td>{row.fbs}</td><td>{row.fbw}</td><td>{row.sales7}</td><td><input className="qty" type="number" min="0" value={row.qty} disabled={row.source==='auto'&&!row.groupId.startsWith('unresolved-')&&!row.groupId.startsWith('suggestion-')} onChange={e=>changeQty(row.id,Number(e.target.value))}/></td><td><span className={`status ${row.confidence}`} title={row.reason}>{row.confidence==='ok'?'Готово':'Проверить'}</span></td><td><button className="remove-row" title={removesBox?'Убрать всю коробку':'Убрать позицию'} onClick={()=>removeRow(row.id)}><X size={15}/></button></td></tr>})}</tbody></table></div><div className="accept-bar"><span>Будет создано: <b>XLSX + PDF</b>{settings.clientId?' · сохранение на Google Drive':' · скачивание на компьютер'}</span><button className="primary" disabled={!selectedRows.length||!!busy} onClick={acceptPlan}><Check size={18}/> Принять {units} шт.</button></div></div>}
      </section>}
      {tab==='new'&&<section className="page new-page"><div className="section-title"><div><h2>Добавить новые позиции в продажу</h2><p>Найдите артикул и выберите все или отдельные размеры. Номенклатура хранится только на этом компьютере.</p></div></div>
        <div className="catalog-upload"><div><PackagePlus size={22}/><span><b>{catalog.length?`${catalog.length.toLocaleString('ru-RU')} позиций загружено`:'Загрузите номенклатуру WB один раз'}</b><small>{names.catalog||'XLSX с артикулами, баркодами и размерами'}</small></span></div><label className="secondary"><Upload size={17}/>{catalog.length?'Обновить':'Загрузить'}<input hidden type="file" accept=".xlsx,.xls" onChange={e=>{const f=e.target.files?.[0];if(f)upload('catalog',f);e.currentTarget.value='';}}/></label></div>
        <div className="search-layout"><div className="search-panel"><label className="searchbox"><Search size={19}/><input value={query} onChange={e=>{setQuery(e.target.value);setPickedArticle('');}} placeholder="21_ К _ Вельвет _ голубой"/></label><div className="results">{query.length<2?<p>Введите хотя бы два символа артикула, названия или цвета.</p>:articleResults.length?articleResults.map(([a,items])=><button key={a} className={pickedArticle===a?'active':''} onClick={()=>chooseArticle(a)}><span><b>{a}</b><small>{items[0].name||items[0].color||'Номенклатура WB'} · {items.length} размеров</small></span><ChevronRight size={18}/></button>):<p>Совпадений не найдено.</p>}</div></div>
          <div className="size-panel">{!pickedArticle?<div className="empty mini"><Search size={28}/><h3>Выберите артикул</h3><p>Справа появятся доступные размеры и остатки.</p></div>:<><span className="eyebrow">ВЫБРАННЫЙ АРТИКУЛ</span><h3>{pickedArticle}</h3><label className={`size-choice all ${allSizes?'selected':''}`}><input type="checkbox" checked={allSizes} onChange={e=>setAllSizes(e.target.checked)}/><span className="boxcheck"><Check size={13}/></span><b>Искать все размеры</b><small>{currentVariants.length} вариантов</small></label><div className="sizes">{currentVariants.map(v=><label key={`${v.barcode}-${v.size}`} className={`size-choice ${!allSizes&&pickedSizes.includes(v.size)?'selected':''}`}><input type="checkbox" disabled={allSizes} checked={allSizes||pickedSizes.includes(v.size)} onChange={()=>setPickedSizes(x=>x.includes(v.size)?x.filter(s=>s!==v.size):[...x,v.size])}/><span className="boxcheck"><Check size={13}/></span><b>{v.size}</b><small>FBS {fbs.find(x=>x.barcode===v.barcode)?.quantity||0} · FBW {fbw.find(x=>x.barcode===v.barcode)?included.reduce((n,w)=>n+(fbw.find(x=>x.barcode===v.barcode)!.warehouses[w]||0),0):0}</small></label>)}</div><div className="novelty-actions"><button className="secondary" onClick={()=>addNovelty(true)}>Создать отдельный черновик</button><button className="primary" onClick={()=>addNovelty(false)}>Добавить в текущий</button></div></>}</div></div>
      </section>}
      {tab==='errors'&&<section className="page errors-page">
        <div className="section-title"><div><h2>Ошибки склада</h2><p>Каждое число здесь означает количество физических коробок, а не изделий.</p></div><button className="secondary" disabled={busy==='google'} onClick={()=>void connect().catch(()=>{})}><RefreshCw size={17}/>{busy==='google'?'Обновляем…':'Обновить из Google'}</button></div>
        {!token&&!boxIssues.length?<div className="empty"><AlertTriangle size={34}/><h3>Данные склада ещё не загружены</h3><p>Подключите Google, чтобы проверить BOX_ID, состав, количество, статус и место хранения.</p><button className="primary" onClick={()=>void connect().catch(()=>{})}><Cloud size={17}/> Подключить Google</button></div>:!boxIssues.length?<div className="empty warehouse-ok"><ShieldCheck size={34}/><h3>Ошибок склада не найдено</h3><p>{boxes.length} коробок готовы к автоматическому планированию.</p></div>:<>
          <div className="issue-explainer"><AlertTriangle size={22}/><div><b>{unresolvedIssues.length.toLocaleString('ru-RU')} коробок временно не участвуют в автоплане</b><span>Нажмите категорию ниже, чтобы увидеть причину. Коробку с доступной кнопкой можно проверить физически и разрешить вручную.</span></div></div>
          <div className="error-summary"><Metric label="Готовы автоматически" value={boxes.length} note="все проверки пройдены"/><Metric label="Требуют проверки" value={unresolvedIssues.length} note="не участвуют в расчёте"/><Metric label="Разрешены вручную" value={approvedIssueBoxes.length} note="участвуют после пересчёта"/></div>
          <div className="issue-filters">{ISSUE_FILTERS.filter(filter=>filter.id==='all'||issueCounts[filter.id]>0).map(filter=><button key={filter.id} className={issueFilter===filter.id?'active':''} onClick={()=>setIssueFilter(filter.id)} title={filter.hint}><span>{filter.label}</span><b>{issueCounts[filter.id].toLocaleString('ru-RU')}</b><small>{filter.hint}</small></button>)}</div>
          <div className="warehouse-issues">{visibleIssues.map(issue=>{const approved=confirmedBoxKeys.includes(issue.key);return <article key={issue.key} className={approved?'approved':''}><div className="issue-head"><div><span className={`status ${approved?'ok':'warning'}`}>{approved?'Разрешена вручную':'Нужна проверка'}</span><h3>{issue.box.id||'Коробка без BOX_ID'}</h3><p>{[issue.box.type,issue.box.palette,issue.box.placement,issue.box.storageCells].filter(Boolean).join(' · ')||'Место не указано'} · {issue.box.totalQty} шт.</p></div><button className={approved?'secondary':'primary'} disabled={!issue.confirmable} onClick={()=>toggleBoxConfirmation(issue.key)}>{approved?<><RotateCcw size={16}/> Отменить разрешение</>:<><Check size={16}/> Подтвердить и использовать</>}</button></div><ul>{issue.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>{issue.box.volumeDetail&&<p className="volume-detail"><b>Детали проверки объёма:</b> {issue.box.volumeDetail}</p>}<details><summary>Показать состав — {issue.box.components.length} позиций</summary><div className="issue-components">{issue.box.components.map((component,index)=><div key={`${component.barcode}-${index}`}><span><b>{component.article||component.barcode}</b><small>{component.barcode} · размер {component.size||'—'}</small></span><strong>{component.qty} шт.</strong></div>)}</div></details>{!issue.confirmable&&<p className="cannot-confirm">{issue.blockingReason||'Коробку нельзя разрешить до исправления обязательных данных.'}</p>}</article>})}</div>
        </>}
      </section>}
      {tab==='requests'&&<section className="page requests-page"><div className="section-title"><div><h2>История принятых заявок</h2><p>Активные заявки уменьшают повторную потребность. Завершите или отмените их после обработки.</p></div></div>{!requests.length?<div className="empty"><Archive size={34}/><h3>Принятых заявок пока нет</h3><p>Черновые расчёты сюда не попадают.</p></div>:<div className="request-list">{requests.map(r=><article key={r.id}><div className="request-main"><span className={`request-status ${r.status}`}>{r.status}</span><div><h3>{r.id}</h3><p>{new Date(r.acceptedAt).toLocaleString('ru-RU')} · {r.rows.reduce((n,x)=>n+x.qty,0)} шт. · {new Set(r.rows.map(x=>x.groupId)).size} групп</p></div></div><div className="request-actions">{r.files?.xlsx&&<a className="ghost" href={r.files.xlsx} target="_blank"><Cloud size={16}/> XLSX</a>}{r.files?.pdf&&<a className="ghost" href={r.files.pdf} target="_blank"><Download size={16}/> PDF</a>}{r.status==='Принята'&&<><button className="secondary" onClick={()=>updateRequest(r.id,'Отменена')}>Отменить</button><button className="primary small" onClick={()=>updateRequest(r.id,'Выполнена')}>Завершить</button></>}</div></article>)}</div>}</section>}
      {tab==='settings'&&<section className="page settings-page"><div className="section-title"><div><h2>Google и правила расчёта</h2><p>Настройки сохраняются только в браузере этого рабочего компьютера.</p></div></div><div className="settings-grid"><div className="settings-card"><h3><Cloud size={20}/> Google Sheets и Drive</h3><p className="fine">Google уже настроен для сайта. Сотруднику достаточно нажать кнопку ниже и выбрать свой аккаунт.</p><label>ID таблицы хранения<input value={settings.spreadsheetId} onChange={e=>setSettings(s=>({...s,spreadsheetId:e.target.value}))}/></label><label>ID папки Google Drive<input value={settings.folderId} onChange={e=>setSettings(s=>({...s,folderId:e.target.value}))}/></label><button className="primary" disabled={busy==='google'} onClick={()=>void connect().catch(()=>{})}><Cloud size={17}/>{busy==='google'?'Подключаем…':'Войти в Google и загрузить коробки'}</button><p className="fine">Сайт читает BOX_ID из таблицы и сохраняет «Заявка от ДД.ММ.xlsx» и PDF в указанную папку. Токен хранится только в памяти вкладки.</p></div><div className="settings-card"><h3><Settings size={20}/> Потребность FBS</h3><label>Запас на сколько дней<input type="number" min="1" value={settings.targetDays} onChange={e=>setSettings(s=>({...s,targetDays:Number(e.target.value)}))}/></label><label>Коэффициент страхового запаса<input type="number" min="1" step="0.05" value={settings.safetyFactor} onChange={e=>setSettings(s=>({...s,safetyFactor:Number(e.target.value)}))}/></label><label>Минимум заказов за 7 дней<input type="number" min="0" value={settings.minOrders} onChange={e=>setSettings(s=>({...s,minOrders:Number(e.target.value)}))}/></label><label>Максимум на размер<input type="number" min="1" value={settings.maxPerSku} onChange={e=>setSettings(s=>({...s,maxPerSku:Number(e.target.value)}))}/></label><p className="fine">Отчёт продаж WB не содержит размеры. Потребность артикула распределяется между его доступными размерами.</p></div></div></section>}
    </main>
    {notice&&<div className={`toast ${notice.kind}`}>{notice.kind==='ok'?<Check size={18}/>:<X size={18}/>}<span>{notice.text}</span></div>}
    {tutorial&&<div className="modal-back" onMouseDown={()=>setTutorial(false)}><div className="tutorial" onMouseDown={e=>e.stopPropagation()}><button className="modal-x" onClick={()=>setTutorial(false)}><X/></button><span className="eyebrow">БЫСТРАЯ ИНСТРУКЦИЯ</span><h2>От отчётов до заявки — 5 шагов</h2><ol><li><b>Подключите Google.</b><span>Нажмите «Войти в Google» и выберите рабочий аккаунт — Client ID уже настроен на сайте.</span></li><li><b>Загрузите три отчёта и выберите склады FBW.</b><span>FBS, продажи за 7 дней и остатки FBW; ненужные склады отключите галочками.</span></li><li><b>Нажмите «Запустить планирование».</b><span>Система обновит BOX_ID. Черновик можно пересчитывать сколько угодно — он ничего не резервирует.</span></li><li><b>Проверьте таблицу.</b><span>Уберите ненужные коробки и строки. Предупреждение лишь просит внимания.</span></li><li><b>Нажмите «Принять».</b><span>XLSX и PDF с датой сохранятся в настроенную папку Google Drive.</span></li></ol><div className="tutorial-callout">Новинки добавляются отдельно: найдите артикул, выберите «Все размеры» или конкретные размеры и добавьте их в черновик.</div><button className="primary full" onClick={()=>setTutorial(false)}>Понятно, начать работу</button></div></div>}
  </div>;
}

export default App;



