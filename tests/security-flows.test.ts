import assert from 'node:assert/strict';
import { after, before, mock, test } from 'node:test';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User, type IUser } from '../src/db/schema/User';
import { Repo } from '../src/db/schema/Repo';
import { GithubInstallation } from '../src/db/schema/GithubInstallation';
import { PullRequest } from '../src/db/schema/PullRequest';
import { PullRequestFile } from '../src/db/schema/PullRequestFile';
import { encryptUserTokens } from '../src/db/migrations/encryptUserTokens';
import { decryptToken, encryptToken } from '../src/utils/auth/tokenEncryption';
import { refreshGithubToken } from '../src/utils/api/refreshAccessToken';
import { refreshUser, userCredentials } from '../src/utils/auth/refreshUser';

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
process.env.JWT_SECRET = randomBytes(32).toString('hex');
const queue = { add: mock.fn(async (..._args: any[]) => ({})) };
const conflictQueue = { add: mock.fn(async (..._args: any[]) => ({})) };
const getRepo = mock.fn(async () => ({ data: { permissions: { push: true } } }));
const getPull = mock.fn(async () => ({ data: githubPR() }));
const listFiles = mock.fn(async () => ({ status: 200, data: [{ filename: 'example.ts', status: 'modified', patch: '@@ -1,1 +1,1 @@\n-old\n+new' }] }));
const getAuthenticated = mock.fn(async () => ({ data: { id: 123 } }));
for (const [file, name, value] of [
    ['../src/queues/pull-request.queue.ts', 'pullRequestQueue', queue],
    ['../src/queues/comment.queue.ts', 'commentQueue', queue],
    ['../src/queues/conflict-detection.queue.ts', 'conflictDetectionQueue', conflictQueue],
] as const) {
    mock.module(new URL(file, import.meta.url).href, { namedExports: { [name]: value } });
}
mock.module('octokit', { namedExports: { Octokit: class {
    rest = { repos: { get: getRepo }, pulls: { get: getPull }, users: { getAuthenticated } };
} } });
mock.module(new URL('../src/github/client.ts', import.meta.url).href, { namedExports: {
    githubApp: { getInstallationOctokit: async () => ({ rest: { pulls: { listFiles } } }) },
} });
const { apiRouter } = await import('../src/routes/api.routes');
const { handlePullRequestOpened } = await import('../src/utils/workers/pr/handlePullRequestOpened');
let mongo: MongoMemoryServer;
let server: ReturnType<ReturnType<typeof express>['listen']>;
let baseUrl: string;
let sessionToken: string;
const originalFetch = globalThis.fetch;

function credentials() {
    return { accessToken: 'ghu_test', refreshToken: 'ghr_test', accessTokenExpiry: Date.now() + 60_000, refreshTokenExpiry: Date.now() + 120_000 };
}
function providerTokens() {
    return { access_token: 'ghu_new', refresh_token: 'ghr_new', expires_in: 3600, refresh_token_expires_in: 7200 };
}
async function newUser(expired = false) {
    return User.create({ githubUserId: new Types.ObjectId().toString(), githubLogin: 'test', ...credentials(), ...(expired ? { accessTokenExpiry: Date.now() - 1 } : {}) });
}
function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(r => { resolve = r; });
    return { promise, resolve };
}
async function request(path: string, body: object) {
    return originalFetch(baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify(body) });
}
function githubPR() {
    return { id: 456, number: 1, title: 'New title', html_url: 'https://example.test/pr/1', state: 'open', draft: false,
        base: { ref: 'main', sha: 'base' }, head: { ref: 'feature', sha: 'new-head' },
        user: { id: 123, login: 'test', avatar_url: 'https://example.test/avatar', html_url: 'https://example.test/user', type: 'User' },
        labels: [], assignees: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), closed_at: null, merged_at: null };
}
let fixtureInstallationId = 1000;
async function prFixture() {
    const installationId = new Types.ObjectId();
    await GithubInstallation.collection.insertOne({ _id: installationId, installationId: String(fixtureInstallationId++) } as any);
    const repo = await Repo.create({ installationId, githubId: new Types.ObjectId().toString(), githubName: 'repo', githubFullName: 'owner/repo' });
    const pr = await PullRequest.create({ repoId: repo._id, installationId, githubPrId: '456', prNumber: 1, title: 'Old', htmlUrl: 'https://example.test', state: 'open', isDraft: false,
        baseBranch: 'main', baseBranchHeadSha: 'base', headBranch: 'feature', headBranchHeadSha: 'old-head',
        author: { id: '123', login: 'test', avatarUrl: 'https://example.test', githubUrl: 'https://example.test', userType: 'User' },
        labels: [], githubCreatedAt: new Date(), githubUpdatedAt: new Date(), isTracked: true, processingStatus: 'error' });
    return { pr, repo, body: { prNumber: 1, repositoryId: repo._id.toString(), installationId: installationId.toString() } };
}

