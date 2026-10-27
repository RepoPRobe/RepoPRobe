import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { User } from '../../db/schema/User';
import { refreshGithubToken } from '../api/refreshAccessToken';
import { decryptToken } from './tokenEncryption';

export function userCredentials(user: { accessToken: string; refreshToken: string; accessTokenExpiry: number; refreshTokenExpiry: number }) {
    return {
        accessToken: decryptToken(user.accessToken, 'accessToken'),
        accessTokenExpiry: user.accessTokenExpiry,
        refreshToken: decryptToken(user.refreshToken, 'refreshToken'),
        refreshTokenExpiry: user.refreshTokenExpiry,
    };
}

/**
 * Refreshes a user's GitHub auth tokens and persists the renewed values.
 *
 * This function takes a user ID, acquires a short-lived lock to prevent concurrent
 * refresh races, verifies the stored tokens are still valid, requests a fresh token
 * pair from GitHub when needed, updates the user record in MongoDB, and releases the
 * lock afterward. It retries briefly if another refresh is already in progress.
 */
async function refreshAndPersist(userId: string) {
    const lockId = randomUUID();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        // MongoDB coordinates every API process. Return the latest credentials under the lock.
        const user = await User.findOneAndUpdate({
            _id: userId,
            $or: [{ tokenRefreshLockUntil: { $exists: false } }, { tokenRefreshLockUntil: { $lte: new Date() } }],
        }, { $set: { tokenRefreshLockId: lockId, tokenRefreshLockUntil: new Date(Date.now() + 60_000) } }, { new: true });
        if (!user) {
            if (!await User.exists({ _id: userId })) throw new Error('User no longer exists');
            await setTimeout(50);
            continue;
        }
        try {
            const credentials = userCredentials(user);
            if (credentials.refreshTokenExpiry <= Date.now()) throw new Error('Refresh token expired');
            if (credentials.accessTokenExpiry > Date.now()) return user;
            const tokens = await refreshGithubToken(credentials.refreshToken);
            const updatedUser = await User.findOneAndUpdate(
                { _id: userId, tokenRefreshLockId: lockId },
                { $set: tokens },
                { new: true, runValidators: true },
            );
            if (!updatedUser) throw new Error('User changed while saving refreshed tokens');
            return updatedUser;
        } finally {
            await User.updateOne({ _id: userId, tokenRefreshLockId: lockId }, {
                $unset: { tokenRefreshLockId: 1, tokenRefreshLockUntil: 1 },
            });
        }
    }
    throw new Error('Timed out waiting for token refresh');
}

const refreshPromises = new Map<string, ReturnType<typeof refreshAndPersist>>();
export function refreshUser(userId: string) {
    let pending = refreshPromises.get(userId);
    if (!pending) {
        pending = refreshAndPersist(userId);
        refreshPromises.set(userId, pending);
        pending.then(() => refreshPromises.delete(userId), () => refreshPromises.delete(userId));
    }
    return pending;
}
