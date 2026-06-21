import { Schema, model } from "mongoose";
import { UserSchema } from "../common";

const githubInstallationSchema = new Schema({
    installationId: { type: String, required: true, unique: true },
    ownedBy: { type: UserSchema, required: false },
    githubRedirect: { type: String, required: true },
    target: {
        type: {
            id: { type: String, required: true },
            accountType: { type: String, required: true },
        },
        required: true,
    },
    installedBy: { type: UserSchema, required: false },
    suspendedAt: { type: Date, required: false, default: null },
    installedOn: { type: Date, required: false, default: null },
    deletedAt: { type: Date, required: false, default: null },
    lastUpdatedAt: { type: Date, required: false, default: null },
    repositorySelection: { type: String, enum: ["all", "selected"], required: true },
}, { timestamps: true });

export const GithubInstallation = model("GithubInstallation", githubInstallationSchema);
