import express from 'express';
import { User } from '../db/schema/User';
import jwt from "jsonwebtoken";
import cors from 'cors';
import { refreshUser, userCredentials } from '../utils/auth/refreshUser';
import { isValidObjectId, Types } from 'mongoose';
import { Octokit } from 'octokit';
import { GithubInstallation } from '../db/schema/GithubInstallation';
import { Repo } from '../db/schema/Repo';
import { PullRequest, PullRequestType } from '../db/schema/PullRequest';
import { Conflict } from '../db/schema/Conflict';
import { commentQueue } from '../queues/comment.queue';
import { QUEUE_EVENTS } from '../types/queue-events';
import { CommentTrack, CommentUntrack, ConflictDetectionScanPR, PullRequestOpened } from '../types/queue-payloads';
import { pullRequestQueue } from '../queues/pull-request.queue';
import { conflictDetectionQueue } from '../queues/conflict-detection.queue';
import { PullRequestFile, PullRequestFileType } from '../db/schema/PullRequestFile';

const apiRouter = express.Router();

apiRouter.use(cors());
apiRouter.use(express.json());

apiRouter.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

apiRouter.post('/github-login', async (req, res) => {
    const githubUserId = req.body.githubUserId;
    const githubLogin = req.body.githubLogin;
    const name = req.body.name;
    const avatarUrl = req.body.avatarUrl;
    const htmlUrl = req.body.htmlUrl;
    const accessToken = req.body.accessToken;
    const accessTokenExpiry = Number(req.body.accessTokenExpiry);
    const refreshToken = req.body.refreshToken;
    const refreshTokenExpiry = Number(req.body.refreshTokenExpiry);

    if (
        (typeof githubUserId !== 'string' && typeof githubUserId !== 'number') ||
        !/^\d+$/.test(String(githubUserId)) ||
        typeof githubLogin !== 'string' ||
        !githubLogin ||
        typeof accessToken !== 'string' ||
        !accessToken.trim() ||
        typeof refreshToken !== 'string' || !refreshToken.trim() ||
        !['number', 'string'].includes(typeof req.body.accessTokenExpiry) ||
        !['number', 'string'].includes(typeof req.body.refreshTokenExpiry) ||
        !Number.isFinite(accessTokenExpiry) || accessTokenExpiry <= Date.now() ||
        !Number.isFinite(refreshTokenExpiry) || refreshTokenExpiry <= Date.now()
    ) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields'
        });
    }

    try {
        let authenticatedGithubUser;
        try {
            const octokit = new Octokit({ auth: accessToken });
            ({ data: authenticatedGithubUser } = await octokit.rest.users.getAuthenticated());
        } catch (error) {
            console.error('Unable to verify GitHub access token');
            return res.status(401).json({
                success: false,
                message: 'Unable to verify GitHub access token',
            });
        }

        if (String(authenticatedGithubUser.id) !== String(githubUserId)) {
            return res.status(403).json({
                success: false,
                message: 'GitHub account does not match the supplied user ID',
            });
        }

        const user = await User.findOneAndUpdate(
            { githubUserId: String(githubUserId) },
            {
                githubLogin,
                name,
                avatarUrl,
                htmlUrl,
                accessToken,
                accessTokenExpiry,
                refreshToken,
                refreshTokenExpiry,
                $unset: { tokenRefreshLockId: 1, tokenRefreshLockUntil: 1 },
            },
            {
                upsert: true,
                new: true,
                runValidators: true,
            }
        );

        // Create RepoProbe session token
        const token = jwt.sign(
            {
                userId: user._id.toString(),
                githubUserId: user.githubUserId,
            },
            process.env.JWT_SECRET!,
            {
                expiresIn: "7d",
            }
        );

        return res.status(201).json({
            token,
            success: true,
            message: 'Login Successful',
        });
    } catch (error) {
        console.error('Error during GitHub login');
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
        });
    }
});

// auth middleware (Bearer ...)
apiRouter.use(async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }

    const token = authHeader.substring(7);

    let decoded: string | jwt.JwtPayload;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET!);
    } catch (error) {
        console.log(`Error occurred while verifying token: ${error}`);
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
    }

    if (
        typeof decoded === 'string' ||
        typeof decoded.userId !== 'string' ||
        !isValidObjectId(decoded.userId)
    ) {
        console.log('Decoded token has an invalid payload shape');
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token",
        });
    }

    try {
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Invalid or expired token",
            });
        }

        req.user = {
            userId: user._id.toString(),
            githubUserId: user.githubUserId,
            ...userCredentials(user),
        };

        console.log('[MIDDLEWARE] Auth Passed.');
        next();
    } catch (error) {
        console.error('Error loading authenticated user');
        return res.status(500).json({
            success: false,
            message: "Unable to authenticate user",
        });
    }
});

