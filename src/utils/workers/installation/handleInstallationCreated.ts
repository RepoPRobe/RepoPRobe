import { Types } from "mongoose";
import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { InstallationCreated } from "../../../types/queue-payloads";
import { Repo } from "../../../db/schema/Repo";
import { RepoConfig } from "../../../db/schema/RepoConfig";

export async function handleInstallationCreated(payload: InstallationCreated) {
    try {
        const githubInstallation = await GithubInstallation.findOneAndUpdate(
            { installationId: payload.installationId },
            {
                $setOnInsert: {
                    installationId: payload.installationId,
                    ownedBy: payload.owner,
                    githubRedirect: payload.installationHtmlUrl,
                    target: {
                        id: payload.installationTargetId,
                        accountType: payload.installationAccountType,
                    },
                    installedBy: payload.installedBy,
                    installedOn: new Date(payload.installationInstalledOn),
                    lastUpdatedAt: new Date(payload.installationUpdatedAt),
                    repositorySelection: payload.installationRepositorySelection,
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
                            githubId: repo.id,
                        },
                        update: {
                            $set: {
                                deletedAt: null,
                            },
                            $setOnInsert: {
                                installationId: githubInstallation._id,
                                installedOn: new Date(payload.installationInstalledOn),
                                githubId: repo.id,
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

            console.log(`Inserted ${repos.length} repos for installation ${payload.installationId}`);
        }
    } catch (error) {
        console.log("Error [installation.created]:", error);
    }
}
