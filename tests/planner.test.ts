import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/planner';
import type { PhysicalBox, PlannerSettings } from '../src/types';

const settings: PlannerSettings = { targetDays: 7, safetyDays: 2, maxAfterDays: 14, minOrders: 1, maxPerSku: 40, boxType: 'ANY', maxBoxes: null, maxUnits: null, fbwMode: 'NONE', includedWarehouses: [] };
const catalog = [{ barcode: '100', article: 'A', name: 'Брюки', color: 'синий', size: '42' }];
const sales = [{ barcode: '100', article: 'A', name: 'Брюки', size: '42', ordered: 14, bought: 14, revenue: 0 }];
const box = (id: string, components = [{ barcode: '100', article: 'A', color: 'синий', size: '42', qty: 10 }], type: 'MONO'|'MIX' = 'MONO', palette = 'P1'): PhysicalBox => ({ id, type, totalQty: components.reduce((n,x)=>n+x.qty,0), placement: 'A1', palette, side: 'A', level: '2', storageCells: 'Лист1!A1', status: 'SOURCE', warehouse: 'Склад №1', sourceSheet: 'Хранение', sourceColumn: 'G', note: '', components });
const base = { fbs: [{ barcode: '100', article: 'A', name: 'Брюки', size: '42', quantity: 0 }], salesCurrent: sales, salesPrevious: sales, fbw: [], catalog, boxes: [box('B1')], accepted: [], settings };

describe('physical planning', () => {
  it('uses barcode-level 70/30 demand and real box quantity', () => {
    const result = buildPlan(base);
    expect(result.rows[0]).toMatchObject({ groupId: 'B1', barcode: '100', qty: 10, orders7: 14, ordersPrev7: 14 });
    expect(result.stats.selectedUnits).toBe(10);
  });
  it('applies selected FBW mode', () => {
    const fbw = [{ barcode: '100', article: 'A', size: '42', inTransit: 0, returnsInTransit: 0, total: 20, warehouses: { Коледино: 20 } }];
    const result = buildPlan({ ...base, fbw, settings: { ...settings, fbwMode: 'SELECTED', includedWarehouses: ['Коледино'] } });
    expect(result.rows).toHaveLength(0);
  });
  it('never invents unresolved quantities', () => {
    const result = buildPlan({ ...base, boxes: [] });
    expect(result.rows).toHaveLength(0); expect(result.unfilled[0].need).toBeGreaterThan(0);
  });
  it('holds oversupplying MIX for manual approval', () => {
    const mix = box('M1', [{ barcode: '100', article: 'A', color: 'синий', size: '42', qty: 20 }], 'MIX');
    const pending = buildPlan({ ...base, boxes: [mix] });
    expect(pending.rows).toHaveLength(0); expect(pending.pendingMixBoxIds).toContain('M1');
    const approved = buildPlan({ ...base, boxes: [mix], approvedMix: new Set(['M1']) });
    expect(approved.rows[0].groupId).toBe('M1');
  });
  it('respects box and unit limits and prefers fewer palettes', () => {
    const boxes = [box('B1', undefined, 'MONO', 'P1'), box('B2', undefined, 'MONO', 'P1'), box('B3', undefined, 'MONO', 'P2')];
    const result = buildPlan({ ...base, salesCurrent: [{ ...sales[0], ordered: 35, bought: 35 }], salesPrevious: [{ ...sales[0], ordered: 35, bought: 35 }], boxes, settings: { ...settings, maxBoxes: 2, maxUnits: 20 } });
    expect(new Set(result.rows.map(x => x.groupId)).size).toBeLessThanOrEqual(2); expect(result.stats.selectedUnits).toBeLessThanOrEqual(20);
  });
  it('excludes frozen physical BOX_ID', () => {
    const frozenRows = buildPlan(base).rows;
    const result = buildPlan({ ...base, accepted: [{ id: 'R1', acceptedAt: new Date().toISOString(), status: 'Заморозка', rows: frozenRows }] });
    expect(result.rows).toHaveLength(0);
  });
  it('handles at least 1500 SKU within a browser-safe time budget', () => {
    const manyCatalog = Array.from({ length: 1500 }, (_, i) => ({ barcode: String(100000 + i), article: `A${i}`, name: 'Товар', color: 'синий', size: String(40 + i % 10) }));
    const manySales = manyCatalog.map(x => ({ ...x, ordered: 14, bought: 10, revenue: 0 }));
    const manyBoxes = manyCatalog.map((x, i) => box(`B${i}`, [{ barcode: x.barcode, article: x.article, color: x.color, size: x.size, qty: 5 }], 'MONO', `P${Math.floor(i/10)}`));
    const started = performance.now();
    const result = buildPlan({ fbs: manyCatalog.map(x => ({ ...x, quantity: 0 })), salesCurrent: manySales, salesPrevious: manySales, fbw: [], catalog: manyCatalog, boxes: manyBoxes, accepted: [], settings: { ...settings, maxBoxes: 20, maxUnits: 100 } });
    expect(result.stats.selectedSku).toBe(1500); expect(result.stats.selectedBoxes).toBeLessThanOrEqual(20); expect(performance.now() - started).toBeLessThan(5000);
  });
});
