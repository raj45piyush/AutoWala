export function getPendingRiderRows(rows) {
  return rows.filter(({ rider }) =>
    rider.approval_status === 'pending' || rider.approval_status === null
  );
}

export function getRiderApprovalUpdate(status) {
  if (status !== 'approved' && status !== 'rejected') {
    throw new Error('Rider approval decisions must be approved or rejected.');
  }

  return { approval_status: status, is_online: false };
}

export function isValidCoordinatePair(latitude, longitude) {
  return typeof latitude === 'number'
    && Number.isFinite(latitude)
    && latitude >= -90
    && latitude <= 90
    && typeof longitude === 'number'
    && Number.isFinite(longitude)
    && longitude >= -180
    && longitude <= 180;
}

export function isValidCoordinates(value) {
  if (typeof value !== 'object' || value === null) return false;
  const coordinates = value;
  return isValidCoordinatePair(coordinates.latitude, coordinates.longitude);
}
