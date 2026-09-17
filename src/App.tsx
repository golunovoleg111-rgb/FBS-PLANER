import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Boxes, Check, Cloud, Download, FileSpreadsheet, Filter, LayoutDashboard, Play, Search, Settings, Upload, Warehouse, X } from 'lucide-react';
import { buildPlan, removePhysicalBox } from './planner';
import { catalogFromReports, parseCatalog, parseFbs, parseFbw, parseSales } from './parsers';
import { authorizeGoogle, fetchSourceWarehouses, uploadDriveFile } from './google';
import { pickingFromPlan, parsePickingWorkbook, type PickingResult } from './converter';
import { downloadBlob, pickingPdf, requestPdf, requestXlsx } from './exporters';
import { audit, exportState, importState, loadSnapshot, saveSnapshot } from './persistence';
import type { AcceptedRequest, AppSnapshot, CatalogItem, PlanResult, PlannerSettings } from './types';
import './styles.css';

type Tab = 'reports' | 'filter' | 'planning' | 'warehouse' | 'requests' | 'picking' | 'audit' | 'settings';
const CLIENT_ID = '215049650209-ekrrdop4ecn8qkhr31fad0020b3nng57.apps.googleusercontent.com';
const FOLDER_ID = '1kiIXuxeSrRXikELKB9i5D1tJdPy6UrAq';
const EMPTY_RESULT: PlanResult = { rows: [], unfilled: [], risks: [], pendingMixBoxIds: [], stats: { eligibleSku: 0, selectedSku: 0, candidateBoxes: 0, selectedBoxes: 0, selectedUnits: 0, elapsedMs: 0 } };
const DEFAULT_SETTINGS: PlannerSettings = { targetDays: 7, safetyDays: 2, maxAfterDays: 14, minOrders: 1, maxPerSku: 40, boxType: 'ANY', maxBoxes: null, maxUnits: null, fbwMode: 'SELECTED', includedWarehouses: [] };
const emptySnapshot = (): AppSnapshot => ({ version: 3, savedAt: new Date().toISOString(), fbs: [], salesCurrent: [], salesPrevious: [], fbw: [], catalog: [], boxes: [], issues: [], requests: [], audit: [], settings: DEFAULT_SETTINGS, selectedSku: [], approvedMix: [], removedBoxes: [], connection: { clientId: CLIENT_ID, folderId: FOLDER_ID } });

function FileCard({ title, text, value, accept = '.xlsx,.xls', onFile }: { title: string; text: string; value?: string; accept?: string; onFile(file: File): void }) {
  return <label className="file-card"><FileSpreadsheet/><b>{title}</b><span>{value || text}</span><input hidden type="file" accept={accept} onChange={e => { const file = e.target.files?.[0]; if (file) onFile(file); e.currentTarget.value = ''; }}/><em>{value ? 'Заменить' : 'Загрузить'}</em></label>;
}

