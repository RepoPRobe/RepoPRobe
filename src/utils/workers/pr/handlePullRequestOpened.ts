import { GithubInstallation } from "../../../db/schema/GithubInstallation.js";
import { PullRequest } from "../../../db/schema/PullRequest.js";
import { PullRequestFile } from "../../../db/schema/PullRequestFile.js";
import { Repo } from "../../../db/schema/Repo.js";
import { githubApp } from "../../../github/client.js";
import { processPullRequestFiles } from "../../../github/utils/file-patch.js";
import { conflictDetectionQueue } from "../../../queues/conflict-detection.queue.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { ConflictDetectionScanPR, PullRequestOpened } from "../../../types/queue-payloads.js";
import { logActivity } from "../../common/activityLog.js";

export async function handlePullRequestOpened(payload: PullRequestOpened) {
    let processingRecordId;
    try {
        if (!payload.installationId) return;

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
                githubId: payload.repositoryId,
                deletedAt: { $eq: null },
            },
            { _id: 1 },
        );
        if (!repoRecord) {
            console.log(`No repo found for installation ${payload.installationId} and PR ${payload.prId}`);
            return;
        }

        const recordData = {
            repoId: repoRecord._id,
            installationId: installationRecord._id,
            githubPrId: payload.prId,
            prNumber: payload.prNumber,
            title: payload.prTitle,
            htmlUrl: payload.prHtmlUrl,
            state: payload.prState,
            isDraft: payload.isDraft,
            baseBranch: payload.baseBranchRef,
            baseBranchHeadSha: payload.baseBranchHeadSha,
            headBranch: payload.headBranchRef,
            headBranchHeadSha: payload.headBranchHeadSha,
            author: payload.author,
            labels: payload.prLabels.map(label => ({
                id: Number(label.id),
                name: label.name,
                default: label.default,
            })),
            githubCreatedAt: payload.prCreatedOn,
            githubUpdatedAt: payload.prUpdatedAt,
            lastCommitAt: new Date(payload.prUpdatedAt), // initially store the creation/updation time of PR as as there can be case when branch was there since few months and pr is created recently
            isTracked: true,
            processingStatus: 'processing' as const, // setting processing as here the next step is processing, so it makes no sense to set it as pending, as it will be processed immediately after this step
        };
        const prRecord = await PullRequest.findOneAndUpdate(
            { repoId: repoRecord._id, githubPrId: payload.prId },
            { $set: recordData },
            { upsert: true, new: true, runValidators: true },
        );
        processingRecordId = prRecord._id;

        await logActivity({
            installationId: installationRecord._id,
            repoId: repoRecord._id,
            pullRequestId: prRecord._id,
            event: QUEUE_EVENTS.PULL_REQUEST.OPENED,
            status: 'info',
            message: `Processing pull request #${payload.prNumber}`,
            metadata: {
                source: payload.source,
                replacementRecordId: payload.replacementRecordId,
            },
        });

        if (payload.replacementRecordId) {
            if (prRecord._id.toString() === payload.replacementRecordId) {
                await PullRequestFile.deleteMany({ pullRequestId: prRecord._id });
            } else {
                const { deletedCount } = await PullRequest.deleteOne({
                    _id: payload.replacementRecordId,
                    repoId: repoRecord._id,
                    githubPrId: payload.prId,
                });
                if (deletedCount > 0) {
                    await PullRequestFile.deleteMany({ pullRequestId: payload.replacementRecordId });
                }
            }
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
            await PullRequest.updateOne(
                { _id: prRecord._id },
                {
                    $set: {
                        processingStatus: 'completed',
                    },
                }
            );
            console.log(`Successfully inserted PR files for installation ${payload.installationId} and PR ${payload.prId}`);

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

            await logActivity({
                installationId: installationRecord._id,
                repoId: repoRecord._id,
                pullRequestId: prRecord._id,
                event: QUEUE_EVENTS.PULL_REQUEST.OPENED,
                status: 'success',
                message: `Processed pull request #${payload.prNumber} and queued conflict scan`,
                metadata: {
                    source: payload.source,
                    replacementRecordId: payload.replacementRecordId,
                },
            });
        } else {
            throw new Error('Unable to fetch pull request files');
        }
    } catch (error) {
        if (processingRecordId) {
            try {
                const failedPr = await PullRequest.findByIdAndUpdate(
                    processingRecordId,
                    { $set: { processingStatus: 'error' } },
                    { projection: { installationId: 1, repoId: 1 } },
                );
                if (failedPr) {
                    await logActivity({
                        installationId: failedPr.installationId,
                        repoId: failedPr.repoId,
                        pullRequestId: processingRecordId,
                        event: QUEUE_EVENTS.PULL_REQUEST.OPENED,
                        status: 'error',
                        message: `Failed to process pull request #${payload.prNumber}`,
                        metadata: {
                            source: payload.source,
                            replacementRecordId: payload.replacementRecordId,
                        },
                    });
                }
            } catch (logError) {
                console.log("Error while logging activity for pull_request.opened:", logError);
            }
        }
        throw error;
    }
}
