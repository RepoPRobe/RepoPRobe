import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { PullRequestConvertedToDraft } from "../../../types/queue-payloads";

export async function handlePullRequestConvertedToDraft(payload: PullRequestConvertedToDraft) {
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
                isDraft: false,
                state: 'open',
            },
            {
                $set: {
                    isDraft: true,
                    githubUpdatedAt: payload.updatedAt,
                },
            },
        );

        console.log(`PR record updated for installation ${payload.installationId} and PR ${payload.prId} to draft`);
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.CONVERTED_TO_DRAFT}]:`, error);
    }
}
