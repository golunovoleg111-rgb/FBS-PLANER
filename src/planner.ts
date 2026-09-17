import type { AcceptedRequest, BalanceRisk, CatalogItem, FbsItem, FbwItem, PhysicalBox, PlanResult, PlanRow, PlannerSettings, SalesItem, UnfilledNeed } from './types';

const sum = (xs: Iterable<number>) => [...xs].reduce((a, b) => a + b, 0);
const round = (n: number) => Math.round(n * 100) / 100;
const byBarcode = <T extends { barcode: string }>(rows: T[]) => new Map(rows.map(row => [row.barcode, row]));

type NeedState = {
  item: CatalogItem; fbs: number; fbw: number; orders7: number; ordersPrev7: number; bought7: number; boughtPrev7: number;
  buyoutRate: number; dailyDemand: number; stock: number; supplyDays: number | null; target: number; maxStock: number;
  need: number; criticality: number;
};

function fbwQuantity(item: FbwItem | undefined, settings: PlannerSettings) {
  if (!item || settings.fbwMode === 'NONE') return 0;
  if (settings.fbwMode === 'ALL') return sum(Object.values(item.warehouses));
  return sum(settings.includedWarehouses.map(name => item.warehouses[name] || 0));
}

function criticality(days: number | null) {
  if (days === null || days < 2) return 4;
  if (days < 4) return 3;
  if (days < 7) return 2;
  return 1;
}

type Candidate = { box: PhysicalBox; useful: number; excess: number; coverage: number; critical: number; requiresApproval: boolean };
type SearchState = { chosen: number[]; projected: Map<string, number>; units: number; score: number; palettes: Set<string> };

function scoreCandidate(box: PhysicalBox, needs: Map<string, NeedState>, projected: Map<string, number>, palettes: Set<string>) {
  let useful = 0, excess = 0, coverage = 0, critical = 0;
  for (const component of box.components) {
    const need = needs.get(component.barcode);
    const before = projected.get(component.barcode) ?? need?.stock ?? 0;
    const remaining = Math.max(0, (need?.target || 0) - before);
    const partUseful = Math.min(component.qty, remaining);
    useful += partUseful;
    excess += component.qty - partUseful;
    if (partUseful > 0) { coverage += 1; critical += partUseful * (need?.criticality || 0); }
  }
  const newPalette = box.palette && !palettes.has(box.palette) ? 1 : 0;
  const levelPenalty = /верх|top|^[4-9]$/i.test(box.level) ? 0 : 1;
  return { useful, excess, coverage, critical, scalar: critical * 1_000_000 + useful * 10_000 + coverage * 1_000 - excess * 100 - newPalette * 20 - levelPenalty };
}

