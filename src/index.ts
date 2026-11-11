import 'dotenv/config';
import { Webhooks } from '@octokit/webhooks';
import express from 'express';
import { type Server } from 'node:http';
import { closeDB, connectDB } from './db/index.js';
import { installationQueue } from './queues/installation.queue.js';
import { conflictDetectionQueue } from './queues/conflict-detection.queue.js';
import { QUEUE_EVENTS } from './types/queue-events.js';
import { CommentCheck, CommentHelp, CommentInvalidCommand, CommentStatus, CommentTrack, CommentUntrack, InstallationCreated, InstallationDeleted, InstallationRepositoriesAdded, InstallationRepositoriesRemoved, InstallationSuspend, PullRequestAssigned, PullRequestClosed, PullRequestConvertedToDraft, PullRequestEdited, PullRequestLabeled, PullRequestOpened, PullRequestReadyForReview, PullRequestReopened, PullRequestSynchronize, PullRequestUnassigned, PullRequestUnlabeled } from './types/queue-payloads.js';
import { pullRequestQueue } from './queues/pull-request.queue.js';
import { AllowedAuthorAssociations } from './utils/common/index.js';
import { commentQueue } from './queues/comment.queue.js';
import { redisConnection } from './utils/queue/connection.js';
import { addCommentReaction, SupportedCommentCommands } from './utils/common/comment.js';
import { serverAdapter } from './bull-board.js';
import { apiRouter } from './routes/api.routes.js';
import basicAuth from 'express-basic-auth';

const githubWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
const PORT = process.env.PORT;
const bullBoardUsername = process.env.BULL_BOARD_USERNAME;
const bullBoardPassword = process.env.BULL_BOARD_PASSWORD;
const HTTP_DRAIN_TIMEOUT_MS = 10_000;

if (!PORT) {
    throw new Error("PORT env not set !!");
}
if (!githubWebhookSecret) {
    throw new Error("GITHUB_WEBHOOK_SECRET env not set !!");
}
if (!bullBoardUsername?.trim() || !bullBoardPassword?.trim()) {
    throw new Error("BULL_BOARD_USERNAME and BULL_BOARD_PASSWORD must be set and non-empty !!");
}

const server = express();
const webhooks = new Webhooks({ secret: githubWebhookSecret });

server.get('/health', (req, res) => {
    console.log('Health check requested (server)', {
        ip: req.ip,
        userAgent: req.get('user-agent'),
    });
    res.status(200).send('OK');
});

// bull-board endpoint
const bullBoardAuth = basicAuth({
    users: {
        [bullBoardUsername]: bullBoardPassword,
    },
    challenge: true,
});
server.use('/admin/queues', bullBoardAuth, serverAdapter.getRouter());
server.use('/api', apiRouter);

server.post("/webhook", express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['x-hub-signature-256'] as string
    const body = req.body.toString()

    try {
        await webhooks.verifyAndReceive({
            id: req.headers['x-github-delivery'] as string,
            name: req.headers['x-github-event'] as any,
            signature,
            payload: body
        })
        res.status(200).send('ok');
    } catch (error) {
        console.log("Error [webhook]:", error);
        res.status(401).send('Invalid signature');
    }
});

/**
 * Installation Related Webhooks
 */

webhooks.on("installation.created", async ({ payload }) => {
    try {
        const account = payload.installation.account;
        const owner = account ? {
            id: account.id.toString(),
            login: 'login' in account ? account.login : account.slug,
            avatarUrl: account.avatar_url,
            githubUrl: account.html_url,
            userType: 'type' in account ? account.type : 'Organization',
        } : null;
        const installedBy = {
            id: payload.sender.id.toString(),
            login: payload.sender.login,
            avatarUrl: payload.sender.avatar_url,
            githubUrl: payload.sender.html_url,
            userType: payload.sender.type,
        };

        await installationQueue.add(QUEUE_EVENTS.INSTALLATION.CREATED, {
            installationId: payload.installation.id.toString(),
            owner: owner,
            installedBy: installedBy,
            installationHtmlUrl: payload.installation.html_url,
            installationTargetId: payload.installation.target_id.toString(),
            installationAccountType: payload.installation.target_type,
            installationInstalledOn: payload.installation.created_at,
            installationUpdatedAt: payload.installation.updated_at,
            installationRepositorySelection: payload.installation.repository_selection,
            repositories: payload.repositories?.map(repo => ({
                id: repo.id.toString(),
                name: repo.name,
                full_name: repo.full_name,
            })) ?? [],
        } satisfies InstallationCreated, {
            jobId: `${QUEUE_EVENTS.INSTALLATION.CREATED}_${payload.installation.id}`,
        });

        console.log(`Added installation.created job to queue for installation ${payload.installation.id}`);
    } catch (error) {
        console.log("Error [installation.created]:", error);
    }
});

