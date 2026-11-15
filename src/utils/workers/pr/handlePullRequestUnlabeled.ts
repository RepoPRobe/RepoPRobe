import { GithubInstallation } from "../../../db/schema/GithubInstallation.js";
import { PullRequest } from "../../../db/schema/PullRequest.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { PullRequestUnlabeled } from "../../../types/queue-payloads.js";

export async function handlePullRequestUnlabeled(payload: PullRequestUnlabeled) {
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
            },
            {
                $pull: {
                    labels: { id: payload.label.id },
                },
                $set: {
                    githubUpdatedAt: payload.updatedAt,
                },
            },
        );

        console.log(`PR record updated for installation ${payload.installationId} and PR ${payload.prId} with label removed ${payload.label.name}`);
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.UNLABELED}]:`, error);
    }
}
