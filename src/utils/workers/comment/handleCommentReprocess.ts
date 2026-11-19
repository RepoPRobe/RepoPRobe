import { GithubInstallation } from "../../../db/schema/GithubInstallation.js";
import { PullRequest } from "../../../db/schema/PullRequest.js";
import { PullRequestFile } from "../../../db/schema/PullRequestFile.js";
import { Repo } from "../../../db/schema/Repo.js";
import { githubApp } from "../../../github/client.js";
import { processPullRequestFiles } from "../../../github/utils/file-patch.js";
import { conflictDetectionQueue } from "../../../queues/conflict-detection.queue.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { CommentReprocess, ConflictDetectionScanPR } from "../../../types/queue-payloads.js";
import { logActivity } from "../../common/activityLog.js";
import { addCommentReaction, postComment } from "../../common/comment.js";

export async function handleCommentReprocess(payload: CommentReprocess) {
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

        const repoRecord = await Repo.findOne(
            {
                installationId: installationRecord._id,
                githubId: payload.repoGithubId,
                deletedAt: null,
            },
            { _id: 1 },
        );
        if (!repoRecord) {
            console.log(`No repo found for installation ${payload.installationId} and repo ${payload.repoOwnerLogin}/${payload.repoName}`);
            return;
        }

        const prRecord = await PullRequest.findOneAndUpdate(
            {
                installationId: installationRecord._id,
                repoId: repoRecord._id,
                prNumber: payload.prNumber,
                state: 'open',
                isTracked: true,
                deletedAt: { $eq: null },
            },
            {
                $set: {
                    processingStatus: 'processing',
                },
            },
            {
                projection: {
                    _id: 1,
                    repoId: 1,
                    githubPrId: 1,
                    prNumber: 1,
                },
            }
        );
        if (!prRecord) {
            console.log(`No PR record found for installation ${payload.installationId} and PR ${payload.prNumber}`);
            await postComment(
                Number(payload.installationId),
                payload.repoName,
                payload.repoOwnerLogin,
                payload.prNumber,
                [
                    '### Files can\'t be reprocessed',
                    '> _This PR must be open and tracked, and its files must not already be processing._',
                    'Run `@RepoPRobe status` for the current status.',
                ].join('\n')
            );
            return;
        }

        const octokit = await githubApp.getInstallationOctokit(parseInt(payload.installationId));
        const prFiles = await octokit.paginate(
            octokit.rest.pulls.listFiles,
            {
                owner: payload.repoOwnerLogin,
                repo: payload.repoName,
                pull_number: payload.prNumber,
                per_page: 100,
            }
        );

        await PullRequestFile.deleteMany({ pullRequestId: prRecord._id });
        if (prFiles.length > 0) {
            const convertedPatchObject = processPullRequestFiles(prFiles);
            await PullRequestFile.insertMany(
                convertedPatchObject.map(patchObj => ({
                    pullRequestId: prRecord._id,
                    file: patchObj.file,
                    status: patchObj.status,
                    previousFilePath: patchObj.previousFilePath,
                    hunks: patchObj.hunks.map(hunk => ({
                        oldFileStartLine: hunk.oldFileStartLine,
                        oldFilePatchLinesCount: hunk.oldFilePatchLinesCount,
                        newFileStartLine: hunk.newFileStartLine,
                        newFilePatchLinesCount: hunk.newFilePatchLinesCount,
                        lines: hunk.lines,
                    }))
                }))
            );
        }

        await PullRequest.updateOne(
            { _id: prRecord._id },
            {
                $set: {
                    processingStatus: 'completed',
                },
            }
        );
        console.log(`Successfully refreshed PR files for installation ${payload.installationId} and PR ${prRecord.githubPrId}`);

        await conflictDetectionQueue.add(QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR, {
            prId: prRecord._id.toString(),
            installationId: Number(payload.installationId),
            repoName: payload.repoName,
            repoOwnerLogin: payload.repoOwnerLogin,
            source: payload.source,
        } satisfies ConflictDetectionScanPR, {
            jobId: `${QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR}_${prRecord._id}`,
        });
        console.log(`Conflict detection scan job added for PR ${payload.prNumber} in repo ${payload.repoName} for installation ${installationRecord._id}`);

        if (payload.source === 'comment' && payload.githubCommentId) {
            await addCommentReaction(
                Number(payload.installationId),
                payload.repoName,
                payload.repoOwnerLogin,
                payload.githubCommentId,
                '+1',
            );
        }

        await logActivity({
            installationId: installationRecord._id,
            repoId: repoRecord._id,
            pullRequestId: prRecord._id,
            event: QUEUE_EVENTS.COMMENT.REPROCESS,
            status: 'success',
            message: `Pull request #${payload.prNumber} files were reprocessed successfully`,
            metadata: { source: payload.source },
        });
    } catch (error) {
        console.log(`Error ${QUEUE_EVENTS.COMMENT.REPROCESS}:`, error);
    }
}