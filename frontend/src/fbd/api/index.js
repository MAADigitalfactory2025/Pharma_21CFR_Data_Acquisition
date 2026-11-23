// api/index.js — Centralized Axios API client
import axios from 'axios';

const api = axios.create({
  baseURL: '/fbd-api',
  timeout: 15000,
});

// ===== Machines =====
export const getMachines = () => api.get('/machines').then(r => r.data);
export const getMachine = (id) => api.get(`/machines/${id}`).then(r => r.data);
export const getMachineLimits = (id, product) =>
  api.get(`/machines/${id}/limits`, { params: product ? { product } : {} }).then(r => r.data);

// ===== Readings =====
export const getReadings = (params) => api.get('/readings', { params }).then(r => r.data);

// ===== Batches =====
export const getBatches = (params) => api.get('/batches', { params }).then(r => r.data);
export const getBatch = (batchNo) => api.get(`/batches/${encodeURIComponent(batchNo)}`).then(r => r.data);
export const submitBatchDecision = (batchNo, decision, remarks) =>
  api.post(`/batches/${encodeURIComponent(batchNo)}/decision`, { decision, remarks }).then(r => r.data);
export const getBatchReportUrl = (batchNo) => `/fbd-api/batches/${encodeURIComponent(batchNo)}/report`;

// ===== Alarms =====
export const getAlarms = (params) => api.get('/alarms', { params }).then(r => r.data);
export const reviewAlarm = (id, remarks) =>
  api.post(`/alarms/${id}/review`, { remarks }).then(r => r.data);

// ===== Validation Errors =====
export const getValidationErrors = (params) =>
  api.get('/validation-errors', { params }).then(r => r.data);

// ===== Audit =====
export const getAuditLogs = (params) => api.get('/audit', { params }).then(r => r.data);
export const verifyIntegrity = () => api.get('/audit/verify').then(r => r.data);

// ===== Limits =====
export const getLimits = (params) => api.get('/limits', { params }).then(r => r.data);
export const updateLimit = (id, limitMin, limitMax, reason) =>
  api.put(`/limits/${id}`, { limitMin, limitMax, reason }).then(r => r.data);
export const createProductLimits = (product, machineModel, copyFromProduct, reason) =>
  api.post('/limits', { product, machineModel, copyFromProduct, reason }).then(r => r.data);

// ===== Reports =====
export const getExcelReportUrl = (machineId, from, to) =>
  `/fbd-api/reports/excel?machineId=${machineId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

/** Download a binary report through the API client so the dev role header is sent. */
export async function downloadFile(path, filename, params) {
  const res = await api.get(path, { params, responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default api;

export const createBatch = (machineId, product, loadKg) => api.post('/batches', { machineId, product, loadKg }).then(r => r.data);
export const closeBatch = (batchNo) => api.post(`/batches/${encodeURIComponent(batchNo)}/close`).then(r => r.data);
export const getLimitProposals = () => api.get('/limits/proposals').then(r => r.data);
export const proposeLimitChange = (limitId, proposedMin, proposedMax, reason) => api.post('/limits/proposals', { limitId, proposedMin, proposedMax, reason }).then(r => r.data);
export const decideLimitProposal = (id, decision, reason) => api.post(`/limits/proposals/${id}/decision`, { decision, reason }).then(r => r.data);
