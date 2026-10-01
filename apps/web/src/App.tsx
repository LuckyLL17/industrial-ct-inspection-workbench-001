import { useEffect, useRef, useState } from 'react';

type Axis = 'axial' | 'coronal' | 'sagittal';
type ReviewStatus = 'unreviewed' | 'in_review' | 'accepted' | 'rejected';
type WorkflowStatus = 'done' | 'active' | 'pending' | 'blocked';
type ReleaseGate = 'blocked' | 'ready';

type Slice = {
  axis: string;
  index: number;
  size: number;
  data: number[][];
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
};

type Scan = {
  id: string;
  part: string;
  material: string;
  resolution: string;
  dimensions: string;
  operator: string;
  acquiredAt: string;
  scanner: string;
  lot: string;
  standard: string;
};

type WorkflowStep = {
  id: string;
  label: string;
  status: WorkflowStatus;
  owner: string;
  detail: string;
};

type Summary = {
  defectCount: number;
  criticalCount: number;
  highRiskCount: number;
  pendingReviewCount: number;
  unreviewedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  highRiskRejectedCount: number;
  highRiskPendingReviewCount: number;
  lowRiskPendingReviewCount: number;
  releaseBlockingCount: number;
  totalVolume: number;
  byKind: { kind: string; count: number }[];
};

type ReleaseBlocker = {
  annotationId: string;
  kind: string;
  severity: string;
  reviewStatus: ReviewStatus;
  reason: 'high_risk_rejected' | 'high_risk_not_accepted';
};

type Report = {
  workflow: WorkflowStep[];
  summary: Summary;
  annotations: Annotation[];
  releaseGate: ReleaseGate;
  releaseGateReasonCode: 'high_risk_rejected' | 'high_risk_pending' | 'ready';
  releaseGateReason: string;
  releaseBlockers: ReleaseBlocker[];
};

type Measurement = {
  annotationId: string;
  diameter: number;
  estimatedVolume: number;
  aspectRatio: number;
  tolerance: string;
};

type Compare = {
  current: { defectCount: number; highRisk: number };
  previous: { defectCount: number; highRisk: number };
  delta: { defectCount: number };
};

const reviewStatusLabel: Record<ReviewStatus, string> = {
  unreviewed: '待复核',
  in_review: '复核中',
  accepted: '已接受',
  rejected: '已驳回'
};

const workflowStatusLabel: Record<WorkflowStatus, string> = {
  done: '已完成',
  active: '进行中',
  pending: '待处理',
  blocked: '已阻断'
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) }
  });
  const data = await response.json().catch(() => null) as { message?: string } | null;

  if (!response.ok) {
    throw new Error(data?.message || `请求失败（${response.status}），请稍后重试`);
  }
  return data as T;
}