function selectBoxes(candidates: PhysicalBox[], needs: Map<string, NeedState>, settings: PlannerSettings, approvedMix: Set<string>) {
  const maxBoxes = Math.min(settings.maxBoxes ?? candidates.length, candidates.length);
  const maxUnits = settings.maxUnits ?? Number.MAX_SAFE_INTEGER;
  const ranked: Candidate[] = candidates.map(box => {
    const s = scoreCandidate(box, needs, new Map(), new Set());
    return { box, useful: s.useful, excess: s.excess, coverage: s.coverage, critical: s.critical, requiresApproval: box.type === 'MIX' && s.excess > 0 && !approvedMix.has(box.id) };
  }).filter(x => x.useful > 0).sort((a, b) => b.critical - a.critical || b.useful - a.useful || b.coverage - a.coverage || a.excess - b.excess);
  const pendingMix = ranked.filter(x => x.requiresApproval).map(x => x.box.id);
  const usable = ranked.filter(x => !x.requiresApproval).map(x => x.box);
  const beamCandidates = usable.slice(0, 280);
  let beam: SearchState[] = [{ chosen: [], projected: new Map(), units: 0, score: 0, palettes: new Set() }];
  const depth = Math.min(maxBoxes, 50);
  for (let step = 0; step < depth; step += 1) {
    const expanded: SearchState[] = [...beam];
    for (const state of beam) {
      const start = state.chosen.length ? state.chosen[state.chosen.length - 1] + 1 : 0;
      for (let index = start; index < beamCandidates.length; index += 1) {
        const box = beamCandidates[index];
        if (state.units + box.totalQty > maxUnits) continue;
        const s = scoreCandidate(box, needs, state.projected, state.palettes);
        if (s.useful <= 0) continue;
        const projected = new Map(state.projected);
        let feasible = true;
        for (const component of box.components) {
          const need = needs.get(component.barcode);
          if (!need) { feasible = false; break; }
          const after = (projected.get(component.barcode) || 0) + component.qty;
          if (after > need.maxStock) { feasible = false; break; }
          projected.set(component.barcode, after);
        }
        if (!feasible) continue;
        const palettes = new Set(state.palettes); if (box.palette) palettes.add(box.palette);
        expanded.push({ chosen: [...state.chosen, index], projected, units: state.units + box.totalQty, score: state.score + s.scalar, palettes });
      }
    }
    const unique = new Map<string, SearchState>();
    expanded.sort((a, b) => b.score - a.score || b.units - a.units);
    for (const state of expanded) {
      const key = state.chosen.join(',');
      if (!unique.has(key)) unique.set(key, state);
      if (unique.size >= 180) break;
    }
    const next = [...unique.values()];
    if (next[0]?.chosen.length === beam[0]?.chosen.length && step > 0) break;
    beam = next;
  }
  const best = beam[0] || { chosen: [], projected: new Map(), units: 0, score: 0, palettes: new Set<string>() };
  const selected = best.chosen.map(index => beamCandidates[index]);
  const selectedIds = new Set(selected.map(box => box.id));
  const projected = new Map(best.projected), palettes = new Set(best.palettes); let units = best.units;
  while (selected.length < maxBoxes) {
    let chosen: PhysicalBox | undefined, chosenScore = -Infinity;
    for (const box of usable) {
      if (selectedIds.has(box.id) || units + box.totalQty > maxUnits) continue;
      const score = scoreCandidate(box, needs, projected, palettes); if (score.useful <= 0) continue;
      const feasible = box.components.every(component => {
        const need = needs.get(component.barcode); return Boolean(need) && (projected.get(component.barcode) ?? need!.stock) + component.qty <= need!.maxStock;
      });
      if (feasible && score.scalar > chosenScore) { chosen = box; chosenScore = score.scalar; }
    }
    if (!chosen) break;
    selected.push(chosen); selectedIds.add(chosen.id); units += chosen.totalQty; if (chosen.palette) palettes.add(chosen.palette);
    chosen.components.forEach(component => { const need = needs.get(component.barcode)!; projected.set(component.barcode, (projected.get(component.barcode) ?? need.stock) + component.qty); });
  }
  return { boxes: selected, projected, pendingMix };
}

