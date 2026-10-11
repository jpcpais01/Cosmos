import { AU_KM, C_KMS } from '../sim/constants';

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function fmtDistance(km: number): string {
  if (!isFinite(km)) return '—';
  const a = Math.abs(km);
  if (a < 1) return `${nf0.format(km * 1000)} m`;
  if (a < 100) return `${nf1.format(km)} km`;
  if (a < 0.05 * AU_KM) return `${nf0.format(km)} km`;
  return `${nf2.format(km / AU_KM)} AU`;
}

export function fmtSpeed(kms: number): string {
  const a = Math.abs(kms);
  if (a < 1) return `${nf0.format(kms * 1000)} m/s`;
  if (a < 100) return `${nf2.format(kms)} km/s`;
  if (a < 0.01 * C_KMS) return `${nf0.format(kms)} km/s`;
  return `${nf2.format(kms / C_KMS)} c`;
}

export function fmtDuration(s: number): string {
  if (!isFinite(s)) return '—';
  if (s < 1) return `${nf1.format(s)} s`;
  if (s < 60) return `${nf0.format(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${nf1.format(h / 24)} days`;
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`;
}

export function fmtLightTime(km: number): string {
  return fmtDuration(km / C_KMS);
}
