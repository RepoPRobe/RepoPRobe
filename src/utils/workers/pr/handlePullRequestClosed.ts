import mongoose from "mongoose";
import { GithubInstallation } from "../../../db/schema/GithubInstallation.js";
import { PullRequest } from "../../../db/schema/PullRequest.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { PullRequestClosed } from "../../../types/queue-payloads.js";
import { logActivity } from "../../common/activityLog.js";
import { PullRequestFile } from "../../../db/schema/PullRequestFile.js";
import { Conflict } from "../../../db/schema/Conflict.js";

export async function handlePullRequestClosed(payload: PullRequestClosed) {
    const session = await mongoose.startSession();
    try {
        await session.withTransaction(async () => {
            const installationRecord = await GithubInstallation.findOne(
                {
                    installationId: payload.installationId,
                    suspendedAt: { $eq: null },
                },
                { _id: 1 },
            ).session(session);
            if (!installationRecord) {
                console.log(`No installation record found for installation ${payload.installationId}`);
                return;
            }

            if (payload.prState === 'merged') {
                const prRecord = await PullRequest.findOneAndUpdate(
                    {
                        installationId: installationRecord._id,
                        githubPrId: payload.prId,
                        state: 'open',
                    },
                    {
                        $set: {
                            state: payload.prState,
                            githubUpdatedAt: payload.updatedAt,
                            githubMergedAt: payload.mergedAt ?? null,
                        }
                    },
                    { projection: { _id: 1, repoId: 1, prNumber: 1 } },
                ).session(session);

                if (!prRecord) {
                    console.log(`No PR record found for installation ${payload.installationId} and PR ${payload.prId}`);
                    return;
                }

                await PullRequestFile.deleteMany({
                    pullRequestId: prRecord._id
                }).session(session);
                await Conflict.deleteMany({
                    $or: [
                        { prAId: prRecord._id },
                        { prBId: prRecord._id },
                    ],
                }).session(session);

                await logActivity({
                    installationId: installationRecord._id,
                    repoId: prRecord.repoId,
                    pullRequestId: prRecord._id,
                    event: QUEUE_EVENTS.PULL_REQUEST.CLOSED,
                    status: 'success',
                    message: `Pull request #${prRecord.prNumber} merged`,
                    metadata: { prState: payload.prState },
                }, session);
                console.log(`PR record merged for installation ${payload.installationId} and PR ${payload.prId}`);
            }
            if (payload.prState === 'closed') {
                const prRecord = await PullRequest.findOne({
                    installationId: installationRecord._id,
                    githubPrId: payload.prId,
                    state: 'open',
                }, { _id: 1, prNumber: 1, repoId: 1 }).session(session);

                if (!prRecord) {
                    console.log(`No PR record found for installation ${payload.installationId} and PR ${payload.prId}`);
                    return;
                }

                await PullRequestFile.deleteMany({
                    pullRequestId: prRecord._id
                }).session(session);
                await Conflict.deleteMany({
                    $or: [
                        { prAId: prRecord._id },
                        { prBId: prRecord._id },
                    ],
                }).session(session);
                await PullRequest.deleteOne({ _id: prRecord._id }).session(session);

                console.log(`PR record closed for installation ${payload.installationId} and PR ${payload.prId}`);
                await logActivity({
                    installationId: installationRecord._id,
                    repoId: prRecord.repoId,
                    pullRequestId: prRecord._id,
                    event: QUEUE_EVENTS.PULL_REQUEST.CLOSED,
                    status: 'success',
                    message: `Pull request #${prRecord.prNumber} closed`,
                    metadata: { prState: payload.prState },
                }, session);
            }
        });
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.CLOSED}]:`, error);
        try {
            const installationRecord = await GithubInstallation.findOne(
                { installationId: payload.installationId },
                { _id: 1 },
            );
            if (installationRecord) {
                const prRecord = await PullRequest.findOne(
                    { installationId: installationRecord._id, githubPrId: payload.prId },
                    { _id: 1, repoId: 1, prNumber: 1 },
                );
                if (prRecord) {
                    await logActivity({
                        installationId: installationRecord._id,
                        repoId: prRecord.repoId,
                        pullRequestId: prRecord._id,
                        event: QUEUE_EVENTS.PULL_REQUEST.CLOSED,
                        status: 'error',
                        message: `Failed to close pull request #${prRecord.prNumber}`,
                    });
                }
            }
        } catch (logError) {
            console.log(`Error while logging activity for ${QUEUE_EVENTS.PULL_REQUEST.CLOSED}:`, logError);
        }
    } finally {
        await session.endSession();
    }
}