// github's refreshToken and accessToken regeneration upon expiry
apiRouter.use(async (req, res, next) => {
    if (!req.user) {
        console.log('User not found in the req body of refresh token middleware');
        return res.status(401).json({
            success: false,
            message: "Unauthorized",
        });
    }
    if (req.user.refreshTokenExpiry <= Date.now()) {
        console.log('Refresh token expired, user will have to login again to refresh the token');
        return res.status(401).json({
            success: false,
            message: "Refresh token expired, please login again to refresh the token",
        });
    }
    if (req.user.accessTokenExpiry <= Date.now() || !req.user.accessToken.startsWith('ghu_')) {
        const userId = req.user.userId;
        console.log('Access token expired or invalid, refreshing access token for user:', userId);

        try {
            const updatedUser = await refreshUser(userId);
            req.user = { ...req.user, ...userCredentials(updatedUser) };
        } catch (error) {
            console.log('Error refreshing access token');
            return res.status(500).json({
                success: false,
                message: "Error refreshing access token, please login again to refresh the token",
            });
        }
    }
    console.log('[MIDDLEWARE] Token Refresh Passed.');
    next();
});

apiRouter.get('/get-tracked-installations', async (req, res) => {
    if (!req.user) {
        console.error('User not authenticated');
        return res.status(401).json({
            success: false,
            message: 'User not authenticated',
        });
    }

    try {
        const { accessToken } = req.user;
        const octokit = new Octokit({ auth: accessToken });

        const data = await octokit.paginate(
            octokit.rest.apps.listInstallationsForAuthenticatedUser,
            {
                per_page: 100,
            }
        );
        const allowedInstallationIds = data.map(installation => installation.id.toString());
        const installations = await GithubInstallation.find({ installationId: { $in: allowedInstallationIds } });

        return res.status(200).json({
            success: true,
            installations,
        });
    } catch (error) {
        console.error('Error fetching tracked installations:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching tracked installations',
        });
    }
});

apiRouter.get('/get-tracked-repositories', async (req, res) => {
    if (!req.user) {
        console.error('User not authenticated');
        return res.status(401).json({
            success: false,
            message: 'User not authenticated',
        });
    }

    try {
        const installationId = req.query.installationId;
        if (!installationId) {
            console.error('Missing Installation ID:', installationId);
            return res.status(400).json({
                success: false,
                message: 'Missing Installation ID.',
            })
        }
        if (!isValidObjectId(installationId)) {
            console.log('Invalid Installation ID:', installationId);
            return res.status(400).json({
                success: false,
                message: 'Invalid Installation ID.',
            })
        }

        const installation = await GithubInstallation.findById(installationId, { installationId: 1, _id: 1 });
        if (!installation?._id) {
            console.error('Installation not found for ID:', installationId);
            return res.status(404).json({
                success: false,
                message: 'Invalid Installation ID.',
            });
        }

        const { accessToken } = req.user;
        const octokit = new Octokit({ auth: accessToken });
        const trackedRepositories: {}[] = [];

        const data = await octokit.paginate(
            octokit.rest.apps.listInstallationReposForAuthenticatedUser,
            {
                installation_id: Number(installation.installationId),
                per_page: 100,
            }
        );

        if (data.length > 0) {
            const reposById: Record<string, (typeof data)[number]> = {};
            const repositoriesIds = data.map(repo => {
                const stringifiedId = repo.id.toString();
                reposById[stringifiedId] = repo;
                return stringifiedId;
            });
            const repos = await Repo.find(
                {
                    installationId: installation._id,
                    githubId: { $in: repositoriesIds }
                },
                { githubId: 1, _id: 1, installedOn: 1 },
            );
            repos.forEach(trackedRepo => {
                if (repositoriesIds.includes(trackedRepo.githubId)) {
                    const repoData = reposById[trackedRepo.githubId];
                    trackedRepositories.push({
                        _id: trackedRepo._id,
                        githubId: repoData.id,
                        fullName: repoData.full_name,
                        private: repoData.private,
                        name: repoData.name,
                        installedOn: trackedRepo.installedOn,
                        permissions: repoData.permissions,
                    });
                }
            });
        }

        return res.status(200).json({
            success: true,
            trackedRepositories,
        });
    } catch (error) {
        console.log('Error fetching tracked repositories:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching tracked repositories',
        })
    }
});

