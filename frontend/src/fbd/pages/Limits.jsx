import React, { useEffect, useMemo, useState } from 'react';
import { getMachine, createProductLimits, getLimits, updateLimit } from '../api';
import { SeverityBadge } from '../components/StatusBadge';
import { useAuth } from '../context/AuthContext';
import { apiError } from '../lib/format';

export default function Limits({ machineId }) {
  const { canDo } = useAuth();
  const [rows, setRows] = useState([]);
  const [model, setModel] = useState('');
  useEffect(() => { if (machineId) getMachine(machineId).then(m => setModel(m.model)).catch(err => setError(apiError(err))); }, [machineId]);
  const [product, setProduct] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(null);
  const [limitMin, setLimitMin] = useState('');
  const [limitMax, setLimitMax] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [newProduct, setNewProduct] = useState('');
  const [newModel, setNewModel] = useState('FBD-5');
  const [copyFrom, setCopyFrom] = useState('');
  const [newReason, setNewReason] = useState('');

  function load() {
    return getLimits({
      machineModel: model || undefined,
      product: product || undefined,
    }).then(setRows);
  }

  useEffect(() => {
    load().catch((err) => setError(apiError(err)));
  }, [model, product]);

  const products = useMemo(() => {
    const names = new Set(rows.map((row) => row.product).filter(Boolean));
    return [...names].sort();
  }, [rows]);

  useEffect(() => {
    if (!copyFrom && products.length) setCopyFrom(products[0]);
  }, [products, copyFrom]);

  function startEdit(row) {
    setEditing(row._id);
    setLimitMin(String(row.limitMin));
    setLimitMax(String(row.limitMax));
    setReason('');
    setMessage('');
    setError('');
  }

  async function onSave(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await updateLimit(editing, Number(limitMin), Number(limitMax), reason);
      setEditing(null);
      setMessage('New limit version saved. Previous version remains in history.');
      await load();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onAddProduct(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await createProductLimits(newProduct.trim(), newModel, copyFrom, newReason);
      setNewProduct('');
      setNewReason('');
      setProduct('');
      setMessage('Medicine added. Adjust each parameter — the copy is only a starting band.');
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
        <h1 className="page-title">Process limits</h1>
        <p className="page-subtitle">
          Each medicine has its own band on FBD-5, FBD-10 and FBD-450. A change creates a new version and never overwrites the old one.
        </p>
      </div>
      {error && <div className="mb-4 rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>}
      {message && <div className="mb-4 rounded-lg bg-green-50 text-green-800 px-4 py-3 text-sm">{message}</div>}

      <div className="flex flex-wrap gap-3 mb-4">
        <select className="form-select w-56" value={product} onChange={(e) => setProduct(e.target.value)}>
          <option value="">All medicines</option>
          {products.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="form-select w-44" value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">All models</option>
          <option value="FBD-5">FBD-5</option>
          <option value="FBD-10">FBD-10</option>
          <option value="FBD-450">FBD-450</option>
        </select>
      </div>

      <div className="table-container bg-white">
        <table className="data-table">
          <thead>
            <tr>
              <th>Medicine</th>
              <th>Model</th>
              <th>Parameter</th>
              <th>Process limit</th>
              <th>Sensor range</th>
              <th>Severity</th>
              <th>Version</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <React.Fragment key={row._id}>
                <tr>
                  <td>{row.product}</td>
                  <td>{row.machineModel}</td>
                  <td>{row.displayName} <span className="text-slate-400">({row.unit})</span></td>
                  <td className="mono">{row.limitMin} – {row.limitMax}</td>
                  <td className="mono">{row.validMin} – {row.validMax}</td>
                  <td><SeverityBadge severity={row.severity} /></td>
                  <td>v{row.version}</td>
                  <td>
                    {canDo('EDIT_LIMITS') && <button type="button" className="btn-secondary btn-sm" onClick={() => startEdit(row)}>Modify limits</button>}
                  </td>
                </tr>
                {editing === row._id && (
                  <tr>
                    <td colSpan={8}>
                      <form onSubmit={onSave} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end py-1">
                        <div className="md:col-span-4 text-sm text-slate-600">
                          {row.product} · {row.machineModel} · {row.displayName}
                        </div>
                        <div>
                          <label className="form-label">Min</label>
                          <input className="form-input" type="number" step="any" value={limitMin} onChange={(e) => setLimitMin(e.target.value)} required />
                        </div>
                        <div>
                          <label className="form-label">Max</label>
                          <input className="form-input" type="number" step="any" value={limitMax} onChange={(e) => setLimitMax(e.target.value)} required />
                        </div>
                        <div className="md:col-span-2">
                          <label className="form-label">Reason (min 10 characters)</label>
                          <input className="form-input" value={reason} minLength={10} required onChange={(e) => setReason(e.target.value)} />
                        </div>
                        <div className="md:col-span-4 flex gap-2">
                          <button className="btn-primary" disabled={busy || reason.trim().length < 10}>Save new version</button>
                          <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {rows.length === 0 && <tr><td colSpan={8} className="text-slate-500">No limits found for this filter.</td></tr>}
          </tbody>
        </table>
      </div>

      {canDo('EDIT_LIMITS') ? (
        <form onSubmit={onAddProduct} className="card mt-6">
          <div className="card-header"><h2 className="font-semibold">Add a medicine</h2></div>
          <div className="card-body grid grid-cols-1 md:grid-cols-2 gap-3">
            <p className="md:col-span-2 text-sm text-slate-600">
              Copies the selected medicine’s band onto the new name for one machine size. Edit the numbers after that so this product has its own limits. Repeat for the other size.
            </p>
            <div>
              <label className="form-label">Medicine name</label>
              <input className="form-input" value={newProduct} onChange={(e) => setNewProduct(e.target.value)} required minLength={2} placeholder="Amoxicillin 250" />
            </div>
            <div>
              <label className="form-label">Machine model</label>
              <select className="form-select" value={newModel} onChange={(e) => setNewModel(e.target.value)}>
                <option value="FBD-5">FBD-5</option>
                <option value="FBD-10">FBD-10</option>
          <option value="FBD-450">FBD-450</option>
              </select>
            </div>
            <div>
              <label className="form-label">Copy starting band from</label>
              <select className="form-select" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} required>
                {products.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Reason (min 10 characters)</label>
              <input className="form-input" value={newReason} minLength={10} required onChange={(e) => setNewReason(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <button className="btn-primary" disabled={busy || !copyFrom || newReason.trim().length < 10}>Add medicine</button>
            </div>
          </div>
        </form>
      ) : (
        <p className="text-xs text-slate-500 mt-3">Switch the role to Admin to publish a new limit version or add a medicine.</p>
      )}
    </div>
  );
}
