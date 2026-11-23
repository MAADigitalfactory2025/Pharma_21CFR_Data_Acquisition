import React, { useEffect, useState } from 'react';
import { downloadFile, getMachines } from '../api';
import { apiError, toLocalInput } from '../lib/format';
import { useAuth } from '../context/AuthContext';

export default function Reports() {
  const { me } = useAuth();
  const canExportExcel = me?.admin === true || (me?.effectivePermissions || me?.permissions || []).includes('GENERATE_EXCEL_REPORT');
  const [machines, setMachines] = useState([]);
  const [machineId, setMachineId] = useState('');
  const [from, setFrom] = useState(toLocalInput(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const [to, setTo] = useState(toLocalInput(new Date()));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMachines().then((list) => {
      setMachines(list);
      if (list[0]) setMachineId(list[0]._id);
    }).catch((err) => setError(apiError(err)));
  }, []);

  async function onExcel(e) {
    e.preventDefault();
    if (!canExportExcel) { setError('Generate Excel Reports permission required'); return; }
    setBusy(true);
    setError('');
    try {
      const machine = machines.find((m) => m._id === machineId);
      await downloadFile('/reports/excel', `fbd-report-${machine?.tag || 'machine'}.xlsx`, {
        machineId,
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
    } catch (err) {
      setError(apiError(err, 'Could not build the Excel report'));
    } finally {
      setBusy(false);
    }
  }

  if (!canExportExcel) return <div className="alert">Generate Excel Reports permission required.</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
        <p className="page-subtitle">Export readings for one machine and a time range. Batch PDFs are on each batch page.</p>
      </div>
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <form onSubmit={onExcel} className="card p-5 max-w-xl space-y-4">
        <div>
          <label className="form-label">Machine</label>
          <select className="form-select" value={machineId} onChange={(e) => setMachineId(e.target.value)} required>
            {machines.map((m) => <option key={m._id} value={m._id}>{m.tag} — {m.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">From</label>
            <input className="form-input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} required />
          </div>
          <div>
            <label className="form-label">To</label>
            <input className="form-input" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} required />
          </div>
        </div>
        <button className="btn-primary" disabled={busy || !machineId}>{busy ? 'Building…' : 'Download Excel'}</button>
      </form>
    </div>
  );
}