apiRouter.get('/get-repository', async (req, res) => {
    if (!req.user) {
        console.error('User not authenticated');
        return res.status(401).json({
            success: false,
            message: 'User not authenticated',
        });
    }
    const installationId = req.query.installationId;
    const repositoryId = req.query.repositoryId;
    if (!installationId) {
        console.error('Missing Installation ID:', installationId);
        return res.status(400).json({
            success: false,
            message: 'Missing Installation ID.',
        })
    }
    if (!repositoryId) {
        console.error('Missing Repository ID:', installationId);
        return res.status(400).json({
            success: false,
            message: 'Missing Repository ID.',
        })
    }
    if (!isValidObjectId(installationId) || !isValidObjectId(repositoryId)) {
        console.log('Invalid Installation ID or Repository ID:', installationId, repositoryId);
        return res.status(400).json({
            success: false,
            message: 'Invalid Installation ID or Repository ID.',
        })
    }

    try {
        const { accessToken } = req.user;
        const octokit = new Octokit({ auth: accessToken });
        const repoData: Record<any, any> = {};

        const installation = await GithubInstallation.findById(installationId, { installationId: 1, _id: 0 });
        if (!installation) {
            console.error('Installation not found for ID:', installationId);
            return res.status(404).json({
                success: false,
                message: 'Invalid Installation ID.',
            });
        }

        // TODO: this call can be replaced with .rest.repos.get(...) just like 'POST /pullrequest/track' endpoint
        const data = await octokit.paginate(
            octokit.rest.apps.listInstallationReposForAuthenticatedUser,
            {
                installation_id: Number(installation.installationId),
                per_page: 100,
            }
        );

        if (data.length > 0) {
            const repositoryRecord = await Repo.findById(repositoryId);
            if (!repositoryRecord) {
                return res.status(404).json({
                    success: false,
                    message: 'Repository not found.',
                })
            }

            const githubRepoData = data.find(repo => repo.id === Number(repositoryRecord.githubId));
            if (!githubRepoData) {
                return res.status(403).json({
                    success: false,
                    message: 'Unauthorized accesss.',
                });
            }

            repoData['repository'] = {
                id: repositoryRecord._id.toString(),
                name: githubRepoData.name,
                fullName: githubRepoData.full_name,
                private: githubRepoData.private,
                htmlUrl: githubRepoData.html_url,
                installedOn: repositoryRecord.installedOn,
            }
            repoData['permissions'] = githubRepoData.permissions;

            // total PR records in RepoPRobe
            const totalPRsInRepoPRobe = await PullRequest.find({
                repoId: repositoryRecord._id,
            });

            // conflicting PRs
            const activePRIds = totalPRsInRepoPRobe
                .filter(pr => pr.isTracked && pr.state === 'open' && pr.deletedAt === null)
                .map(pr => pr._id);
            const conflictingPRs = await Conflict.find({
                $or: [
                    { prAId: { $in: activePRIds } },
                    { prBId: { $in: activePRIds } },
                ],
            });
            const conflictingPRIds = Array.from(
                new Set(
                    conflictingPRs.flatMap(pr => [
                        pr.prAId.toString(),
                        pr.prBId.toString(),
                    ])
                )
            );
            repoData['stats'] = {
                totalPRsInRepoPRobe,
                conflictingPRIds,
            }
        }

        return res.status(200).json({
            success: true,
            repository: repoData,
        });
    } catch (error) {
        console.log('Error fetching repository:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching repository',
        })
    }
});

apiRouter.post('/pullrequest/track', async (req, res) => {
    try {
        const { prNumber, repositoryId, installationId } = req.body;

        if (!isValidObjectId(repositoryId) || !isValidObjectId(installationId)) {
            console.error('Invalid Installation ID or Repository ID:', installationId, repositoryId);
            return res.status(400).json({
                success: false,
                message: 'Invalid Installation ID or Repository ID.',
            });
        }

        const installation = await GithubInstallation.findById(installationId, { installationId: 1, _id: 0 });
        if (!installation) {
            console.error('Installation not found for ID:', installationId);
            return res.status(404).json({
                success: false,
                message: 'Invalid Installation ID.',
            });
        }

        const repositoryRecord = await Repo.findById(repositoryId, { githubFullName: 1, _id: 0 });
        if (!repositoryRecord) {
            console.error('Repository not found for ID:', repositoryId);
            return res.status(404).json({
                success: false,
                message: 'Repository not found.',
            });
        }
        const [repoOwner, repoName] = repositoryRecord.githubFullName.split('/');

        const octokit = new Octokit({ auth: req.user?.accessToken });
        const { data: repo } = await octokit.rest.repos.get({
            owner: repoOwner,
            repo: repoName,
        });

        if (repo.permissions?.triage) {
            await commentQueue.add(QUEUE_EVENTS.COMMENT.TRACK, {
                prNumber: prNumber,
                repoOwnerLogin: repoOwner,
                repoName: repoName,
                repoId: repo.id.toString(),
                installationId: installation.installationId.toString(),
                source: 'dashboard'
            } satisfies CommentTrack, {
                jobId: `${QUEUE_EVENTS.COMMENT.TRACK}_${installation.installationId}_${repo.id}_${prNumber}`,
            });

            console.log(`Added ${QUEUE_EVENTS.COMMENT.TRACK} job to queue on PR ${prNumber} of repo ${repositoryRecord.githubFullName} via 'Dashboard'.`);

            return res.status(200).json({
                success: true,
                message: 'Pull request tracking initiated.',
            });
        } else {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to track pull request. Please ensure the app has triage access to the repository.',
            });
        }
    } catch (error) {
        console.error('Error tracking pull request:', error);
        return res.status(500).json({
            success: false,
            message: 'Error tracking pull request',
        });
    }
});

