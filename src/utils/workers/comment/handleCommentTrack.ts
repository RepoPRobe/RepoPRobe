import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { Repo } from "../../../db/schema/Repo";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { CommentTrack } from "../../../types/queue-payloads";
import { addCommentReaction } from "../../common/comment";

export async function handleCommentTrack(payload: CommentTrack) {
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
            { _id: 1 }
        );
        if (!repoRecord) {
            console.log(`No repo record found for repo ${payload.repoId}`);
            return;
        }

        const prRecord = await PullRequest.findOneAndUpdate(
            {
                installationId: installationRecord._id,
                repoId: repoRecord._id,
                prNumber: payload.prNumber,
                isTracked: false,
                githubClosedAt: null,
                githubMergedAt: null,
            },
            {
                $set: {
                    isTracked: true,
                },
            },
            {
                projection: {
                    _id: 1,
                },
            }
        );

        if(prRecord) {
            await addCommentReaction(
                Number(payload.installationId),
                payload.repoName,
                payload.repoOwnerLogin,
                payload.githubCommentId,
                '+1',
            );
            console.log(`PR ${payload.prNumber} in repo ${payload.repoName} for installation ${payload.installationId} is now tracked`);
        } else {
            await addCommentReaction(
                Number(payload.installationId),
                payload.repoName,
                payload.repoOwnerLogin,
                payload.githubCommentId,
                'confused',
            );
            console.log(`PR ${payload.prNumber} in repo ${payload.repoName} for installation ${payload.installationId} is not found or already tracked`);
        }
    } catch (error) {
        console.log(`Error ${QUEUE_EVENTS.COMMENT.TRACK}:`, error);
    }
}