function SliceView({
  axis,
  index,
  onIndex,
  annotations,
  onMark
}: {
  axis: Axis;
  index: number;
  onIndex: (n: number) => void;
  annotations: Annotation[];
  onMark: (axis: Axis, x: number, y: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [slice, setSlice] = useState<Slice | null>(null);
  const [windowWidth, setWindowWidth] = useState(210);
  const [windowLevel, setWindowLevel] = useState(108);

  useEffect(() => {
    api<Slice>(`/scans/current/slice?axis=${axis}&index=${index}`).then(setSlice);
  }, [axis, index]);

  useEffect(() => {
    if (!slice || !canvas.current) return;
    const ctx = canvas.current.getContext('2d')!;
    const image = ctx.createImageData(slice.size, slice.size);
    slice.data.flat().forEach((raw, i) => {
      const value = Math.max(0, Math.min(255, ((raw - (windowLevel - windowWidth / 2)) / windowWidth) * 255));
      image.data[i * 4] = value;
      image.data[i * 4 + 1] = value;
      image.data[i * 4 + 2] = value;
      image.data[i * 4 + 3] = 255;
    });
    ctx.putImageData(image, 0, 0);
  }, [slice, windowWidth, windowLevel]);

  const marks = annotations.filter(a => a.axis === axis && Math.abs(a.index - index) < 3);

  return (
    <div className="view">
      <div className="view-head">
        <b>{axis === 'axial' ? '轴向 Axial' : axis === 'coronal' ? '冠状 Coronal' : '矢状 Sagittal'}</b>
        <span>Slice {index} / 95</span>
      </div>
      <div
        className="image-wrap"
        onClick={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          onMark(
            axis,
            ((event.clientX - rect.left) / rect.width) * 96,
            ((event.clientY - rect.top) / rect.height) * 96
          );
        }}
      >
        <canvas ref={canvas} width="96" height="96" />
        {marks.map(annotation => (
          <div
            className={`mark ${annotation.severity} ${annotation.reviewStatus}`}
            key={annotation.id}
            style={{ left: `${annotation.x / 96 * 100}%`, top: `${annotation.y / 96 * 100}%` }}
          >
            <i />
            <span>{annotation.id}</span>
          </div>
        ))}
        <div className="cross v" />
        <div className="cross h" />
      </div>
      <input type="range" min="0" max="95" value={index} onChange={event => onIndex(+event.target.value)} />
      <div className="window">
        <label>
          窗宽 {windowWidth}
          <input type="range" min="80" max="255" value={windowWidth} onChange={event => setWindowWidth(+event.target.value)} />
        </label>
        <label>
          窗位 {windowLevel}
          <input type="range" min="30" max="210" value={windowLevel} onChange={event => setWindowLevel(+event.target.value)} />
        </label>
      </div>
    </div>
  );
}

export default function App() {
  const [scan, setScan] = useState<Scan>();
  const [anns, setAnns] = useState<Annotation[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>([]);
  const [summary, setSummary] = useState<Summary>();
  const [report, setReport] = useState<Report>();
  const [compare, setCompare] = useState<Compare>();
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [indices, setIndices] = useState<Record<Axis, number>>({ axial: 42, coronal: 37, sagittal: 51 });
  const [kind, setKind] = useState('孔隙');
  const [severity, setSeverity] = useState('中');
  const [note, setNote] = useState('待复核缺陷');
  const [tab, setTab] = useState<'viewer' | 'review' | 'release'>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const latestLoad = useRef(0);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const loadId = ++latestLoad.current;
    setError(null);
    setLoading(true);

    try {
      const [scanResult, annotationsResult, reportResult, measurementsResult, compareResult] = await Promise.all([
        api<Scan>('/scans/current'),
        api<Annotation[]>('/annotations'),
        api<Report>('/report'),
        api<Measurement[]>('/measurements'),
        api<Compare>('/compare')
      ]);

      if (loadId !== latestLoad.current) return;
      setScan(scanResult);
      setAnns(annotationsResult);
      setWorkflow(reportResult.workflow);
      setSummary(reportResult.summary);
      setReport(reportResult);
      setMeasurements(measurementsResult);
      setCompare(compareResult);
    } catch (err) {
      if (loadId === latestLoad.current) {
        setError(err instanceof Error ? err.message : '报告读取失败，请重试');
      }
    } finally {
      if (loadId === latestLoad.current) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const mark = async (axis: Axis, x: number, y: number) => {
    try {
      await api('/annotations', {
        method: 'POST',
        body: JSON.stringify({
          axis,
          index: indices[axis],
          x: +x.toFixed(1),
          y: +y.toFixed(1),
          kind,
          severity,
          note,
          diameter: +(0.5 + Math.random() * 2.2).toFixed(2)
        })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '标注创建失败，请重试');
    }
  };

  const review = async (id: string, status: 'accepted' | 'rejected') => {
    const action = `${id}:${status}`;
    if (busyAction) return;

    setBusyAction(action);
    setError(null);
    try {
      await api(`/annotations/${id}/review`, {
        method: 'POST',
        body: JSON.stringify({ status, reviewer: '王工' })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '复核提交失败，请重试');
      await load();
    } finally {
      setBusyAction(current => (current === action ? null : current));
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/annotations/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败：该记录必须保留');
    }
  };

  const canDelete = (annotation: Annotation) => annotation.severity !== '高' && annotation.reviewStatus !== 'rejected';
  const isDecisionLocked = (annotation: Annotation) => annotation.reviewStatus === 'accepted' || annotation.reviewStatus === 'rejected';
  const releaseGate = report?.releaseGate;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <div className="mark-logo">◉</div>
          <div>
            <small>INDUSTRIAL CT / DIGITAL QUALITY WORKSPACE</small>
            <h1>CT Inspect <i>·</i> 无损检测阅片与复核</h1>
          </div>
        </div>
        <div className="status">
          <span>工作流 待复核 {summary?.pendingReviewCount ?? '—'}</span>
          {releaseGate && (
            <span className={`gate-pill ${releaseGate}`}>
              {releaseGate === 'blocked' ? '签发阻断' : '可签发'}
            </span>
          )}
          <b>{scan?.part}</b>
          <button onClick={() => setTab('release')}>签发检查</button>
        </div>
      </header>

      <main>
        <section className="viewer">
          <div className="viewer-head">
            <div>
              <small>MULTIPLANAR RECONSTRUCTION / DEFECT REVIEW</small>
              <h2>{scan?.part ?? '加载扫描…'}</h2>
            </div>
            <div className="specs">
              <span>{scan?.material}</span>
              <span>{scan?.resolution}</span>
              <span>{scan?.scanner}</span>
            </div>
          </div>

          <nav className="tabs">
            <button className={tab === 'viewer' ? 'active' : ''} onClick={() => setTab('viewer')}>三视图阅片</button>
            <button className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>缺陷复核</button>
            <button className={tab === 'release' ? 'active' : ''} onClick={() => setTab('release')}>质量签发</button>
          </nav>

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={load}>重新读取报告</button>
            </div>
          )}

          {tab === 'viewer' && (
            <>
              <div className="views">
                <SliceView axis="axial" index={indices.axial} onIndex={n => setIndices(s => ({ ...s, axial: n }))} annotations={anns} onMark={mark} />
                <SliceView axis="coronal" index={indices.coronal} onIndex={n => setIndices(s => ({ ...s, coronal: n }))} annotations={anns} onMark={mark} />
                <SliceView axis="sagittal" index={indices.sagittal} onIndex={n => setIndices(s => ({ ...s, sagittal: n }))} annotations={anns} onMark={mark} />
              </div>
              <div className="help">
                <span>点击切片创建当前类型标注</span>
                <span>支持窗宽、窗位与多视图切片联动</span>
                <span>{scan?.standard} · {scan?.lot}</span>
              </div>
            </>
          )}

          {tab === 'review' && (
            <div className="review-layout">
              <div className="review-table">
                <small>REVIEW QUEUE</small>
                <h3>缺陷复核队列</h3>
                {anns.map(annotation => {
                  const locked = isDecisionLocked(annotation);
                  const busy = busyAction?.startsWith(`${annotation.id}:`);
                  return (
                    <div className={`review-row ${annotation.reviewStatus}`} key={annotation.id}>
                      <span className={`severity ${annotation.severity}`} />
                      <div>
                        <b>
                          {annotation.id} · {annotation.kind} · {annotation.diameter} mm
                          {annotation.severity === '高' && <em className="risk-tag">高风险</em>}
                        </b>
                        <small>
                          {annotation.axis} / Slice {annotation.index} · 置信度 {Math.round(annotation.confidence * 100)}% · {annotation.note}
                          {annotation.reviewNote && ` · 复核意见：${annotation.reviewNote}`}
                        </small>
                      </div>
                      <strong className={`status-pill ${annotation.reviewStatus}`}>{reviewStatusLabel[annotation.reviewStatus]}</strong>
                      <button
                        disabled={locked || busyAction !== null}
                        onClick={() => review(annotation.id, 'accepted')}
                      >
                        {busy && busyAction?.endsWith('accepted') ? '提交中…' : '接受'}
                      </button>
                      <button
                        className="reject"
                        disabled={locked || busyAction !== null}
                        onClick={() => review(annotation.id, 'rejected')}
                      >
                        {busy && busyAction?.endsWith('rejected') ? '提交中…' : '驳回'}
                      </button>
                    </div>
                  );
                })}
                {summary && summary.lowRiskPendingReviewCount > 0 && (
                  <p className="rule-note">低风险待复核 {summary.lowRiskPendingReviewCount} 个：接受或驳回都会退出待处理队列；低风险不单独阻断签发。</p>
                )}
              </div>

              <div className="measurement-card">
                <small>MEASUREMENT PIPELINE</small>
                <h3>缺陷尺寸与工艺阈值</h3>
                {measurements.map(measurement => (
                  <div className="measurement" key={measurement.annotationId}>
                    <span>{measurement.annotationId}</span>
                    <b>Ø {measurement.diameter} mm / {measurement.estimatedVolume} mm³</b>
                    <em>{measurement.tolerance}</em>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'release' && (
            <div className="release">
              <div className="release-card">
                <small>INSPECTION WORKFLOW</small>
                <h3>检测流程门禁</h3>
                {workflow.map(step => (
                  <div className="workflow" key={step.id}>
                    <span className={step.status} />
                    <div>
                      <b>{step.label}</b>
                      <small>{step.owner} · {step.detail}</small>
                    </div>
                    <em>{workflowStatusLabel[step.status]}</em>
                  </div>
                ))}
                <div className={`release-gate ${releaseGate ?? ''}`}>
                  <b>{releaseGate === 'blocked' ? '阻断：报告不能签发' : '可签发：当前检测门禁满足'}</b>
                  <span>{report?.releaseGateReason ?? '正在读取服务端门禁…'}</span>
                </div>
              </div>

              <div className="release-card">
                <small>BATCH COMPARISON</small>
                <h3>与上一炉次对比</h3>
                <div className="batch-compare">
                  <div>
                    <span>当前批次</span>
                    <b>{compare?.current?.defectCount} 个缺陷 / {compare?.current?.highRisk} 高风险</b>
                  </div>
                  <div>
                    <span>上一炉次</span>
                    <b>{compare?.previous?.defectCount} 个缺陷 / {compare?.previous?.highRisk} 高风险</b>
                  </div>
                  <div>
                    <span>变化</span>
                    <b className={compare?.delta?.defectCount && compare.delta.defectCount > 0 ? 'warn' : ''}>
                      {compare?.delta?.defectCount && compare.delta.defectCount > 0 ? '+' : ''}{compare?.delta?.defectCount} 个
                    </b>
                  </div>
                </div>
                <button
                  className="release-button"
                  disabled={releaseGate !== 'ready'}
                  onClick={() => alert('已生成检测报告草稿，待质量负责人电子签名')}
                >
                  {releaseGate === 'blocked' ? '门禁阻断，不能生成报告' : '生成报告草稿'}
                </button>
              </div>
            </div>
          )}
        </section>

        <aside>
          <section className="panel">
            <small>ANNOTATION TOOL</small>
            <h3>缺陷标注参数</h3>
            <label>
              缺陷类别
              <select value={kind} onChange={event => setKind(event.target.value)}>
                <option>孔隙</option>
                <option>裂纹</option>
                <option>夹杂</option>
                <option>未熔合</option>
              </select>
            </label>
            <label>
              严重度
              <select value={severity} onChange={event => setSeverity(event.target.value)}>
                <option>低</option>
                <option>中</option>
                <option>高</option>
              </select>
            </label>
            <label>
              复核意见
              <textarea value={note} onChange={event => setNote(event.target.value)} />
            </label>
            <p>设置参数后，在三视图任意位置点击，系统会创建带坐标、切片、置信度和复核状态的缺陷实体。</p>
          </section>

          <section className="panel">
            <div className="title-row">
              <div>
                <small>DEFECT LAYERS</small>
                <h3>缺陷图层</h3>
              </div>
              <b>{anns.length}</b>
            </div>
            <div className="defects">
              {anns.map(annotation => {
                const locked = !canDelete(annotation);
                return (
                  <div className="defect" key={annotation.id}>
                    <span className={`severity ${annotation.severity}`} />
                    <div>
                      <b>{annotation.id} · {annotation.kind}</b>
                      <small>
                        {annotation.axis} / Slice {annotation.index} · Ø {annotation.diameter} mm · {reviewStatusLabel[annotation.reviewStatus]}
                      </small>
                      <em>{annotation.note}</em>
                    </div>
                    <button
                      title={locked ? '高风险或已驳回记录必须保留' : '删除标注'}
                      disabled={locked}
                      onClick={() => remove(annotation.id)}
                    >
                      {locked ? '🔒' : '×'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel summary">
            <small>INSPECTION SUMMARY</small>
            <div>
              <span>扫描操作员</span>
              <b>{scan?.operator ?? '—'}</b>
            </div>
            <div>
              <span>缺陷总数 / 高风险</span>
              <b>{summary?.defectCount ?? '—'} / {summary?.criticalCount ?? '—'}</b>
            </div>
            <div>
              <span>待复核 / 已驳回</span>
              <b>{summary?.pendingReviewCount ?? '—'} / {summary?.rejectedCount ?? '—'}</b>
            </div>
            <div>
              <span>签发阻断项</span>
              <b className={summary?.releaseBlockingCount ? 'warn' : ''}>{summary?.releaseBlockingCount ?? '—'}</b>
            </div>
            <div>
              <span>总体积</span>
              <b>{summary?.totalVolume ?? '—'} mm³</b>
            </div>
            <div>
              <span>批次</span>
              <b>{scan?.lot ?? '—'}</b>
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}