webhooks.on("installation.deleted", async ({ payload }) => {
    try {
        await installationQueue.add(QUEUE_EVENTS.INSTALLATION.DELETED, {
            installationId: payload.installation.id.toString(),
        } satisfies InstallationDeleted, {
            jobId: `${QUEUE_EVENTS.INSTALLATION.DELETED}_${payload.installation.id}`,
        });

        console.log(`Added installation.deleted job to queue for installation ${payload.installation.id}`);
    } catch (error) {
        console.log("Error [installation.deleted]:", error);
    }
});

webhooks.on("installation.suspend", async ({ payload }) => {
    try {
        await installationQueue.add(QUEUE_EVENTS.INSTALLATION.SUSPEND, {
            installationId: payload.installation.id.toString(),
        } satisfies InstallationSuspend, {
            jobId: `${QUEUE_EVENTS.INSTALLATION.SUSPEND}_${payload.installation.id}`
        });

        console.log(`Added installation.suspend job to queue for installation ${payload.installation.id}`);
    } catch (error) {
        console.log("Error [installation.suspend]:", error)
    }
});

webhooks.on("installation.unsuspend", async ({ payload }) => {
    try {
        await installationQueue.add(QUEUE_EVENTS.INSTALLATION.UNSUSPEND, {
            installationId: payload.installation.id.toString(),
        } satisfies InstallationSuspend, {
            jobId: `${QUEUE_EVENTS.INSTALLATION.UNSUSPEND}_${payload.installation.id}`
        });

        console.log(`Added installation.unsuspend job to queue for installation ${payload.installation.id}`);
    } catch (error) {
        console.log("Error [installation.unsuspend]:", error)
    }
});

webhooks.on("installation_repositories.added", async ({ payload }) => {
    try {
        await installationQueue.add(QUEUE_EVENTS.INSTALLATION_REPOSITORIES.ADDED, {
            installationId: payload.installation.id.toString(),
            installationRepositorySelection: payload.installation.repository_selection,
            repositoriesAdded: payload.repositories_added.map(repo => ({
                id: repo.id.toString(),
                name: repo.name,
                full_name: repo.full_name,
            })),
        } satisfies InstallationRepositoriesAdded, {
            jobId: `${QUEUE_EVENTS.INSTALLATION_REPOSITORIES.ADDED}_${payload.installation.id}_${payload.repositories_added.map(repo => repo.id).join('_')}`,
        });

        console.log(`Added installation_repositories.added job to queue for installation ${payload.installation.id}`);
    } catch (error) {
        console.log("Error [installation_repositories.added]:", error);
    }
});

webhooks.on("installation_repositories.removed", async ({ payload }) => {
    try {
        await installationQueue.add(QUEUE_EVENTS.INSTALLATION_REPOSITORIES.REMOVED, {
            installationId: payload.installation.id.toString(),
            repositoriesRemoved: payload.repositories_removed.map(repo => ({
                id: repo.id.toString(),
            })),
        } satisfies InstallationRepositoriesRemoved, {
            jobId: `${QUEUE_EVENTS.INSTALLATION_REPOSITORIES.REMOVED}_${payload.installation.id}_${payload.repositories_removed.map(repo => repo.id).join('_')}`,
        });

        console.log(`Added installation_repositories.removed job to queue for installation ${payload.installation.id}`);
    } catch (error) {
        console.log("Error [installation_repositories.removed]:", error);
    }
});


