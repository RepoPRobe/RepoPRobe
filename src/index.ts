import { Webhooks } from '@octokit/webhooks';
import express from 'express';
import dotenv from "dotenv";
import { githubApp } from './github/client.js';
import connectDB from './db/index.js';
import { Repo } from './db/schema/Repo.js';
import { GithubInstallation } from './db/schema/GithubInstallation.js';
import { RepoConfig } from './db/schema/RepoConfig.js';
import { Types } from 'mongoose';
import { processPullRequestFiles } from './github/utils/file-patch.js';
import { PullRequest } from './db/schema/PullRequest.js';
import { PullRequestFile } from './db/schema/PullRequestFIle.js';
dotenv.config();

const githubWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
const PORT = process.env.PORT;

if (!PORT) {
    throw new Error("PORT env not set !!");
}
if (!githubWebhookSecret) {
    throw new Error("GITHUB_WEBHOOK_SECRET env not set !!");
}

const server = express();
const webhooks = new Webhooks({ secret: githubWebhookSecret });

server.post("/webhook", express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['x-hub-signature-256'] as string
    const body = req.body.toString()

    try {
        await webhooks.verifyAndReceive({
            id: req.headers['x-github-delivery'] as string,
            name: req.headers['x-github-event'] as any,
            signature,
            payload: body
        })
        res.status(200).send('ok');
    } catch (error) {
        console.log("Error [webhook]:", error);
        res.status(401).send('Invalid signature');
    }
});

/**
 * Installation Related Webhooks
 */

webhooks.on("installation.created", async ({ payload }) => {
    console.log("Installation Created");
    console.dir(payload, { depth: null, colors: true });

    try {
        const account = payload.installation.account;
        const owner = account ? {
            id: account.id.toString(),
            login: 'login' in account ? account.login : account.slug,
            avatarUrl: account.avatar_url,
            githubUrl: account.html_url,
            userType: 'type' in account ? account.type : 'Organization',
        } : null;
        const installedBy = {
            id: payload.sender.id.toString(),
            login: payload.sender.login,
            avatarUrl: payload.sender.avatar_url,
            githubUrl: payload.sender.html_url,
            userType: payload.sender.type,
        };

        const githubInstallation = await GithubInstallation.findOneAndUpdate(
            { installationId: payload.installation.id.toString() },
            {
                $setOnInsert: {
                    installationId: payload.installation.id.toString(),
                    ownedBy: owner,
                    githubRedirect: payload.installation.html_url,
                    target: {
                        id: payload.installation.target_id.toString(),
                        accountType: payload.installation.target_type,
                    },
                    installedBy: installedBy,
                    installedOn: payload.installation.created_at,
                    lastUpdatedAt: payload.installation.updated_at,
                    repositorySelection: payload.installation.repository_selection,
                }
            },
            { upsert: true, returnDocument: "after", projection: { _id: 1 } },
        );

        const repos = payload.repositories ?? [];
        if (repos.length > 0) {
            const result = await Repo.bulkWrite(
                repos.map(repo => ({
                    updateOne: {
                        filter: {
                            installationId: githubInstallation._id,
                            githubId: repo.id.toString(),
                        },
                        update: {
                            $set: {
                                deletedAt: null,
                            },
                            $setOnInsert: {
                                installationId: githubInstallation._id,
                                installedOn: new Date(payload.installation.created_at),
                                githubId: repo.id.toString(),
                                githubName: repo.name,
                                githubFullName: repo.full_name,
                            }
                        },
                        upsert: true,
                    }
                }))
            );

            if (result.upsertedCount > 0) {
                const reposToCreateConfig = Object.values(result.upsertedIds) as Types.ObjectId[];
                await RepoConfig.insertMany(
                    reposToCreateConfig.map(repoId => ({
                        repoId: repoId,
                    }))
                )
            }

            console.log(`Inserted ${repos.length} repos for installation ${payload.installation.id}`);
        }
    } catch (error) {
        console.log("Error [installation.created]:", error);
    }
});

