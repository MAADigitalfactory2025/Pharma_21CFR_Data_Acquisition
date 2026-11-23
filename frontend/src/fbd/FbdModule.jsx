// FbdModule.jsx — the FBD monitoring pages, opened from the login project's machine card.
import React, { useEffect, useState } from 'react';
import { MemoryRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AuthProvider } from './context/AuthContext';
import { getMachines } from './api';
import ConnectionStatus from './components/ConnectionStatus';
import MachineLive from './pages/MachineLive';
import Batches from './pages/Batches';
import BatchDetail from './pages/BatchDetail';
import Alarms from './pages/Alarms';
import ValidationErrors from './pages/ValidationErrors';
import Limits from './pages/Limits';
import Audit from './pages/Audit';
import Reports from './pages/Reports';
import './index.css';

// Login-project machine IDs -> FBD machine tags.
export const FBD_TAGS = { M001: 'FBD-5-01', M002: 'FBD-10-01', M003: 'FBD-450-01' };

const TABS = [
  ['live', 'Live data'], ['batches', 'Batches'], ['alarms', 'Alarms'],
  ['validation-errors', 'Validation errors'], ['limits', 'Process limits'], ['audit', 'Reading log'], ['reports', 'Reports'],
];

export default function FbdModule({ machineId, me, onBack }) {
  const [mongoId, setMongoId] = useState(null);
  const [error, setError] = useState('');
  const canExportExcel = me?.admin === true || (me?.effectivePermissions || me?.permissions || []).includes('GENERATE_EXCEL_REPORT');

  useEffect(() => {
    getMachines()
      .then((list) => {
        const m = list.find((x) => x.tag === FBD_TAGS[machineId]);
        if (m) setMongoId(m._id); else setError('This machine is not registered in the FBD data service. Run npm run seed in fbd-server.');
      })
      .catch((e) => setError(e.response?.data?.error || 'Could not reach the FBD data service'));
  }, [machineId]);

  return (
    <div className="fbd-root">
      <button className="link fbd-back" onClick={onBack}><ArrowLeft size={15} /> Back to machines</button>
      {error && <div className="alert">{error}</div>}
      {mongoId && (
        <AuthProvider me={me}>
          <MemoryRouter initialEntries={[`/machines/${mongoId}`]}>
            <div className="fbd-tabs">
              {TABS.filter(([to]) => to !== 'reports' || canExportExcel).map(([to, label]) => (
                <NavLink key={to} to={to === 'live' ? `/machines/${mongoId}` : `/${to}`} end={to === 'live'}
                  className={({ isActive }) => `fbd-tab${isActive ? ' active' : ''}`}>{label}</NavLink>
              ))}
              <span className="fbd-conn"><ConnectionStatus /></span>
            </div>
            <Routes>
              <Route path="machines/:id" element={<MachineLive />} />
              <Route path="batches" element={<Batches machineId={mongoId} />} />
              <Route path="batches/:batchNo" element={<BatchDetail />} />
              <Route path="alarms" element={<Alarms machineId={mongoId} />} />
              <Route path="validation-errors" element={<ValidationErrors machineId={mongoId} />} />
              <Route path="limits" element={<Limits machineId={mongoId} />} />
              <Route path="audit" element={<Audit machineId={mongoId} />} />
              <Route path="reports" element={canExportExcel ? <Reports /> : <Navigate to={`/machines/${mongoId}`} replace />} />
              <Route path="*" element={<Navigate to={`/machines/${mongoId}`} replace />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      )}
    </div>
  );
}
