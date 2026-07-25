import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { Repo } from "../../../db/schema/Repo";
import { RepoConfig } from "../../../db/schema/RepoConfig";
import { InstallationRepositoriesAdded } from "../../../types/queue-payloads";

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
            const allReposGithubIds = allRepos.map(repo => repo.githubId);
            const addedReposGithubIds = payload.repositoriesAdded.map(repo => repo.id.toString());
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
            } else {
                await RepoConfig.insertMany(insertedRepos.value.map(repo => ({
                    repoId: repo._id,
                })));
                console.log(`Inserted ${reposToCreate.length} repos for installation ${payload.installationId}`);
            }

            if (restoredRepos.status === 'rejected') {
                console.log("Error while restoring soft deleted repos:", restoredRepos.reason);
            } else {
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
    }
}