webhooks.on("installation.deleted", async ({ payload }) => {
    console.log("Installation Deleted");
    console.dir(payload, { depth: null, colors: true });

    try {
        const githubInstallation = await GithubInstallation.findOneAndUpdate(
            {
                installationId: payload.installation.id.toString(),
                deletedAt: { $eq: null },
            },
            { $set: { deletedAt: new Date() } },
            { projection: { _id: 1 } },
        );

        if (!githubInstallation) {
            console.log(`No GithubInstallation found or already deleted found for installation ${payload.installation.id}`);
            return;
        }

        await Repo.updateMany(
            { installationId: githubInstallation?._id },
            { $set: { deletedAt: new Date() } }
        );

        console.log(`Marked repos as deleted for installation ${payload.installation.id}`);
    } catch (error) {
        console.log("Error [installation.deleted]:", error);
    }
});

webhooks.on("installation.suspend", async ({ payload }) => {
    console.log("Installation Suspended");
    console.dir(payload, { depth: null, colors: true });

    try {
        const installationId = payload.installation.id.toString();
        const githubInstallation = await GithubInstallation.findOneAndUpdate(
            {
                installationId: installationId,
                deletedAt: { $eq: null },
                suspendedAt: { $eq: null },
            },
            { $set: { suspendedAt: new Date() } },
            { projection: { _id: 1 } },
        );
        if (githubInstallation) {
            console.log(`Marked installation ${installationId} as suspended`);
        } else {
            console.log(`No GithubInstallation found or deleted one or already suspended one for installation ${installationId}`);
        }
    } catch (error) {
        console.log("Error [installation.suspend]:", error)
    }
});

webhooks.on("installation.unsuspend", async ({ payload }) => {
    console.log("Installation Unsuspended");
    console.dir(payload, { depth: null, colors: true });

    try {
        const installationId = payload.installation.id.toString();
        const githubInstallation = await GithubInstallation.findOneAndUpdate(
            {
                installationId,
                deletedAt: { $eq: null },
                suspendedAt: { $ne: null },
            },
            { $set: { suspendedAt: null } },
            { projection: { _id: 1 } },
        );
        if (githubInstallation) {
            console.log(`Marked installation ${installationId} as unsuspended`);
        } else {
            console.log(`No GithubInstallation found for installation ${installationId}`);
        }
    } catch (error) {
        console.log("Error [installation.unsuspend]:", error)
    }
});

