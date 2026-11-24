import { GithubInstallation } from "../../../db/schema/GithubInstallation.js";
import { Repo } from "../../../db/schema/Repo.js";
import { RepoConfig } from "../../../db/schema/RepoConfig.js";
import { installationQueue } from "../../../queues/installation.queue.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";
import { InstallationRepositoriesAdded, InstallationRepositoriesRemoved } from "../../../types/queue-payloads.js";
import { logActivity } from "../../common/activityLog.js";

export async function handleInstallationRepositoriesAdded(payload: InstallationRepositoriesAdded) {
    try {
        const installationDoc = await GithubInstallation.findOne(
            { installationId: payload.installationId },
            {
                _id: 1,
                repositorySelection: 1,
            },
        );

        if (!installationDoc) {
            console.log(`No GithubInstallation found for installation ${payload.installationId}`);
            return;
        }
        // check if change of installation selection is there or not
        if (installationDoc.repositorySelection === 'all' && payload.installationRepositorySelection === 'selected') {
            // if above condition satisfies, meaning there is possible chance that not all repos which were initially there are now selected.
            // so our task is basically just to soft delete not to add anything because initially all the repos were added
            const allRepos = await Repo.find(
                { installationId: installationDoc._id },
                { githubId: 1 },
            );
            const addedReposGithubIds = payload.repositoriesAdded.map(repo => repo.id.toString());
            const reposToDelete = allRepos.filter(repo => !addedReposGithubIds.includes(repo.githubId));
            const reposToDeleteGithubIds = reposToDelete.map(repo => repo.githubId);

            if (reposToDeleteGithubIds.length > 0) {
                await installationQueue.add(
                    QUEUE_EVENTS.INSTALLATION_REPOSITORIES.REMOVED,
                    {
                        installationId: payload.installationId,
                        repositoriesRemoved: reposToDeleteGithubIds.map(id => ({ id })),
                    } satisfies InstallationRepositoriesRemoved,
                    {
                        jobId: `${QUEUE_EVENTS.INSTALLATION_REPOSITORIES.REMOVED}_${payload.installationId}_${reposToDeleteGithubIds.join('_')}`,
                    },
                );
            }

            const parentLogId = await logActivity({
                installationId: installationDoc._id,
                event: QUEUE_EVENTS.INSTALLATION_REPOSITORIES.ADDED,
                status: 'warning',
                message: 'Installation repository selection changed to selected',
                metadata: {
                    removedCount: reposToDelete.length,
                },
            });
            await Promise.all(reposToDelete.map(repo => logActivity({
                installationId: installationDoc._id,
                repoId: repo._id,
                parentLogId: parentLogId,
                event: QUEUE_EVENTS.REPO.REMOVED,
                status: 'warning',
                message: 'Repository removed after installation selection changed to selected',
            })));
            console.log(`Installation changed to 'selected'. Marked ${reposToDeleteGithubIds.toString()} repos as deleted for installation ${installationDoc._id.toString()}`);
        } else {
            const reposToAdd = payload.repositoriesAdded;

            // to find if any soft deleted repo is there
            const existingRepos = await Repo.find(
                {
                    installationId: installationDoc._id,
                    githubId: { $in: reposToAdd.map(repo => repo.id.toString()) },
                },
                { githubId: 1, _id: 1 }
            );
            const existingRepoByGithubIds = new Set(existingRepos.map(repo => repo.githubId));
            const reposToCreate = reposToAdd
                .filter(repo => !existingRepoByGithubIds.has(repo.id))
                .map(repository => ({
                    installationId: installationDoc._id,
                    installedOn: new Date(),
                    githubId: repository.id.toString(),
                    githubName: repository.name,
                    githubFullName: repository.full_name,
                }));

            const insertedRepos = await Repo.insertMany(reposToCreate);
            const repositoriesToConfigure = [...existingRepos, ...insertedRepos];
            if (repositoriesToConfigure.length > 0) {
                const existingRepoConfigs = await RepoConfig.find(
                    { repoId: { $in: repositoriesToConfigure.map(repo => repo._id) } },
                    { repoId: 1 },
                );
                const configuredRepoIds = new Set(existingRepoConfigs.map(config => config.repoId.toString()));
                const missingRepoConfigs = repositoriesToConfigure
                    .filter(repo => !configuredRepoIds.has(repo._id.toString()))
                    .map(repo => ({ repoId: repo._id }));

                if (missingRepoConfigs.length > 0) {
                    await RepoConfig.insertMany(missingRepoConfigs);
                }
            }

            if (insertedRepos.length > 0) {
                await Promise.all(insertedRepos.map(repo => logActivity({
                    installationId: installationDoc._id,
                    repoId: repo._id,
                    event: QUEUE_EVENTS.REPO.ADDED,
                    status: 'success',
                    message: `Repository ${repo.githubFullName} added to installation`,
                })));
                console.log(`Inserted ${reposToCreate.length} repos for installation ${payload.installationId}`);
            }
        }

        // update the repositorySelection field in GithubInstallation if it has changed
        if (installationDoc.repositorySelection !== payload.installationRepositorySelection) {
            // no await needed
            GithubInstallation.updateOne(
                { _id: installationDoc._id },
                { $set: { repositorySelection: payload.installationRepositorySelection } },
            ).catch(err => console.log("Error while updating installation selection:", err));
        }

    } catch (error) {
        console.log("Error [installation_repositories.added]:", error);
        try {
            const installationDoc = await GithubInstallation.findOne(
                { installationId: payload.installationId },
                { _id: 1 },
            );
            if (installationDoc) {
                await logActivity({
                    installationId: installationDoc._id,
                    event: QUEUE_EVENTS.INSTALLATION_REPOSITORIES.ADDED,
                    status: 'error',
                    message: 'Failed to process repositories added to installation',
                });
            }
        } catch (logError) {
            console.log("Error while logging activity for installation_repositories.added:", logError);
        }
    }
}
