import Fastify from 'fastify';
import cors from '@fastify/cors';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

type ReviewStatus = 'unreviewed' | 'in_review' | 'accepted' | 'rejected';
type ReviewDecision = 'accepted' | 'rejected';
type WorkflowStatus = 'done' | 'active' | 'pending' | 'blocked';

type ReviewEvent = {
  status: ReviewDecision;
  reviewer: string;
  note?: string;
  at: string;
};

type Annotation = {
  id: string;
  axis: string;
  index: number;
  x: number;
  y: number;
  kind: string;
  severity: string;
  note: string;
  diameter: number;
  confidence: number;
  reviewStatus: ReviewStatus;
  reviewer?: string;
  reviewNote?: string;
  decidedAt?: string;
  reviewHistory: ReviewEvent[];
  createdAt: string;
};

type WorkflowStep = {
  id: string;
  label: string;
  status: WorkflowStatus;
  owner: string;
  detail: string;
};

const scan = {
  id: 'valve-housing-017',
  part: '液压阀体 / VH-017',
  material: 'AlSi10Mg',
  resolution: '42 μm',
  dimensions: '128 × 128 × 96 voxels',
  operator: '张工',
  acquiredAt: '2026-09-30 08:42',
  scanner: 'Phoenix v|tome|x M 300',
  lot: 'LOT-2026-09-A17',
  standard: 'ASTM E1441'
};

let annotations: Annotation[] = [
  { id: 'D-024', axis: 'axial', index: 42, x: 57, y: 39, kind: '孔隙', severity: '中', note: '疑似缩孔，建议复核', diameter: 1.86, confidence: .91, reviewStatus: 'in_review', reviewer: '王工', reviewHistory: [], createdAt: '2026-09-30T09:12:00.000Z' },
  { id: 'D-031', axis: 'coronal', index: 37, x: 31, y: 61, kind: '夹杂', severity: '低', note: '边缘夹杂', diameter: .72, confidence: .74, reviewStatus: 'unreviewed', reviewHistory: [], createdAt: '2026-09-30T09:18:00.000Z' },
  { id: 'D-044', axis: 'sagittal', index: 51, x: 64, y: 47, kind: '裂纹', severity: '高', note: '线性高密度异常，需二次扫描确认', diameter: 3.42, confidence: .68, reviewStatus: 'unreviewed', reviewHistory: [], createdAt: '2026-09-30T09:27:00.000Z' }
];

const isHighRisk = (item: Annotation) => item.severity === '高';
const isPendingReview = (item: Annotation) => item.reviewStatus === 'unreviewed' || item.reviewStatus === 'in_review';
const isDecision = (status: string): status is ReviewDecision => status === 'accepted' || status === 'rejected';

function slice(axis: string, index: number) {
  const size = 96;
  const data: number[][] = [];
  for (let y = 0; y < size; y++) {
    const row: number[] = [];
    for (let x = 0; x < size; x++) {
      const dx = x - 48;
      const dy = y - 48;
      const shell = Math.sqrt(dx * dx + dy * dy);
      let value = 12
        + Math.max(0, 1 - Math.abs(shell - 31) / 9) * 130
        + Math.max(0, 1 - Math.abs(shell - 14) / 5) * 48;
      value += 16 * Math.sin((x + index) * .17) * Math.cos((y - index) * .12);
      const hole = (x - (57 + Math.sin(index * .15) * 4)) ** 2
        + (y - (39 + Math.cos(index * .1) * 3)) ** 2;
      if (hole < 28 + (index - 42) ** 2 * .7) value = 8;
      const inclusion = (x - 30) ** 2 + (y - 61) ** 2;
      if (inclusion < 13 && axis !== 'sagittal') value = 220;
      row.push(Math.max(0, Math.min(255, Math.round(value))));
    }
    data.push(row);
  }
  return { axis, index, size, data };
}

