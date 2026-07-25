import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { PullRequestClosed } from "../../../types/queue-payloads";

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

        const res = await PullRequest.updateOne(
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
            }
        );

        if (res.matchedCount === 0) {
            console.log(`No PR record found for installation ${payload.installationId} and PR ${payload.prId}`);
        } else if (res.modifiedCount === 0) {
            console.log(`PR record found for installation ${payload.installationId} and PR ${payload.prId} but no changes made`);
        } else if (res.modifiedCount > 0) {
            console.log(`PR record updated for installation ${payload.installationId} and PR ${payload.prId}`);
        }
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.CLOSED}]:`, error);
    }
}
