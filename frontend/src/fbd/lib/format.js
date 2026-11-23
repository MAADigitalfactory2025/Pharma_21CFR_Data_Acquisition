import { format } from 'date-fns';

export const PARAMETERS = [
  { key: 'inletTemp', name: 'Inlet Air Temperature', unit: '°C', digits: 1 },
  { key: 'outletTemp', name: 'Outlet Air Temperature', unit: '°C', digits: 1 },
  { key: 'productTemp', name: 'Product Temperature', unit: '°C', digits: 1 },
  { key: 'airflow', name: 'Airflow', unit: 'm³/h', digits: 0 },
  { key: 'diffPressure', name: 'Differential Pressure', unit: 'Pa', digits: 0 },
  { key: 'inletHumidity', name: 'Inlet Humidity', unit: '%RH', digits: 1 },
  { key: 'blowerSpeed', name: 'Blower Speed', unit: 'RPM', digits: 0 },
];

export function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'dd MMM yyyy HH:mm:ss');
}

export function fmtNumber(value, digits = 1) {
  if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(digits);
}

export function apiError(err, fallback = 'Request failed') {
  return err?.response?.data?.error || err?.message || fallback;
}

export function toLocalInput(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
