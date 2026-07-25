import { console } from "inspector/promises";
import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { githubApp } from "../../../github/client";
import { processPullRequestFiles } from "../../../github/utils/file-patch";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { ConflictDetectionScanPR, PullRequestSynchronize } from "../../../types/queue-payloads";
import { PullRequestFile } from "../../../db/schema/PullRequestFile";
import { conflictDetectionQueue } from "../../../queues/conflict-detection.queue";

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
                projection: { _id: 1 },
            }
        );
        if (!prRecord) {
            console.log(`No PR record found for installation ${payload.installationId} and PR ${payload.prId}`);
            return;
        }

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
                } satisfies ConflictDetectionScanPR, {
                    jobId: `${QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR}_${prRecord._id}`,
                });
                console.log(`Conflict detection scan job added for PR ${payload.prNumber} in repo ${payload.repoName} for installation ${installationRecord._id}`);
            }).catch(async (err) => {
                await PullRequest.updateOne(
                    { _id: prRecord._id },
                    {
                        $set: {
                            processingStatus: 'error',
                        },
                    }
                );
                console.log(`Error synchronizing PR files for installation ${payload.installationId} and PR ${payload.prId} from ${payload.beforeCommitSha} to ${payload.afterCommitSha}:`, err);
            });

            console.log(`Successfully synchronized PR files for installation ${payload.installationId} and PR ${payload.prId} from ${payload.beforeCommitSha} to ${payload.afterCommitSha}`);
        } else {
            console.log(`Failed to fetch PR files for installation ${payload.installationId} and PR ${payload.prId} from ${payload.beforeCommitSha} to ${payload.afterCommitSha}. Status: ${prFilesResponse.status}`);
        }
    } catch (error) {
        console.log(`Error [${QUEUE_EVENTS.PULL_REQUEST.SYNCHRONIZE}]:`, error);
    }
}