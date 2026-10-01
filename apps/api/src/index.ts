import Fastify from 'fastify';
import cors from '@fastify/cors';
const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

type ReviewStatus = 'unreviewed' | 'in_review' | 'accepted' | 'rejected';
type Annotation = { id: string; axis: string; index: number; x: number; y: number; kind: string; severity: string; note: string; diameter: number; confidence: number; reviewStatus: ReviewStatus; reviewer?: string; createdAt: string };
const scan = { id: 'valve-housing-017', part: '液压阀体 / VH-017', material: 'AlSi10Mg', resolution: '42 μm', dimensions: '128 × 128 × 96 voxels', operator: '张工', acquiredAt: '2026-09-30 08:42', scanner: 'Phoenix v|tome|x M 300', lot: 'LOT-2026-09-A17', standard: 'ASTM E1441' };
let annotations: Annotation[] = [
  { id: 'D-024', axis: 'axial', index: 42, x: 57, y: 39, kind: '孔隙', severity: '中', note: '疑似缩孔，建议复核', diameter: 1.86, confidence: .91, reviewStatus: 'in_review', reviewer: '王工', createdAt: '2026-09-30T09:12:00.000Z' },
  { id: 'D-031', axis: 'coronal', index: 37, x: 31, y: 61, kind: '夹杂', severity: '低', note: '边缘夹杂', diameter: .72, confidence: .74, reviewStatus: 'unreviewed', createdAt: '2026-09-30T09:18:00.000Z' },
  { id: 'D-044', axis: 'sagittal', index: 51, x: 64, y: 47, kind: '裂纹', severity: '高', note: '线性高密度异常，需二次扫描确认', diameter: 3.42, confidence: .68, reviewStatus: 'unreviewed', createdAt: '2026-09-30T09:27:00.000Z' }
];
// 统一复核状态机：高风险缺陷只有明确「接受」才算处置完成（驳回仍阻断签发且记录保留）；
// 其余严重度沿用原规则，「接受」或「驳回」均视为已处置。统计、门禁、报告、工作流全部由此派生。
const REVIEW_STATUSES: ReviewStatus[] = ['unreviewed', 'in_review', 'accepted', 'rejected'];
const HIGH_SEVERITY = '高';
function isPending(item: Annotation) {
  if (item.reviewStatus === 'accepted') return false;
  if (item.severity === HIGH_SEVERITY) return true;
  return item.reviewStatus !== 'rejected';
}
function releaseGate() {
  return annotations.some(item => item.severity === HIGH_SEVERITY && item.reviewStatus !== 'accepted') ? 'blocked' : 'ready';
}
function workflowState() {
  const pendingCount = annotations.filter(isPending).length;
  const gate = releaseGate();
  return [
    { id: 'ingest', label: '数据接收', status: 'done', owner: '系统', detail: '原始 DICOM 序列已校验' },
    { id: 'reconstruct', label: '体数据重建', status: 'done', owner: '算法服务', detail: '96 层切片已生成' },
    { id: 'primary', label: '初检标注', status: 'active', owner: '张工', detail: `当前 ${annotations.length} 个候选缺陷` },
    { id: 'review', label: '二次复核', status: pendingCount ? 'active' : 'done', owner: '王工', detail: pendingCount ? `待处置 ${pendingCount} 项（高风险须明确接受）` : '复核队列已清空' },
    { id: 'release', label: '报告签发', status: gate === 'ready' ? 'active' : 'pending', owner: '质量负责人', detail: gate === 'ready' ? '门禁满足，可签发' : '阻断：高风险缺陷未明确接受' }
  ];
}
function slice(axis: string, index: number) { const size = 96; const data: number[][] = []; for (let y = 0; y < size; y++) { const row: number[] = []; for (let x = 0; x < size; x++) { const dx = x - 48, dy = y - 48; const shell = Math.sqrt(dx * dx + dy * dy); let value = 12 + Math.max(0, 1 - Math.abs(shell - 31) / 9) * 130 + Math.max(0, 1 - Math.abs(shell - 14) / 5) * 48; value += 16 * Math.sin((x + index) * .17) * Math.cos((y - index) * .12); const hole = (x - (57 + Math.sin(index * .15) * 4)) ** 2 + (y - (39 + Math.cos(index * .1) * 3)) ** 2; if (hole < 28 + (index - 42) ** 2 * .7) value = 8; const inclusion = (x - 30) ** 2 + (y - 61) ** 2; if (inclusion < 13 && axis !== 'sagittal') value = 220; row.push(Math.max(0, Math.min(255, Math.round(value)))); } data.push(row); } return { axis, index, size, data }; }
function stats() { return { defectCount: annotations.length, criticalCount: annotations.filter(item => item.severity === HIGH_SEVERITY).length, unreviewedCount: annotations.filter(isPending).length, totalVolume: +annotations.reduce((sum, item) => sum + 4 / 3 * Math.PI * (item.diameter / 2) ** 3, 0).toFixed(2), byKind: Object.entries(annotations.reduce<Record<string, number>>((out, item) => { out[item.kind] = (out[item.kind] ?? 0) + 1; return out; }, {})).map(([kind, count]) => ({ kind, count })) }; }
app.get('/api/health', async () => ({ status: 'ok', service: 'ct-inspection-workbench', version: '0.8.0' }));
app.get('/api/scans/current', async () => scan);
app.get('/api/scans/current/slice', async (request) => { const query = request.query as { axis?: string; index?: string }; return slice(query.axis ?? 'axial', Math.max(0, Math.min(95, Number(query.index ?? 42)))); });
app.get('/api/workflow', async () => workflowState());
app.get('/api/annotations', async () => annotations);
app.post('/api/annotations', async (request) => { const body = request.body as Omit<Annotation, 'id' | 'createdAt' | 'confidence' | 'reviewStatus'>; const item: Annotation = { ...body, id: `D-${String(annotations.length + 32).padStart(3, '0')}`, confidence: +(0.62 + Math.random() * .34).toFixed(2), reviewStatus: 'unreviewed', createdAt: new Date().toISOString() }; annotations = [item, ...annotations]; return item; });
app.post('/api/annotations/:id/review', async (request, reply) => {
  const id = (request.params as { id: string }).id;
  const body = request.body as { status?: ReviewStatus; reviewer?: string; note?: string };
  const item = annotations.find(annotation => annotation.id === id);
  if (!item) return reply.code(404).send({ ok: false, error: 'annotation_not_found' });
  if (!body?.status || !REVIEW_STATUSES.includes(body.status)) return reply.code(400).send({ ok: false, error: 'invalid_review_status', allowed: REVIEW_STATUSES });
  // 幂等写入：复核成功、重复点击或失败重试提交同一状态，结果都收敛到同一状态机
  item.reviewStatus = body.status;
  item.reviewer = body.reviewer ?? '王工';
  if (body.note) item.note = body.note;
  return item;
});
app.delete('/api/annotations/:id', async (request) => { const id = (request.params as { id: string }).id; annotations = annotations.filter(item => item.id !== id); return { ok: true }; });
app.get('/api/measurements', async () => annotations.map(item => ({ annotationId: item.id, diameter: item.diameter, estimatedVolume: +(4 / 3 * Math.PI * (item.diameter / 2) ** 3).toFixed(2), aspectRatio: +(1.1 + item.diameter * .24).toFixed(2), tolerance: item.diameter > 2 ? '超出工艺关注阈值' : '在监控范围内' })));
app.get('/api/compare', async () => ({ current: { scanId: scan.id, label: 'VH-017 / 本次扫描', defectCount: annotations.length, highRisk: annotations.filter(item => item.severity === '高').length }, previous: { scanId: 'valve-housing-016', label: 'VH-016 / 上一炉次', defectCount: 2, highRisk: 0 }, delta: { defectCount: annotations.length - 2, highRisk: annotations.filter(item => item.severity === '高').length } }));
app.get('/api/report', async () => ({ scan, workflow: workflowState(), summary: stats(), annotations, releaseGate: releaseGate() }));
await app.listen({ port: 6182, host: '127.0.0.1' });
