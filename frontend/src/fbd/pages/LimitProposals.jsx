import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getLimits, getLimitProposals, proposeLimitChange, decideLimitProposal } from '../api';
import { apiError } from '../lib/format';

const permission = (me, suffix) => me?.admin === true || (me?.effectivePermissions || me?.permissions || []).some(p =>
  p === `MACHINE_MONITORING.MACHINE_PARAMETERS.${suffix}` || p === `FBD_OPERATIONS.MACHINE_PARAMETERS.${suffix}`);

/** Central proposal register: never filters to the current submitter or currently opened machine. */
export default function LimitProposals({ me }) {
  const [proposals, setProposals] = useState([]);
  const [limits, setLimits] = useState([]);
  const [limitId, setLimitId] = useState('');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [reason, setReason] = useState('');
  const [reviewReasons, setReviewReasons] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mayPropose = permission(me, 'PROPOSE_LIMIT_CHANGE');
  const mayApprove = permission(me, 'APPROVE_LIMIT_CHANGE');
  const mayModify = permission(me, 'MODIFY_LIMITS');
  const refresh = useCallback(async () => {
    const [items, active] = await Promise.all([getLimitProposals(), getLimits({})]);
    setProposals(Array.isArray(items) ? items : []);
    setLimits(Array.isArray(active) ? active : []);
  }, []);
  useEffect(() => {
    let active = true;
    const load = () => refresh().catch(e => { if (active) setError(apiError(e)); });
    load();
    const interval = setInterval(() => { if (active && !document.hidden) load(); }, 15000);
    return () => { active = false; clearInterval(interval); };
  }, [refresh]);
  const selected = useMemo(() => limits.find(x => x._id === limitId), [limits, limitId]);
  const shown = proposals;
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (!selected) throw Error('Select a parameter.');
      if (!(Number(minimum) < Number(maximum))) throw Error('Minimum must be lower than maximum.');
      await proposeLimitChange(limitId, Number(minimum), Number(maximum), reason.trim());
      setLimitId(''); setMinimum(''); setMaximum(''); setReason('');
      await refresh(); setNotice('Proposal submitted for review. Active limits are unchanged.');
    } catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  }
  async function decide(item, decision) {
    setBusy(true); setError(''); setNotice('');
    try {
      await decideLimitProposal(item._id, decision, (reviewReasons[item._id] || '').trim());
      setReviewReasons(old => ({ ...old, [item._id]: '' }));
      await refresh(); setNotice(`Proposal ${decision.toLowerCase()}.`);
    } catch (e) { setError(apiError(e)); } finally { setBusy(false); }
  }
  return <section className="panel">
    <h2>Proposed Changes to Limits</h2>
    <p className="muted">Shared proposal register for your assigned machines. Submission never changes the active limits; an authorized reviewer must approve the proposal.</p>
    {error && <p className="alert" role="alert">{error}</p>}
    {notice && <p className="success">{notice}</p>}
    {mayPropose && <form onSubmit={submit} className="limit-proposal-form">
      <h3>Suggest a limit change</h3>
      <label>Machine model / Product / Parameter
        <select required value={limitId} onChange={e => { setLimitId(e.target.value); const l = limits.find(x => x._id === e.target.value); setMinimum(l ? String(l.limitMin) : ''); setMaximum(l ? String(l.limitMax) : ''); }}>
          <option value="">Select a parameter</option>
          {limits.map(l => <option key={l._id} value={l._id}>{l.machineModel} · {l.product} · {l.displayName || l.parameter} (current {l.limitMin}–{l.limitMax})</option>)}
        </select>
      </label>
      <label>Proposed minimum<input type="number" step="any" required value={minimum} onChange={e => setMinimum(e.target.value)}/></label>
      <label>Proposed maximum<input type="number" step="any" required value={maximum} onChange={e => setMaximum(e.target.value)}/></label>
      <label>Reason for change (at least 10 characters)<textarea required minLength={10} value={reason} onChange={e => setReason(e.target.value)}/></label>
      <button className="primary" disabled={busy || !selected || reason.trim().length < 10 || minimum === '' || maximum === ''}>Submit Proposal</button>
    </form>}
    <div className="section-head"><h3>Proposal register</h3></div>
    {!shown.length && <p className="muted">No proposals available for your assigned machines.</p>}
    {shown.map(item => <article className="panel limit-proposal-item" key={item._id}>
      <h3>{item.machineModel} · {item.product} · {item.parameter}</h3>
      <p><strong>Current:</strong> {item.currentMin}–{item.currentMax} | <strong>Proposed:</strong> {item.proposedMin}–{item.proposedMax} | <strong>Status:</strong> {item.status}</p>
      <p><strong>Proposed by:</strong> {item.proposedByUsername || 'Unknown user'} | <strong>Submitted:</strong> {new Date(item.createdAt).toLocaleString()}</p>
      <p><strong>Reason:</strong> {item.reason}</p>
      {item.reviewedAt && <p><strong>Reviewed by:</strong> {item.reviewedByUsername || 'Unknown user'} | <strong>Decision reason:</strong> {item.reviewReason}</p>}
      {item.status === 'PENDING' && mayApprove && String(item.proposedBy) !== String(me?.id) && <div>
        <label>Review reason (at least 10 characters)<textarea value={reviewReasons[item._id] || ''} onChange={e => setReviewReasons(old => ({ ...old, [item._id]: e.target.value }))}/></label>
        <button type="button" disabled={busy || (reviewReasons[item._id] || '').trim().length < 10} onClick={() => decide(item, 'APPROVED')}>Approve</button>{' '}
        <button type="button" disabled={busy || (reviewReasons[item._id] || '').trim().length < 10} onClick={() => decide(item, 'REJECTED')}>Reject</button>
      </div>}
      {item.status === 'PENDING' && !mayApprove && mayModify && <p className="muted">You may modify limits directly, but approving a proposal requires Approve Limit Change permission.</p>}
    </article>)}
  </section>;
}