apiRouter.post('/pullrequest/untrack', async (req, res) => {
    try {
        const { prNumber, repositoryId, installationId } = req.body;

        if (!isValidObjectId(repositoryId) || !isValidObjectId(installationId)) {
            console.error('Invalid Installation ID or Repository ID:', installationId, repositoryId);
            return res.status(400).json({
                success: false,
                message: 'Invalid Installation ID or Repository ID.',
            });
        }

        const installation = await GithubInstallation.findById(installationId, { installationId: 1, _id: 0 });
        if (!installation) {
            console.error('Installation not found for ID:', installationId);
            return res.status(404).json({
                success: false,
                message: 'Invalid Installation ID.',
            });
        }

        const repositoryRecord = await Repo.findById(repositoryId, { githubFullName: 1, _id: 0 });
        if (!repositoryRecord) {
            console.error('Repository not found for ID:', repositoryId);
            return res.status(404).json({
                success: false,
                message: 'Repository not found.',
            });
        }
        const [repoOwner, repoName] = repositoryRecord.githubFullName.split('/');

        const octokit = new Octokit({ auth: req.user?.accessToken });
        const { data: repo } = await octokit.rest.repos.get({
            owner: repoOwner,
            repo: repoName,
        });

        if (repo.permissions?.triage) {
            await commentQueue.add(QUEUE_EVENTS.COMMENT.UNTRACK, {
                prNumber: prNumber,
                repoOwnerLogin: repoOwner,
                repoName: repoName,
                repoId: repo.id.toString(),
                installationId: installation.installationId.toString(),
                source: 'dashboard',
            } satisfies CommentUntrack, {
                jobId: `${QUEUE_EVENTS.COMMENT.UNTRACK}_${installation.installationId}_${repo.id}_${prNumber}`,
            });

            console.log(`Added ${QUEUE_EVENTS.COMMENT.UNTRACK} job to queue on PR ${prNumber} of repo ${repositoryRecord.githubFullName} via 'Dashboard'.`);
            return res.status(200).json({
                success: true,
                message: 'Pull request untrack initiated.',
            });
        } else {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to untrack pull request. Please ensure the app has triage access to the repository.',
            });
        }
    } catch (error) {
        console.error('Error tracking pull request:', error);
        return res.status(500).json({
            success: false,
            message: 'Error tracking pull request',
        });
    }
});

