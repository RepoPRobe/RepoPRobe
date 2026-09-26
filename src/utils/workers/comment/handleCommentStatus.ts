import { Conflict } from "../../../db/schema/Conflict";
import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { PullRequest } from "../../../db/schema/PullRequest";
import { commentQueue } from "../../../queues/comment.queue";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { BotCommentCustom, CommentStatus } from "../../../types/queue-payloads";
import { postComment, PR_NOT_TRACKED_COMMENT_MARKDOWN } from "../../common/comment";

export async function handleCommentStatus(payload: CommentStatus) {
    const formatDate = (date: Date | null) => {
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

        const prRecord = await PullRequest.findOne({
            installationId: installationRecord._id,
            prNumber: payload.prNumber,
        });
        if (!prRecord || !prRecord.isTracked) {
            if (!prRecord) console.log(`No PR record found for PR ${payload.prNumber} in installation ${installationRecord._id}`);
            await postComment(
                Number(payload.installationId),
                payload.repoName,
                payload.repoOwnerLogin,
                payload.prNumber,
                PR_NOT_TRACKED_COMMENT_MARKDOWN,
            );
            return;
        }

        const commentBody = [
            '## 📊 RepoProbe - PR Status',
            '| Name | Value |',
            '|-------|-------|',
        ];
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

        commentBody.push(`| Conflict Scan | ${conflictState} |`);
        if (prRecord.conflictState && prRecord.conflictState === 'conflicts_found') {
            const conflicts = await Conflict.find({ prAId: prRecord._id });
            const conflictingPrsSet = new Set<string>();
            const conflictingFilesSet = new Set<string>();
            let minLastChecked: number = new Date().getTime();
            let conflictsFound = 0;

            conflicts.forEach(conflict => {
                if (!minLastChecked) minLastChecked = new Date(conflict.createdAt).getTime();
                else minLastChecked = Math.min(minLastChecked, new Date(conflict.createdAt).getTime());

                conflictsFound += conflict.conflictingLineNumbers.removed.length + conflict.conflictingLineNumbers.added.length;
                conflictingPrsSet.add(conflict.prBId.toString());
                conflictingFilesSet.add(conflict.file);
            });

            commentBody.push(`| Last Checked | ${formatDate(new Date(minLastChecked))} |`);
            commentBody.push(`| Conflicting Pull Requests | ${conflictingPrsSet.size} |`);
            commentBody.push(`| Conflicting Files | ${conflictingFilesSet.size} |`);
            commentBody.push(`| Conflicts Found | ${conflictsFound} |`);
        }
        commentBody.push(`| PR Files Processing | ${processing} |`);
        commentBody.push(`| This PR Head SHA | \`${prRecord.headBranchHeadSha}\` |`);
        commentBody.push(`| Base Branch Head SHA | \`${prRecord.baseBranchHeadSha}\` |`);
        if (prRecord.lastCommitAt) {
            commentBody.push(`| Last Commit | ${formatDate(prRecord.lastCommitAt)} |`);
        }
        commentBody.push(`| Created On RepoPRobe | ${formatDate(prRecord.createdAt)} |`);
        commentBody.push(`| Updated On RepoPRobe | ${formatDate(prRecord.updatedAt)} |`);
        if (prRecord.deletedAt) {
            commentBody.push(`| Deleted From RepoPRobe | ${formatDate(prRecord.deletedAt)} |`);
        }
        commentBody.push('> [!NOTE]');
        if (prRecord.conflictState === 'conflicts_found') {
            commentBody.push(`> ⚠️ Run \`@RepoPRobe check\` to see full conflict details.`);
        }
        commentBody.push('> 🤖 [RepoProbe](https://github.com/apps/repoprobe) · \`@RepoPRobe help\` for all commands');

        await commentQueue.add(QUEUE_EVENTS.BOT_COMMENT.CUSTOM, {
            prNumber: payload.prNumber,
            installationId: Number(payload.installationId),
            repoName: payload.repoName,
            repoOwnerLogin: payload.repoOwnerLogin,
            commentBody: commentBody.join('\n'),
        } satisfies BotCommentCustom, {
            jobId: `${QUEUE_EVENTS.BOT_COMMENT.CUSTOM}_${prRecord._id}_${QUEUE_EVENTS.COMMENT.STATUS}_SUCCESS`,
        });
    } catch (error) {
        console.log(`Error ${QUEUE_EVENTS.COMMENT.STATUS}:`, error);
    }
}