webhooks.on("installation_repositories.added", async ({ payload }) => {
    console.log("Installation Repositories Added");
    console.dir(payload, { depth: null, colors: true });

    try {
        const installationDoc = await GithubInstallation.findOne(
            { installationId: payload.installation.id.toString() },
            {
                _id: 1,
                repositorySelection: 1,
            },
        );

        if (!installationDoc) {
            console.log(`No GithubInstallation found for installation ${payload.installation.id}`);
            return;
        }
        // check if change of installation selection is there or not
        if (installationDoc.repositorySelection === 'all' && payload.installation.repository_selection === 'selected') {
            // if above condition satisfies, meaning there is possible chance that not all repos which were initially there are now selected.
            // so our task is basically just to soft delete not to add anything because initially all the repos were added
            const allRepos = await Repo.find(
                { installationId: installationDoc._id },
                { githubId: 1 },
            );
            const allReposGithubIds = allRepos.map(repo => repo.githubId);
            const addedReposGithubIds = payload.repositories_added.map(repo => repo.id.toString());
            const reposToDelete = allReposGithubIds.filter(repoId => !addedReposGithubIds.includes(repoId));

            // no need of await as we are just soft deleting
            Repo.updateMany(
                {
                    installationId: installationDoc._id,
                    githubId: { $in: reposToDelete },
                },
                {
                    $set: {
                        deletedAt: new Date(),
                    }
                }
            ).catch(err => console.log("Error while soft deleting repos after installation selection changed to 'selected':", err));
            console.log(`Installation changed to 'selected'. Marked ${reposToDelete.toString()} repos as deleted for installation ${installationDoc._id.toString()}`);
        } else {
            const reposToAdd = payload.repositories_added;

            // to find if any soft deleted repo is there
            const existingRepos = await Repo.find(
                {
                    installationId: installationDoc._id,
                    githubId: { $in: reposToAdd.map(repo => repo.id.toString()) },
                },
                { githubId: 1, deletedAt: 1 }
            );
            const reposToIgnore = new Set<string>();
            const softDeletedReposIds = existingRepos
                .filter(repo => {
                    if (!repo.deletedAt) {
                        reposToIgnore.add(repo.githubId.toString());
                    }
                    return Boolean(repo.deletedAt);
                })
                .map(repo => repo.githubId);
            const reposToRestore = reposToAdd
                .filter(repo => softDeletedReposIds.includes(repo.id.toString()))
                .map(repo => repo.id.toString());

            const reposToCreate = reposToAdd
                .filter(repo => !softDeletedReposIds.includes(repo.id.toString()) && !reposToIgnore.has(repo.id.toString()))
                .map(repository => ({
                    installationId: installationDoc._id,
                    installedOn: new Date(),
                    githubId: repository.id.toString(),
                    githubName: repository.name,
                    githubFullName: repository.full_name,
                }));

            const [insertedRepos, restoredRepos] = await Promise.allSettled([
                reposToCreate.length > 0 ? Repo.insertMany(reposToCreate) : Promise.resolve([]),
                reposToRestore.length > 0 ? Repo.updateMany(
                    {
                        installationId: installationDoc._id,
                        githubId: { $in: reposToRestore }
                    },
                    { $set: { deletedAt: null } },
                ) : Promise.resolve([]),
            ]);

            if (insertedRepos.status === 'rejected') {
                console.log("Error while inserting new repos:", insertedRepos.reason);
            } else {
                await RepoConfig.insertMany(insertedRepos.value.map(repo => ({
                    repoId: repo._id,
                })));
                console.log(`Inserted ${reposToCreate.length} repos for installation ${payload.installation?.id}`);
            }

            if (restoredRepos.status === 'rejected') {
                console.log("Error while restoring soft deleted repos:", restoredRepos.reason);
            } else {
                console.log(`Restored ${reposToRestore.length} repos for installation ${payload.installation?.id}`)
            }

            console.log(`Ignored ${reposToIgnore.size} repos for installation ${payload.installation?.id} as they were already present and not soft deleted.`);
        }

        // update the repositorySelection field in GithubInstallation if it has changed
        if (installationDoc.repositorySelection !== payload.installation.repository_selection) {
            // no await needed
            GithubInstallation.updateOne(
                { _id: installationDoc._id },
                { $set: { repositorySelection: payload.installation.repository_selection } },
            ).catch(err => console.log("Error while updating installation selection:", err));
        }

    } catch (error) {
        console.log("Error [installation_repositories.added]:", error);
    }
});

webhooks.on("installation_repositories.removed", async ({ payload }) => {
    console.log("Installation Repositories Removed");
    console.dir(payload, { depth: null, colors: true });

    try {
        const installationId = await GithubInstallation.findOne(
            { installationId: payload.installation.id.toString() },
            { _id: 1 },
        )
        if (!installationId) {
            console.log(`No GithubInstallation found for installation ${payload.installation.id}`);
            return;
        }
        const reposToDelete = payload.repositories_removed.map(repository => ({
            installationId: installationId._id,
            githubId: repository.id.toString(),
        }));
        await Repo.updateMany(
            {
                installationId: installationId._id,
                githubId: { $in: reposToDelete.map(repo => repo.githubId) }
            },
            { $set: { deletedAt: new Date() } },
        );
        console.log(`Marked ${reposToDelete.length} repos as deleted for installation ${payload.installation?.id}`);
    } catch (error) {
        console.log("Error [installation_repositories.removed]:", error);
    }
});


