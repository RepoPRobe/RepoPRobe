import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { PullRequestLabeled } from "../../../types/queue-payloads";

export async function handlePullRequestLabeled(payload: PullRequestLabeled) {
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
                $addToSet: {
                    labels: payload.label,
                },
                $set: {
                    githubUpdatedAt: payload.updatedAt,
                },
            },
        );

        console.log(`PR record updated for installation ${payload.installationId} and PR ${payload.prId} with new label ${payload.label}`);
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.LABELED}]:`, error);
    }
}
