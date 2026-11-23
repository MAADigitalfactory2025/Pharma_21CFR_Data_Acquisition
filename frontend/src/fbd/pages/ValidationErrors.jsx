import React, { useEffect, useState } from 'react';
import { getValidationErrors } from '../api';
import { apiError, fmtTime } from '../lib/format';
import { Pager } from './Batches';

const REASONS = ['NULL_VALUE', 'NOT_NUMERIC', 'OUT_OF_SENSOR_RANGE', 'SPIKE', 'STUCK'];

export default function ValidationErrors({ machineId }) {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    getValidationErrors({ page, pageSize: 20, machineId, reason: reason || undefined })
      .then((data) => {
        setRows(data.errors || []);
        setTotal(data.total || 0);
      })
      .catch((err) => setError(apiError(err)));
  }, [page, reason, machineId]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Validation errors</h1>
        <p className="page-subtitle">Readings rejected before storage: nulls, spikes, stuck sensors, and values outside the sensor range.</p>
      </div>
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <select className="form-select w-64 mb-4" value={reason} onChange={(e) => { setPage(1); setReason(e.target.value); }}>
        <option value="">All reasons</option>
        {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>

      <div className="table-container bg-white">
        <table className="data-table">
          <thead>
            <tr><th>Time</th><th>Machine</th><th>Batch</th><th>Parameter</th><th>Rejected value</th><th>Reason</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row._id}>
                <td>{fmtTime(row.ts)}</td>
                <td>{row.machineTag}</td>
                <td className="mono">{row.batchNo || '—'}</td>
                <td>{row.parameter}</td>
                <td className="mono">{row.rejectedValue == null ? 'null' : String(row.rejectedValue)}</td>
                <td><span className="badge-warn">{row.reason}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="text-slate-500">No validation errors.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={total} pageSize={20} onPage={setPage} />
    </div>
  );
}