before(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await Promise.all([User.init(), PullRequest.init()]);
    const user = await newUser();
    sessionToken = jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET!);
    const app = express();
    app.use(apiRouter);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    baseUrl = `http://127.0.0.1:${address.port}`;
});
after(async () => {
    globalThis.fetch = originalFetch;
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await mongoose.disconnect();
    await mongo?.stop();
});

test('document and update writes encrypt both tokens; tampering and field swapping fail', async () => {
    const user = await newUser();
    let raw = await User.collection.findOne({ _id: user._id });
    assert.ok(raw);
    assert.notEqual(raw.accessToken, 'ghu_test');
    assert.equal(decryptToken(raw.accessToken, 'accessToken'), 'ghu_test');
    assert.equal(decryptToken(raw.refreshToken, 'refreshToken'), 'ghr_test');
    await User.findByIdAndUpdate(user._id, { $set: { accessToken: 'ghu_updated', refreshToken: 'ghr_updated' } }, { runValidators: true });
    raw = await User.collection.findOne({ _id: user._id });
    assert.equal(decryptToken(raw!.accessToken, 'accessToken'), 'ghu_updated');
    assert.throws(() => decryptToken(raw!.accessToken, 'refreshToken'));
    const bytes = Buffer.from(raw!.accessToken.slice(7), 'base64');
    bytes[bytes.length - 1] ^= 1;
    assert.throws(() => decryptToken('enc:v1:' + bytes.toString('base64'), 'accessToken'));
    assert.notEqual(encryptToken('same', 'accessToken'), encryptToken('same', 'accessToken'));
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    assert.throws(() => encryptToken('token', 'accessToken'), /TOKEN_ENCRYPTION_KEY/);
    process.env.TOKEN_ENCRYPTION_KEY = key;
});

test('migration encrypts plaintext, supports mixed records and is idempotent', async () => {
    const { insertedId } = await User.collection.insertOne({ githubUserId: 'legacy', githubLogin: 'legacy', ...credentials() } as any);
    await encryptUserTokens();
    const first = await User.collection.findOne({ _id: insertedId });
    assert.equal(userCredentials(first as unknown as IUser).refreshToken, 'ghr_test');
    await encryptUserTokens();
    assert.deepEqual(await User.collection.findOne({ _id: insertedId }), first);
    await User.collection.updateOne({ _id: insertedId }, { $set: { refreshToken: 'ghr_legacy' } });
    await encryptUserTokens();
    assert.equal(userCredentials((await User.findById(insertedId))!).refreshToken, 'ghr_legacy');
});

test('login rejects missing, empty, relative, expired and nonfinite metadata before upsert', async () => {
    const count = await User.countDocuments();
    for (const invalid of [
        { refreshToken: undefined }, { refreshToken: '' }, { refreshToken: '  ' },
        { accessTokenExpiry: 3600 }, { accessTokenExpiry: Date.now() - 1 },
        { refreshTokenExpiry: Math.floor(Date.now() / 1000) + 7200 },
        { accessTokenExpiry: 'Infinity' }, { refreshTokenExpiry: 'NaN' },
        { accessTokenExpiry: null }, { refreshTokenExpiry: undefined },
    ]) {
        assert.equal((await request('/github-login', { githubUserId: '123', githubLogin: 'test', ...credentials(), ...invalid })).status, 400);
    }
    assert.equal(await User.countDocuments(), count);
    assert.equal(getAuthenticated.mock.callCount(), 0);
    const response = await request('/github-login', { githubUserId: '123', githubLogin: 'test', ...credentials() });
    assert.equal(response.status, 201);
    const user = await User.findOne({ githubUserId: '123' });
    assert.equal(userCredentials(user!).accessToken, 'ghu_test');
});

