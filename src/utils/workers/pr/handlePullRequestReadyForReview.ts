import { GithubInstallation } from "../../../db/schema/GithubInstallation.js";
import { PullRequest } from "../../../db/schema/PullRequest.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { PullRequestReadyForReview } from "../../../types/queue-payloads.js";
import { logActivity } from "../../common/activityLog.js";

export async function handlePullRequestReadyForReview(payload: PullRequestReadyForReview) {
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
                isDraft: true,
            },
            {
                $set: {
                    isDraft: false,
                    githubUpdatedAt: payload.updatedAt,
                }
            },
            { projection: { _id: 1, repoId: 1, prNumber: 1 } },
        );

        if (prRecord) {
            await logActivity({
                installationId: installationRecord._id,
                repoId: prRecord.repoId,
                pullRequestId: prRecord._id,
                event: QUEUE_EVENTS.PULL_REQUEST.READY_FOR_REVIEW,
                status: 'success',
                message: `Pull request #${prRecord.prNumber} marked ready for review`,
            });
        }
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.READY_FOR_REVIEW}]:`, error);
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
                        event: QUEUE_EVENTS.PULL_REQUEST.READY_FOR_REVIEW,
                        status: 'error',
                        message: `Failed to mark pull request #${prRecord.prNumber} ready for review`,
                    });
                }
            }
        } catch (logError) {
            console.log("Error while logging activity for pull_request.ready_for_review:", logError);
        }
    }
}
