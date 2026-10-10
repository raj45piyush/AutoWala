import type { RiderApprovalStatus } from '../types/database';

export interface RiderApprovalRow {
  rider: { approval_status: RiderApprovalStatus | null };
}

export function getPendingRiderRows<T extends RiderApprovalRow>(rows: T[]): T[];

export function getRiderApprovalUpdate(
  status: 'approved' | 'rejected'
): { approval_status: 'approved' | 'rejected'; is_online: false };

export function isValidCoordinatePair(
  latitude: unknown,
  longitude: unknown
): boolean;

export function isValidCoordinates(
  value: unknown
): value is { latitude: number; longitude: number };