apiRouter.post('/pullrequest/sync', async (req, res) => {
    try {
        const { prNumber, repositoryId, installationId } = req.body;

        if (!isValidObjectId(repositoryId) || !isValidObjectId(installationId)) {
            console.error('Invalid Installation ID or Repository ID:', installationId, repositoryId);
            return res.status(400).json({
                success: false,
                message: 'Invalid Installation ID or Repository ID.',
            });
        }

        const installation = await GithubInstallation.findById(installationId, { installationId: 1, _id: 1 });
        if (!installation) {
            console.error('Installation not found for ID:', installationId);
            return res.status(404).json({
                success: false,
                message: 'Invalid Installation ID.',
            });
        }

        const repositoryRecord = await Repo.findById(repositoryId, { installationId: 1, githubFullName: 1, githubId: 1, _id: 0 });
        if (!repositoryRecord) {
            console.error('Repository not found for ID:', repositoryId);
            return res.status(404).json({
                success: false,
                message: 'Repository not found.',
            });
        }
        if (repositoryRecord.installationId.toString() !== installation._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Repository does not belong to the selected installation.',
            });
        }

        const pullRequestRecord = await PullRequest.findOne({ installationId, prNumber, repoId: repositoryId });
        if (!pullRequestRecord) {
            console.error('Pull request record not found for PR number:', prNumber, 'in repository:', repositoryId);
            return res.status(404).json({
                success: false,
                message: 'Pull request record not found.',
            });
        }

        const octokit = new Octokit({ auth: req.user?.accessToken });
        const [repoOwner, repoName] = repositoryRecord.githubFullName.split('/');

        const [{ data: repo }, { data: pullRequest }] = await Promise.all([
            octokit.rest.repos.get({
                owner: repoOwner,
                repo: repoName,
            }),
            octokit.rest.pulls.get({
                owner: repoOwner,
                repo: repoName,
                pull_number: prNumber,
            })
        ] as const);

        if (!repo.permissions?.push) {
            console.log('Insufficient permissions to sync pull request. Please ensure the app has push access to the repository.');
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to sync pull request. Please ensure the app has push access to the repository.',
            });
        }
        if (pullRequestRecord.processingStatus === 'pending' || pullRequestRecord.processingStatus === 'processing') {
            return res.status(200).json({
                success: true,
                message: 'The pull request is queued for processing. Please check back after a few minutes.',
            });
        }

        const isTitleChanged = pullRequest.title !== pullRequestRecord.title;
        const isStateChanged = pullRequest.state !== pullRequestRecord.state;
        const isDraftChanged = pullRequest.draft !== pullRequestRecord.isDraft;
        const isBaseBranchChanged = pullRequest.base.ref !== pullRequestRecord.baseBranch;
        const isBaseBranchHeadShaChanged = pullRequest.base.sha !== pullRequestRecord.baseBranchHeadSha;
        const isHeadBranchChanged = pullRequest.head.ref !== pullRequestRecord.headBranch;
        const isHeadBranchHeadShaChanged = pullRequest.head.sha !== pullRequestRecord.headBranchHeadSha;
        const isGithubUpdatedAtChanged = new Date(pullRequest.updated_at).getTime() !== new Date(pullRequestRecord.githubUpdatedAt).getTime();
        const isGithubClosedAtChanged = (pullRequest.closed_at ? new Date(pullRequest.closed_at).getTime() : null) !== (pullRequestRecord.githubClosedAt ? new Date(pullRequestRecord.githubClosedAt).getTime() : null);
        const isGithubMergedAtChanged = (pullRequest.merged_at ? new Date(pullRequest.merged_at).getTime() : null) !== (pullRequestRecord.githubMergedAt ? new Date(pullRequestRecord.githubMergedAt).getTime() : null);
        const isAssigneesChanged = JSON.stringify(pullRequest.assignees?.map(assignee => assignee.id.toString()).sort()) !== JSON.stringify(pullRequestRecord.assignees.map(assignee => assignee.id).sort());
        const isLabelsChanged = JSON.stringify(pullRequest.labels.map(label => label.id).sort()) !== JSON.stringify(pullRequestRecord.labels.map(label => label.id).sort());

        if (
            !isTitleChanged &&
            !isStateChanged &&
            !isDraftChanged &&
            !isBaseBranchChanged &&
            !isBaseBranchHeadShaChanged &&
            !isHeadBranchChanged &&
            !isHeadBranchHeadShaChanged &&
            !isGithubUpdatedAtChanged &&
            !isGithubClosedAtChanged &&
            !isGithubMergedAtChanged &&
            !isAssigneesChanged &&
            !isLabelsChanged
        ) {
            console.log(`No changes detected for PR ${prNumber} in repo ${repositoryRecord.githubFullName} for installation ${installation.installationId}.`);
            return res.status(200).json({
                success: true,
                message: 'Pull Request is already synced. No changes detected for the pull request.',
            });
        }

        const isSyncNeeded =
            (isStateChanged && pullRequest.state === 'open') ||
            isHeadBranchChanged ||
            isHeadBranchHeadShaChanged;

        if (isSyncNeeded) {
            await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.OPENED, {
                replacementRecordId: pullRequestRecord._id.toString(),
                installationId: installation.installationId,
                repositoryId: repositoryRecord.githubId,
                repoOwnerLogin: repoOwner,
                repoName: repoName,
                prId: pullRequest.id.toString(),
                prNumber: prNumber,
                prTitle: pullRequest.title,
                prHtmlUrl: pullRequest.html_url,
                prState: pullRequest.state,
                isDraft: pullRequest.draft,
                baseBranchRef: pullRequest.base.ref,
                baseBranchHeadSha: pullRequest.base.sha,
                headBranchRef: pullRequest.head.ref,
                headBranchHeadSha: pullRequest.head.sha,
                author: {
                    id: pullRequest.user.id.toString(),
                    login: pullRequest.user.login,
                    avatarUrl: pullRequest.user.avatar_url,
                    githubUrl: pullRequest.user.html_url,
                    userType: pullRequest.user.type,
                },
                prLabels: pullRequest.labels.map(label => ({
                    id: label.id.toString(),
                    name: label.name,
                    default: label.default,
                })),
                prCreatedOn: pullRequest.created_at,
                prUpdatedAt: pullRequest.updated_at,
                source: 'dashboard',
            } satisfies PullRequestOpened, {
                jobId: `${QUEUE_EVENTS.PULL_REQUEST.OPENED}_${installation.installationId}_${pullRequest.id}_${pullRequestRecord._id}`,
            });
            // Only the old ID can be deleted, even if the worker has already created its replacement.
            await PullRequest.deleteOne({ _id: pullRequestRecord._id });

            console.log(`PR changes detected, added to ${QUEUE_EVENTS.PULL_REQUEST.OPENED} queue for processing:`, installation.installationId, pullRequest.id);
            return res.status(200).json({
                success: true,
                message: 'Pull request sync initiated. Pull request will not be visible until the sync is completed. Please check back after a few minutes.',
            });
        }

        await PullRequest.updateOne(
            { _id: pullRequestRecord._id },
            {
                $set: {
                    ...(isTitleChanged && { title: pullRequest.title }),
                    ...(isStateChanged && { state: pullRequest.state }),
                    ...(isDraftChanged && { isDraft: pullRequest.draft }),
                    ...(isBaseBranchChanged && { baseBranch: pullRequest.base.ref }),
                    ...(isBaseBranchHeadShaChanged && { baseBranchHeadSha: pullRequest.base.sha }),
                    ...(isGithubUpdatedAtChanged && { githubUpdatedAt: new Date(pullRequest.updated_at) }),
                    ...(isGithubClosedAtChanged && { githubClosedAt: pullRequest.closed_at ? new Date(pullRequest.closed_at) : null }),
                    ...(isGithubMergedAtChanged && { githubMergedAt: pullRequest.merged_at ? new Date(pullRequest.merged_at) : null }),
                    ...(isAssigneesChanged && {
                        assignees: pullRequest.assignees?.map(assignee => ({
                            id: assignee.id.toString(),
                            login: assignee.login,
                            avatarUrl: assignee.avatar_url,
                            githubUrl: assignee.html_url,
                            userType: assignee.type,
                        })) ?? [],
                    }),
                    ...(isLabelsChanged && {
                        labels: pullRequest.labels.map(label => ({
                            id: label.id.toString(),
                            name: label.name,
                            default: label.default,
                        }))
                    }),
                },
            },
        );

        const conflictsNeedsRefreshed = isBaseBranchChanged || isBaseBranchHeadShaChanged;
        if (conflictsNeedsRefreshed) {
            await conflictDetectionQueue.add(QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR, {
                prId: pullRequestRecord._id.toString(),
                installationId: Number(installation.installationId),
                repoName: repoName,
                repoOwnerLogin: repoOwner,
                source: 'dashboard',
            } satisfies ConflictDetectionScanPR, {
                jobId: `${QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR}_${pullRequestRecord._id}`,
            });
            console.log(`Conflict detection scan job added for PR ${prNumber} in repo ${repoName} for installation ${installation._id}`);
        }

        return res.status(200).json({
            success: true,
            message: 'Pull request sync initiated. Please check back after a few minutes to see the updated pull request details.',
        });
    } catch (error) {
        console.error('Error syncing pull request:', error);
        return res.status(500).json({
            success: false,
            message: 'Error syncing pull request',
        });
    }
});