/**
 * PR Related Webhooks
 */
webhooks.on("pull_request.opened", async ({ payload }) => {
    try {
        if (!payload.installation) {
            console.log("No installation found in payload for pull_request.opened");
            return;
        }

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.OPENED, {
            installationId: payload.installation.id.toString(),
            repositoryId: payload.repository.id.toString(),
            repoOwnerLogin: payload.repository.owner.login,
            repoName: payload.repository.name,
            prId: payload.pull_request.id.toString(),
            prNumber: payload.pull_request.number,
            prTitle: payload.pull_request.title,
            prHtmlUrl: payload.pull_request.html_url,
            prState: payload.pull_request.state,
            isDraft: payload.pull_request.draft,
            baseBranchRef: payload.pull_request.base.ref,
            baseBranchHeadSha: payload.pull_request.base.sha,
            headBranchRef: payload.pull_request.head.ref,
            headBranchHeadSha: payload.pull_request.head.sha,
            author: {
                id: payload.pull_request.user.id.toString(),
                login: payload.pull_request.user.login,
                avatarUrl: payload.pull_request.user.avatar_url,
                githubUrl: payload.pull_request.user.html_url,
                userType: payload.pull_request.user.type,
            },
            prLabels: payload.pull_request.labels.map(label => ({
                id: label.id.toString(),
                name: label.name,
                default: label.default,
            })),
            prCreatedOn: payload.pull_request.created_at,
            prUpdatedAt: payload.pull_request.updated_at,
            source: 'webhook',
        } satisfies PullRequestOpened, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.OPENED}_${payload.installation.id}_${payload.pull_request.id}`,
        });

        console.log(`Added pull_request.opened job to queue for PR ${payload.pull_request.id}`);
    } catch (error) {
        console.log("Error [pull_request.opened]:", error);
    }
});

webhooks.on("pull_request.closed", async ({ payload }) => {
    try {
        if (!payload.installation) {
            console.log("No installation found in payload for pull_request.closed");
            return;
        }

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.CLOSED, {
            installationId: payload.installation.id.toString(),
            prId: payload.pull_request.id.toString(),
            updatedAt: payload.pull_request.updated_at,
            prState: payload.pull_request.merged_at === null ? 'closed' : 'merged',
            mergedAt: payload.pull_request.merged_at,
        } satisfies PullRequestClosed, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.CLOSED}_${payload.installation.id}_${payload.pull_request.id}`,
        });

        console.log(`Added pull_request.closed job to queue for PR ${payload.pull_request.id}`);
    } catch (error) {
        console.log("Error [pull_request.closed]:", error);
    }
});

webhooks.on("pull_request.reopened", async ({ payload }) => {
    try {
        if (!payload.installation) {
            console.log("No installation found in payload for pull_request.reopened");
            return;
        }

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.REOPENED, {
            installationId: payload.installation.id.toString(),
            prId: payload.pull_request.id.toString(),
            prState: payload.pull_request.state,
            updatedAt: payload.pull_request.updated_at,
        } satisfies PullRequestReopened, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.REOPENED}_${payload.installation.id}_${payload.pull_request.id}`,
        });

        console.log(`Added pull_request.reopened job to queue for PR ${payload.pull_request.id}`);
    } catch (error) {
        console.log("Error [pull_request.reopened]:", error);
    }
});

webhooks.on("pull_request.synchronize", async ({ payload }) => {
    try {
        if (!payload.installation) {
            console.log("No installation found in payload for pull_request.synchronize");
            return;
        }

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.SYNCHRONIZE, {
            installationId: payload.installation.id.toString(),
            prId: payload.pull_request.id.toString(),
            repoOwnerLogin: payload.repository.owner.login,
            repoName: payload.repository.name,
            prNumber: payload.pull_request.number,
            updatedAt: payload.pull_request.updated_at,
            beforeCommitSha: payload.before,
            afterCommitSha: payload.after,
        } satisfies PullRequestSynchronize, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.SYNCHRONIZE}_${payload.installation.id}_${payload.pull_request.id}_${payload.before}_${payload.after}`,
        });

        console.log(`Added pull_request.synchronize job to queue for PR ${payload.pull_request.id}`);
    } catch (error) {
        console.log("Error [pull_request.synchronize]:", error);
    }
});

