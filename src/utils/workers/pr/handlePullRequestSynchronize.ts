import { console } from "inspector/promises";
import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { githubApp } from "../../../github/client";
import { processPullRequestFiles } from "../../../github/utils/file-patch";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { ConflictDetectionScanPR, PullRequestSynchronize } from "../../../types/queue-payloads";
import { PullRequestFile } from "../../../db/schema/PullRequestFile";
import { conflictDetectionQueue } from "../../../queues/conflict-detection.queue";
import { logActivity } from "../../common/activityLog";

export async function handlePullRequestSynchronize(payload: PullRequestSynchronize) {
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

        const prRecord = await PullRequest.findOneAndUpdate(
            {
                installationId: installationRecord._id,
                githubPrId: payload.prId,
            },
            {
                $set: {
                    headBranchHeadSha: payload.afterCommitSha,
                    processingStatus: 'processing',
                    lastCommitAt: payload.updatedAt,
                },
            },
            {
                projection: { _id: 1, repoId: 1, prNumber: 1 },
            }
        );
        if (!prRecord) {
            console.log(`No PR record found for installation ${payload.installationId} and PR ${payload.prId}`);
            return;
        }

        await logActivity({
            installationId: installationRecord._id,
            repoId: prRecord.repoId,
            pullRequestId: prRecord._id,
            event: QUEUE_EVENTS.PULL_REQUEST.SYNCHRONIZE,
            status: 'info',
            message: `Synchronizing pull request #${payload.prNumber}`,
            metadata: {
                beforeCommitSha: payload.beforeCommitSha,
                afterCommitSha: payload.afterCommitSha,
            },
        });

        const octokit = await githubApp.getInstallationOctokit(parseInt(payload.installationId));
        const prFilesResponse = await octokit.rest.pulls.listFiles({
            owner: payload.repoOwnerLogin,
            repo: payload.repoName,
            pull_number: payload.prNumber,
        });

        if (prFilesResponse.status === 200) {
            const convertedPatchObject = processPullRequestFiles(prFilesResponse.data);

            await PullRequestFile.deleteMany({ pullRequestId: prRecord._id });
            PullRequestFile.insertMany(
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
            ).then(async (res) => {
                await PullRequest.updateOne(
                    { _id: prRecord._id },
                    {
                        $set: {
                            processingStatus: 'completed',
                        },
                    }
                );
                console.log(`Successfully synchronized PR files for installation ${payload.installationId} and PR ${payload.prId} from ${payload.beforeCommitSha} to ${payload.afterCommitSha}`);

                await conflictDetectionQueue.add(QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR, {
                    prId: prRecord._id.toString(),
                    installationId: Number(payload.installationId),
                    repoName: payload.repoName,
                    repoOwnerLogin: payload.repoOwnerLogin,
                    source: 'webhook',
                } satisfies ConflictDetectionScanPR, {
                    jobId: `${QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR}_${prRecord._id}`,
                });
                console.log(`Conflict detection scan job added for PR ${payload.prNumber} in repo ${payload.repoName} for installation ${installationRecord._id}`);
                await logActivity({
                    installationId: installationRecord._id,
                    repoId: prRecord.repoId,
                    pullRequestId: prRecord._id,
                    event: QUEUE_EVENTS.PULL_REQUEST.SYNCHRONIZE,
                    status: 'success',
                    message: `Synchronized pull request #${payload.prNumber} and queued conflict scan`,
                    metadata: {
                        beforeCommitSha: payload.beforeCommitSha,
                        afterCommitSha: payload.afterCommitSha,
                    },
                });
            }).catch(async (err) => {
                await PullRequest.updateOne(
                    { _id: prRecord._id },
                    {
                        $set: {
                            processingStatus: 'error',
                        },
                    }
                );
                await logActivity({
                    installationId: installationRecord._id,
                    repoId: prRecord.repoId,
                    pullRequestId: prRecord._id,
                    event: QUEUE_EVENTS.PULL_REQUEST.SYNCHRONIZE,
                    status: 'error',
                    message: `Failed to synchronize pull request #${payload.prNumber} files`,
                    metadata: {
                        beforeCommitSha: payload.beforeCommitSha,
                        afterCommitSha: payload.afterCommitSha,
                    },
                });
                console.log(`Error synchronizing PR files for installation ${payload.installationId} and PR ${payload.prId} from ${payload.beforeCommitSha} to ${payload.afterCommitSha}:`, err);
            });

            console.log(`Successfully synchronized PR files for installation ${payload.installationId} and PR ${payload.prId} from ${payload.beforeCommitSha} to ${payload.afterCommitSha}`);
        } else {
            console.log(`Failed to fetch PR files for installation ${payload.installationId} and PR ${payload.prId} from ${payload.beforeCommitSha} to ${payload.afterCommitSha}. Status: ${prFilesResponse.status}`);
            await logActivity({
                installationId: installationRecord._id,
                repoId: prRecord.repoId,
                pullRequestId: prRecord._id,
                event: QUEUE_EVENTS.PULL_REQUEST.SYNCHRONIZE,
                status: 'error',
                message: `Failed to fetch files while synchronizing pull request #${payload.prNumber}`,
                metadata: {
                    beforeCommitSha: payload.beforeCommitSha,
                    afterCommitSha: payload.afterCommitSha,
                    status: prFilesResponse.status,
                },
            });
        }
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.SYNCHRONIZE}]:`, error);
        const installationRecord = await GithubInstallation.findOne(
            { installationId: payload.installationId },
            { _id: 1 },
        );
        if (installationRecord) {
            const prRecord = await PullRequest.findOne(
                { installationId: installationRecord._id, githubPrId: payload.prId },
                { _id: 1, repoId: 1 },
            );
            if (prRecord) {
                await logActivity({
                    installationId: installationRecord._id,
                    repoId: prRecord.repoId,
                    pullRequestId: prRecord._id,
                    event: QUEUE_EVENTS.PULL_REQUEST.SYNCHRONIZE,
                    status: 'error',
                    message: `Failed to synchronize pull request #${payload.prNumber}`,
                    metadata: {
                        beforeCommitSha: payload.beforeCommitSha,
                        afterCommitSha: payload.afterCommitSha,
                    },
                });
            }
        }
    }
}