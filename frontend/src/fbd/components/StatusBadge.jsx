// components/StatusBadge.jsx — Reusable status badge for machine states, batch status, etc.
import React from 'react';

const MACHINE_STATE_CONFIG = {
  IDLE:            { label: 'Idle',          className: 'state-idle'    },
  RUNNING:         { label: 'Running',        className: 'state-running' },
  DRYING_COMPLETE: { label: 'Drying Complete',className: 'state-complete'},
  ALARM:           { label: '⚠ Alarm',       className: 'state-alarm'   },
  MAINTENANCE:     { label: 'Maintenance',    className: 'state-maintenance'},
  ACTIVE:          { label: 'Active',         className: 'badge-ok'     },
  RETIRED:         { label: 'Retired',        className: 'badge-neutral' },
};

const BATCH_STATUS_CONFIG = {
  RUNNING:  { label: 'Running',  className: 'badge-info'  },
  COMPLETE: { label: 'Complete', className: 'badge-warn'  },
  APPROVED: { label: 'Approved', className: 'badge-ok'   },
  REJECTED: { label: 'Rejected', className: 'badge-alarm' },
};

const ALARM_STATUS_CONFIG = {
  OPEN:     { label: 'Open',     className: 'badge-alarm' },
  CLOSED:   { label: 'Closed',   className: 'badge-neutral'},
  REVIEWED: { label: 'Reviewed', className: 'badge-ok'   },
};

const SEVERITY_CONFIG = {
  CRITICAL: { label: 'Critical', className: 'badge-alarm' },
  MAJOR:    { label: 'Major',    className: 'badge-warn'  },
};

const PROCESS_RESULT_CONFIG = {
  'PROCESS OK': { label: 'Process OK', className: 'badge-ok'   },
  'DEVIATION':  { label: 'Deviation',  className: 'badge-alarm' },
};

export function MachineStateBadge({ state }) {
  const cfg = MACHINE_STATE_CONFIG[state] || { label: state, className: 'badge-neutral' };
  return <span className={cfg.className}>{cfg.label}</span>;
}

export function BatchStatusBadge({ status }) {
  const cfg = BATCH_STATUS_CONFIG[status] || { label: status, className: 'badge-neutral' };
  return <span className={cfg.className}>{cfg.label}</span>;
}

export function AlarmStatusBadge({ status }) {
  const cfg = ALARM_STATUS_CONFIG[status] || { label: status, className: 'badge-neutral' };
  return <span className={cfg.className}>{cfg.label}</span>;
}

export function SeverityBadge({ severity }) {
  const cfg = SEVERITY_CONFIG[severity] || { label: severity, className: 'badge-neutral' };
  return <span className={cfg.className}>{cfg.label}</span>;
}

export function ProcessResultBadge({ result }) {
  const cfg = PROCESS_RESULT_CONFIG[result] || { label: result, className: 'badge-neutral' };
  return <span className={cfg.className}>{cfg.label}</span>;
}
