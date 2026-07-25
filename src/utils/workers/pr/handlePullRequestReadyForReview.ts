import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { PullRequestReadyForReview } from "../../../types/queue-payloads";

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

        await PullRequest.updateOne(
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
        )
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.READY_FOR_REVIEW}]:`, error);
    }
}