apiRouter.post('/pullrequest/scan-conflicts', async (req, res) => {
    try {
        const { prNumber, repositoryId, installationId } = req.body;

        if (!isValidObjectId(repositoryId) || !isValidObjectId(installationId)) {
            console.error('Invalid Installation ID or Repository ID:', installationId, repositoryId);
            return res.status(400).json({
                success: false,
                message: 'Invalid Installation ID or Repository ID.',
            });
        }

        const installation = await GithubInstallation.findById(installationId, { installationId: 1, _id: 1 });
        if (!installation) {
            console.error('Installation not found for ID:', installationId);
            return res.status(404).json({
                success: false,
                message: 'Invalid Installation ID.',
            });
        }

        const repositoryRecord = await Repo.findById(repositoryId, { installationId: 1, githubFullName: 1, githubId: 1, _id: 0 });
        if (!repositoryRecord) {
            console.error('Repository not found for ID:', repositoryId);
            return res.status(404).json({
                success: false,
                message: 'Repository not found.',
            });
        }
        if (repositoryRecord.installationId.toString() !== installation._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Repository does not belong to the selected installation.',
            });
        }

        const [repoOwner, repoName] = repositoryRecord.githubFullName.split('/');
        const octokit = new Octokit({ auth: req.user?.accessToken });
        try {
            const { data: repo } = await octokit.rest.repos.get({ owner: repoOwner, repo: repoName });
            if (!repo.permissions?.push) {
                return res.status(403).json({
                    success: false,
                    message: 'Insufficient permissions to scan conflicts. Please ensure you have push access to the repository.',
                });
            }
        } catch (error) {
            console.error('Unable to access repository for conflict scan:', error);
            return res.status(403).json({
                success: false,
                message: 'You do not have access to this repository.',
            });
        }

        const pullRequestRecord = await PullRequest.findOne({ installationId, prNumber, repoId: repositoryId });
        if (!pullRequestRecord) {
            console.error('Pull request record not found for PR number:', prNumber, 'in repository:', repositoryId);
            return res.status(404).json({
                success: false,
                message: 'Pull request record not found.',
            });
        }

        await conflictDetectionQueue.add(QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR, {
            prId: pullRequestRecord._id.toString(),
            installationId: Number(installation.installationId),
            repoName: repoName,
            repoOwnerLogin: repoOwner,
            source: 'dashboard',
        } satisfies ConflictDetectionScanPR, {
            jobId: `${QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR}_${pullRequestRecord._id}`,
        });
        console.log(`Conflict detection scan job added for PR ${prNumber} in repo ${repoName} for installation ${installation._id}`);

        return res.status(200).json({
            success: true,
            message: 'Pull request conflict scan initiated. Please check back after a few minutes to see the updated pull request details.',
        });
    } catch (error) {
        console.error('Error scanning pull request conflicts:', error);
        return res.status(500).json({
            success: false,
            message: 'Error scanning pull request conflicts',
        });
    }
});

