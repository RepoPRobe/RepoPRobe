import { Schema, model } from "mongoose";

const UserSchema = {
    id: String,
    login: String, // username
    avatarUrl: String,
    githubUrl: String,
    type: String,
};

const repoSchema = new Schema({
    installationId: String,
    ownedBy: UserSchema,
    installedOn: Date,
    lastUpdatedAt: Date,
    githubId: String,
    githubName: String,
    githubFullName: String, // includes user name also: username/repo-name
    isPrivate: Boolean,
    installedBy: UserSchema,
});

export const Repo = model("Repo", repoSchema);
