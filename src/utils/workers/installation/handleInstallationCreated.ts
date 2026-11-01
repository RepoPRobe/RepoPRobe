import { Types } from "mongoose";
import { GithubInstallation } from "../../../db/schema/GithubInstallation";
import { InstallationCreated } from "../../../types/queue-payloads";
import { Repo } from "../../../db/schema/Repo";
import { RepoConfig } from "../../../db/schema/RepoConfig";
import { logActivity, LogActivityInput } from "../../common/activityLog";
import { QUEUE_EVENTS } from "../../../types/queue-events";

export async function handleInstallationCreated(payload: InstallationCreated) {
    let installationDocId: Types.ObjectId | undefined;
    const childActivityLogs: LogActivityInput[] = [];
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
        installationDocId = githubInstallation._id;

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
                childActivityLogs.push(...reposToCreateConfig.map(repoId => ({
                    installationId: githubInstallation._id,
                    repoId,
                    event: QUEUE_EVENTS.REPO.ADDED,
                    status: 'success',
                    message: 'Repository added to installation',
                } satisfies LogActivityInput)));
            }

            console.log(`Inserted ${repos.length} repos for installation ${payload.installationId}`);
        }

        const installationCreatedLogId = await logActivity({
            installationId: githubInstallation._id,
            event: QUEUE_EVENTS.INSTALLATION.CREATED,
            status: 'success',
            message: 'GitHub App installation created',
            metadata: {
                repositoryCount: repos.length,
                repositorySelection: payload.installationRepositorySelection,
            },
        });
        if (installationCreatedLogId) {
            await Promise.all(childActivityLogs.map(log => logActivity({
                ...log,
                parentLogId: installationCreatedLogId,
            } satisfies LogActivityInput)));
        }
    } catch (error) {
        console.log("Error [installation.created]:", error);
        if (installationDocId) {
            await logActivity({
                installationId: installationDocId,
                event: QUEUE_EVENTS.INSTALLATION.CREATED,
                status: 'error',
                message: 'Failed to process GitHub App installation',
            });
        }
    }
}