webhooks.on("pull_request.edited", async ({ payload }) => {
    try {
        if (!payload.installation) {
            console.log("No installation found in payload for pull_request.edited");
            return;
        }

        const queuePayload: Record<string, any> = {};

        if (payload.changes.title) {
            queuePayload.updatedTitle = payload.pull_request.title;
        }
        if (payload.changes.base) { // base branch changed
            queuePayload.updatedBase = payload.pull_request.base.ref;
            queuePayload.updatedBaseSha = payload.pull_request.base.sha;
        }

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.EDITED, {
            installationId: payload.installation.id.toString(),
            prId: payload.pull_request.id.toString(),
            updatedAt: payload.pull_request.updated_at,
            repoName: payload.repository.name,
            repoOwnerLogin: payload.repository.owner.login,
            ...queuePayload,
        } satisfies PullRequestEdited, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.EDITED}_${payload.installation.id}_${payload.pull_request.id}_${payload.pull_request.updated_at}`,
        });

        console.log(`Added pull_request.edited job to queue for PR ${payload.pull_request.id}`);
    } catch (error) {
        console.log("Error [pull_request.edited]:", error);
    }
});

webhooks.on("pull_request.converted_to_draft", async ({ payload }) => {
    try {
        if (!payload.installation) {
            console.log("No installation found in payload for pull_request.converted_to_draft");
            return;
        }

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.CONVERTED_TO_DRAFT, {
            installationId: payload.installation.id.toString(),
            prId: payload.pull_request.id.toString(),
            updatedAt: payload.pull_request.updated_at,
        } satisfies PullRequestConvertedToDraft, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.CONVERTED_TO_DRAFT}_${payload.installation.id}_${payload.pull_request.id}`,
        });

        console.log(`Added pull_request.converted_to_draft job to queue for PR ${payload.pull_request.id}`);
    } catch (error) {
        console.log("Error [pull_request.converted_to_draft]:", error);
    }
});

webhooks.on("pull_request.ready_for_review", async ({ payload }) => {
    try {
        if (!payload.installation) {
            console.log("No installation found in payload for pull_request.ready_for_review");
            return;
        }

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.READY_FOR_REVIEW, {
            installationId: payload.installation.id.toString(),
            prId: payload.pull_request.id.toString(),
            updatedAt: payload.pull_request.updated_at,
        } satisfies PullRequestReadyForReview, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.READY_FOR_REVIEW}_${payload.installation.id}_${payload.pull_request.id}`,
        });

        console.log(`Added pull_request.ready_for_review job to queue for PR ${payload.pull_request.id}`);
    } catch (error) {
        console.log("Error [pull_request.ready_for_review]:", error);
    }
});

webhooks.on("pull_request.labeled", async ({ payload }) => {
    try {
        if (!payload.installation) {
            console.log("No installation found in payload for pull_request.labeled");
            return;
        }
        if (!payload.label) {
            console.log("No label found in payload for pull_request.labeled");
            return;
        }

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.LABELED, {
            installationId: payload.installation.id.toString(),
            prId: payload.pull_request.id.toString(),
            updatedAt: payload.pull_request.updated_at,
            label: {
                id: payload.label.id.toString(),
                name: payload.label.name,
                default: payload.label.default,
            },
        } satisfies PullRequestLabeled, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.LABELED}_${payload.installation.id}_${payload.pull_request.id}_${payload.pull_request.updated_at}`,
        });

        console.log(`Added pull_request.labeled job to queue for PR ${payload.pull_request.id}`);
    } catch (error) {
        console.log("Error [pull_request.labeled]:", error);
    }
});

