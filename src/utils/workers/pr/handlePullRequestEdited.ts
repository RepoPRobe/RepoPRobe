import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { conflictDetectionQueue } from "../../../queues/conflict-detection.queue";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { ConflictDetectionScanPR, PullRequestEdited } from "../../../types/queue-payloads";

export async function handlePullRequestEdited(payload: PullRequestEdited) {
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

        const fieldsToUpdate: Record<string, any> = {
            githubUpdatedAt: payload.updatedAt,
        };

        if (payload.updatedTitle) {
            fieldsToUpdate.title = payload.updatedTitle;
        }
        if (payload.updatedBase) {
            fieldsToUpdate.baseBranch = payload.updatedBase;
            fieldsToUpdate.baseBranchHeadSha = payload.updatedBaseSha;
        }

        const prRecord = await PullRequest.findOneAndUpdate(
            {
                installationId: installationRecord._id,
                githubPrId: payload.prId,
            },
            { $set: fieldsToUpdate },
        );
        if(!prRecord) {
            console.log(`No PR record found for installation ${payload.installationId} and PR ${payload.prId}`);
            return;
        }

        if (payload.updatedBase) {
            await conflictDetectionQueue.add(QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR, {
                installationId: Number(payload.installationId),
                repoName: payload.repoName,
                repoOwnerLogin: payload.repoOwnerLogin,
                prId: prRecord._id.toString(),
            } satisfies ConflictDetectionScanPR, {
                jobId: `${QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR}_${prRecord._id}`,
            });
        }

        console.log(`PR record updated for installation ${payload.installationId} and PR ${payload.prId}`);
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.EDITED}]:`, error);
    }
}