/**
 * PR Related Webhooks
 */

// pull_request.opened                - PR created
// pull_request.closed                - PR closed(could be merged or just closed)
// pull_request.reopened              - closed PR reopened
// pull_request.synchronize           - new commit pushed to PR branch
// pull_request.edited                - title, body, or base branch changed
// pull_request.converted_to_draft    - PR converted to draft
// pull_request.ready_for_review      - draft PR marked ready
// pull_request.labeled               - label added to PR
// pull_request.unlabeled             - label removed from PR
// pull_request.assigned              - assignee added
// pull_request.unassigned            - assignee removed

webhooks.on("pull_request.opened", async ({ payload }) => {
    console.log("PR Opened");
    console.dir(payload, { depth: null, colors: true });
    try {
        if (!payload.installation) return;

        const installationRecord = await GithubInstallation.findOne(
            {
                installationId: payload.installation.id.toString(),
                suspendedAt: { $eq: null },
                deletedAt: { $eq: null },
            },
            { _id: 1 },
        )
        if (!installationRecord) {
            console.log(`No installation record found for installation ${payload.installation.id}`);
            return;
        }

        const repoRecord = await Repo.findOne(
            {
                installationId: installationRecord._id,
                githubId: payload.repository.id.toString(),
                deletedAt: { $eq: null },
            },
            { _id: 1 },
        );
        if (!repoRecord) {
            console.log(`No repo found for installation ${payload.installation.id} and PR ${payload.pull_request.id}`);
            return;
        }

        const prRecord = await PullRequest.create({
            repoId: repoRecord._id,
            installationId: installationRecord._id,
            githubPrId: payload.pull_request.id.toString(),
            prNumber: payload.pull_request.number,
            title: payload.pull_request.title,
            htmlUrl: payload.pull_request.html_url,
            state: payload.pull_request.state,
            isDraft: payload.pull_request.draft,
            baseBranch: payload.pull_request.base.ref,
            baseBranchHeadSha: payload.pull_request.base.sha,
            headBranch: payload.pull_request.head.ref,
            author: {
                id: payload.pull_request.user.id.toString(),
                login: payload.pull_request.user.login,
                avatarUrl: payload.pull_request.user.avatar_url,
                githubUrl: payload.pull_request.user.html_url,
                userType: payload.pull_request.user.type,
            },
            labels: payload.pull_request.labels.map(label => ({
                id: label.id,
                name: label.name,
                default: label.default,
            })),
            githubCreatedAt: payload.pull_request.created_at,
            githubUpdatedAt: payload.pull_request.updated_at,
            lastCommitAt: new Date(payload.pull_request.updated_at), // initially store the creation/updation time of PR as as there can be case when branch was there since few months and pr is created recently
            isTracked: true,
        });

        const octokit = await githubApp.getInstallationOctokit(payload.installation.id);
        const prFiles = await octokit.rest.pulls.listFiles({
            owner: payload.repository.owner.login,
            repo: payload.repository.name,
            pull_number: payload.pull_request.number,
        });

        if (prFiles.status === 200) {
            const convertedPatchObject = processPullRequestFiles(prFiles.data);

            PullRequestFile.insertMany(
                convertedPatchObject.map(patchObj => ({
                    pullRequestId: prRecord._id,
                    file: patchObj.file,
                    status: patchObj.status,
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

        console.log('PR files -->', prFiles);
    } catch (error) {
        console.log("Error [pull_request.opened]:", error);
    }
});

webhooks.on("pull_request.closed", async ({ payload }) => {
    console.log("PR Closed");
    console.dir(payload, { depth: null, colors: true });
    try {

    } catch (error) {
        console.log("Error [pull_request.closed]:", error);
    }
});

webhooks.on("pull_request.reopened", async ({ payload }) => {
    console.log("PR Reopened");
    console.dir(payload, { depth: null, colors: true });
    try {

    } catch (error) {
        console.log("Error [pull_request.reopened]:", error);
    }
});

webhooks.on("pull_request.synchronize", async ({ payload }) => {
    console.log("PR Synchronize");
    console.dir(payload, { depth: null, colors: true });
    try {

    } catch (error) {
        console.log("Error [pull_request.synchronize]:", error);
    }
});

webhooks.on("pull_request.edited", async ({ payload }) => {
    console.log("PR Edited");
    console.dir(payload, { depth: null, colors: true });
    try {
        if (payload.changes.title) { // title is changed
            // update title as payload.pull_request.title
        }
        if (payload.changes.body) { // body is changed
            // update body as payload.pull_request.body
        }
        if (payload.changes.base) { // base branch changed
            // payload.changes.base.ref
            // payload.changes.base.sha
        }
    } catch (error) {
        console.log("Error [pull_request.edited]:", error);
    }
});

webhooks.on("pull_request.converted_to_draft", async ({ payload }) => {
    console.log("PR Converted to Draft");
    console.dir(payload, { depth: null, colors: true });
    try {

    } catch (error) {
        console.log("Error [pull_request.converted_to_draft]:", error);
    }
});

webhooks.on("pull_request.ready_for_review", async ({ payload }) => {
    console.log("PR Ready for Review");
    console.dir(payload, { depth: null, colors: true });
    try {

    } catch (error) {
        console.log("Error [pull_request.ready_for_review]:", error);
    }
});

webhooks.on("pull_request.labeled", async ({ payload }) => {
    console.log("PR Labeled");
    console.dir(payload, { depth: null, colors: true });
    try {

    } catch (error) {
        console.log("Error [pull_request.labeled]:", error);
    }
});

webhooks.on("pull_request.unlabeled", async ({ payload }) => {
    console.log("PR Unlabeled");
    console.dir(payload, { depth: null, colors: true });
    try {

    } catch (error) {
        console.log("Error [pull_request.unlabeled]:", error);
    }
});

webhooks.on("pull_request.assigned", async ({ payload }) => {
    console.log("PR Assigned");
    console.dir(payload, { depth: null, colors: true });
    try {

    } catch (error) {
        console.log("Error [pull_request.assigned]:", error);
    }
});

webhooks.on("pull_request.unassigned", async ({ payload }) => {
    console.log("PR Unassigned");
    console.dir(payload, { depth: null, colors: true });
    try {

    } catch (error) {
        console.log("Error [pull_request.unassigned]:", error);
    }
});


/**
 * Comment Related Webhooks
 */

webhooks.on("issue_comment.created", async ({ payload }) => {
    console.log("Issue Comment Created");
    console.dir(payload, { depth: null, colors: true });
    try {

    } catch (error) {
        console.log("Error [issue_comment.created]:", error);
    }
});

// webhooks.on("issue_comment.created", async ({ payload }) => {
//     if (!payload.comment.body.includes("@RepoPRobe")) return;
//     if (!payload.installation) return;

//     const octokit = await githubApp.getInstallationOctokit(payload.installation.id)
//     console.log(JSON.stringify(payload));

//     await octokit.rest.issues.createComment({
//         owner: payload.repository.owner.login,
//         repo: payload.repository.name,
//         issue_number: payload.issue.number,
//         body: '👋 RepoProbe here — I am alive!'
//     })
// })


// TODO: also keep the thing like @repoprobe report
// which will work like users to report that our system did something wrong maybe wrong conflicts or no conflicts even though conflicts were there

async function main() {
    await connectDB();
    server.listen(PORT, () => console.log(`Listening to port ${PORT}`));
}
main();
