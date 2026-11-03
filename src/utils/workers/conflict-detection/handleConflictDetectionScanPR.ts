import { Types } from "mongoose";
import { PullRequest } from "../../../db/schema/PullRequest";
import { PullRequestFile, PullRequestFileType, HunkType } from "../../../db/schema/PullRequestFile";
import { areOverlapingHunks, getConflictingLinesFromHunks } from "../../../github/utils/file-patch";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { BotCommentConflictsFound, BotCommentCustom, ConflictDetectionScanPR } from "../../../types/queue-payloads";
import { Conflict } from "../../../db/schema/Conflict";
import { commentQueue } from "../../../queues/comment.queue";
import { logActivity } from "../../common/activityLog";

type ConflictingDataFromHunk = {
    file: string;
    prAId: Types.ObjectId;
    prBId: Types.ObjectId;
    prAHunk: Omit<HunkType, 'lines'>;
    prBHunk: Omit<HunkType, 'lines'>;
    conflictingLineNumbers: {
        removed: number[];
        added: number[];
    },
};

export async function handleConflictDetectionScanPR(payload: ConflictDetectionScanPR) {
    try {
        console.log(`Starting conflict detection scan for PR ${payload.prId}`);

        const prRecord = await PullRequest.findOne({ _id: new Types.ObjectId(payload.prId) });
        if (!prRecord) {
            console.log(`No PR record found for installation PR ${payload.prId}`);
            return;
        }
        if (prRecord.processingStatus !== 'completed') {
            await logActivity({
                installationId: prRecord.installationId,
                repoId: prRecord.repoId,
                pullRequestId: prRecord._id,
                event: QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR,
                status: 'warning',
                message: `Skipped conflict scan for pull request #${prRecord.prNumber} because processing is not completed`,
                metadata: { source: payload.source, processingStatus: prRecord.processingStatus },
            });
            console.log(`Processing of PR ${payload.prId} is not in a completed state, skipping conflict detection scan`);
            return;
        }

        await logActivity({
            installationId: prRecord.installationId,
            repoId: prRecord.repoId,
            pullRequestId: prRecord._id,
            event: QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR,
            status: 'info',
            message: `Started conflict scan for pull request #${prRecord.prNumber}`,
            metadata: { source: payload.source },
        });

        // Step 0: delete existing conflicts, start fresh
        await Conflict.deleteMany({ prAId: new Types.ObjectId(payload.prId) });

        // Step 1.1: fetch potential conflicting PRs having same branch and SHA
        const potentialConflictingPrRecords = await PullRequest.find({
            _id: { $ne: prRecord._id },
            installationId: prRecord.installationId,
            repoId: prRecord.repoId,
            baseBranch: prRecord.baseBranch,
            baseBranchHeadSha: prRecord.baseBranchHeadSha,
            state: 'open',
            isDraft: false,
            processingStatus: 'completed',
            isTracked: true,
            githubClosedAt: null,
            githubMergedAt: null,
            deletedAt: null,
        }, { _id: 1 });
        const potentialConflictingPrIds = potentialConflictingPrRecords.map(pr => pr._id);

        if (potentialConflictingPrIds.length === 0) {
            await commentQueue.add(QUEUE_EVENTS.BOT_COMMENT.CUSTOM, {
                prNumber: prRecord.prNumber,
                installationId: payload.installationId,
                repoName: payload.repoName,
                repoOwnerLogin: payload.repoOwnerLogin,
                commentBody: [
                    '**No conflicts found.** ✅',
                    '> RepoProbe checked this PR for potential conflicts with other active pull requests.',
                ].join('\n'),
            } satisfies BotCommentCustom, {
                jobId: `${QUEUE_EVENTS.BOT_COMMENT.CUSTOM}_${payload.prId}_NO_CONFLICTS_FOUND`,
            });

            await PullRequest.updateOne(
                { _id: new Types.ObjectId(payload.prId) },
                {
                    $set: {
                        conflictState: 'no_conflicts',
                    },
                },
            );

            await logActivity({
                installationId: prRecord.installationId,
                repoId: prRecord.repoId,
                pullRequestId: prRecord._id,
                event: QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR,
                status: 'success',
                message: `No conflicts found for pull request #${prRecord.prNumber}`,
                metadata: { source: payload.source, conflictState: 'no_conflicts' },
            });
            console.log(`No potential conflicting PRs found for PR ${payload.prId}, marking conflict state as 'no_conflicts'`);
            return;
        }

        // Step 1.2: fetch current PR modified files
        const filesAffectedInPR = await PullRequestFile.find({ pullRequestId: prRecord._id });

        // Step 2: fetch modified files of the potential conflicting PRs
        const fileCondition = filesAffectedInPR.flatMap(file => [
            { file: file.file },
            { previousFilePath: file.file },
            ...(file.previousFilePath ? [
                { file: file.previousFilePath },
                { previousFilePath: file.previousFilePath },
            ] : []),
        ]);
        const conflictingPrsAffectedFiles = await PullRequestFile.find({
            pullRequestId: { $in: potentialConflictingPrIds },
            $or: fileCondition,
        });

        // Step 3: we have files at this point, now we just detect conflicts
        const fileNamesAffected = new Set(filesAffectedInPR.map(file => file.file));

        // Step 3.1: group the conflicting files by file name
        const filesAffectedInConflictingPRs: Map<string, Array<PullRequestFileType>> = new Map();
        conflictingPrsAffectedFiles.forEach(file => {
            const fileName = file.file;
            const fileNamePriorRename = file.previousFilePath;

            if (fileNamesAffected.has(fileName)) {
                const existingEntry = filesAffectedInConflictingPRs.get(fileName);
                if (existingEntry) {
                    existingEntry.push(file);
                } else {
                    filesAffectedInConflictingPRs.set(fileName, [file]);
                }
            }
            if (fileNamePriorRename && fileNamesAffected.has(fileNamePriorRename)) {
                const existingEntry = filesAffectedInConflictingPRs.get(fileNamePriorRename);
                if (existingEntry) {
                    existingEntry.push(file);
                } else {
                    filesAffectedInConflictingPRs.set(fileNamePriorRename, [file]);
                }
            }
        });

        // Step 3.2: detect conflict per file changed in the PR
        const conflicts: ConflictingDataFromHunk[] = [];
        filesAffectedInPR.map(file => {
            const potentialConflictingFiles = filesAffectedInConflictingPRs.get(file.file);
            if (potentialConflictingFiles) {
                // Step 3.2.1: compare line ranges in hunks to detect overlapping changes between current PR and conflicting PRs
                potentialConflictingFiles.forEach(potentialConflictingFile => {
                    file.hunks.forEach(fileHunk => {
                        potentialConflictingFile.hunks.forEach(potentialConflictingHunk => {
                            if (areOverlapingHunks(fileHunk, potentialConflictingHunk)) {
                                // If we are at this point this means potentialConflictingFile is now guaranteed a conflicting file
                                const { hasConflicts, removedLines, addedLines } = getConflictingLinesFromHunks(fileHunk, potentialConflictingHunk);
                                if (hasConflicts) {
                                    conflicts.push({
                                        file: file.file,
                                        prAId: new Types.ObjectId(payload.prId),
                                        prBId: potentialConflictingFile.pullRequestId,
                                        prAHunk: {
                                            oldFileStartLine: fileHunk.oldFileStartLine,
                                            oldFilePatchLinesCount: fileHunk.oldFilePatchLinesCount,
                                            newFileStartLine: fileHunk.newFileStartLine,
                                            newFilePatchLinesCount: fileHunk.newFilePatchLinesCount,
                                        },
                                        prBHunk: {
                                            oldFileStartLine: potentialConflictingHunk.oldFileStartLine,
                                            oldFilePatchLinesCount: potentialConflictingHunk.oldFilePatchLinesCount,
                                            newFileStartLine: potentialConflictingHunk.newFileStartLine,
                                            newFilePatchLinesCount: potentialConflictingHunk.newFilePatchLinesCount,
                                        },
                                        conflictingLineNumbers: {
                                            removed: removedLines,
                                            added: addedLines,
                                        },
                                    });
                                }
                            }
                        });
                    });
                });
            }
        });

        // Step 4: we have conflicts ready with us, now just store it in database and add queue comment to display the conflicts on the PR
        if (conflicts.length === 0) {
            await commentQueue.add(QUEUE_EVENTS.BOT_COMMENT.CUSTOM, {
                prNumber: prRecord.prNumber,
                installationId: payload.installationId,
                repoName: payload.repoName,
                repoOwnerLogin: payload.repoOwnerLogin,
                commentBody: [
                    '**No conflicts found.** ✅',
                    '> RepoProbe checked this PR for potential conflicts with other active pull requests.',
                ].join('\n'),
            } satisfies BotCommentCustom, {
                jobId: `${QUEUE_EVENTS.BOT_COMMENT.CUSTOM}_${payload.prId}_NO_CONFLICTS_FOUND`,
            });

            await PullRequest.updateOne(
                { _id: new Types.ObjectId(payload.prId) },
                {
                    $set: {
                        conflictState: 'no_conflicts',
                    },
                },
            );
            await logActivity({
                installationId: prRecord.installationId,
                repoId: prRecord.repoId,
                pullRequestId: prRecord._id,
                event: QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR,
                status: 'success',
                message: `No conflicts found for pull request #${prRecord.prNumber}`,
                metadata: { source: payload.source, conflictState: 'no_conflicts' },
            });
            console.log(`No conflicts detected for PR ${payload.prId}`);
            return;
        }

        await PullRequest.updateOne(
            { _id: new Types.ObjectId(payload.prId) },
            {
                $set: {
                    conflictState: 'conflicts_found',
                },
            },
        );
        await Conflict.bulkWrite(
            conflicts.map(conflict => ({
                insertOne: {
                    document: {
                        file: conflict.file,
                        prAId: conflict.prAId,
                        prBId: conflict.prBId,
                        prAHunk: { ...conflict.prAHunk, lines: [] },  // 'lines' is required by the schema/type shape, but the actual conflicting line details are stored in 'conflictingLineNumbers' below.
                        prBHunk: { ...conflict.prBHunk, lines: [] },  // This placeholder avoids the TypeScript/Mongoose schema mismatch without affecting the conflict detection logic.
                        conflictingLineNumbers: {
                            removed: conflict.conflictingLineNumbers.removed,
                            added: conflict.conflictingLineNumbers.added,
                        }
                    }
                }
            }))
        );
        await commentQueue.add(QUEUE_EVENTS.BOT_COMMENT.CONFLICTS_FOUND, {
            prId: payload.prId,
            installationId: payload.installationId,
            repoName: payload.repoName,
            repoOwnerLogin: payload.repoOwnerLogin,
        } satisfies BotCommentConflictsFound, {
            jobId: `${QUEUE_EVENTS.BOT_COMMENT.CONFLICTS_FOUND}_${payload.prId}`,
        })

        await logActivity({
            installationId: prRecord.installationId,
            repoId: prRecord.repoId,
            pullRequestId: prRecord._id,
            event: QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR,
            status: 'warning',
            message: `Conflicts found for pull request #${prRecord.prNumber}`,
            metadata: { source: payload.source, conflictCount: conflicts.length, conflictState: 'conflicts_found' },
        });

        console.log(`Conflict detection scan completed for PR ${payload.prId}. Total conflicts detected: ${conflicts.length} and stored in the database. Bot comment job added to notify about conflicts.`);
    } catch (error) {
        console.log(`Error ${QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR}:`, error);
        try {
            const prRecord = await PullRequest.findOne(
                { _id: new Types.ObjectId(payload.prId) },
                { installationId: 1, repoId: 1, prNumber: 1 },
            );
            if (prRecord) {
                await logActivity({
                    installationId: prRecord.installationId,
                    repoId: prRecord.repoId,
                    pullRequestId: prRecord._id,
                    event: QUEUE_EVENTS.CONFLICT_DETECTION.SCAN_PR,
                    status: 'error',
                    message: `Failed conflict scan for pull request #${prRecord.prNumber}`,
                    metadata: { source: payload.source },
                });
            }
        } catch (logError) {
            console.log("Error while logging activity for conflict detection scan:", logError);
        }
    }
}