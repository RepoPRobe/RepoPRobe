import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { Repo } from "../../../db/schema/Repo";
import { RepoConfig } from "../../../db/schema/RepoConfig";
import { QUEUE_EVENTS } from "../../../types/queue-events";
import { InstallationRepositoriesAdded } from "../../../types/queue-payloads";
import { logActivity } from "../../common/activityLog";

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

            // no need of await as we are just soft deleting
            Repo.updateMany(
                {
                    installationId: installationDoc._id,
                    githubId: { $in: reposToDeleteGithubIds },
                },
                {
                    $set: {
                        deletedAt: new Date(),
                    }
                }
            ).catch(err => console.log("Error while soft deleting repos after installation selection changed to 'selected':", err));

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
                await logActivity({
                    installationId: installationDoc._id,
                    event: QUEUE_EVENTS.INSTALLATION_REPOSITORIES.ADDED,
                    status: 'error',
                    message: 'Failed to insert newly added repositories',
                });
            } else {
                await RepoConfig.insertMany(insertedRepos.value.map(repo => ({
                    repoId: repo._id,
                })));
                await Promise.all(insertedRepos.value.map(repo => logActivity({
                    installationId: installationDoc._id,
                    repoId: repo._id,
                    event: QUEUE_EVENTS.REPO.ADDED,
                    status: 'success',
                    message: `Repository ${repo.githubFullName} added to installation`,
                })));
                console.log(`Inserted ${reposToCreate.length} repos for installation ${payload.installationId}`);
            }

            if (restoredRepos.status === 'rejected') {
                console.log("Error while restoring soft deleted repos:", restoredRepos.reason);
                await logActivity({
                    installationId: installationDoc._id,
                    event: QUEUE_EVENTS.INSTALLATION_REPOSITORIES.ADDED,
                    status: 'error',
                    message: 'Failed to restore previously removed repositories',
                });
            } else {
                const restoredRepoDocs = reposToRestore.length > 0
                    ? await Repo.find(
                        {
                            installationId: installationDoc._id,
                            githubId: { $in: reposToRestore },
                        },
                        { _id: 1, githubFullName: 1 },
                    )
                    : [];
                await Promise.all(restoredRepoDocs.map(repo => logActivity({
                    installationId: installationDoc._id,
                    repoId: repo._id,
                    event: QUEUE_EVENTS.REPO.RESTORED,
                    status: 'success',
                    message: `Repository ${repo.githubFullName} restored on installation`,
                })));
                console.log(`Restored ${reposToRestore.length} repos for installation ${payload.installationId}`)
            }

            console.log(`Ignored ${reposToIgnore.size} repos for installation ${payload.installationId} as they were already present and not soft deleted.`);
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
