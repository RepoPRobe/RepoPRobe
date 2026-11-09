import { GithubInstallation } from "../../../db/schema/GithubInstallation.js";
import { PullRequest } from "../../../db/schema/PullRequest.js";
import { Repo } from "../../../db/schema/Repo.js";
import { githubApp } from "../../../github/client.js";
import { pullRequestQueue } from "../../../queues/pull-request.queue.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { CommentTrack, PullRequestOpened } from "../../../types/queue-payloads.js";
import { addCommentReaction, postComment } from "../../common/comment.js";
import { logActivity } from "../../common/activityLog.js";

export async function handleCommentTrack(payload: CommentTrack) {
    try {
        const installationRecord = await GithubInstallation.findOne(
            {
                installationId: payload.installationId,
                suspendedAt: { $eq: null },
                deletedAt: { $eq: null },
            },
            { _id: 1 },
        );
        if (!installationRecord) {
            console.log(`No installation record found for installation ${payload.installationId}`);
            return;
        }

        const repoRecord = await Repo.findOne(
            {
                installationId: installationRecord._id,
                githubId: payload.repoId,
                deletedAt: null,
            },
            { _id: 1 }
        );
        if (!repoRecord) {
            console.log(`No repo record found for repo ${payload.repoId}`);
            return;
        }

        const prRecord = await PullRequest.findOne({
            installationId: installationRecord._id,
            repoId: repoRecord._id,
            prNumber: payload.prNumber,
        });

        if (!prRecord || prRecord.deletedAt) {
            const octokit = await githubApp.getInstallationOctokit(Number(payload.installationId));
            const { data: pr } = await octokit.rest.pulls.get({
                owner: payload.repoOwnerLogin,
                repo: payload.repoName,
                pull_number: payload.prNumber,
            });

            if (pr.merged_at || pr.state !== 'open') {
                const message = pr.merged_at
                    ? 'Cannot Track Merged Pull Request'
                    : 'Cannot Track Closed Pull Request';
                await postComment(
                    Number(payload.installationId),
                    payload.repoName,
                    payload.repoOwnerLogin,
                    payload.prNumber,
                    message,
                );

                if (payload.source === 'comment' && payload.githubCommentId) {
                    await addCommentReaction(
                        Number(payload.installationId),
                        payload.repoName,
                        payload.repoOwnerLogin,
                        payload.githubCommentId,
                        'confused',
                    );
                }
                console.log(`PR ${payload.prNumber} in repo ${payload.repoName} for installation ${payload.installationId} cannot be tracked:`, message);
                return;
            }
            if (prRecord?.deletedAt) {
                // if deleted PR record exists, we can delete it and re-add to the queue for processing
                // this will ensure that we have a fresh PR record data with tracking enabled
                await PullRequest.deleteOne({ _id: prRecord._id });
            }

            await pullRequestQueue.add(QUEUE_EVENTS.PULL_REQUEST.OPENED, {
                installationId: payload.installationId,
                repositoryId: payload.repoId,
                repoOwnerLogin: payload.repoOwnerLogin,
                repoName: payload.repoName,
                prId: pr.id.toString(),
                prNumber: payload.prNumber,
                prTitle: pr.title,
                prHtmlUrl: pr.html_url,
                prState: pr.state,
                isDraft: pr.draft,
                baseBranchRef: pr.base.ref,
                baseBranchHeadSha: pr.base.sha,
                headBranchRef: pr.head.ref,
                headBranchHeadSha: pr.head.sha,
                author: {
                    id: pr.user.id.toString(),
                    login: pr.user.login,
                    avatarUrl: pr.user.avatar_url,
                    githubUrl: pr.user.html_url,
                    userType: pr.user.type,
                },
                prLabels: pr.labels.map(label => ({
                    id: label.id.toString(),
                    name: label.name,
                    default: label.default,
                })),
                prCreatedOn: pr.created_at,
                prUpdatedAt: pr.updated_at,
                source: payload.source,
            } satisfies PullRequestOpened, {
                jobId: `${QUEUE_EVENTS.PULL_REQUEST.OPENED}_${payload.installationId}_${pr.id}`,
            });
            if (payload.source === 'comment' && payload.githubCommentId) {
                await addCommentReaction(
                    Number(payload.installationId),
                    payload.repoName,
                    payload.repoOwnerLogin,
                    payload.githubCommentId,
                    '+1',
                );
            }
            console.log(`PR Not found, added to ${QUEUE_EVENTS.PULL_REQUEST.OPENED} queue for processing:`, payload.installationId, pr.id);
            return;
        }

        let message = null;
        let reaction: '+1' | 'confused' = '+1';
        if (prRecord.state === 'merged' || prRecord.githubMergedAt) {
            message = 'Cannot Track Merged Pull Request';
            reaction = 'confused';
        } else if (prRecord.state === 'closed' || prRecord.githubClosedAt) {
            message = 'Cannot Track Closed Pull Request';
            reaction = 'confused';
        } else if (prRecord.isTracked) {
            message = 'Pull Request is Already Tracked';
        }

        if (message) {
            await postComment(
                Number(payload.installationId),
                payload.repoName,
                payload.repoOwnerLogin,
                payload.prNumber,
                message,
            );
            if (payload.source === 'comment' && payload.githubCommentId) {
                await addCommentReaction(
                    Number(payload.installationId),
                    payload.repoName,
                    payload.repoOwnerLogin,
                    payload.githubCommentId,
                    reaction,
                );
            }

            console.log(`PR ${payload.prNumber} in repo ${payload.repoName} for installation ${payload.installationId} cannot be tracked:`, message);
            return;
        }

        // At this point, simply mark PR as tracked
        prRecord.isTracked = true;
        await prRecord.save();

        if (payload.source === 'comment' && payload.githubCommentId) {
            await addCommentReaction(
                Number(payload.installationId),
                payload.repoName,
                payload.repoOwnerLogin,
                payload.githubCommentId,
                '+1',
            );
        }
        await logActivity({
            installationId: installationRecord._id,
            repoId: repoRecord._id,
            pullRequestId: prRecord._id,
            event: QUEUE_EVENTS.COMMENT.TRACK,
            status: 'success',
            message: `Pull request #${payload.prNumber} is now tracked`,
            metadata: { source: payload.source },
        });
        console.log(`PR ${payload.prNumber} in repo ${payload.repoName} for installation ${payload.installationId} is now tracked`);
    } catch (error) {
        console.log(`Error ${QUEUE_EVENTS.COMMENT.TRACK}:`, error);
        if (payload.source === 'comment' && payload.githubCommentId) {
            await addCommentReaction(
                Number(payload.installationId),
                payload.repoName,
                payload.repoOwnerLogin,
                payload.githubCommentId,
                'confused',
            );
        }

        try {
            const installationRecord = await GithubInstallation.findOne(
                { installationId: payload.installationId },
                { _id: 1 },
            );
            if (installationRecord) {
                const repoRecord = await Repo.findOne(
                    { installationId: installationRecord._id, githubId: payload.repoId },
                    { _id: 1 },
                );
                await logActivity({
                    installationId: installationRecord._id,
                    repoId: repoRecord?._id,
                    event: QUEUE_EVENTS.COMMENT.TRACK,
                    status: 'error',
                    message: `Failed to track pull request #${payload.prNumber}`,
                    metadata: { source: payload.source },
                });
            }
        } catch (error) {
            console.log(`Error logging activity for ${QUEUE_EVENTS.COMMENT.TRACK}:`, error);
        }
    }
}