webhooks.on("pull_request.unlabeled", async ({ payload }) => {
    try {
        if (!payload.installation) {
            console.log("No installation found in payload for pull_request.unlabeled");
            return;
        }
        if (!payload.label) {
            console.log("No label found in payload for pull_request.unlabeled");
            return;
        }

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.UNLABELED, {
            installationId: payload.installation.id.toString(),
            prId: payload.pull_request.id.toString(),
            updatedAt: payload.pull_request.updated_at,
            label: {
                id: payload.label.id.toString(),
                name: payload.label.name,
                default: payload.label.default,
            },
        } satisfies PullRequestUnlabeled, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.UNLABELED}_${payload.installation.id}_${payload.pull_request.id}_${payload.pull_request.updated_at}`,
        });

        console.log(`Added pull_request.unlabeled job to queue for PR ${payload.pull_request.id}`);
    } catch (error) {
        console.log("Error [pull_request.unlabeled]:", error);
    }
});

webhooks.on("pull_request.assigned", async ({ payload }) => {
    try {
        if (!payload.installation) {
            console.log("No installation found in payload for pull_request.assigned");
            return;
        }
        if (!payload.assignee) {
            console.log("No assignee found in payload for pull_request.assigned");
            return;
        }

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.ASSIGNED, {
            installationId: payload.installation.id.toString(),
            prId: payload.pull_request.id.toString(),
            updatedAt: payload.pull_request.updated_at,
            assignee: {
                id: payload.assignee.id.toString(),
                login: payload.assignee.login,
                avatarUrl: payload.assignee.avatar_url ?? '',
                githubUrl: payload.assignee.html_url ?? '',
                userType: payload.assignee.type ?? '',
            },
        } satisfies PullRequestAssigned, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.ASSIGNED}_${payload.installation.id}_${payload.pull_request.id}_${payload.pull_request.updated_at}`,
        });

        console.log(`Added pull_request.assigned job to queue for PR ${payload.pull_request.id}`);
    } catch (error) {
        console.log("Error [pull_request.assigned]:", error);
    }
});

webhooks.on("pull_request.unassigned", async ({ payload }) => {
    try {
        if (!payload.installation) {
            console.log("No installation found in payload for pull_request.assigned");
            return;
        }
        if (!payload.assignee) {
            console.log("No assignee found in payload for pull_request.assigned");
            return;
        }

        await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.UNASSIGNED, {
            installationId: payload.installation.id.toString(),
            prId: payload.pull_request.id.toString(),
            updatedAt: payload.pull_request.updated_at,
            assignee: {
                id: payload.assignee.id.toString(),
                login: payload.assignee.login,
                avatarUrl: payload.assignee.avatar_url ?? '',
                githubUrl: payload.assignee.html_url ?? '',
                userType: payload.assignee.type ?? '',
            },
        } satisfies PullRequestUnassigned, {
            jobId: `${QUEUE_EVENTS.PULL_REQUEST.UNASSIGNED}_${payload.installation.id}_${payload.pull_request.id}_${payload.pull_request.updated_at}`,
        });

        console.log(`Added pull_request.unassigned job to queue for PR ${payload.pull_request.id}`);
    } catch (error) {
        console.log("Error [pull_request.unassigned]:", error);
    }
});


/**
 * Comment Related Webhooks
 */

