import { GithubInstallation } from "../../../db/schema/GithubInstallation.js";
import { Repo } from "../../../db/schema/Repo.js";
import { InstallationDeleted } from "../../../types/queue-payloads.js";
import { logActivity } from "../../common/activityLog.js";
import { QUEUE_EVENTS } from "../../../types/queue-events.js";

export async function handleInstallationDeleted(payload: InstallationDeleted) {
    try {
        const githubInstallation = await GithubInstallation.findOneAndUpdate(
            {
                installationId: payload.installationId,
                deletedAt: { $eq: null },
            },
            { $set: { deletedAt: new Date() } },
            { projection: { _id: 1 } },
        );

        if (!githubInstallation) {
            console.log(`No GithubInstallation found or already deleted found for installation ${payload.installationId}`);
            return;
        }

        await Repo.updateMany(
            { installationId: githubInstallation?._id },
            { $set: { deletedAt: new Date() } }
        );

        await logActivity({
            installationId: githubInstallation._id,
            event: QUEUE_EVENTS.INSTALLATION.DELETED,
            status: 'success',
            message: 'GitHub App installation deleted',
        });

        console.log(`Marked repos as deleted for installation ${payload.installationId}`);
    } catch (error) {
        console.log("Error [installation.deleted]:", error);
        try {
            const githubInstallation = await GithubInstallation.findOne(
                { installationId: payload.installationId },
                { _id: 1 },
            );
            if (githubInstallation) {
                await logActivity({
                    installationId: githubInstallation._id,
                    event: QUEUE_EVENTS.INSTALLATION.DELETED,
                    status: 'error',
                    message: 'Failed to delete GitHub App installation',
                });
            }
        } catch (logError) {
            console.log("Error logging activity for installation.deleted:", logError);
        }
    }
}
