import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { getMachine, getMachineLimits, getReadings } from '../api';
import { MachineStateBadge } from '../components/StatusBadge';
import { useSocket } from '../hooks/useSocket';
import { PARAMETERS, apiError, fmtNumber, fmtTime } from '../lib/format';

const COLORS = {
  inletTemp: '#2563eb',
  outletTemp: '#d97706',
  productTemp: '#16a34a',
  airflow: '#7c3aed',
  diffPressure: '#0891b2',
  inletHumidity: '#db2777',
  blowerSpeed: '#334155',
};

export default function MachineLive() {
  const { id } = useParams();
  const { on } = useSocket();
  const [machine, setMachine] = useState(null);
  const [limits, setLimits] = useState([]);
  const [points, setPoints] = useState([]);
  const [latest, setLatest] = useState(null);
  const [chartKey, setChartKey] = useState('temps');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const from = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const [m, lim, readings] = await Promise.all([
          getMachine(id),
          getMachineLimits(id),
          getReadings({ machineId: id, from, limit: 300 }),
        ]);
        if (cancelled) return;
        setMachine(m);
        setLimits(lim);
        const rows = (readings.readings || []).map(toPoint);
        setPoints(rows);
        if (rows.length) setLatest(rows[rows.length - 1]);
      } catch (err) {
        if (!cancelled) setError(apiError(err, 'Could not load this machine'));
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    if (!machine) return undefined;
    return on('reading', (payload) => {
      if (payload.machineTag !== machine.tag) return;
      const point = toPoint(payload);
      setLatest(point);
      setPoints((prev) => [...prev, point].slice(-300));
    });
  }, [machine, on]);

  useEffect(() => {
    if (!machine) return undefined;
    return on('machineState', ({ machineTag, state }) => {
      if (machineTag === machine.tag) setMachine((prev) => ({ ...prev, lastKnownState: state }));
    });
  }, [machine, on]);

  useEffect(() => {
    if (!machine) return undefined;
    const offStart = on('batchStart', ({ machineTag, batch }) => {
      if (machineTag !== machine.tag || !batch?.product) return;
      setMachine((prev) => ({ ...prev, currentBatchNo: batch.batchNo, lastKnownState: 'RUNNING' }));
      getMachineLimits(id, batch.product).then(setLimits).catch(() => {});
    });
    const offEnd = on('batchEnd', ({ machineTag }) => {
      if (machineTag !== machine.tag) return;
      setMachine((prev) => ({ ...prev, currentBatchNo: null, lastKnownState: 'DRYING_COMPLETE' }));
    });
    return () => {
      offStart?.();
      offEnd?.();
    };
  }, [machine, on, id]);

  const limitByParam = useMemo(() => {
    const map = {};
    limits.forEach((lim) => { map[lim.parameter] = lim; });
    return map;
  }, [limits]);

  const chartData = points.map((p) => ({
    ...p.values,
    label: new Date(p.ts).toLocaleTimeString(),
  }));

  const lines = chartKey === 'temps'
    ? ['inletTemp', 'outletTemp', 'productTemp']
    : [chartKey];

  if (error) return <div className="rounded-lg bg-red-50 text-red-700 px-4 py-3 text-sm">{error}</div>;
  if (!machine) return <div className="spinner" />;

  return (
    <div>
      <div className="page-header flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">{machine.tag}</h1>
          <p className="page-subtitle">{machine.name} · {machine.model} · {machine.location}</p>
        </div>
        <MachineStateBadge state={machine.lastKnownState} />
      </div>

      <p className="text-sm text-slate-600 mb-4">
        {limits[0]?.product
          ? `Process limits for ${limits[0].product} on ${machine.model}. A different medicine uses a different band.`
          : 'No running batch. Process limits appear for the medicine on the batch when drying starts.'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        {PARAMETERS.map((param) => {
          const value = latest?.values?.[param.key];
          const lim = limitByParam[param.key];
          const out = lim && value != null && (value < lim.limitMin || value > lim.limitMax);
          return (
            <div key={param.key} className={out ? 'param-card-alarm' : 'param-card-ok'}>
              <div className="text-xs text-slate-500">{param.name}</div>
              <div className="text-2xl font-semibold mono">
                {fmtNumber(value, param.digits)} <span className="text-sm font-normal text-slate-500">{param.unit}</span>
              </div>
              <div className="text-xs text-slate-500">
                Absolute limits {lim ? `${lim.limitMin} – ${lim.limitMax}` : '—'} {param.unit}
              </div>
            </div>
          );
        })}
        <div className="param-card">
          <div className="text-xs text-slate-500">Last sample</div>
          <div className="text-sm font-medium">{fmtTime(latest?.ts)}</div>
          <div className="text-xs text-slate-500">Batch {latest?.batchNo || machine.currentBatchNo || '—'}</div>
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="font-semibold">Trend</h2>
          <select className="form-select w-56" value={chartKey} onChange={(e) => setChartKey(e.target.value)}>
            <option value="temps">Temperatures</option>
            {PARAMETERS.filter((p) => !['inletTemp', 'outletTemp', 'productTemp'].includes(p.key)).map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="card-body h-80">
          {chartData.length === 0 ? (
            <div className="text-sm text-slate-500">No readings in the last 30 minutes. Start the simulator to see a live trend.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis dataKey="label" minTickGap={40} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={48} />
                <Tooltip />
                {lines.map((key) => (
                  <Line key={key} type="monotone" dataKey={key} stroke={COLORS[key]} dot={false} strokeWidth={2} name={key} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>
    </div>
  );
}

function toPoint(reading) {
  return {
    ts: reading.ts,
    batchNo: reading.batchNo,
    values: reading.values || {},
  };
}
