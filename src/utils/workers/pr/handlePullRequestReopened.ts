import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { PullRequestReopened } from "../../../types/queue-payloads";
import { logActivity } from "../../common/activityLog";

export async function handlePullRequestReopened(payload: PullRequestReopened) {
    /**
     * Reopen is like:
     * draft -> closed -> draft
     * open  -> closed -> open
     */
    try {
        const installationRecord = await GithubInstallation.findOne(
            {
                installationId: payload.installationId,
                suspendedAt: { $eq: null },
                deletedAt: { $eq: null },
            },
            { _id: 1 },
        )
        if (!installationRecord) {
            console.log(`No installation record found for installation ${payload.installationId}`);
            return;
        }

        const prRecord = await PullRequest.findOneAndUpdate(
            {
                installationId: installationRecord._id,
                githubPrId: payload.prId,
            },
            {
                $set: {
                    state: payload.prState,
                    githubUpdatedAt: payload.updatedAt,
                }
            },
            { projection: { _id: 1, repoId: 1, prNumber: 1 } },
        );

        if (!prRecord) {
            console.log(`No PR record found for installation ${payload.installationId} and PR ${payload.prId}`);
        } else {
            await logActivity({
                installationId: installationRecord._id,
                repoId: prRecord.repoId,
                pullRequestId: prRecord._id,
                event: QUEUE_EVENTS.PULL_REQUEST.REOPENED,
                status: 'success',
                message: `Pull request #${prRecord.prNumber} reopened`,
            });
            console.log(`PR record updated for installation ${payload.installationId} and PR ${payload.prId}`);
        }
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.REOPENED}]:`, error);
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
                    event: QUEUE_EVENTS.PULL_REQUEST.REOPENED,
                    status: 'error',
                    message: `Failed to reopen pull request #${prRecord.prNumber}`,
                });
            }
        }
    }
}
