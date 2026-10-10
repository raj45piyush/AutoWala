import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPendingRiderRows,
  getRiderApprovalUpdate,
  isValidCoordinatePair,
} from './riderApproval.mjs';

test('pending applications include pending and legacy null statuses only', () => {
  const rows = [
    { rider: { user_id: 'pending-rider', approval_status: 'pending' } },
    { rider: { user_id: 'legacy-rider', approval_status: null } },
    { rider: { user_id: 'approved-rider', approval_status: 'approved' } },
    { rider: { user_id: 'rejected-rider', approval_status: 'rejected' } },
  ];

  assert.deepEqual(
    getPendingRiderRows(rows).map(({ rider }) => rider.user_id),
    ['pending-rider', 'legacy-rider'],
  );
});

test('approval and rejection keep riders offline and allow only review decisions', () => {
  assert.deepEqual(getRiderApprovalUpdate('approved'), {
    approval_status: 'approved',
    is_online: false,
  });
  assert.deepEqual(getRiderApprovalUpdate('rejected'), {
    approval_status: 'rejected',
    is_online: false,
  });
  assert.throws(() => getRiderApprovalUpdate('blocked'), /approved or rejected/);
});

test('location is available only for a complete finite coordinate pair in range', () => {
  assert.equal(isValidCoordinatePair(12.9716, 77.5946), true);
  assert.equal(isValidCoordinatePair(-90, 180), true);
  assert.equal(isValidCoordinatePair(null, null), false);
  assert.equal(isValidCoordinatePair(12.9, null), false);
  assert.equal(isValidCoordinatePair(Number.NaN, 77.5), false);
  assert.equal(isValidCoordinatePair(91, 77.5), false);
  assert.equal(isValidCoordinatePair(12.9, -181), false);
});