webhooks.on("issue_comment.created", async ({ payload }) => {
    try {
        if (payload.comment.user?.id === Number(process.env.REPOPROBE_BOT_GITHUB_ID)) { // ignore self comment
            return;
        }
        if (!payload.issue.pull_request) {
            console.log("Ignoring comment on non-PR issue");
            return;
        }
        if (!payload.installation) {
            console.log("No installation found in payload for issue_comment.created");
            return;
        }
        if (!AllowedAuthorAssociations.includes(payload.comment.author_association)) {
            console.log(`Ignoring comment from author association: ${payload.comment.author_association}`);
            return;
        }

        const commandRegex = new RegExp(
            `^@repoprobe\\s+(${SupportedCommentCommands.join('|')})(?=\\s|$)`,
            'i'
        );
        const match = commandRegex.exec(payload.comment.body);
        if (match) {
            // react the comment with eyes emoji
            addCommentReaction(
                payload.installation.id,
                payload.repository.name,
                payload.repository.owner.login,
                payload.comment.id,
                'eyes',
            ).catch(err => {
                console.log(`Error adding eyes reaction to comment ${payload.comment.id}:`, err);
            });

            const command = match[1];

            switch (command) {
                case 'check':
                    await commentQueue.add(QUEUE_EVENTS.COMMENT.CHECK, {
                        prNumber: payload.issue.number,
                        repoOwnerLogin: payload.repository.owner.login,
                        repoName: payload.repository.name,
                        repoId: payload.repository.id.toString(),
                        installationId: payload.installation.id.toString(),
                        githubCommentId: payload.comment.id,
                    } satisfies CommentCheck, {
                        jobId: `${QUEUE_EVENTS.COMMENT.CHECK}_${payload.installation.id}_${payload.repository.id}_${payload.issue.number}`,
                    })

                    console.log(`Added ${QUEUE_EVENTS.COMMENT.CHECK} job to queue for comment ${payload.comment.id} on PR ${payload.issue.number}`);
                    break;
                case 'status':
                    await commentQueue.add(QUEUE_EVENTS.COMMENT.STATUS, {
                        prNumber: payload.issue.number,
                        repoOwnerLogin: payload.repository.owner.login,
                        repoName: payload.repository.name,
                        repoId: payload.repository.id.toString(),
                        installationId: payload.installation.id.toString(),
                    } satisfies CommentStatus, {
                        jobId: `${QUEUE_EVENTS.COMMENT.STATUS}_${payload.installation.id}_${payload.repository.id}_${payload.issue.number}`,
                    });
                    break;
                case 'track':
                    await commentQueue.add(QUEUE_EVENTS.COMMENT.TRACK, {
                        prNumber: payload.issue.number,
                        repoOwnerLogin: payload.repository.owner.login,
                        repoName: payload.repository.name,
                        repoId: payload.repository.id.toString(),
                        installationId: payload.installation.id.toString(),
                        githubCommentId: payload.comment.id,
                        source: 'comment',
                    } satisfies CommentTrack, {
                        jobId: `${QUEUE_EVENTS.COMMENT.TRACK}_${payload.installation.id}_${payload.repository.id}_${payload.issue.number}`,
                    });

                    console.log(`Added ${QUEUE_EVENTS.COMMENT.TRACK} job to queue for comment ${payload.comment.id} on PR ${payload.issue.number}`);
                    break;
                case 'untrack':
                    await commentQueue.add(QUEUE_EVENTS.COMMENT.UNTRACK, {
                        prNumber: payload.issue.number,
                        repoOwnerLogin: payload.repository.owner.login,
                        repoName: payload.repository.name,
                        repoId: payload.repository.id.toString(),
                        installationId: payload.installation.id.toString(),
                        githubCommentId: payload.comment.id,
                        source: 'comment',
                    } satisfies CommentUntrack, {
                        jobId: `${QUEUE_EVENTS.COMMENT.UNTRACK}_${payload.installation.id}_${payload.repository.id}_${payload.issue.number}`,
                    });

                    console.log(`Added ${QUEUE_EVENTS.COMMENT.UNTRACK} job to queue for comment ${payload.comment.id} on PR ${payload.issue.number}`);
                    break;
                case 'help': {
                    await commentQueue.add(QUEUE_EVENTS.COMMENT.HELP, {
                        prNumber: payload.issue.number,
                        repoName: payload.repository.name,
                        repoOwnerLogin: payload.repository.owner.login,
                        installationId: payload.installation.id.toString(),
                    } satisfies CommentHelp, {
                        jobId: `${QUEUE_EVENTS.COMMENT.HELP}_${payload.installation.id}_${payload.repository.id}_${payload.issue.number}`,
                    });
                    console.log(`Added ${QUEUE_EVENTS.COMMENT.HELP} job to queue for comment ${payload.comment.id} on PR ${payload.issue.number}`);
                    break;
                }
                default: {
                    await commentQueue.add(QUEUE_EVENTS.COMMENT.INVALID_COMMAND, {
                        prNumber: payload.issue.number,
                        repoName: payload.repository.name,
                        repoOwnerLogin: payload.repository.owner.login,
                        installationId: payload.installation.id.toString(),
                    } satisfies CommentInvalidCommand, {
                        jobId: `${QUEUE_EVENTS.COMMENT.INVALID_COMMAND}_${payload.installation.id}_${payload.repository.id}_${payload.issue.number}`,
                    });

                    console.log(`Added ${QUEUE_EVENTS.COMMENT.INVALID_COMMAND} job to queue for comment ${payload.comment.id} on PR ${payload.issue.number}`);
                    break;
                }
            }
        } else if (/@repoprobe\b/i.test(payload.comment.body)) {
            await commentQueue.add(QUEUE_EVENTS.COMMENT.INVALID_COMMAND, {
                prNumber: payload.issue.number,
                repoName: payload.repository.name,
                repoOwnerLogin: payload.repository.owner.login,
                installationId: payload.installation.id.toString(),
            } satisfies CommentInvalidCommand, {
                jobId: `${QUEUE_EVENTS.COMMENT.INVALID_COMMAND}_${payload.installation.id}_${payload.repository.id}_${payload.issue.number}`,
            });

            console.log(`Added ${QUEUE_EVENTS.COMMENT.INVALID_COMMAND} job to queue for comment ${payload.comment.id} on PR ${payload.issue.number}`);
        }
    } catch (error) {
        console.log("Error [issue_comment.created]:", error);
    }
});

