export type FbsItem = { barcode: string; quantity: number; article: string; name: string; size: string; brand?: string };
export type SalesItem = { barcode: string; article: string; name: string; size: string; ordered: number; bought: number; revenue: number };
export type FbwItem = { barcode: string; article: string; size: string; inTransit: number; returnsInTransit: number; total: number; warehouses: Record<string, number> };
export type CatalogItem = { barcode: string; article: string; name: string; color: string; size: string };
export type ParsedFbw = { items: FbwItem[]; warehouses: string[] };

export type WarehouseName = 'Склад №1' | 'Склад №2' | 'Кимры';
export type BoxComponent = { barcode: string; article: string; color: string; size: string; qty: number };
export type PhysicalBox = {
  id: string; type: 'MONO' | 'MIX'; totalQty: number; placement: string; palette: string; side: string;
  level: string; storageCells: string; status: string; warehouse: WarehouseName; sourceSheet: string;
  sourceColumn: string; note: string; components: BoxComponent[];
};
export type WarehouseIssue = { key: string; box: PhysicalBox; reasons: string[]; confirmable: boolean };
export type PhysicalBoxesResult = { boxes: PhysicalBox[]; issues: WarehouseIssue[] };

export type PlanRow = {
  id: string; groupId: string; barcode: string; article: string; name: string; color: string; size: string;
  fbs: number; fbw: number; orders7: number; ordersPrev7: number; bought7: number; boughtPrev7: number;
  buyoutRate: number; dailyDemand: number; stockBefore: number; stockAfter: number; supplyDays: number | null;
  target: number; maxStock: number; need: number; qty: number; warehouse: WarehouseName; palette: string;
  placement: string; side: string; level: string; storageCells: string; boxType: 'MONO' | 'MIX';
  usefulQty: number; oversupplyQty: number; criticality: number; reason: string; selected: boolean;
};
export type UnfilledNeed = { barcode: string; article: string; name: string; size: string; need: number; criticality: number; reason: string };
export type BalanceRisk = { barcode: string; article: string; size: string; orders: number; bought: number; buyoutRate: number; fbs: number; fbw: number; message: string };
export type PlannerSettings = {
  targetDays: number; safetyDays: number; maxAfterDays: number; minOrders: number; maxPerSku: number;
  boxType: 'ANY' | 'MONO' | 'MIX'; maxBoxes: number | null; maxUnits: number | null;
  fbwMode: 'NONE' | 'ALL' | 'SELECTED'; includedWarehouses: string[];
};
export type PlanResult = {
  rows: PlanRow[]; unfilled: UnfilledNeed[]; risks: BalanceRisk[]; pendingMixBoxIds: string[];
  stats: { eligibleSku: number; selectedSku: number; candidateBoxes: number; selectedBoxes: number; selectedUnits: number; elapsedMs: number };
};
export type RequestStatus = 'Заморозка' | 'Завершена';
export type AcceptedRequest = { id: string; acceptedAt: string; completedAt?: string; status: RequestStatus; rows: PlanRow[]; files?: { xlsx?: string; pdf?: string; pickingPdf?: string } };
export type AuditEntry = { id: string; at: string; action: string; details: string };
export type AppSnapshot = {
  version: 3; savedAt: string; fbs: FbsItem[]; salesCurrent: SalesItem[]; salesPrevious: SalesItem[];
  fbw: FbwItem[]; catalog: CatalogItem[]; boxes: PhysicalBox[]; issues: WarehouseIssue[];
  requests: AcceptedRequest[]; audit: AuditEntry[]; settings: PlannerSettings; selectedSku: string[];
  approvedMix: string[]; removedBoxes: string[]; connection?: { clientId: string; folderId: string };
};


