import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { PullRequestUnassigned } from "../../../types/queue-payloads";

export async function handlePullRequestUnassigned(payload: PullRequestUnassigned) {
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
                    assignees: { id: payload.assignee.id },
                },
                $set: {
                    githubUpdatedAt: payload.updatedAt,
                },
            },
        );

        console.log(`PR record updated for installation ${payload.installationId} and PR ${payload.prId} with assignee removed ${payload.assignee.login}`);
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.UNASSIGNED}]:`, error);
    }
}