function App() {
  const [state, setState] = useState<AppSnapshot>(emptySnapshot);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('reports');
  const [plan, setPlan] = useState<PlanResult>(EMPTY_RESULT);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [skuQuery, setSkuQuery] = useState('');
  const [boxQuery, setBoxQuery] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('Все');
  const [picking, setPicking] = useState<PickingResult | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadSnapshot().then(saved => { if (saved) setState({ ...emptySnapshot(), ...saved }); }).catch(() => {}).finally(() => setReady(true)); }, []);
  useEffect(() => { if (!ready) return; const timer = window.setTimeout(() => void saveSnapshot({ ...state, savedAt: new Date().toISOString() }), 250); return () => window.clearTimeout(timer); }, [state, ready]);
  const log = (action: string, details: string) => setState(old => ({ ...old, audit: [...old.audit, audit(action, details)] }));
  const message = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(''), 3500); };
  const catalog = useMemo(() => { const map = new Map(state.catalog.map(x => [x.barcode, x])); catalogFromReports(state.fbs, state.fbw).forEach(x => map.set(x.barcode, { ...x, ...map.get(x.barcode) })); return [...map.values()]; }, [state.catalog, state.fbs, state.fbw]);
  const selectedSku = useMemo(() => new Set(state.selectedSku), [state.selectedSku]);
  const frozenBoxes = useMemo(() => new Set(state.requests.filter(x => x.status === 'Заморозка').flatMap(x => x.rows.map(row => row.groupId))), [state.requests]);
  const selectedPlanBoxes = useMemo(() => new Set(plan.rows.map(row => row.groupId)), [plan.rows]);

  async function loadReport(kind: 'fbs' | 'current' | 'previous' | 'fbw' | 'catalog', file: File) {
    setBusy(kind);
    try {
      const data = await file.arrayBuffer();
      if (kind === 'fbs') { const value = parseFbs(data); setState(s => ({ ...s, fbs: value, selectedSku: [...new Set([...s.selectedSku, ...value.map(x => x.barcode)])] })); }
      if (kind === 'current') { const value = parseSales(data); setState(s => ({ ...s, salesCurrent: value, selectedSku: [...new Set([...s.selectedSku, ...value.map(x => x.barcode)])] })); }
      if (kind === 'previous') { const value = parseSales(data); setState(s => ({ ...s, salesPrevious: value })); }
      if (kind === 'fbw') { const value = parseFbw(data); setState(s => ({ ...s, fbw: value.items, settings: { ...s.settings, includedWarehouses: value.warehouses } })); }
      if (kind === 'catalog') { const value = parseCatalog(data); setState(s => ({ ...s, catalog: value })); }
      setFiles(old => ({ ...old, [kind]: file.name })); log('Импорт отчёта', `${kind}: ${file.name}`); message('Файл прочитан.');
    } catch (error) { message(error instanceof Error ? error.message : 'Не удалось прочитать файл.'); }
    finally { setBusy(''); }
  }

  async function refreshWarehouse() {
    setBusy('google');
    try {
      const access = token || await authorizeGoogle(state.connection?.clientId || CLIENT_ID); setToken(access);
      const result = await fetchSourceWarehouses(access);
      setState(s => ({ ...s, boxes: result.boxes, issues: result.issues }));
      log('Обновление склада', `${result.boxes.length} физических BOX_ID из исходных таблиц`); message(`Склад обновлён: ${result.boxes.length} коробов.`);
    } catch (error) { message(error instanceof Error ? error.message : 'Не удалось загрузить склад.'); }
    finally { setBusy(''); }
  }

  function calculate() {
    if (!state.salesCurrent.length || !state.salesPrevious.length) { message('Нужны два недельных отчёта WB: последние и предыдущие 7 дней.'); return; }
    if (!state.boxes.length) { message('Сначала обновите физический склад из Google Sheets.'); return; }
    const result = buildPlan({ fbs: state.fbs, salesCurrent: state.salesCurrent, salesPrevious: state.salesPrevious, fbw: state.fbw, catalog, boxes: state.boxes,
      accepted: state.requests, settings: state.settings, selectedSku: new Set(state.selectedSku), approvedMix: new Set(state.approvedMix), removedBoxes: new Set(state.removedBoxes) });
    setPlan(result); setTab('planning'); log('Расчёт', `${result.stats.selectedBoxes} коробов, ${result.stats.selectedUnits} изделий, ${result.stats.elapsedMs} мс`);
  }

  async function freezeRequest() {
    const rows = plan.rows.filter(row => row.selected); if (!rows.length) return;
    setBusy('freeze');
    try {
      const stamp = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-');
      const xlsx = requestXlsx(rows), pdf = await requestPdf(rows), pick = await pickingPdf(pickingFromPlan(rows));
      const names = { xlsx: `Заявка-${stamp}.xlsx`, pdf: `Заявка-${stamp}.pdf`, picking: `Сборочное-задание-${stamp}.pdf` };
      let links: AcceptedRequest['files'] = {};
      if (state.connection?.folderId) {
        const access = token || await authorizeGoogle(state.connection.clientId); setToken(access);
        const uploaded = await Promise.all([uploadDriveFile(access, state.connection.folderId, names.xlsx, xlsx.type, xlsx), uploadDriveFile(access, state.connection.folderId, names.pdf, 'application/pdf', pdf), uploadDriveFile(access, state.connection.folderId, names.picking, 'application/pdf', pick)]);
        links = { xlsx: uploaded[0].webViewLink, pdf: uploaded[1].webViewLink, pickingPdf: uploaded[2].webViewLink };
      } else { downloadBlob(xlsx, names.xlsx); downloadBlob(pdf, names.pdf); downloadBlob(pick, names.picking); }
      const request: AcceptedRequest = { id: `FBS-${Date.now()}`, acceptedAt: new Date().toISOString(), status: 'Заморозка', rows, files: links };
      setState(s => ({ ...s, requests: [request, ...s.requests], audit: [...s.audit, audit('Заморозка заявки', `${request.id}: ${new Set(rows.map(x => x.groupId)).size} коробов`)] }));
      setPlan(EMPTY_RESULT); setTab('requests'); message('Заявка заморожена. Короба исключены из новых расчётов.');
    } catch (error) { message(error instanceof Error ? error.message : 'Не удалось сформировать заявку.'); }
    finally { setBusy(''); }
  }

  function completeRequest(id: string) { setState(s => ({ ...s, requests: s.requests.map(x => x.id === id ? { ...x, status: 'Завершена', completedAt: new Date().toISOString() } : x), audit: [...s.audit, audit('Завершение заявки', id)] })); }
  function removeMissingBox(requestId: string, boxId: string) { setState(s => ({ ...s, requests: s.requests.map(x => x.id === requestId ? { ...x, rows: x.rows.filter(row => row.groupId !== boxId) } : x), removedBoxes: [...new Set([...s.removedBoxes, boxId])], audit: [...s.audit, audit('Отсутствующий короб удалён', `${requestId}: ${boxId}`)] })); }

  async function makeExternalPicking(file: File) { try { const result = parsePickingWorkbook(await file.arrayBuffer()); setPicking(result); log('Сборочное задание', `${file.name}: ${result.total} изделий`); } catch (error) { message(error instanceof Error ? error.message : 'Не удалось прочитать Excel.'); } }
  async function downloadPicking() { if (!picking) return; downloadBlob(await pickingPdf(picking), 'Сборочное-задание-FBS.pdf'); }

  const filteredSku = catalog.filter(x => `${x.article} ${x.name} ${x.size} ${x.barcode}`.toLowerCase().includes(skuQuery.toLowerCase())).slice(0, 500);
  const visibleBoxes = state.boxes.filter(box => (warehouseFilter === 'Все' || box.warehouse === warehouseFilter) && `${box.id} ${box.palette} ${box.placement} ${box.components.map(x => `${x.article} ${x.barcode}`).join(' ')}`.toLowerCase().includes(boxQuery.toLowerCase()));
  const palettes = useMemo(() => { const map = new Map<string, typeof visibleBoxes>(); visibleBoxes.forEach(box => { const key = `${box.warehouse} · ${box.palette || 'без палеты'}`; map.set(key, [...(map.get(key) || []), box]); }); return [...map]; }, [visibleBoxes]);

  const nav: Array<[Tab, string, React.ReactNode]> = [['reports','Отчёты',<Upload/>],['filter','Фильтр',<Filter/>],['planning','Планирование',<LayoutDashboard/>],['warehouse','Склад',<Warehouse/>],['requests','Заявки',<Archive/>],['picking','Сборка',<Boxes/>],['audit','Аудит',<Check/>],['settings','Настройки',<Settings/>]];
  return <div className="workspace">
    <aside><div className="brand">FBS <span>WORKSPACE</span></div><nav>{nav.map(([id, label, icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{icon}<span>{label}</span></button>)}</nav><a className="scanner-link" href="https://fbswb.tiovskiy.ru/" target="_blank" rel="noreferrer">Открыть FBS Scanner ↗</a></aside>
    <main><header className="topbar"><div><b>{nav.find(x => x[0] === tab)?.[1]}</b><span>Источник склада: исходные Google Sheets</span></div><button className="secondary" disabled={busy === 'google'} onClick={() => void refreshWarehouse()}><Cloud/> {busy === 'google' ? 'Обновляем…' : 'Обновить склад'}</button></header>

      {tab === 'reports' && <section className="page"><div className="hero"><h1>Данные для расчёта</h1><p>Спрос считается по barcode: 70% последних 7 дней + 30% предыдущих, с отдельным коэффициентом выкупа.</p></div><div className="file-grid">
        <FileCard title="Остатки FBS" text="Баркод, артикул, размер, количество" value={files.fbs} onFile={f => void loadReport('fbs', f)}/>
        <FileCard title="Продажи: последние 7 дней" text="Реальный отчёт supplier-goods WB" value={files.current} onFile={f => void loadReport('current', f)}/>
        <FileCard title="Продажи: предыдущие 7 дней" text="Такой же отчёт за предыдущую неделю" value={files.previous} onFile={f => void loadReport('previous', f)}/>
        <FileCard title="Остатки FBW" text="Склады выбираются в фильтре" value={files.fbw} onFile={f => void loadReport('fbw', f)}/>
        <FileCard title="Номенклатура" text="Необязательно: названия и цвета" value={files.catalog} onFile={f => void loadReport('catalog', f)}/>
      </div><div className="metrics"><Metric label="FBS SKU" value={state.fbs.length}/><Metric label="Продажи 7 дней" value={state.salesCurrent.length}/><Metric label="Предыдущие 7 дней" value={state.salesPrevious.length}/><Metric label="Физические короба" value={state.boxes.length}/></div></section>}

      {tab === 'filter' && <section className="page"><div className="hero"><h1>Отбор и ограничения</h1><p>Автоматическая заявка содержит только целые найденные BOX_ID.</p></div><div className="filter-grid"><label>Максимум коробов<input type="number" min="1" placeholder="MAX" value={state.settings.maxBoxes ?? ''} onChange={e => setState(s => ({ ...s, settings: { ...s.settings, maxBoxes: e.target.value ? Number(e.target.value) : null } }))}/></label><label>Тип коробов<select value={state.settings.boxType} onChange={e => setState(s => ({ ...s, settings: { ...s.settings, boxType: e.target.value as PlannerSettings['boxType'] } }))}><option value="ANY">Любая</option><option>MONO</option><option>MIX</option></select></label><label>Максимум изделий<input type="number" min="1" placeholder="MAX" value={state.settings.maxUnits ?? ''} onChange={e => setState(s => ({ ...s, settings: { ...s.settings, maxUnits: e.target.value ? Number(e.target.value) : null } }))}/></label><label>FBW<select value={state.settings.fbwMode} onChange={e => setState(s => ({ ...s, settings: { ...s.settings, fbwMode: e.target.value as PlannerSettings['fbwMode'] } }))}><option value="NONE">Не учитывать</option><option value="ALL">Все склады</option><option value="SELECTED">Выбранные</option></select></label></div>
        {state.settings.fbwMode === 'SELECTED' && <div className="chips">{[...new Set(state.fbw.flatMap(x => Object.keys(x.warehouses)))].map(name => <label key={name}><input type="checkbox" checked={state.settings.includedWarehouses.includes(name)} onChange={() => setState(s => ({ ...s, settings: { ...s.settings, includedWarehouses: s.settings.includedWarehouses.includes(name) ? s.settings.includedWarehouses.filter(x => x !== name) : [...s.settings.includedWarehouses, name] } }))}/>{name}</label>)}</div>}
        <div className="sku-picker"><div className="picker-head"><label className="search"><Search/><input value={skuQuery} onChange={e => setSkuQuery(e.target.value)} placeholder="Артикул, размер или barcode"/></label><button className="secondary" onClick={() => setState(s => ({ ...s, selectedSku: catalog.map(x => x.barcode) }))}>Выбрать все</button><button className="ghost" onClick={() => setState(s => ({ ...s, selectedSku: [] }))}>Снять все</button></div><div className="sku-list">{filteredSku.map(item => <label key={item.barcode}><input type="checkbox" checked={selectedSku.has(item.barcode)} onChange={() => setState(s => ({ ...s, selectedSku: selectedSku.has(item.barcode) ? s.selectedSku.filter(x => x !== item.barcode) : [...s.selectedSku, item.barcode] }))}/><span><b>{item.article}</b><small>{item.size} · {item.barcode}</small></span></label>)}</div></div><button className="primary run" onClick={calculate}><Play/> Рассчитать по выбранным SKU</button>
      </section>}

      {tab === 'planning' && <section className="page"><div className="hero"><h1>Расчёт</h1><p>{plan.stats.selectedBoxes} коробов · {plan.stats.selectedUnits} изделий · {plan.stats.elapsedMs} мс</p></div>{plan.pendingMixBoxIds.length > 0 && <div className="warning"><b>MIX с лишними компонентами: {plan.pendingMixBoxIds.length}</b><span>Они не включены без ручного подтверждения.</span><div className="chips">{plan.pendingMixBoxIds.slice(0, 30).map(id => <label key={id}><input type="checkbox" checked={state.approvedMix.includes(id)} onChange={() => setState(s => ({ ...s, approvedMix: s.approvedMix.includes(id) ? s.approvedMix.filter(x => x !== id) : [...s.approvedMix, id] }))}/>{id}</label>)}</div></div>}
        <div className="metrics"><Metric label="Выбрано коробов" value={plan.stats.selectedBoxes}/><Metric label="Изделий" value={plan.stats.selectedUnits}/><Metric label="Не удалось закрыть" value={plan.unfilled.length}/><Metric label="Риски FBS/FBW" value={plan.risks.length}/></div>
        {plan.rows.length ? <div className="table-card"><table><thead><tr><th>BOX_ID / место</th><th>SKU</th><th>Спрос</th><th>FBS / FBW</th><th>До → после</th><th>В коробе</th><th></th></tr></thead><tbody>{plan.rows.map((row, i) => { const first = i === 0 || plan.rows[i - 1].groupId !== row.groupId; return <tr key={row.id} className={first ? 'group-start' : ''}><td>{first && <><b>{row.groupId}</b><small>{row.warehouse} · {row.palette} · {row.placement || row.storageCells}</small></>}</td><td><b>{row.article} · {row.size}</b><small>{row.barcode}</small></td><td><b>{row.orders7} / {row.bought7}</b><small>заказы / выкупы · {(row.buyoutRate * 100).toFixed(0)}%</small></td><td>{row.fbs} / {row.fbw}</td><td>{row.stockBefore} → {row.stockAfter}<small>цель {row.target}, max {row.maxStock}</small></td><td><b>{row.qty}</b><small>полезно {row.usefulQty}, лишнее {row.oversupplyQty}</small></td><td>{first && <button className="ghost icon" onClick={() => setPlan(p => ({ ...p, rows: removePhysicalBox(p.rows, row.groupId) }))}><X/></button>}</td></tr>; })}</tbody></table><div className="accept-bar"><span>Фиксация создаст XLSX, PDF заявки и PDF сборочного задания.</span><button className="primary" disabled={busy === 'freeze'} onClick={() => void freezeRequest()}><Check/> {busy === 'freeze' ? 'Формируем…' : 'Заморозить заявку'}</button></div></div> : <div className="empty"><Boxes/><h3>Физические короба не выбраны</h3><p>Задайте фильтры, обновите склад и выполните расчёт.</p></div>}
        <Diagnostic title="Не удалось закрыть" rows={plan.unfilled.map(x => `${x.article} · ${x.size}: ${x.need} шт. — ${x.reason}`)}/><Diagnostic title="Риск дефицита" rows={plan.unfilled.filter(x => x.criticality >= 3).map(x => `${x.article} · ${x.size}: приоритет ${x.criticality}`)}/><Diagnostic title="FBS / FBW баланс" rows={plan.risks.map(x => `${x.article} · ${x.size}: ${x.message}`)}/>
      </section>}

      {tab === 'warehouse' && <section className="page"><div className="hero"><h1>Логическая карта склада</h1><p>Палеты, уровни и короба построены из исходного Хранения и Расстановки.</p></div><div className="warehouse-tools"><label className="search"><Search/><input value={boxQuery} onChange={e => setBoxQuery(e.target.value)} placeholder="BOX_ID, артикул, barcode"/></label><select value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)}><option>Все</option><option>Склад №1</option><option>Склад №2</option><option>Кимры</option></select></div><div className="palette-grid">{palettes.map(([name, boxes]) => <article className="palette" key={name}><h3>{name}</h3><div>{boxes.sort((a,b) => a.level.localeCompare(b.level, 'ru', { numeric: true })).map(box => <button key={box.id} className={`${selectedPlanBoxes.has(box.id) ? 'selected' : ''} ${frozenBoxes.has(box.id) ? 'frozen' : ''}`} title={box.components.map(x => `${x.article} ${x.size}: ${x.qty}`).join('\n')}><b>{box.id}</b><span>{box.type} · {box.totalQty} шт.</span><small>{box.placement || box.storageCells} · ур. {box.level || '—'}</small>{box.note && <em>Есть комментарий MIX</em>}</button>)}</div></article>)}</div></section>}

      {tab === 'requests' && <section className="page"><div className="hero"><h1>Жизненный цикл заявок</h1><p>Расчёт → Заморозка → Завершена. Замороженные BOX_ID исключаются из новых расчётов.</p></div><div className="request-list">{state.requests.map(request => <article key={request.id}><div><span className={`request-status ${request.status}`}>{request.status}</span><h3>{request.id}</h3><p>{new Date(request.acceptedAt).toLocaleString('ru-RU')} · {new Set(request.rows.map(x => x.groupId)).size} коробов · {request.rows.reduce((n,x) => n + x.qty, 0)} шт.</p></div><div className="request-actions">{request.files?.xlsx && <a href={request.files.xlsx} target="_blank">XLSX</a>}{request.files?.pdf && <a href={request.files.pdf} target="_blank">PDF заявки</a>}{request.files?.pickingPdf && <a href={request.files.pickingPdf} target="_blank">Сборка</a>}{request.status === 'Заморозка' && <button className="primary" onClick={() => completeRequest(request.id)}>Завершить</button>}</div>{request.status === 'Заморозка' && <details><summary>Удалить физически отсутствующий короб</summary><div className="chips">{[...new Set(request.rows.map(x => x.groupId))].map(id => <button className="ghost" key={id} onClick={() => removeMissingBox(request.id, id)}>{id} ×</button>)}</div></details>}</article>)}</div></section>}

      {tab === 'picking' && <section className="page"><div className="hero"><h1>Excel → PDF для сборки</h1><p>Совпадающие D:G объединяются; размер, цвет и артикул остаются раздельными.</p></div><FileCard title="Сторонний Excel WB" text="Наименование, Размер, Цвет, Артикул продавца в D:G" onFile={f => void makeExternalPicking(f)}/>{picking && <div className="picking-result"><div className="metrics"><Metric label="Изделий" value={picking.total}/><Metric label="Строк после объединения" value={picking.items.length}/></div><button className="primary" onClick={() => void downloadPicking()}><Download/> Скачать PDF</button><table><thead><tr><th>Наименование</th><th>Размер</th><th>Цвет</th><th>Артикул</th><th>Кол-во</th></tr></thead><tbody>{picking.items.slice(0,100).map((x,i) => <tr key={i}><td>{x.name}</td><td>{x.size}</td><td>{x.color}</td><td>{x.article}</td><td>{x.count}</td></tr>)}</tbody></table></div>}</section>}

      {tab === 'audit' && <section className="page"><div className="hero"><h1>Локальный аудит</h1><p>Записи добавляются последовательно и входят в полный экспорт состояния.</p></div><div className="audit-list">{[...state.audit].reverse().map(x => <div key={x.id}><time>{new Date(x.at).toLocaleString('ru-RU')}</time><b>{x.action}</b><span>{x.details}</span></div>)}</div></section>}

      {tab === 'settings' && <section className="page"><div className="hero"><h1>Настройки и резервная копия</h1><p>Основная база хранится в IndexedDB этого браузера.</p></div><div className="settings-grid"><div className="settings-card"><h3>Расчёт</h3><label>Целевой запас, дней<input type="number" value={state.settings.targetDays} onChange={e => setState(s => ({ ...s, settings: { ...s.settings, targetDays: Number(e.target.value) } }))}/></label><label>Страховой запас, дней<input type="number" value={state.settings.safetyDays} onChange={e => setState(s => ({ ...s, settings: { ...s.settings, safetyDays: Number(e.target.value) } }))}/></label><label>Максимум после поставки, дней<input type="number" value={state.settings.maxAfterDays} onChange={e => setState(s => ({ ...s, settings: { ...s.settings, maxAfterDays: Number(e.target.value) } }))}/></label><label>Абсолютный максимум на SKU<input type="number" max="50" value={state.settings.maxPerSku} onChange={e => setState(s => ({ ...s, settings: { ...s.settings, maxPerSku: Number(e.target.value) } }))}/></label></div><div className="settings-card"><h3>Google Drive</h3><label>OAuth Client ID<input value={state.connection?.clientId || ''} onChange={e => setState(s => ({ ...s, connection: { clientId: e.target.value, folderId: s.connection?.folderId || '' } }))}/></label><label>ID папки<input value={state.connection?.folderId || ''} onChange={e => setState(s => ({ ...s, connection: { clientId: s.connection?.clientId || '', folderId: e.target.value } }))}/></label><p>Токен остаётся только в памяти вкладки.</p></div><div className="settings-card"><h3>Полное состояние</h3><button className="secondary" onClick={() => downloadBlob(exportState({ ...state, savedAt: new Date().toISOString() }), `FBS-Workspace-${Date.now()}.json`)}><Download/> Экспорт</button><button className="secondary" onClick={() => importRef.current?.click()}><Upload/> Импорт</button><input ref={importRef} hidden type="file" accept=".json" onChange={e => { const file = e.target.files?.[0]; if (file) void importState(file).then(value => { setState(value); message('Состояние восстановлено.'); }).catch(error => message(error.message)); e.currentTarget.value = ''; }}/></div></div></section>}
    </main>{notice && <div className="toast">{notice}</div>}{busy && !['google','freeze'].includes(busy) && <div className="busy">Обрабатываем файл…</div>}</div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div><b>{value.toLocaleString('ru-RU')}</b><span>{label}</span></div>; }
function Diagnostic({ title, rows }: { title: string; rows: string[] }) { return <details className="diagnostic"><summary>{title} <b>{rows.length}</b></summary>{rows.length ? <ul>{rows.slice(0,100).map((row,i) => <li key={i}>{row}</li>)}</ul> : <p>Нет позиций.</p>}</details>; }
export default App;
