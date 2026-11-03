import { githubApp } from "../../github/client";

/**
 * check: run conflict detection
 * status: PR info stored in our system, like: tracked, processingStatus and more
 * track: mark PR status to tracked
 * untrack: mark PR status to untracked
 * help: list all the commands supported by our system
 */
export const SupportedCommentCommands = [
    'check',
    'status',
    'track',
    'untrack',
    'help',
]

export async function postComment(installationId: number, repoName: string, repoOwnerLogin: string, issueNumber: number, body: string): Promise<number> {
    const octokit = await githubApp.getInstallationOctokit(installationId);
    const postedComment = await octokit.rest.issues.createComment({
        owner: repoOwnerLogin,
        repo: repoName,
        issue_number: issueNumber,
        body: body,
    });
    return postedComment.data.id;
}

export async function addCommentReaction(
    installationId: number,
    repoName: string,
    repoOwnerLogin: string,
    commentId: number,
    content: 'eyes' | '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket'
) {
    try {
        const octokit = await githubApp.getInstallationOctokit(installationId);
        await octokit.rest.reactions.createForIssueComment({
            owner: repoOwnerLogin,
            repo: repoName,
            comment_id: commentId,
            content: content,
        });
    } catch (error) {
        console.error(`Failed to add reaction '${content}' to comment ${commentId} in repo ${repoOwnerLogin}/${repoName}:`, error);
    }
}

export const PR_NOT_TRACKED_COMMENT_MARKDOWN = [
    '**This PR is not tracked with RepoProbe.**',
    '> To track this PR, please use `@RepoPRobe track` on this PR.',
    '### Next steps',
    '1. Run `@RepoPRobe track` to track this PR.',
    '2. Run `@RepoPRobe status` to monitor the PR file processing.',
    '3. Wait until **PR Files Processing** shows `✅ Completed`.',
    '4. Then run `@RepoPRobe check` to detect conflicts.',
].join('\n');