process.on('uncaughtException', function (err) {
    console.error(err, 'Uncaught exception');
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error({ promise, reason }, 'Unhandled Rejection at: Promise');
    process.exit(1);
});

async function main() {
    await connectDB();
    if (shutdownRequested) return;
    const listeningServer = server.listen(PORT);
    httpServer = listeningServer;
    await new Promise<void>((resolve, reject) => {
        const onListening = () => {
            listeningServer.off('error', onError);
            console.log(`Listening to port ${PORT}`);
            resolve();
        };
        const onError = (error: Error) => {
            listeningServer.off('listening', onListening);
            reject(error);
        };

        listeningServer.once('listening', onListening);
        listeningServer.once('error', onError);
    });
}

let httpServer: Server | undefined;
let shutdownRequested = false;
let shutdownPromise: Promise<void> | undefined;
let startupPromise: Promise<void> = Promise.resolve();

const gracefulShutdown = (signal: string): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;

    shutdownRequested = true;
    shutdownPromise = (async () => {
        console.log(`Received ${signal}, shutting down gracefully...`);
        let failed = false;

        try {
            await startupPromise;
        } catch (error) {
            failed = true;
            console.error('Server startup failed:', error);
        }

        const serverToClose = httpServer;
        if (serverToClose) {
            try {
                await new Promise<void>((resolve, reject) => {
                    let settled = false;
                    const finish = (error?: Error) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(drainTimeout);
                        if (error) reject(error);
                        else resolve();
                    };
                    const drainTimeout = setTimeout(() => {
                        console.warn(`HTTP drain exceeded ${HTTP_DRAIN_TIMEOUT_MS}ms; closing remaining connections.`);
                        serverToClose.closeAllConnections();
                        finish();
                    }, HTTP_DRAIN_TIMEOUT_MS);

                    serverToClose.close((error) => finish(error));
                    serverToClose.closeIdleConnections();
                });
                console.log('HTTP server closed.');
            } catch (error) {
                failed = true;
                console.error('Error closing HTTP server:', error);
            }
        }

        const resourceClosures = await Promise.allSettled([
            closeDB(),
            installationQueue.close(),
            pullRequestQueue.close(),
            commentQueue.close(),
            conflictDetectionQueue.close(),
        ]);
        for (const result of resourceClosures) {
            if (result.status === 'rejected') {
                failed = true;
                console.error('Error closing server resource:', result.reason);
            }
        }

        try {
            await redisConnection.quit();
            console.log('Redis connection closed.');
        } catch (error) {
            failed = true;
            console.error('Error closing Redis connection:', error);
        }

        process.exitCode = failed ? 1 : 0;
    })();

    return shutdownPromise;
};

process.once('SIGINT', () => { void gracefulShutdown('SIGINT'); });
process.once('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });

startupPromise = main();
startupPromise.catch(() => {
    void gracefulShutdown('startup failure');
});
