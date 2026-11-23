import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { downloadFile, getBatch, submitBatchDecision } from '../api';
import { AlarmStatusBadge, BatchStatusBadge, ProcessResultBadge, SeverityBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { PARAMETERS, apiError, fmtNumber, fmtTime } from '../lib/format';

export default function BatchDetail() {
  const { batchNo } = useParams();
  const { canDo } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState('APPROVED');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    const result = await getBatch(batchNo);
    setData(result);
    return result;
  }

  useEffect(() => {
    let timer;
    load()
      .then((result) => {
        if (result?.batch?.status === 'RUNNING') {
          timer = setInterval(async () => {
            try {
              const next = await load();
              if (next?.batch?.status !== 'RUNNING') clearInterval(timer);
            } catch {
              // keep the last good view if one refresh fails
            }
          }, 5000);
        }
      })
      .catch((err) => setError(apiError(err, 'Batch not found')));
    return () => clearInterval(timer);
  }, [batchNo]);

  async function onDecision(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      await submitBatchDecision(batchNo, decision, remarks);
      setRemarks('');
      setMessage('Decision recorded in the audit trail.');
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPdf() {
    setError('');
    try {
      await downloadFile(`/batches/${encodeURIComponent(batchNo)}/report`, `batch-${batchNo}.pdf`);
    } catch (err) {
      setError(apiError(err, 'Could not download the PDF'));
    }
  }

  if (error && !data) return <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>;
  if (!data) return <div className="spinner" />;

  const { batch, alarms, validationErrors } = data;
  const stats = batch.summary?.parameterStats || {};
  const canReview = canDo('QA_DECISION') && batch.status === 'COMPLETE';

  return (
    <div>
      <Link to="/batches" className="text-sm text-primary-600">All batches</Link>
      <div className="page-header flex items-start justify-between gap-4 mt-1">
        <div>
          <h1 className="page-title mono">{batch.batchNo}</h1>
          <p className="page-subtitle">{batch.product} · {batch.machineTag} · {batch.loadKg} kg of {batch.capacityKg} kg</p>
        </div>
        <div className="flex items-center gap-2">
          <BatchStatusBadge status={batch.status} />
          <button className="btn-secondary" onClick={onPdf}>Download PDF</button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
      {message && <div className="mb-4 rounded-lg bg-green-50 text-green-800 px-4 py-3 text-sm">{message}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Info label="Started" value={fmtTime(batch.startedAt)} />
        <Info label="Ended" value={fmtTime(batch.endedAt)} />
        <Info label={batch.status === 'RUNNING' ? 'Elapsed' : 'Duration'} value={batch.summary?.durationMinutes != null ? `${batch.summary.durationMinutes} min` : '—'} />
        <Info label="Process result" value={batch.summary?.processResult ? <ProcessResultBadge result={batch.summary.processResult} /> : (batch.status === 'RUNNING' ? 'In progress' : '—')} />
      </div>

      <section className="card mb-6">
        <div className="card-header">
          <h2 className="font-semibold">Parameter summary</h2>
          {batch.summary?.live && (
            <span className="text-xs text-slate-500">{batch.summary.readingCount} samples so far</span>
          )}
        </div>
        <div className="table-container border-0 rounded-none">
          <table className="data-table">
            <thead>
              <tr><th>Parameter</th><th>Min</th><th>Avg</th><th>Max</th><th>Samples</th></tr>
            </thead>
            <tbody>
              {PARAMETERS.map((param) => {
                const s = stats[param.key];
                return (
                  <tr key={param.key}>
                    <td>{param.name}</td>
                    <td className="mono">{s ? fmtNumber(s.min, param.digits) : '—'}</td>
                    <td className="mono">{s ? fmtNumber(s.avg, param.digits) : '—'}</td>
                    <td className="mono">{s ? fmtNumber(s.max, param.digits) : '—'}</td>
                    <td>{s?.count ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <section className="card">
          <div className="card-header"><h2 className="font-semibold">Alarms ({alarms.length})</h2></div>
          <div className="divide-y divide-slate-100">
            {alarms.length === 0 && <div className="p-5 text-sm text-slate-500">No alarms on this batch.</div>}
            {alarms.map((alarm) => (
              <div key={alarm._id} className="px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{alarm.displayName || alarm.parameter}</span>
                  <span className="flex gap-2"><SeverityBadge severity={alarm.severity} /><AlarmStatusBadge status={alarm.status} /></span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Value {alarm.value} {alarm.unit} · limit {alarm.limitMin}–{alarm.limitMax} · {fmtTime(alarm.startedAt)}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header"><h2 className="font-semibold">QA decision</h2></div>
          <div className="card-body">
            {batch.qaDecision?.decision ? (
              <div className="text-sm space-y-2">
                <div><span className="text-slate-500">Decision:</span> {batch.qaDecision.decision}</div>
                <div><span className="text-slate-500">By:</span> {batch.qaDecision.byName} · {fmtTime(batch.qaDecision.at)}</div>
                <div><span className="text-slate-500">Remarks:</span> {batch.qaDecision.remarks}</div>
              </div>
            ) : canReview ? (
              <form onSubmit={onDecision} className="space-y-3">
                <div>
                  <label className="form-label">Decision</label>
                  <select className="form-select" value={decision} onChange={(e) => setDecision(e.target.value)}>
                    <option value="APPROVED">Approve</option>
                    <option value="REJECTED">Reject</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Remarks (min 5 characters)</label>
                  <textarea className="form-input min-h-24" value={remarks} onChange={(e) => setRemarks(e.target.value)} required minLength={5} />
                </div>
                <button className="btn-primary" disabled={busy || remarks.trim().length < 5}>{busy ? 'Saving…' : 'Sign decision'}</button>
              </form>
            ) : (
              <p className="text-sm text-slate-500">
                {batch.status === 'RUNNING'
                  ? 'This batch is still running. A QA decision is available after drying completes.'
                  : 'Switch to the QA or Admin role to record a decision on a completed batch.'}
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-header"><h2 className="font-semibold">Rejected readings ({validationErrors.length})</h2></div>
        <div className="divide-y divide-slate-100">
          {validationErrors.length === 0 && <div className="p-5 text-sm text-slate-500">No rejected readings.</div>}
          {validationErrors.map((ve) => (
            <div key={ve._id} className="px-5 py-3 text-sm flex justify-between gap-3">
              <span>{ve.parameter} · {String(ve.rejectedValue)} · {ve.reason}</span>
              <span className="text-xs text-slate-500">{fmtTime(ve.ts)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-medium mt-1">{value}</div>
    </div>
  );
}