function stats() {
  const highRisk = annotations.filter(isHighRisk);
  const pending = annotations.filter(isPendingReview);
  const accepted = annotations.filter(item => item.reviewStatus === 'accepted');
  const rejected = annotations.filter(item => item.reviewStatus === 'rejected');
  const highRiskAccepted = highRisk.filter(item => item.reviewStatus === 'accepted');
  const highRiskRejected = highRisk.filter(item => item.reviewStatus === 'rejected');
  const highRiskPending = highRisk.filter(isPendingReview);

  return {
    defectCount: annotations.length,
    criticalCount: highRisk.length,
    highRiskCount: highRisk.length,
    unreviewedCount: pending.length,
    pendingReviewCount: pending.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    highRiskAcceptedCount: highRiskAccepted.length,
    highRiskRejectedCount: highRiskRejected.length,
    highRiskPendingReviewCount: highRiskPending.length,
    lowRiskPendingReviewCount: annotations.filter(item => !isHighRisk(item) && isPendingReview(item)).length,
    releaseBlockingCount: highRisk.length - highRiskAccepted.length,
    totalVolume: +annotations
      .reduce((sum, item) => sum + 4 / 3 * Math.PI * (item.diameter / 2) ** 3, 0)
      .toFixed(2),
    byKind: Object.entries(annotations.reduce<Record<string, number>>((out, item) => {
      out[item.kind] = (out[item.kind] ?? 0) + 1;
      return out;
    }, {})).map(([kind, count]) => ({ kind, count }))
  };
}

function releaseGate() {
  const blockers = annotations
    .filter(item => isHighRisk(item) && item.reviewStatus !== 'accepted')
    .map(item => ({
      annotationId: item.id,
      kind: item.kind,
      severity: item.severity,
      reviewStatus: item.reviewStatus,
      reason: item.reviewStatus === 'rejected' ? 'high_risk_rejected' : 'high_risk_not_accepted'
    }));

  const rejectedIds = blockers
    .filter(item => item.reason === 'high_risk_rejected')
    .map(item => item.annotationId);
  const pendingIds = blockers
    .filter(item => item.reason !== 'high_risk_rejected')
    .map(item => item.annotationId);

  let reasonCode: 'high_risk_rejected' | 'high_risk_pending' | 'ready' = 'ready';
  let reason = '高风险缺陷均已明确接受，允许签发';
  if (rejectedIds.length > 0) {
    reasonCode = 'high_risk_rejected';
    reason = `高风险缺陷 ${rejectedIds.join('、')} 已驳回，驳回记录保留并阻断签发`;
  } else if (pendingIds.length > 0) {
    reasonCode = 'high_risk_pending';
    reason = `高风险缺陷 ${pendingIds.join('、')} 尚未明确接受，不能签发`;
  }

  return {
    status: blockers.length > 0 ? 'blocked' as const : 'ready' as const,
    reasonCode,
    reason,
    blockers
  };
}

function buildWorkflow(): WorkflowStep[] {
  const pending = annotations.filter(isPendingReview);
  const highRisk = annotations.filter(isHighRisk);
  const highRiskPending = highRisk.filter(isPendingReview);
  const highRiskRejected = highRisk.filter(item => item.reviewStatus === 'rejected');
  const gate = releaseGate();

  let reviewStatus: WorkflowStatus = 'done';
  let reviewDetail = '高风险缺陷均已明确接受';
  if (highRiskRejected.length > 0) {
    reviewStatus = 'blocked';
    reviewDetail = `高风险缺陷 ${highRiskRejected.map(item => item.id).join('、')} 已驳回，禁止签发`;
  } else if (highRiskPending.length > 0) {
    reviewStatus = 'active';
    reviewDetail = `等待 ${highRiskPending.length} 个高风险缺陷明确接受`;
  } else if (pending.some(item => !isHighRisk(item))) {
    reviewStatus = 'active';
    reviewDetail = `尚有 ${pending.filter(item => !isHighRisk(item)).length} 个非高风险缺陷待处理，不阻断签发`;
  }

  return [
    { id: 'ingest', label: '数据接收', status: 'done', owner: '系统', detail: '原始 DICOM 序列已校验' },
    { id: 'reconstruct', label: '体数据重建', status: 'done', owner: '算法服务', detail: '96 层切片已生成' },
    {
      id: 'primary',
      label: '初检标注',
      status: pending.length > 0 ? 'active' : 'done',
      owner: '张工',
      detail: pending.length > 0 ? `${pending.length} 个缺陷待复核` : '候选缺陷均已完成判定'
    },
    { id: 'review', label: '二次复核', status: reviewStatus, owner: '王工', detail: reviewDetail },
    {
      id: 'release',
      label: '报告签发',
      status: gate.status === 'blocked' ? 'blocked' : 'active',
      owner: '质量负责人',
      detail: gate.reason
    }
  ];
}

