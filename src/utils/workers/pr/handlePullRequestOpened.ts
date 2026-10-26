import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { PullRequestFile } from "../../../db/schema/PullRequestFile";
import { Repo } from "../../../db/schema/Repo";
import { githubApp } from "../../../github/client";
import { processPullRequestFiles } from "../../../github/utils/file-patch";
import { conflictDetectionQueue } from "../../../queues/conflict-detection.queue";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { ConflictDetectionScanPR, PullRequestOpened } from "../../../types/queue-payloads";

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

        // A job can start before the API's post-enqueue cleanup. Remove only the old
        // record, then upsert the replacement so a retried job can resume safely.
        if (payload.replacementRecordId) {
            await PullRequest.deleteOne({
                _id: payload.replacementRecordId,
                repoId: repoRecord._id,
                githubPrId: payload.prId,
            });
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
        const prRecord = payload.replacementRecordId
            ? await PullRequest.findOneAndUpdate(
                { repoId: repoRecord._id, githubPrId: payload.prId },
                { $set: recordData },
                { upsert: true, new: true, runValidators: true },
            )
            : await PullRequest.create(recordData);
        processingRecordId = prRecord._id;

        const octokit = await githubApp.getInstallationOctokit(parseInt(payload.installationId));
        const prFiles = await octokit.rest.pulls.listFiles({
            owner: payload.repoOwnerLogin,
            repo: payload.repoName,
            pull_number: payload.prNumber,
        });

        if (prFiles.status === 200) {
            const convertedPatchObject = processPullRequestFiles(prFiles.data);

            if (payload.replacementRecordId) {
                await PullRequestFile.deleteMany({ pullRequestId: prRecord._id });
            }
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
        } else {
            throw new Error('Unable to fetch pull request files');
        }
    } catch (error) {
        if (processingRecordId) {
            await PullRequest.updateOne({ _id: processingRecordId }, { $set: { processingStatus: 'error' } });
        }
        throw error;
    }
}