test('refresh rejects malformed/unsuccessful responses and supplies a fetch timeout', async () => {
    try {
        for (const data of [null, {}, { ...providerTokens(), access_token: 1 }, { ...providerTokens(), refresh_token: '' },
            { ...providerTokens(), refresh_token: undefined }, { ...providerTokens(), expires_in: '3600' },
            { ...providerTokens(), expires_in: -1 }, { ...providerTokens(), expires_in: 1e308 },
            { ...providerTokens(), refresh_token_expires_in: 0 }]) {
            globalThis.fetch = async () => Response.json(data);
            await assert.rejects(refreshGithubToken('ghr_test'), /token/);
        }
        globalThis.fetch = async () => new Response('<html>upstream failure</html>');
        await assert.rejects(refreshGithubToken('ghr_test'), /invalid JSON/);
        globalThis.fetch = async () => Response.json({ error: 'bad', error_description: 'sensitive text' }, { status: 400 });
        await assert.rejects(refreshGithubToken('ghr_test'), { message: 'Failed to refresh GitHub token' });
        globalThis.fetch = async (_url, options) => {
            assert.ok(options?.signal instanceof AbortSignal);
            return Response.json(providerTokens());
        };
        const refreshed = await refreshGithubToken('ghr_test');
        assert.equal(refreshed.refreshToken, 'ghr_new');
        assert.ok(refreshed.accessTokenExpiry > Date.now());
        globalThis.fetch = async () => { throw new DOMException('Timed out', 'TimeoutError'); };
        await assert.rejects(refreshGithubToken('ghr_test'), { name: 'TimeoutError' });
    } finally { globalThis.fetch = originalFetch; }
});

test('concurrent refresh requests share persistence and return the saved encrypted user', async () => {
    const user = await newUser(true);
    const saving = deferred();
    const release = deferred();
    const originalUpdate = User.collection.findOneAndUpdate.bind(User.collection);
    const saveMock = mock.method(User.collection, 'findOneAndUpdate', async (filter: any, update: any, options: any) => {
        if (update.$set?.accessToken) { saving.resolve(); await release.promise; }
        return originalUpdate(filter, update, options);
    });
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json(providerTokens()); };
    try {
        const first = refreshUser(user._id.toString());
        await saving.promise;
        const second = refreshUser(user._id.toString());
        assert.equal(first, second);
        release.resolve();
        const [a, b] = await Promise.all([first, second]);
        assert.equal(a, b);
        assert.equal(calls, 1);
        assert.equal(userCredentials(a).refreshToken, 'ghr_new');
        assert.equal((await User.collection.findOne({ _id: user._id }))!.accessToken, a.accessToken);
    } finally { release.resolve(); saveMock.mock.restore(); globalThis.fetch = originalFetch; }
});

test('independent refresh coordinators reread under the database lock', async () => {
    const { refreshUser: otherRefresh } = await import(new URL('../src/utils/auth/refreshUser.ts?other-instance', import.meta.url).href);
    const user = await newUser(true);
    const fetching = deferred();
    const release = deferred();
    let calls = 0;
    globalThis.fetch = async () => { calls++; fetching.resolve(); await release.promise; return Response.json(providerTokens()); };
    try {
        const first = refreshUser(user._id.toString());
        await fetching.promise;
        const second = otherRefresh(user._id.toString());
        assert.notEqual(first, second);
        release.resolve();
        const users = await Promise.all([first, second]);
        assert.equal(calls, 1);
        assert.equal(users[0].accessToken, users[1].accessToken);
    } finally { release.resolve(); globalThis.fetch = originalFetch; }
});

test('failed persistence clears the shared promise and releases the database lock', async () => {
    const user = await newUser(true);
    const originalUpdate = User.collection.findOneAndUpdate.bind(User.collection);
    const saveMock = mock.method(User.collection, 'findOneAndUpdate', async (filter: any, update: any, options: any) => {
        if (update.$set?.accessToken) throw new Error('synthetic save failure');
        return originalUpdate(filter, update, options);
    });
    globalThis.fetch = async () => Response.json(providerTokens());
    try {
        await assert.rejects(refreshUser(user._id.toString()), /save failure/);
        assert.equal((await User.findById(user._id))!.tokenRefreshLockId, undefined);
        saveMock.mock.restore();
        assert.equal(userCredentials(await refreshUser(user._id.toString())).accessToken, 'ghu_new');
    } finally { saveMock.mock.restore(); globalThis.fetch = originalFetch; }
});

