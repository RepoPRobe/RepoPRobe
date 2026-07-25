import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { PullRequestConvertedToDraft } from "../../../types/queue-payloads";

export async function handlePullRequestConvertedToDraft(payload: PullRequestConvertedToDraft) {
    try {
        // TODO: for most of the pr request we have to fetch the installation id, 
        // implement a common cache with githubInstallationId -> our db record _id
        // if in cache the take from there else fetched from db and store in cache
        // for that make a common helper like fetch installation or something like that.

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