export function buildPlan(input: {
  fbs: FbsItem[]; salesCurrent: SalesItem[]; salesPrevious: SalesItem[]; fbw: FbwItem[]; catalog: CatalogItem[];
  boxes: PhysicalBox[]; accepted: AcceptedRequest[]; settings: PlannerSettings; selectedSku?: Set<string>;
  approvedMix?: Set<string>; removedBoxes?: Set<string>;
}): PlanResult {
  const started = performance.now();
  const fbs = byBarcode(input.fbs), fbw = byBarcode(input.fbw), current = byBarcode(input.salesCurrent), previous = byBarcode(input.salesPrevious);
  const catalog = new Map<string, CatalogItem>();
  [...input.catalog, ...input.fbs.map(x => ({ barcode: x.barcode, article: x.article, name: x.name, color: '', size: x.size }))].forEach(x => { if (x.barcode) catalog.set(x.barcode, x); });
  const frozenBoxes = new Set<string>();
  const frozenQty = new Map<string, number>();
  input.accepted.filter(x => x.status === 'Заморозка').forEach(request => request.rows.forEach(row => {
    frozenBoxes.add(row.groupId); frozenQty.set(row.barcode, (frozenQty.get(row.barcode) || 0) + row.qty);
  }));
  const selectedSku = input.selectedSku || new Set(catalog.keys());
  const states = new Map<string, NeedState>();
  const needs = new Map<string, NeedState>();
  const risks: BalanceRisk[] = [];
  for (const [barcode, item] of catalog) {
    if (!selectedSku.has(barcode)) continue;
    const s7 = current.get(barcode), p7 = previous.get(barcode);
    const orders7 = s7?.ordered || 0, ordersPrev7 = p7?.ordered || 0;
    const bought7 = s7?.bought || 0, boughtPrev7 = p7?.bought || 0;
    const orders = orders7 + ordersPrev7, bought = bought7 + boughtPrev7;
    if (orders < input.settings.minOrders) continue;
    const buyoutRate = orders > 0 ? Math.max(0, Math.min(1, bought / orders)) : 0;
    const weightedOrdersDaily = orders7 / 7 * .7 + ordersPrev7 / 7 * .3;
    const dailyDemand = weightedOrdersDaily * buyoutRate;
    if (dailyDemand <= 0) continue;
    const fbsQty = fbs.get(barcode)?.quantity || 0;
    const fbwQty = fbwQuantity(fbw.get(barcode), input.settings);
    const stock = fbsQty + fbwQty + (frozenQty.get(barcode) || 0);
    const supplyDays = stock / dailyDemand;
    const target = Math.min(input.settings.maxPerSku, Math.ceil(dailyDemand * (input.settings.targetDays + input.settings.safetyDays)));
    const maxStock = Math.min(input.settings.maxPerSku, Math.max(target, Math.floor(dailyDemand * input.settings.maxAfterDays)));
    const need = Math.max(0, target - stock);
    const state: NeedState = { item, fbs: fbsQty, fbw: fbwQty, orders7, ordersPrev7, bought7, boughtPrev7, buyoutRate, dailyDemand, stock, supplyDays, target, maxStock, need, criticality: criticality(supplyDays) };
    states.set(barcode, state);
    if (need > 0) needs.set(barcode, state);
    if (orders >= 5 && buyoutRate < .45) risks.push({ barcode, article: item.article, size: item.size, orders, bought, buyoutRate, fbs: fbsQty, fbw: fbwQty, message: 'Заказов много, но выкуп низкий. Основная часть спроса остаётся в контуре WB.' });
    else if (fbsQty < target && fbwQty >= target) risks.push({ barcode, article: item.article, size: item.size, orders, bought, buyoutRate, fbs: fbsQty, fbw: fbwQty, message: 'Дефицит FBS закрывается остатком выбранных складов FBW.' });
  }
  const candidateBoxes = input.boxes.filter(box => !frozenBoxes.has(box.id) && !input.removedBoxes?.has(box.id)
    && (input.settings.boxType === 'ANY' || box.type === input.settings.boxType)
    && box.components.length > 0 && box.components.every(component => selectedSku.has(component.barcode) && states.has(component.barcode))
    && box.components.some(component => needs.has(component.barcode)));
  const picked = selectBoxes(candidateBoxes, states, input.settings, input.approvedMix || new Set());
  const projected = new Map([...states].map(([key, value]) => [key, value.stock]));
  const rows: PlanRow[] = [];
  for (const box of picked.boxes) {
    for (const [index, component] of box.components.entries()) {
      const need = states.get(component.barcode)!;
      const before = projected.get(component.barcode) || need.stock;
      const usefulQty = Math.min(component.qty, Math.max(0, need.target - before));
      const after = before + component.qty;
      projected.set(component.barcode, after);
      rows.push({ id: `${box.id}:${component.barcode}:${index}`, groupId: box.id, barcode: component.barcode, article: component.article || need.item.article,
        name: need.item.name, color: component.color || need.item.color, size: component.size || need.item.size, fbs: need.fbs, fbw: need.fbw,
        orders7: need.orders7, ordersPrev7: need.ordersPrev7, bought7: need.bought7, boughtPrev7: need.boughtPrev7,
        buyoutRate: round(need.buyoutRate), dailyDemand: round(need.dailyDemand), stockBefore: need.stock, stockAfter: after,
        supplyDays: round(need.supplyDays || 0), target: need.target, maxStock: need.maxStock, need: need.need, qty: component.qty,
        warehouse: box.warehouse, palette: box.palette, placement: box.placement, side: box.side, level: box.level,
        storageCells: box.storageCells, boxType: box.type, usefulQty, oversupplyQty: component.qty - usefulQty,
        criticality: need.criticality, selected: true,
        reason: `${box.type}: полезно ${usefulQty} из ${component.qty}; запас ${round(need.supplyDays || 0)} дн.; выкуп ${(need.buyoutRate * 100).toFixed(0)}%.`,
      });
    }
  }
  const unfilled: UnfilledNeed[] = [];
  for (const [barcode, need] of needs) {
    const missing = Math.max(0, need.target - (projected.get(barcode) || need.stock));
    if (missing > 0) unfilled.push({ barcode, article: need.item.article, name: need.item.name, size: need.item.size, need: missing, criticality: need.criticality, reason: 'Не найден подходящий свободный физический BOX_ID в заданных лимитах.' });
  }
  unfilled.sort((a, b) => b.criticality - a.criticality || b.need - a.need);
  return { rows, unfilled, risks, pendingMixBoxIds: picked.pendingMix, stats: { eligibleSku: needs.size, selectedSku: selectedSku.size,
    candidateBoxes: candidateBoxes.length, selectedBoxes: picked.boxes.length, selectedUnits: sum(picked.boxes.map(x => x.totalQty)), elapsedMs: round(performance.now() - started) } };
}

export function removePhysicalBox(rows: PlanRow[], boxId: string) { return rows.filter(row => row.groupId !== boxId); }
