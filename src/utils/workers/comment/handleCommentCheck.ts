import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { Repo } from "../../../db/schema/Repo";
import { conflictDetectionQueue } from "../../../queues/conflict-detection.queue";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { CommentCheck, ConflictDetectionScanPR } from "../../../types/queue-payloads";
import { addCommentReaction, postComment, PR_NOT_TRACKED_COMMENT_MARKDOWN } from "../../common/comment";

export async function handleCommentCheck(payload: CommentCheck) {
    try {
        const installationRecord = await GithubInstallation.findOne(
            {
                installationId: payload.installationId,
                suspendedAt: { $eq: null },
                deletedAt: { $eq: null },
            },
            { _id: 1 },
        );
        if (!installationRecord) {
            console.log(`No installation record found for installation ${payload.installationId}`);
            return;
        }

        const repoRecord = await Repo.findOne(
            {
                installationId: installationRecord._id,
                githubId: payload.repoId,
                deletedAt: null,
            },
            { _id: 1 },
        );
        if (!repoRecord) {
            console.log(`No repo record found for repo ${payload.repoId}`);
            return;
        }

        const prRecord = await PullRequest.findOne(
            {
                installationId: installationRecord._id,
                repoId: repoRecord._id,
                prNumber: payload.prNumber,
            },
        );

        let message = null;
        let reaction: '+1' | 'confused' = '+1';
        if (prRecord?.state === 'merged' || prRecord?.githubMergedAt) {
            message = 'Cannot Check Merged Pull Request';
            reaction = 'confused';
        } else if (prRecord?.state === 'closed' || prRecord?.githubClosedAt) {
            message = 'Cannot Check Closed Pull Request';
            reaction = 'confused';
        } else if (!prRecord || prRecord.deletedAt || !prRecord.isTracked) {
            message = PR_NOT_TRACKED_COMMENT_MARKDOWN;
        }

        if (message) {
            await Promise.all([
                postComment(
                    Number(payload.installationId),
                    payload.repoName,
                    payload.repoOwnerLogin,
                    payload.prNumber,
                    message,
                ),
                addCommentReaction(
                    Number(payload.installationId),
                    payload.repoName,
                    payload.repoOwnerLogin,
                    payload.githubCommentId,
                    reaction,
                ),
            ]);
            console.log(`PR ${payload.prNumber} in repo ${payload.repoName} for installation ${installationRecord._id} cannot be checked:`, message);
            return;
        }

        if (!prRecord) { // I don't think this case will arise, but for type safety it is there
            return;
        }

        await conflictDetectionQueue.add(QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR, {
            installationId: Number(payload.installationId),
            repoName: payload.repoName,
            repoOwnerLogin: payload.repoOwnerLogin,
            prId: prRecord._id.toString(),
            source: 'comment',
        } satisfies ConflictDetectionScanPR, {
            jobId: `${QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR}_${prRecord._id}`,
        });
        console.log(`Conflict detection scan job added for PR ${payload.prNumber} in repo ${payload.repoName} for installation ${installationRecord._id}`);
    } catch (error) {
        console.log(`Error ${QUEUE_EVENTS.COMMENT.CHECK}:`, error);
    }
}