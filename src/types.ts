export type FbsItem = {
  barcode: string;
  quantity: number;
  article: string;
  name: string;
  size: string;
  brand?: string;
};

export type SalesItem = {
  article: string;
  ordered: number;
  bought: number;
  revenue: number;
};

export type FbwItem = {
  barcode: string;
  article: string;
  size: string;
  inTransit: number;
  returnsInTransit: number;
  total: number;
  warehouses: Record<string, number>;
};

export type CatalogItem = {
  barcode: string;
  article: string;
  name: string;
  color: string;
  size: string;
};

export type ParsedFbw = { items: FbwItem[]; warehouses: string[] };

export type BoxComponent = {
  barcode: string;
  article: string;
  color: string;
  size: string;
  qty: number;
};

export type PhysicalBox = {
  id: string;
  type: string;
  totalQty: number;
  placement: string;
  palette: string;
  side: string;
  level: string;
  storageCells: string;
  status: string;
  volumeStatus: string;
  volumeAuto: string;
  volumeDetail: string;
  components: BoxComponent[];
};

export type WarehouseIssueCode = 'identity' | 'status' | 'volume' | 'placement' | 'composition' | 'quantity';

export type WarehouseIssue = {
  key: string;
  box: PhysicalBox;
  reasons: string[];
  codes: WarehouseIssueCode[];
  confirmable: boolean;
  blockingReason?: string;
};

export type PhysicalBoxesResult = {
  boxes: PhysicalBox[];
  issues: WarehouseIssue[];
};

export type PlanRow = {
  id: string;
  groupId: string;
  source: 'auto' | 'manual';
  barcode: string;
  article: string;
  name: string;
  size: string;
  fbs: number;
  fbw: number;
  sales7: number;
  target: number;
  qty: number;
  palette: string;
  placement: string;
  storageCells: string;
  boxType: string;
  confidence: 'ok' | 'warning';
  reason: string;
  selected: boolean;
};

export type PlannerSettings = {
  targetDays: number;
  safetyFactor: number;
  minOrders: number;
  maxPerSku: number;
};

export type AcceptedRequest = {
  id: string;
  acceptedAt: string;
  status: 'Принята' | 'Выполнена' | 'Отменена';
  rows: PlanRow[];
  includedWarehouses: string[];
  files?: { xlsx?: string; pdf?: string };
};


