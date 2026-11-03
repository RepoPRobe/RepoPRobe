import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { PullRequestClosed } from "../../../types/queue-payloads";
import { logActivity } from "../../common/activityLog";

export async function handlePullRequestClosed(payload: PullRequestClosed) {
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
        );

        if (!prRecord) {
            console.log(`No PR record found for installation ${payload.installationId} and PR ${payload.prId}`);
        } else {
            await logActivity({
                installationId: installationRecord._id,
                repoId: prRecord.repoId,
                pullRequestId: prRecord._id,
                event: QUEUE_EVENTS.PULL_REQUEST.CLOSED,
                status: 'success',
                message: payload.prState === 'merged'
                    ? `Pull request #${prRecord.prNumber} merged`
                    : `Pull request #${prRecord.prNumber} closed`,
                metadata: { prState: payload.prState },
            });
            console.log(`PR record updated for installation ${payload.installationId} and PR ${payload.prId}`);
        }
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
    }
}