app.get('/api/health', async () => ({ status: 'ok', service: 'ct-inspection-workbench', version: '0.8.0' }));
app.get('/api/scans/current', async () => scan);
app.get('/api/scans/current/slice', async (request) => {
  const query = request.query as { axis?: string; index?: string };
  return slice(query.axis ?? 'axial', Math.max(0, Math.min(95, Number(query.index ?? 42))));
});
app.get('/api/workflow', async () => buildWorkflow());
app.get('/api/annotations', async () => annotations);

app.post('/api/annotations', async (request) => {
  const body = request.body as Omit<Annotation, 'id' | 'createdAt' | 'confidence' | 'reviewStatus' | 'reviewHistory'>;
  const nextNumber = annotations.reduce((max, item) => {
    const number = Number(item.id.replace(/^D-/, ''));
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 31) + 1;
  const item: Annotation = {
    ...body,
    id: `D-${String(nextNumber).padStart(3, '0')}`,
    confidence: +(0.62 + Math.random() * .34).toFixed(2),
    reviewStatus: 'unreviewed',
    reviewHistory: [],
    createdAt: new Date().toISOString()
  };
  annotations = [item, ...annotations];
  return item;
});

app.post('/api/annotations/:id/review', async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const body = request.body as { status?: string; reviewer?: string; note?: string };
  const item = annotations.find(annotation => annotation.id === id);

  if (!item) {
    return reply.code(404).send({
      ok: false,
      error: 'annotation_not_found',
      message: '标注不存在或已被移除'
    });
  }

  const decision = body.status;
  if (!decision || !isDecision(decision)) {
    return reply.code(400).send({
      ok: false,
      error: 'invalid_review_decision',
      message: '复核接口只接受 accepted 或 rejected 终态判定'
    });
  }

  if (item.reviewStatus === 'accepted' || item.reviewStatus === 'rejected') {
    if (item.reviewStatus === decision) return item;
    return reply.code(409).send({
      ok: false,
      error: 'review_decision_locked',
      message: `该缺陷已判定为 ${item.reviewStatus}，终态记录不能改写`,
      currentStatus: item.reviewStatus
    });
  }

  item.reviewStatus = decision;
  item.reviewer = body.reviewer?.trim() || '王工';
  item.decidedAt = new Date().toISOString();
  if (body.note?.trim()) item.reviewNote = body.note.trim();
  item.reviewHistory.push({
    status: decision,
    reviewer: item.reviewer,
    note: item.reviewNote,
    at: item.decidedAt
  });

  return item;
});

app.delete('/api/annotations/:id', async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const item = annotations.find(annotation => annotation.id === id);

  if (!item) {
    return reply.code(404).send({ ok: false, error: 'annotation_not_found', message: '标注不存在或已被移除' });
  }
  if (isHighRisk(item)) {
    return reply.code(409).send({
      ok: false,
      error: 'high_risk_record_locked',
      message: '高风险缺陷记录必须保留，不能删除'
    });
  }
  if (item.reviewStatus === 'rejected') {
    return reply.code(409).send({
      ok: false,
      error: 'rejected_review_record_locked',
      message: '驳回记录必须保留，不能删除'
    });
  }

  annotations = annotations.filter(annotation => annotation.id !== id);
  return { ok: true };
});

app.get('/api/measurements', async () => annotations.map(item => ({
  annotationId: item.id,
  diameter: item.diameter,
  estimatedVolume: +(4 / 3 * Math.PI * (item.diameter / 2) ** 3).toFixed(2),
  aspectRatio: +(1.1 + item.diameter * .24).toFixed(2),
  tolerance: item.diameter > 2 ? '超出工艺关注阈值' : '在监控范围内'
})));

app.get('/api/compare', async () => ({
  current: {
    scanId: scan.id,
    label: 'VH-017 / 本次扫描',
    defectCount: annotations.length,
    highRisk: annotations.filter(isHighRisk).length
  },
  previous: { scanId: 'valve-housing-016', label: 'VH-016 / 上一炉次', defectCount: 2, highRisk: 0 },
  delta: { defectCount: annotations.length - 2, highRisk: annotations.filter(isHighRisk).length }
}));

app.get('/api/report', async () => {
  const gate = releaseGate();
  return {
    scan,
    workflow: buildWorkflow(),
    summary: stats(),
    annotations,
    releaseGate: gate.status,
    releaseGateReasonCode: gate.reasonCode,
    releaseGateReason: gate.reason,
    releaseBlockers: gate.blockers
  };
});

await app.listen({ port: 6182, host: '127.0.0.1' });
