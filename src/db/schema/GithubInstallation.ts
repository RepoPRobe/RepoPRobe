import { Schema, model, Types } from "mongoose";
import { UserSchema, UserType } from "../common";

export interface GithubInstallationType {
    _id: Types.ObjectId;
    installationId: string;
    ownedBy?: UserType | null;
    githubRedirect: string;
    target: {
        id: string;
        accountType: string;
    };
    installedBy?: UserType | null;
    suspendedAt?: Date | null;
    installedOn?: Date | null;
    deletedAt?: Date | null;
    lastUpdatedAt?: Date | null;
    repositorySelection: "all" | "selected";
    createdAt: Date;
    updatedAt: Date;
}

const githubInstallationSchema = new Schema<GithubInstallationType>({
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

export const GithubInstallation = model<GithubInstallationType>("GithubInstallation", githubInstallationSchema);