test('retry enforces installation ownership and push permission before mutation', async () => {
    const { pr, body } = await prFixture();
    const wrong = new Types.ObjectId();
    await GithubInstallation.collection.insertOne({ _id: wrong, installationId: '100' } as any);
    const calls = queue.add.mock.callCount();
    assert.equal((await request('/pullrequest/retry-processing', { ...body, installationId: wrong.toString() })).status, 403);
    getRepo.mock.mockImplementation(async () => ({ data: { permissions: { push: false } } }));
    assert.equal((await request('/pullrequest/retry-processing', body)).status, 403);
    getRepo.mock.mockImplementation(async () => { throw new Error('synthetic forbidden'); });
    assert.equal((await request('/pullrequest/retry-processing', body)).status, 403);
    getRepo.mock.mockImplementation(async () => ({ data: { permissions: { push: true } } }));
    assert.equal(queue.add.mock.callCount(), calls);
    assert.ok(await PullRequest.findById(pr._id));
});

test('queue failures preserve old PR records for both sync and retry', async () => {
    queue.add.mock.mockImplementation(async () => { throw new Error('synthetic queue failure'); });
    try {
        for (const path of ['/pullrequest/sync', '/pullrequest/retry-processing']) {
            const { pr, body } = await prFixture();
            assert.equal((await request(path, body)).status, 500);
            assert.ok(await PullRequest.findById(pr._id));
        }
    } finally { queue.add.mock.mockImplementation(async () => ({})); }
});

test('worker can finish before API cleanup; replacement jobs can be retried', async () => {
    for (const path of ['/pullrequest/sync', '/pullrequest/retry-processing']) {
        const { pr, repo, body } = await prFixture();
        let payload: any;
        queue.add.mock.mockImplementation(async (_name: string, data: any) => {
            payload = data;
            assert.equal(data.replacementRecordId, pr._id.toString());
            assert.ok(await PullRequest.findById(pr._id));
            await handlePullRequestOpened(data);
            return {};
        });
        try {
            assert.equal((await request(path, body)).status, 200);
            assert.equal(await PullRequest.findById(pr._id), null);
            const replacement = await PullRequest.findOne({ repoId: repo._id, githubPrId: '456' });
            assert.equal(replacement!.processingStatus, 'completed');
            assert.equal(await PullRequestFile.countDocuments({ pullRequestId: replacement!._id }), 1);
            await handlePullRequestOpened(payload);
            assert.equal(await PullRequest.countDocuments({ repoId: repo._id, githubPrId: '456' }), 1);
            assert.equal((await PullRequest.findById(replacement!._id))!.processingStatus, 'completed');
            assert.equal(await PullRequestFile.countDocuments({ pullRequestId: replacement!._id }), 1);
        } finally { queue.add.mock.mockImplementation(async () => ({})); }
    }
});


test('migration does not overwrite credentials changed after its read', async () => {
    const { insertedId } = await User.collection.insertOne({ githubUserId: 'legacy-race', githubLogin: 'legacy', ...credentials() } as any);
    const update = User.collection.updateOne.bind(User.collection);
    let changed = false;
    const updating = mock.method(User.collection, 'updateOne', async (filter: any, values: any, options: any) => {
        if (filter._id.equals(insertedId) && !changed) {
            changed = true;
            await update({ _id: insertedId }, { $set: {
                accessToken: encryptToken('ghu_concurrent', 'accessToken'),
                refreshToken: encryptToken('ghr_concurrent', 'refreshToken'),
            } });
        }
        return update(filter, values, options);
    });
    try {
        await encryptUserTokens();
        assert.equal(userCredentials((await User.findById(insertedId))!).refreshToken, 'ghr_concurrent');
    } finally { updating.mock.restore(); }
});

test('fresh login fences out an in-flight refresh without overwriting its tokens', async () => {
    const user = await newUser(true);
    const fetching = deferred();
    const release = deferred();
    globalThis.fetch = async () => { fetching.resolve(); await release.promise; return Response.json(providerTokens()); };
    try {
        const pending = refreshUser(user._id.toString());
        await fetching.promise;
        await User.findByIdAndUpdate(user._id, {
            $set: { ...credentials(), accessToken: 'ghu_login', refreshToken: 'ghr_login' },
            $unset: { tokenRefreshLockId: 1, tokenRefreshLockUntil: 1 },
        });
        const rejected = assert.rejects(pending, /User changed/);
        release.resolve();
        await rejected;
        assert.equal(userCredentials((await User.findById(user._id))!).refreshToken, 'ghr_login');
    } finally { release.resolve(); globalThis.fetch = originalFetch; }
});
