import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBatches, getMachines, createBatch, closeBatch } from '../api';
import { useAuth } from '../context/AuthContext';
import { BatchStatusBadge, ProcessResultBadge } from '../components/StatusBadge';
import { apiError, fmtTime } from '../lib/format';

export default function Batches({ machineId: selectedMachineId }) {
  const { canDo } = useAuth();
  const [machines, setMachines] = useState([]);
  const [newMachine, setNewMachine] = useState(selectedMachineId || '');
  const [newProduct, setNewProduct] = useState('');
  const [newLoad, setNewLoad] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  async function registerBatch(e) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { const result = await createBatch(selectedMachineId || newMachine, newProduct.trim(), Number(newLoad));
      setNotice(`Batch ${result.batch.batchNo} registered. Incoming readings are now associated automatically.`);
      setNewProduct(''); setNewLoad(''); setRefresh(v => v + 1);
    } catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  }
  async function finishBatch(batchNo) {
    if (!window.confirm(`Close batch ${batchNo}? Subsequent readings will no longer be associated.`)) return;
    setBusy(true); setError('');
    try { await closeBatch(batchNo); setNotice(`Batch ${batchNo} closed.`); setRefresh(v => v + 1); }
    catch (err) { setError(apiError(err)); } finally { setBusy(false); }
  }
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [machineId, setMachineId] = useState(selectedMachineId || '');
  const [error, setError] = useState('');

  useEffect(() => {
    getMachines().then(setMachines).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    getBatches({ page, pageSize: 15, status: status || undefined, machineId: selectedMachineId || machineId || undefined })
      .then((data) => {
        if (cancelled) return;
        setRows(data.batches || []);
        setTotal(data.total || 0);
      })
      .catch((err) => { if (!cancelled) setError(apiError(err)); });
    return () => { cancelled = true; };
  }, [page, status, machineId, selectedMachineId, refresh]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Batches</h1>
        <p className="page-subtitle">{total} batch records. Register a batch to associate incoming machine readings immediately. No Start Batch step is required.</p>
      </div>
      {canDo('CREATE_BATCH') && <form onSubmit={registerBatch} className="card mb-4 p-4 flex flex-wrap gap-3 items-end">
        <div><label className="form-label">Machine</label><select className="form-select" required disabled={!!selectedMachineId} value={selectedMachineId || newMachine} onChange={e => setNewMachine(e.target.value)}><option value="">Select machine</option>{machines.map(m => <option key={m._id} value={m._id}>{m.tag}</option>)}</select></div>
        <div><label className="form-label">Product</label><input className="form-input" required minLength={2} value={newProduct} onChange={e => setNewProduct(e.target.value)} placeholder="Product name" /></div>
        <div><label className="form-label">Load (kg)</label><input className="form-input" type="number" min="0.01" step="any" required value={newLoad} onChange={e => setNewLoad(e.target.value)} /></div>
        <button className="btn-primary" disabled={busy}>Create Batch</button>
      </form>}
      {notice && <p className="mb-4 text-green-700">{notice}</p>}
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}

      <div className="flex gap-3 mb-4">
        <select className="form-select w-48" disabled={!!selectedMachineId} value={selectedMachineId || machineId} onChange={(e) => { setPage(1); setMachineId(e.target.value); }}>
          <option value="">All machines</option>
          {machines.map((m) => <option key={m._id} value={m._id}>{m.tag}</option>)}
        </select>
        <select className="form-select w-44" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
          <option value="">All statuses</option>
          <option value="RUNNING">Running</option>
          <option value="COMPLETE">Complete</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      <div className="table-container bg-white">
        <table className="data-table">
          <thead>
            <tr>
              <th>Batch</th>
              <th>Machine</th>
              <th>Product</th>
              <th>Load</th>
              <th>Started</th>
              <th>Result</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((batch) => (
              <tr key={batch.batchNo}>
                <td><Link className="text-primary-600 font-medium mono" to={`/batches/${encodeURIComponent(batch.batchNo)}`}>{batch.batchNo}</Link></td>
                <td>{batch.machineTag}</td>
                <td>{batch.product}</td>
                <td>{batch.loadKg} kg</td>
                <td>{fmtTime(batch.startedAt)}</td>
                <td>{batch.summary?.processResult ? <ProcessResultBadge result={batch.summary.processResult} /> : '—'}</td>
                <td><BatchStatusBadge status={batch.status} /></td>
                <td>{batch.status === 'RUNNING' && canDo('CLOSE_BATCH') && <button className="btn-secondary btn-sm" disabled={busy} onClick={() => finishBatch(batch.batchNo)}>Close Batch</button>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="text-slate-500">No batches match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      <Pager page={page} total={total} pageSize={15} onPage={setPage} />
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
      <span>Page {page} of {pages}</span>
      <div className="flex gap-2">
        <button className="btn-secondary btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn-secondary btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
