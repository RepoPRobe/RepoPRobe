import { Conflict } from "../../../db/schema/Conflict.js";
import { GithubInstallation, GithubInstallationType } from "../../../db/schema/GithubInstallation.js";
import { PullRequest, PullRequestType } from "../../../db/schema/PullRequest.js";
import { commentQueue } from "../../../queues/comment.queue.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { BotCommentCustom, CommentStatus } from "../../../types/queue-payloads.js";
import { postComment, PR_NOT_TRACKED_COMMENT_MARKDOWN } from "../../common/comment.js";
import { logActivity } from "../../common/activityLog.js";
import { Repo, RepoType } from "../../../db/schema/Repo.js";

export async function handleCommentStatus(payload: CommentStatus) {
    const formatDate = (date?: Date | null) => {
        if (!date) return 'N/A'
        const diff = Date.now() - new Date(date).getTime()
        const minutes = Math.floor(diff / 60000)
        const hours = Math.floor(diff / 3600000)
        const days = Math.floor(diff / 86400000)
        if (minutes < 1) return 'just now'
        if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
        if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
        return `${days} day${days > 1 ? 's' : ''} ago`
    }

    const resolveStatusContext = async (includeFullPr = true) => {
        if (!installationRecord) {
            installationRecord = await GithubInstallation.findOne(
                {
                    installationId: payload.installationId,
                    suspendedAt: { $eq: null },
                    deletedAt: { $eq: null },
                },
                { _id: 1 },
            );
        }
        if (!installationRecord) {
            console.log(`No installation record found for installation ${payload.installationId}`);
            return null;
        }
        if (!repoRecord) {
            repoRecord = await Repo.findOne(
                {
                    installationId: installationRecord._id,
                    githubId: payload.repoId,
                },
                { _id: 1 },
            );
        }
        if (!repoRecord) {
            console.log(`No repo record found for ${payload.repoOwnerLogin}/${payload.repoName} in installation ${installationRecord._id}`);
            return null;
        }
        if (!prRecord) {
            prRecord = await PullRequest.findOne(
                {
                    installationId: installationRecord._id,
                    repoId: repoRecord._id,
                    prNumber: payload.prNumber,
                },
                includeFullPr ? undefined : { _id: 1, repoId: 1 },
            );
        }
        if (!prRecord) {
            console.log(`No PR record found for PR ${payload.prNumber} in installation ${installationRecord._id}`);
            return null;
        }

        return { installation: installationRecord, repo: repoRecord, pr: prRecord };
    };

    let installationRecord: GithubInstallationType | null;
    let repoRecord: RepoType | null;
    let prRecord: PullRequestType | null;

    try {
        const context = await resolveStatusContext();
        if (!context) return;

        installationRecord = context.installation;
        repoRecord = context.repo;
        prRecord = context.pr;

        if (!prRecord) return;

        if (!prRecord.isTracked) {
            await postComment(
                Number(payload.installationId),
                payload.repoName,
                payload.repoOwnerLogin,
                payload.prNumber,
                PR_NOT_TRACKED_COMMENT_MARKDOWN,
            );
            return;
        }

        const conflictState = {
            conflicts_found: '🔴 Conflicts Found',
            no_conflicts: '🟢 No Conflicts',
            unknown: '⚪ Unknown',
        }[prRecord.conflictState ?? 'unknown'];
        const processing = {
            completed: '✅ Completed',
            processing: '⏳ Processing',
            pending: '🕐 Pending',
            error: '❌ Error',
        }[prRecord.processingStatus ?? 'pending'];

        const commentBody = [
            '### Pull request status',
            `> _Tracked · Conflict scan: ${conflictState} · File processing: ${processing}_`,
            '',
            '<details>',
            '<summary>Pull request details</summary>',
            '',
            '| Detail | Value |',
            '|---|---|',
        ];

        if (prRecord.conflictState && prRecord.conflictState === 'conflicts_found') {
            const conflicts = await Conflict.find({ prAId: prRecord._id });
            const conflictingPrsSet = new Set<string>();
            const conflictingFilesSet = new Set<string>();
            let conflictsFound = 0;
            let lastCheckedAt = Date.now();

            conflicts.forEach(conflict => {
                lastCheckedAt = Math.min(lastCheckedAt, new Date(conflict.createdAt).getTime());
                conflictsFound += conflict.conflictingLineNumbers.removed.length + conflict.conflictingLineNumbers.added.length;
                conflictingPrsSet.add(conflict.prBId.toString());
                conflictingFilesSet.add(conflict.file);
            });

            commentBody.push(`| Last checked | ${formatDate(new Date(lastCheckedAt))} |`);
            commentBody.push(`| Conflicting pull requests | ${conflictingPrsSet.size} |`);
            commentBody.push(`| Conflicting files | ${conflictingFilesSet.size} |`);
            commentBody.push(`| Conflicts found | ${conflictsFound} |`);
        }

        commentBody.push(`| PR head SHA | \`${prRecord.headBranchHeadSha}\` |`);
        commentBody.push(`| Base branch head SHA | \`${prRecord.baseBranchHeadSha}\` |`);
        if (prRecord.lastCommitAt) {
            commentBody.push(`| Last commit | ${formatDate(prRecord.lastCommitAt)} |`);
        }
        commentBody.push(`| Created on RepoPRobe | ${formatDate(prRecord.createdAt)} |`);
        commentBody.push(`| Updated on RepoPRobe | ${formatDate(prRecord.updatedAt)} |`);
        if (prRecord.deletedAt) {
            commentBody.push(`| Deleted from RepoPRobe | ${formatDate(prRecord.deletedAt)} |`);
        }
        commentBody.push('</details>');

        if (prRecord.conflictState === 'conflicts_found') {
            commentBody.push('');
            commentBody.push('Run `@RepoPRobe check` to view the conflict details.');
        }

        await commentQueue.add(QUEUE_EVENTS.BOT_COMMENT.CUSTOM, {
            prNumber: payload.prNumber,
            installationId: Number(payload.installationId),
            repoName: payload.repoName,
            repoOwnerLogin: payload.repoOwnerLogin,
            commentBody: commentBody.join('\n'),
        } satisfies BotCommentCustom, {
            jobId: `${QUEUE_EVENTS.BOT_COMMENT.CUSTOM}_${prRecord._id}_${QUEUE_EVENTS.COMMENT.STATUS}_SUCCESS`,
        });
        await logActivity({
            installationId: installationRecord._id,
            repoId: prRecord.repoId,
            pullRequestId: prRecord._id,
            event: QUEUE_EVENTS.COMMENT.STATUS,
            status: 'success',
            message: `Posted status for pull request #${payload.prNumber}`,
        });
    } catch (error) {
        console.log(`Error ${QUEUE_EVENTS.COMMENT.STATUS}:`, error);

        const context = await resolveStatusContext(false);
        if (!context) return;

        await logActivity({
            installationId: context.installation._id,
            repoId: context.pr.repoId,
            pullRequestId: context.pr._id,
            event: QUEUE_EVENTS.COMMENT.STATUS,
            status: 'error',
            message: `Failed to post status for pull request #${payload.prNumber}`,
        });
    }
}