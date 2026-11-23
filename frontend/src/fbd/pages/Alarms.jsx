import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getAlarms, reviewAlarm } from '../api';
import { AlarmStatusBadge, SeverityBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { apiError, fmtTime } from '../lib/format';
import { Pager } from './Batches';

export default function Alarms({ machineId }) {
  const { canDo } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [reviewId, setReviewId] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    return getAlarms({ page, pageSize: 15, machineId, status: status || undefined }).then((data) => {
      setRows(data.alarms || []);
      setTotal(data.total || 0);
    });
  }

  useEffect(() => {
    load().catch((err) => setError(apiError(err)));
  }, [page, status, machineId]);

  async function onReview(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await reviewAlarm(reviewId, remarks);
      setReviewId(null);
      setRemarks('');
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Alarms</h1>
        <p className="page-subtitle">Process-limit violations. QA review remarks are written to the audit trail.</p>
      </div>
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <select className="form-select w-44 mb-4" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
        <option value="">All statuses</option>
        <option value="OPEN">Open</option>
        <option value="CLOSED">Closed</option>
        <option value="REVIEWED">Reviewed</option>
      </select>

      <div className="table-container bg-white">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Machine</th>
              <th>Batch</th>
              <th>Parameter</th>
              <th>Value</th>
              <th>Limit</th>
              <th>Severity</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((alarm) => (
              <React.Fragment key={alarm._id}>
                <tr>
                  <td>{fmtTime(alarm.startedAt)}</td>
                  <td>{alarm.machineTag}</td>
                  <td>{alarm.batchNo ? <Link className="text-primary-600 mono" to={`/batches/${encodeURIComponent(alarm.batchNo)}`}>{alarm.batchNo}</Link> : '—'}</td>
                  <td>{alarm.displayName || alarm.parameter}</td>
                  <td className="mono">{alarm.peakValue ?? alarm.value} {alarm.unit}</td>
                  <td className="mono">{alarm.limitMin}–{alarm.limitMax}</td>
                  <td><SeverityBadge severity={alarm.severity} /></td>
                  <td><AlarmStatusBadge status={alarm.status} /></td>
                  <td>
                    {canDo('REVIEW_ALARM') && alarm.status !== 'REVIEWED' && (
                      <button className="btn-secondary btn-sm" onClick={() => { setReviewId(alarm._id); setRemarks(''); }}>Review</button>
                    )}
                  </td>
                </tr>
                {reviewId === alarm._id && (
                  <tr>
                    <td colSpan={9}>
                      <form onSubmit={onReview} className="flex gap-2 items-end">
                        <div className="flex-1">
                          <label className="form-label">Remarks</label>
                          <input className="form-input" value={remarks} minLength={5} required onChange={(e) => setRemarks(e.target.value)} placeholder="Why this alarm is accepted or what action was taken" />
                        </div>
                        <button className="btn-primary" disabled={busy || remarks.trim().length < 5}>Save review</button>
                        <button type="button" className="btn-secondary" onClick={() => setReviewId(null)}>Cancel</button>
                      </form>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="text-slate-500">No alarms.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={total} pageSize={15} onPage={setPage} />
    </div>
  );
}
