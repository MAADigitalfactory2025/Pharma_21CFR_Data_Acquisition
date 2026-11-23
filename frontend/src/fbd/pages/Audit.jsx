import React, { useEffect, useState } from 'react';
import { getReadings, getAuditLogs } from '../api';
import { PARAMETERS, apiError, fmtTime } from '../lib/format';

export default function Audit({ machineId }) {
  const [rows, setRows] = useState([]);
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!machineId) return;
    let active = true;
    getAuditLogs({ machineId, pageSize: 200 }).then(result => { if (active) setEvents((result.logs || []).filter(e => (e.newValue?.machineIds || []).includes(String(machineId)))); }).catch(err => { if (active) setError(apiError(err)); });
    getReadings({ machineId, limit: 500 }).then(result => {
      if (active) setRows((result.readings || []).filter(r => String(r.machineId) === String(machineId)).reverse());
    }).catch(err => { if (active) setError(apiError(err)); });
    return () => { active = false; };
  }, [machineId]);
  return <div>
    <h1 className="page-title">Machine reading log</h1>
    <p className="page-subtitle">Only this machine's readings. Limits shown are snapshots recorded at acquisition time, not today's recalculated values.</p>
    {error && <div className="alert">{error}</div>}
    <h2>Machine limit-change audit trail</h2>
    <div className="table-container bg-white"><table className="data-table"><thead><tr><th>Timestamp</th><th>Action</th><th>Username</th><th>Details</th><th>Reason</th></tr></thead><tbody>{events.map(e => <tr key={e._id}><td>{fmtTime(e.ts)}</td><td>{e.action}</td><td>{e.userName}</td><td><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(e.newValue, null, 2)}</pre></td><td>{e.reason || '—'}</td></tr>)}</tbody></table>{!events.length && <p className="empty">No machine-specific limit events recorded yet.</p>}</div>
    <div className="table-container bg-white"><table className="data-table">
      <thead><tr><th>Timestamp</th><th>Batch</th><th>Parameter</th><th>Reading</th><th>Absolute limits</th><th>Dynamic limits</th><th>Samples</th></tr></thead>
      <tbody>{rows.flatMap(r => PARAMETERS.filter(p => Number.isFinite(r.values?.[p.key])).map(p => {
        const snap = r.limitSnapshots?.[p.key];
        const absolute = snap?.absolute;
        const ready = snap && snap.sampleCount >= 30 && Number.isFinite(snap.lowerDynamicLimit) && Number.isFinite(snap.upperDynamicLimit);
        return <tr key={`${r._id}-${p.key}`}><td>{fmtTime(r.ts)}</td><td>{r.batchNo || '—'}</td><td>{p.name}</td><td>{r.values[p.key]} {p.unit}</td>
          <td>{absolute ? `${absolute.lower} – ${absolute.upper} ${p.unit} (v${absolute.version})` : 'Not recorded'}</td>
          <td>{ready ? `${snap.lowerDynamicLimit.toFixed(2)} – ${snap.upperDynamicLimit.toFixed(2)} ${p.unit}` : 'Insufficient data / not recorded'}</td>
          <td>{snap?.sampleCount ?? '—'}</td></tr>;
      }))}</tbody>
    </table>{rows.length === 0 && <p className="empty">No readings recorded for this machine.</p>}</div>
  </div>;
}