apiRouter.post('/pullrequest/retry-processing', async (req, res) => {
    try {
        const { prNumber, repositoryId, installationId } = req.body;

        if (!isValidObjectId(repositoryId) || !isValidObjectId(installationId)) {
            console.error('Invalid Installation ID or Repository ID:', installationId, repositoryId);
            return res.status(400).json({
                success: false,
                message: 'Invalid Installation ID or Repository ID.',
            });
        }

        const installation = await GithubInstallation.findById(installationId, { installationId: 1, _id: 1 });
        if (!installation) {
            console.error('Installation not found for ID:', installationId);
            return res.status(404).json({
                success: false,
                message: 'Invalid Installation ID.',
            });
        }

        const repositoryRecord = await Repo.findById(repositoryId, { installationId: 1, githubFullName: 1, githubId: 1, _id: 0 });
        if (!repositoryRecord) {
            console.error('Repository not found for ID:', repositoryId);
            return res.status(404).json({
                success: false,
                message: 'Repository not found.',
            });
        }

        if (repositoryRecord.installationId.toString() !== installation._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Repository does not belong to the selected installation.',
            });
        }

        const pullRequestRecord = await PullRequest.findOne({ installationId, prNumber, repoId: repositoryId, processingStatus: 'error' });
        if (!pullRequestRecord) {
            console.error('Pull request record not found for PR number:', prNumber, 'in repository:', repositoryId, 'with processingStatus "error"');
            return res.status(404).json({
                success: false,
                message: 'Pull request record not found.',
            });
        }

        const octokit = new Octokit({ auth: req.user?.accessToken });
        const [repoOwner, repoName] = repositoryRecord.githubFullName.split('/');

        const [repoResponse, prResponse] = await Promise.allSettled([
            octokit.rest.repos.get({ owner: repoOwner, repo: repoName }),
            octokit.rest.pulls.get({ owner: repoOwner, repo: repoName, pull_number: prNumber }),
        ]);
        if (repoResponse.status === 'rejected' || !repoResponse.value.data.permissions?.push) {
            return res.status(403).json({
                success: false,
                message: 'Insufficient permissions to retry pull request processing. Push access is required.',
            });
        }
        if (prResponse.status === 'rejected') throw prResponse.reason;
        const pullRequest = prResponse.value.data;

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.OPENED, {
            replacementRecordId: pullRequestRecord._id.toString(),
            installationId: installation.installationId,
            repositoryId: repositoryRecord.githubId,
            repoOwnerLogin: repoOwner,
            repoName: repoName,
            prId: pullRequest.id.toString(),
            prNumber: prNumber,
            prTitle: pullRequest.title,
            prHtmlUrl: pullRequest.html_url,
            prState: pullRequest.state,
            isDraft: pullRequest.draft,
            baseBranchRef: pullRequest.base.ref,
            baseBranchHeadSha: pullRequest.base.sha,
            headBranchRef: pullRequest.head.ref,
            headBranchHeadSha: pullRequest.head.sha,
            author: {
                id: pullRequest.user.id.toString(),
                login: pullRequest.user.login,
                avatarUrl: pullRequest.user.avatar_url,
                githubUrl: pullRequest.user.html_url,
                userType: pullRequest.user.type,
            },
            prLabels: pullRequest.labels.map(label => ({
                id: label.id.toString(),
                name: label.name,
                default: label.default,
            })),
            prCreatedOn: pullRequest.created_at,
            prUpdatedAt: pullRequest.updated_at,
            source: 'dashboard',
        } satisfies PullRequestOpened, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.OPENED}_${installation.installationId}_${pullRequest.id}_${pullRequestRecord._id}`,
        });
        // Only the old ID can be deleted, even if the worker has already created its replacement.
        await PullRequest.deleteOne({ _id: pullRequestRecord._id });

        console.log(`Retrying pull request processing for PR ${prNumber} in repo ${repositoryRecord.githubFullName} for installation ${installation._id}`);
        return res.status(200).json({
            success: true,
            message: 'Pull request processing retry initiated. Please check back after a few minutes to see the updated pull request details.',
        });
    } catch (error) {
        console.log('Error retrying pull request processing:', error);
        return res.status(500).json({
            success: false,
            message: 'Error retrying pull request processing',
        });
    }
});

apiRouter.get('/pullrequest/conflicts', async (req, res) => {
    try {
        const { prNumber, repositoryId, installationId } = req.query;

        if (
            typeof prNumber !== 'string' ||
            typeof repositoryId !== 'string' ||
            typeof installationId !== 'string' ||
            !Number.isInteger(Number(prNumber)) ||
            Number(prNumber) < 1 ||
            !isValidObjectId(repositoryId) ||
            !isValidObjectId(installationId)
        ) {
            console.error('Invalid Installation ID or Repository ID:', installationId, repositoryId);
            return res.status(400).json({
                success: false,
                message: 'Invalid PR number, Installation ID, or Repository ID.',
            });
        }

        const parsedPrNumber = Number(prNumber);
        const installation = await GithubInstallation.findById(installationId, { installationId: 1, _id: 1 });
        if (!installation) {
            console.error('Installation not found for ID:', installationId);
            return res.status(404).json({
                success: false,
                message: 'Invalid Installation ID.',
            });
        }

        const repositoryRecord = await Repo.findById(repositoryId, { installationId: 1, githubFullName: 1, githubId: 1, _id: 0 });
        if (!repositoryRecord) {
            console.error('Repository not found for ID:', repositoryId);
            return res.status(404).json({
                success: false,
                message: 'Repository not found.',
            });
        }
        if (repositoryRecord.installationId.toString() !== installation._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Repository does not belong to the selected installation.',
            });
        }

        const [repoOwner, repoName] = repositoryRecord.githubFullName.split('/');
        try {
            const octokit = new Octokit({ auth: req.user?.accessToken });
            await octokit.rest.repos.get({ owner: repoOwner, repo: repoName });
        } catch (error) {
            console.error('Unable to access repository for conflict lookup:', error);
            return res.status(403).json({
                success: false,
                message: 'You do not have access to this repository.',
            });
        }

        const pullRequestRecord = await PullRequest.findOne({
            installationId: new Types.ObjectId(installationId),
            prNumber: parsedPrNumber,
            repoId: new Types.ObjectId(repositoryId),
        });
        if (!pullRequestRecord) {
            console.error('Pull request record not found for PR number:', prNumber, 'in repository:', repositoryId);
            return res.status(404).json({
                success: false,
                message: 'Pull request record not found.',
            });
        }

        /**
         * Pipeline returns:
         * {
         *   file: string,
         *   prAId: ObjectId,
         *   prBId: ObjectId,
         *   conflictingLineNumbers: {
         *       removed: number[],
         *       added: number[]
         *   }
         *   prAFile: pullRequestFile document,
         *   prBFile: pullRequestFile document,
         *   prB: { _id, title, prNumber, htmlUrl }
         * }
         */
        const conflicts = await Conflict.aggregate([
            {
                $match: {
                    prAId: pullRequestRecord._id,
                }
            },
            {
                $group: {
                    _id: {
                        file: "$file",
                        prAId: "$prAId",
                        prBId: "$prBId"
                    },
                    removedArrays: {
                        $push: {
                            $ifNull: [
                                "$conflictingLineNumbers.removed",
                                []
                            ]
                        }
                    },
                    addedArrays: {
                        $push: {
                            $ifNull: [
                                "$conflictingLineNumbers.added",
                                []
                            ]
                        }
                    }
                }
            },
            {
                $project: {
                    _id: 0,
                    file: "$_id.file",
                    prAId: "$_id.prAId",
                    prBId: "$_id.prBId",
                    "conflictingLineNumbers.removed": {
                        $reduce: {
                            input: "$removedArrays",
                            initialValue: [],
                            in: {
                                $setUnion: ["$$value", "$$this"]
                            }
                        }
                    },
                    "conflictingLineNumbers.added": {
                        $reduce: {
                            input: "$addedArrays",
                            initialValue: [],
                            in: {
                                $setUnion: ["$$value", "$$this"]
                            }
                        }
                    }
                }
            },
            {
                $lookup: {
                    from: "pullrequestfiles",
                    let: {
                        lookupPrAId: "$prAId",
                        lookupFile: "$file"
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        {
                                            $eq: [
                                                "$pullRequestId",
                                                "$$lookupPrAId"
                                            ]
                                        },
                                        {
                                            $or: [
                                                {
                                                    $eq: [
                                                        "$file",
                                                        "$$lookupFile"
                                                    ]
                                                },
                                                {
                                                    $eq: [
                                                        "$previousFilePath",
                                                        "$$lookupFile"
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "prAFile"
                }
            },
            {
                $lookup: {
                    from: "pullrequestfiles",
                    let: {
                        lookupPrBId: "$prBId",
                        lookupFile: "$file"
                    },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        {
                                            $eq: [
                                                "$pullRequestId",
                                                "$$lookupPrBId"
                                            ]
                                        },
                                        {
                                            $or: [
                                                {
                                                    $eq: [
                                                        "$file",
                                                        "$$lookupFile"
                                                    ]
                                                },
                                                {
                                                    $eq: [
                                                        "$previousFilePath",
                                                        "$$lookupFile"
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                }
                            }
                        }
                    ],
                    as: "prBFile"
                }
            },
            {
                $unwind: {
                    path: "$prAFile",
                    preserveNullAndEmptyArrays: true,
                }
            },
            {
                $unwind: {
                    path: "$prBFile",
                    preserveNullAndEmptyArrays: true,
                }
            },
            {
                $lookup: {
                    from: "pullrequests",
                    let: { prId: "$prAFile.pullRequestId" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$_id", "$$prId"] }
                            }
                        },
                        {
                            $project: {
                                _id: 1,
                                title: 1,
                                prNumber: 1,
                                htmlUrl: 1,
                            }
                        }
                    ],
                    as: "prA"
                }
            },
            {
                $unwind: {
                    path: "$prA",
                    preserveNullAndEmptyArrays: true
                }
            },
            {
                $lookup: {
                    from: "pullrequests",
                    let: { prId: "$prBFile.pullRequestId" },
                    pipeline: [
                        {
                            $match: {
                                $expr: { $eq: ["$_id", "$$prId"] }
                            }
                        },
                        {
                            $project: {
                                _id: 1,
                                title: 1,
                                prNumber: 1,
                                htmlUrl: 1,
                            }
                        }
                    ],
                    as: "prB"
                }
            },
            {
                $unwind: {
                    path: "$prB",
                    preserveNullAndEmptyArrays: true
                }
            }
        ]);

        return res.status(200).json({
            success: true,
            conflicts: conflicts,
        });
    } catch (error) {
        console.log('Error fetching pull request conflicts:', error);
        return res.status(500).json({
            success: false,
            message: 'Error fetching pull request conflicts',
        });
    }
});

export { apiRouter };